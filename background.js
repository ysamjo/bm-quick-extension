importScripts('shared.js');

const CLEANUP_RULESET = 'brickmerge_cleanup';
const DEFAULT_POPUP = 'popup/popup.html';
const detectedProducts = new Map();
const ALLOWED_FETCH_HOSTS = new Set([
    'brickmerge.de',
    'www.brickmerge.de',
    'getdata.andreas-9b7.workers.dev',
    'brickmerge-toolkit-api.andreas-9b7.workers.dev',
    'ebay-price-api.andreas-9b7.workers.dev',
    'bricklink.com',
    'www.bricklink.com',
    'brickowl.com',
    'www.brickowl.com',
    'rebrickable.com',
    'www.rebrickable.com',
    'brickbank.app',
    'duckduckgo.com'
]);

void chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(error => {
    console.error('Side Panel konnte nicht an die Toolbar-Aktion gebunden werden.', error);
});

function isAllowedFetchUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:') return false;
        return ALLOWED_FETCH_HOSTS.has(url.hostname) ||
            url.hostname.endsWith('.brickowl.com');
    } catch {
        return false;
    }
}

function serializeHeaders(headers) {
    return Array.from(headers.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');
}

async function fetchText(request) {
    if (!request || !isAllowedFetchUrl(request.url)) {
        return { ok: false, error: 'Nicht erlaubte Zieladresse.' };
    }

    const method = String(request.method || 'GET').toUpperCase();
    const targetUrl = new URL(request.url);
    const isDismissalWrite = method === 'POST' &&
        targetUrl.hostname === 'getdata.andreas-9b7.workers.dev' &&
        targetUrl.pathname === '/offers/dismissals';
    if (method !== 'GET' && !isDismissalWrite) {
        return { ok: false, error: 'Methode nicht erlaubt.' };
    }
    const requestBody = typeof request.data === 'string' ? request.data : undefined;
    if (requestBody && requestBody.length > 8 * 1024) {
        return { ok: false, error: 'Anfrage zu groß.' };
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers || {})) {
        if (/^(?:user-agent|referer|origin|host|content-length|cookie)$/i.test(name)) {
            continue;
        }
        headers.set(name, String(value));
    }

    try {
        const useBrowserSession = targetUrl.hostname === 'brickowl.com' ||
            targetUrl.hostname.endsWith('.brickowl.com');
        const response = await fetch(request.url, {
            method,
            headers,
            body: isDismissalWrite ? requestBody : undefined,
            credentials: useBrowserSession ? 'include' : 'omit',
            redirect: 'follow',
            cache: 'no-store'
        });
        return {
            ok: true,
            status: response.status,
            responseText: await response.text(),
            responseHeaders: serializeHeaders(response.headers),
            finalUrl: response.url
        };
    } catch (error) {
        return { ok: false, error: error?.message || 'Netzwerkfehler' };
    }
}

async function applyNetworkBlocking(settingsValue) {
    const settings = BM_mergeSettings(settingsValue);
    await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: settings.networkBlocking ? [CLEANUP_RULESET] : [],
        disableRulesetIds: settings.networkBlocking ? [] : [CLEANUP_RULESET]
    });
}

async function loadAndMigrateSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    const rawVersion = Number(settings?.settingsSchemaVersion) || 0;
    const migrated = BM_mergeSettings(settings);
    if (rawVersion < 2) {
        migrated.linkRows.france = false;
        migrated.settingsSchemaVersion = 2;
    }
    await chrome.storage.local.set({ settings: migrated });
    return migrated;
}

function isBrickmergePage(product) {
    const hostname = String(product?.hostname || '').trim().toLowerCase();
    if (hostname === 'brickmerge.de' || hostname === 'www.brickmerge.de') {
        return true;
    }
    try {
        return /(?:^|\.)brickmerge\.de$/i.test(
            new URL(String(product?.url || '')).hostname
        );
    } catch {
        return false;
    }
}

async function updateDetectedProduct(tabId, product) {
    if (!Number.isInteger(tabId)) return;
    if (product?.setNumber || product?.ean) {
        detectedProducts.set(tabId, product);
        const onBrickmergePage = isBrickmergePage(product);
        await Promise.all([
            chrome.action.setBadgeText({ tabId, text: onBrickmergePage ? '' : '✓' }),
            chrome.action.setBadgeBackgroundColor({ tabId, color: '#16843f' }),
            chrome.action.setPopup({ tabId, popup: '' }),
            chrome.action.setTitle({
                tabId,
                title: onBrickmergePage
                    ? 'Brickmerge Tools – Brickmerge-Seite'
                    : product.setNumber
                    ? `Brickmerge Tools – Set ${product.setNumber} erkannt`
                    : 'Brickmerge Tools – LEGO-Produkt erkannt'
            })
        ]);
        if (chrome.action.setBadgeTextColor) {
            await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
        }
        return;
    }
    detectedProducts.delete(tabId);
    await Promise.all([
        chrome.action.setBadgeText({ tabId, text: '' }),
        chrome.action.setPopup({ tabId, popup: DEFAULT_POPUP }),
        chrome.action.setTitle({ tabId, title: 'Brickmerge Tools' })
    ]);
}

chrome.runtime.onInstalled.addListener(async () => {
    const merged = await loadAndMigrateSettings();
    await applyNetworkBlocking(merged);
});

chrome.runtime.onStartup.addListener(async () => {
    const settings = await loadAndMigrateSettings();
    await applyNetworkBlocking(settings);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) {
        void applyNetworkBlocking(changes.settings.newValue);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') void updateDetectedProduct(tabId, null);
});

chrome.tabs.onRemoved.addListener(tabId => {
    detectedProducts.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'bm-page-product-detected') {
        void updateDetectedProduct(_sender.tab?.id, message.product);
        return false;
    }
    if (message?.type === 'bm-get-detected-set') {
        sendResponse({
            product: detectedProducts.get(Number(message.tabId)) || null
        });
        return false;
    }
    if (message?.type === 'bm-fetch-text') {
        void fetchText(message.request).then(sendResponse);
        return true;
    }
    return false;
});
