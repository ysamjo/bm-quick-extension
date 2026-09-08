importScripts('shared.js');

const CLEANUP_RULESET = 'brickmerge_cleanup';
const DEFAULT_POPUP = 'popup/popup.html';
const detectedProducts = new Map();
const selectedTerms = new Map();
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

function normalizeSelectedTerm(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

const priceCache = new Map();
const PRICE_CACHE_TTL_MS = 15 * 60 * 1000;

const formatBadgePrice = typeof BM_formatBadgePrice === 'function'
    ? BM_formatBadgePrice
    : price => {
        const num = Number(price);
        if (!Number.isFinite(num) || num <= 0) return '';
        if (num >= 1000) {
            const k = (num / 1000).toFixed(1);
            return `${k}k`.replace('.0k', 'k');
        }
        return `${Math.round(num)}€`;
    };

const parsePrice = typeof BM_parsePrice === 'function'
    ? BM_parsePrice
    : value => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const text = String(value || '').replace(/\s/g, '');
        const match = text.match(/\d[\d.,]*/);
        if (!match) return null;
        const raw = match[0];
        const comma = raw.lastIndexOf(',');
        const dot = raw.lastIndexOf('.');
        const normalized = comma > dot
            ? raw.replace(/\./g, '').replace(',', '.')
            : raw.replace(/,/g, '');
        const number = Number(normalized);
        return Number.isFinite(number) && number > 0 ? number : null;
    };

const formatEuro = typeof BM_formatEuro === 'function'
    ? BM_formatEuro
    : price => {
        const num = Number(price);
        if (!Number.isFinite(num)) return '';
        return num.toLocaleString('de-DE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

async function fetchBrickmergeBestPrice(setNumber) {
    const key = String(setNumber || '').trim();
    if (!key) return null;

    const cached = priceCache.get(key);
    if (cached && (Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS)) {
        return cached.price;
    }

    try {
        const response = await fetch(
            `https://www.brickmerge.de/?find=${encodeURIComponent(key)}`,
            {
                headers: { 'Accept': 'text/html,application/xhtml+xml' }
            }
        );
        if (!response.ok) return null;
        const html = await response.text();

        let price = null;
        const lowPriceMatch = html.match(/"lowPrice":\s*"([^"]+)"/i);
        if (lowPriceMatch) {
            price = parsePrice(lowPriceMatch[1]);
        }

        if (!price) {
            const titleMatch = html.match(
                /<title>[^<]*?\bab\s+([\d.,]+)\s*(?:€|&euro;)/i
            );
            if (titleMatch) {
                price = parsePrice(titleMatch[1]);
            }
        }

        if (!price) {
            const descMatch = html.match(
                /content="[^"]*?\bAb\s+([\d.,]+)\s*(?:€|&euro;)/i
            );
            if (descMatch) {
                price = parsePrice(descMatch[1]);
            }
        }

        if (price !== null) {
            priceCache.set(key, { price, timestamp: Date.now() });
        }
        return price;
    } catch {
        return null;
    }
}

async function updateActionState(tabId) {
    if (!Number.isInteger(tabId)) return;
    const product = detectedProducts.get(tabId) || null;
    const hasSelection = Boolean(selectedTerms.get(tabId));
    if (product) {
        const onBrickmergePage = isBrickmergePage(product);
        let badgeText = '';
        let titleText = onBrickmergePage
            ? 'Brickmerge Tools – Brickmerge-Seite'
            : product.setNumber
            ? `Brickmerge Tools – Set ${product.setNumber} erkannt`
            : 'Brickmerge Tools – LEGO-Produkt erkannt';

        if (!onBrickmergePage) {
            if (product.setNumber) {
                const cached = priceCache.get(product.setNumber);
                const isFresh = cached &&
                    (Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS);
                if (isFresh && cached.price) {
                    badgeText = formatBadgePrice(cached.price);
                    titleText = `Brickmerge Tools – Set ${product.setNumber}: Bestpreis ab ${formatEuro(cached.price)} €`;
                } else {
                    badgeText = '✓';
                    void fetchBrickmergeBestPrice(product.setNumber).then(price => {
                        if (price && detectedProducts.get(tabId) === product) {
                            void updateActionState(tabId);
                        }
                    });
                }
            } else {
                badgeText = '✓';
            }
        }

        await Promise.all([
            chrome.action.setBadgeText({ tabId, text: badgeText }),
            chrome.action.setBadgeBackgroundColor({ tabId, color: '#16843f' }),
            chrome.action.setPopup({ tabId, popup: '' }),
            chrome.action.setTitle({ tabId, title: titleText })
        ]);
        if (chrome.action.setBadgeTextColor) {
            await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
        }
        return;
    }
    await Promise.all([
        chrome.action.setBadgeText({ tabId, text: '' }),
        chrome.action.setPopup({ tabId, popup: hasSelection ? '' : DEFAULT_POPUP }),
        chrome.action.setTitle({ tabId, title: 'Brickmerge Tools' })
    ]);
}

async function updateDetectedProduct(tabId, product) {
    if (!Number.isInteger(tabId)) return;
    if (product?.setNumber || product?.ean) detectedProducts.set(tabId, product);
    else detectedProducts.delete(tabId);
    await updateActionState(tabId);
}

async function updateSelectedTerm(tabId, value) {
    if (!Number.isInteger(tabId)) return;
    const term = normalizeSelectedTerm(value);
    if (term) selectedTerms.set(tabId, term);
    else selectedTerms.delete(tabId);
    await updateActionState(tabId);
}

async function openProductPanel(tabId, product, rememberProduct = true) {
    if (!Number.isInteger(tabId) || (!product?.setNumber && !product?.ean)) {
        throw new Error('Kein LEGO-Set erkannt.');
    }
    if (rememberProduct) await updateDetectedProduct(tabId, product);
    const response = await chrome.tabs.sendMessage(tabId, {
        type: 'bm-show-floating-sidebar',
        product
    });
    if (!response?.ok) {
        throw new Error(response?.error || 'Seitenleiste konnte nicht geöffnet werden.');
    }
    return response;
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
    if (changeInfo.status !== 'loading') return;
    selectedTerms.delete(tabId);
    void updateDetectedProduct(tabId, null);
});

chrome.tabs.onRemoved.addListener(tabId => {
    detectedProducts.delete(tabId);
    selectedTerms.delete(tabId);
});

chrome.action.onClicked.addListener(tab => {
    const tabId = tab?.id;
    if (!Number.isInteger(tabId)) return;
    void (async () => {
        let selectedTerm = selectedTerms.get(tabId) || '';
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                type: 'bm-get-current-selection'
            });
            selectedTerm = normalizeSelectedTerm(response?.term);
            await updateSelectedTerm(tabId, selectedTerm);
        } catch {}
        const product = selectedTerm
            ? { setNumber: selectedTerm, name: selectedTerm }
            : detectedProducts.get(tabId);
        if (!product) return;
        await openProductPanel(tabId, product, !selectedTerm);
    })().catch(error => {
        console.error('Schwebende Brickmerge-Leiste konnte nicht geöffnet werden.', error);
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'bm-page-product-detected') {
        void updateDetectedProduct(_sender.tab?.id, message.product);
        return false;
    }
    if (message?.type === 'bm-page-selection-changed') {
        void updateSelectedTerm(_sender.tab?.id, message.term);
        return false;
    }
    if (message?.type === 'bm-get-detected-set') {
        sendResponse({
            product: detectedProducts.get(Number(message.tabId)) || null
        });
        return false;
    }
    if (
        message?.type === 'bm-open-floating-sidebar' ||
        message?.type === 'bm-open-overlay' ||
        message?.type === 'bm-open-sidepanel'
    ) {
        const tabId = _sender.tab?.id;
        const product = message.product;
        if (!Number.isInteger(tabId) ||
            (!product?.setNumber && !product?.ean)) {
            sendResponse({ ok: false, error: 'Kein LEGO-Set erkannt.' });
            return false;
        }
        void openProductPanel(tabId, product).then(sendResponse).catch(error => {
            sendResponse({
                ok: false,
                error: error?.message || 'Seitenleiste konnte nicht geöffnet werden.'
            });
        });
        return true;
    }
    if (message?.type === 'bm-fetch-text') {
        void fetchText(message.request).then(sendResponse);
        return true;
    }
    return false;
});
