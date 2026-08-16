chrome.storage.local.get('settings').then(({ settings }) => {
    const BM_SETTINGS = BM_mergeSettings(settings);
    const BM_OFFER_SHOP_KEY_MAP = {
        ebay: 'ebay',
        'ebay-minifig': 'ebay',
        'ebay-fr': 'ebayFr',
        kleinanzeigen: 'kleinanzeigen',
        'smyths-search': 'smyths',
        'mueller-search': 'mueller',
        bl: 'bricklink',
        bo: 'brickowl',
        brickbank: 'brickbank',
        bricklink: 'bricklink',
        brickowl: 'brickowl'
    };
    const BM_isOfferShopEnabled = key => {
        const normalized = BM_OFFER_SHOP_KEY_MAP[key] || key;
        if (['ebayFr', 'leboncoin', 'idealo'].includes(normalized) &&
            !BM_isFranceEnabled(BM_SETTINGS)) {
            return false;
        }
        if (normalized === 'brickbank') {
            return BM_SETTINGS.offerShops.smyths || BM_SETTINGS.offerShops.mueller;
        }
        return BM_SETTINGS.offerShops[normalized] !== false;
    };
(function () {
    'use strict';

    const META_GPT_PATH = '/g/g-LZvgtoTB9-meta-preisvergleich-gpt';
    const META_GPT_URL = `https://chatgpt.com${META_GPT_PATH}`;
    const META_GPT_PENDING_KEY = 'brickmerge-meta-gpt-pending-v1';
    const META_GPT_LAST_SUBMITTED_KEY = 'brickmerge-meta-gpt-last-submitted-v1';
    const META_GPT_MAX_PENDING_AGE = 10 * 60 * 1000;
    const OFFER_CACHE_TTL = 2 * 60 * 60 * 1000;
    const KLAZ_CLIENT_CACHE_TTL = 45 * 60 * 1000;
    const MINIFIG_INVENTORY_CACHE_TTL = 6 * 60 * 60 * 1000;
    const MINIFIG_PRICE_CACHE_TTL = 24 * 60 * 60 * 1000;
    const MINIFIG_TOTAL_CACHE_SCOPE = 'bricklink-minifig-current-total-eu-v7';
    const BM_WORKER_CLIENT_ID_STORAGE_KEY = 'brickmerge-worker-client-id-v1';
    const BM_WORKER_URL = globalThis.BM_WORKER_DEFAULT_BASE_URL ||
        'https://getdata.andreas-9b7.workers.dev';
    const REBRICKABLE_MINIFIG_CACHE_TTL = 24 * 60 * 60 * 1000;
    const cacheRequestsInFlight = new Map();
    const gmApi = typeof GM !== 'undefined' ? GM : null;

    function scheduleIdleTask(callback, timeout = 2000) {
        if (typeof window.requestIdleCallback === 'function') {
            return window.requestIdleCallback(callback, { timeout });
        }
        return window.setTimeout(callback, Math.min(timeout, 500));
    }

    const readLocalFallback = (key, fallback = null) => {
        try {
            const value = window.localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    };
    const writeLocalFallback = (key, value) => {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {}
    };
    const removeLocalFallback = key => {
        try {
            window.localStorage.removeItem(key);
        } catch (error) {}
    };
    const readStoredValue = (key, fallback = null) =>
        typeof GM_getValue === 'function'
            ? Promise.resolve(GM_getValue(key, fallback))
            : typeof gmApi?.getValue === 'function'
                ? Promise.resolve(gmApi.getValue(key, fallback))
                : Promise.resolve(readLocalFallback(key, fallback));
    const writeStoredValue = (key, value) =>
        typeof GM_setValue === 'function'
            ? Promise.resolve(GM_setValue(key, value))
            : typeof gmApi?.setValue === 'function'
                ? Promise.resolve(gmApi.setValue(key, value))
                : Promise.resolve(writeLocalFallback(key, value));
    const deleteStoredValue = key =>
        typeof GM_deleteValue === 'function'
            ? Promise.resolve(GM_deleteValue(key))
            : typeof gmApi?.deleteValue === 'function'
                ? Promise.resolve(gmApi.deleteValue(key))
                : Promise.resolve(removeLocalFallback(key));

    function createWorkerClientId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (window.crypto?.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < bytes.length; i += 1) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
        return [
            hex.slice(0, 4).join(''),
            hex.slice(4, 6).join(''),
            hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''),
            hex.slice(10, 16).join('')
        ].join('-');
    }

    async function getWorkerClientId() {
        const existing = String(
            await readStoredValue(BM_WORKER_CLIENT_ID_STORAGE_KEY, '')
        ).trim();
        if (/^[a-f0-9-]{36}$/i.test(existing)) return existing;

        const clientId = createWorkerClientId();
        await writeStoredValue(BM_WORKER_CLIENT_ID_STORAGE_KEY, clientId);
        return clientId;
    }

    function requestWithGm(details) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return GM_xmlhttpRequest(details);
        }
        if (typeof gmApi?.xmlHttpRequest === 'function') {
            return gmApi.xmlHttpRequest(details);
        }

        const controller = new AbortController();
        const fetchHeaders = { ...(details.headers || {}) };
        Object.keys(fetchHeaders).forEach(name => {
            if (/^(?:user-agent|referer|origin|host|content-length)$/i.test(name)) {
                delete fetchHeaders[name];
            }
        });
        const timeoutId = details.timeout
            ? window.setTimeout(() => {
                controller.abort();
                details.ontimeout?.();
            }, details.timeout)
            : null;
        fetch(details.url, {
            method: details.method || 'GET',
            headers: fetchHeaders,
            credentials: 'omit',
            signal: controller.signal
        }).then(async response => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            const responseText = await response.text();
            details.onload?.({
                status: response.status,
                responseText,
                responseHeaders: '',
                finalUrl: response.url
            });
        }).catch(error => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (error?.name === 'AbortError') details.onabort?.();
            else details.onerror?.(error);
        });
        return { abort: () => controller.abort() };
    }

    const setMetaGptValue = (key, value) => writeStoredValue(key, value);
    const getMetaGptValue = (key, fallback = null) => readStoredValue(key, fallback);
    const deleteMetaGptValue = key => deleteStoredValue(key);

    function makeApiCacheKey(scope, value) {
        const input = String(value || '');
        let hash = 2166136261;
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `bm-api-cache-v1-${scope}-${(hash >>> 0).toString(36)}`;
    }

    async function fetchWithCache(
        key,
        ttlMs,
        fetchFn,
        isCacheable = value => value !== null && value !== undefined,
        allowStaleOnError = true
    ) {
        const cached = await readStoredValue(key, null);
        const cachedIsUsable = cached &&
            Number.isFinite(Number(cached.timestamp)) &&
            cached.data !== undefined;
        if (cachedIsUsable && Date.now() - Number(cached.timestamp) < ttlMs) {
            return cached.data;
        }

        if (cacheRequestsInFlight.has(key)) {
            return cacheRequestsInFlight.get(key);
        }

        const request = (async () => {
            try {
                const freshData = await fetchFn();
                if (isCacheable(freshData)) {
                    await writeStoredValue(key, {
                        timestamp: Date.now(),
                        data: freshData
                    });
                    return freshData;
                }
                return cachedIsUsable ? cached.data : freshData;
            } catch (error) {
                if (cachedIsUsable && allowStaleOnError) return cached.data;
                throw error;
            } finally {
                cacheRequestsInFlight.delete(key);
            }
        })();
        cacheRequestsInFlight.set(key, request);
        return request;
    }

    function cachedGmRequest(cacheKey, ttlMs, details) {
        let liveRequest = null;
        let aborted = false;
        const {
            onload,
            onerror,
            ontimeout,
            onabort,
            allowStaleOnError = true,
            cacheOnly = false,
            ...requestDetails
        } = details;

        if (cacheOnly) {
            void readStoredValue(cacheKey, null).then(cached => {
                if (aborted) return;
                const timestamp = Number(cached?.timestamp);
                if (
                    Number.isFinite(timestamp) &&
                    Date.now() - timestamp < ttlMs &&
                    cached.data !== undefined
                ) {
                    onload?.(cached.data);
                    return;
                }
                const error = new Error('Kein frischer Cache-Eintrag');
                error.code = 'cache-miss';
                onerror?.(error);
            });
            return {
                abort() {
                    aborted = true;
                    onabort?.();
                }
            };
        }

        void fetchWithCache(cacheKey, ttlMs, () => new Promise((resolve, reject) => {
            liveRequest = requestWithGm({
                ...requestDetails,
                onload: response => {
                    const body = String(response.responseText || '');
                    if (response.status >= 200 && response.status < 400 && body) {
                        resolve({
                            status: response.status,
                            responseText: body,
                            responseHeaders: response.responseHeaders || '',
                            finalUrl: response.finalUrl || requestDetails.url
                        });
                    } else {
                        const error = new Error(`HTTP ${response.status}`);
                        error.code = 'http';
                        error.status = Number(response.status) || 0;
                        error.responseText = body;
                        error.finalUrl = response.finalUrl || requestDetails.url;
                        reject(error);
                    }
                },
                onerror: originalError => {
                    const error = new Error('Netzwerkfehler');
                    error.code = 'network';
                    error.cause = originalError;
                    reject(error);
                },
                ontimeout: () => {
                    const error = new Error('Zeitüberschreitung');
                    error.code = 'timeout';
                    reject(error);
                },
                onabort: () => {
                    const error = new Error('Abgebrochen');
                    error.code = 'abort';
                    reject(error);
                }
            });
        }), undefined, allowStaleOnError).then(response => {
            if (!aborted && response) {
                onload?.(response);
            } else if (!aborted) {
                onerror?.();
            }
        }).catch(error => {
            if (aborted) return;
            if (error?.code === 'timeout') ontimeout?.(error);
            else onerror?.(error);
        });

        return {
            abort() {
                aborted = true;
                liveRequest?.abort?.();
                onabort?.();
            }
        };
    }

    function cachedShopRequest(shopKey, cacheKey, ttlMs, details) {
        if (!BM_isOfferShopEnabled(shopKey)) {
            return { abort() {} };
        }
        return cachedGmRequest(cacheKey, ttlMs, details);
    }

    function waitForMetaGptElement(getElement, timeout = 60000) {
        return new Promise(resolve => {
            const immediate = getElement();
            if (immediate) {
                resolve(immediate);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = getElement();
                if (!element) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve(element);
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true
            });
            const timer = window.setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    function waitForPendingMetaGptTransfer(timeout = 10000) {
        return new Promise(resolve => {
            const startedAt = Date.now();
            const check = async () => {
                const transfer = await getMetaGptValue(META_GPT_PENDING_KEY);
                if (transfer?.id && transfer.prompt && transfer.createdAt) {
                    resolve(transfer);
                    return;
                }
                if (Date.now() - startedAt >= timeout) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 100);
            };
            void check();
        });
    }

    function findMetaGptPromptEditor() {
        return document.querySelector(
            '#prompt-textarea[contenteditable="true"], ' +
            'textarea#prompt-textarea, ' +
            'form textarea, ' +
            '[contenteditable="true"][data-lexical-editor="true"]'
        );
    }

    function fillMetaGptPromptEditor(editor, prompt) {
        editor.focus();

        if (editor instanceof HTMLTextAreaElement) {
            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            valueSetter?.call(editor, prompt);
        } else {
            document.execCommand('selectAll', false, null);
            const inserted = document.execCommand('insertText', false, prompt);
            if (!inserted || editor.textContent.trim() !== prompt) {
                const paragraph = document.createElement('p');
                paragraph.textContent = prompt;
                editor.replaceChildren(paragraph);
            }
        }

        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: prompt
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findMetaGptSendButton() {
        const directButton = document.querySelector(
            'button[data-testid="send-button"], ' +
            'button[data-testid="fruitjuice-send-button"]'
        );
        if (directButton) return directButton;

        return Array.from(document.querySelectorAll('form button')).find(button => {
            const label = [
                button.getAttribute('aria-label'),
                button.getAttribute('title')
            ].filter(Boolean).join(' ');
            return /send|senden|absenden/i.test(label);
        }) || null;
    }

    async function runMetaGptTransfer() {
        const transfer = await waitForPendingMetaGptTransfer();
        if (!transfer) return;
        if (Date.now() - transfer.createdAt > META_GPT_MAX_PENDING_AGE) {
            await deleteMetaGptValue(META_GPT_PENDING_KEY);
            return;
        }

        const lastSubmittedId = await getMetaGptValue(
            META_GPT_LAST_SUBMITTED_KEY
        );
        if (lastSubmittedId === transfer.id) {
            await deleteMetaGptValue(META_GPT_PENDING_KEY);
            return;
        }

        const editor = await waitForMetaGptElement(findMetaGptPromptEditor);
        if (!editor) return;
        fillMetaGptPromptEditor(editor, transfer.prompt);

        const sendButton = await waitForMetaGptElement(() => {
            const button = findMetaGptSendButton();
            return button && !button.disabled ? button : null;
        }, 15000);
        if (!sendButton) return;

        await setMetaGptValue(META_GPT_LAST_SUBMITTED_KEY, transfer.id);
        await deleteMetaGptValue(META_GPT_PENDING_KEY);
        sendButton.click();
    }

    if (location.pathname.startsWith(META_GPT_PATH)) {
        if (BM_SETTINGS.metaGptBridge) void runMetaGptTransfer();
        return;
    }

    // Die originalen Brickmerge-Angebotslinks bleiben unverändert. Auf einer
    // zwischengeschalteten Weiterleitungsseite wird der Shop-Link sofort
    // betätigt, auch wenn er erst nachträglich gerendert wird.
    function autoContinueBrickmergeRedirect() {
        const pageText = () => (document.body?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        const pathLooksLikeRedirect =
            /\/(?:go2|redirect|weiterleitung)\/?$/i.test(location.pathname);
        const pageLooksLikeRedirect = () => {
            const text = pageText();
            return /\bweiterleitung\b/i.test(text) &&
                /du verlässt nun die webseite brickmerge\.de|gewünschten shopseite/i.test(text);
        };
        if (!pathLooksLikeRedirect && !pageLooksLikeRedirect()) return false;

        let completed = false;
        const navigateToTarget = target => {
            const href = target?.href ||
                target?.formAction ||
                target?.dataset?.href ||
                target?.closest?.('a[href]')?.href ||
                target?.closest?.('form[action]')?.action ||
                '';
            if (href) {
                window.location.assign(href);
                return true;
            }
            if (target instanceof HTMLAnchorElement) {
                target.target = '_self';
            }
            target?.click?.();
            return false;
        };
        const continueRedirect = () => {
            if (completed) return true;
            const target = Array.from(
                document.querySelectorAll('a, button, input[type="submit"], input[type="button"]')
            ).find(element => {
                const label = [
                    element.textContent,
                    element.value,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title')
                ].filter(Boolean).join(' ');
                const isBackLink = /zurück|homepage/i.test(label);
                const isContinueLink =
                    /jetzt\s+weiterleiten/i.test(label) ||
                    (/\bzur\b/i.test(label) &&
                        /\b(?:shop|shops|shopseite)\b/i.test(label));
                return !isBackLink && isContinueLink;
            });
            if (!target) return false;

            completed = true;
            navigateToTarget(target);
            return true;
        };

        if (continueRedirect()) return true;

        const observer = new MutationObserver(() => {
            if (!continueRedirect()) return;
            observer.disconnect();
            window.clearTimeout(timeout);
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        const timeout = window.setTimeout(() => observer.disconnect(), 10000);
        return true;
    }

    if (BM_SETTINGS.autoContinueRedirect && autoContinueBrickmergeRedirect()) return;

    // ==========================================
    // CONFIG
    // ==========================================
    const CONFIG = {
        // Rabattsatz (0-1) je Händler, der nach Gutschein-/Membercode effektiv gilt.
        // Die Brickmerge-Händler-ID (mid) ist das Hauptmerkmal. Dadurch werden
        // gleichnamige Länder-Shops wie amazon (ES) oder Thalia.at nicht verwechselt.
        // Die aliases dienen nur als exakter Fallback, falls Brickmerge die mid-
        // Kennung einmal nicht ausliefert.
        retailerDiscounts: {
            "lego.com": {
                label: "LEGO",
                mid: "3",
                rate: 0.1405,
                aliases: ["LEGO"]
            },
            "mueller.de": {
                label: "Müller",
                mid: "335",
                rate: 0.11,
                aliases: ["MÜLLER", "Mueller"]
            },
            "thalia.de": {
                label: "Thalia",
                mid: "331",
                rate: 0.10,
                aliases: ["Thalia"]
            },
            "amazon.de": {
                label: "Amazon",
                mid: "1",
                rate: 0.05,
                aliases: ["amazon"]
            }
        }
    };
    const LEGACY_RETAILER_SETTINGS_KEY = 'brickmerge-toolkit-retailer-discounts-v1';
    const PERSONAL_DISCOUNT_SETTINGS_KEY = 'brickmerge-toolkit-personal-discounts-v2';

    // eBay kann auf Brickmerge mit getrennten Händlerkennungen für gewerbliche
    // und private Angebote auftauchen. Im Dialog und bei der Berechnung bleibt
    // es trotzdem bewusst ein gemeinsamer persönlicher Rabatt.
    function isEbayRetailerLabel(value) {
        return /(?:^|\s|[.(])eBay(?:\.de)?(?:\s|$|[.)])/i.test(String(value || ''));
    }

    function normalizeEbaySellerAccountType(value) {
        const normalized = String(value || '').trim().toUpperCase();
        if (normalized === 'BUSINESS' || normalized === 'COMMERCIAL') {
            return 'BUSINESS';
        }
        if (normalized === 'INDIVIDUAL' || normalized === 'PRIVATE') {
            return 'INDIVIDUAL';
        }
        return '';
    }

    function getEbaySellerAccountType(offer) {
        const seller = offer?.seller;
        return normalizeEbaySellerAccountType(
            offer?.sellerAccountType ||
            offer?.sellerType ||
            (seller && typeof seller === 'object'
                ? seller.sellerAccountType || seller.accountType
                : '')
        );
    }

    function getEbaySellerTypeLabel(value) {
        const accountType = normalizeEbaySellerAccountType(value);
        if (accountType === 'BUSINESS') return 'gewerblich';
        if (accountType === 'INDIVIDUAL') return 'privat';
        return '';
    }

    function getRetailerCatalog() {
        const catalog = new Map();
        Object.entries(CONFIG.retailerDiscounts).forEach(([key, discount]) => {
            catalog.set(key, { ...discount, key, isDefault: true });
        });

        document.querySelectorAll(
            '#offerlist .medium-4.small-9.columns.pricerow[data-mid]'
        ).forEach(priceRow => {
            const mid = priceRow.dataset.mid;
            const priceSpan = priceRow.querySelector('.price');
            if (!mid || !priceSpan) return;

            const knownEntry = Object.entries(CONFIG.retailerDiscounts)
                .find(([, discount]) => String(discount.mid) === String(mid));
            const knownDiscount = knownEntry?.[1];
            const label = getOfferMerchantName(priceSpan) ||
                knownDiscount?.label ||
                `Händler ${mid}`;
            const detectedEbay = isEbayRetailerLabel(label) ||
                isEbayRetailerLabel(knownDiscount?.label);
            const key = detectedEbay ? 'ebay' : (knownEntry?.[0] || `mid:${mid}`);

            catalog.set(key, {
                key,
                label: detectedEbay ? 'eBay' : label,
                // Kein mid für den gemeinsamen eBay-Eintrag: dadurch greifen
                // derselbe Prozentwert und dieselbe Checkbox auf beide Seller-
                // Varianten, auch wenn Brickmerge unterschiedliche mids nutzt.
                mid: detectedEbay ? null : mid,
                rate: knownDiscount?.rate || 0,
                aliases: detectedEbay
                    ? ['eBay', 'eBay.de', 'eBay (gewerblich)', 'eBay (privat)']
                    : (knownDiscount?.aliases || [label]),
                isDefault: Boolean(knownDiscount)
            });
        });

        return Array.from(catalog.entries()).sort(([, a], [, b]) =>
            a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })
        );
    }

    function getDefaultPersonalDiscountSettings() {
        const retailers = Object.fromEntries(
            getRetailerCatalog().map(([key, discount]) => [
                key,
                {
                    enabled: discount.isDefault,
                    percent: discount.isDefault
                        ? Math.round(discount.rate * 10000) / 100
                        : 0
                }
            ])
        );
        return { enabled: true, retailers };
    }

    function loadPersonalDiscountSettings() {
        const defaults = getDefaultPersonalDiscountSettings();
        try {
            const stored = JSON.parse(
                localStorage.getItem(PERSONAL_DISCOUNT_SETTINGS_KEY) || 'null'
            );
            const legacy = JSON.parse(
                localStorage.getItem(LEGACY_RETAILER_SETTINGS_KEY) || '{}'
            );
            const savedRetailers = stored?.retailers || legacy;

            // Frühere Versionen konnten eBay als zwei getrennte Einträge
            // speichern. Überführe diese still in den gemeinsamen eBay-Wert;
            // ein ausdrücklich vorhandener gemeinsamer Wert hat Vorrang.
            if (defaults.retailers.ebay &&
                !savedRetailers?.ebay && savedRetailers &&
                typeof savedRetailers === 'object') {
                const legacyEbayEntry = Object.entries(savedRetailers)
                    .find(([key]) => /ebay/i.test(key))?.[1];
                if (legacyEbayEntry && typeof legacyEbayEntry === 'object') {
                    savedRetailers.ebay = legacyEbayEntry;
                }
            }

            Object.entries(defaults.retailers).forEach(([key, fallback]) => {
                const candidate = savedRetailers?.[key];
                if (!candidate || typeof candidate !== 'object') return;

                const percent = Number(candidate.percent);
                defaults.retailers[key] = {
                    enabled: candidate.enabled !== false,
                    percent: Number.isFinite(percent)
                        ? Math.min(100, Math.max(0, percent))
                    : fallback.percent
                };
            });
            Object.entries(savedRetailers || {}).forEach(([key, candidate]) => {
                if (defaults.retailers[key] || !candidate || typeof candidate !== 'object') return;
                const percent = Number(candidate.percent);
                defaults.retailers[key] = {
                    enabled: candidate.enabled === true,
                    percent: Number.isFinite(percent)
                        ? Math.min(100, Math.max(0, percent))
                        : 0
                };
            });

            if (stored?.enabled === false) {
                defaults.enabled = false;
            }
        } catch (e) {
            console.warn('Brickmerge Tools: Persönliche Rabatte konnten nicht geladen werden.');
        }
        return defaults;
    }

    function savePersonalDiscountSettings(settings) {
        try {
            localStorage.setItem(PERSONAL_DISCOUNT_SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Brickmerge Tools: Persönliche Rabatte konnten nicht gespeichert werden.');
        }
    }

    function getConfiguredRetailerDiscounts() {
        const settings = loadPersonalDiscountSettings();
        if (!settings.enabled) return [];
        return getRetailerCatalog()
            .filter(([key]) => {
                const setting = settings.retailers[key];
                return setting?.enabled && Number(setting.percent) > 0;
            })
            .map(([key, discount]) => [
                key,
                {
                    ...discount,
                    rate: Number(settings.retailers[key].percent) / 100
                }
            ]);
    }

    // ==========================================
    // 0. GLOBALE STYLES (z.B. Cookiebot verstecken)
    // ==========================================
    const globalCss = `
        html.bm-extension-cleaner-enabled #CookiebotWidget,
        html.bm-extension-cleaner-enabled .CookiebotWidget,
        html.bm-extension-cleaner-enabled #cybotCookiebotDialog {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
        /* Preis-Spalte auf die durch die entfernte "Hier zu X!"-Spalte freiwerdende
           Breite ausdehnen. Nur ab der Foundation-"medium"-Breakpoint-Grenze, damit
           die (davon ohnehin unabhängige) Mobile-Ansicht unverändert bleibt. */
        @media screen and (min-width: 641px) {
            #offerlist div.medium-4.small-9.columns.pricerow {
                width: 91.6667% !important;
            }
        }
        #offerlist .pricerow > a > .price {
            width: 95% !important;
            border: none !important;
        }
        #offerlist span.price,
        #offerlist span.price > .merchant,
        #offerlist span.price > .merchant * {
            color: #b00 !important;
        }
        #offerlist span.price,
        #offerlist .bm-original-price {
            font-weight: normal !important;
        }
        #offerlist .row.collapse.bm-marketplace-offer {
            position: relative;
            box-shadow:
                inset 7px 0 0 #f8dc62,
                inset 8px 0 0 #d3b437 !important;
        }
        #offerlist .row.collapse.bm-marketplace-offer::before {
            content: "";
            position: absolute;
            inset: 0 auto 0 0;
            z-index: 9;
            width: 8px;
            background: linear-gradient(
                to right,
                #f8dc62 0,
                #f8dc62 7px,
                #d3b437 7px,
                #d3b437 8px
            );
            pointer-events: none;
        }
        @media screen and (min-width: 641px) {
            #offerlist .row.collapse.bm-marketplace-offer {
                width: calc(100% + 8px) !important;
                margin-left: -8px !important;
                padding-left: 8px !important;
                box-sizing: border-box;
            }
        }
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .goto.small-3.columns,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .goto.small-3.columns > .pricerow,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .medium-4.small-9.columns.pricerow {
            background-color: #800 !important;
        }
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .medium-4.small-9.columns.pricerow > a,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .medium-4.small-9.columns.pricerow span.price,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            > .medium-4.small-9.columns.pricerow span.price
                > :not(.bm-total-discount-bubble),
        #offerlist .row.collapse.bm-marketplace-offer:hover
            .bm-original-price,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            .bm-effective-info,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            .bm-shipping-info,
        #offerlist .row.collapse.bm-marketplace-offer:hover
            .bm-shipping-unknown {
            color: #fff !important;
        }
        #offerlist .row.collapse.bm-sold-out-offer {
            position: relative;
            box-shadow: inset 3px 0 0 #777;
        }
        #offerlist .row.collapse.bm-sold-out-offer > .goto.small-3.columns,
        #offerlist .row.collapse.bm-sold-out-offer
            > .goto.small-3.columns > .pricerow,
        #offerlist .row.collapse.bm-sold-out-offer
            > .medium-4.small-9.columns.pricerow {
            background-color: #dedede !important;
        }
        #offerlist .bm-sold-out-overlay {
            position: absolute;
            inset: 0;
            z-index: 5;
            background: rgba(95, 95, 95, 0.24);
            pointer-events: none;
        }
        #offerlist .bm-sold-out-badge {
            position: relative;
            z-index: 6;
            display: inline-flex;
            align-items: center;
            margin-left: 0.45rem;
            padding: 0.12rem 0.38rem;
            border-radius: 2px;
            background: #b00000;
            color: #fff !important;
            font-size: 0.58rem;
            font-weight: 700;
            line-height: 1.15;
            vertical-align: middle;
            white-space: nowrap;
        }
        #offerlist .pricerow:hover span.price,
        #offerlist .pricerow:hover span.price > .merchant,
        #offerlist .pricerow:hover span.price > .merchant * {
            color: #fff !important;
        }
        .content.setdetails .productprice > p,
        .content.setdetails .productprice > .topprice {
            padding-left: 0 !important;
            padding-right: 0 !important;
        }
        #offerlist .medium-4.small-9.columns.pricerow[data-mid] {
            background-image: none !important;
            background-size: 0 0 !important;
        }
        #offerlist .price > span[style*="position: absolute"] {
            display: none !important;
        }
        #offerlist .bm-marketplace-logo-link {
            position: relative;
            display: grid !important;
            grid-template-rows: minmax(0, 1fr);
            width: 100%;
            height: 100%;
            max-width: 100%;
            align-items: stretch;
            justify-items: stretch;
            text-decoration: none !important;
            min-height: 0;
            padding: 3px 7px;
            border: 0;
            border-radius: 0;
            background: #fff !important;
            box-shadow: none;
            box-sizing: border-box;
            margin: 0;
            overflow: hidden;
            transform: none;
            transition: background-color 150ms ease, box-shadow 150ms ease;
        }
        #offerlist .bm-marketplace-logo-link.bm-has-meta {
            grid-template-rows: minmax(0, 1fr) 12px;
            padding: 2px 7px 1px;
        }
        #offerlist .bm-ebay-logo-link.bm-has-meta {
            grid-template-rows: minmax(0, 1fr) 13px;
            padding: 2px 7px 1px;
        }
        #offerlist .bm-marketplace-logo-stage {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            min-width: 0;
            min-height: 0;
            gap: 2px;
            overflow: hidden;
            background: #fff !important;
            transform: scale(1);
            transform-origin: center;
            transition: transform 150ms ease, filter 150ms ease;
        }
        #offerlist .bm-marketplace-logo-stage > img,
        #offerlist .bm-marketplace-logo-stage > .bm-marketplace-logo {
            display: block !important;
            width: auto !important;
            height: auto !important;
            max-width: 92% !important;
            max-height: 84% !important;
            margin: 0 !important;
            object-fit: contain !important;
            object-position: center !important;
            vertical-align: middle;
            mix-blend-mode: normal !important;
        }
        #offerlist .bm-marketplace-logo-meta {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            width: 100%;
            min-width: 0;
            height: 12px;
            overflow: hidden;
            background: #fff !important;
        }
        #offerlist .bm-ebay-logo-link .bm-marketplace-logo-meta {
            height: 13px;
            gap: 0;
            border-top: 2px solid var(--bm-ebay-accent, #777);
        }
        #offerlist .bm-ebay-logo-link .bm-marketplace-logo-stage > img {
            max-width: 70% !important;
            max-height: 78% !important;
        }
        #offerlist .bm-ebay-domain-suffix {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: flex-end;
            color: var(--bm-ebay-accent, #444) !important;
            font-size: 0.67rem;
            font-weight: 700;
            line-height: 1;
            transform: translateY(-1px);
        }
        #offerlist .bm-ebay-de-source { --bm-ebay-accent: #c40000; }
        #offerlist .bm-ebay-fr-source { --bm-ebay-accent: #0057a8; }
        #offerlist .bm-ebay-native-source { --bm-ebay-accent: #555; }
        #offerlist .bm-ebay-commercial { --bm-ebay-accent: #0064d2; }
        #offerlist .bm-ebay-private { --bm-ebay-accent: #7b2e83; }
        #offerlist .bm-ebay-logo-link .bm-marketplace-logo-caption {
            color: var(--bm-ebay-accent, #555) !important;
            font-size: 0.58rem;
            font-weight: 700;
        }
        #offerlist .bm-marketplace-country-badge {
            display: none !important;
        }
        #offerlist .bm-marketplace-country-flag {
            position: absolute;
            top: 0;
            right: 1px;
            z-index: 2;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 14px;
            padding: 0;
            border-radius: 2px;
            background: rgba(255,255,255,0.94) !important;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.14);
            font-size: 12px;
            line-height: 1;
        }
        #offerlist .bm-marketplace-logo-cell {
            display: flex !important;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 36px;
            min-height: 36px;
            padding: 0 !important;
            overflow: hidden;
            background: #fff !important;
        }
        #offerlist .goto.bm-marketplace-logo-column,
        #offerlist .goto.bm-marketplace-logo-column:hover,
        #offerlist .row.collapse:hover > .goto.bm-marketplace-logo-column,
        #offerlist .goto.bm-marketplace-logo-column > .pricerow,
        #offerlist .goto.bm-marketplace-logo-column > .pricerow:hover,
        #offerlist .row.collapse:hover
            > .goto.bm-marketplace-logo-column > .pricerow {
            height: 36px !important;
            min-height: 36px !important;
            background: #fff !important;
            background-color: #fff !important;
            background-image: none !important;
        }
        #offerlist .bm-marketplace-logo-link:hover,
        #offerlist .bm-marketplace-logo-link:focus-visible {
            position: relative;
            z-index: 7;
            transform: none;
            background: #f6f6f6 !important;
            color: inherit !important;
            box-shadow:
                inset 0 0 0 1px #d9d9d9,
                inset 0 -2px 0 #c40000 !important;
            outline: none;
        }
        #offerlist .bm-marketplace-logo-link:hover .bm-marketplace-logo-stage,
        #offerlist .bm-marketplace-logo-link:focus-visible .bm-marketplace-logo-stage {
            transform: scale(1.035);
            filter: saturate(1.06) contrast(1.03);
        }
        #offerlist .bm-marketplace-logo-caption {
            display: block;
            min-width: 0;
            max-width: 100%;
            overflow: hidden;
            color: #555 !important;
            margin: 0;
            font-size: 0.5rem;
            font-weight: 600;
            line-height: 12px;
            text-overflow: ellipsis;
            white-space: nowrap;
            opacity: 1 !important;
            visibility: visible !important;
            text-shadow: none !important;
        }
        #offerlist .bm-ebay-logo-link .bm-marketplace-logo-caption {
            font-size: 0.52rem;
            line-height: 11px;
        }
        #offerlist .bm-lego-logo-link .bm-marketplace-logo-stage {
            background: #fff !important;
        }
        #offerlist .bm-lego-logo-link .bm-marketplace-logo-stage > img {
            max-width: 82% !important;
            max-height: 30px !important;
        }
        #offerlist .bm-lego-logo-link .bm-marketplace-logo-meta {
            background: #fff !important;
        }
        .bm-offerlist-loading {
            display: none;
            align-items: center;
            justify-content: flex-start;
            gap: 0.45rem;
            flex: 1 1 auto;
            min-height: 22px;
            margin: 0;
            color: #777;
            font-size: 0.72rem;
            line-height: 1;
        }
        .bm-offerlist-loading.is-visible {
            display: flex;
        }
        .bm-offerlist-loading-spinner {
            display: inline-block;
            width: 15px;
            height: 15px;
            box-sizing: border-box;
            border: 2px solid #dedede;
            border-top-color: #c40000;
            border-radius: 50%;
            animation: bm-offerlist-loading-spin 700ms linear infinite;
        }
        @keyframes bm-offerlist-loading-spin {
            to { transform: rotate(360deg); }
        }
        #offerlist .row.collapse:hover .bm-marketplace-logo-caption,
        #offerlist .bm-marketplace-logo-link:hover .bm-marketplace-logo-caption,
        #offerlist .bm-marketplace-logo-link:focus-visible .bm-marketplace-logo-caption {
            color: #555 !important;
        }
        #offerlist .row.collapse:hover .bm-ebay-logo-link .bm-marketplace-logo-caption,
        #offerlist .bm-ebay-logo-link:hover .bm-marketplace-logo-caption,
        #offerlist .bm-ebay-logo-link:focus-visible .bm-marketplace-logo-caption {
            color: var(--bm-ebay-accent, #555) !important;
        }
        #offerlist .bm-shipping-info {
            display: inline !important;
            position: relative;
            z-index: 3;
            margin-left: 0.6rem;
            color: #666 !important;
            font-size: 0.75rem;
            font-weight: normal;
            line-height: inherit !important;
            vertical-align: baseline;
            white-space: nowrap;
        }
        #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only):not(.bm-effective-info) {
            font-size: 0.75rem;
        }
        #offerlist .bm-original-price {
            display: inline;
            color: #b00 !important;
            font-size: inherit;
            font-weight: inherit;
            white-space: nowrap;
        }
        #offerlist .bm-shipping-unknown {
            color: #888 !important;
            font-style: italic;
        }
        #offerlist .bm-effective-info {
            display: inline !important;
            position: relative;
            z-index: 3;
            margin-left: 0.45rem;
            color: #b00 !important;
            font-size: 0.8rem;
            font-weight: normal;
            line-height: inherit;
            white-space: nowrap;
        }
        #offerlist .medium-4.small-9.columns.pricerow:hover > a,
        #offerlist .medium-4.small-9.columns.pricerow:hover span.price,
        #offerlist .medium-4.small-9.columns.pricerow:hover span.price
            > :not(.bm-total-discount-bubble),
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-original-price,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-effective-info,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-shipping-info,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-shipping-unknown,
        #offerlist .medium-4.small-9.columns.pricerow:hover
            .price > span.small:not(.bm-total-discount-bubble) {
            color: #fff !important;
        }
        #offerlist .bm-offer-discount-bubble {
            position: absolute;
            top: 4px;
            right: 0.4rem;
            z-index: 4;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            min-width: 26px;
            min-height: 26px;
            padding: 0;
            border-radius: 1000px;
            background: #b00;
            color: #fff;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            box-sizing: border-box;
        }
        #offerlist .bm-total-discount-bubble {
            position: absolute;
            top: 4px;
            right: 2.45rem;
            z-index: 4;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            min-width: 26px;
            min-height: 26px;
            padding: 0;
            border: 1px solid #c9c9c9;
            border-radius: 1000px;
            background: #e7e7e7;
            color: #555;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            box-sizing: border-box;
        }
        @media screen and (max-width: 640px) {
            #offerlist .goto.bm-marketplace-logo-column,
            #offerlist .goto.bm-marketplace-logo-column > .pricerow,
            #offerlist .bm-marketplace-logo-cell {
                height: 64px !important;
                min-height: 64px !important;
            }
            #offerlist .bm-marketplace-logo-link {
                width: 100% !important;
                height: 100% !important;
                min-height: 100% !important;
            }
            #offerlist .bm-effective-row span.price {
                display: inline-flex;
                flex-wrap: wrap;
                align-content: center;
                align-items: baseline;
                line-height: 1.15;
                padding-top: 0.15rem;
                padding-bottom: 0.15rem;
            }
            #offerlist .bm-effective-row span.price > .merchant {
                flex: 0 0 100%;
            }
            #offerlist .bm-shipping-info {
                margin-left: 0.35rem;
                font-size: 0.68rem;
            }
            #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only):not(.bm-effective-info) {
                font-size: 0.68rem;
            }
            #offerlist .bm-effective-info {
                display: inline !important;
                margin-left: 0.35rem;
                margin-top: 0;
                font-size: 0.68rem;
                line-height: 1.15;
                white-space: normal;
            }
            #offerlist .bm-offer-discount-bubble {
                top: 50%;
                right: 0.25rem;
                width: 32px;
                height: 32px;
                min-width: 32px;
                min-height: 32px;
                font-size: 0.78rem;
                transform: translateY(-50%);
            }
            #offerlist .bm-total-discount-bubble {
                top: 50%;
                right: 2.55rem;
                width: 32px;
                height: 32px;
                min-width: 32px;
                min-height: 32px;
                font-size: 0.78rem;
                transform: translateY(-50%);
            }
            #offerlist .price > .show-for-small-only.small {
                display: none !important;
            }
            #offerlist .row.collapse.bm-effective-row {
                min-height: 64px;
            }
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 64px !important;
                min-height: 64px !important;
            }
            #offerlist .row.collapse.bm-marketplace-offer,
            #offerlist .row.collapse.bm-marketplace-offer > .goto.small-3.columns,
            #offerlist .row.collapse.bm-marketplace-offer > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-marketplace-offer > .medium-4.small-9.columns.pricerow {
                height: 64px !important;
                min-height: 64px !important;
            }
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 64px !important;
                min-height: 64px !important;
            }
            #offerlist .bm-marketplace-logo-stage > img,
            #offerlist .bm-marketplace-logo-stage > .bm-marketplace-logo {
                max-width: 84% !important;
                max-height: 30px !important;
            }
            #offerlist .bm-lego-logo-link .bm-marketplace-logo-stage > img {
                max-width: 78% !important;
                max-height: 28px !important;
            }
        }
        .bm-offer-gallery {
            display: none;
        }
        .bm-sidebar-instructions {
            display: none;
        }
        .bm-sidebar-parts {
            display: none;
        }
        .content.setdetails .topprice {
            position: relative !important;
        }
        .content.setdetails .large-3.medium-4.columns.hide-for-small,
        .content.setdetails .show-for-small-only.text-center {
            position: relative;
        }
        .content.setdetails .topprice span[style*="position: absolute"],
        .bm-bestprice-black-bubble {
            position: absolute !important;
            top: calc(50% + 4px) !important;
            left: auto !important;
            z-index: 100 !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 28px !important;
            height: 28px !important;
            min-width: 28px !important;
            min-height: 28px !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 999px;
            color: #fff !important;
            font-size: 0.7rem;
            font-weight: bold;
            line-height: 1 !important;
            text-align: center;
            transform: translateY(-50%) !important;
            box-sizing: border-box;
        }
        .content.setdetails .topprice span[style*="position: absolute"] {
            right: 0.65rem !important;
        }
        .bm-bestprice-black-bubble {
            right: 2.85rem !important;
            border: 1px solid #000 !important;
            background: #222 !important;
        }
        .bm-bestprice-black-bubble.bm-bestprice-black-bubble-single {
            right: 0.65rem !important;
        }
        .content.setdetails .large-3.medium-4.columns.hide-for-small
            > .off:not(.bm-bestprice-black-bubble),
        .content.setdetails .show-for-small-only.text-center
            > .off:not(.bm-bestprice-black-bubble) {
            top: 0.45rem !important;
            left: 0.75rem !important;
        }
        .bm-featured-black-bubble {
            position: absolute !important;
            top: 0.45rem !important;
            left: 0.75rem !important;
            z-index: 99 !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 54px !important;
            height: 54px !important;
            min-width: 54px !important;
            min-height: 54px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 1px solid #000 !important;
            border-radius: 999px !important;
            background: #222 !important;
            color: #fff !important;
            font-size: 1rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
            text-align: center;
            box-sizing: border-box;
        }
        .bm-featured-black-bubble.bm-featured-black-bubble-stacked {
            top: calc(0.45rem + 60px) !important;
        }
        .bm-full-product-description {
            float: none !important;
            clear: both;
            width: 100% !important;
            margin: 1.5rem 0 0 !important;
            padding-left: 0.9375rem !important;
            padding-right: 0.9375rem !important;
            padding-bottom: 0 !important;
            box-sizing: border-box;
        }
        .bm-full-product-description p,
        .bm-full-product-description li,
        .bm-full-product-description .padDoubleBottom {
            line-height: 1.5 !important;
        }
        .bm-full-product-description p {
            margin-bottom: 1rem;
        }
        .bm-full-product-description li {
            margin-bottom: 0.2rem;
        }
        .bm-lego-article-link {
            color: inherit;
            text-decoration: underline;
            text-decoration-color: rgba(176, 0, 0, 0.45);
            text-underline-offset: 2px;
        }
        .bm-lego-article-link:hover,
        .bm-lego-article-link:focus {
            color: #700;
            text-decoration-color: currentColor;
        }
        .bm-designer-link,
        .bm-designer-link:visited {
            color: inherit;
            text-decoration: none !important;
        }
        .bm-detail-line-link,
        .bm-detail-line-link:visited {
            color: inherit;
            text-decoration: none;
        }
        .bm-detail-line-link:hover,
        .bm-detail-line-link:focus,
        .bm-designer-link:hover,
        .bm-designer-link:focus,
        .bm-price-history-link:hover,
        .bm-price-history-link:focus {
            color: #fff !important;
            background-color: #700;
            text-decoration: none;
        }
        .bm-detail-line-link:hover *,
        .bm-detail-line-link:focus *,
        .bm-designer-link:hover *,
        .bm-designer-link:focus *,
        .bm-price-history-link:hover *,
        .bm-price-history-link:focus * {
            color: #fff !important;
        }
        .bm-minifig-count-link {
            position: relative;
        }
        .bm-minifig-tooltip {
            position: absolute;
            left: 50%;
            bottom: calc(100% + 9px);
            z-index: 2147482500;
            display: block;
            width: max-content;
            max-width: min(360px, calc(100vw - 32px));
            padding: 0.48rem 0.62rem;
            border: 3px solid #fff;
            border-radius: 6px;
            background: #ff771a !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
            color: #fff !important;
            font: 400 0.72rem/1.35 Arial, sans-serif;
            text-align: left;
            white-space: normal;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transform: translate(-50%, 3px);
            transition: opacity 120ms ease, transform 120ms ease,
                visibility 0s linear 120ms;
            box-sizing: border-box;
        }
        .bm-minifig-tooltip::before {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            border: 9px solid transparent;
            border-top-color: #fff;
            transform: translateX(-50%);
        }
        .bm-minifig-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            border: 6px solid transparent;
            border-top-color: #ff771a;
            transform: translateX(-50%);
        }
        .bm-minifig-count-link:hover > .bm-minifig-tooltip,
        .bm-minifig-count-link:focus-visible > .bm-minifig-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translate(-50%, 0);
            transition-delay: 0s;
        }
        .bm-ean-source-block {
            display: none !important;
        }
        body.bm-ean-overlay-open {
            overflow: hidden !important;
        }
        .bm-ean-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483100;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.75rem;
            background: rgba(0, 0, 0, 0.64);
            box-sizing: border-box;
            animation: bm-ean-fade-in 0.16s ease-out;
        }
        .bm-ean-dialog {
            display: flex;
            width: min(760px, calc(100vw - 2.5rem));
            max-height: min(84vh, 760px);
            flex-direction: column;
            overflow: hidden;
            border-top: 5px solid #b00;
            border-radius: 4px;
            background: #fff;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
            animation: bm-ean-zoom-in 0.16s ease-out;
        }
        .bm-ean-header {
            display: flex;
            min-height: 64px;
            flex: 0 0 auto;
            align-items: center;
            justify-content: space-between;
            padding: 0.8rem 0.8rem 0.8rem 1.25rem;
            border-bottom: 1px solid #ddd;
            background: #fff !important;
            box-shadow: none !important;
            text-shadow: none !important;
        }
        .bm-ean-heading {
            min-width: 0;
        }
        .bm-ean-title {
            margin: 0;
            padding: 0;
            color: #333 !important;
            background: none !important;
            font-size: 1.25rem;
            font-weight: 700;
            line-height: 1.25;
            text-shadow: none !important;
        }
        .bm-ean-subtitle {
            margin-top: 3px;
            color: #777;
            font-size: 0.75rem;
            line-height: 1.2;
        }
        .bm-ean-close {
            display: flex;
            width: 40px;
            min-width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: #f7eaea;
            color: #800;
            cursor: pointer;
            font: bold 1.8rem/1 Arial, sans-serif;
            text-shadow: none !important;
        }
        .bm-ean-close:hover,
        .bm-ean-close:focus {
            background: #b00;
            color: #fff;
            outline: none;
        }
        .bm-ean-content {
            display: flex;
            min-height: 280px;
            flex: 1 1 auto;
            align-items: center;
            justify-content: center;
            padding: clamp(1.25rem, 5vw, 3rem);
            overflow: auto;
            background: #fff;
            box-sizing: border-box;
        }
        .bm-ean-barcode {
            display: block;
            width: 100%;
            max-width: 680px;
            height: auto;
            max-height: 360px;
            margin: auto;
            object-fit: contain;
            background: #fff;
        }
        .bm-ean-fallback {
            color: #222;
            font: 700 clamp(1.5rem, 7vw, 3rem)/1.2 monospace;
            letter-spacing: 0;
            text-align: center;
        }
        @keyframes bm-ean-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes bm-ean-zoom-in {
            from { transform: translateY(8px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .bm-minifig-value-load {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.45em;
            min-width: 1.45em;
            height: 1.45em;
            min-height: 1.45em;
            margin: 0 0 0 .35em !important;
            padding: 0;
            border: 1px solid currentColor;
            border-radius: 50%;
            color: #c00;
            background: transparent;
            font: 700 .72em/1 Arial, sans-serif;
            vertical-align: .12em;
            box-sizing: border-box;
            cursor: pointer;
        }
        .bm-minifig-value-load:hover,
        .bm-minifig-value-load:focus {
            color: #fff;
            background: #700;
            border-color: #700;
            outline: none;
        }
        .bm-minifig-value-load.is-loading {
            color: transparent;
            border-color: #ccc;
            border-top-color: #c00;
            animation: bm-minifig-value-spin .7s linear infinite;
            pointer-events: none;
        }
        .bm-minifig-value-load.is-error {
            color: #700;
            border-color: #700;
        }
        @keyframes bm-minifig-value-spin {
            to { transform: rotate(360deg); }
        }
        #wrap.bm-set-wrap {
            margin-bottom: -58px !important;
        }
        #wrap.bm-set-wrap > *:last-child {
            padding-bottom: 10px !important;
        }
        #footer.bm-compact-footer {
            height: 58px !important;
            min-height: 58px;
        }
        body.bm-chart-overlay-open {
            overflow: hidden !important;
        }
        .bm-chart-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1.25rem;
            background: rgba(0, 0, 0, 0.64);
            box-sizing: border-box;
        }
        .bm-chart-overlay.bm-open {
            display: flex;
            animation: bm-ean-fade-in 0.18s ease-out;
        }
        .bm-chart-overlay.bm-preloading {
            display: flex;
            top: -200vh;
            left: -200vw;
            right: auto;
            bottom: auto;
            width: 1px;
            height: 1px;
            padding: 0;
            overflow: hidden;
            background: transparent;
            opacity: 0;
            pointer-events: none;
        }
        .bm-chart-dialog {
            position: relative;
            display: flex;
            width: min(1600px, calc(100vw - 1.5rem));
            height: calc(100vh - 1.5rem);
            height: calc(100dvh - 1.5rem);
            flex-direction: column;
            overflow: hidden;
            border-top: 5px solid #b00;
            border-radius: 4px;
            background: #fff;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
            animation: bm-ean-zoom-in 0.18s ease-out;
        }
        .bm-chart-dialog-header {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 1rem;
            min-height: 64px;
            padding: 0.8rem 4.25rem 0.8rem 1.25rem;
            border-bottom: 1px solid #ddd;
            background: #fff;
            box-shadow: none !important;
            text-shadow: none !important;
        }
        .bm-chart-dialog-title {
            flex: 0 0 auto;
            margin: 0;
            color: #333;
            font-size: 1.25rem;
            font-weight: 700;
            line-height: 1.2;
            text-shadow: none !important;
        }
        .bm-chart-periods {
            display: flex;
            min-width: 0;
            flex: 1 1 auto;
            align-items: center;
            gap: 0.25rem;
            overflow-x: auto;
            scrollbar-width: thin;
        }
        .bm-chart-periods .buttonPeriod {
            flex: 0 0 auto;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0.3rem 0.55rem !important;
            border: 1px solid #ccc !important;
            background: #f4f4f4 !important;
            color: #444 !important;
            font-size: 0.72rem !important;
            line-height: 1.1 !important;
            text-shadow: none !important;
        }
        .bm-chart-periods .buttonPeriod.hasOrangeBg {
            border-color: #ff771a !important;
            background: #ff771a !important;
            color: #222 !important;
        }
        .bm-chart-dialog-close {
            position: absolute;
            top: 0.65rem;
            right: 0.8rem;
            display: inline-flex;
            width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 0;
            border: 0;
            background: #f7eaea;
            color: #800;
            border-radius: 4px;
            font-size: 1.8rem;
            font-weight: bold;
            line-height: 1;
            text-shadow: none !important;
            cursor: pointer;
        }
        .bm-chart-dialog-close:hover,
        .bm-chart-dialog-close:focus {
            background: #b00;
            color: #fff;
        }
        .bm-chart-dialog-content {
            min-height: 0;
            flex: 1 1 auto;
            overflow: auto;
            padding: 0.35rem 1.25rem 1.25rem;
        }
        .bm-chart-dialog #chartContainer {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
        }
        .bm-chart-dialog #chartWrapper {
            margin-top: 0 !important;
        }
        .bm-chart-dialog .bm-native-period-row {
            display: none !important;
        }
        .bm-chart-dialog #chartWrapper,
        .bm-chart-dialog #chartWrapper * {
            text-shadow: none !important;
        }
        .bm-chart-dialog .bm-native-chart-title {
            display: none !important;
        }
        .bm-chart-dialog .bm-chart-help {
            margin: 0.75rem 0 0 !important;
            padding-top: 0.65rem;
            border-top: 1px solid #e5e5e5;
            color: #666;
            font-size: 0.75rem;
            line-height: 1.3;
        }
        .bm-chart-dialog .bm-chart-history-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.25rem;
            margin: 0 0 0.6rem !important;
            line-height: 1.35rem !important;
        }
        .bm-chart-dialog .bm-chart-history-row strong {
            color: #333 !important;
        }
        .bm-chart-dialog .bm-chart-history-row br {
            display: none !important;
        }
        .bm-chart-dialog .bm-chart-history-row .button {
            margin: 0.2rem 0.2rem 0.2rem 0 !important;
            padding: 0.3rem 0.5rem !important;
            font-size: 0.75rem !important;
            line-height: 1.1 !important;
            text-shadow: none !important;
        }
        .bm-chart-dialog #bigChart {
            display: block;
            width: 100% !important;
            min-height: 60px;
            padding: 0 !important;
        }
        .bm-chart-dialog #bigChart > * {
            max-width: 100%;
        }
        #chartdiv2 {
            margin-bottom: 0.75rem !important;
        }
        .bm-chart-controls {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            column-gap: 0.65rem;
            margin-bottom: 0 !important;
        }
        .bm-chart-best-price {
            margin-bottom: 0.5rem;
            color: #555;
            font-size: 0.75rem;
            font-weight: 600;
            line-height: 1.25;
        }
        .bm-chart-label-mobile {
            display: none;
        }
        #chartTrigger .chartbutton {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            gap: 0.35rem;
        }
        #chartTrigger .chartbutton::before {
            display: none !important;
            content: none !important;
        }
        .bm-chart-action-icon {
            display: inline-flex;
            width: 1.2rem;
            height: 1.2rem;
            flex: 0 0 1.2rem;
            align-items: center;
            justify-content: center;
            line-height: 1;
        }
        .bm-chart-action-icon svg {
            display: block;
            width: 1.15rem;
            height: 1.15rem;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        @media screen and (min-width: 1025px) {
            .content.setdetails .bm-detail-layout {
                display: grid;
                grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
                align-items: start;
                column-gap: 1.875rem;
                width: 100%;
            }
            .content.setdetails .bm-detail-left,
            .content.setdetails .bm-detail-right {
                min-width: 0;
            }
            .content.setdetails .bm-detail-left > .medium-8.medium-pull-4.columns,
            .content.setdetails .bm-detail-right > .productprice,
            .content.setdetails .bm-detail-right > #ol2nd,
            .content.setdetails .bm-detail-left > #offerlist,
            .content.setdetails .bm-detail-left > #offerlist > #ol1st {
                position: static !important;
                right: auto !important;
                left: auto !important;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0 !important;
                padding-left: 0 !important;
            }
            .content.setdetails .bm-detail-left > #offerlist {
                display: block;
                margin-top: 0.85rem !important;
            }
            .content.setdetails .bm-chart-content-column > #offerlist {
                display: block;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                margin: 0.35rem 0 0 !important;
                padding: 0 !important;
            }
            .content.setdetails .bm-chart-content-column > #offerlist > #ol1st {
                position: static !important;
                right: auto !important;
                left: auto !important;
                display: block;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0 !important;
                padding-left: 0 !important;
            }
            .content.setdetails .bm-detail-right > #ol2nd {
                margin-top: 1.25rem;
            }
            #offerlist::before,
            #offerlist::after {
                display: none !important;
                content: none !important;
            }
            .content.setdetails .bm-detail-layout > .bm-full-product-description {
                grid-column: 1 / -1;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0.9375rem !important;
                padding-left: 0.9375rem !important;
            }
            #ol1st.bm-offer-layout {
                display: block;
            }
            #ol1st.bm-offer-layout > .bm-offer-section {
                min-width: 0;
                margin-top: 0;
            }
            #ol1st.bm-offer-layout > .bm-offer-section > p:empty {
                display: none !important;
            }
            #ol1st.bm-offer-layout > :not(.bm-offer-section) {
                grid-column: 1 / -1;
            }
            #ol1st.bm-offer-layout > .bm-offer-section
                .row.collapse > .goto.medium-1.small-3.columns,
            #offerlist.bm-offer-under-chart
                .row.collapse > .goto.medium-1.small-3.columns {
                width: 11.9048% !important;
            }
            #ol1st.bm-offer-layout > .bm-offer-section
                .row.collapse > .medium-4.small-9.columns.pricerow,
            #offerlist.bm-offer-under-chart
                .row.collapse > .medium-4.small-9.columns.pricerow {
                width: 88.0952% !important;
            }
            .bm-product-gallery-host {
                position: relative;
                width: 30% !important;
            }
            .bm-product-gallery-host + .large-9.medium-8.columns {
                width: 70% !important;
            }
            .bm-product-gallery-host > .bm-offer-gallery {
                position: relative;
                top: auto;
                left: auto;
                z-index: 2;
                display: block;
                width: 100%;
                margin-top: 0.45rem;
                padding-right: 0.9375rem;
                text-align: left;
                box-sizing: border-box;
            }
            .bm-product-gallery-host > .bm-offer-videos {
                position: relative;
                clear: both;
                z-index: 2;
                display: block;
                width: 100%;
                margin-top: 0.65rem;
                padding-right: 0.9375rem;
                box-sizing: border-box;
            }
            .bm-offer-gallery-list {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.55rem;
            }
            .bm-offer-gallery-link {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 0;
                aspect-ratio: 4 / 3;
                padding: 0.2rem;
                border: 1px solid transparent;
                border-radius: 2px;
                background: #fff;
                cursor: zoom-in;
                text-decoration: none;
                box-shadow: none;
                overflow: hidden;
                transition: border-color 150ms ease, box-shadow 150ms ease;
            }
            .bm-product-gallery-host > .bm-unified-gallery-link {
                display: flex !important;
                width: 100%;
                align-items: center;
                justify-content: center;
                padding: 0.2rem;
                border: 1px solid transparent;
                border-radius: 2px;
                background: #fff;
                cursor: zoom-in;
                text-decoration: none;
                box-shadow: none;
                overflow: hidden;
                transition: border-color 150ms ease, box-shadow 150ms ease;
                box-sizing: border-box;
            }
            .bm-offer-gallery-link img {
                display: block !important;
                width: 100% !important;
                height: 100% !important;
                max-width: none !important;
                margin: 0 !important;
                object-fit: contain;
                box-shadow: none !important;
                opacity: 1 !important;
            }
            .bm-unified-gallery-link > .bm-unified-gallery-image {
                transform: scale(0.9) !important;
                transform-origin: center;
                box-shadow: none !important;
                opacity: 1 !important;
                transition: transform 150ms ease;
            }
            .bm-unified-gallery-link:hover,
            .bm-unified-gallery-link:focus,
            .bm-unified-gallery-link:active {
                border-color: #d7d7d7 !important;
                background: #fff !important;
                color: inherit !important;
                box-shadow: 1px 1px 4px 0 rgba(0, 0, 0, 0.2) !important;
                outline: none;
            }
            .bm-unified-gallery-link:hover > .bm-unified-gallery-image,
            .bm-unified-gallery-link:focus > .bm-unified-gallery-image,
            .bm-unified-gallery-link:active > .bm-unified-gallery-image {
                transform: scale(1) !important;
                box-shadow: none !important;
            }
            .bm-product-gallery-host .bm-unified-gallery-link,
            .bm-product-gallery-host .bm-unified-gallery-link:visited {
                background: #fff !important;
            }
            .bm-offer-videos .flex-video,
            .bm-offer-videos iframe,
            .bm-offer-videos video {
                display: block;
                width: 100%;
                max-width: 100%;
                margin: 0 0 0.6rem;
            }
            .bm-offer-video-link {
                display: block;
                margin: 0 0 0.55rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: underline;
            }
            #ol1st .bm-instruction-source {
                display: none !important;
            }
            #ol1st .bm-parts-source {
                display: none !important;
            }
            #ol2nd .bm-sidebar-instructions {
                display: block;
                margin: 0 0 1.25rem;
                text-align: left;
            }
            .bm-sidebar-instructions h3 {
                margin: 0 0 0.65rem;
                color: #333;
                font-size: 1.15rem;
                line-height: 1.2;
            }
            .bm-sidebar-instruction-list {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.65rem;
            }
            .bm-sidebar-instruction-link {
                display: block;
                min-width: 0;
                color: #b00;
                font-size: 0.66rem;
                line-height: 1.2;
                text-align: center;
                text-decoration: none;
                overflow-wrap: anywhere;
            }
            .bm-sidebar-instruction-link img {
                display: block;
                width: 100%;
                height: auto;
                max-height: 105px;
                margin: 0 auto 0.25rem;
                border: 1px solid #ddd;
                object-fit: contain;
                background: #fff;
            }
            .bm-sidebar-instructions-more {
                display: inline-block;
                margin-top: 0.75rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: underline;
            }
            #ol2nd .bm-sidebar-parts {
                display: block;
                margin: 0 0 1.25rem;
                text-align: left;
            }
            #ol2nd .bm-sidebar-barcode {
                margin-bottom: 0 !important;
                padding-bottom: 1.25rem !important;
                text-align: left !important;
            }
            #ol2nd .bm-sidebar-barcode h3 {
                margin-left: 0 !important;
                text-align: left !important;
            }
            #ol2nd .bm-sidebar-barcode #barcode {
                display: block;
                margin-right: auto !important;
                margin-left: 0 !important;
            }
            .bm-sidebar-parts h3 {
                margin: 0 0 0.65rem;
                color: #333;
                font-size: 1.15rem;
                line-height: 1.2;
            }
            .bm-sidebar-parts-list {
                display: grid;
                gap: 0.45rem;
            }
            .bm-sidebar-parts-link {
                display: flex;
                align-items: center;
                gap: 0.4rem;
                min-width: 0;
                padding: 0.35rem 0.45rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: none;
                background: #f2f2f2;
            }
            .bm-sidebar-parts-link:hover {
                color: #fff;
                background: #b00;
            }
            .bm-sidebar-parts-link img {
                flex: 0 0 auto;
                width: 18px;
                height: 18px;
                margin: 0;
                object-fit: contain;
            }
            #ol2nd .bm-gallery-source,
            #ol2nd .bm-video-source,
            #showmoreimages {
                display: none !important;
            }
        }
        .bm-offer-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            margin: 0 0 0.15rem !important;
            padding: 0;
        }
        #offerlist .bm-marketplace-offer.bm-offer-entering {
            overflow: hidden;
            animation: bm-offer-enter 0.24s ease-out both;
            transform-origin: top center;
        }
        #offerlist .row.collapse.bm-offer-reordering {
            position: relative;
            z-index: 2;
            will-change: transform;
        }
        .bm-link.bm-shortcut-leaving {
            pointer-events: none;
            animation: bm-shortcut-leave 0.2s ease-in both;
        }
        @keyframes bm-offer-enter {
            from {
                max-height: 0;
                opacity: 0;
                transform: translateY(-5px);
            }
            to {
                max-height: 100px;
                opacity: 1;
                transform: translateY(0);
            }
        }
        @keyframes bm-shortcut-leave {
            from {
                opacity: 1;
                transform: scale(1);
            }
            to {
                opacity: 0;
                transform: scale(0.94);
            }
        }
        @media (prefers-reduced-motion: reduce) {
            #offerlist .bm-marketplace-offer.bm-offer-entering,
            #offerlist .row.collapse.bm-offer-reordering,
            .bm-link.bm-shortcut-leaving {
                animation: none;
            }
        }
        @media screen and (min-width: 1025px) {
            .bm-chart-controls {
                margin-bottom: 0.15rem !important;
            }
            .bm-offer-toolbar {
                min-height: 24px;
                margin: 0 0 0.15rem !important;
            }
        }
        #ol1st .bm-offer-toolbar + .row.collapse {
            margin-top: 0 !important;
        }
        @media screen and (max-width: 640px) {
            .bm-ean-overlay {
                align-items: stretch;
                padding: 0;
            }
            .bm-ean-dialog {
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                max-height: none;
                border-radius: 0;
            }
            .bm-ean-header {
                min-height: 64px;
                padding: max(11px, env(safe-area-inset-top)) 10px 10px 15px;
            }
            .bm-ean-title {
                font-size: 1.08rem;
            }
            .bm-ean-content {
                min-height: 0;
                padding: 16px max(12px, env(safe-area-inset-right))
                    max(16px, env(safe-area-inset-bottom))
                    max(12px, env(safe-area-inset-left));
            }
            .bm-ean-barcode {
                width: 100%;
                max-width: none;
                max-height: calc(100dvh - 110px);
            }
            #chartdiv2 {
                margin-bottom: 0.4rem !important;
            }
            #chartTrigger {
                min-width: 0;
                flex: 0 0 auto;
                margin-bottom: 0.35rem !important;
                padding-right: 0.65rem !important;
                padding-left: 0.65rem !important;
                font-size: 0.7rem !important;
                white-space: nowrap;
            }
            .bm-chart-controls {
                flex-wrap: nowrap;
                column-gap: 0.4rem;
            }
            .bm-chart-label-full {
                display: none;
            }
            .bm-chart-label-mobile {
                display: inline;
            }
            .bm-chart-best-price {
                min-width: 0;
                flex: 1 1 auto;
                margin-bottom: 0.35rem;
                font-size: 0.65rem;
            }
            .bm-offer-toolbar {
                margin: 0 0 0.15rem !important;
            }
            #wrap.bm-set-wrap {
                margin-bottom: -104px !important;
            }
            #wrap.bm-set-wrap > *:last-child {
                padding-bottom: 56px !important;
            }
            #footer.bm-compact-footer {
                height: 104px !important;
                min-height: 104px;
            }
            .bm-chart-overlay {
                padding: 0;
            }
            .bm-chart-dialog {
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                border-top-width: 4px;
                border-radius: 0;
            }
            .bm-chart-dialog-header {
                min-height: 0;
                flex-wrap: wrap;
                gap: 0.4rem;
                padding: calc(1.35rem + env(safe-area-inset-top, 0px)) 3.75rem 0.55rem 1rem;
            }
            .bm-chart-dialog-close {
                top: calc(0.85rem + env(safe-area-inset-top, 0px));
            }
            .bm-chart-dialog-title {
                width: 100%;
                font-size: 1rem;
            }
            .bm-chart-periods {
                width: 100%;
                flex-basis: 100%;
            }
            .bm-chart-dialog-content {
                padding: 0.75rem;
            }
        }
        .bm-discount-toolbar-control {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            justify-content: flex-end;
            width: auto;
            margin-top: 0;
            margin-left: auto;
            min-height: 21px;
        }
        .bm-discount-toolbar-control .switch {
            flex: 0 0 auto;
            margin: 0;
        }
        .bm-discount-toolbar-control .switch input {
            position: absolute;
            inset: 0;
            z-index: 2;
            display: block !important;
            width: 100%;
            height: 100%;
            margin: 0;
            opacity: 0;
            cursor: pointer;
        }
        .bm-discount-toolbar-label {
            color: #555;
            font-size: 0.8rem;
            font-weight: normal;
            line-height: 1.1;
        }
        .bm-discount-settings-trigger {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 30px;
            margin: 0 0 0 0.15rem !important;
            padding: 0 !important;
            background: transparent !important;
            border: 0 !important;
            border-radius: 0 !important;
            color: #666 !important;
            line-height: 1 !important;
        }
        .bm-discount-settings-trigger svg {
            display: block;
            width: 23px;
            height: 23px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .bm-discount-settings-trigger:hover,
        .bm-discount-settings-trigger:focus {
            background: transparent !important;
            color: #b00000 !important;
        }
        .bm-settings-overlay {
            position: fixed;
            inset: 0;
            z-index: 100050;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.64);
        }
        .bm-settings-overlay.is-open {
            display: flex;
            animation: bm-ean-fade-in 0.18s ease-out;
        }
        .bm-settings-dialog {
            width: min(40rem, 100%);
            max-height: calc(100vh - 2rem);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #fff;
            border: 0;
            border-top: 5px solid #b00;
            border-radius: 4px;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
            color: #333;
            animation: bm-ean-zoom-in 0.18s ease-out;
        }
        .bm-settings-header,
        .bm-settings-actions {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.8rem 1.25rem;
        }
        .bm-settings-header {
            justify-content: space-between;
            min-height: 64px;
            background: #fff;
            border-bottom: 1px solid #ddd;
            box-shadow: none !important;
            box-sizing: border-box;
        }
        .bm-settings-header h3 {
            margin: 0 !important;
            color: #333 !important;
            font-size: 1.25rem !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
            text-shadow: none !important;
        }
        .bm-settings-close {
            display: inline-flex !important;
            width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 4px !important;
            background: #f7eaea !important;
            color: #800 !important;
            font-size: 1.8rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
            text-shadow: none !important;
        }
        .bm-settings-close:hover,
        .bm-settings-close:focus {
            background: #b00 !important;
            color: #fff !important;
        }
        .bm-settings-body {
            flex: 1 1 auto;
            min-height: 0;
            overflow: auto;
            padding: 0 1rem;
        }
        .bm-settings-row {
            display: grid;
            grid-template-columns: minmax(7rem, 1fr) auto 6.5rem;
            align-items: center;
            gap: 0.75rem;
            min-height: 2.8rem;
            border-bottom: 1px solid #e5e5e5;
        }
        .bm-settings-row:last-child {
            border-bottom: 0;
        }
        .bm-settings-row label {
            margin: 0;
            color: #1f5fa8;
            font-size: 0.82rem;
            font-weight: normal;
        }
        .bm-settings-row input[type="number"] {
            width: 4.8rem;
            height: 2.15rem;
            margin: 0;
            padding: 0.3rem 0.4rem;
        }
        .bm-settings-percent {
            display: flex;
            align-items: center;
            gap: 0.3rem;
            white-space: nowrap;
        }
        .bm-settings-actions {
            justify-content: flex-end;
            background: #f3f3f3;
            border-top: 1px solid #ddd;
        }
        .bm-settings-actions .button {
            margin: 0 !important;
            border-radius: 1px !important;
        }
        .bm-settings-save {
            background: #b00000 !important;
            color: #fff !important;
        }
        @media screen and (max-width: 640px) {
            .bm-settings-overlay {
                align-items: stretch;
                padding: 0;
            }
            .bm-settings-dialog {
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                max-height: none;
                border-radius: 0;
            }
            .bm-settings-row {
                grid-template-columns: minmax(6rem, 1fr) auto 5.4rem;
                gap: 0.45rem;
            }
            .bm-settings-row input[type="number"] {
                width: 4rem;
            }
        }
    `;
    const globalStyle = document.createElement("style");
    globalStyle.textContent = globalCss;
    document.head.appendChild(globalStyle);

    const setNum = BM_getBrickmergeSetNumber(window.location.href);

    function removeThemePromoBlock() {
        const isThemePage = /^\/LEGO-[^/]+\/?$/i.test(window.location.pathname);
        const isFindPage = /(?:^|[?&])find=/.test(window.location.search);
        if (setNum || (!isThemePage && !isFindPage)) {
            return;
        }
        document.querySelectorAll('.small-12.medium-4.large-3.right').forEach(block => {
            const text = block.textContent || '';
            if (/Nur für Sparfüchse|Rabatt-Alarm|Deal-Alarm/i.test(text)) {
                block.remove();
            }
        });
    }

    removeThemePromoBlock();
    [400, 1200, 2500].forEach(delay => window.setTimeout(removeThemePromoBlock, delay));

    function setupSearchResultsFallback() {
        if (setNum) return;

        let searchTerm = '';
        try {
            searchTerm = (new URLSearchParams(window.location.search).get('find') || '')
                .replace(/\s+/g, ' ')
                .trim();
        } catch (error) {
            return;
        }
        if (!searchTerm) return;

        const normalize = value => String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const noExactResultsPattern = /es wurden keine exakten treffen gefunden/i;
        const bingMessagePattern = /alternativ haben wir mit bing nach passenden treffern gesucht/i;
        const findMessageNodes = () => Array.from(
            document.querySelectorAll('p, h1, h2, h3, h4, h5, div, span')
        ).filter(element => {
            const text = normalize(element.textContent);
            if (!noExactResultsPattern.test(text) && !bingMessagePattern.test(text)) {
                return false;
            }
            return !Array.from(element.children).some(child => {
                const childText = normalize(child.textContent);
                return noExactResultsPattern.test(childText) ||
                    bingMessagePattern.test(childText);
            });
        });
        const hasBrickmergeResults = () => Boolean(document.querySelector(
            '.slide[id^="set"][itemscope][itemtype*="Product"]'
        ));

        const luckyUrl = new URL('https://duckduckgo.com/');
        luckyUrl.searchParams.set(
            'q',
            `!ducky site:brickmerge.de ${searchTerm}`
        );

        const getBrickmergeTarget = rawUrl => {
            try {
                const target = new URL(rawUrl);
                return /^(?:www\.)?brickmerge\.de$/i.test(target.hostname) &&
                    !/(?:^|[?&])find=/i.test(target.search)
                    ? target.href
                    : '';
            } catch (error) {
                return '';
            }
        };

        const resolveLuckyTarget = () => new Promise(resolve => {
            requestWithGm({
                method: 'GET',
                url: luckyUrl.href,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7'
                },
                timeout: 10000,
                onload: response => {
                    const finalTarget = getBrickmergeTarget(
                        response.finalUrl || ''
                    );
                    if (finalTarget) {
                        resolve(finalTarget);
                        return;
                    }
                    const html = String(response.responseText || '');
                    const encodedTarget = html.match(
                        /[?&]uddg=([^&'"<>\s]+)/i
                    )?.[1] || '';
                    let decodedTarget = '';
                    try {
                        decodedTarget = decodeURIComponent(encodedTarget);
                    } catch (error) {
                        // An invalid result is handled like a missing result.
                    }
                    resolve(getBrickmergeTarget(decodedTarget));
                },
                onerror: () => resolve(''),
                ontimeout: () => resolve('')
            });
        });

        let applied = false;
        const apply = () => {
            if (applied) return true;
            const messageNodes = findMessageNodes();
            if (messageNodes.length === 0 && hasBrickmergeResults()) return false;

            applied = true;
            void resolveLuckyTarget().then(target => {
                if (target) window.location.replace(target);
            });
            return true;
        };

        if (apply()) return;

        const observer = new MutationObserver(() => {
            if (apply()) observer.disconnect();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        window.setTimeout(() => observer.disconnect(), 10000);
    }

    if (BM_SETTINGS.luckyFallback) {
        if (document.readyState !== 'loading') setupSearchResultsFallback();
        else window.addEventListener('DOMContentLoaded', setupSearchResultsFallback, { once: true });
    }

    function createMetaGptTransferId() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function createMetaGptSearchPrompt(setNumber) {
        const heading = document.querySelector('h1')?.textContent || '';
        const title = heading
            .replace(/[\u00AE\u2122]/g, '')
            .replace(/\s+/g, ' ')
            .trim() || `LEGO ${setNumber}`;
        return [
            `Suche aktuelle Verkaufsangebote für ${title}.`,
            'Berücksichtige relevante Angebote für Neuware in OVP von gewerblichen Händlern und privaten Verkäufern; Angebote von Privatverkäufern sind ausdrücklich erlaubt.',
            'Gib ausschließlich eine Markdown-Tabelle mit den Spalten Plattform, Angebot, Artikelpreis, Versandkosten, Gesamtpreis und Link aus.',
            'Nenne bei jedem Angebot die Plattform und die Versandkosten einzeln; falls Versandkosten nicht angegeben sind, schreibe "unbekannt".',
            'Keine Einleitung, Erklärungen, Zusammenfassung oder sonstigen Texte außerhalb der Tabelle.'
        ].join(' ');
    }

    function setupMetaGptLink(container) {
        const link = container.querySelector('a[data-bmid="btn-meta-gpt"]');
        if (!link || link.dataset.bmMetaGptReady === 'true') return;
        link.dataset.bmMetaGptReady = 'true';
        link.dataset.bmMetaGptLink = 'true';
        link.title = 'Set im Meta-Preisvergleich-GPT suchen';

        link.addEventListener('click', event => {
            event.preventDefault();
            if (!setNum) return;

            const prompt = createMetaGptSearchPrompt(setNum);
            const transfer = {
                id: createMetaGptTransferId(),
                prompt,
                createdAt: Date.now()
            };

            try {
                GM_setClipboard(prompt, 'text');
            } catch (error) {
                navigator.clipboard?.writeText(prompt).catch(() => {});
            }
            void setMetaGptValue(META_GPT_PENDING_KEY, transfer);

            const label = link.closest('.bm-meta-dual-link')
                ?.querySelector('.bm-link-label');
            const defaultLabel = link.dataset.bmDefaultLabel ||
                label?.textContent ||
                'Meta';
            if (label) label.textContent = 'Wird geöffnet';
            window.open(META_GPT_URL, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => {
                if (label) label.textContent = defaultLabel;
            }, 1400);
        });
    }

    const initialSetUvp = (() => {
        const candidates = document.querySelectorAll(
            '.stroke[title*="unverbindliche Preisempfehlung"], [title="unverbindliche Preisempfehlung"]'
        );
        for (const candidate of candidates) {
            const match = candidate.textContent.match(/(\d+[\d\s.,]*)\s*€/);
            if (!match) continue;
            const value = parseFloat(
                match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
            );
            if (Number.isFinite(value) && value > 0) return value;
        }
        return null;
    })();
    let resolvedSetUvp = initialSetUvp;

    function parseHistoricalBestPriceText(rawText) {
        const text = String(rawText || '').replace(/\s+/g, ' ').trim();
        if (!/(?:bisheriger\s+bestpreis|all-time-bestpreis)/i.test(text)) return null;

        const priceMatch = text.match(/(\d+[\d\s.,]*)\s*€/i);
        if (!priceMatch) return null;

        const priceLabel = `${priceMatch[1].trim()} €`;
        const price = parseFloat(
            priceMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
        );
        if (!Number.isFinite(price) || price <= 0) return null;

        const afterPriceText = text.slice(
            text.indexOf(priceMatch[0]) + priceMatch[0].length
        ).replace(/\s+/g, ' ').trim();
        const detailSuffix = afterPriceText
            .replace(/^[:|,-]?\s*/, '')
            .trim();

        return {
            text,
            price,
            priceLabel,
            detailSuffix
        };
    }

    function renameHistoricalBestPriceLabel() {
        const root = document.querySelector(
            '.content.setdetails .productprice'
        );
        if (!root) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (/bisheriger bestpreis/i.test(node.nodeValue || '')) {
                nodes.push(node);
            }
        }
        nodes.forEach(textNode => {
            textNode.nodeValue = textNode.nodeValue.replace(
                /bisheriger bestpreis/gi,
                'All-Time-Bestpreis'
            );
        });
    }

    let nativeChartHistoricalBestPriceInfo = null;

    function removeRelativeDayLabelsFromBestPriceLines(root = null) {
        const scanRoot = root ||
            document.querySelector('.content.setdetails .productprice') ||
            document.querySelector('.content.setdetails');
        if (!scanRoot) return;

        const walker = document.createTreeWalker(
            scanRoot,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('#bm-price-chart-overlay, #chartWrapper, #bigChart, #chartContainer, #offerlist')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (!/vor\s+\d+\s+Tagen\b/i.test(node.nodeValue || '')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        const nodes = [];
        let node;
        while (node = walker.nextNode()) nodes.push(node);
        nodes.forEach(textNode => {
            textNode.nodeValue = textNode.nodeValue
                .replace(/\s+vor\s+\d+\s+Tagen\b/gi, '');
        });
    }

    function findHistoricalBestPriceSidebarTextNode(seedElement = null) {
        const roots = [];
        const seedRoot = seedElement?.closest?.('p, div, li');
        if (seedRoot) roots.push(seedRoot);

        const detailsRoot = document.querySelector('.content.setdetails');
        if (detailsRoot && !roots.includes(detailsRoot)) roots.push(detailsRoot);
        roots.push(document.body);

        for (const root of roots.filter(Boolean)) {
            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        const parent = node.parentElement;
                        if (!parent) return NodeFilter.FILTER_REJECT;
                        if (!/(?:bisheriger\s+bestpreis|all-time-bestpreis)/i.test(node.nodeValue || '')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (parent.closest('#bm-price-chart-overlay, #chartWrapper, #bigChart, #chartContainer')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (parent.closest('#all-time-bestpreis-discount')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            const match = walker.nextNode();
            if (match) return match;
        }

        return null;
    }

    function writeHistoricalBestPriceDetailToSidebar(detailSuffix, seedElement = null) {
        const suffix = String(detailSuffix || '').replace(/\s+/g, ' ').trim();
        const existingDetails = Array.from(document.querySelectorAll(
            '.bm-historical-bestprice-detail'
        ));
        if (!suffix) {
            existingDetails.forEach(element => element.remove());
            return;
        }

        const textNode = findHistoricalBestPriceSidebarTextNode(seedElement);
        const parent = textNode?.parentElement;
        if (!textNode || !parent) return;
        removeRelativeDayLabelsFromBestPriceLines(parent);

        const expectedText = ` ${suffix}`;
        const existing = existingDetails.find(element =>
            element.parentElement === parent
        );
        existingDetails.forEach(element => {
            if (element !== existing) element.remove();
        });
        if (existing) {
            if (existing.textContent !== expectedText) {
                existing.textContent = expectedText;
            }
            return;
        }

        const lineNodes = Array.from(parent.childNodes);
        const startIndex = lineNodes.indexOf(textNode);
        let lineText = '';
        for (let index = Math.max(0, startIndex); index < lineNodes.length; index += 1) {
            const node = lineNodes[index];
            if (index > startIndex && node.nodeName === 'BR') break;
            lineText += node.textContent || '';
        }
        lineText = lineText.replace(/\s+/g, ' ').trim();
        if (lineText.includes(suffix)) return;

        const detail = document.createElement('span');
        detail.className = 'bm-historical-bestprice-detail';
        detail.textContent = expectedText;

        const insertBefore = lineNodes
            .slice(startIndex + 1)
            .find(node => node.nodeName === 'BR') || null;
        parent.insertBefore(detail, insertBefore);
    }

    function createDiscountSettingsUI() {
        if (!BM_SETTINGS.priceCalculations || !setNum) return;

        const offerlist = document.getElementById('offerlist');
        if (offerlist?.querySelector('.bm-offer-toolbar')) return;

        // Die Angebotsliste kann von Brickmerge oder nach einem Marktplatzabruf
        // neu aufgebaut werden. Dann ist die Toolbar weg, während der außerhalb
        // der Liste liegende Dialog noch existiert. Beides gemeinsam neu anlegen,
        // damit „Persönlicher Rabatt“ nicht dauerhaft verschwindet.
        document.getElementById('bm-discount-settings')?.remove();
        document.body.style.removeProperty('overflow');

        const firstOffer = offerlist?.querySelector('.row.collapse');
        if (!offerlist || !firstOffer?.parentElement) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'bm-offer-toolbar';
        toolbar.innerHTML = `
            <div class="bm-discount-toolbar-control">
                <label class="switch" title="Persönlichen Rabatt ein- oder ausschalten">
                    <input id="bm-personal-enabled" type="checkbox"
                           aria-label="Persönlichen Rabatt verwenden">
                    <div class="slider round"></div>
                </label>
                <span class="bm-discount-toolbar-label">Persönlicher Rabatt</span>
                <button type="button" class="bm-discount-settings-trigger"
                        aria-haspopup="dialog" aria-controls="bm-discount-settings"
                        title="Persönlichen Rabatt einstellen"
                        aria-label="Persönlichen Rabatt einstellen">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="21" x2="14" y1="4" y2="4"></line>
                        <line x1="10" x2="3" y1="4" y2="4"></line>
                        <line x1="21" x2="12" y1="12" y2="12"></line>
                        <line x1="8" x2="3" y1="12" y2="12"></line>
                        <line x1="21" x2="16" y1="20" y2="20"></line>
                        <line x1="12" x2="3" y1="20" y2="20"></line>
                        <line x1="14" x2="14" y1="2" y2="6"></line>
                        <line x1="8" x2="8" y1="10" y2="14"></line>
                        <line x1="16" x2="16" y1="18" y2="22"></line>
                    </svg>
                </button>
            </div>
        `;
        firstOffer.parentElement.insertBefore(toolbar, firstOffer);
        const loadingIndicator = document.getElementById('bm-offerlist-loading');
        if (loadingIndicator) toolbar.prepend(loadingIndicator);

        const overlay = document.createElement('div');
        overlay.id = 'bm-discount-settings';
        overlay.className = 'bm-settings-overlay';
        overlay.innerHTML = `
            <div class="bm-settings-dialog" role="dialog" aria-modal="true"
                 aria-labelledby="bm-settings-title">
                <div class="bm-settings-header">
                    <h3 id="bm-settings-title">Persönlicher Rabatt</h3>
                    <button type="button" class="bm-settings-close"
                            title="Schließen" aria-label="Schließen">×</button>
                </div>
                <div class="bm-settings-body"></div>
                <div class="bm-settings-actions">
                    <button type="button" class="button secondary bm-settings-reset">
                        Standardwerte
                    </button>
                    <button type="button" class="button bm-settings-save">
                        Speichern
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const body = overlay.querySelector('.bm-settings-body');
        const escapeHtml = value => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const populate = settings => {
            body.innerHTML = '';
            getRetailerCatalog().forEach(([key, discount], index) => {
                const row = document.createElement('div');
                const checkboxId = `bm-retailer-enabled-${index}`;
                const percentId = `bm-retailer-percent-${index}`;
                const label = discount.label || key;
                row.className = 'bm-settings-row';
                row.dataset.key = key;
                row.innerHTML = `
                    <label for="${checkboxId}">${escapeHtml(label)}</label>
                    <input id="${checkboxId}" class="bm-settings-enabled"
                           type="checkbox" aria-label="${escapeHtml(label)} aktivieren">
                    <div class="bm-settings-percent">
                        <input id="${percentId}" class="bm-settings-rate" type="number"
                               min="0" max="100" step="0.01"
                               aria-label="Rabatt für ${escapeHtml(label)}">
                        <span>%</span>
                    </div>
                `;
                body.appendChild(row);

                const setting = settings.retailers[key];
                const enabledInput = row.querySelector('.bm-settings-enabled');
                const rateInput = row.querySelector('.bm-settings-rate');
                enabledInput.checked = setting?.enabled === true;
                rateInput.value = String(setting?.percent ?? 0);
                rateInput.disabled = !enabledInput.checked;
                enabledInput.addEventListener('change', () => {
                    rateInput.disabled = !enabledInput.checked;
                });
            });

            body.scrollTop = 0;
        };

        const close = () => {
            overlay.classList.remove('is-open');
            document.body.style.removeProperty('overflow');
            toolbar.querySelector('.bm-discount-settings-trigger')?.focus();
        };

        const open = () => {
            populate(loadPersonalDiscountSettings());
            overlay.classList.add('is-open');
            document.body.style.setProperty('overflow', 'hidden');
            overlay.querySelector('.bm-settings-close')?.focus();
        };

        const personalEnabledInput = toolbar.querySelector('#bm-personal-enabled');
        personalEnabledInput.checked = loadPersonalDiscountSettings().enabled !== false;
        personalEnabledInput.addEventListener('change', () => {
            const settings = loadPersonalDiscountSettings();
            settings.enabled = personalEnabledInput.checked;
            savePersonalDiscountSettings(settings);
            document.querySelectorAll('#offerlist .pricerow[data-bm-discount-applied]')
                .forEach(row => {
                    delete row.dataset.bmDiscountApplied;
                });
            applyOfferPresentation();
        });

        toolbar.querySelector('.bm-discount-settings-trigger').addEventListener('click', open);
        overlay.querySelector('.bm-settings-close').addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
        overlay.querySelector('.bm-settings-reset').addEventListener('click', () => {
            populate(getDefaultPersonalDiscountSettings());
        });
        overlay.querySelector('.bm-settings-save').addEventListener('click', () => {
            const previousSettings = loadPersonalDiscountSettings();
            const settings = {
                enabled: personalEnabledInput.checked,
                retailers: { ...previousSettings.retailers }
            };
            overlay.querySelectorAll('.bm-settings-row').forEach(row => {
                const rawPercent = Number(row.querySelector('.bm-settings-rate').value);
                settings.retailers[row.dataset.key] = {
                    enabled: row.querySelector('.bm-settings-enabled').checked,
                    percent: Number.isFinite(rawPercent)
                        ? Math.min(100, Math.max(0, rawPercent))
                        : 0
                };
            });
            // Alte getrennte eBay-Einträge nicht weiter mitschleppen: ab jetzt
            // ist ausschließlich settings.retailers.ebay maßgeblich.
            Object.keys(settings.retailers)
                .filter(key => key !== 'ebay' && /ebay/i.test(key))
                .forEach(key => delete settings.retailers[key]);
            savePersonalDiscountSettings(settings);
            document.querySelectorAll('#offerlist .pricerow[data-bm-discount-applied]')
                .forEach(row => {
                    delete row.dataset.bmDiscountApplied;
                });
            applyOfferPresentation();
            close();
        });
    }

    // ==========================================
    // 1. CLEANER MODUL
    // ==========================================

    // 1a. Deal-Score und „Ist … ein guter Deal?“ entfernen (läuft auf ALLEN Seiten)
    if (BM_SETTINGS.cleaner) {
        document.querySelectorAll('.dealheat').forEach(el => {
            let next = el.nextElementSibling;
            el.remove();
            if (next && next.tagName === 'H2' && next.textContent.includes('ein guter Deal')) {
                let afterH2 = next.nextElementSibling;
                next.remove();
                if (afterH2 && afterH2.tagName === 'P') {
                    let afterP = afterH2.nextElementSibling;
                    afterH2.remove();
                    if (afterP && afterP.tagName === 'UL') afterP.remove();
                }
            }
        });
    }

    // 1b. Cleaner (nur auf Detailseiten)
    function cleaner() {
        const short = document.getElementById('short'); if (short) short.remove();
        document.querySelectorAll('section').forEach(section => {
            const p = section.querySelector('p');
            if (p && p.textContent.trim() === 'Inhaltsverzeichnis') {
                let next = section.nextElementSibling;
                section.remove();
                if (next && next.tagName === 'SECTION' && next.querySelector('span[itemprop="description"]')) next.remove();
            }
        });
        // Die Bauanleitungsüberschrift ausblenden, den Inhalt und die Links aber
        // beibehalten.
        document.querySelectorAll('h3').forEach(h3 => {
            if (h3.id === 'Bauanleitung' || /\bBauanleitungen?\b/i.test(h3.textContent)) {
                h3.remove();
            }
        });
        document.querySelectorAll('a, button').forEach(element => {
            if (!/^\s*Zur\s+LEGO\s+Seite\s*$/i.test(element.textContent || '')) {
                return;
            }
            const parent = element.parentElement;
            element.remove();
            if (
                parent &&
                parent !== document.body &&
                parent.children.length === 0 &&
                !parent.textContent.replace(/\|/g, '').trim()
            ) {
                parent.remove();
            }
        });

        // Verwaiste Anker-IDs entfernen: Diese id-Attribute dienten ausschließlich
        // als Sprungziel für die oben entfernte Inhaltsverzeichnis-Box und werden
        // sonst nirgends verlinkt. #moreimages und #offerlist bewusst NICHT
        // anfassen - die werden noch von den "mehr Bilder"-Links bzw. den
        // Bestpreis-Verweisen im Fließtext gebraucht.
        ['Bauanleitung', 'Einzelteileliste', 'Beschreibung'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.removeAttribute('id');
        });
        document.querySelectorAll('div.row.collapse').forEach(div => {
            const h3 = div.querySelector('h3');
            if (h3 && h3.textContent.trim() === 'Bei ebay kaufen:') {
                let prev = div.previousElementSibling;
                if (prev && prev.tagName === 'P' && prev.textContent.includes('Als Mitglieder vom Amazon Partnerprogramm')) prev.remove();
                div.remove();
            }
        });
        document.querySelectorAll('div.small-12.columns.small').forEach(div => {
            if (div.innerHTML.includes('/img/bm_tg_deals.png') && div.textContent.includes('Telegram')) div.remove();
        });
        const alarm = document.getElementById('alarm'); if (alarm) alarm.remove();
        document.querySelectorAll('div.offerbox').forEach(box => box.remove());
        const feedback = document.getElementById('feedback'); if (feedback) feedback.remove();
        document.querySelectorAll('p').forEach(p => {
            if (p.textContent.includes('Als Mitglieder vom Amazon Partnerprogramm')) p.remove();
        });
        document.querySelectorAll('h3').forEach(h3 => {
            if (h3.textContent.trim().startsWith('Wo kann man') || h3.textContent.includes('aktuell verfügbar')) {
                let p = h3.nextElementSibling;
                h3.remove();
                if (p && p.tagName === 'P') p.remove();
            }
        });
        const productrow = document.getElementById('productrowcontainer');
        if (productrow) productrow.remove();
        let firstH2 = null;
        document.querySelectorAll('h2').forEach(h2 => {
            if (!firstH2 && h2.textContent.toLowerCase().includes('preisvergleich')) firstH2 = h2;
        });
        if (firstH2) firstH2.remove();

        // "> zum Shop!" Link/Button im Top-Angebot entfernen
        document.querySelectorAll('a, button, span').forEach(el => {
            if (el.textContent.trim() === '> zum Shop!' || el.textContent.trim() === '» zum Shop!' || el.textContent.trim() === 'zum Shop!') {
                el.remove();
            }
        });
        document.querySelectorAll('.topprice').forEach(topPrice => {
            const label = topPrice.previousElementSibling;
            if (label?.tagName === 'P' && /^Top-Angebot:\s*$/i.test(label.textContent.trim())) {
                label.textContent = 'Brickmerge-Bestpreis:';
            }
        });

        const offerlist = document.getElementById('offerlist');
        if (offerlist) {
            offerlist.querySelectorAll('img').forEach(img => {
                if (img.src.includes('/img/info_') || img.src.includes('info_shopfilter') || img.src.includes('info_shoplink') || img.src.includes('info_bricklink_history') || img.alt?.toLowerCase().includes('hier klicken')) {
                    let container = img.closest('.columns') || img.closest('.row') || img.closest('div') || img.parentElement;
                    if (container && container !== offerlist) container.remove();
                    else img.remove();
                }
            });
            offerlist.querySelectorAll('*').forEach(el => {
                if (el.textContent?.toLowerCase().includes('hier klicken')) {
                    if (el.querySelector('img[src*="/img/info_"]') || el.innerHTML.includes('info_') || el.textContent.includes('Preisübersicht') || el.textContent.includes('scrollen')) el.remove();
                }
            });
            offerlist.querySelectorAll('a.button').forEach(a => {
                if (a.textContent.includes('Verfügbarkeit bei LEGO') || a.textContent.includes('Hier die Verfügbarkeit bei LEGO prüfen')) a.remove();
            });

            // "> Hier zu X!"-Spalte entfernen (reiner Duplikat-Link, der Preis selbst
            // ist ja bereits verlinkt). Nur die .goto.medium-7-Textspalte betrifft das,
            // NICHT die .goto.medium-1-Logospalte, die bleibt erhalten.
            offerlist.querySelectorAll('.goto.medium-7').forEach(el => el.remove());
        }
        removeSidebarHistoryLinks();
        // Hinweis: der frühere Selektor für einen einzelnen <span> im Breadcrumb-Bereich
        // (body > section > div:nth-child(2) > ...) wurde entfernt, da er auf der
        // aktuellen Seitenstruktur nicht mehr matcht (totes Selektor-Ziel).
        document.querySelectorAll('img').forEach(img => {
            if (img.src.includes('/img/info_') || img.alt?.toLowerCase().includes('hier klicken') || img.title?.toLowerCase().includes('hier klicken')) {
                let parent = img.parentElement;
                while (parent && parent !== document.body) {
                    if (parent.classList.contains('columns') || parent.classList.contains('row') || (parent.tagName === 'DIV' && parent.children.length <= 2)) {
                        parent.remove(); break;
                    }
                    parent = parent.parentElement;
                }
                if (parent === document.body) img.remove();
            }
        });
        const showmoreSpan = document.querySelector('#ol1st > section:nth-child(1) > p > span.showmore');
        if (showmoreSpan) showmoreSpan.remove();
        document.querySelectorAll('span.showmore').forEach(span => span.remove());

        // Toggle-Schalter ("Versandkosten berücksichtigen"-Checkbox) entfernen
        const toggleForm = document.querySelector('form[name="sctoggle"]');
        const toggleFormWrapper = toggleForm ? toggleForm.closest('div') : null;
        if (toggleFormWrapper) toggleFormWrapper.remove();

        // Zeile mit dem Link "Versandkosten (soweit bekannt) berücksichtigen" und
        // dem "Preisfehler melden"-Button entfernen
        document.querySelectorAll('p').forEach(p => {
            if (p.textContent.includes('Versandkosten') && p.textContent.includes('berücksichtigen') && p.querySelector('a[href*="shippingcosts="]')) {
                const wrapperDiv = p.closest('div');
                if (wrapperDiv) wrapperDiv.remove();
                else p.remove();
            }
        });
    }

    if (setNum && BM_SETTINGS.cleaner) cleaner();
    document.documentElement.classList.remove('bm-extension-preclean');

    function removeSidebarHistoryLinks() {
        const historyLinkPattern = /^\s*Zur\s+(?:ebay|bricklink)\s+History\s*$/i;
        const roots = [
            document.querySelector('.content.setdetails .productprice'),
            document.getElementById('ol2nd'),
            document.querySelector('.content.setdetails .bm-detail-right')
        ].filter(Boolean);

        roots.forEach(root => {
            Array.from(root.querySelectorAll('a'))
                .filter(link => historyLinkPattern.test(link.textContent || ''))
                .forEach(link => {
                    const parent = link.parentElement;
                    [link.previousSibling, link.nextSibling].forEach(node => {
                        if (
                            node?.nodeType === Node.TEXT_NODE &&
                            /^\s*\|?\s*$/.test(node.nodeValue || '')
                        ) {
                            node.remove();
                        }
                    });
                    link.remove();

                    if (
                        parent &&
                        parent !== root &&
                        parent.children.length === 0 &&
                        !parent.textContent.replace(/\|/g, '').trim()
                    ) {
                        parent.remove();
                    }
                });
        });
    }

    // Auf Desktop werden die Brickmerge-Push/Pull-Spalten in ein echtes Grid
    // überführt: links Bild/Chart und direkt darunter die Offerlist, rechts
    // Produktdaten, EAN, Bauanleitungen und Einzelteilelisten.
    function setupDesktopDetailGrid() {
        if (!window.matchMedia('(min-width: 1025px)').matches) return;

        const container = document.querySelector('.content.setdetails');
        const offerList = document.getElementById('offerlist');
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const productPriceColumn = container?.querySelector('.productprice');
        const chartColumn = container?.querySelector('.medium-8.medium-pull-4.columns');
        if (
            !container ||
            !offerList ||
            !offerColumn ||
            !sideColumn ||
            !productPriceColumn ||
            !chartColumn
        ) {
            return;
        }

        let layout = container.querySelector(':scope > .bm-detail-layout');
        let leftColumn = layout?.querySelector(':scope > .bm-detail-left');
        let rightColumn = layout?.querySelector(':scope > .bm-detail-right');

        const originalProductRow = productPriceColumn.closest('.row') ||
            chartColumn.closest('.row');

        if (!layout || !leftColumn || !rightColumn) {
            layout = document.createElement('div');
            layout.className = 'bm-detail-layout';
            leftColumn = document.createElement('div');
            leftColumn.className = 'bm-detail-left';
            rightColumn = document.createElement('div');
            rightColumn.className = 'bm-detail-right';
            layout.append(leftColumn, rightColumn);
            const directChildReference = [originalProductRow, offerList]
                .map(element => {
                    let candidate = element;
                    while (candidate && candidate.parentElement !== container) {
                        candidate = candidate.parentElement;
                    }
                    return candidate?.parentElement === container ? candidate : null;
                })
                .find(Boolean);
            container.insertBefore(layout, directChildReference || null);
        }

        chartColumn.classList.add('bm-detail-chart-column');
        productPriceColumn.classList.add('bm-detail-price-column');
        sideColumn.classList.add('bm-detail-side-column');

        if (chartColumn.parentElement !== leftColumn) {
            leftColumn.appendChild(chartColumn);
        }
        if (offerList.parentElement !== leftColumn) {
            leftColumn.appendChild(offerList);
        }
        if (productPriceColumn.parentElement !== rightColumn) {
            rightColumn.appendChild(productPriceColumn);
        }
        if (sideColumn.parentElement !== rightColumn) {
            rightColumn.appendChild(sideColumn);
        }

        if (
            originalProductRow &&
            originalProductRow !== layout &&
            originalProductRow.parentElement &&
            originalProductRow.childElementCount === 0
        ) {
            originalProductRow.remove();
        }
    }

    // Auf Desktop liegt die Angebotsliste in derselben Unterspalte wie das
    // Preisdiagramm. Die zusätzlichen Bilder beginnen links direkt unter dem
    // großen Produktbild und beeinflussen die Offerlist-Höhe nicht.
    function setupDesktopOfferGallery() {
        if (!window.matchMedia('(min-width: 1025px)').matches) return;

        const offerList = document.getElementById('offerlist');
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const imageColumn = document.querySelector(
            '.content.setdetails .medium-8.medium-pull-4.columns ' +
            '> .row.collapse > .large-3.medium-4.columns.hide-for-small'
        );
        const chartContentColumn = imageColumn
            ?.parentElement
            ?.querySelector(':scope > .large-9.medium-8.columns') ||
            imageColumn?.nextElementSibling;
        if (!offerList || !offerColumn || !sideColumn || !imageColumn ||
            !chartContentColumn) return;

        const firstPriceRow = offerColumn.querySelector('.pricerow');
        const firstOfferRow = firstPriceRow?.closest('.row.collapse');
        const offerSection = firstPriceRow?.closest('section') ||
            (
                firstOfferRow?.parentElement &&
                firstOfferRow.parentElement !== offerColumn
                    ? firstOfferRow.parentElement
                    : null
            );
        const sourceLinks = Array.from(
            sideColumn.querySelectorAll('a.fancybox')
        ).filter(link => link.querySelector('img.gallerieIco'));

        chartContentColumn.classList.add('bm-chart-content-column');
        if (offerList.parentElement !== chartContentColumn) {
            chartContentColumn.appendChild(offerList);
        }
        offerList.classList.add('bm-offer-under-chart');
        offerColumn.classList.add('bm-offer-layout');
        offerSection?.classList.add('bm-offer-section');
        offerSection?.querySelectorAll(':scope > p').forEach(paragraph => {
            const hasEmbeddedContent = paragraph.querySelector(
                'a, button, input, select, textarea, img, svg, iframe, video'
            );
            if (!hasEmbeddedContent && !paragraph.textContent.trim()) {
                paragraph.remove();
            }
        });
        imageColumn.classList.add('bm-product-gallery-host');

        const mainImageLink = imageColumn.querySelector(':scope > a.fancybox');
        const mainImage = mainImageLink?.querySelector('img');
        mainImageLink?.classList.add('bm-unified-gallery-link');
        mainImage?.classList.add('bm-unified-gallery-image');

        const sourceTitle = sideColumn.querySelector('h3.more_images');
        sourceTitle?.classList.add('bm-gallery-source');
        sourceLinks.forEach(link => link.classList.add('bm-gallery-source'));

        let gallery = imageColumn.querySelector(':scope > .bm-offer-gallery');
        if (sourceLinks.length > 0 && !gallery) {
            gallery = document.createElement('aside');
            gallery.className = 'bm-offer-gallery';
            gallery.setAttribute('aria-label', 'Weitere Produktbilder');

            const list = document.createElement('div');
            list.className = 'bm-offer-gallery-list';
            sourceLinks.forEach((sourceLink, index) => {
                const sourceImage = sourceLink.querySelector('img.gallerieIco');
                const link = document.createElement('a');
                link.className =
                    'bm-offer-gallery-link bm-unified-gallery-link';
                link.href = sourceLink.href;
                link.rel = sourceLink.rel || 'group1';
                link.title = sourceLink.title || `Produktbild ${index + 1} öffnen`;
                link.dataset.index = sourceLink.dataset.index || String(index + 1);
                if (sourceLink.dataset.size) link.dataset.size = sourceLink.dataset.size;
                link.addEventListener('click', event => {
                    event.preventDefault();
                    sourceLink.click();
                });

                const image = sourceImage.cloneNode(true);
                image.removeAttribute('width');
                image.removeAttribute('height');
                image.removeAttribute('style');
                image.loading = 'lazy';
                image.alt = sourceImage.alt || `Produktbild ${index + 1}`;
                image.classList.add('bm-unified-gallery-image');
                link.appendChild(image);
                list.appendChild(link);
            });

            gallery.appendChild(list);
            imageColumn.appendChild(gallery);
        }

        const videoBlocks = Array.from(sideColumn.querySelectorAll(
            '.flex-video, iframe[src*="youtube"], iframe[src*="youtu"], ' +
            'iframe[src*="vimeo"], iframe[data-src*="youtube"], ' +
            'iframe[data-src*="youtu"], iframe[data-src*="vimeo"], ' +
            'iframe[data-lazy-src*="youtube"], iframe[data-lazy-src*="youtu"], ' +
            'iframe[data-lazy-src*="vimeo"], video, a[href*="youtube.com"], ' +
            'a[href*="youtu.be"], a[href*="vimeo.com"]'
        )).map(element => {
            if (element.dataset.bmVideoMoved === 'true') return null;
            return element.closest('.flex-video') ||
                element.closest('p') ||
                element.closest('li') ||
                element.closest('div') ||
                element;
        }).filter((element, index, elements) =>
            element &&
            element !== sideColumn &&
            !element.closest('.bm-offer-videos') &&
            elements.indexOf(element) === index
        );
        if (videoBlocks.length === 0) return;

        let videos = imageColumn.querySelector(':scope > .bm-offer-videos');
        if (!videos) {
            videos = document.createElement('aside');
            videos.className = 'bm-offer-videos';
            videos.setAttribute('aria-label', 'Videos');
        }
        if (gallery && videos.previousElementSibling !== gallery) {
            gallery.after(videos);
        } else if (!gallery && videos.parentElement !== imageColumn) {
            imageColumn.appendChild(videos);
        }
        Array.from(sideColumn.querySelectorAll('h3, h4'))
            .filter(heading => /video/i.test(heading.textContent || ''))
            .forEach(heading => heading.classList.add('bm-video-source'));

        videoBlocks.forEach(block => {
            block.dataset.bmVideoMoved = 'true';
            block.querySelectorAll('iframe').forEach(frame => {
                const lazySource = frame.getAttribute('src') ||
                    frame.getAttribute('data-src') ||
                    frame.getAttribute('data-lazy-src');
                if (!frame.getAttribute('src') && lazySource) {
                    frame.setAttribute('src', lazySource);
                }
                frame.setAttribute('loading', 'lazy');
                frame.setAttribute('allowfullscreen', 'true');
            });
            const links = block.matches('a[href]')
                ? [block]
                : Array.from(block.querySelectorAll('a[href]'));
            links.forEach(link => {
                if (/youtu|youtube|vimeo/i.test(link.href)) {
                    link.classList.add('bm-offer-video-link');
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                }
            });
            videos.appendChild(block);
        });
    }

    function buildEan13Barcode(ean) {
        if (!/^\d{13}$/.test(ean)) return null;

        const leftOdd = [
            '0001101', '0011001', '0010011', '0111101', '0100011',
            '0110001', '0101111', '0111011', '0110111', '0001011'
        ];
        const leftEven = [
            '0100111', '0110011', '0011011', '0100001', '0011101',
            '0111001', '0000101', '0010001', '0001001', '0010111'
        ];
        const right = [
            '1110010', '1100110', '1101100', '1000010', '1011100',
            '1001110', '1010000', '1000100', '1001000', '1110100'
        ];
        const parity = [
            'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
            'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
        ];
        const digits = Array.from(ean, Number);
        let bars = '101';
        for (let index = 1; index <= 6; index += 1) {
            bars += parity[digits[0]][index - 1] === 'L'
                ? leftOdd[digits[index]]
                : leftEven[digits[index]];
        }
        bars += '01010';
        for (let index = 7; index <= 12; index += 1) {
            bars += right[digits[index]];
        }
        bars += '101';

        const namespace = 'http://www.w3.org/2000/svg';
        const quietZone = 12;
        const svg = document.createElementNS(namespace, 'svg');
        svg.classList.add('bm-ean-barcode');
        svg.setAttribute('viewBox', '0 0 119 94');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `EAN ${ean}`);
        svg.style.shapeRendering = 'crispEdges';

        const background = document.createElementNS(namespace, 'rect');
        background.setAttribute('width', '119');
        background.setAttribute('height', '94');
        background.setAttribute('fill', '#fff');
        svg.appendChild(background);

        Array.from(bars).forEach((bar, index) => {
            if (bar !== '1') return;
            const isGuard = index < 3 ||
                (index >= 45 && index < 50) || index >= 92;
            const rect = document.createElementNS(namespace, 'rect');
            rect.setAttribute('x', String(quietZone + index));
            rect.setAttribute('y', '4');
            rect.setAttribute('width', '1');
            rect.setAttribute('height', isGuard ? '70' : '64');
            rect.setAttribute('fill', '#000');
            svg.appendChild(rect);
        });

        const label = document.createElementNS(namespace, 'text');
        label.setAttribute('x', '59.5');
        label.setAttribute('y', '89');
        label.setAttribute('fill', '#111');
        label.setAttribute('font-family', 'Arial, sans-serif');
        label.setAttribute('font-size', '10');
        label.setAttribute('letter-spacing', '1.1');
        label.setAttribute('text-anchor', 'middle');
        label.textContent = ean;
        svg.appendChild(label);
        return svg;
    }

    function cloneBarcodeGraphic(ean) {
        const sourceRoot = document.getElementById('barcode');
        const source = sourceRoot?.matches?.('canvas, svg, img')
            ? sourceRoot
            : sourceRoot?.querySelector?.('canvas, svg, img');

        if (source instanceof HTMLCanvasElement && source.width > 0) {
            try {
                const image = document.createElement('img');
                image.className = 'bm-ean-barcode';
                image.src = source.toDataURL('image/png');
                image.alt = `EAN ${ean}`;
                return image;
            } catch (error) {
                // The SVG fallback below is independent of canvas permissions.
            }
        }
        if (source instanceof SVGElement && source.childElementCount > 0) {
            const clone = source.cloneNode(true);
            clone.removeAttribute('id');
            clone.removeAttribute('width');
            clone.removeAttribute('height');
            clone.classList.add('bm-ean-barcode');
            clone.setAttribute('role', 'img');
            clone.setAttribute('aria-label', `EAN ${ean}`);
            return clone;
        }
        if (source instanceof HTMLImageElement && (source.currentSrc || source.src)) {
            const clone = source.cloneNode(true);
            clone.removeAttribute('id');
            clone.classList.add('bm-ean-barcode');
            clone.alt = `EAN ${ean}`;
            return clone;
        }
        return buildEan13Barcode(ean);
    }

    function showEanOverlay(ean, trigger) {
        document.querySelector('.bm-ean-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'bm-ean-overlay';
        overlay.className = 'bm-ean-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'bm-ean-title');
        overlay.innerHTML = `
            <div class="bm-ean-dialog">
                <header class="bm-ean-header">
                    <div class="bm-ean-heading">
                        <h2 id="bm-ean-title" class="bm-ean-title">EAN Barcode</h2>
                        <div class="bm-ean-subtitle">${ean}</div>
                    </div>
                    <button type="button" class="bm-ean-close"
                        title="Schließen" aria-label="Schließen">×</button>
                </header>
                <div class="bm-ean-content"></div>
            </div>
        `;

        const content = overlay.querySelector('.bm-ean-content');
        const graphic = cloneBarcodeGraphic(ean);
        if (graphic) {
            content.appendChild(graphic);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'bm-ean-fallback';
            fallback.textContent = ean;
            content.appendChild(fallback);
        }

        const close = () => {
            document.removeEventListener('keydown', onKeydown);
            document.body.classList.remove('bm-ean-overlay-open');
            overlay.remove();
            trigger?.focus?.();
        };
        const onKeydown = event => {
            if (event.key === 'Escape') close();
        };
        overlay.querySelector('.bm-ean-close').addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeydown);
        document.body.classList.add('bm-ean-overlay-open');
        document.body.appendChild(overlay);
        overlay.querySelector('.bm-ean-close').focus();
    }

    function setupEanBarcode() {
        const barcode = document.getElementById('barcode');
        const barcodeBlock = barcode?.closest('div');
        if (barcodeBlock) {
            barcodeBlock.classList.add('bm-ean-source-block');
            barcodeBlock.setAttribute('aria-hidden', 'true');
        }

        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph => /EAN\s*:/i.test(paragraph.textContent || ''));
        if (!details) return;

        let link = details.querySelector('.bm-ean-line-link');
        if (!link) {
            const line = findDetailsLineRange(details, /EAN\s*:/i);
            if (!line) return;
            const ean = line.text.replace(/\D/g, '');
            if (!/^\d{8,14}$/.test(ean)) return;

            link = document.createElement('a');
            link.className = 'bm-detail-line-link bm-ean-line-link';
            link.href = '#bm-ean-overlay';
            link.title = `EAN ${ean} anzeigen`;
            link.dataset.ean = ean;
            link.appendChild(line.range.extractContents());
            line.range.insertNode(link);
        }

        if (link.dataset.bmEanBound !== 'true') {
            link.dataset.bmEanBound = 'true';
            link.addEventListener('click', event => {
                event.preventDefault();
                showEanOverlay(link.dataset.ean, link);
            });
        }

        if (!details.querySelector('.bm-ean-copy-btn')) {
            const copyButton = document.createElement('span');
            copyButton.className = 'bm-copy-btn bm-ean-copy-btn';
            copyButton.title = 'EAN kopieren';
            copyButton.setAttribute('role', 'button');
            copyButton.setAttribute('aria-label', `EAN ${link.dataset.ean} kopieren`);
            copyButton.tabIndex = 0;
            copyButton.style.cssText =
                'cursor:pointer;margin-left:0.18em;padding:0;width:13px;' +
                'height:13px;border:0;background:none;color:inherit;' +
                'user-select:none;display:inline-flex;align-items:center;' +
                'justify-content:center;line-height:0;vertical-align:middle;' +
                'position:static;transform:none;opacity:0.82;';
            const defaultIcon = `
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none"
                    xmlns="http://www.w3.org/2000/svg">
                    <rect x="3.5" y="3.5" width="9" height="10" rx="2"
                        stroke="currentColor" fill="none" stroke-width="0.9"/>
                    <rect x="6.5" y="0.5" width="6" height="9" rx="2"
                        stroke="currentColor" fill="none" stroke-width="0.9"
                        opacity="0.55"/>
                </svg>`;
            copyButton.innerHTML = defaultIcon;
            const copyEan = event => {
                event.preventDefault();
                event.stopPropagation();
                const value = String(link.dataset.ean || '').trim();
                if (!value) return;
                if (typeof GM_setClipboard !== 'undefined') {
                    GM_setClipboard(value);
                } else if (navigator.clipboard) {
                    void navigator.clipboard.writeText(value);
                }
                copyButton.innerHTML = `
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none"
                        xmlns="http://www.w3.org/2000/svg">
                        <rect x="3.5" y="3.5" width="9" height="10" rx="2"
                            stroke="#2eb866" fill="none" stroke-width="1.5"/>
                        <path d="M5 10 l2 2 4-4" stroke="#2eb866"
                            stroke-width="1.5" fill="none"/>
                    </svg>`;
                window.setTimeout(() => {
                    copyButton.innerHTML = defaultIcon;
                }, 900);
            };
            copyButton.addEventListener('click', copyEan);
            copyButton.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                copyEan(event);
            });
            link.after(copyButton);
        }
    }

    // Die Anleitungen stehen auf Desktop oberhalb der Einzelteilelisten.
    // Die Originale bleiben für die Mobilansicht erhalten.
    function setupDesktopSidebarInstructions() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        if (!offerColumn || !sideColumn || sideColumn.querySelector('.bm-sidebar-instructions')) {
            return;
        }

        const sourceHeading = Array.from(offerColumn.querySelectorAll('h3'))
            .find(heading => heading.id === 'Bauanleitung' ||
                /Bauanleitung/i.test(heading.textContent || ''));
        const instructionImage = offerColumn.querySelector(
            'img[src*="/img/instructions/"]'
        );
        const moreAnchor = offerColumn.querySelector(
            'a[href*="/service/buildinginstructions/"]'
        );
        const moreParagraph = moreAnchor?.closest('p');
        const sourceSection = sourceHeading?.closest('section') ||
            instructionImage?.closest('section') ||
            (moreParagraph?.previousElementSibling?.tagName === 'SECTION'
                ? moreParagraph.previousElementSibling
                : null);
        if (!sourceSection) return;

        const sourceAnchors = Array.from(sourceSection.querySelectorAll('a'))
            .filter(anchor => anchor.querySelector('img[src*="/img/instructions/"]'));
        if (sourceAnchors.length === 0 && !moreAnchor) return;

        sourceSection.classList.add('bm-instruction-source');
        if (moreAnchor) moreParagraph.classList.add('bm-instruction-source');

        const panel = document.createElement('section');
        panel.className = 'bm-sidebar-instructions';

        const heading = document.createElement('h3');
        heading.textContent = 'Bauanleitungen';

        const list = document.createElement('div');
        list.className = 'bm-sidebar-instruction-list';

        sourceAnchors.forEach((sourceAnchor, index) => {
            const sourceImage = sourceAnchor.querySelector('img');
            const link = document.createElement('a');
            link.className = 'bm-sidebar-instruction-link';
            link.href = sourceAnchor.href;
            link.target = '_blank';
            link.rel = 'nofollow noopener';
            link.title = sourceAnchor.title || `Bauanleitung ${index + 1} öffnen`;

            const image = sourceImage.cloneNode(true);
            image.removeAttribute('width');
            image.removeAttribute('height');
            image.removeAttribute('style');
            image.loading = 'lazy';

            const label = document.createElement('span');
            label.textContent = sourceAnchor.textContent.trim() ||
                sourceImage.alt ||
                `Bauanleitung ${index + 1}`;

            link.append(image, label);
            list.appendChild(link);
        });

        panel.append(heading, list);

        if (moreAnchor) {
            const moreLink = document.createElement('a');
            moreLink.className = 'bm-sidebar-instructions-more';
            moreLink.href = moreAnchor.href;
            moreLink.target = '_blank';
            moreLink.rel = 'nofollow noopener';
            moreLink.textContent = 'Weitere Bauanleitungen bei LEGO';
            panel.appendChild(moreLink);
        }

        const barcodeBlock = sideColumn.querySelector('#barcode')?.closest('div');
        barcodeBlock?.classList.add('bm-sidebar-barcode');
        if (barcodeBlock) barcodeBlock.insertAdjacentElement('afterend', panel);
        else sideColumn.prepend(panel);
    }

    // Die Einzelteilelinks werden auf Desktop ebenfalls in der rechten Spalte
    // angezeigt. Auf kleinen Bildschirmen bleibt der Originalblock erhalten.
    function setupDesktopSidebarParts() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        if (!offerColumn || !sideColumn || sideColumn.querySelector('.bm-sidebar-parts')) {
            return;
        }

        const sourceHeading = Array.from(offerColumn.querySelectorAll('h3'))
            .find(heading => /Einzelteilelisten/i.test(heading.textContent));
        const sourceSection = sourceHeading?.closest('section');
        if (!sourceSection) return;

        const sourceAnchors = Array.from(sourceSection.querySelectorAll('a'))
            .filter(anchor => /Einzelteile/i.test(anchor.textContent));
        if (sourceAnchors.length === 0) return;

        sourceSection.classList.add('bm-parts-source');

        const panel = document.createElement('section');
        panel.className = 'bm-sidebar-parts';

        const heading = document.createElement('h3');
        heading.textContent = sourceHeading.textContent.trim();

        const list = document.createElement('div');
        list.className = 'bm-sidebar-parts-list';

        sourceAnchors.forEach(sourceAnchor => {
            const link = document.createElement('a');
            link.className = 'bm-sidebar-parts-link';
            link.href = sourceAnchor.href;
            link.target = '_blank';
            link.rel = sourceAnchor.rel || 'nofollow noopener';
            link.title = sourceAnchor.title;

            const sourceImage = sourceAnchor.querySelector('img');
            if (sourceImage) {
                const image = sourceImage.cloneNode(true);
                image.removeAttribute('width');
                image.removeAttribute('height');
                image.removeAttribute('style');
                link.appendChild(image);
            }

            const label = document.createElement('span');
            label.textContent = sourceAnchor.textContent.trim();
            link.appendChild(label);
            list.appendChild(link);
        });

        panel.append(heading, list);

        const instructionPanel = sideColumn.querySelector('.bm-sidebar-instructions');
        if (instructionPanel) instructionPanel.insertAdjacentElement('afterend', panel);
        else {
            const barcodeBlock = sideColumn.querySelector('#barcode')?.closest('div');
            if (barcodeBlock) barcodeBlock.insertAdjacentElement('afterend', panel);
            else sideColumn.prepend(panel);
        }
    }

    // Die offizielle Beschreibung gehört unter die komplette Dreispaltenzeile.
    function expandProductDescription() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const heading = document.querySelector('h2.long_description');
        const descriptionSection = heading?.closest('section');
        const columnsRow = document.querySelector('.content.setdetails .bm-detail-layout') ||
            offerColumn?.parentElement;
        if (
            !offerColumn ||
            !sideColumn ||
            !descriptionSection ||
            !columnsRow ||
            descriptionSection.classList.contains('bm-full-product-description')
        ) {
            return;
        }

        const spacer = descriptionSection.nextElementSibling;
        if (
            spacer?.tagName === 'DIV' &&
            spacer.children.length === 0 &&
            /height\s*:\s*2rem/i.test(spacer.getAttribute('style') || '')
        ) {
            spacer.remove();
        }

        descriptionSection.classList.add(
            'bm-full-product-description',
            'small-12',
            'columns'
        );
        columnsRow.appendChild(descriptionSection);
    }

    function linkLegoArticleNumber() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph => /Artikel-Nr\s*:/i.test(paragraph.textContent || ''));
        if (!details || details.querySelector('.bm-lego-article-link')) return;

        const line = findDetailsLineRange(details, /Artikel-Nr\s*:/i);
        if (!line || !new RegExp(`\\b${setNum}\\b`).test(line.text)) return;

        const link = createDetailsLineLink(
            'bm-lego-article-link',
            `https://www.lego.com/de-de/product/${setNum}`,
            `LEGO ${setNum} bei LEGO öffnen`
        );
        link.appendChild(line.range.extractContents());
        line.range.insertNode(link);
    }

    function findDetailsLineRange(details, linePattern) {
        const lineBreaks = Array.from(details.querySelectorAll('br'));
        const isFollowing = (first, second) => Boolean(
            first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement?.closest('a')) continue;

            const previousBreaks = lineBreaks.filter(lineBreak =>
                isFollowing(lineBreak, node)
            );
            const previousBreak = previousBreaks[previousBreaks.length - 1] || null;
            const followingBreak = lineBreaks.find(lineBreak =>
                isFollowing(node, lineBreak)
            ) || null;
            const range = document.createRange();
            if (previousBreak) range.setStartAfter(previousBreak);
            else range.setStart(details, 0);
            if (followingBreak) range.setEndBefore(followingBreak);
            else range.setEnd(details, details.childNodes.length);

            const lineText = range.toString().replace(/\s+/g, ' ').trim();
            linePattern.lastIndex = 0;
            if (linePattern.test(lineText)) {
                const lineStartWalker = document.createTreeWalker(
                    details,
                    NodeFilter.SHOW_TEXT
                );
                let lineStartNode;
                while (lineStartNode = lineStartWalker.nextNode()) {
                    if (!range.intersectsNode(lineStartNode)) continue;
                    const pipeMatch = String(lineStartNode.nodeValue || '')
                        .match(/^\s*\|\s*/);
                    if (pipeMatch) {
                        range.setStart(
                            lineStartNode,
                            pipeMatch[0].length
                        );
                    }
                    break;
                }
                return { range, text: lineText };
            }
            range.detach?.();
        }
        return null;
    }

    function createDetailsLineLink(className, href, title) {
        const link = document.createElement('a');
        link.className = `bm-detail-line-link ${className}`;
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = title;
        return link;
    }

    function linkDesignerName() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph => /Designer\s*:/i.test(paragraph.textContent || ''));
        if (!details || details.querySelector('.bm-designer-link')) return;

        // Brickmerge liefert einzelne Detailangaben je nach Set gelegentlich
        // ohne <br> zwischen Preis/Teil und Designer. Vor dem Verlinken die
        // Designer-Angabe deshalb zuverlässig auf eine eigene Zeile setzen.
        const designerWalker = document.createTreeWalker(
            details,
            NodeFilter.SHOW_TEXT
        );
        let designerTextNode;
        while (designerTextNode = designerWalker.nextNode()) {
            const text = String(designerTextNode.nodeValue || '');
            const match = text.match(/(?:\|\s*)?Designer\s*:/i);
            if (!match) continue;
            const prefix = text.slice(0, match.index);
            if (
                designerTextNode.previousSibling?.nodeName === 'BR' &&
                !/\S/.test(prefix)
            ) {
                break;
            }
            const breakRange = document.createRange();
            breakRange.setStart(designerTextNode, match.index);
            breakRange.collapse(true);
            breakRange.insertNode(document.createElement('br'));
            breakRange.detach?.();
            break;
        }

        const line = findDetailsLineRange(details, /Designer\s*:/i);
        if (!line) return;

        const designerNodes = Array.from(details.querySelectorAll('strong'))
            .filter(strong => {
                try {
                    return line.range.intersectsNode(strong) &&
                        !/Designer\s*:/i.test(strong.textContent || '');
                } catch (error) {
                    return false;
                }
            });
        const createDesignerLink = designer => {
            const query = `site:brickmerge.de Designer: ${designer}`;
            const link = document.createElement('a');
            link.className = 'bm-lego-article-link bm-designer-link';
            link.href =
                `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = `Brickmerge-Sets von ${designer} in Google Bilder suchen`;
            const strong = document.createElement('strong');
            strong.textContent = designer;
            link.appendChild(strong);
            return link;
        };

        if (designerNodes.length === 0) {
            const labelMatch = line.text.match(/^(.*?Designer\s*:\s*)/i);
            if (!labelMatch) return;
            const designers = line.text.slice(labelMatch[1].length)
                .split(/\s*\|\s*/)
                .map(name => name.trim())
                .filter(Boolean);
            if (designers.length === 0) return;

            const fragment = document.createDocumentFragment();
            fragment.appendChild(document.createTextNode(labelMatch[1]));
            designers.forEach((designer, index) => {
                if (index > 0) fragment.appendChild(document.createTextNode(' | '));
                fragment.appendChild(createDesignerLink(designer));
            });
            line.range.deleteContents();
            line.range.insertNode(fragment);
            return;
        }

        designerNodes.forEach(designerNode => {
            const designers = designerNode.textContent
                .replace(/\s+/g, ' ')
                .trim()
                .split(/\s*\|\s*/)
                .map(name => name.trim())
                .filter(Boolean);
            if (designers.length === 0) return;

            const fragment = document.createDocumentFragment();
            designers.forEach((designer, index) => {
                if (index > 0) fragment.appendChild(document.createTextNode(' | '));
                fragment.appendChild(createDesignerLink(designer));
            });
            designerNode.replaceWith(fragment);
        });
    }

    function linkPackageDimensionsCalculator() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph =>
            /OVP-Maße\s*:/i.test(paragraph.textContent || '') &&
            /Setgewicht\s*:/i.test(paragraph.textContent || '')
        );
        if (!details || details.querySelector('.bm-package-dimensions-link')) return;

        const text = (details.textContent || '').replace(/\s+/g, ' ');
        const dimensionsMatch = text.match(
            /OVP-Maße\s*:\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*cm/i
        );
        const weightMatch = text.match(
            /Setgewicht\s*:\s*[≈~]?\s*([\d.,]+)\s*(kg|g)\b/i
        );
        if (!dimensionsMatch || !weightMatch) return;

        const parseDecimalValue = value => {
            const raw = String(value || '').replace(/\s/g, '');
            if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) {
                return Number(raw.replace(/\./g, '').replace(',', '.'));
            }
            return Number(raw.replace(',', '.'));
        };
        const parseWeightKg = (value, unit) => {
            const parsed = parseDecimalValue(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return unit.toLowerCase() === 'g' ? parsed / 1000 : parsed;
        };
        const formatParam = (value, decimals = 2) =>
            Number(value).toFixed(decimals).replace(/\.?0+$/, '');
        const formatDimensionCm = value => String(Math.ceil(value));
        // 10 % auf das Gesamtmaß entsprechen 5 % Luft je Seite. Bei kleinen
        // LEGO-Kartons reicht das oft nicht für einen brauchbaren Umkarton,
        // deshalb gelten mindestens 2 cm je Seite; 15 cm je Seite bleiben die
        // Obergrenze für sehr große Sets.
        const formatPackedDimensionCm = dimension => {
            const clearancePerSide = Math.min(
                15,
                Math.max(2, dimension * 0.05)
            );
            return formatDimensionCm(dimension + clearancePerSide * 2);
        };

        const width = parseDecimalValue(dimensionsMatch[1]);
        const length = parseDecimalValue(dimensionsMatch[2]);
        const height = parseDecimalValue(dimensionsMatch[3]);
        const weightKg = parseWeightKg(weightMatch[1], weightMatch[2]);
        if (![width, length, height, weightKg].every(value =>
            Number.isFinite(value) && value > 0
        )) {
            return;
        }

        const url = new URL('https://www.paketda.de/paket-preis-rechner.php');
        url.searchParams.set('action', 'submit');
        url.searchParams.set('breite', formatPackedDimensionCm(width));
        url.searchParams.set('laenge', formatPackedDimensionCm(length));
        url.searchParams.set('hoehe', formatPackedDimensionCm(height));
        url.searchParams.set('gewicht', formatParam(weightKg * 1.1));
        url.hash = 'ergebnis';

        const dimensionTextPattern = new RegExp(
            `${dimensionsMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[x×]\\s*` +
            `${dimensionsMatch[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[x×]\\s*` +
            `${dimensionsMatch[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*cm`,
            'i'
        );

        const line = findDetailsLineRange(details, /OVP-Maße\s*:/i);
        if (!line || !dimensionTextPattern.test(line.text)) return;

        const link = createDetailsLineLink(
            'bm-package-dimensions-link',
            url.href,
            'Paketpreis mit mindestens 2 cm Luft je Seite, maximal 15 cm ' +
            'je Seite und 10% Gewichtszuschlag berechnen'
        );
        link.appendChild(line.range.extractContents());
        line.range.insertNode(link);
    }

    function compactSetFooter() {
        const footer = document.getElementById('footer');
        const wrap = document.getElementById('wrap');
        if (!footer || !wrap) return;

        const socialButton = footer.querySelector('.footerButton');
        const socialRow = socialButton?.closest('.small-12.columns');
        socialRow?.remove();

        footer.classList.add('bm-compact-footer');
        wrap.classList.add('bm-set-wrap');
    }

    function removeCorrectionReportButtons() {
        const root = document.querySelector('.content.setdetails');
        if (!root) return;

        root.querySelectorAll(
            'a, button, input[type="button"], input[type="submit"], ' +
            '[role="button"], .button'
        ).forEach(element => {
            const label = element.matches('input')
                ? element.value
                : element.textContent;
            if (/^Korrektur melden$/i.test(String(label || '').replace(/\s+/g, ' ').trim())) {
                element.remove();
            }
        });
    }

    function runSetDetailInitializers() {
        [
            setupDesktopDetailGrid,
            removeSidebarHistoryLinks,
            removeRelativeDayLabelsFromBestPriceLines,
            setupDesktopOfferGallery,
            setupEanBarcode,
            setupDesktopSidebarInstructions,
            setupDesktopSidebarParts,
            expandProductDescription,
            linkLegoArticleNumber,
            linkDesignerName,
            linkPackageDimensionsCalculator,
            createDiscountSettingsUI,
            removeCorrectionReportButtons,
            compactSetFooter
        ].forEach(initializer => {
            try {
                initializer();
            } catch (error) {
                console.error(
                    `Brickmerge Tweaker: ${initializer.name} konnte nicht ausgeführt werden.`,
                    error
                );
            }
        });
    }

    if (setNum && BM_SETTINGS.detailLayout) {
        runSetDetailInitializers();
        window.addEventListener('load', runSetDetailInitializers, { once: true });
    }

    // Brickmerge lädt die zuletzt ausverkauften Angebote verzögert nach. Sobald
    // sie vorhanden sind, werden nur deren Angebotszeilen in die normale Liste
    // übernommen; der Link zum Händler bleibt dabei unverändert erhalten.
    function mergeSoldOutOffersIntoOfferList() {
        const soldOutContainer = document.getElementById('SoldOutContainer');
        const soldOut = document.getElementById('soldOut');
        const offerlist = document.getElementById('offerlist');
        if (!soldOutContainer || !soldOut || !offerlist) return false;

        const soldOutRows = Array.from(soldOut.querySelectorAll('.row.collapse'))
            .filter(wrapper => wrapper.querySelector(
                '.medium-4.small-9.columns.pricerow[data-mid]'
            ));
        if (soldOutRows.length === 0) return false;

        const firstMainPriceRow = Array.from(offerlist.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid]'
        )).find(priceRow => !priceRow.closest('#soldOut'));
        const target = firstMainPriceRow?.closest('.row.collapse')?.parentElement;
        if (!target) return false;

        soldOutRows.forEach(wrapper => {
            wrapper.querySelectorAll('.goto.medium-7').forEach(element => element.remove());
            wrapper.classList.add('bm-sold-out-offer');
            wrapper.dataset.bmSoldOut = 'true';

            const priceRow = wrapper.querySelector(
                '.medium-4.small-9.columns.pricerow[data-mid]'
            );
            if (priceRow) priceRow.dataset.bmSoldOut = 'true';

            const priceSpan = priceRow?.querySelector('span.price');
            if (priceSpan && !priceSpan.querySelector('.bm-sold-out-badge')) {
                const badge = document.createElement('span');
                badge.className = 'bm-sold-out-badge';
                badge.textContent = 'SOLD OUT';
                badge.title = 'Kürzlich ausverkauft';
                priceSpan.appendChild(badge);
            }

            if (!wrapper.querySelector(':scope > .bm-sold-out-overlay')) {
                const overlay = document.createElement('span');
                overlay.className = 'bm-sold-out-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                wrapper.appendChild(overlay);
            }

            target.appendChild(wrapper);
        });

        soldOutContainer.remove();
        return true;
    }

    function placeSoldOutBadgesAfterShipping() {
        document.querySelectorAll(
            '#offerlist .bm-sold-out-offer ' +
            '.medium-4.small-9.columns.pricerow span.price'
        ).forEach(priceSpan => {
            const badge = priceSpan.querySelector(':scope > .bm-sold-out-badge');
            if (badge) priceSpan.appendChild(badge);
        });
    }
    if (setNum) {
        mergeSoldOutOffersIntoOfferList();
        window.addEventListener('load', mergeSoldOutOffersIntoOfferList, { once: true });
    }

    // Der native Brickmerge-Detailchart wird im Hintergrund vorgeladen und
    // anschließend im eigenen Overlay angezeigt. Dadurch ist der historische
    // Bestpreis bereits neben dem Schalter verfügbar.
    let openPriceChartOverlay = null;

    function setupPriceChartOverlay() {
        const chartTrigger = document.getElementById('chartTrigger');
        const chartContainer = document.getElementById('chartContainer');
        const bigChart = document.getElementById('bigChart');
        if (!chartTrigger || !chartContainer || !bigChart) return;
        if (document.getElementById('bm-price-chart-overlay')) return;

        chartTrigger.parentElement?.classList.add('bm-chart-controls');
        chartTrigger.classList.add(
            'button',
            'small',
            'smallGreyButton',
            'bm-detail-action-button'
        );
        chartTrigger.setAttribute('aria-haspopup', 'dialog');
        chartTrigger.setAttribute('aria-controls', 'bm-price-chart-overlay');

        const normalizeChartTriggerLabel = () => {
            const buttonLabel = chartTrigger.querySelector('.chartbutton');
            if (!buttonLabel || buttonLabel.querySelector('.bm-chart-label-full')) {
                return;
            }
            buttonLabel.textContent = '';
            const icon = document.createElement('span');
            icon.className = 'bm-chart-action-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML =
                '<svg viewBox="0 0 24 24" focusable="false">' +
                '<path d="M3 3v18h18"/>' +
                '<path d="m6 16 4-5 4 3 5-7"/>' +
                '</svg>';
            const fullLabel = document.createElement('span');
            fullLabel.className = 'bm-chart-label-full';
            fullLabel.textContent = 'Details';
            const mobileLabel = document.createElement('span');
            mobileLabel.className = 'bm-chart-label-mobile';
            mobileLabel.textContent = 'Details';
            buttonLabel.append(icon, fullLabel, mobileLabel);
        };
        normalizeChartTriggerLabel();

        const overlay = document.createElement('div');
        overlay.id = 'bm-price-chart-overlay';
        overlay.className = 'bm-chart-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-labelledby', 'bm-price-chart-title');

        const dialog = document.createElement('div');
        dialog.className = 'bm-chart-dialog';

        const header = document.createElement('div');
        header.className = 'bm-chart-dialog-header';

        const title = document.createElement('h2');
        title.id = 'bm-price-chart-title';
        title.className = 'bm-chart-dialog-title';
        title.textContent = 'Preisentwicklung';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'bm-chart-dialog-close';
        closeButton.setAttribute('aria-label', 'Preisentwicklung schließen');
        closeButton.title = 'Schließen';
        closeButton.textContent = '\u00d7';

        const content = document.createElement('div');
        content.className = 'bm-chart-dialog-content';

        const amazonNote = Array.from(
            chartTrigger.parentElement?.querySelectorAll('span') || []
        ).find(element => /amazon-preise werden nicht im preisverlauf berücksichtigt/i.test(
            element.textContent || ''
        ));
        amazonNote?.remove();

        header.append(title, closeButton);
        content.appendChild(chartContainer);
        dialog.append(header, content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let storedScrollY = 0;
        let backgroundPreload = false;
        let preloadReadyTimer = null;
        let preloadTimeoutTimer = null;
        let defaultChartPeriodApplied = false;

        const finishBackgroundPreload = () => {
            window.clearTimeout(preloadReadyTimer);
            window.clearTimeout(preloadTimeoutTimer);
            preloadReadyTimer = null;
            preloadTimeoutTimer = null;
            overlay.classList.remove('bm-preloading');
        };

        const customizeNativeChart = () => {
            const chartWrapper = bigChart.querySelector('#chartWrapper');
            if (!chartWrapper) return;

            const nativeTitle = Array.from(chartWrapper.querySelectorAll('h3'))
                .find(heading => /preis-?chart/i.test(heading.textContent || ''));
            const nativeTitleRow = nativeTitle?.parentElement;
            nativeTitleRow?.classList.add('bm-native-chart-title');
            let helpRow = chartWrapper.querySelector('.bm-chart-help');
            if (!helpRow) {
                helpRow = nativeTitleRow?.nextElementSibling || null;
                helpRow?.classList.add('bm-chart-help');
            }
            if (helpRow && helpRow !== chartWrapper.lastElementChild) {
                chartWrapper.appendChild(helpRow);
            }

            const periodButtons = Array.from(
                chartWrapper.querySelectorAll('a.buttonPeriod')
            );
            if (periodButtons.length) {
                periodButtons[0].closest('.small-12')
                    ?.classList.add('bm-native-period-row');
                let periodBar = header.querySelector('.bm-chart-periods');
                if (!periodBar) {
                    periodBar = document.createElement('div');
                    periodBar.className = 'bm-chart-periods';
                    periodBar.setAttribute('aria-label', 'Zeitraum auswählen');
                    header.insertBefore(periodBar, closeButton);
                }
                periodButtons.forEach(button => periodBar.appendChild(button));

                if (!defaultChartPeriodApplied) {
                    const defaultPeriodButton = periodButtons.find(button =>
                        /letzte\s+30\s+tage/i.test(button.textContent || '')
                    );
                    if (defaultPeriodButton) {
                        defaultChartPeriodApplied = true;
                        if (!defaultPeriodButton.classList.contains('hasOrangeBg')) {
                            window.setTimeout(() => defaultPeriodButton.click(), 0);
                        }
                    }
                }
            }

            const saleLink = Array.from(chartWrapper.querySelectorAll('a'))
                .find(link => /im verkauf bei lego ab/i.test(link.textContent || ''));
            if (saleLink) {
                const match = (saleLink.textContent || '').match(
                    /ab\s+(.+?)\s+bis heute/i
                );
                if (match?.[1]) {
                    title.textContent = `Preisentwicklung seit ${match[1].trim()}`;
                }

                const separator = saleLink.nextSibling;
                if (separator?.nodeType === Node.TEXT_NODE) {
                    separator.textContent = separator.textContent.replace(
                        /^\s*\|\s*/,
                        ''
                    );
                }
                saleLink.remove();
            }

            Array.from(chartWrapper.querySelectorAll('a'))
                .filter(link => /zur (?:ebay|bricklink) history/i.test(
                    link.textContent || ''
                ))
                .forEach(link => {
                    const separator = link.nextSibling?.nodeType === Node.TEXT_NODE
                        ? link.nextSibling
                        : link.previousSibling?.nodeType === Node.TEXT_NODE
                            ? link.previousSibling
                            : null;
                    if (separator) {
                        separator.textContent = separator.textContent.replace(
                            /\s*\|\s*/,
                            ''
                        );
                    }
                    link.remove();
                });

            const historyRow = Array.from(chartWrapper.children)
                .find(element => element.querySelector?.('strong') &&
                    /(?:bisheriger\s+bestpreis|all-time-bestpreis)/i.test(element.textContent || ''));
            if (historyRow) {
                const bestPrice = Array.from(historyRow.querySelectorAll('strong'))
                    .find(element => /(?:bisheriger\s+bestpreis|all-time-bestpreis)/i.test(
                        element.textContent || ''
                    ));
                const historicalInfo = parseHistoricalBestPriceText(
                    historyRow.textContent || bestPrice?.textContent || ''
                );
                if (historicalInfo?.detailSuffix) {
                    nativeChartHistoricalBestPriceInfo = historicalInfo;
                    writeHistoricalBestPriceDetailToSidebar(
                        historicalInfo.detailSuffix
                    );
                }
                chartTrigger.parentElement?.querySelector('.bm-chart-best-price')
                    ?.remove();
                historyRow.remove();
            }

            if (
                overlay.classList.contains('bm-preloading') &&
                preloadReadyTimer === null
            ) {
                preloadReadyTimer = window.setTimeout(
                    finishBackgroundPreload,
                    500
                );
            }
        };

        let chartCustomizeFrame = 0;
        const scheduleNativeChartCustomization = () => {
            if (chartCustomizeFrame) return;
            chartCustomizeFrame = window.requestAnimationFrame(() => {
                chartCustomizeFrame = 0;
                customizeNativeChart();
            });
        };
        const chartObserver = new MutationObserver(
            scheduleNativeChartCustomization
        );
        chartObserver.observe(bigChart, { childList: true, subtree: true });

        const normalizeNativeChartState = () => {
            bigChart.classList.remove('hide');
            bigChart.style.display = 'block';
            customizeNativeChart();

            normalizeChartTriggerLabel();

            const offerColumn = document.getElementById('ol1st');
            offerColumn?.classList.remove('large-12');
            offerColumn?.classList.add('large-8');
        };

        const showOverlay = () => {
            finishBackgroundPreload();
            if (!overlay.classList.contains('bm-open')) {
                storedScrollY = window.scrollY;
            }
            overlay.classList.add('bm-open');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('bm-chart-overlay-open');
            closeButton.focus({ preventScroll: true });
        };

        const closeOverlay = () => {
            if (!overlay.classList.contains('bm-open')) return;
            overlay.classList.remove('bm-open');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('bm-chart-overlay-open');
            window.scrollTo(0, storedScrollY);
            chartTrigger.focus({ preventScroll: true });
        };

        openPriceChartOverlay = () => {
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') {
                normalizeNativeChartState();
                showOverlay();
                return;
            }
            chartTrigger.click();
        };

        // Capture-Phase: Nach dem ersten nativen Laden werden weitere Klicks
        // abgefangen, damit Brickmerge den Chart nicht wieder zuklappt.
        document.addEventListener('click', event => {
            const trigger = event.target.closest?.('#chartTrigger');
            if (!trigger) return;

            if (!backgroundPreload) showOverlay();
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') {
                event.preventDefault();
                event.stopImmediatePropagation();
                normalizeNativeChartState();
                return;
            }

            chartTrigger.dataset.bmNativeChartActivated = 'true';
            window.setTimeout(normalizeNativeChartState, 900);
            window.setTimeout(normalizeNativeChartState, 1800);
        }, true);

        const preloadNativeChart = () => {
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') return;

            overlay.classList.add('bm-preloading');
            backgroundPreload = true;
            try {
                chartTrigger.click();
            } finally {
                backgroundPreload = false;
            }
            preloadTimeoutTimer = window.setTimeout(() => {
                normalizeNativeChartState();
                finishBackgroundPreload();
            }, 8000);
        };

        const scheduleChartPreload = () => {
            scheduleIdleTask(preloadNativeChart, 1800);
        };
        if (document.readyState === 'complete') scheduleChartPreload();
        else window.addEventListener('load', scheduleChartPreload, { once: true });

        closeButton.addEventListener('click', closeOverlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && overlay.classList.contains('bm-open')) {
                closeOverlay();
            }
        });
    }

    if (setNum && BM_SETTINGS.detailLayout) setupPriceChartOverlay();

    // Historische Preisangaben öffnen dieselbe Preisverlaufsansicht wie
    // Brickmerges eigener Chart-Schalter.
    function isPriceHistoryLink(link) {
        const text = link?.textContent || '';
        return /bisheriger\s+bestpreis|all-time-bestpreis|180\s*tage\s+bestpreis|preis\s+im\s+vergleich\s+zum\s+atb|differenz\s+zum\s+atb/i.test(text);
    }

    function decoratePriceHistoryLinks() {
        const chartTrigger = document.getElementById('chartTrigger');
        const bigChart = document.getElementById('bigChart');
        if (!chartTrigger || !bigChart) return;

        Array.from(document.querySelectorAll('a')).filter(isPriceHistoryLink).forEach(link => {
            link.classList.add('bm-price-history-link');
            link.setAttribute('href', '#bm-price-chart-overlay');
            link.setAttribute('aria-controls', 'bm-price-chart-overlay');
        });

        if (document.documentElement.dataset.bmPriceHistoryBound === 'true') return;
        document.documentElement.dataset.bmPriceHistoryBound = 'true';

        document.addEventListener('click', event => {
            const link = event.target.closest?.('a');
            if (!isPriceHistoryLink(link)) return;
            event.preventDefault();
            openPriceChartOverlay?.();
        });
    }
    if (setNum) {
        decoratePriceHistoryLinks();
        window.addEventListener('load', decoratePriceHistoryLinks, { once: true });
    }

    // Die "kürzlich ausverkauft"-Liste wird von der Seite selbst per AJAX in
    // #soldOut nachgeladen. Der Observer führt die Zusammenführung aus, sobald
    // die Angebotszeilen tatsächlich vorhanden sind.
    if (setNum) {
        const soldOutContainer = document.getElementById('soldOut');
        if (soldOutContainer) {
            const mergeLoadedSoldOutOffers = () => {
                if (!mergeSoldOutOffersIntoOfferList()) return;
                soldOutObserver.disconnect();
                window.setTimeout(applyOfferPresentation, 0);
            };
            const soldOutObserver = new MutationObserver(mergeLoadedSoldOutOffers);
            soldOutObserver.observe(soldOutContainer, { childList: true, subtree: true });
            mergeLoadedSoldOutOffers();
        }
    }

    // ==========================================
    // 2. LINKLISTE & UI MODUL
    // ==========================================
    if (setNum) {
        const icon = domain => `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(domain)}`;
        const amazonIcon = icon("amazon.de");
        const brickOwlCatalogSearchUrl = value =>
            `https://www.brickowl.com/search/catalog?cat=3&query=${encodeURIComponent(`${value}-1`)}`;
        const brickOwlSearchUrl = value =>
            `https://www.brickowl.com/search/catalog?cat=3&jump=1&query=${encodeURIComponent(`${value}-1`)}`;
                let kleinanzeigenRequestState = 'idle';
                let idealoRequestHandler = null;
                let idealoRequestPending = false;
                let idealoRequestState = 'idle';
                const activeBackgroundLookups = new Set();
                const updateOfferListLoadingIndicator = () => {
                    const offerList = document.getElementById('offerlist');
                    if (!offerList) return;
                    const toolbar = offerList.querySelector('.bm-offer-toolbar') ||
                        document.querySelector('.bm-offer-toolbar');
                    let indicator = document.getElementById('bm-offerlist-loading');
                    if (!indicator) {
                        indicator = document.createElement('div');
                        indicator.id = 'bm-offerlist-loading';
                        indicator.className = 'bm-offerlist-loading';
                        indicator.setAttribute('role', 'status');
                        indicator.setAttribute('aria-live', 'polite');
                        indicator.innerHTML = '<span class="bm-offerlist-loading-spinner" aria-hidden="true"></span><span>Angebote werden geladen …</span>';
                    }
                    if (toolbar && indicator.parentElement !== toolbar) {
                        toolbar.prepend(indicator);
                    } else if (!toolbar && !indicator.parentElement) {
                        offerList.insertAdjacentElement('beforebegin', indicator);
                    }
                    const isLoading = activeBackgroundLookups.size > 0;
                    indicator.classList.toggle('is-visible', isLoading);
                    indicator.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
                };
                const setBackgroundLookupPending = (source, isPending) => {
                    if (isPending) activeBackgroundLookups.add(source);
                    else activeBackgroundLookups.delete(source);
                    updateOfferListLoadingIndicator();
                };
        const publishIdealoRequestState = state => {
            idealoRequestState = state;
            document.dispatchEvent(new CustomEvent('bm-idealo-request-state', { detail: { state } }));
        };
        const triggerIdealoRequest = () => {
            publishIdealoRequestState('loading');
            if (idealoRequestHandler) idealoRequestHandler();
            else idealoRequestPending = true;
        };
        const publishKleinanzeigenRequestState = (state, message = '') => {
            kleinanzeigenRequestState = state;
            document.dispatchEvent(new CustomEvent(
                'bm-kleinanzeigen-request-state',
                { detail: { state, message } }
            ));

            let feedback = document.querySelector('.bm-kleinanzeigen-feedback');
            if (!feedback && message) {
                feedback = document.createElement('div');
                feedback.className = 'bm-kleinanzeigen-feedback';
                feedback.dataset.bmStandalone = 'true';
                feedback.setAttribute('role', 'alert');
                feedback.setAttribute('aria-live', 'assertive');
                const offerList = document.getElementById('offerlist');
                if (offerList?.parentNode) {
                    offerList.parentNode.insertBefore(feedback, offerList);
                } else {
                    document.querySelector('.content.setdetails')?.prepend(feedback);
                }
            }
            if (feedback) {
                feedback.textContent = message;
                feedback.hidden = !message;
                if (!message && feedback.dataset.bmStandalone === 'true') {
                    feedback.remove();
                }
            }
        };
        const groups = [
            {
                key: 'marketplaces',
                title: "Marktplätze",
                links: [
                    { id: "btn-ebay", name: "eBay", url: `https://www.ebay.de/sch/i.html?_dcat=19006&_fsrp=1&_from=R40&_nkw=lego+${setNum}&_sacat=0&LH_BIN=1&LH_PrefLoc=1&LH_ItemCondition=1000&_sop=15`, icon: icon("ebay.de") },
                    { id: "btn-kleinanzeigen", name: "Kleinanzeigen", url: `https://www.kleinanzeigen.de/s-spielzeug/sortierung:preis/lego-${setNum}/k0c23+spielzeug.condition_s:new`, icon: icon("kleinanzeigen.de") },
                    { id: "btn-vinted", name: "Vinted", url: `https://www.vinted.de/catalog?search_text=lego+${setNum}`, icon: icon("vinted.de") },
                    { id: "btn-stockx", name: "StockX", url: `https://stockx.com/search?s=lego%20${setNum}`, icon: icon("stockx.com") },
                    { id: "btn-bo", name: "BrickOwl", url: brickOwlSearchUrl(setNum), icon: icon("brickowl.com") },
                    { id: "btn-bl", name: "Bricklink", url: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNum}-1#T=S&O={%22ss%22:%22DE%22,%22cond%22:%22N%22,%22ii%22:0,%22loc%22:%22DE%22,%22iconly%22:0}`, icon: icon("bricklink.com") }
                ]
            },
            {
                key: 'france',
                title: "Frankreich 🇫🇷",
                links: [
                    { name: "LEGO.fr", url: `https://www.lego.com/fr-fr/product/${setNum}`, icon: icon("lego.com") },
                    { id: "btn-leboncoin", name: "leboncoin", url: `https://www.leboncoin.fr/recherche?text=lego%20${setNum}&shippable=1&transaction_status=search__no_value&sort=relevance&item_condition=1`, icon: icon("leboncoin.fr") },
                    { id: "btn-ebay-fr", name: "eBay FR", url: `https://www.ebay.fr/sch/i.html?_nkw=lego+${setNum}&_sacat=0&_from=R40&LH_BIN=1&LH_ItemCondition=1000&_sop=15`, icon: icon("ebay.fr") },
                    { id: "btn-idealo", name: "idealo FR", url: `https://www.google.com/search?q=site%3Aidealo.fr+lego+${setNum}&btnI=1`, icon: icon("idealo.fr") },
                    { name: "Cdiscount", url: `https://www.google.com/search?q=site%3Acdiscount.com+lego+${setNum}&btnI=1`, icon: icon("cdiscount.com") }
                ]
            },
            {
                key: 'resources',
                title: "Ressourcen",
                links: [
                    { name: "Rebrickable", url: `https://rebrickable.com/sets/${setNum}-1/#alt_builds`, icon: icon("rebrickable.com") },
                    {
                        id: "btn-meta-gpt",
                        name: "Meta",
                        url: `https://meta-preisvergleich.de/index.cgi?q=lego+${setNum}&c=kategorie&id=lego_${setNum}__kategorie&offset=&qq=`,
                        icon: icon("meta-preisvergleich.de"),
                        secondaryUrl: META_GPT_URL,
                        secondaryIcon: icon("chatgpt.com")
                    },
                    { name: "Geizhals", url: `https://www.google.com/search?q=site%3Ageizhals.de+lego+${setNum}&btnI=1`, icon: icon("geizhals.at") },
                    { name: "idealo DE", url: `https://www.google.com/search?q=site%3Aidealo.de+lego+${setNum}&btnI=1`, icon: icon("idealo.de") },
                    { name: "Reviews", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`lego ${setNum} review`)}`, icon: icon("youtube.com") }
                ]
            },
            {
                key: 'history',
                title: "Verkaufshistorie",
                links: [
                    { name: "eBay Historie", url: `https://www.ebay.de/sch/i.html?LEGO%2520Set%2520Nummer=${setNum}&LH_ItemCondition=1000&LH_Complete=1&LH_Sold=1&_nkw=lego+${setNum}&Marke=LEGO&rt=nc&_dcat=19006&_ipg=240&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=5337950435&customid=&toolid=10001&mkevt=1`, icon: icon("ebay.de") },
                    { name: "Bricklink Historie", url: `https://www.bricklink.com/catalogPG.asp?S=${setNum}-1&colorID=0&v=D&viewExclude=Y&cID=Y`, icon: icon("bricklink.com") },
                    { id: "btn-amz", name: "Keepa", url: `https://keepa.com/#!search/3-lego%20${setNum}`, icon: amazonIcon }
                ]
            }
        ];

        const css = `
        .bm-info-group {
            margin: 1.3em 0 1.4em 0;
            animation: bm-info-group-in .22s ease-out both;
        }
        .bm-info-group:first-child { margin-top: 1em; }
        .bm-info-group:last-child { margin-bottom: 1.8em; }
        .bm-info-title { font-size: 1.05em; font-weight: bold; margin: 0 0 0.45em 0; color: #333; }
        .bm-link-slider { position: relative; min-width: 0; }
        .bm-link-viewport {
            overflow-x: auto;
            overflow-y: hidden;
            min-width: 0;
            scroll-behavior: smooth;
            scrollbar-width: none;
            -ms-overflow-style: none;
            touch-action: auto;
            overscroll-behavior-inline: auto;
            -webkit-overflow-scrolling: touch;
        }
        .bm-link-viewport::-webkit-scrollbar { display: none; }
        .bm-info-links { display: flex; flex-wrap: nowrap; width: max-content; gap: 7px 11px; }
        .bm-link { display: inline-flex; flex: 0 0 auto; align-items: center; text-decoration: none; font-size: 0.93em; color: #222; font-weight: 500; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px 4px 6px; line-height: 1.2;}
        .bm-link:hover,
        .bm-link:focus {
            background: #fff !important;
            border-color: #ccc !important;
            color: #222 !important;
        }
        .bm-link[hidden] { display: none !important; }
        .bm-link > img { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; margin-right: 6px; }
        .bm-link-icons {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 2px;
            margin-right: 6px;
        }
        .bm-link-icons img {
            width: 20px;
            height: 20px;
            margin: 0;
            border-radius: 3px;
            object-fit: contain;
        }
        .bm-link:hover span { text-decoration: underline; }
        .bm-kleinanzeigen-dual-link {
            overflow: hidden;
            padding: 0;
        }
        .bm-kleinanzeigen-site-link {
            display: inline-flex;
            min-height: 30px;
            align-items: center;
            padding: 4px 7px 4px 6px;
            color: #222 !important;
            text-decoration: none !important;
        }
        .bm-kleinanzeigen-site-link img {
            width: 20px;
            height: 20px;
            margin-right: 6px;
            border-radius: 3px;
            object-fit: contain;
        }
        html body .content.setdetails .bm-info-group
            .bm-kleinanzeigen-dual-link:hover
            > a.bm-kleinanzeigen-site-link,
        html body .content.setdetails .bm-info-group
            .bm-kleinanzeigen-dual-link:focus-within
            > a.bm-kleinanzeigen-site-link,
        html body .content.setdetails .bm-info-group
            a.bm-kleinanzeigen-site-link:hover,
        html body .content.setdetails .bm-info-group
            a.bm-kleinanzeigen-site-link:focus {
            background: #fff !important;
            background-color: #fff !important;
            color: #222 !important;
            text-shadow: none !important;
        }
        html body .content.setdetails .bm-info-group
            a.bm-kleinanzeigen-site-link:hover *,
        html body .content.setdetails .bm-info-group
            a.bm-kleinanzeigen-site-link:focus * {
            background-color: transparent !important;
            color: #222 !important;
            text-shadow: none !important;
        }
        .bm-kleinanzeigen-load {
            display: inline-flex !important;
            width: 28px;
            min-width: 28px;
            min-height: 30px;
            align-items: center;
            justify-content: center;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-left: 1px solid #d5d5d5 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #b00 !important;
            font: 700 0.75rem/1 Arial, sans-serif !important;
            text-shadow: none !important;
            position: relative;
        }
        .bm-kleinanzeigen-load:hover,
        .bm-kleinanzeigen-load:focus {
            background: #fff !important;
            color: #b00 !important;
        }
        .bm-kleinanzeigen-load.is-loading {
            color: transparent !important;
            background: #fff !important;
            pointer-events: none;
        }
        .bm-kleinanzeigen-load.is-loading::after {
            content: '';
            position: absolute;
            width: 13px;
            height: 13px;
            border: 2px solid #ddd;
            border-top-color: #b00;
            border-radius: 50%;
            box-sizing: border-box;
            animation: bm-kleinanzeigen-spin .7s linear infinite;
        }
        .bm-kleinanzeigen-load.is-done {
            color: #18733d !important;
        }
        .bm-kleinanzeigen-load.is-error {
            color: #b00 !important;
        }
        .bm-kleinanzeigen-load.is-empty {
            color: #777 !important;
        }
        .bm-kleinanzeigen-feedback {
            margin: 0.45rem 0 0;
            padding: 0.55rem 0.7rem;
            border-left: 3px solid #b00;
            border-radius: 2px;
            background: #fff0f0;
            color: #7d0000;
            font-size: 0.78rem;
            line-height: 1.35;
            animation: bm-info-group-in .18s ease-out;
        }
        .bm-kleinanzeigen-feedback[hidden] { display: none !important; }
        @keyframes bm-kleinanzeigen-spin { to { transform: rotate(360deg); } }
        @keyframes bm-info-group-in {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
            .bm-info-group { animation: none; }
        }
        .bm-meta-dual-link {
            overflow: hidden;
            padding: 0;
        }
        .bm-meta-dual-link > a {
            display: inline-flex;
            min-height: 28px;
            align-items: center;
            padding: 4px 6px;
            color: #222 !important;
            text-decoration: none;
            box-sizing: border-box;
        }
        .bm-meta-dual-link > a:hover,
        .bm-meta-dual-link > a:focus {
            background: transparent !important;
            color: #222 !important;
        }
        .bm-meta-dual-link img {
            width: 20px;
            height: 20px;
            margin: 0;
            border-radius: 3px;
            object-fit: contain;
        }
        .bm-meta-site-link {
            gap: 6px;
        }
        .bm-meta-gpt-trigger {
            border-left: 1px solid #d5d5d5;
        }
        .bm-meta-dual-link:hover span {
            text-decoration: none;
        }
        .bm-meta-site-link:hover .bm-link-label,
        .bm-meta-site-link:focus .bm-link-label {
            color: #222 !important;
            text-decoration: underline;
        }
        .bm-link-scroll {
            position: absolute;
            top: 50%;
            z-index: 5;
            display: none;
            align-items: center;
            justify-content: center;
            width: 1.65rem;
            height: 1.65rem;
            margin: 0 !important;
            padding: 0 !important;
            transform: translateY(-50%);
            background: #fff !important;
            border: 1px solid #aaa !important;
            border-radius: 50% !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
            color: #a80000 !important;
            font-size: 1.25rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
        }
        .bm-link-scroll > span {
            display: block;
            width: 0.46rem;
            height: 0.46rem;
            border-top: 2px solid currentColor;
            border-right: 2px solid currentColor;
            box-sizing: border-box;
        }
        .bm-link-scroll-prev > span { transform: rotate(-135deg); }
        .bm-link-scroll-next > span { transform: rotate(45deg); }
        .bm-link-scroll.is-visible { display: flex; }
        .bm-link-scroll-prev { left: 0.15rem; }
        .bm-link-scroll-next { right: 0.15rem; }
        .bm-link-scroll:hover,
        .bm-link-scroll:focus {
            background: #a80000 !important;
            color: #fff !important;
        }
        `;
        if (!document.getElementById('bm-linklist-style')) {
            const style = document.createElement("style");
            style.id = "bm-linklist-style";
            style.textContent = css;
            document.head.appendChild(style);
        }

        function syncMarketplaceShortcutLinks() {
            const hasOfferForButton = buttonId => Boolean(document.querySelector(
                `#offerlist [data-bm-shortcut-id="${buttonId}"]`
            ));
            const hasOffer = pattern => Array.from(document.querySelectorAll(
                '#offerlist .medium-4.small-9.columns.pricerow[data-mid]'
            )).some(priceRow => {
                const offerRow = priceRow.closest('.row.collapse');
                const merchant = priceRow.querySelector('.merchant')?.textContent || '';
                const logo = offerRow?.querySelector('.goto img[alt]')?.alt || '';
                const tooltip = priceRow.querySelector(':scope > a')?.getAttribute('title') || '';
                const source = [
                    priceRow.dataset.bmSource,
                    priceRow.dataset.mid,
                    offerRow?.dataset.bmSource,
                    merchant,
                    logo,
                    tooltip
                ].filter(Boolean).join(' ');
                return pattern.test(source);
            });

            const rules = [
                { id: 'btn-kleinanzeigen', pattern: /\bkleinanzeigen(?:-worker|-apify)?\b/i },
                { id: 'btn-vinted', pattern: /\bvinted(?:-apify)?\b/i },
                { id: 'btn-leboncoin', pattern: /\bleboncoin(?:-apify)?\b/i },
                { id: 'btn-stockx', pattern: /\bstockx(?:-apify)?\b/i },
                { id: 'btn-bl', pattern: /\bbricklink\b/i },
                { id: 'btn-bo', pattern: /\bbrickowl\b|brickowl-de/i }
            ];
            rules.forEach(({ id, pattern }) => {
                const shortcut = document.querySelector(`a[data-bmid="${id}"]`);
                if (!shortcut) return;
                const bubble = shortcut.closest('.bm-link') || shortcut;
                const shouldHide = hasOfferForButton(id) || hasOffer(pattern);

                if (!shouldHide) {
                    clearTimeout(Number(bubble.dataset.bmHideTimer || 0));
                    delete bubble.dataset.bmHideTimer;
                    bubble.classList.remove('bm-shortcut-leaving');
                    bubble.hidden = false;
                    return;
                }
                if (bubble.hidden || bubble.classList.contains('bm-shortcut-leaving')) {
                    return;
                }

                bubble.classList.add('bm-shortcut-leaving');
                const hideTimer = window.setTimeout(() => {
                    bubble.hidden = true;
                    bubble.classList.remove('bm-shortcut-leaving');
                    delete bubble.dataset.bmHideTimer;
                }, 210);
                bubble.dataset.bmHideTimer = String(hideTimer);
            });
        }

        function buildBox() {
            const container = document.createElement("div");
            container.id = 'bm-link-panel';
            container.className = 'bm-link-panel';
            container.dataset.bmLinkPanel = 'true';
            for (const group of groups) {
                if (BM_SETTINGS.linkRows[group.key] === false) continue;
                const section = document.createElement("section");
                section.className = "bm-info-group";
                const title = document.createElement("div");
                title.className = "bm-info-title";
                title.textContent = group.title;
                const slider = document.createElement("div");
                slider.className = "bm-link-slider";
                const viewport = document.createElement("div");
                viewport.className = "bm-link-viewport";
                const row = document.createElement("div");
                row.className = "bm-info-links";
                let kleinanzeigenFeedback = null;
                if (
                    group.key === 'marketplaces' &&
                    BM_SETTINGS.offerShops.kleinanzeigen
                ) {
                    kleinanzeigenFeedback = document.createElement('div');
                    kleinanzeigenFeedback.className = 'bm-kleinanzeigen-feedback';
                    kleinanzeigenFeedback.setAttribute('role', 'status');
                    kleinanzeigenFeedback.setAttribute('aria-live', 'polite');
                    kleinanzeigenFeedback.hidden = true;
                }
                const previous = document.createElement("button");
                previous.type = "button";
                previous.className = "bm-link-scroll bm-link-scroll-prev";
                previous.title = "Nach links";
                previous.setAttribute("aria-label", `${group.title}: nach links`);
                previous.appendChild(document.createElement("span"));
                const next = document.createElement("button");
                next.type = "button";
                next.className = "bm-link-scroll bm-link-scroll-next";
                next.title = "Nach rechts";
                next.setAttribute("aria-label", `${group.title}: nach rechts`);
                next.appendChild(document.createElement("span"));

                // iOS Safari übernimmt für dynamische Buttons gelegentlich die
                // großen roten Brickmerge-Standardwerte. Die kritischen Maße
                // und Farben stehen deshalb zusätzlich direkt am Element.
                [previous, next].forEach(control => {
                    const fixedStyles = {
                        display: 'none',
                        position: 'absolute',
                        top: '50%',
                        zIndex: '5',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '1.65rem',
                        height: '1.65rem',
                        minWidth: '1.65rem',
                        minHeight: '1.65rem',
                        margin: '0',
                        padding: '0',
                        transform: 'translateY(-50%)',
                        background: '#fff',
                        border: '1px solid #aaa',
                        borderRadius: '50%',
                        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
                        color: '#a80000',
                        lineHeight: '1',
                        boxSizing: 'border-box'
                    };
                    Object.entries(fixedStyles).forEach(([property, value]) => {
                        control.style.setProperty(
                            property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`),
                            value,
                            'important'
                        );
                    });
                    control.style.setProperty('-webkit-appearance', 'none', 'important');
                });
                previous.style.setProperty('left', '0.15rem', 'important');
                next.style.setProperty('right', '0.15rem', 'important');

                for (const {
                    id,
                    name,
                    url,
                    icon,
                    icons,
                    secondaryUrl,
                    secondaryIcon
                } of group.links) {
                    if (secondaryUrl && secondaryIcon) {
                        const dualLink = document.createElement('span');
                        dualLink.className = 'bm-link bm-meta-dual-link';

                        const siteLink = document.createElement('a');
                        siteLink.className = 'bm-meta-site-link';
                        siteLink.href = url;
                        siteLink.target = '_blank';
                        siteLink.rel = 'noopener noreferrer';
                        siteLink.title = 'Set im Meta-Preisvergleich suchen';
                        const siteIcon = document.createElement('img');
                        siteIcon.src = icon;
                        siteIcon.alt = '';
                        const siteLabel = document.createElement('span');
                        siteLabel.className = 'bm-link-label';
                        siteLabel.textContent = name;
                        siteLink.append(siteIcon, siteLabel);

                        const secondaryLink = document.createElement('a');
                        secondaryLink.className = 'bm-meta-gpt-trigger';
                        secondaryLink.href = secondaryUrl;
                        secondaryLink.target = '_blank';
                        secondaryLink.rel = 'noopener noreferrer';
                        secondaryLink.title = 'Set mit vorbereitetem Prompt im Meta-GPT suchen';
                        if (id) secondaryLink.dataset.bmid = id;
                        secondaryLink.dataset.bmDefaultLabel = name;
                        const gptIcon = document.createElement('img');
                        gptIcon.src = secondaryIcon;
                        gptIcon.alt = 'Meta-GPT';
                        secondaryLink.appendChild(gptIcon);

                        dualLink.append(siteLink, secondaryLink);
                        row.appendChild(dualLink);
                        continue;
                    }

                    const a = document.createElement("a");
                    a.href = url; a.target = "_blank"; a.className = "bm-link";
                    if (id) a.dataset.bmid = id;
                    if (Array.isArray(icons) && icons.length) {
                        const iconGroup = document.createElement('span');
                        iconGroup.className = 'bm-link-icons';
                        icons.forEach(source => {
                            const image = document.createElement('img');
                            image.src = source;
                            image.alt = '';
                            iconGroup.appendChild(image);
                        });
                        a.appendChild(iconGroup);
                    } else {
                        const img = document.createElement("img");
                        img.src = icon;
                        img.alt = "";
                        a.appendChild(img);
                    }
                    const span = document.createElement("span");
                    span.className = 'bm-link-label';
                    span.textContent = name;
                    a.dataset.bmDefaultLabel = name;
                    a.appendChild(span);
                    row.appendChild(a);
                }
                viewport.appendChild(row);
                slider.appendChild(viewport);
                slider.appendChild(previous);
                slider.appendChild(next);
                section.appendChild(title);
                section.appendChild(slider);
                if (kleinanzeigenFeedback) {
                    document.addEventListener(
                        'bm-kleinanzeigen-request-state',
                        event => {
                            const message = String(event.detail?.message || '');
                            kleinanzeigenFeedback.textContent = message;
                            kleinanzeigenFeedback.hidden = !message;
                        }
                    );
                    section.appendChild(kleinanzeigenFeedback);
                }
                container.appendChild(section);
            }
            return container;
        }

        function findLinkPanels() {
            const panels = new Set(document.querySelectorAll(
                '#bm-link-panel, .bm-link-panel, [data-bm-link-panel="true"]'
            ));
            document.querySelectorAll('.bm-info-group').forEach(group => {
                const candidate = group.parentElement;
                if (!candidate) return;
                const children = Array.from(candidate.children);
                if (children.length && children.every(child =>
                    child.classList.contains('bm-info-group')
                )) {
                    panels.add(candidate);
                }
            });
            return Array.from(panels);
        }

        function removeDuplicateLinkPanels(keep = null) {
            findLinkPanels().forEach(panel => {
                if (panel !== keep) panel.remove();
            });
        }

        function setupLinkSliders(container) {
            container.querySelectorAll('.bm-link-slider').forEach(slider => {
                const viewport = slider.querySelector('.bm-link-viewport');
                const previous = slider.querySelector('.bm-link-scroll-prev');
                const next = slider.querySelector('.bm-link-scroll-next');

                const update = () => {
                    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
                    const showPrevious = viewport.scrollLeft > 2;
                    const showNext = viewport.scrollLeft < maxScroll - 2;
                    previous.classList.toggle('is-visible', showPrevious);
                    next.classList.toggle('is-visible', showNext);
                    previous.style.setProperty(
                        'display',
                        showPrevious ? 'flex' : 'none',
                        'important'
                    );
                    next.style.setProperty(
                        'display',
                        showNext ? 'flex' : 'none',
                        'important'
                    );
                };
                const scroll = direction => {
                    viewport.scrollBy({
                        left: direction * Math.max(160, viewport.clientWidth * 0.75),
                        behavior: 'smooth'
                    });
                };

                previous.addEventListener('click', () => scroll(-1));
                next.addEventListener('click', () => scroll(1));
                viewport.addEventListener('scroll', update, { passive: true });
                window.addEventListener('resize', update);
                if (typeof ResizeObserver === 'function') {
                    const resizeObserver = new ResizeObserver(update);
                    resizeObserver.observe(viewport);
                    resizeObserver.observe(viewport.querySelector('.bm-info-links'));
                }
                requestAnimationFrame(update);
            });
        }

        function injectBox() {
            if (!BM_SETTINGS.linkPanel) {
                removeDuplicateLinkPanels();
                fetchAndInjectPrices(setNum);
                return;
            }
            let container = document.querySelector('div[id^="chartdiv"]')?.closest('.large-9.columns');
            if (!container) {
                container = document.querySelector('#offerlist')?.closest('.large-9.columns') || document.querySelector('.large-9.columns');
            }
            if (!container) return;
            const existingPanel = document.getElementById('bm-link-panel');
            if (existingPanel) {
                removeDuplicateLinkPanels(existingPanel);
                syncMarketplaceShortcutLinks();
                fetchAndInjectPrices(setNum);
                return;
            }
            removeDuplicateLinkPanels();
            const box = buildBox();
            const insertTarget = document.querySelector('div[id^="chartdiv"]') || document.querySelector('#offerlist');
            if (insertTarget) {
                insertTarget.parentNode.insertBefore(box, insertTarget);
            } else {
                container.appendChild(box);
            }
            removeDuplicateLinkPanels(box);
            const linkPanelParent = box.parentElement;
            if (linkPanelParent) {
                const duplicatePanelObserver = new MutationObserver(() => {
                    removeDuplicateLinkPanels(box);
                });
                duplicatePanelObserver.observe(linkPanelParent, { childList: true });
            }
            setupLinkSliders(box);
            setupMetaGptLink(box);
            syncMarketplaceShortcutLinks();
            const offerlist = document.getElementById('offerlist');
            if (offerlist) {
                let shortcutSyncTimer = 0;
                const scheduleShortcutSync = () => {
                    window.clearTimeout(shortcutSyncTimer);
                    shortcutSyncTimer = window.setTimeout(
                        syncMarketplaceShortcutLinks,
                        50
                    );
                };
                const offerRowSelector =
                    '.medium-4.small-9.columns.pricerow[data-mid]';
                const containsOfferRow = node =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.matches?.(offerRowSelector) ||
                        node.querySelector?.(offerRowSelector));
                const marketplaceOfferObserver = new MutationObserver(records => {
                    const hasOfferRowChange = records.some(record =>
                        Array.from(record.addedNodes).some(containsOfferRow) ||
                        Array.from(record.removedNodes).some(containsOfferRow)
                    );
                    if (hasOfferRowChange) scheduleShortcutSync();
                });
                marketplaceOfferObserver.observe(offerlist, {
                    childList: true,
                    subtree: true
                });
            }
            fetchAndInjectPrices(setNum);
        }

        if (document.readyState !== "loading") injectBox();
        else window.addEventListener("DOMContentLoaded", injectBox);

        // --- PREIS-ABFRAGE & INTEGRATION ---
        function fetchAndInjectPrices(setNumber) {
            const offersByKey = new Map();
            const normalizeMerchantText = value => String(value || '')
                .toLocaleLowerCase('de')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/ü/g, 'u')
                .replace(/\s+/g, ' ')
                .trim();
            const getNativeMerchantEntries = () => Array.from(document.querySelectorAll(
                    '#offerlist .medium-4.small-9.columns.pricerow[data-mid]' +
                    ':not([data-bm-marketplace="true"])'
                )).filter(priceRow =>
                    !priceRow.closest('#soldOut') &&
                    priceRow.dataset.bmSoldOut !== 'true'
                ).map(priceRow => {
                    const mid = priceRow.dataset.mid;
                    const merchant = priceRow.querySelector('.merchant')?.textContent || '';
                    const logo = mid
                        ? document.getElementById(`mid${mid}`)?.querySelector('img[alt]')?.alt || ''
                        : '';
                    const link = priceRow.querySelector(':scope > a');
                    const tooltip = link?.dataset.bmOriginalTooltip ||
                        link?.getAttribute('title') ||
                        '';
                    const haystack = normalizeMerchantText(
                        `${merchant} ${logo} ${tooltip}`
                    );
                    return { priceRow, haystack };
                });
            const syncOffers = () => {
                // Alle nativen Händler werden pro Synchronisierung nur einmal
                // gelesen. Zuvor wurde die komplette Offerlist für jeden
                // einzelnen Zusatzanbieter erneut durchsucht.
                const nativeMerchantEntries = getNativeMerchantEntries();
                const hasNativeMerchant = aliases => {
                    const normalizedAliases = aliases.map(normalizeMerchantText);
                    return nativeMerchantEntries.some(entry =>
                        normalizedAliases.some(alias =>
                            entry.haystack === alias ||
                            entry.haystack.startsWith(`${alias} `) ||
                            entry.haystack.includes(`link zu ${alias} `)
                        )
                    );
                };
                const offers = Array.from(offersByKey.values()).filter(offer => {
                    if (!BM_isOfferShopEnabled(offer.key)) return false;
                    if (offer.key === 'mueller-search') {
                        return !hasNativeMerchant(['müller', 'mueller']);
                    }
                    return true;
                });
                injectMarketplaceOffers(offers);
                syncMarketplaceShortcutLinks();
            };
            const storeOffers = offers => {
                offers.filter(Boolean).forEach(offer => {
                    offersByKey.set(offer.key, offer);
                });
                syncOffers();
            };
            function parseBrickbankVendorOffer(jsonText, vendorPattern) {
                let payload;
                try {
                    payload = JSON.parse(jsonText);
                } catch (error) {
                    return null;
                }

                const entries = payload?.pvg && typeof payload.pvg === 'object'
                    ? Object.values(payload.pvg)
                    : [];
                const vendorOffer = entries.find(entry => {
                    const haystack = [
                        entry?.vendor,
                        entry?.name,
                        entry?.shop,
                        entry?.link
                    ].filter(Boolean).join(' ');
                    return vendorPattern.test(haystack);
                });
                const price = Number(String(vendorOffer?.preis ?? '').replace(',', '.'));
                if (!vendorOffer || !Number.isFinite(price) || price <= 0) return null;

                return {
                    price,
                    url: String(vendorOffer.link || '').trim(),
                    availability: String(vendorOffer.availability || '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                };
            }
            function parseBrickLinkPrice(priceText) {
                const match = String(priceText || '').match(
                    /(?:EUR|€)\s*([\d.,]+)|([\d.,]+)\s*(?:EUR|€)/i
                );
                if (!match) return null;

                const raw = match[1] || match[2];
                const comma = raw.lastIndexOf(',');
                const dot = raw.lastIndexOf('.');
                let normalized = raw;
                if (comma >= 0 && dot >= 0) {
                    normalized = comma > dot
                        ? raw.replace(/\./g, '').replace(',', '.')
                        : raw.replace(/,/g, '');
                } else if (comma >= 0) {
                    normalized = raw.replace(',', '.');
                }

                const price = Number(normalized);
                return Number.isFinite(price) && price > 0 ? price : null;
            }
            function parseBrickOwlGermanOffers(html, fallbackUrl) {
                try {
                    const payload = JSON.parse(html);
                    if (Array.isArray(payload?.aaData)) {
                        html = '<table class="buy-table"><tbody>' +
                            payload.aaData.map(cells =>
                                '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
                            ).join('') +
                            '</tbody></table>';
                    }
                } catch {
                    // Normale Such- und Katalogseiten sind HTML.
                }
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const rows = Array.from(doc.querySelectorAll(
                    '#buy table.buy-table > tbody > tr, ' +
                    'table.buy-table > tbody > tr'
                ));
                const offers = rows.map(row => {
                    const cells = Array.from(row.children);
                    if (cells.length < 7) return null;

                    const rowText = (row.textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const condition = (cells[1].textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (!/New\s*\(Sealed\)|Neu\s*\((?:Sealed|Versiegelt|Verschlossen|Ungeöffnet|Originalverpackt)\)|\bNeu\b/i.test(condition || rowText)) {
                        return null;
                    }

                    const flag = cells[6].querySelector('img.flag');
                    const country = `${flag?.alt || ''} ${flag?.title || ''} ${cells[6].textContent || ''}`;
                    if (!/\bGermany\b|Deutschland/i.test(country)) return null;

                    const price = parseBrickLinkPrice(cells[4].textContent || '');
                    if (price === null) return null;

                    const total = parseBrickLinkPrice(cells[5].textContent || '');
                    const shippingFromStore = parseBrickLinkPrice(
                        (cells[6].textContent || '').match(/(?:Shipping|Versand)\s*(?:~\s*)?(€?\s*[\d.,]+|[\d.,]+\s*€)/i)?.[1] || ''
                    );
                    const shippingCost = total !== null
                        ? Math.max(0, Math.round(((total - price) + Number.EPSILON) * 100) / 100)
                        : shippingFromStore;
                    const shippingStatus = shippingCost === null
                        ? 'unknown'
                        : shippingCost <= 0.004
                            ? 'free'
                            : 'paid';
                    const storeLink = cells[6].querySelector('.after-flag a[href]') ||
                        cells[6].querySelector('a[href]');
                    const itemLink = cells[2].querySelector('a[href]') ||
                        cells[0].querySelector('a[href]');
                    const href = itemLink?.getAttribute('href') ||
                        storeLink?.getAttribute('href') ||
                        fallbackUrl;
                    const storeName = (storeLink?.textContent || '').trim();

                    return {
                        price,
                        total: total !== null ? total : null,
                        sortPrice: total !== null ? total : price,
                        shippingCost,
                        shippingStatus,
                        storeName,
                        url: new URL(href, 'https://www.brickowl.com').href
                    };
                }).filter(Boolean);

                if (offers.length === 0) return null;
                offers.sort((a, b) =>
                    (a.sortPrice - b.sortPrice) || (a.price - b.price)
                );
                return {
                    ...offers[0],
                    totalLots: offers.length
                };
            }
            function findBrickOwlCatalogUrl(html, setNumber, baseUrl) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const canonical = doc.querySelector(
                    'link[rel="canonical"][href*="/catalog/"]'
                )?.getAttribute('href');
                if (canonical && !/\/search\//i.test(canonical)) {
                    return new URL(canonical, baseUrl).href;
                }

                const escapedSetNumber = String(setNumber)
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const setPattern = new RegExp(
                    `(?:^|[^0-9])${escapedSetNumber}(?:[^0-9]|$)`
                );
                const link = Array.from(
                    doc.querySelectorAll('a[href*="/catalog/"]')
                ).find(anchor => {
                    const href = anchor.getAttribute('href') || '';
                    const label = anchor.textContent || '';
                    return setPattern.test(`${href} ${label}`);
                });
                return link ? new URL(link.getAttribute('href'), baseUrl).href : '';
            }
            function findBrickOwlOfferDataUrl(html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                for (const script of doc.scripts) {
                    const text = (script.textContent || '').trim();
                    if (!text.startsWith('{') || !text.includes('"catalog"')) continue;
                    try {
                        const settings = JSON.parse(text);
                        const itemId = String(settings?.catalog?.item_id || '').trim();
                        const token = String(settings?.helper?.token || '').trim();
                        if (!/^\d{1,12}$/.test(itemId) ||
                            !/^[A-Za-z0-9_-]{20,120}$/.test(token)) continue;
                        const target = new URL('https://www.brickowl.com/ajax/dt_buy');
                        target.searchParams.set('item_id', itemId);
                        target.searchParams.set('token', token);
                        target.searchParams.set('iDisplayStart', '0');
                        target.searchParams.set('iDisplayLength', '100');
                        target.searchParams.set('iSortCol_0', '4');
                        target.searchParams.set('sSortDir_0', 'asc');
                        return target.href;
                    } catch {
                        // Andere JSON-Skripte auf der Seite ignorieren.
                    }
                }
                return '';
            }
            function getResponseHeader(headers, name) {
                const target = name.toLowerCase();
                for (const line of String(headers || '').split(/\r?\n/)) {
                    const separatorIndex = line.indexOf(':');
                    if (separatorIndex < 0) continue;
                    const key = line.slice(0, separatorIndex).trim().toLowerCase();
                    if (key === target) {
                        return line.slice(separatorIndex + 1).trim();
                    }
                }
                return '';
            }
            const createOffer = (
                buttonId,
                label,
                priceText,
                logoUrl,
                source,
                priceSource = '',
                extra = {}
            ) => {
                const button = document.querySelector(`a[data-bmid="${buttonId}"]`);
                const targetUrl = extra.url || button?.href || '';
                if (!targetUrl || !priceText) return null;
                const configuredSearchUrl = groups
                    .flatMap(group => group.links)
                    .find(link => link.id === buttonId)?.url || '';
                const searchUrl = String(extra.searchUrl || '').trim() ||
                    button?.href || configuredSearchUrl;
                return {
                    key: buttonId.replace(/^btn-/, ''),
                    label,
                    priceText,
                    url: targetUrl,
                    logoUrl,
                    source,
                    priceSource,
                    ...extra,
                    searchUrl
                };
            };

            const getBrickmergeBestPrice = () => {
                const prices = Array.from(document.querySelectorAll(
                    '#offerlist .medium-4.small-9.columns.pricerow' +
                    ':not([data-bm-marketplace="true"])'
                )).filter(priceRow =>
                    !priceRow.closest('#soldOut') &&
                    priceRow.dataset.bmSoldOut !== 'true'
                ).map(priceRow => {
                    const priceSpan = priceRow.querySelector('span.price');
                    return priceSpan ? getBaseOfferPrice(priceSpan) : null;
                }).filter(price => Number.isFinite(price) && price > 0);
                return prices.length > 0 ? Math.min(...prices) : null;
            };

            void getWorkerClientId().then(workerClientId => {
                const ean = document.querySelector(
                    '.bm-ean-line-link[data-ean]'
                )?.dataset.ean || Array.from(
                    document.querySelectorAll('.content.setdetails p')
                ).find(paragraph => /EAN\s*:/i.test(paragraph.textContent || ''))
                    ?.textContent.match(/EAN\s*:\s*(\d{8}|\d{12,14})/i)?.[1] || '';

                if (/^\d{8}$|^\d{12,14}$/.test(ean)) {
                    cachedShopRequest(
                        'ebay',
                        makeApiCacheKey(
                            'ebay-worker-complete-set-v4',
                            `${ean}:${setNumber}`
                        ),
                        KLAZ_CLIENT_CACHE_TTL,
                        {
                            method: 'GET',
                            url:
                                `${BM_WORKER_URL}/price?ean=${encodeURIComponent(ean)}` +
                                `&set=${encodeURIComponent(setNumber)}`,
                            headers: {
                                'Accept': 'application/json',
                                'X-BM-Client-ID': workerClientId
                            },
                            timeout: 15000,
                            onload: response => {
                                let result;
                                try {
                                    result = JSON.parse(response.responseText);
                                } catch (error) {
                                    console.warn(
                                        'Brickmerge Tweaker: Ungültige eBay-Antwort des Preis-Workers.'
                                    );
                                    return;
                                }
                                if (!result?.found || !result.cheapest) return;

                                const cheapest = result.cheapest;
                                const shipping = Number(cheapest.shipping);
                                const itemPrice = Number(cheapest.itemPrice);
                                if (!Number.isFinite(itemPrice) ||
                                    !Number.isFinite(shipping)) return;
                                const sellerAccountType =
                                    getEbaySellerAccountType(cheapest);
                                const sellerTypeLabel = getEbaySellerTypeLabel(
                                    sellerAccountType
                                );
                                const sellerName = typeof cheapest.seller === 'string'
                                    ? cheapest.seller.trim()
                                    : String(
                                        cheapest.seller?.username ||
                                        cheapest.seller?.name ||
                                        cheapest.sellerName ||
                                        cheapest.merchantName ||
                                        ''
                                    ).trim();
                                const sellerDetails = [
                                    sellerTypeLabel
                                        ? `Verkäuferart: ${sellerTypeLabel}`
                                        : '',
                                    sellerName ? `Verkäufer: ${sellerName}` : ''
                                ].filter(Boolean).join('; ');
                                const offer = createOffer(
                                    'btn-ebay',
                                    'eBay',
                                    `${formatEuroValue(itemPrice)} €`,
                                    chrome.runtime.getURL(
                                        'icons/logo-ebay-minifig.png'
                                    ),
                                    'ebay-worker',
                                    `eBay: günstigstes von ${result.comparedOffers} neuen Angeboten${sellerDetails ? `; ${sellerDetails}` : ''}; ${cheapest.title}`,
                                    {
                                        url: cheapest.url,
                                        searchUrl: document.querySelector('a[data-bmid="btn-ebay"]')?.href || '',
                                        shippingStatus: shipping <= 0.004 ? 'free' : 'paid',
                                        shippingCost: shipping,
                                        logoDomainSuffix: '.de',
                                        logoCaption: sellerName || sellerTypeLabel,
                                        sellerAccountType,
                                        sellerName
                                    }
                                );
                                if (offer) storeOffers([offer]);
                            },
                            onerror: () => {
                                console.warn(
                                    'Brickmerge Tweaker: eBay-Abfrage beim Preis-Worker fehlgeschlagen.'
                                );
                            },
                            ontimeout: () => {
                                console.warn(
                                    'Brickmerge Tweaker: eBay-Abfrage beim Preis-Worker - Timeout.'
                                );
                            }
                        }
                    );
                    if (BM_isOfferShopEnabled('ebay-fr')) cachedShopRequest(
                        'ebay-fr',
                        makeApiCacheKey(
                            'ebay-fr-worker-complete-set-v2',
                            `${ean}:${setNumber}`
                        ),
                        KLAZ_CLIENT_CACHE_TTL,
                        {
                            method: 'GET',
                            url:
                                `${BM_WORKER_URL}/ebay-fr?ean=${encodeURIComponent(ean)}` +
                                `&set=${encodeURIComponent(setNumber)}`,
                            headers: {
                                'Accept': 'application/json',
                                'X-BM-Client-ID': workerClientId
                            },
                            timeout: 15000,
                            onload: response => {
                                let result;
                                try {
                                    result = JSON.parse(response.responseText);
                                } catch (error) {
                                    console.warn(
                                        'Brickmerge Tweaker: Ungültige eBay.fr-Antwort des Preis-Workers.'
                                    );
                                    return;
                                }
                                if (!result?.found || !result.cheapest) return;

                                const cheapest = result.cheapest;
                                const shipping = Number(cheapest.shipping);
                                const itemPrice = Number(cheapest.itemPrice);
                                if (!Number.isFinite(itemPrice) ||
                                    !Number.isFinite(shipping)) return;
                                const sellerAccountType =
                                    getEbaySellerAccountType(cheapest);
                                const sellerTypeLabel = getEbaySellerTypeLabel(
                                    sellerAccountType
                                );
                                const sellerName = typeof cheapest.seller === 'string'
                                    ? cheapest.seller.trim()
                                    : String(
                                        cheapest.seller?.username ||
                                        cheapest.seller?.name ||
                                        cheapest.sellerName ||
                                        cheapest.merchantName ||
                                        ''
                                    ).trim();
                                const sellerDetails = [
                                    sellerTypeLabel
                                        ? `Verkäuferart: ${sellerTypeLabel}`
                                        : '',
                                    sellerName ? `Verkäufer: ${sellerName}` : ''
                                ].filter(Boolean).join('; ');
                                const offer = createOffer(
                                    'btn-ebay-fr',
                                    'eBay.fr',
                                    `${formatEuroValue(itemPrice)} €`,
                                    chrome.runtime.getURL(
                                        'icons/logo-ebay-minifig.png'
                                    ),
                                    'ebay-fr-worker',
                                    `eBay.fr: günstigstes von ${result.comparedOffers} neuen Angeboten mit Lieferung nach Frankreich${sellerDetails ? `; ${sellerDetails}` : ''}; ${cheapest.title}`,
                                    {
                                        url: cheapest.url,
                                        searchUrl: document.querySelector('a[data-bmid="btn-ebay-fr"]')?.href || '',
                                        shippingStatus: shipping <= 0.004 ? 'free' : 'paid',
                                        shippingCost: shipping,
                                        logoDomainSuffix: '.fr',
                                        logoCaption: sellerName || sellerTypeLabel,
                                        logoCountryFlag: '🇫🇷',
                                        logoCountryLabel: 'Frankreich',
                                        sellerAccountType,
                                        sellerName
                                    }
                                );
                                if (offer) storeOffers([offer]);
                            },
                            onerror: () => {
                                console.warn(
                                    'Brickmerge Tweaker: eBay.fr-Abfrage beim Preis-Worker fehlgeschlagen.'
                                );
                            },
                            ontimeout: () => {
                                console.warn(
                                    'Brickmerge Tweaker: eBay.fr-Abfrage beim Preis-Worker - Timeout.'
                                );
                            }
                        }
                    );
                }

                const fetchAsyncApify = (
                    source,
                    startUrl,
                    cacheKey,
                    onResult,
                    onError,
                    extraHeaders = {},
                    maxAttempts = 45,
                    showGlobalLoading = false
                ) => {
                    let attempts = 0;
                    let settled = false;
                    const finish = () => {
                        if (settled) return false;
                        settled = true;
                        if (showGlobalLoading) {
                            setBackgroundLookupPending(source, false);
                        }
                        return true;
                    };
                    const succeed = payload => {
                        if (finish()) onResult?.(payload);
                    };
                    const fail = error => {
                        if (finish()) onError?.(error);
                    };
                    if (showGlobalLoading) {
                        setBackgroundLookupPending(source, true);
                    }
                    const resolveStatusUrl = value => {
                        try {
                            return BM_resolveWorkerUrl(value, BM_WORKER_URL);
                        } catch (error) {
                            fail({ code: 'invalid-status-url', cause: error });
                            return '';
                        }
                    };
                    const poll = statusUrl => {
                        attempts += 1;
                        if (attempts > maxAttempts) {
                            fail({ code: 'timeout' });
                            return;
                        }
                        cachedShopRequest(
                            source,
                            `${cacheKey}-status-${attempts}-${Date.now()}`,
                            0,
                            {
                                method: 'GET',
                                url: statusUrl,
                                headers: { Accept: 'application/json', 'X-BM-Client-ID': workerClientId, ...extraHeaders },
                                timeout: 15000,
                                onload: response => {
                                    let payload = null;
                                    try { payload = JSON.parse(response.responseText); } catch (error) {}
                                    if (response.status === 202 || payload?.pending) {
                                        const nextStatusUrl = resolveStatusUrl(
                                            payload?.statusUrl || statusUrl
                                        );
                                        if (!nextStatusUrl) return;
                                        window.setTimeout(
                                            () => poll(nextStatusUrl),
                                            Number(payload?.pollAfterMs) || 2000
                                        );
                                        return;
                                    }
                                    if (response.status >= 400 || payload?.error) {
                                        fail(payload || { status: response.status });
                                        return;
                                    }
                                    succeed(payload);
                                },
                                onerror: fail,
                                ontimeout: () => fail({ code: 'timeout' })
                            }
                        );
                    };
                    const start = new URL(startUrl);
                    start.searchParams.set('async', '1');
                    cachedShopRequest(source, `${cacheKey}-start`, 0, {
                        method: 'GET',
                        url: start.href,
                        headers: { Accept: 'application/json', 'X-BM-Client-ID': workerClientId, ...extraHeaders },
                        timeout: 30000,
                        onload: response => {
                            let payload = null;
                            try { payload = JSON.parse(response.responseText); } catch (error) {}
                            if (response.status < 400 && payload && !payload.pending && !payload.jobId) {
                                succeed(payload);
                                return;
                            }
                            if (response.status >= 400 || !payload?.jobId) {
                                fail(payload || { status: response.status });
                                return;
                            }
                            const statusUrl = resolveStatusUrl(payload.statusUrl);
                            if (statusUrl) poll(statusUrl);
                        },
                        onerror: fail,
                        ontimeout: () => fail({ code: 'timeout' })
                    });
                };

                const apifyMarketplaceConfigs = new Map([
                    ['vinted', { label: 'Vinted', logoDomain: 'vinted.de' }],
                    ['leboncoin', { label: 'Leboncoin', logoDomain: 'leboncoin.fr' }],
                    ['stockx', { label: 'StockX', logoDomain: 'stockx.com' }]
                ]);
                const selectPlausibleMarketplaceOffer = (
                    source,
                    result,
                    referencePrice,
                    getPrice = offer => Number(offer?.total ?? offer?.price)
                ) => {
                    const candidates = [
                        result?.cheapest,
                        ...(Array.isArray(result?.offers) ? result.offers : [])
                    ].filter(Boolean);
                    const seen = new Set();
                    return candidates
                        .filter(candidate => {
                            const price = getPrice(candidate);
                            const identity = `${candidate?.url || ''}:${price}`;
                            if (seen.has(identity)) return false;
                            seen.add(identity);
                            return BM_isMarketplacePricePlausible(
                                source,
                                price,
                                referencePrice
                            );
                        })
                        .sort((left, right) => getPrice(left) - getPrice(right))[0] || null;
                };
                const applyApifyMarketplaceResult = (
                    source,
                    label,
                    logoDomain,
                    rawResult
                ) => {
                    const result = rawResult?.result || rawResult?.data || rawResult;
                    if (!result?.found || !result.cheapest) return false;
                    const brickmergeBestPrice = getBrickmergeBestPrice();
                    const cheapest = selectPlausibleMarketplaceOffer(
                        source,
                        result,
                        brickmergeBestPrice
                    );
                    if (!cheapest) {
                        console.info(
                            `Brickmerge Tweaker: ${label}-Angebot unterhalb der 50%-Plausibilitätsgrenze verworfen.`
                        );
                        return false;
                    }
                    const total = Number(cheapest.total ?? cheapest.price);
                    if (!Number.isFinite(total) || total <= 0) return false;
                    const shippingCost = Number(cheapest.shippingCost);
                    const transactionFee = Number(cheapest.transactionFee);
                    const shippingStatus = Number.isFinite(shippingCost)
                        ? (shippingCost <= 0.004 ? 'free' : 'paid')
                        : 'unknown';
                    const stockxCurrencyNote = source === 'stockx'
                        ? 'StockX-DE Lowest Ask in EUR; Versand und StockX-Gebühren kommen gegebenenfalls hinzu; '
                        : '';
                    const offer = createOffer(
                        `btn-${source}`,
                        label,
                        `${formatEuroValue(total)} €`,
                        source === 'vinted'
                            ? chrome.runtime.getURL('icons/logo-vinted.png')
                            : source === 'leboncoin'
                                ? chrome.runtime.getURL('icons/logo-leboncoin.png')
                                : source === 'stockx'
                                    ? chrome.runtime.getURL('icons/logo-stockx.svg')
                                    : icon(logoDomain),
                        `${source}-apify`,
                        `${label}: günstigstes von ${result.comparedOffers} passenden Angeboten; ${stockxCurrencyNote}Gesamtpreis${Number.isFinite(transactionFee) ? ` inklusive geschätzter Transaktionsgebühr ${formatEuroValue(transactionFee)} €` : ''}; ${cheapest.title}`,
                        {
                            url: cheapest.url,
                            searchUrl: document.querySelector(
                                `a[data-bmid="btn-${source}"]`
                            )?.href || '',
                            logoText: '',
                            logoClass: source === 'stockx'
                                ? 'bm-stockx-logo'
                                : '',
                            shippingStatus,
                            shippingCost: Number.isFinite(shippingCost)
                                ? shippingCost
                                : null
                        }
                    );
                    if (!offer) return false;
                    storeOffers([offer]);
                    return true;
                };
                const fetchApifyMarketplaceOffer = (source, label, logoDomain) => {
                    if (!BM_isOfferShopEnabled(source)) return;
                    const brickmergeBestPrice = getBrickmergeBestPrice();
                    const requestUrl = new URL(`${BM_WORKER_URL}/${source}`);
                    requestUrl.searchParams.set('set', setNumber);
                    requestUrl.searchParams.set('cache', 'only');
                    if (brickmergeBestPrice !== null) {
                        requestUrl.searchParams.set('best', brickmergeBestPrice.toFixed(2));
                    }
                    fetchAsyncApify(
                        source,
                        requestUrl.href,
                        makeApiCacheKey(
                            `${source}-apify-${source === 'stockx' ? 'v4' : 'v2'}`,
                            `${setNumber}:${brickmergeBestPrice ?? 'none'}`
                        ),
                        result => applyApifyMarketplaceResult(
                            source,
                            label,
                            logoDomain,
                            result
                        ),
                        error => console.warn(
                            `Brickmerge Tweaker: ${label}-Abfrage fehlgeschlagen.`,
                            error
                        )
                    );
                };
                apifyMarketplaceConfigs.forEach((config, source) => {
                    fetchApifyMarketplaceOffer(
                        source,
                        config.label,
                        config.logoDomain
                    );
                });

                const fetchIdealoOffers = () => {
                    if (!/^\d{8}$|^\d{12,14}$/.test(ean) || !BM_isOfferShopEnabled('idealo')) return;
                    const brickmergeBestPrice = getBrickmergeBestPrice();
                    const requestUrl = new URL(`${BM_WORKER_URL}/idealo`);
                    requestUrl.searchParams.set('ean', ean);
                    requestUrl.searchParams.set('cache', 'only');
                    if (brickmergeBestPrice !== null) {
                        requestUrl.searchParams.set('best', brickmergeBestPrice.toFixed(2));
                    }
                    fetchAsyncApify(
                        'idealo',
                        requestUrl.href,
                        makeApiCacheKey(
                            'idealo-apify-v3',
                            `${ean}:${brickmergeBestPrice ?? 'none'}`
                        ),
                        result => {
                                if (!result?.found || !Array.isArray(result.offers)) {
                                    publishIdealoRequestState('empty');
                                    return;
                                }
                                const plausibleOffers = result.offers.filter(entry =>
                                    BM_isMarketplacePricePlausible(
                                        'idealo',
                                        Number(entry?.price ?? entry?.total),
                                        brickmergeBestPrice
                                    )
                                );
                                if (plausibleOffers.length === 0) {
                                    console.info(
                                        'Brickmerge Tweaker: Idealo-Angebote unterhalb der 50%-Plausibilitätsgrenze verworfen.'
                                    );
                                    publishIdealoRequestState('empty');
                                    return;
                                }
                                const idealoFallbackLogo = chrome.runtime.getURL('icons/logo-idealo.jpg');
                                plausibleOffers.slice(0, 3).forEach((entry, index) => {
                                    const itemPrice = Number(entry.price ?? entry.total);
                                    const total = Number(entry.total ?? itemPrice);
                                    if (!Number.isFinite(itemPrice) || itemPrice <= 0 ||
                                        !Number.isFinite(total) || total <= 0) return;
                                    const shippingCost = Number(entry.shippingCost);
                                    const shopName = String(entry.shopName || '').trim();
                                    const shopKey = shopName.toLocaleLowerCase('fr-FR');
                                    const merchantLogo = /cdiscount/i.test(shopKey)
                                        ? chrome.runtime.getURL('icons/logo-cdiscount.png')
                                        : /\bfnac\b/i.test(shopKey)
                                            ? chrome.runtime.getURL('icons/logo-fnac.png')
                                            : null;
                                    const idealoOverviewUrl =
                                        document.querySelector('a[data-bmid="btn-idealo"]')?.href ||
                                        `https://www.idealo.fr/rslt.html?q=${encodeURIComponent(ean)}`;
                                    const offer = createOffer(
                                        `btn-idealo-${index + 1}`,
                                        shopName || 'Idealo FR',
                                        `${formatEuroValue(itemPrice)} €`,
                                        merchantLogo || entry.logoUrl || idealoFallbackLogo,
                                        'idealo-apify',
                                        `Idealo FR: günstigstes von ${result.comparedOffers} Angeboten; ${entry.title || ''}`,
                                        {
                                            // Idealo-Händlerlinks sind teilweise nicht
                                            // dauerhaft gültig. Alle Preiszeilen nutzen
                                            // deshalb denselben stabilen Link wie die Bubble.
                                            url: idealoOverviewUrl,
                                            logoClass: merchantLogo
                                                ? /\bfnac\b/i.test(shopKey)
                                                    ? 'bm-idealo-fnac-logo'
                                                    : 'bm-idealo-merchant-logo'
                                                : entry.logoUrl
                                                    ? ''
                                                    : 'bm-idealo-logo',
                                            logoCaption: shopName
                                                ? 'via Idealo FR'
                                                : 'Idealo FR',
                                            logoFallbackUrl: idealoFallbackLogo,
                                            shippingStatus: Number.isFinite(shippingCost)
                                                ? (shippingCost <= 0.004 ? 'free' : 'paid')
                                                : 'unknown',
                                            shippingCost: Number.isFinite(shippingCost) ? shippingCost : null
                                        }
                                    );
                                    if (offer) storeOffers([offer]);
                                });
                                publishIdealoRequestState('done');
                        },
                        error => {
                            publishIdealoRequestState('error');
                            console.warn('Brickmerge Tweaker: Idealo-Abfrage fehlgeschlagen.', error);
                        },
                        {},
                        30
                    );
                };
                idealoRequestHandler = fetchIdealoOffers;
                if (globalThis.BM_DB_UNIFIED_REFRESH === true) {
                    fetchIdealoOffers();
                } else if (idealoRequestPending) {
                    idealoRequestPending = false;
                    fetchIdealoOffers();
                }

                // Der gemeinsame Preisabruf meldet jede fertige Quelle sofort.
                // Apify-Ergebnisse koennen ohne Seitenreload direkt in dieselbe
                // Offer-Map uebernommen werden; Idealo liest den soeben gefuellten
                // Worker-Cache erneut ein.
                document.addEventListener(
                    'bm-marketplace-source-update',
                    event => {
                        const detail = event.detail || {};
                        if (String(detail.setNumber || '') !== String(setNumber) ||
                            detail.state !== 'ready') return;
                        const config = apifyMarketplaceConfigs.get(detail.source);
                        if (config && BM_isOfferShopEnabled(detail.source)) {
                            applyApifyMarketplaceResult(
                                detail.source,
                                config.label,
                                config.logoDomain,
                                detail.payload
                            );
                        } else if (detail.source === 'idealo' &&
                            BM_isOfferShopEnabled('idealo')) {
                            fetchIdealoOffers();
                        }
                    }
                );

                const kleinanzeigenCreditsMessage =
                    'Kleinanzeigen konnte nicht abgefragt werden: Die API-Credits ' +
                    'des Worker-Secrets sind aufgebraucht und auch der Apify-Fallback ' +
                    'konnte kein Ergebnis liefern. Bitte später erneut versuchen.';
                const kleinanzeigenGenericErrorMessage =
                    'Der Kleinanzeigen-Preis konnte nicht geladen werden. ' +
                    'Bitte später erneut versuchen.';
                const getKleinanzeigenErrorText = value => {
                    if (!value) return '';
                    if (typeof value === 'string') return value;
                    const parts = [
                        value.message,
                        value.error,
                        value.detail,
                        value.reason,
                        value.code,
                        value.responseText
                    ].filter(Boolean);
                    try {
                        parts.push(JSON.stringify(value));
                    } catch (error) {
                        // Einzelne Felder reichen aus, falls das Objekt zyklisch ist.
                    }
                    return parts.join(' ');
                };
                const isKleinanzeigenCreditsError = (value, status = 0) => {
                    const text = getKleinanzeigenErrorText(value);
                    const mentionsCredits =
                        /credits?|quota|kontingent|guthaben|budget|rate.?limit/i.test(text);
                    const mentionsExhaustion =
                        /aufgebraucht|erschöpft|verbraucht|exhausted|insufficient|empty|remaining\s*[:=]?\s*0|limit\s*(?:reached|erreicht)/i.test(text);
                    return Number(status) === 402 ||
                        (Number(status) === 429 && mentionsCredits) ||
                        (mentionsCredits && mentionsExhaustion);
                };
                const publishKleinanzeigenFailure = (error, fallbackMessage) => {
                    const status = Number(error?.status) || 0;
                    if (isKleinanzeigenCreditsError(error, status)) {
                        publishKleinanzeigenRequestState(
                            'credits-exhausted',
                            kleinanzeigenCreditsMessage
                        );
                        return;
                    }
                    publishKleinanzeigenRequestState(
                        'error',
                        fallbackMessage || kleinanzeigenGenericErrorMessage
                    );
                };

                const getKleinanzeigenRequestContext = () => {
                    const brickmergeBestPrice = getBrickmergeBestPrice();
                    const reference = brickmergeBestPrice === null
                        ? 'none'
                        : brickmergeBestPrice.toFixed(2);
                    return {
                        brickmergeBestPrice,
                        cacheKey: makeApiCacheKey(
                            'kleinanzeigen-worker-condition-new-v6',
                            `${setNumber}:${reference}`
                        )
                    };
                };

                let kleinanzeigenRequestStarted = false;
                const fetchKleinanzeigenOffer = async ({ silentCache = false } = {}) => {
                    if (kleinanzeigenRequestStarted) {
                        publishKleinanzeigenRequestState(kleinanzeigenRequestState);
                        return;
                    }
                    if (!BM_isOfferShopEnabled('kleinanzeigen')) {
                        publishKleinanzeigenRequestState(
                            'error',
                            'Die Kleinanzeigen-Abfrage ist in den Einstellungen deaktiviert.'
                        );
                        return;
                    }
                    kleinanzeigenRequestStarted = true;
                    if (!silentCache) publishKleinanzeigenRequestState('loading');

                    const {
                        brickmergeBestPrice,
                        cacheKey
                    } = getKleinanzeigenRequestContext();
                    const kleinanzeigenUrl = new URL(
                        `${BM_WORKER_URL}/kleinanzeigen`
                    );
                    kleinanzeigenUrl.searchParams.set('set', setNumber);
                    if (brickmergeBestPrice !== null) {
                        kleinanzeigenUrl.searchParams.set(
                            'best',
                            brickmergeBestPrice.toFixed(2)
                        );
                    }

                    fetchAsyncApify(
                        'kleinanzeigen',
                        kleinanzeigenUrl.href,
                        cacheKey,
                        result => {
                                if (result?.error || result?.ok === false) {
                                    kleinanzeigenRequestStarted = false;
                                    publishKleinanzeigenFailure(result);
                                    return;
                                }
                                if (!result?.found || !result.cheapest) {
                                    console.info(
                                        'Brickmerge Tweaker: Keine deutschlandweiten Kleinanzeigen-Angebote für dieses Set mit Zustand Neu gefunden.'
                                    );
                                    publishKleinanzeigenRequestState('done');
                                    return;
                                }

                                const cheapest = selectPlausibleMarketplaceOffer(
                                    'kleinanzeigen',
                                    result,
                                    brickmergeBestPrice,
                                    offer => Number(offer?.price ?? offer?.total)
                                );
                                if (!cheapest) {
                                    console.info(
                                        'Brickmerge Tweaker: Kleinanzeigen-Angebote unterhalb der 50%-Plausibilitätsgrenze verworfen.'
                                    );
                                    publishKleinanzeigenRequestState('done');
                                    return;
                                }
                                const details = [
                                    `Kleinanzeigen: günstigstes von ${result.comparedOffers} passenden deutschlandweiten Angeboten`,
                                    BM_getMarketplaceMinimumPrice(brickmergeBestPrice) !== null
                                        ? `Mindestpreisfilter: ${formatEuroValue(BM_getMarketplaceMinimumPrice(brickmergeBestPrice))} € (50% des Brickmerge-Bestpreises)`
                                        : '',
                                    cheapest.city ? `Ort: ${cheapest.city}` : '',
                                    cheapest.negotiable ? 'Verhandlungsbasis' : '',
                                    cheapest.shippingAvailable
                                        ? 'Versand möglich; Versandkosten unbekannt'
                                        : 'Versand nicht bestätigt',
                                    result.updatedAt
                                        ? `Stand: ${new Date(result.updatedAt).toLocaleString('de-DE')}`
                                        : '',
                                    `Titel: ${cheapest.title}`
                                ].filter(Boolean).join('; ');
                                const shippingCost = Number(cheapest.shippingCost);
                                const shippingStatus = Number.isFinite(shippingCost)
                                    ? (shippingCost <= 0.004 ? 'free' : 'paid')
                                    : 'unknown';
                                const offer = createOffer(
                                    'btn-kleinanzeigen',
                                    'Kleinanzeigen',
                                    `${formatEuroValue(Number(cheapest.price))} €`,
                                    'https://themen.kleinanzeigen.de/media/files/d6/3e/d63e6861-498c-4123-a08d-6f8033055581/ka_horizontal_lightgreen_rgb.png',
                                    'kleinanzeigen-worker',
                                    details,
                                    {
                                        url: cheapest.url,
                                        searchUrl: document.querySelector('a[data-bmid="btn-kleinanzeigen"]')?.href || '',
                                        shippingStatus,
                                        shippingCost: Number.isFinite(shippingCost) ? shippingCost : null
                                    }
                                );
                                if (offer) storeOffers([offer]);
                                publishKleinanzeigenRequestState('done');
                        },
                        error => {
                            console.warn('Brickmerge Tweaker: Kleinanzeigen-Abfrage beim Preis-Worker fehlgeschlagen.', error);
                            kleinanzeigenRequestStarted = false;
                            publishKleinanzeigenFailure(error);
                        }
                    );
                };

                if (BM_isOfferShopEnabled('kleinanzeigen')) {
                    fetchKleinanzeigenOffer({ silentCache: true });
                }
            });

            cachedShopRequest(
                'brickbank',
                makeApiCacheKey('brickbank', setNumber),
                OFFER_CACHE_TTL,
                {
                method: 'GET',
                url:
                    `https://brickbank.app/public/ajax/search/?db=pvg&s=` +
                    encodeURIComponent(`${setNumber}-1`),
                headers: {
                    'Accept': 'application/json,text/plain,*/*',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout: 15000,
                onload: response => {
                    if (response.status !== 200) {
                        console.warn(
                            `Brickmerge Tweaker: Brickbank antwortete mit Status ${response.status}.`
                        );
                        return;
                    }

                    const brickbankVendors = [
                        {
                            key: 'smyths-search',
                            label: 'Smyths',
                            pattern: /smyth/i,
                            searchDomain: 'smythstoys.com/de',
                            logoUrl: chrome.runtime.getURL(
                                'icons/logo-smyths.svg'
                            ),
                            logoClass: 'bm-smyths-logo',
                            logoFallbackUrl:
                                'https://www.google.com/s2/favicons?sz=128&domain_url=smythstoys.com'
                        },
                        {
                            key: 'mueller-search',
                            label: 'Müller',
                            pattern: /m[uü]eller|müller/i,
                            searchDomain: 'mueller.de',
                            logoUrl: new URL(
                                '/img/merchants/m_ller_ico.gif',
                                window.location.origin
                            ).href,
                            logoFallbackUrl:
                                'https://www.google.com/s2/favicons?sz=128&domain_url=mueller.de'
                        }
                    ];
                    const offers = brickbankVendors.filter(vendor =>
                        BM_isOfferShopEnabled(vendor.key)
                    ).map(vendor => {
                        const brickbankOffer = parseBrickbankVendorOffer(
                            response.responseText,
                            vendor.pattern
                        );
                        if (!brickbankOffer) return null;

                        const isSmyths = vendor.key === 'smyths-search';
                        const shippingStatus = isSmyths
                            ? brickbankOffer.price >= 20
                                ? 'free'
                                : 'paid'
                            : 'unknown';
                        const shippingCost = isSmyths
                            ? brickbankOffer.price >= 20
                                ? 0
                                : 3.95
                            : null;
                        const clickoutUrl = isSmyths
                            ? (
                                `https://www.google.com/search?btnI=1&q=` +
                                encodeURIComponent(
                                    `site:${vendor.searchDomain} LEGO ${setNumber}`
                                )
                            )
                            : (
                                `https://duckduckgo.com/?q=` +
                                encodeURIComponent(
                                    `!ducky site:${vendor.searchDomain} LEGO ${setNumber}`
                                )
                            );
                        return {
                            key: vendor.key,
                            label: vendor.label,
                            priceText: `${formatEuroValue(brickbankOffer.price)} €`,
                            url: clickoutUrl,
                            logoUrl: vendor.logoUrl,
                            logoClass: vendor.logoClass || '',
                            logoFallbackUrl: vendor.logoFallbackUrl,
                            source: `brickbank-${vendor.key.replace(/-search$/, '')}`,
                            priceSource:
                                `Brickbank: aktueller ${vendor.label}-Preis` +
                                `${brickbankOffer.availability ? `; ${brickbankOffer.availability}` : ''}`,
                            shippingStatus,
                            shippingCost
                        };
                    }).filter(Boolean);
                    if (offers.length > 0) storeOffers(offers);
                },
                onerror: () => {
                    console.warn(
                        'Brickmerge Tweaker: Brickbank-Preisabfrage fehlgeschlagen.'
                    );
                },
                ontimeout: () => {
                    console.warn(
                        'Brickmerge Tweaker: Brickbank-Preisabfrage - Timeout.'
                    );
                }
            });

            void getWorkerClientId().then(brickLinkWorkerClientId => {
                cachedShopRequest(
                    'bricklink',
                    makeApiCacheKey('bricklink-set-offer-worker-v1', setNumber),
                    OFFER_CACHE_TTL,
                    {
                method: 'GET',
                url: `${BM_WORKER_URL}/bricklink?set=${encodeURIComponent(setNumber)}`,
                headers: {
                    'Accept': 'application/json',
                    'X-BM-Client-ID': brickLinkWorkerClientId
                },
                timeout: 15000,
                onload: response => {
                    if (response.status !== 200) return;
                    let result = null;
                    try {
                        result = JSON.parse(response.responseText);
                    } catch {}
                    if (!result?.found || !result.cheapest) {
                        console.warn(
                            'Brickmerge Tweaker: Keine passenden deutschen BrickLink-Angebote gefunden.'
                        );
                        return;
                    }
                    const cheapest = result.cheapest;
                    const total = Number(cheapest.total ?? cheapest.price);
                    if (!Number.isFinite(total) || total <= 0) return;
                    const sellerDescription = cheapest.seller
                        ? `; günstigstes Angebot von ${cheapest.seller}`
                        : '';
                    const offer = createOffer(
                        'btn-bl',
                        'BrickLink',
                        `${formatEuroValue(total)} €`,
                        'https://static2.bricklink.com/img/bricklink_2026.svg',
                        'bricklink-de',
                        `BrickLink: niedrigster aktueller Neupreis bei deutschen Händlern aus ${result.comparedOffers} Angeboten${sellerDescription}; Versandkosten unbekannt`,
                        {
                            url: cheapest.url,
                            searchUrl: document.querySelector('a[data-bmid="btn-bl"]')?.href || '',
                            shippingStatus: 'unknown',
                            shippingCost: null
                        }
                    );
                    if (offer) storeOffers([offer]);
                },
                onerror: () => {
                    console.warn(
                        'Brickmerge Tweaker: Deutsche BrickLink-Angebote konnten nicht geladen werden.'
                    );
                },
                ontimeout: () => {
                    console.warn(
                        'Brickmerge Tweaker: Deutsche BrickLink-Angebote - Timeout.'
                    );
                }
                    }
                );
            });

            function fetchBrickOwlOffers(url, redirectCount = 0) {
                cachedShopRequest(
                    'brickowl',
                    makeApiCacheKey('brickowl-de', url),
                    OFFER_CACHE_TTL,
                    {
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                        'User-Agent': 'Mozilla/5.0'
                    },
                    timeout: 15000,
                    onload: response => {
                        if ([301, 302, 303, 307, 308].includes(response.status) &&
                            redirectCount < 5) {
                            const location = getResponseHeader(
                                response.responseHeaders,
                                'location'
                            );
                            if (location) {
                                fetchBrickOwlOffers(
                                    new URL(location, url).href,
                                    redirectCount + 1
                                );
                                return;
                            }
                        }

                        if (response.status !== 200) {
                            console.warn(
                                `Brickmerge Tweaker: BrickOwl antwortete mit Status ${response.status} für ${url}.`
                            );
                            return;
                        }

                        const pageUrl = response.finalUrl || url;
                        const brickOwlOffer = parseBrickOwlGermanOffers(
                            response.responseText,
                            pageUrl
                        );
                        if (!brickOwlOffer) {
                            const catalogUrl = redirectCount < 5
                                ? findBrickOwlCatalogUrl(
                                    response.responseText,
                                    setNumber,
                                    pageUrl
                                )
                                : '';
                            if (
                                catalogUrl &&
                                catalogUrl !== pageUrl &&
                                !/\/search\//i.test(catalogUrl)
                            ) {
                                fetchBrickOwlOffers(catalogUrl, redirectCount + 1);
                                return;
                            }
                            const offerDataUrl = redirectCount < 5
                                ? findBrickOwlOfferDataUrl(response.responseText)
                                : '';
                            if (offerDataUrl) {
                                fetchBrickOwlOffers(offerDataUrl, redirectCount + 1);
                                return;
                            }
                            console.warn(
                                `Brickmerge Tweaker: Keine passenden deutschen BrickOwl-Angebote gefunden (${pageUrl}).`
                            );
                            return;
                        }

                        const sellerDescription = brickOwlOffer.storeName
                            ? `; günstigstes Angebot von ${brickOwlOffer.storeName}`
                            : '';
                        const shippingDescription = brickOwlOffer.shippingStatus === 'paid'
                            ? `; Versand ${formatEuroValue(brickOwlOffer.shippingCost)} €`
                            : brickOwlOffer.shippingStatus === 'free'
                                ? '; Versand frei'
                                : '; Versand unbekannt';
                        const offer = createOffer(
                            'btn-bo',
                            'BrickOwl',
                            `${formatEuroValue(brickOwlOffer.price)} €`,
                            'https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickowl-offerlist.png',
                            'brickowl-de',
                            `BrickOwl: günstigstes aktuelles Neupreis-Angebot bei deutschen Händlern aus ${brickOwlOffer.totalLots} Angeboten${sellerDescription}${shippingDescription}`,
                            {
                                url: brickOwlOffer.url,
                                searchUrl: document.querySelector('a[data-bmid="btn-bo"]')?.href || '',
                                shippingStatus: brickOwlOffer.shippingStatus,
                                shippingCost: brickOwlOffer.shippingCost
                            }
                        );
                        if (offer) storeOffers([offer]);
                    },
                    onerror: () => {
                        console.warn(
                            'Brickmerge Tweaker: BrickOwl-Angebote konnten nicht geladen werden.'
                        );
                    },
                    ontimeout: () => {
                        console.warn(
                            'Brickmerge Tweaker: BrickOwl-Angebote - Timeout.'
                        );
                    }
                });
            }
            fetchBrickOwlOffers(brickOwlCatalogSearchUrl(setNumber));
        }
    }

    // ==========================================
    // 3. COPY-ICON & MINIFIGUREN-OVERLAY
    // ==========================================
    function normalizeMarketplaceLogoLink(link) {
        if (!link) return;
        let stage = link.querySelector(':scope > .bm-marketplace-logo-stage');
        const logo = stage?.querySelector(
            ':scope > img, :scope > .bm-marketplace-logo'
        ) || link.querySelector(':scope > img, :scope > .bm-marketplace-logo');
        if (!logo) return;

        link.classList.add('bm-marketplace-logo-link');
        const cell = link.closest('.pricerow');
        const column = cell?.closest('.goto');
        cell?.classList.add('bm-marketplace-logo-cell');
        column?.classList.add('bm-marketplace-logo-column');

        logo.classList.add('bm-marketplace-logo');
        const logoIdentity = [
            logo.getAttribute?.('alt'),
            link.getAttribute('title'),
            link.getAttribute('aria-label')
        ].filter(Boolean).join(' ');
        if (/\bebay(?:\.de|\.fr)?\b/i.test(logoIdentity)) {
            link.classList.add('bm-ebay-logo-link');
        }
        const isEbayLink = link.classList.contains('bm-ebay-logo-link');
        if (logo instanceof HTMLImageElement) {
            logo.removeAttribute('width');
            logo.removeAttribute('height');
            ['width', 'height', 'max-width', 'max-height', 'margin']
                .forEach(property => logo.style.removeProperty(property));
        }

        if (!stage) {
            stage = document.createElement('span');
            stage.className = 'bm-marketplace-logo-stage';
            logo.before(stage);
        }
        if (logo.parentElement !== stage) stage.appendChild(logo);

        let caption = link.querySelector(':scope > .bm-marketplace-logo-caption') ||
            stage.querySelector(':scope > .bm-marketplace-logo-caption');
        const badge = link.querySelector(':scope > .bm-marketplace-country-badge') ||
            stage.querySelector(':scope > .bm-marketplace-country-badge');
        let meta = link.querySelector(':scope > .bm-marketplace-logo-meta');

        // Brickmerge setzt Händlernamen teils als freien Text oder eigenes Element
        // neben das Logo. Im gemeinsamen Raster gehört dieser Text in die separate
        // Metazeile, damit er weder das Logo überdeckt noch den Hover erbt.
        const residualNodes = Array.from(link.childNodes).filter(node =>
            node !== stage && node !== meta && node !== caption && node !== badge
        );
        const residualText = residualNodes
            .map(node => node.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!caption && residualText && residualText.length <= 80) {
            caption = document.createElement('span');
            caption.className = 'bm-marketplace-logo-caption';
            caption.textContent = residualText;
            caption.title = residualText;
        }
        residualNodes.forEach(node => node.remove());

        if (isEbayLink && badge && badge.parentElement !== stage) {
            stage.appendChild(badge);
        }
        if (caption || (badge && !isEbayLink)) {
            if (!meta) {
                meta = document.createElement('span');
                meta.className = 'bm-marketplace-logo-meta';
                stage.after(meta);
            }
            if (badge && !isEbayLink && badge.parentElement !== meta) {
                meta.appendChild(badge);
            }
            if (caption && caption.parentElement !== meta) meta.appendChild(caption);
            link.classList.add('bm-has-meta');
        } else {
            meta?.remove();
            link.classList.remove('bm-has-meta');
        }
    }

    function labelNativeEbayOffer() {
        const nativePriceRows = document.querySelectorAll(
            '#offerlist .medium-4.small-9.columns.pricerow[data-mid]' +
            ':not([data-bm-marketplace="true"])'
        );
        nativePriceRows.forEach(priceRow => {
            if (priceRow.closest('#soldOut') ||
                priceRow.dataset.bmSoldOut === 'true') return;

            const wrapper = priceRow.closest('.row.collapse');
            const merchantElement = priceRow.querySelector('.merchant');
            const merchant = merchantElement?.textContent || '';
            const logo = wrapper?.querySelector('.goto img[alt]')?.alt || '';
            const tooltip = priceRow.querySelector(':scope > a')?.getAttribute('title') || '';
            const ebayIdentity = `${merchant} ${logo} ${tooltip}`;
            if (!/(?:^|\s|zu\s)ebay(?:\.de)?(?:\s|$)/i.test(
                ebayIdentity
            )) return;

            const logoLink = wrapper?.querySelector('.goto a');
            const logoImage = logoLink?.querySelector('img');
            if (!logoLink || !logoImage) return;

            const originalLogo = logoImage.currentSrc || logoImage.src || '';
            if (!logoImage.dataset.bmOriginalSrc) {
                logoImage.dataset.bmOriginalSrc = originalLogo;
            }
            // Brickmerge liefert für die drei nativen eBay-Varianten eigene
            // Händlerlogos. Diese bleiben erhalten. Nur wenn eine frühere
            // Dekoration fälschlich das LEGO-Logo eingesetzt hat, verwenden
            // wir das neutrale eBay-Fallback.
            if (/\blego\b|logo-lego/i.test(
                `${logoImage.alt || ''} ${originalLogo}`
            )) {
                logoImage.src = chrome.runtime.getURL(
                    'icons/logo-ebay-minifig.png'
                );
            }
            logoImage.alt = 'eBay';
            logoImage.removeAttribute('srcset');
            logoImage.classList.remove('bm-lego-wide-logo');
            logoLink.classList.remove('bm-lego-logo-link');

            logoLink.classList.add(
                'bm-marketplace-logo-link',
                'bm-ebay-logo-link',
                'bm-ebay-native-source'
            );
            logoLink.classList.add('bm-has-caption');
            let caption = logoLink.querySelector('.bm-marketplace-logo-caption');
            if (!caption) {
                caption = document.createElement('span');
                caption.className = 'bm-marketplace-logo-caption';
                logoImage.after(caption);
            }
            // Brickmerge liefert für das eigene eBay-Angebot keinen Verkäufer.
            // Laut Brickmerge handelt es sich bei dieser Quelle um ein
            // gewerbliches Händlerangebot.
            const offerType = 'commercial';
            const offerTypeLabel = 'gewerblich';
            logoLink.classList.remove(
                'bm-ebay-standard',
                'bm-ebay-commercial',
                'bm-ebay-private'
            );
            logoLink.classList.add(`bm-ebay-${offerType}`);
            caption.textContent = offerTypeLabel;
            caption.title = `eBay-DE-Angebot: ${offerTypeLabel}`;
            if (merchantElement) {
                merchantElement.replaceChildren(
                    document.createTextNode('eBay'),
                    document.createElement('br')
                );
            }
            logoLink.querySelectorAll('.bm-marketplace-country-badge')
                .forEach(badge => badge.remove());
            normalizeMarketplaceLogoLink(logoLink);
        });
    }

    function decorateOfferLogoLinks() {
        document.querySelectorAll('#offerlist .row.collapse .goto a').forEach(link => {
            const logo = link.querySelector('img, .bm-marketplace-logo');
            if (logo) {
                link.classList.add('bm-marketplace-logo-link');
                const cell = link.closest('.pricerow');
                cell?.classList.add('bm-marketplace-logo-cell');
                cell?.closest('.goto')?.classList.add('bm-marketplace-logo-column');
                const brandText = [
                    logo.getAttribute('alt'),
                    link.getAttribute('title'),
                    link.textContent
                ].filter(Boolean).join(' ');
                const originalSource = logo instanceof HTMLImageElement
                    ? logo.dataset.bmOriginalSrc || logo.currentSrc || logo.src || ''
                    : '';
                const merchantName = link.closest('.row.collapse')
                    ?.querySelector(
                        '.medium-4.small-9.columns.pricerow .merchant'
                    )?.textContent?.replace(/\s+/g, ' ').trim() || '';
                const logoAlt = logo.getAttribute('alt')?.replace(/\s+/g, ' ').trim() || '';
                const sourcePath = (() => {
                    try {
                        return new URL(originalSource, location.href).pathname;
                    } catch {
                        return originalSource;
                    }
                })();
                const isEbay = link.classList.contains('bm-ebay-logo-link') ||
                    /\bebay(?:\.de|\.fr)?\b/i.test(brandText);
                if (isEbay) {
                    link.classList.add('bm-ebay-logo-link');
                    link.classList.remove('bm-lego-logo-link');
                    if (logo instanceof HTMLImageElement) {
                        if (!logo.dataset.bmOriginalSrc) {
                            logo.dataset.bmOriginalSrc =
                                logo.currentSrc || logo.src || '';
                        }
                        const currentSource = logo.currentSrc || logo.src || '';
                        const originalSource = logo.dataset.bmOriginalSrc || '';
                        const currentLooksLikeLego = /\blego\b|logo-lego/i.test(
                            `${logo.alt || ''} ${currentSource}`
                        );
                        const originalLooksLikeLego = /\blego\b|logo-lego/i.test(
                            originalSource
                        );
                        if (currentLooksLikeLego) {
                            logo.src = originalSource && !originalLooksLikeLego
                                ? originalSource
                                : chrome.runtime.getURL(
                                    'icons/logo-ebay-minifig.png'
                                );
                        }
                        logo.alt = 'eBay';
                        logo.removeAttribute('srcset');
                        logo.classList.remove('bm-lego-wide-logo');
                    }
                } else if (
                    /^(?:lego|lego shop|lego\.com|lego\.fr)$/i.test(merchantName) ||
                    /^(?:lego|lego shop|lego\.com|lego\.fr)$/i.test(logoAlt) ||
                    /(?:^|[\/_-])(?:m_)?lego(?:[_.-]|$)/i.test(sourcePath)
                ) {
                    link.classList.add('bm-lego-logo-link');
                    if (logo instanceof HTMLImageElement) {
                        if (!logo.dataset.bmOriginalSrc) {
                            logo.dataset.bmOriginalSrc = logo.currentSrc || logo.src || '';
                        }
                        logo.src = chrome.runtime.getURL('icons/logo-lego-wide.png');
                        logo.removeAttribute('srcset');
                        logo.classList.add('bm-lego-wide-logo');
                    }
                } else if (logo instanceof HTMLImageElement) {
                    const savedSource = logo.dataset.bmOriginalSrc || '';
                    if (link.classList.contains('bm-lego-logo-link') && savedSource &&
                        !/logo-lego-wide\.png/i.test(savedSource)) {
                        logo.src = savedSource;
                    }
                    link.classList.remove('bm-lego-logo-link');
                    logo.classList.remove('bm-lego-wide-logo');
                }
                normalizeMarketplaceLogoLink(link);
            }
        });
    }

    function runOfferPresentationSteps() {
        [
            [BM_SETTINGS.cleaner, removeCorrectionReportButtons],
            [BM_SETTINGS.shippingAndSorting, removeOfferListPriceDecorations],
            [true, labelNativeEbayOffer],
            [true, decorateOfferLogoLinks],
            [BM_SETTINGS.shippingAndSorting, injectShippingCostsFromOfferTitles],
            [BM_SETTINGS.priceCalculations, applyRetailerDiscounts],
            [BM_SETTINGS.shippingAndSorting, sortOffersByConfiguredPrice],
            [BM_SETTINGS.shippingAndSorting, mergeSoldOutOffersIntoOfferList],
            [BM_SETTINGS.shippingAndSorting, updateOfferTooltips],
            [BM_SETTINGS.priceCalculations, syncEffectivePriceLabels],
            [BM_SETTINGS.priceCalculations, syncOfferDiscountBubbles],
            [BM_SETTINGS.shippingAndSorting, placeSoldOutBadgesAfterShipping],
            [BM_SETTINGS.priceCalculations, calculateDiscount],
            [BM_SETTINGS.detailLayout, decoratePriceHistoryLinks],
            [BM_SETTINGS.priceCalculations, renameHistoricalBestPriceLabel],
            [BM_SETTINGS.priceCalculations, createDiscountSettingsUI],
            [BM_SETTINGS.shippingAndSorting, disableOfferListTooltips]
        ].filter(([enabled]) => enabled).map(([, step]) => step).forEach(step => {
            try {
                step();
            } catch (error) {
                console.error(
                    `Brickmerge Tweaker: ${step.name} konnte nicht ausgeführt werden.`,
                    error
                );
            }
        });
    }

    if (setNum && BM_SETTINGS.copyAndMinifigures) {
        try {
            (function detailsNameCopyButton() {
                document.querySelectorAll('h1 .bm-copy-btn').forEach(button => button.remove());

                const details = document.querySelector('.content.setdetails .productprice');
                const pageTitle = document.querySelector('h1')?.textContent
                    .replace(/[\u00AE\u2122]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim() || '';
                const nameElement = Array.from(
                    details?.querySelectorAll('strong, b') || []
                ).find(element => {
                    const text = element.textContent
                        .replace(/[\u00AE\u2122]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    return text.includes(setNum) &&
                        text.length > String(setNum).length + 4 &&
                        !/Artikel-Nr\s*:|€/.test(text) &&
                        (!pageTitle || pageTitle.includes(text) || text.includes(pageTitle));
                });
                if (!nameElement || nameElement.querySelector('.bm-copy-btn')) return;

                const copyBtn = document.createElement('span');
                copyBtn.className = 'bm-copy-btn';
                copyBtn.title = 'Setnamen kopieren';
                copyBtn.setAttribute('role', 'button');
                copyBtn.tabIndex = 0;
                copyBtn.setAttribute('aria-label', 'Setnamen kopieren');
                copyBtn.style.cssText = 'cursor:pointer;margin-left:0.18em;padding:0;width:13px;height:13px;border:0;background:none;color:inherit;user-select:none;display:inline-flex;align-items:center;justify-content:center;line-height:0;vertical-align:middle;position:static;transform:none;opacity:0.82;';
                copyBtn.innerHTML = `
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="currentColor" fill="none" stroke-width="0.9"/>
            <rect x="6.5" y="0.5" width="6" height="9" rx="2" stroke="currentColor" fill="none" stroke-width="0.9" opacity="0.55"/>
            </svg>`;
                copyBtn.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const nameClone = nameElement.cloneNode(true);
                    nameClone.querySelector('.bm-copy-btn')?.remove();
                    const cleaned = nameClone.textContent
                        .replace(/[\u00AE\u2122]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (typeof GM_setClipboard !== "undefined") {
                        GM_setClipboard(cleaned);
                    } else if (navigator.clipboard) {
                        navigator.clipboard.writeText(cleaned);
                    }
                    copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="#2eb866" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="#2eb866" fill="none" stroke-width="1.5"/><path d="M5 10 l2 2 4-4" stroke="#2eb866" stroke-width="1.5" fill="none"/></svg>`;
                    setTimeout(() => {
                        copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="currentColor" fill="none" stroke-width="0.9"/><rect x="6.5" y="0.5" width="6" height="9" rx="2" stroke="currentColor" fill="none" stroke-width="0.9" opacity="0.55"/></svg>`;
                    }, 900);
                });
                copyBtn.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    copyBtn.click();
                });
                nameElement.appendChild(copyBtn);
            })();
        } catch (error) {
            console.error(
                'Brickmerge Tweaker: Setnamen-Kopierfunktion konnte nicht initialisiert werden.',
                error
            );
        }

        function getPageMinifigureCount() {
            const detailsText = Array.from(document.querySelectorAll(
                '.content.setdetails .productprice, #ol2nd'
            )).map(element => element.textContent || '').join(' ');
            return Number(
                detailsText.match(/Minifiguren\s*:\s*(\d+)/i)?.[1] || 0
            );
        }

        function hasPageMinifigures() {
            return getPageMinifigureCount() > 0;
        }

        async function fetchRebrickableMinifigs() {
            const cacheKey = makeApiCacheKey(
                'rebrickable-minifigs-v1',
                `${setNum}-1`
            );
            return fetchWithCache(
                cacheKey,
                REBRICKABLE_MINIFIG_CACHE_TTL,
                () => new Promise((resolve, reject) => {
                    requestWithGm({
                        method: 'GET',
                        url: `${BM_WORKER_URL}/proxy/rebrickable/set-minifigs?set=` +
                            encodeURIComponent(`${setNum}-1`),
                        headers: {
                            Accept: 'application/json',
                            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
                        },
                        timeout: 15000,
                        onload: response => {
                            if (response.status !== 200) {
                                reject(new Error(`HTTP ${response.status}`));
                                return;
                            }
                            try {
                                const payload = JSON.parse(
                                    response.responseText || '{}'
                                );
                                resolve(Array.isArray(payload?.results)
                                    ? payload.results
                                    : null);
                            } catch (error) {
                                reject(error);
                            }
                        },
                        onerror: () => reject(new Error('Netzwerkfehler')),
                        ontimeout: () => reject(new Error('Zeitüberschreitung'))
                    });
                }),
                value => Array.isArray(value)
            );
        }

        async function fetchBrickLinkSetMinifigs() {
            return fetchWithCache(
                makeApiCacheKey('bricklink-set-minifigs-v2', `${setNum}-1`),
                MINIFIG_INVENTORY_CACHE_TTL,
                () => new Promise((resolve, reject) => {
                    requestWithGm({
                        method: 'GET',
                        url: `${BM_WORKER_URL}/proxy/bricklink/set-minifigs?set=` +
                            encodeURIComponent(`${setNum}-1`),
                        headers: { Accept: 'application/json' },
                        timeout: 20000,
                        onload: response => {
                            if (response.status !== 200) {
                                reject(new Error(`HTTP ${response.status}`));
                                return;
                            }
                            const payload = JSON.parse(
                                response.responseText || '{}'
                            );
                            if (Array.isArray(payload?.items)) {
                                resolve(payload.items.filter(item => item?.itemNo));
                                return;
                            }
                            resolve(Array.isArray(payload?.itemNos)
                                ? payload.itemNos.map(itemNo => ({
                                    itemNo: String(itemNo),
                                    name: '',
                                    quantity: 1
                                })).filter(item => item.itemNo)
                                : []);
                        },
                        onerror: () => reject(new Error('Netzwerkfehler')),
                        ontimeout: () => reject(new Error('Zeitüberschreitung'))
                    });
                }),
                value => Array.isArray(value)
            );
        }

        let minifigCrosswalkPromise = null;
        async function getMinifigCrosswalk() {
            if (!minifigCrosswalkPromise) {
                minifigCrosswalkPromise = Promise.all([
                    fetchRebrickableMinifigs(),
                    fetchBrickLinkSetMinifigs()
                ]).then(([entries, brickLinkItems]) =>
                    BM_buildMinifigCrosswalk(entries, brickLinkItems)
                ).catch(() => new Map());
            }
            return minifigCrosswalkPromise;
        }

        function buildRebrickableFigureTable(entries) {
            const table = document.createElement('table');
            table.className = 'bm-minifig-table';
            const tbody = document.createElement('tbody');
            let figureCount = 0;
            const seen = new Set();

            (Array.isArray(entries) ? entries : []).forEach(entry => {
                const itemNo = String(entry?.set_num || '').trim();
                if (!itemNo || seen.has(itemNo)) return;
                seen.add(itemNo);

                const parsedQuantity = Number.parseInt(entry?.quantity, 10);
                const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0
                    ? parsedQuantity
                    : 1;
                const name = String(
                    entry?.set_name || entry?.name || itemNo
                ).trim();
                const imageUrl = String(entry?.set_img_url || '').trim();
                const brickLinkUrl =
                    'https://www.bricklink.com/v2/catalog/catalogitem.page' +
                    `?M=${encodeURIComponent(itemNo)}`;

                const row = document.createElement('tr');
                const imageCell = document.createElement('td');
                if (imageUrl) {
                    const image = document.createElement('img');
                    image.src = imageUrl;
                    image.alt = name;
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
                    imageCell.appendChild(image);
                }

                const quantityCell = document.createElement('td');
                quantityCell.textContent = String(quantity);

                const itemCell = document.createElement('td');
                const itemLink = document.createElement('a');
                itemLink.href = brickLinkUrl;
                itemLink.className = 'bm-minifig-item-link';
                itemLink.target = '_blank';
                itemLink.rel = 'noopener noreferrer';
                itemLink.textContent = itemNo;
                itemCell.appendChild(itemLink);

                const descriptionCell = document.createElement('td');
                const title = document.createElement('strong');
                title.textContent = name;
                const catalogBreak = document.createElement('br');
                const catalogLink = document.createElement('a');
                catalogLink.href = brickLinkUrl;
                catalogLink.className = 'bm-minifig-catalog-link';
                catalogLink.target = '_blank';
                catalogLink.rel = 'noopener noreferrer';
                catalogLink.textContent = itemNo;
                descriptionCell.append(title, catalogBreak, catalogLink);

                row.append(
                    imageCell,
                    quantityCell,
                    itemCell,
                    descriptionCell
                );
                tbody.appendChild(row);
                figureCount += quantity;
            });

            if (!tbody.rows.length) return null;
            table.appendChild(tbody);
            return { kind: 'found', table, figureCount };
        }

        async function resolveBrickLinkMinifigId(itemNo) {
            const sourceId = String(itemNo || '').trim();
            if (!sourceId) return null;
            if (!/^fig-/i.test(sourceId)) return sourceId;

            const crosswalk = await getMinifigCrosswalk();
            return crosswalk.get(sourceId) || null;
        }

        async function getMinifigPrice(blItemNo, requestedRegion = 'DE') {
            const cleanId = String(blItemNo || '')
                .replace(/^fig-/i, '')
                .trim();
            if (!cleanId) return null;
            const region = requestedRegion === 'EU' ? 'EU' : 'DE';
            const regionCacheKey = region.toLowerCase();

            const requestText = url => new Promise((resolve, reject) => {
                requestWithGm({
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                        'Referer': 'https://www.bricklink.com/'
                    },
                    timeout: 15000,
                    onload: response => {
                        if (response.status !== 200) {
                            reject(new Error(`HTTP ${response.status}`));
                            return;
                        }
                        resolve(String(response.responseText || ''));
                    },
                    onerror: () => reject(new Error('Netzwerkfehler')),
                    ontimeout: () => reject(new Error('Zeitüberschreitung'))
                });
            });

            const bundledCurrentPrice = await fetchWithCache(
                makeApiCacheKey(
                    `bricklink-minifig-current-price-v4-${regionCacheKey}`,
                    cleanId
                ),
                MINIFIG_PRICE_CACHE_TTL,
                async () => {
                    const jsonText = await requestText(
                        `${BM_WORKER_URL}/proxy/bricklink/minifig-price` +
                        `?itemNo=${encodeURIComponent(cleanId)}` +
                        `&region=${encodeURIComponent(region)}`
                    );
                    const payload = JSON.parse(jsonText);
                    if (String(payload?.region || '') !== region) return null;
                    const price = Number(payload?.price);
                    return Number.isFinite(price) && price > 0 ? price : null;
                },
                value => Number.isFinite(Number(value)) && Number(value) > 0
            ).catch(() => null);
            if (
                Number.isFinite(Number(bundledCurrentPrice)) &&
                Number(bundledCurrentPrice) > 0
            ) {
                return Number(bundledCurrentPrice);
            }
            // Der EU-Regionsfilter wird ausschließlich serverseitig ausgewertet.
            // So kann ein älterer Worker nicht versehentlich den DE-Preis als
            // EU-Preis ausgeben.
            if (region === 'EU') return null;

            const itemId = await fetchWithCache(
                makeApiCacheKey('bricklink-minifig-item-id-v2', cleanId),
                MINIFIG_PRICE_CACHE_TTL,
                async () => {
                    const html = await requestText(
                        'https://www.bricklink.com/v2/catalog/catalogitem.page' +
                        `?M=${encodeURIComponent(cleanId)}`
                    );
                    const parsedId = Number(
                        html.match(/\bidItem\s*:\s*(\d+)/)?.[1]
                    );
                    return Number.isInteger(parsedId) && parsedId > 0
                        ? parsedId
                        : null;
                },
                value => Number.isInteger(Number(value)) && Number(value) > 0
            ).catch(() => null);
            const currentPrice = itemId ? await fetchWithCache(
                makeApiCacheKey(
                    `bricklink-minifig-current-price-v4-${regionCacheKey}`,
                    cleanId
                ),
                MINIFIG_PRICE_CACHE_TTL,
                async () => {
                    const locationFilter = region === 'EU'
                        ? '&reg=-1'
                        : '&loc=DE';
                    const jsonText = await requestText(
                        'https://www.bricklink.com/ajax/clone/catalogifs.ajax' +
                        `?itemid=${encodeURIComponent(itemId)}` +
                        '&ss=DE&cond=N&ii=0' + locationFilter +
                        '&iconly=0&rpp=100&pi=1&st=1'
                    );
                    const payload = JSON.parse(jsonText);
                    const prices = (Array.isArray(payload?.list) ? payload.list : [])
                        .filter(offer =>
                            (region === 'EU' ||
                                offer?.strSellerCountryCode === 'DE') &&
                            offer?.codeNew === 'N' &&
                            offer?.codeComplete !== 'I'
                        )
                        .map(offer => {
                            const priceText = String(
                                offer.mInvSalePrice ||
                                offer.mDisplaySalePrice ||
                                ''
                            );
                            const match = priceText.match(
                                /(?:EUR|€)\s*([\d.,]+)|([\d.,]+)\s*(?:EUR|€)/i
                            );
                            if (!match) return null;
                            const raw = match[1] || match[2];
                            const commaIndex = raw.lastIndexOf(',');
                            const dotIndex = raw.lastIndexOf('.');
                            let normalized = raw;
                            if (commaIndex >= 0 && dotIndex >= 0) {
                                normalized = commaIndex > dotIndex
                                    ? raw.replace(/\./g, '').replace(',', '.')
                                    : raw.replace(/,/g, '');
                            } else if (commaIndex >= 0) {
                                normalized = raw.replace(',', '.');
                            }
                            const value = Number(normalized);
                            return Number.isFinite(value) && value > 0
                                ? value
                                : null;
                        })
                        .filter(value => value !== null)
                        .sort((a, b) => a - b);
                    return prices[0] ?? null;
                },
                value => Number.isFinite(Number(value)) && Number(value) > 0
            ).catch(() => null) : null;
            if (Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0) {
                return Number(currentPrice);
            }

            if (region === 'EU') return null;

            // BrickLink liefert die Preisübersicht für einzelne Figuren teilweise
            // noch über den älteren catalogpg-Endpunkt, auch wenn die Artikelseite
            // bereits das neue Layout verwendet.
            return fetchWithCache(
                makeApiCacheKey('bricklink-minifig-price-guide-v1', cleanId),
                MINIFIG_PRICE_CACHE_TTL,
                async () => {
                    const jsonText = await requestText(
                        'https://www.bricklink.com/ajax/clone/catalogpg.ajax' +
                        `?itemType=M&itemNo=${encodeURIComponent(cleanId)}` +
                        '&chartType=price&gross=1'
                    );
                    const payload = JSON.parse(jsonText);
                    const value = Number(
                        payload?.avg_price_6mo_new || payload?.avg_price || 0
                    );
                    return Number.isFinite(value) && value > 0 ? value : null;
                },
                value => Number.isFinite(Number(value)) && Number(value) > 0
            ).catch(() => null);
        }

        const minifigPriceRequestsInFlight = new Map();
        const minifigurePriceSnapshots = Object.freeze({
            DE: new Map(),
            EU: new Map()
        });

        function getMinifigPriceSnapshot(region = 'DE') {
            return minifigurePriceSnapshots[region === 'EU' ? 'EU' : 'DE'];
        }

        function getMinifigPriceSnapshotKeys(itemNo) {
            const cleanId = String(itemNo || '').trim();
            if (!cleanId) return [];
            return [...new Set([
                cleanId,
                cleanId.replace(/^fig-/i, '')
            ])].filter(Boolean);
        }

        function getSnapshotMinifigPrice(itemNo, region = 'DE') {
            const snapshot = getMinifigPriceSnapshot(region);
            const snapshotKeys = getMinifigPriceSnapshotKeys(itemNo);
            const key = snapshotKeys.find(snapshotKey =>
                snapshot.has(snapshotKey)
            );
            return key === undefined ? undefined : snapshot.get(key);
        }

        function rememberMinifigPrice(itemNo, price, region = 'DE') {
            const snapshot = getMinifigPriceSnapshot(region);
            const normalizedPrice = Number.isFinite(Number(price)) &&
                Number(price) > 0
                ? Number(price)
                : null;
            getMinifigPriceSnapshotKeys(itemNo).forEach(key =>
                snapshot.set(key, normalizedPrice)
            );
            return price;
        }

        function serializeMinifigPriceSnapshot(region = 'EU') {
            return Object.fromEntries(getMinifigPriceSnapshot(region).entries());
        }

        function restoreMinifigPriceSnapshot(snapshot, region = 'EU') {
            if (!snapshot || typeof snapshot !== 'object') return false;
            const entries = Object.entries(snapshot).filter(([key, value]) =>
                key && (value === null || (
                    Number.isFinite(Number(value)) && Number(value) > 0
                ))
            );
            if (entries.length === 0) return false;
            const targetSnapshot = getMinifigPriceSnapshot(region);
            targetSnapshot.clear();
            entries.forEach(([key, value]) =>
                targetSnapshot.set(key, value === null ? null : Number(value))
            );
            return true;
        }

        function getSharedMinifigPrice(blItemNo, requestedRegion = 'DE') {
            const cleanId = String(blItemNo || '').trim();
            if (!cleanId) return Promise.resolve(null);
            const region = requestedRegion === 'EU' ? 'EU' : 'DE';
            const cachedPrice = getSnapshotMinifigPrice(cleanId, region);
            if (cachedPrice !== undefined) return Promise.resolve(cachedPrice);
            const requestKey = `${region}:${cleanId}`;
            if (minifigPriceRequestsInFlight.has(requestKey)) {
                return minifigPriceRequestsInFlight.get(requestKey);
            }
            const request = getMinifigPrice(cleanId, region)
                .then(price => rememberMinifigPrice(cleanId, price, region))
                .finally(() => minifigPriceRequestsInFlight.delete(requestKey));
            minifigPriceRequestsInFlight.set(requestKey, request);
            return request;
        }

        function updateMinifigureValueInDataBox(
            totalValue,
            saveToCache = true,
            priceSnapshot = null
        ) {
            if (!Number.isFinite(totalValue) || totalValue <= 0) return;
            if (priceSnapshot instanceof Map) {
                priceSnapshot.forEach((price, itemNo) =>
                    rememberMinifigPrice(itemNo, price, 'EU')
                );
            }
            const details = Array.from(
                document.querySelectorAll(
                    '.content.setdetails .productprice p, ' +
                    '.content.setdetails p, #ol2nd p'
                )
            ).find(paragraph => /Minifiguren\s*:/i.test(paragraph.textContent || ''));
            if (!details) return;

            details.querySelectorAll('.bm-minifig-total-value-break')
                .forEach(lineBreak => lineBreak.remove());
            details.querySelectorAll('.bm-minifig-adjusted-part-price')
                .forEach(line => line.remove());

            const breaks = Array.from(details.querySelectorAll('br'));
            const targetBreak = breaks.find((lineBreak, index) => {
                const range = document.createRange();
                if (index > 0) {
                    range.setStartAfter(breaks[index - 1]);
                } else {
                    range.setStart(details, 0);
                }
                range.setEndBefore(lineBreak);
                const isMinifigureLine = /Minifiguren\s*:/i.test(range.toString());
                range.detach?.();
                return isMinifigureLine;
            });

            let valueLine = details.querySelector('.bm-minifig-total-value');
            if (!valueLine) {
                valueLine = document.createElement('span');
                valueLine.className = 'bm-minifig-total-value';
            }
            const minifigureLink = details.querySelector('.bm-minifig-count-link');
            if (minifigureLink) {
                minifigureLink.appendChild(valueLine);
            } else if (targetBreak) {
                targetBreak.before(valueLine);
            } else if (!valueLine.isConnected) {
                details.appendChild(valueLine);
            }
            valueLine.innerHTML =
                `&nbsp;| <strong>${formatEuroValue(totalValue)} €</strong>`;
            valueLine.removeAttribute('title');

            const tooltipParts = [
                `Minifigurenwert: ${formatEuroValue(totalValue)} €`,
                'Basis: niedrigster aktueller BrickLink-EU-Neupreis je Figur, ohne Versand'
            ];

            const detailsText = Array.from(document.querySelectorAll(
                '.content.setdetails .productprice, #ol2nd'
            )).map(element => element.textContent || '').join(' ');
            const partCount = Number(
                detailsText.match(/(?:^|\|)\s*Teile\s*:\s*([\d.]+)/i)?.[1]
                    ?.replace(/\./g, '') || 0
            );
            const figureCount = getPageMinifigureCount();
            const nativePrices = Array.from(document.querySelectorAll(
                '#offerlist .medium-4.small-9.columns.pricerow' +
                ':not([data-bm-marketplace="true"])'
            )).filter(priceRow =>
                !priceRow.closest('#soldOut') &&
                priceRow.dataset.bmSoldOut !== 'true'
            ).map(priceRow => {
                const priceSpan = priceRow.querySelector('span.price');
                return priceSpan ? getBaseOfferPrice(priceSpan) : null;
            }).filter(price => Number.isFinite(price) && price > 0);
            const currentSetPrice = nativePrices.length
                ? Math.min(...nativePrices)
                : null;
            const remainingPartCount = partCount - figureCount;
            if (
                Number.isFinite(currentSetPrice) &&
                partCount > 0 &&
                remainingPartCount > 0
            ) {
                const adjustedCentsPerPart =
                    ((currentSetPrice - totalValue) * 100) / remainingPartCount;
                const metricLabel = adjustedCentsPerPart.toLocaleString('de-DE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
                tooltipParts.push(
                    `ohne Figuren: ${metricLabel} ct/Teil`
                );
            }
            const tooltipText = tooltipParts.join(' · ');
            if (minifigureLink) {
                let tooltip = minifigureLink.querySelector(
                    ':scope > .bm-minifig-tooltip'
                );
                if (!tooltip) {
                    tooltip = document.createElement('span');
                    tooltip.className = 'bm-minifig-tooltip';
                    tooltip.setAttribute('role', 'tooltip');
                    tooltip.id = `bm-minifig-tooltip-${setNum}`;
                    minifigureLink.appendChild(tooltip);
                }
                tooltip.textContent = tooltipText;
                minifigureLink.setAttribute('aria-describedby', tooltip.id);
                minifigureLink.removeAttribute('title');
                minifigureLink.classList.remove('tooltipster', 'tooltipstered');
            } else {
                valueLine.setAttribute('title', tooltipText);
            }
            details.querySelector('.bm-minifig-value-load')?.remove();
            if (saveToCache) {
                void writeStoredValue(
                    makeApiCacheKey(MINIFIG_TOTAL_CACHE_SCOPE, setNum),
                    {
                        timestamp: Date.now(),
                        data: {
                            total: totalValue,
                            prices: serializeMinifigPriceSnapshot()
                        }
                    }
                );
            }
        }

        function showCachedMinifigureValue() {
            void readStoredValue(
                makeApiCacheKey(MINIFIG_TOTAL_CACHE_SCOPE, setNum),
                null
            ).then(cached => {
                const total = Number(cached?.data?.total);
                if (
                    cached &&
                    Date.now() - Number(cached.timestamp) < MINIFIG_PRICE_CACHE_TTL &&
                    Number.isFinite(total) &&
                    total > 0
                ) {
                    restoreMinifigPriceSnapshot(cached.data.prices);
                    updateMinifigureValueInDataBox(total, false);
                }
            });
        }

        let minifigureValuePreloadPromise = null;

        function ensureMinifigureValueLoadButton() {
            if (!hasPageMinifigures()) return;
            const link = document.querySelector('.bm-minifig-count-link');
            if (!link || link.querySelector('.bm-minifig-total-value')) return;
            if (link.parentElement?.querySelector('.bm-minifig-value-load')) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bm-minifig-value-load';
            button.textContent = '€';
            button.title = 'Aktuelle BrickLink-Werte laden';
            button.setAttribute('aria-label', 'Aktuelle BrickLink-Werte laden');
            button.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                button.classList.remove('is-error');
                button.classList.add('is-loading');
                try {
                    await preloadMinifigureValue();
                    if (!document.querySelector('.bm-minifig-total-value')) {
                        minifigureValuePreloadPromise = null;
                        button.classList.remove('is-loading');
                        button.classList.add('is-error');
                        button.title = 'Wert nicht verfügbar – erneut versuchen';
                    }
                } catch (error) {
                    minifigureValuePreloadPromise = null;
                    button.classList.remove('is-loading');
                    button.classList.add('is-error');
                    button.title = 'Wert nicht verfügbar – erneut versuchen';
                }
            });
            link.after(button);
        }

        function preloadMinifigureValue() {
            if (!hasPageMinifigures()) return Promise.resolve();
            if (minifigureValuePreloadPromise) {
                return minifigureValuePreloadPromise;
            }

            minifigureValuePreloadPromise = (async () => {
                const totalCacheKey = makeApiCacheKey(
                    MINIFIG_TOTAL_CACHE_SCOPE,
                    setNum
                );
                const cachedTotal = await readStoredValue(totalCacheKey, null);
                const cachedValue = Number(cachedTotal?.data?.total);
                if (
                    cachedTotal &&
                    Date.now() - Number(cachedTotal.timestamp) <
                        MINIFIG_PRICE_CACHE_TTL &&
                    Number.isFinite(cachedValue) &&
                    cachedValue > 0
                ) {
                    restoreMinifigPriceSnapshot(cachedTotal.data.prices);
                    updateMinifigureValueInDataBox(
                        cachedValue,
                        false
                    );
                    return;
                }

                const requestInventoryPage = url => fetchWithCache(
                    makeApiCacheKey('bricklink-minifig-inventory', url),
                    MINIFIG_INVENTORY_CACHE_TTL,
                    () => new Promise((resolve, reject) => {
                        requestWithGm({
                            method: 'GET',
                            url,
                            headers: {
                                'Accept':
                                    'text/html,application/xhtml+xml',
                                'Accept-Language':
                                    'de-DE,de;q=0.9,en;q=0.8'
                            },
                            timeout: 15000,
                            onload: response => {
                                const body = String(
                                    response.responseText || ''
                                );
                                if (response.status !== 200 || body.length < 200) {
                                    reject(new Error(
                                        `HTTP ${response.status}`
                                    ));
                                    return;
                                }
                                resolve({
                                    status: response.status,
                                    responseText: body,
                                    responseHeaders:
                                        response.responseHeaders || '',
                                    finalUrl: response.finalUrl || url
                                });
                            },
                            onerror: () => reject(
                                new Error('Netzwerkfehler')
                            ),
                            ontimeout: () => reject(
                                new Error('Zeitüberschreitung')
                            )
                        });
                    }),
                    response =>
                        typeof response?.responseText === 'string' &&
                        response.responseText.length > 200
                );

                const extractFigures = (html, modern = true) => {
                    const doc = new DOMParser().parseFromString(
                        html,
                        'text/html'
                    );
                    const rows = modern
                        ? Array.from(doc.querySelectorAll(
                            'table.pciinvMainTable tr.pciinvItemRow'
                        ))
                        : Array.from(doc.querySelectorAll('tr'));
                    const figures = new Map();

                    rows.forEach(row => {
                        const itemLink = row.querySelector(
                            'a[href*="catalogitem.page?M="], ' +
                            'a[href*="catalogItemInv.asp?M="]'
                        );
                        if (!itemLink) return;

                        const href = itemLink.getAttribute('href') || '';
                        const encodedItemNo =
                            href.match(/[?&]M=([^&#]+)/i)?.[1] || '';
                        if (!encodedItemNo) return;

                        let itemNo = encodedItemNo;
                        try {
                            itemNo = decodeURIComponent(encodedItemNo);
                        } catch (error) {
                            // BrickLink item numbers are normally plain ASCII.
                        }

                        const cells = Array.from(row.cells || []);
                        let quantityText = modern
                            ? cells[2]?.textContent || ''
                            : '';
                        if (!modern) {
                            const imageIndex = cells.findIndex(cell =>
                                cell.querySelector('img')
                            );
                            const itemIndex = cells.findIndex(cell =>
                                cell.contains(itemLink)
                            );
                            const quantityCell = cells.find((cell, index) =>
                                index > imageIndex &&
                                index < itemIndex &&
                                /^\s*\d+\s*$/.test(cell.textContent || '')
                            );
                            quantityText = quantityCell?.textContent || '';
                        }

                        const quantity = Number.parseInt(
                            quantityText.match(/\d+/)?.[0] || '1',
                            10
                        );
                        const cleanItemNo = itemNo.trim();
                        if (!cleanItemNo) return;
                        figures.set(
                            cleanItemNo,
                            (figures.get(cleanItemNo) || 0) +
                            (
                                Number.isFinite(quantity) && quantity > 0
                                    ? quantity
                                    : 1
                            )
                        );
                    });

                    return Array.from(figures, ([itemNo, quantity]) => ({
                        itemNo,
                        quantity
                    }));
                };

                let figures = [];
                let rebrickableFigures = [];
                let brickLinkFigures = [];
                try {
                    const rebrickableEntries = await fetchRebrickableMinifigs();
                    if (Array.isArray(rebrickableEntries)) {
                        rebrickableFigures = rebrickableEntries.map(entry => ({
                            itemNo: String(entry?.set_num || '').trim(),
                            quantity: Number.parseInt(entry?.quantity, 10) || 1
                        })).filter(figure => figure.itemNo);
                        figures = rebrickableFigures;
                    }
                } catch (error) {
                    // BrickLink remains the fallback when Rebrickable is unavailable.
                }

                try {
                    const catalogUrl =
                        `https://www.bricklink.com/v2/catalog/catalogitem.page` +
                        `?S=${encodeURIComponent(`${setNum}-1`)}`;
                    const catalogResponse =
                        await requestInventoryPage(catalogUrl);
                    const itemId = Number(
                        catalogResponse.responseText.match(
                            /\bidItem\s*:\s*(\d+)/
                        )?.[1]
                    );
                    if (Number.isInteger(itemId) && itemId > 0) {
                        const inventoryUrl =
                            'https://www.bricklink.com/v2/catalog/' +
                            'catalogitem_invtab.page' +
                            `?idItem=${encodeURIComponent(itemId)}` +
                            '&st=1&show_invid=0&show_matchcolor=0' +
                            '&show_pglink=0&show_pcc=0&show_missingpcc=0' +
                            `&itemNoSeq=${encodeURIComponent(`${setNum}-1`)}`;
                        const inventoryResponse =
                            await requestInventoryPage(inventoryUrl);
                        brickLinkFigures = extractFigures(
                            inventoryResponse.responseText,
                            true
                        );
                    }
                } catch (error) {
                    // The legacy inventory below remains available as fallback.
                }

                if (brickLinkFigures.length === 0) {
                    try {
                        const legacyUrl =
                            'https://www.bricklink.com/catalogItemInv.asp' +
                            `?S=${encodeURIComponent(`${setNum}-1`)}` +
                            '&viewItemType=M';
                        const legacyResponse =
                            await requestInventoryPage(legacyUrl);
                        brickLinkFigures = extractFigures(
                            legacyResponse.responseText,
                            false
                        );
                    } catch (error) {
                        return;
                    }
                }
                if (brickLinkFigures.length > 0) {
                    figures = brickLinkFigures;
                }
                if (figures.length === 0) return;

                const prices = new Map();
                for (let index = 0; index < figures.length; index += 6) {
                    const batch = figures.slice(index, index + 6);
                    const entries = await Promise.all(batch.map(async figure => {
                        const priceItemNo = await resolveBrickLinkMinifigId(
                            figure.itemNo
                        ) || figure.itemNo;
                        const price = await getSharedMinifigPrice(priceItemNo, 'EU');
                        rememberMinifigPrice(figure.itemNo, price, 'EU');
                        return [figure.itemNo, price];
                    }));
                    entries.forEach(([itemNo, price]) =>
                        prices.set(itemNo, price)
                    );
                }

                let totalValue = 0;
                for (const figure of figures) {
                    const price = Number(prices.get(figure.itemNo));
                    if (!Number.isFinite(price) || price <= 0) return;
                    totalValue += price * figure.quantity;
                }
                if (totalValue <= 0) return;

                // Das Overlay verwendet bevorzugt Rebrickable-IDs (fig-*), die
                // Summenberechnung dagegen die vollständigere BrickLink-Liste.
                // Beide IDs werden deshalb im selben Snapshot hinterlegt.
                for (let index = 0; index < rebrickableFigures.length; index += 6) {
                    const batch = rebrickableFigures.slice(index, index + 6);
                    await Promise.all(batch.map(async figure => {
                        const brickLinkItemNo = await resolveBrickLinkMinifigId(
                            figure.itemNo
                        );
                        if (!brickLinkItemNo) return;
                        const price = await getSharedMinifigPrice(brickLinkItemNo, 'EU');
                        rememberMinifigPrice(figure.itemNo, price, 'EU');
                    }));
                }

                updateMinifigureValueInDataBox(
                    Math.round((totalValue + Number.EPSILON) * 100) / 100,
                    true,
                    prices
                );
            })().catch(error => {
                console.warn(
                    'Brickmerge Tweaker: Minifiguren-Wert konnte nicht vorgeladen werden.',
                    error
                );
            });

            return minifigureValuePreloadPromise;
        }

        function replaceMinifigurenWithLink(setNum) {
            const scan = () => {
                document.querySelectorAll('.bm-minifig-link').forEach(link => {
                    link.replaceWith(document.createTextNode(link.textContent || 'Minifiguren'));
                });
                linkMinifigureCount(setNum);
                ensureMinifigureValueLoadButton();
            };
            scan();

            if (!document.body.dataset.bmMinifigClickHandler) {
                document.body.dataset.bmMinifigClickHandler = 'true';
                document.body.addEventListener('click', function (e) {
                    const link = e.target?.closest?.('.bm-minifig-count-link');
                    if (link) {
                        e.preventDefault();
                        showMinifigOverlay(link, setNum);
                    }
                });
            }

            if (!document.body.dataset.bmMinifigObserver) {
                document.body.dataset.bmMinifigObserver = 'true';
                let scanTimer = 0;
                const relevantSelector =
                    '.content.setdetails .productprice, #ol2nd, .bm-minifig-link';
                const isRelevantMutation = record => {
                    const isRelevantNode = node => {
                        return node.nodeType !== Node.ELEMENT_NODE
                            ? node.parentElement?.closest(relevantSelector)
                            : node.matches(relevantSelector) ||
                                node.closest?.(relevantSelector) ||
                                node.querySelector?.(relevantSelector);
                    };
                    if (record.type === 'characterData') {
                        return isRelevantNode(record.target);
                    }
                    return Array.from(record.addedNodes).some(isRelevantNode) ||
                        Array.from(record.removedNodes).some(isRelevantNode);
                };
                const observer = new MutationObserver(records => {
                    if (!records.some(isRelevantMutation)) return;
                    window.clearTimeout(scanTimer);
                    scanTimer = window.setTimeout(scan, 80);
                });
                const observerRoot = document.querySelector('.content.setdetails') ||
                    document.body;
                observer.observe(observerRoot, { childList: true, subtree: true });
                window.setTimeout(() => observer.disconnect(), 10000);
            }
            [0, 350, 1000, 2500].forEach(delay => {
                window.setTimeout(scan, delay);
            });
        }

        function linkMinifigureCount(setNum) {
            let candidates = Array.from(document.querySelectorAll(
                '.content.setdetails .productprice p, ' +
                '.content.setdetails p, #ol2nd p'
            ));
            if (candidates.length === 0) {
                candidates = Array.from(document.querySelectorAll('p'));
            }
            const details = candidates.find(paragraph =>
                /Minifiguren\s*:/i.test(paragraph.textContent || '') &&
                /Artikel-Nr\s*:|Setgewicht|EAN\s*:/i.test(paragraph.textContent || '')
            ) || candidates.find(paragraph =>
                /Minifiguren\s*:/i.test(paragraph.textContent || '')
            );
            if (!details || details.querySelector('.bm-minifig-count-link')) return;

            const line = findDetailsLineRange(details, /Minifiguren\s*:/i);
            if (!line) return;

            const linkedText = line.text;
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'bm-detail-line-link bm-minifig-count-link';
            link.setAttribute(
                'aria-label',
                `${linkedText} – Minifiguren anzeigen`
            );
            link.appendChild(line.range.extractContents());
            const tooltip = document.createElement('span');
            tooltip.className = 'bm-minifig-tooltip';
            tooltip.id = `bm-minifig-tooltip-${setNum}`;
            tooltip.setAttribute('role', 'tooltip');
            tooltip.textContent =
                'Minifiguren anzeigen · Basis: niedrigster aktueller ' +
                'BrickLink-EU-Neupreis je Figur, ohne Versand';
            link.setAttribute('aria-describedby', tooltip.id);
            link.appendChild(tooltip);
            line.range.insertNode(link);
            ensureMinifigureValueLoadButton();
        }

        function showMinifigOverlay(link, setNum) {
            document.querySelector('.bm-minifig-overlay .bm-minifig-close')?.click();

            const overlay = document.createElement('div');
            overlay.className = 'bm-minifig-overlay';
            overlay.innerHTML = `
                <div class="bm-minifig-backdrop"></div>
                <div class="bm-minifig-modal" role="dialog" aria-modal="true" aria-labelledby="bm-minifig-title">
                    <header class="bm-minifig-header">
                        <div class="bm-minifig-heading">
                            <h2 id="bm-minifig-title">Minifiguren</h2>
                            <div class="bm-minifig-subtitle-row">
                                <div class="bm-minifig-subtitle">LEGO Set ${setNum}</div>
                                <span class="bm-minifig-price-spinner" role="status"
                                    aria-label="BrickLink-Preise werden geladen"></span>
                            </div>
                        </div>
                        <button type="button" class="bm-minifig-close" title="Schließen" aria-label="Schließen">×</button>
                    </header>
                    <div class="bm-minifig-content" aria-live="polite">
                        <div class="bm-minifig-status">Minifiguren werden von Bricklink geladen …</div>
                    </div>
                </div>
            `;
            if (!document.getElementById('bm-minifig-style')) {
                const style = document.createElement('style');
                style.id = 'bm-minifig-style';
                style.textContent = `
                .bm-minifig-overlay {
                    position:fixed;
                    z-index:99999;
                    inset:0;
                    width:100vw;
                    height:100vh;
                    font-family:inherit;
                }
                .bm-minifig-backdrop {
                    position:absolute;
                    inset:0;
                    background:rgba(0,0,0,0.64);
                    z-index:0;
                    animation:bmfadein 0.16s ease-out;
                }
                .bm-minifig-modal {
                    position:absolute;
                    left:50%;
                    top:50%;
                    transform:translate(-50%,-50%);
                    display:flex;
                    flex-direction:column;
                    width:min(720px,calc(100vw - 32px));
                    max-height:min(84vh,760px);
                    overflow:hidden;
                    background:#fff;
                    border-top:5px solid #b00;
                    border-radius:4px;
                    box-shadow:0 18px 48px rgba(0,0,0,0.32);
                    z-index:1;
                    animation:bmzoom 0.16s ease-out;
                }
                .bm-minifig-header {
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    flex:0 0 auto;
                    min-height:64px;
                    padding:0.8rem 0.8rem 0.8rem 1.25rem;
                    border-bottom:1px solid #ddd;
                    background:#fff !important;
                    box-shadow:none !important;
                }
                .bm-minifig-heading {
                    min-width:0;
                }
                .bm-minifig-header h2 {
                    margin:0;
                    padding:0;
                    color:#333 !important;
                    -webkit-text-fill-color:#333 !important;
                    -webkit-background-clip:border-box !important;
                    background-clip:border-box !important;
                    background-color:transparent !important;
                    background-image:none !important;
                    font-size:1.25rem;
                    font-weight:700;
                    line-height:1.25;
                    text-shadow:none !important;
                }
                .bm-minifig-subtitle-row {
                    display:flex;
                    align-items:center;
                    gap:7px;
                    min-height:16px;
                }
                .bm-minifig-subtitle {
                    margin-top:3px;
                    color:#777;
                    font-size:0.75rem;
                    line-height:1.2;
                }
                .bm-minifig-price-spinner {
                    display:none;
                    flex:0 0 13px;
                    width:13px;
                    height:13px;
                    border:2px solid #d8d8d8;
                    border-top-color:#b00;
                    border-radius:50%;
                    box-sizing:border-box;
                    animation:bm-minifig-price-spin 0.7s linear infinite;
                }
                .bm-minifig-price-spinner.is-active {
                    display:inline-block;
                }
                @keyframes bm-minifig-price-spin {
                    to { transform:rotate(360deg); }
                }
                .bm-minifig-close {
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    flex:0 0 40px;
                    width:40px;
                    height:40px;
                    margin:0;
                    padding:0;
                    border:0;
                    border-radius:4px;
                    background:#f7eaea;
                    color:#800;
                    cursor:pointer;
                    font:bold 1.8rem/1 Arial,sans-serif;
                    text-shadow:none !important;
                }
                .bm-minifig-close:hover,
                .bm-minifig-close:focus {
                    background:#b00;
                    color:#fff;
                    outline:none;
                }
                .bm-minifig-content {
                    min-height:130px;
                    overflow:auto;
                    color:#333;
                    background:#fff;
                }
                .bm-minifig-status {
                    margin:28px 24px;
                    padding:14px 16px;
                    border-left:3px solid #b00;
                    background:#f5f5f5;
                    color:#555;
                    font-size:0.88rem;
                }
                .bm-minifig-retry {
                    display:inline-flex;
                    align-items:center;
                    min-height:34px;
                    margin:12px 0 0;
                    padding:7px 12px;
                    border:0;
                    border-radius:3px;
                    background:#b00;
                    color:#fff;
                    cursor:pointer;
                    font:inherit;
                    font-weight:600;
                }
                .bm-minifig-retry:hover,
                .bm-minifig-retry:focus {
                    background:#800;
                    color:#fff;
                    outline:none;
                }
                .bm-minifig-content table {
                    width:100%;
                    margin:0;
                    border:0;
                    border-collapse:collapse;
                    table-layout:fixed;
                    color:#333 !important;
                    font-size:0.9rem;
                }
                .bm-minifig-content tr {
                    border-bottom:1px solid #e3e3e3;
                    background:#fff;
                }
                .bm-minifig-content tr:last-child {
                    border-bottom:0;
                }
                .bm-minifig-content tr:hover td {
                    background:#fff8f6 !important;
                }
                .bm-minifig-content tr.bm-minifig-row-link {
                    cursor:pointer;
                }
                .bm-minifig-content tr.bm-minifig-row-link:focus {
                    outline:none;
                }
                .bm-minifig-content tr.bm-minifig-row-link:focus-visible td {
                    background:#fff8f6 !important;
                }
                .bm-minifig-content tr.bm-minifig-row-link:focus-visible td:first-child {
                    box-shadow:inset 3px 0 #b00;
                }
                .bm-minifig-content th,
                .bm-minifig-content td {
                    height:auto !important;
                    padding:16px 12px;
                    border:0 !important;
                    background:#fff !important;
                    color:#333 !important;
                    vertical-align:middle !important;
                    line-height:1.45;
                    overflow-wrap:anywhere;
                }
                .bm-minifig-content td:first-child {
                    width:136px;
                    padding-left:20px;
                    text-align:center;
                }
                .bm-minifig-content td:nth-child(2) {
                    display:none !important;
                    width:44px;
                    color:#777 !important;
                    text-align:center;
                }
                .bm-minifig-content td:nth-child(3) {
                    display:none !important;
                    width:150px;
                }
                .bm-minifig-content td:last-child {
                    padding-right:22px;
                    font-size:0.92rem;
                }
                .bm-minifig-content img {
                    display:block;
                    width:auto !important;
                    height:auto !important;
                    max-width:108px;
                    max-height:132px;
                    margin:0 auto;
                    object-fit:contain;
                }
                .bm-minifig-content a,
                .bm-minifig-content a font,
                .bm-minifig-content a span {
                    color:#b00 !important;
                    text-decoration:none;
                }
                .bm-minifig-content a:hover,
                .bm-minifig-content a:focus,
                .bm-minifig-content a:hover font,
                .bm-minifig-content a:hover span {
                    color:#600 !important;
                    text-decoration:underline;
                }
                .bm-minifig-bricklink-id {
                    display:inline-block;
                    margin-top:2px;
                    font-size:0.86rem;
                    font-weight:500;
                }
                .bm-minifig-content font {
                    color:#333 !important;
                }
                .bm-minifig-price {
                    display:inline-flex;
                    align-items:center;
                    gap:5px;
                    padding:1px 0;
                    color:#777 !important;
                    font-size:0.78rem;
                    font-weight:600;
                    line-height:1.25;
                }
                .bm-minifig-content a.bm-minifig-price:hover,
                .bm-minifig-content a.bm-minifig-price:focus {
                    color:#555 !important;
                    text-decoration:none;
                }
                .bm-minifig-actions {
                    display:flex;
                    align-items:center;
                    flex-wrap:wrap;
                    gap:5px 9px;
                    margin-top:5px;
                }
                .bm-minifig-price-icon {
                    display:block;
                    flex:0 0 auto;
                    width:auto !important;
                    height:13px !important;
                    max-width:64px !important;
                    max-height:13px !important;
                    margin:0 !important;
                    object-fit:contain;
                }
                .bm-minifig-country-badge {
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    min-width:20px;
                    height:15px;
                    padding:0 3px;
                    border-radius:2px;
                    background:#333;
                    color:#fff !important;
                    font-size:0.62rem;
                    font-weight:700;
                    line-height:1;
                    letter-spacing:0;
                }
                /* Länder-Badges bleiben auch innerhalb des klickbaren
                   BrickLink-Links neutral grau/weiß statt die rote Linkfarbe
                   zu erben. */
                .bm-minifig-content a .bm-minifig-country-badge,
                .bm-minifig-content a:hover .bm-minifig-country-badge,
                .bm-minifig-content a:focus .bm-minifig-country-badge {
                    background:#333 !important;
                    color:#fff !important;
                    text-decoration:none !important;
                }
                .bm-minifig-ebay-link {
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    margin-left:2px;
                    padding:2px;
                    border-radius:3px;
                    gap:5px;
                    color:#777 !important;
                    font-size:0.78rem;
                    font-weight:600;
                    line-height:1.25;
                }
                .bm-minifig-ebay-icon {
                    display:block;
                    width:38px !important;
                    height:14px !important;
                    max-width:38px !important;
                    max-height:14px !important;
                    margin:0 !important;
                    object-fit:cover;
                    object-position:center;
                    opacity:1;
                }
                .bm-minifig-ebay-price { color:#777 !important; }
                .bm-minifig-price.is-loading {
                    font-weight:400;
                }
                @media screen and (max-width:640px) {
                    .bm-minifig-modal {
                        left:0;
                        top:0;
                        width:100vw;
                        height:100vh;
                        height:100dvh;
                        max-height:none;
                        transform:none;
                        border-radius:0;
                        animation:bm-minifig-mobile-in 0.18s ease-out;
                    }
                    .bm-minifig-header {
                        min-height:64px;
                        padding:max(11px,env(safe-area-inset-top))
                            max(10px,env(safe-area-inset-right)) 10px
                            max(15px,env(safe-area-inset-left));
                    }
                    .bm-minifig-header h2 {
                        font-size:1.08rem;
                    }
                    .bm-minifig-content table,
                    .bm-minifig-content tbody {
                        display:block;
                    }
                    .bm-minifig-content {
                        flex:1 1 auto;
                        min-height:0;
                        padding-bottom:env(safe-area-inset-bottom);
                    }
                    .bm-minifig-content tr {
                        display:grid;
                        grid-template-columns:92px minmax(0,1fr);
                        width:100%;
                        min-height:132px;
                    }
                    .bm-minifig-content td {
                        display:block;
                        width:auto !important;
                        padding:10px 8px;
                    }
                    .bm-minifig-content td:first-child {
                        grid-column:1;
                        grid-row:1 / span 2;
                        padding:14px 6px;
                    }
                    .bm-minifig-content td:nth-child(2) {
                        display:none !important;
                    }
                    .bm-minifig-content td:nth-child(3) {
                        display:none !important;
                    }
                    .bm-minifig-content td:last-child {
                        grid-column:2;
                        grid-row:1;
                        align-self:start;
                        padding:14px 10px 14px 4px;
                    }
                    .bm-minifig-content img {
                        max-width:78px;
                        max-height:96px;
                    }
                }
                @keyframes bmfadein {
                    from { opacity:0; }
                    to { opacity:1; }
                }
                @keyframes bmzoom {
                    from { transform:translate(-50%,-48%); opacity:0; }
                    to { transform:translate(-50%,-50%); opacity:1; }
                }
                @keyframes bm-minifig-mobile-in {
                    from { transform:translateY(10px); opacity:0; }
                    to { transform:translateY(0); opacity:1; }
                }
                `;
                document.head.appendChild(style);
            }

            const previousBodyOverflow = document.body.style.overflow;
            document.body.appendChild(overlay);

            const requestHandles = new Set();
            const closeButton = overlay.querySelector('.bm-minifig-close');
            const close = () => {
                document.removeEventListener('keydown', handleKeydown);
                requestHandles.forEach(request => {
                    try {
                        request?.abort?.();
                    } catch (error) {
                        // The request may already have completed.
                    }
                });
                requestHandles.clear();
                document.body.style.overflow = previousBodyOverflow;
                overlay.remove();
                link?.focus();
            };
            const handleKeydown = event => {
                if (event.key === 'Escape') close();
            };

            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', handleKeydown);
            overlay.querySelector('.bm-minifig-backdrop').onclick = close;
            closeButton.onclick = close;
            const overlayTitle = overlay.querySelector('#bm-minifig-title');
            const titleLink = overlayTitle?.closest('a');
            if (titleLink && overlayTitle) {
                titleLink.replaceWith(overlayTitle);
            }
            closeButton.focus();

            const content = overlay.querySelector('.bm-minifig-content');
            const subtitle = overlay.querySelector('.bm-minifig-subtitle');
            const priceSpinner = overlay.querySelector('.bm-minifig-price-spinner');
            const cacheKey = `bm-minifigures-v13-${setNum}`;
            const cacheMaxAge = 6 * 60 * 60 * 1000;
            let loadSequence = 0;

            const setPriceSpinnerActive = active => {
                if (!priceSpinner) return;
                priceSpinner.classList.toggle('is-active', active);
                priceSpinner.setAttribute('aria-hidden', active ? 'false' : 'true');
            };

            const setStatus = (message, allowRetry = false) => {
                if (!overlay.isConnected) return;
                content.replaceChildren();
                const status = document.createElement('div');
                status.className = 'bm-minifig-status';
                const text = document.createElement('div');
                text.textContent = message;
                status.appendChild(text);
                if (allowRetry) {
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'bm-minifig-retry';
                    retry.textContent = 'Erneut versuchen';
                    retry.addEventListener('click', () => loadMinifigures(true));
                    status.appendChild(retry);
                }
                content.appendChild(status);
            };

            const makeAbsoluteUrl = value => {
                if (!value || value === '#') return value;
                try {
                    return new URL(value, 'https://www.bricklink.com').href;
                } catch (error) {
                    return value;
                }
            };

            const cloneAndCleanCell = sourceCell => {
                const cell = sourceCell.cloneNode(true);
                cell.querySelectorAll(
                    'script,style,iframe,object,embed,form,input,button'
                ).forEach(node => node.remove());
                [cell, ...cell.querySelectorAll('*')].forEach(element => {
                    Array.from(element.attributes || []).forEach(attribute => {
                        const name = attribute.name.toLowerCase();
                        if (
                            name.startsWith('on') ||
                            ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
                                'height', 'nowrap', 'style', 'valign', 'width'
                            ].includes(name)
                        ) {
                            element.removeAttribute(attribute.name);
                        }
                    });
                });
                cell.querySelectorAll('span').forEach(span => {
                    if (
                        !span.querySelector('img') &&
                        span.textContent.replace(/\s+/g, '') === '*'
                    ) {
                        span.remove();
                    }
                });
                cell.querySelectorAll('a[href]').forEach(anchor => {
                    anchor.href = makeAbsoluteUrl(anchor.getAttribute('href'));
                    anchor.target = '_blank';
                    anchor.rel = 'noopener noreferrer';
                });
                cell.querySelectorAll('img[src]').forEach(image => {
                    image.src = makeAbsoluteUrl(image.getAttribute('src'));
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
                });
                return cell;
            };

            const extractFigureData = table => Array.from(
                table.querySelectorAll('tbody > tr')
            ).map(row => {
                const itemLink = row.querySelector(
                    'a[href*="catalogitem.page?M="], ' +
                    'a[href*="catalogItemInv.asp?M="]'
                );
                const href = itemLink?.getAttribute('href') || '';
                const itemNo = href.match(/[?&]M=([^&#]+)/i)?.[1] ||
                    itemLink?.textContent?.match(/\b([a-z]{2,}\d+[a-z0-9]*)\b/i)?.[1] ||
                    '';
                const quantity = Number.parseInt(
                    row.cells[1]?.textContent?.match(/\d+/)?.[0] || '1',
                    10
                );
                let cleanItemNo = itemNo;
                try {
                    cleanItemNo = decodeURIComponent(itemNo);
                } catch (error) {
                    // BrickLink item numbers are normally plain ASCII.
                }
                return {
                    row,
                    itemNo: cleanItemNo.trim(),
                    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1
                };
            }).filter(figure => figure.itemNo);

            const buildFigureTable = figureRows => {
                const table = document.createElement('table');
                table.className = 'bm-minifig-table';
                const tbody = document.createElement('tbody');
                let figureCount = 0;

                figureRows.forEach(({ imageCell, quantityCell, itemCell, descriptionCell }) => {
                    if (!imageCell || !quantityCell || !itemCell || !descriptionCell) return;
                    const row = document.createElement('tr');
                    row.append(
                        cloneAndCleanCell(imageCell),
                        cloneAndCleanCell(quantityCell),
                        cloneAndCleanCell(itemCell),
                        cloneAndCleanCell(descriptionCell)
                    );
                    const quantity = Number.parseInt(
                        quantityCell.textContent.match(/\d+/)?.[0] || '1',
                        10
                    );
                    figureCount += Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
                    tbody.appendChild(row);
                });

                table.appendChild(tbody);
                return tbody.rows.length > 0
                    ? { kind: 'found', table, figureCount }
                    : null;
            };

            const setMinifigPriceLabel = (
                label,
                state,
                price = null,
                quantity = 1,
                region = 'DE'
            ) => {
                label.classList.toggle('is-loading', state === 'loading');
                const regionName = region === 'EU'
                    ? 'europäische'
                    : 'deutsche';
                const countryBadge = document.createElement('span');
                countryBadge.className = 'bm-minifig-country-badge';
                countryBadge.textContent = region;
                countryBadge.title = region === 'EU'
                    ? 'BrickLink-Händler aus der Europäischen Union'
                    : 'Nur deutsche BrickLink-Händler';

                let visibleText = 'wird geladen …';
                let accessibleText =
                    `Aktueller ${regionName} BrickLink-Preis wird geladen`;
                if (state === 'available') {
                    visibleText = `${formatEuroValue(price)} €`;
                    accessibleText =
                        `Aktueller ${regionName} BrickLink-Preis: ${visibleText}`;
                } else if (state === 'unavailable') {
                    visibleText = 'nicht verfügbar';
                    accessibleText =
                        `Aktueller ${regionName} BrickLink-Preis nicht verfügbar`;
                }
                label.replaceChildren(
                    countryBadge,
                    document.createTextNode(visibleText)
                );
                label.setAttribute('aria-label', accessibleText);
                label.title = state === 'available'
                    ? `Niedrigster aktueller Neupreis für ${region}, ohne Versand`
                    : accessibleText;
            };

            const buildBrickLinkOfferUrl = itemNo =>
                'https://www.bricklink.com/v2/catalog/catalogitem.page' +
                `?M=${encodeURIComponent(itemNo)}#T=S`;

            const buildBrickLinkMinifigImageUrl = itemNo =>
                'https://img.bricklink.com/ItemImage/MN/0/' +
                `${encodeURIComponent(itemNo)}.png`;

            const ensureMinifigImageFallback = (row, brickLinkItemNo) => {
                if (!row || !brickLinkItemNo) return;
                const imageCell = row.cells?.[0];
                if (!imageCell) return;
                let image = imageCell.querySelector('img');
                if (!image) {
                    image = document.createElement('img');
                    image.alt =
                        row.querySelector('strong, b')?.textContent?.trim() ||
                        brickLinkItemNo;
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
                    imageCell.appendChild(image);
                }
                const fallbackUrl = buildBrickLinkMinifigImageUrl(brickLinkItemNo);
                const useFallback = () => {
                    if (image.dataset.bmFallbackActive === 'true') {
                        image.hidden = true;
                        imageCell.classList.add('bm-minifig-image-unavailable');
                        return;
                    }
                    image.dataset.bmFallbackActive = 'true';
                    image.hidden = false;
                    image.src = fallbackUrl;
                };
                if (image.dataset.bmFallbackBound !== 'true') {
                    image.dataset.bmFallbackBound = 'true';
                    image.addEventListener('error', useFallback);
                    image.addEventListener('load', () => {
                        image.hidden = false;
                        imageCell.classList.remove('bm-minifig-image-unavailable');
                    });
                }
                const source = image.getAttribute('src') || '';
                if (!source || (image.complete && image.naturalWidth === 0)) {
                    useFallback();
                }
            };

            // eBay drosselt Serienabfragen deutlich früher als BrickLink. Die
            // Warteschlange verhindert, dass eine große Minifigurenliste alle
            // Requests gleichzeitig zum Worker schickt.
            const ebayMinifigQueue = [];
            let ebayMinifigRequestsActive = 0;
            const runNextEbayMinifigRequest = () => {
                while (ebayMinifigRequestsActive < 3 && ebayMinifigQueue.length) {
                    const entry = ebayMinifigQueue.shift();
                    ebayMinifigRequestsActive += 1;
                    Promise.resolve().then(entry.task).then(
                        entry.resolve,
                        entry.reject
                    ).finally(() => {
                        ebayMinifigRequestsActive -= 1;
                        runNextEbayMinifigRequest();
                    });
                }
            };
            const queueEbayMinifigRequest = task => new Promise((resolve, reject) => {
                ebayMinifigQueue.push({ task, resolve, reject });
                runNextEbayMinifigRequest();
            });

            const fetchEbayMinifigPrice = async itemNo => {
                const clientId = await getWorkerClientId();
                return queueEbayMinifigRequest(() => fetchWithCache(
                    makeApiCacheKey('ebay-minifig-v7', itemNo),
                    OFFER_CACHE_TTL,
                    () => new Promise((resolve, reject) => {
                        requestWithGm({
                            method: 'GET',
                            url: `${BM_WORKER_URL}/ebay-minifig?itemNo=` +
                                encodeURIComponent(itemNo),
                            headers: {
                                Accept: 'application/json',
                                'X-BM-Client-ID': clientId
                            },
                            timeout: 20000,
                            onload: response => {
                                if (response.status < 200 || response.status >= 400) {
                                    reject(new Error(`HTTP ${response.status}`));
                                    return;
                                }
                                try {
                                    resolve(JSON.parse(response.responseText || '{}'));
                                } catch (error) {
                                    reject(error);
                                }
                            },
                            onerror: () => reject(new Error('Netzwerkfehler')),
                            ontimeout: () => reject(new Error('Zeitüberschreitung'))
                        });
                    }),
                    result => result?.found === true &&
                        Number.isFinite(Number(result?.cheapest?.itemPrice)),
                    false
                ));
            };

            const loadEbayMinifigPrice = async (actions, rawItemNo) => {
                const label = actions?.querySelector('.bm-minifig-ebay-price');
                const itemNo = String(rawItemNo || '').trim();
                if (!label || !itemNo || label.dataset.bmLoaded === itemNo ||
                    !BM_isOfferShopEnabled('ebay-minifig')) return;
                label.dataset.bmLoaded = itemNo;

                try {
                    const result = await fetchEbayMinifigPrice(itemNo);
                    if (!label.isConnected || label.dataset.bmLoaded !== itemNo) return;
                    const itemPrice = Number(result?.cheapest?.itemPrice);
                    label.textContent = result?.found && Number.isFinite(itemPrice)
                        ? `${formatEuroValue(itemPrice)} €`
                        : 'nicht verfügbar';
                    if (result?.cheapest?.url) {
                        const link = label.closest('a');
                        link.href = result.cheapest.url;
                        const shipping = Number(result.cheapest.shipping);
                        const shippingText = Number.isFinite(shipping)
                            ? `; Versand ${formatEuroValue(shipping)} €`
                            : '';
                        link.title =
                            `Artikelpreis${shippingText}: ${result.cheapest.title}`;
                    }
                } catch (error) {
                    if (!label.isConnected || label.dataset.bmLoaded !== itemNo) return;
                    delete label.dataset.bmLoaded;
                    label.textContent = 'nicht verfügbar';
                    label.closest('a').title =
                        'eBay-Preisabfrage fehlgeschlagen; beim nächsten Öffnen erneut versuchen';
                    console.warn(
                        `Brickmerge Tweaker: eBay-Minifigurenpreis für ${itemNo} fehlgeschlagen.`,
                        error
                    );
                }
            };

            const ensureMinifigActions = (
                descriptionCell,
                brickLinkItemNo,
                targetUrl = buildBrickLinkOfferUrl(brickLinkItemNo)
            ) => {
                let actions = descriptionCell.querySelector('.bm-minifig-actions');
                if (!actions) {
                    actions = document.createElement('div');
                    actions.className = 'bm-minifig-actions';

                    const icon = document.createElement('img');
                    icon.className = 'bm-minifig-price-icon';
                    icon.src = 'https://static2.bricklink.com/img/bricklink_2026.svg';
                    icon.alt = 'BrickLink';
                    icon.loading = 'lazy';
                    icon.referrerPolicy = 'no-referrer';
                    actions.appendChild(icon);

                    ['DE', 'EU'].forEach(priceRegion => {
                        const priceLink = document.createElement('a');
                        priceLink.className = 'bm-minifig-price is-loading';
                        priceLink.dataset.bmRegion = priceRegion;
                        priceLink.target = '_blank';
                        priceLink.rel = 'noopener noreferrer';
                        actions.appendChild(priceLink);
                    });

                    const ebayLink = document.createElement('a');
                    ebayLink.className = 'bm-minifig-ebay-link';
                    ebayLink.target = '_blank';
                    ebayLink.rel = 'noopener noreferrer';
                    ebayLink.title = 'LEGO Minifigur bei eBay suchen (Sofort-Kaufen)';
                    ebayLink.setAttribute(
                        'aria-label',
                        'LEGO Minifigur bei eBay suchen, nur Sofort-Kaufen'
                    );
                    const ebayIcon = document.createElement('img');
                    ebayIcon.className = 'bm-minifig-ebay-icon';
                    ebayIcon.src = chrome.runtime.getURL(
                        'icons/logo-ebay-minifig.png'
                    );
                    ebayIcon.alt = 'eBay';
                    ebayIcon.loading = 'lazy';
                    ebayLink.appendChild(ebayIcon);
                    const ebayPrice = document.createElement('span');
                    ebayPrice.className = 'bm-minifig-ebay-price';
                    ebayPrice.textContent = 'wird geladen …';
                    ebayLink.appendChild(ebayPrice);
                    actions.appendChild(ebayLink);
                    descriptionCell.appendChild(actions);
                }

                actions.querySelectorAll('.bm-minifig-price').forEach(link => {
                    link.href = targetUrl;
                });
                const ebayLink = actions.querySelector('.bm-minifig-ebay-link');
                if (ebayLink) {
                    ebayLink.href = 'https://www.ebay.de/sch/i.html?' +
                        new URLSearchParams({
                            _nkw: `LEGO ${brickLinkItemNo}`,
                            LH_BIN: '1'
                        }).toString();
                }
                if (!/^fig-/i.test(brickLinkItemNo)) {
                    void loadEbayMinifigPrice(actions, brickLinkItemNo);
                }
                return actions;
            };

            const setMinifigBrickLinkId = (
                descriptionCell,
                brickLinkItemNo,
                targetUrl
            ) => {
                if (!descriptionCell || !brickLinkItemNo) return;
                const title = descriptionCell.querySelector('strong, b');
                if (!title) return;
                title.textContent = title.textContent.trim();

                const actions = descriptionCell.querySelector('.bm-minifig-actions');
                const idLink = document.createElement('a');
                idLink.className =
                    'bm-minifig-catalog-link bm-minifig-bricklink-id';
                idLink.href = targetUrl;
                idLink.target = '_blank';
                idLink.rel = 'noopener noreferrer';
                idLink.textContent = brickLinkItemNo;

                descriptionCell.replaceChildren(
                    title,
                    document.createElement('br'),
                    idLink
                );
                if (actions) descriptionCell.appendChild(actions);
            };

            const loadFigurePrices = async (table, sequence) => {
                const figures = extractFigureData(table);
                if (figures.length === 0) {
                    setPriceSpinnerActive(false);
                    return;
                }

                // Ein aus der Gesamtsumme wiederhergestellter Snapshot enthält
                // bereits die Einzelpreise. Diese werden vor jeder ID-Auflösung
                // sofort angezeigt, damit Summe und Overlay synchron wirken.
                figures.forEach(({ row, itemNo, quantity }) => {
                    const descriptionCell = row.cells[row.cells.length - 1];
                    if (!descriptionCell) return;
                    const actions = ensureMinifigActions(
                        descriptionCell,
                        itemNo,
                        buildBrickLinkOfferUrl(itemNo)
                    );
                    const priceLabel = actions.querySelector(
                        '.bm-minifig-price[data-bm-region="DE"]'
                    );
                    const euPriceLabel = actions.querySelector(
                        '.bm-minifig-price[data-bm-region="EU"]'
                    );
                    const cachedPrice = getSnapshotMinifigPrice(itemNo, 'DE');
                    const cachedEuPrice = getSnapshotMinifigPrice(itemNo, 'EU');
                    if (Number.isFinite(Number(cachedPrice)) && Number(cachedPrice) > 0) {
                        setMinifigPriceLabel(
                            priceLabel,
                            'available',
                            cachedPrice,
                            quantity
                        );
                    } else if (cachedPrice === null) {
                        setMinifigPriceLabel(priceLabel, 'unavailable');
                    } else {
                        setMinifigPriceLabel(priceLabel, 'loading');
                    }
                    setMinifigPriceLabel(euPriceLabel,
                        Number.isFinite(Number(cachedEuPrice)) && Number(cachedEuPrice) > 0
                            ? 'available'
                            : cachedEuPrice === null ? 'unavailable' : 'loading',
                        cachedEuPrice, quantity, 'EU');
                });

                setPriceSpinnerActive(true);
                try {
                    const figuresWithPriceIds = await Promise.all(
                        figures.map(async figure => ({
                            ...figure,
                            brickLinkItemNo: await resolveBrickLinkMinifigId(
                                figure.itemNo
                            )
                        }))
                    );
                    if (sequence !== loadSequence || !overlay.isConnected) return;

                    figuresWithPriceIds.forEach(({ row, itemNo, brickLinkItemNo }) => {
                        const visibleBrickLinkId = brickLinkItemNo || itemNo;
                        if (brickLinkItemNo) {
                            ensureMinifigImageFallback(row, brickLinkItemNo);
                        }
                        const targetUrl = brickLinkItemNo
                            ? buildBrickLinkOfferUrl(brickLinkItemNo)
                            : 'https://www.bricklink.com/v2/search.page?q=' +
                                encodeURIComponent(
                                    row.querySelector('strong')?.textContent || ''
                                );
                        row.querySelectorAll(
                            'a[href]:not(.bm-minifig-ebay-link)'
                        ).forEach(anchor => {
                            anchor.href = targetUrl;
                            anchor.target = '_blank';
                            anchor.rel = 'noopener noreferrer';
                        });
                        row.classList.add('bm-minifig-row-link');
                        row.dataset.bmBricklinkUrl = targetUrl;
                        row.tabIndex = 0;
                        row.setAttribute('role', 'link');
                        if (row.dataset.bmRowLinkBound !== 'true') {
                            row.dataset.bmRowLinkBound = 'true';
                            const openBrickLink = event => {
                                event?.preventDefault();
                                event?.stopPropagation();
                                window.open(
                                    row.dataset.bmBricklinkUrl,
                                    '_blank',
                                    'noopener,noreferrer'
                                );
                            };
                            row.addEventListener('click', event => {
                                if (event.target.closest?.('a[href]')) {
                                    event.stopPropagation();
                                    return;
                                }
                                openBrickLink(event);
                            });
                            row.addEventListener('keydown', event => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                openBrickLink(event);
                            });
                        }
                        const itemLink = row.querySelector('.bm-minifig-item-link');
                        if (itemLink && brickLinkItemNo) {
                            itemLink.textContent = brickLinkItemNo;
                        }
                        const catalogLink = row.querySelector('.bm-minifig-catalog-link');
                        if (catalogLink) {
                            catalogLink.textContent = brickLinkItemNo || catalogLink.textContent;
                        }
                        const descriptionCell = row.cells[row.cells.length - 1];
                        if (!descriptionCell) return;
                        setMinifigBrickLinkId(
                            descriptionCell,
                            visibleBrickLinkId,
                            targetUrl
                        );
                        const actions = ensureMinifigActions(
                            descriptionCell,
                            visibleBrickLinkId,
                            targetUrl
                        );
                        const priceLabel = actions.querySelector(
                            '.bm-minifig-price[data-bm-region="DE"]'
                        );
                        const cachedPrice = getSnapshotMinifigPrice(brickLinkItemNo, 'DE');
                        const cachedEuPrice = getSnapshotMinifigPrice(brickLinkItemNo, 'EU');
                        if (Number.isFinite(Number(cachedPrice)) && Number(cachedPrice) > 0) {
                            setMinifigPriceLabel(
                                priceLabel,
                                'available',
                                cachedPrice
                            );
                        } else if (cachedPrice === null) {
                            setMinifigPriceLabel(priceLabel, 'unavailable');
                        } else {
                            setMinifigPriceLabel(priceLabel, 'loading');
                        }
                        setMinifigPriceLabel(actions.querySelector(
                            '.bm-minifig-price[data-bm-region="EU"]'),
                            Number.isFinite(Number(cachedEuPrice)) && Number(cachedEuPrice) > 0
                                ? 'available'
                                : cachedEuPrice === null ? 'unavailable' : 'loading',
                            cachedEuPrice, 1, 'EU');
                    });

                    const uniqueItemNumbers = [...new Set(
                        figuresWithPriceIds
                            .map(figure => figure.brickLinkItemNo)
                            .filter(Boolean)
                    )];
                    const priceEntries = [];
                    for (let index = 0; index < uniqueItemNumbers.length; index += 6) {
                        const batch = uniqueItemNumbers.slice(index, index + 6);
                        priceEntries.push(...await Promise.all(
                            batch.map(async itemNo => {
                                const [dePrice, euPrice] = await Promise.all([
                                    getSharedMinifigPrice(itemNo, 'DE'),
                                    getSharedMinifigPrice(itemNo, 'EU')
                                ]);
                                return [itemNo, { DE: dePrice, EU: euPrice }];
                            })
                        ));
                    }
                    if (sequence !== loadSequence || !overlay.isConnected) return;

                    const prices = new Map(priceEntries);
                    let totalValue = 0;
                    let valuedFigureCount = 0;
                    const expectedFigureCount = figures.reduce(
                        (sum, figure) => sum + figure.quantity,
                        0
                    );
                    figuresWithPriceIds.forEach(({ row, brickLinkItemNo, quantity }) => {
                        const regionalPrices = prices.get(brickLinkItemNo) || {};
                        const price = Number(regionalPrices.DE);
                        const euPrice = Number(regionalPrices.EU);
                        const priceLabel = row.querySelector(
                            '.bm-minifig-price[data-bm-region="DE"]'
                        );
                        const euPriceLabel = row.querySelector(
                            '.bm-minifig-price[data-bm-region="EU"]'
                        );
                        if (priceLabel) {
                            if (!Number.isFinite(price) || price <= 0) {
                                setMinifigPriceLabel(priceLabel, 'unavailable');
                            } else {
                                setMinifigPriceLabel(
                                    priceLabel,
                                    'available',
                                    price,
                                    quantity
                                );
                            }
                        }
                        if (euPriceLabel) {
                            setMinifigPriceLabel(
                                euPriceLabel,
                                Number.isFinite(euPrice) && euPrice > 0
                                    ? 'available'
                                    : 'unavailable',
                                euPrice,
                                quantity,
                                'EU'
                            );
                        }
                        if (Number.isFinite(euPrice) && euPrice > 0) {
                            totalValue += euPrice * quantity;
                            valuedFigureCount += quantity;
                        }
                    });

                    if (
                        valuedFigureCount > 0 &&
                        valuedFigureCount === expectedFigureCount
                    ) {
                        updateMinifigureValueInDataBox(
                            Math.round((totalValue + Number.EPSILON) * 100) / 100,
                            true,
                            new Map(Array.from(
                                prices,
                                ([itemNo, regionalPrices]) => [
                                    itemNo,
                                    regionalPrices.EU
                                ]
                            ))
                        );
                    }
                } finally {
                    if (sequence === loadSequence && overlay.isConnected) {
                        setPriceSpinnerActive(false);
                    }
                }
            };

            const parseModernInventory = html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const inventoryTable = doc.querySelector('table.pciinvMainTable');
                if (!inventoryTable) return null;

                const figureRows = Array.from(
                    inventoryTable.querySelectorAll('tr.pciinvItemRow, tr')
                ).filter(row => row.querySelector(
                    'a[href*="catalogitem.page?M="], a[href*="catalogItemInv.asp?M="]'
                )).map(row => {
                    const cells = Array.from(row.cells);
                    return {
                        imageCell: cells[1],
                        quantityCell: cells[2],
                        itemCell: cells[3],
                        descriptionCell: cells[4]
                    };
                });
                // Null zwingt den Aufrufer in den Legacy-Fallback. BrickLink
                // liefert gelegentlich eine gültige Tabelle ohne Figurenzeilen.
                return buildFigureTable(figureRows);
            };

            const parseLegacyInventory = html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                if (!doc.querySelector('#id-main-legacy-table')) return null;

                const sourceRows = Array.from(doc.querySelectorAll('tr')).filter(row =>
                    row.querySelector(
                        'a[href*="catalogitem.page?M="], a[href*="catalogItemInv.asp?M="]'
                    ) && row.querySelector('img')
                );
                const figureRows = sourceRows.map(row => {
                    const cells = Array.from(row.cells);
                    const imageIndex = cells.findIndex(cell => cell.querySelector('img'));
                    const itemIndex = cells.findIndex(cell => cell.querySelector(
                        'a[href*="catalogitem.page?M="], a[href*="catalogItemInv.asp?M="]'
                    ));
                    const quantityIndex = cells.findIndex((cell, index) =>
                        index > imageIndex &&
                        index < itemIndex &&
                        /^\s*\d+\s*$/.test(cell.textContent || '')
                    );
                    const descriptionIndex = cells.findIndex((cell, index) =>
                        index > itemIndex &&
                        !/^\s*(?:PG|MID)?\s*$/.test(cell.textContent || '')
                    );
                    return {
                        imageCell: cells[imageIndex],
                        quantityCell: cells[quantityIndex],
                        itemCell: cells[itemIndex],
                        descriptionCell: cells[descriptionIndex]
                    };
                });
                return buildFigureTable(figureRows);
            };

            const readCache = () => {
                try {
                    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
                    if (
                        !cached ||
                        Date.now() - cached.savedAt > cacheMaxAge ||
                        !cached.tableHtml
                    ) {
                        return null;
                    }
                    const doc = new DOMParser().parseFromString(cached.tableHtml, 'text/html');
                    const table = doc.querySelector('table');
                    const figureCount = Number(cached.figureCount);
                    if (!table || !Number.isInteger(figureCount) || figureCount < 1) {
                        return null;
                    }
                    const expectedFigureCount = getPageMinifigureCount();
                    if (
                        expectedFigureCount > 0 &&
                        figureCount !== expectedFigureCount
                    ) {
                        return null;
                    }
                    return {
                        kind: 'found',
                        table: document.importNode(table, true),
                        figureCount
                    };
                } catch (error) {
                    return null;
                }
            };

            const renderResult = (result, sequence, saveToCache = true) => {
                if (
                    sequence !== loadSequence ||
                    !overlay.isConnected ||
                    result?.kind !== 'found'
                ) {
                    return;
                }
                subtitle.textContent =
                    `${result.figureCount} ` +
                    `${result.figureCount === 1 ? 'Figur' : 'Figuren'} · ` +
                    `LEGO Set ${setNum}`;
                content.replaceChildren(result.table);
                void loadFigurePrices(result.table, sequence).catch(error => {
                    console.warn('BrickLink-Minifigurenpreise konnten nicht geladen werden:', error);
                });
                if (saveToCache) {
                    try {
                        sessionStorage.setItem(cacheKey, JSON.stringify({
                            savedAt: Date.now(),
                            figureCount: result.figureCount,
                            tableHtml: result.table.outerHTML
                        }));
                    } catch (error) {
                        // The overlay still works when session storage is unavailable.
                    }
                }
            };

            const requestWithRetry = (
                url,
                parseResponse,
                sequence,
                onSuccess,
                onExhausted,
                attempt = 0
            ) => {
                if (sequence !== loadSequence || !overlay.isConnected) return;
                let request;
                let finished = false;
                const retryOrFail = () => {
                    if (finished) return;
                    finished = true;
                    requestHandles.delete(request);
                    if (sequence !== loadSequence || !overlay.isConnected) return;
                    if (attempt < 1) {
                        window.setTimeout(() => requestWithRetry(
                            url,
                            parseResponse,
                            sequence,
                            onSuccess,
                            onExhausted,
                            attempt + 1
                        ), 550);
                    } else {
                        onExhausted();
                    }
                };
                request = cachedGmRequest(
                    makeApiCacheKey('bricklink-minifig-inventory', url),
                    MINIFIG_INVENTORY_CACHE_TTL,
                    {
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
                    },
                    timeout: 15000,
                    onload: response => {
                        if (finished) return;
                        requestHandles.delete(request);
                        if (sequence !== loadSequence || !overlay.isConnected) return;
                        const body = String(response.responseText || '');
                        const parsed = response.status === 200 && body.length > 200
                            ? parseResponse(body)
                            : null;
                        if (parsed) {
                            finished = true;
                            onSuccess(parsed);
                        } else {
                            retryOrFail();
                        }
                    },
                    onerror: retryOrFail,
                    ontimeout: retryOrFail
                });
                if (request) requestHandles.add(request);
            };

            const loadRebrickableInventory = async (sequence, onFallback) => {
                try {
                    const entries = await fetchRebrickableMinifigs();
                    if (sequence !== loadSequence || !overlay.isConnected) return;
                    const result = buildRebrickableFigureTable(entries);
                    if (result) {
                        renderResult(result, sequence);
                        return;
                    }
                } catch (error) {
                    // Ohne persönlichen Rebrickable-Key oder bei einem API-Fehler
                    // bleibt BrickLink als lokaler Fallback verfügbar.
                }
                if (sequence !== loadSequence || !overlay.isConnected) return;
                if (typeof onFallback === 'function') {
                    onFallback();
                    return;
                }
                setStatus('Rebrickable konnte das Inventar momentan nicht laden. Bitte versuche es erneut.', true);
            };

            const loadLegacyInventory = sequence => {
                const legacyUrl =
                    `https://www.bricklink.com/catalogItemInv.asp?S=${setNum}-1` +
                    '&viewItemType=M';
                requestWithRetry(
                    legacyUrl,
                    parseLegacyInventory,
                    sequence,
                    result => renderResult(result, sequence),
                    () => void loadRebrickableInventory(sequence)
                );
            };

            const loadModernInventory = sequence => {
                const catalogUrl =
                    `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNum}-1`;
                requestWithRetry(
                    catalogUrl,
                    html => {
                        const match = html.match(/\bidItem\s*:\s*(\d+)/);
                        const itemId = Number(match?.[1]);
                        return Number.isInteger(itemId) && itemId > 0 ? itemId : null;
                    },
                    sequence,
                    itemId => {
                        const inventoryUrl =
                            'https://www.bricklink.com/v2/catalog/' +
                            'catalogitem_invtab.page' +
                            `?idItem=${encodeURIComponent(itemId)}` +
                            '&st=1&show_invid=0&show_matchcolor=0' +
                            '&show_pglink=0&show_pcc=0&show_missingpcc=0' +
                            `&itemNoSeq=${encodeURIComponent(`${setNum}-1`)}`;
                        requestWithRetry(
                            inventoryUrl,
                            parseModernInventory,
                            sequence,
                            result => {
                                if (result.kind === 'none') {
                                    setStatus('Keine Minifiguren gefunden.');
                                    return;
                                }
                                renderResult(result, sequence);
                            },
                            () => loadLegacyInventory(sequence)
                        );
                    },
                    () => loadLegacyInventory(sequence)
                );
            };

            const loadPreferredInventory = sequence => {
                // Rebrickable liefert die saubereren Minifigurenbilder. Die
                // BrickLink-ID wird danach weiterhin je Figur für Preise ermittelt.
                loadRebrickableInventory(sequence, () => loadModernInventory(sequence));
            };

            const loadMinifigures = forceReload => {
                loadSequence += 1;
                const sequence = loadSequence;
                requestHandles.forEach(request => {
                    try {
                        request?.abort?.();
                    } catch (error) {
                        // The request may already have completed.
                    }
                });
                requestHandles.clear();

                if (!forceReload) {
                    const cached = readCache();
                    if (cached) {
                        renderResult(cached, sequence, false);
                        return;
                    }
                } else {
                    try {
                        sessionStorage.removeItem(cacheKey);
                    } catch (error) {
                        // Continue without cache invalidation.
                    }
                }
                subtitle.textContent = `LEGO Set ${setNum}`;
                setStatus('Minifiguren werden geladen …');
                void loadPreferredInventory(sequence);
            };

            loadMinifigures(false);
        }
        try {
            replaceMinifigurenWithLink(setNum);
            linkMinifigureCount(setNum);
            showCachedMinifigureValue();
            ensureMinifigureValueLoadButton();
            window.addEventListener('load', () => {
                try {
                    linkMinifigureCount(setNum);
                } catch (error) {
                    console.error(
                        'Brickmerge Tweaker: Minifiguren-Anzahl konnte nicht verlinkt werden.',
                        error
                    );
                }
            }, { once: true });
        } catch (error) {
            console.error(
                'Brickmerge Tweaker: Minifiguren-Links konnten nicht initialisiert werden.',
                error
            );
        }
    }

    // ==========================================
    // 5. GUTSCHEIN-RABATTRECHNER (effektive Preise)
    // ==========================================
    function getCurrentSetUvp() {
        if (resolvedSetUvp !== null) return resolvedSetUvp;

        const candidates = document.querySelectorAll(
            '.stroke[title*="unverbindliche Preisempfehlung"], [title="unverbindliche Preisempfehlung"]'
        );
        for (const candidate of candidates) {
            const value = parseEuroValue(candidate.textContent);
            if (value !== null && value > 0) {
                resolvedSetUvp = value;
                return value;
            }
        }
        return null;
    }

    function getDiscountPriceReference() {
        const uvp = getCurrentSetUvp();
        if (uvp !== null && uvp > 0) {
            return {
                value: uvp,
                relation: 'zur UVP'
            };
        }

        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return null;
        const prices = Array.from(offerlist.querySelectorAll('span.price'))
            .filter(priceSpan => !priceSpan.closest(
                '[data-bm-sold-out="true"], #soldOut'
            ))
            .map(getBaseOfferPrice)
            .filter(price => Number.isFinite(price) && price > 0);
        if (prices.length === 0) return null;

        return {
            value: Math.max(...prices),
            relation: 'zum höchsten Angebotspreis'
        };
    }

    function getOriginalOfferTitle(anchor) {
        if (!anchor) return '';

        if (!anchor.dataset.bmOriginalTooltip && !anchor.getAttribute('title')) {
            anchor.dispatchEvent(new CustomEvent('bm-tooltip-capture-request', { bubbles: true }));
        }

        return anchor.dataset.bmOriginalTooltip || anchor.getAttribute('title') || '';
    }

    function ensureTooltipBridge() {
        if (document.getElementById('bm-tooltip-bridge')) return;

        const bridge = document.createElement('script');
        bridge.id = 'bm-tooltip-bridge';
        bridge.textContent = `
            (() => {
                const tooltipText = (content) => {
                    if (typeof content === 'string') return content.trim();
                    if (content?.jquery && typeof content.text === 'function') return content.text().trim();
                    if (typeof content?.textContent === 'string') return content.textContent.trim();
                    return '';
                };

                const captureTooltip = (anchor) => {
                    if (!anchor || anchor.dataset.bmOriginalTooltip) return;

                    let content = anchor.getAttribute('title') || '';
                    if (!content && window.jQuery && typeof window.jQuery.fn?.tooltipster === 'function') {
                        try {
                            const target = window.jQuery(anchor);
                            if (target.hasClass('tooltipstered')) {
                                content = tooltipText(target.tooltipster('content'));
                            }
                        } catch (e) {}
                    }

                    if (content) anchor.dataset.bmOriginalTooltip = content;
                };

                const syncTooltip = (anchor) => {
                    const content = anchor?.dataset?.bmTooltip;
                    if (!content || !window.jQuery || typeof window.jQuery.fn?.tooltipster !== 'function') return;
                    try {
                        const target = window.jQuery(anchor);
                        if (target.hasClass('tooltipstered')) {
                            target.tooltipster('content', content);
                        }
                    } catch (e) {}
                };

                const enableTooltip = (anchor) => {
                    if (!anchor || !window.jQuery ||
                        typeof window.jQuery.fn?.tooltipster !== 'function') return;
                    const content = anchor.dataset.bmTooltip ||
                        anchor.getAttribute('title') || '';
                    if (!content) return;
                    try {
                        const target = window.jQuery(anchor);
                        if (target.hasClass('tooltipstered')) {
                            target.tooltipster('content', content);
                        } else {
                            target.tooltipster({
                                content,
                                maxWidth: 360,
                                position: 'top',
                                delay: 100
                            });
                        }
                    } catch (e) {}
                };

                document.addEventListener('bm-tooltip-capture-request', event => {
                    captureTooltip(event.target);
                }, true);

                document.addEventListener('bm-tooltip-updated', event => {
                    captureTooltip(event.target);
                    syncTooltip(event.target);
                }, true);

                document.addEventListener('bm-tooltip-enable-request', event => {
                    enableTooltip(event.target);
                }, true);

                document.addEventListener('bm-tooltip-disable-request', event => {
                    const anchor = event.target;
                    captureTooltip(anchor);

                    if (window.jQuery && typeof window.jQuery.fn?.tooltipster === 'function') {
                        try {
                            const target = window.jQuery(anchor);
                            if (target.hasClass('tooltipstered')) {
                                target.tooltipster('hide');
                                target.tooltipster('destroy');
                            }
                        } catch (e) {}
                    }

                    anchor.removeAttribute('title');
                    anchor.classList.remove('tooltipster', 'tooltipstered');
                    anchor.dataset.bmTooltipDisabled = 'true';
                }, true);

                document.addEventListener('mouseover', event => {
                    const anchor = event.target.closest?.('a.tooltipster');
                    if (!anchor) return;
                    captureTooltip(anchor);
                    if (anchor.dataset.bmTooltip) syncTooltip(anchor);
                }, true);

                document.querySelectorAll('#offerlist a.tooltipster').forEach(captureTooltip);
            })();
        `;
        document.documentElement.appendChild(bridge);
    }

    function disableOfferListTooltips() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

        offerlist.querySelectorAll('a').forEach(anchor => {
            if (anchor.dataset.bmKeepTooltip === 'true') return;
            if (
                anchor.dataset.bmTooltipDisabled === 'true' &&
                !anchor.classList.contains('tooltipster') &&
                !anchor.classList.contains('tooltipstered') &&
                !anchor.hasAttribute('title')
            ) {
                return;
            }
            const hasTooltip = anchor.classList.contains('tooltipster') ||
                anchor.classList.contains('tooltipstered') ||
                anchor.hasAttribute('title') ||
                anchor.dataset.bmOriginalTooltip ||
                anchor.dataset.bmTooltip;
            if (!hasTooltip) return;

            // Erst jetzt deaktivieren: Versandkosten, Gutscheine und Zeitstempel
            // wurden in den vorherigen Verarbeitungsschritten bereits gelesen.
            getOriginalOfferTitle(anchor);
            anchor.dispatchEvent(new CustomEvent('bm-tooltip-disable-request', {
                bubbles: true
            }));
            anchor.removeAttribute('title');
            anchor.classList.remove('tooltipster', 'tooltipstered');
        });
    }

    // Bewusst auf oberster Ebene deklariert (nicht in einem if-Block), da
    // Funktionsdeklarationen in Strict Mode block-scoped sind. So bleibt die
    // Funktion aus Modul 4 (Observer/Load-Handler) sicher aufrufbar.
    function applyRetailerDiscounts() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();
        const entries = getConfiguredRetailerDiscounts();
        const priceReference = getDiscountPriceReference();

        // Normalisiert Umlaute/ß, damit "Müller" == "mueller" gematcht wird.
        function normalizeRetailerString(str) {
            return str
                .toLowerCase()
                .replace(/ä/g, 'ae')
                .replace(/ö/g, 'oe')
                .replace(/ü/g, 'ue')
                .replace(/ß/g, 'ss')
                .trim();
        }

        const configuredEntries = Array.from(entries)
            .filter(([, discount]) =>
                discount && typeof discount.rate === 'number'
            )
            .map(([domain, discount]) => ({
                domain,
                rate: discount.rate,
                mid: discount.mid === undefined || discount.mid === null
                    ? null
                    : String(discount.mid),
                aliases: new Set(
                    (Array.isArray(discount.aliases) ? discount.aliases : [])
                        .map(normalizeRetailerString)
                )
            }));
        const configuredEntriesByMid = new Map();
        configuredEntries.forEach(entry => {
            if (entry.mid !== null && !configuredEntriesByMid.has(entry.mid)) {
                configuredEntriesByMid.set(entry.mid, entry);
            }
        });

        // Die Händler-ID ist eindeutig. Nur wenn sie fehlt, werden Händlernamen
        // exakt mit den konfigurierten Aliasen verglichen.
        function matchRetailerDiscount(priceSpan, candidates) {
            const row = priceSpan.closest('[data-mid]');
            const mid = row ? row.getAttribute('data-mid') : null;

            if (mid) {
                const match = configuredEntriesByMid.get(String(mid));
                if (match) {
                    return { domain: match.domain, rate: match.rate };
                }
            }

            const normalizedCandidates = new Set(
                candidates.map(normalizeRetailerString)
            );
            for (const entry of configuredEntries) {
                if (Array.from(entry.aliases).some(alias =>
                    normalizedCandidates.has(alias)
                )) {
                    return { domain: entry.domain, rate: entry.rate };
                }
            }

            return null;
        }

        // Sammelt den Händlernamen aus mehreren unabhängigen Quellen, statt sich auf
        // eine einzige zu verlassen (auf der Live-Seite war z.B. mal das title-Attribut
        // nicht eindeutig genug, mal der .merchant-Span leer - je nach Händler/Zeile).
        // Quelle 1: title-Attribut des Links ("Link zu eBay.de - Preisangabe vom...")
        // Quelle 2: (auf Mobile sichtbarer) .merchant-Span direkt im Preis-Element
        // Quelle 3: alt-Attribut des Händler-Logos, verknüpft über die gemeinsame
        //           data-mid-Kennung von Preiszeile und Icon-Zeile
        function extractMerchantCandidates(priceSpan) {
            const candidates = [];

            const anchor = priceSpan.closest('a');
            const originalTitle = getOriginalOfferTitle(anchor);
            if (originalTitle) {
                const titleMatch = originalTitle.match(/Link zu (.+?)(?:\s+-\s+|$)/i);
                if (titleMatch && titleMatch[1]) candidates.push(titleMatch[1].trim());
            }

            const merchantSpan = priceSpan.querySelector('.merchant');
            if (merchantSpan) {
                const text = merchantSpan.textContent.trim();
                if (text) candidates.push(text);
            }

            const rowWithMid = priceSpan.closest('[data-mid]');
            if (rowWithMid) {
                const mid = rowWithMid.getAttribute('data-mid');
                if (mid) {
                    const iconImg = document.querySelector(`#mid${mid} img[alt]`);
                    if (iconImg && iconImg.alt) candidates.push(iconImg.alt.trim());
                }
            }

            return candidates.filter(Boolean);
        }

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const discountRow = priceSpan.closest('.pricerow');
            const candidates = extractMerchantCandidates(priceSpan);
            const match = matchRetailerDiscount(priceSpan, candidates);
            if (!match) {
                if (discountRow) {
                    delete discountRow.dataset.bmDiscountApplied;
                    delete discountRow.dataset.bmRetailerRate;
                    delete discountRow.dataset.bmRetailerDomain;
                    delete discountRow.dataset.bmEffectivePrice;
                    delete discountRow.dataset.bmEffectiveDiscount;
                    discountRow.classList.remove('bm-has-retailer-discount');
                }
                return;
            }

            const originalPrice = getBaseOfferPrice(priceSpan);
            if (originalPrice === null || originalPrice <= 0) return;

            // Der Prozentwert muss zum angezeigten Cent-Preis passen. Andernfalls
            // können sich bei LEGO/Müller Abweichungen in der letzten Zehntelstelle ergeben.
            const effectivePrice = Math.round(
                (originalPrice * (1 - match.rate) + Number.EPSILON) * 100
            ) / 100;
            let effectiveDiscountPercent = null;

            if (priceReference) {
                effectiveDiscountPercent =
                    (1 - (effectivePrice / priceReference.value)) * 100;
            } else {
                // Fallback: vorhandenen Brickmerge-Rabatt mit dem Händlerrabatt
                // kombinieren, falls auf der Seite keine UVP-Zeile vorhanden ist.
                const title = getOriginalOfferTitle(priceSpan.closest('a'));
                const baseDiscountMatch = title.match(/\((\d+(?:[.,]\d+)?)%\)\s*gespart/i);
                if (baseDiscountMatch) {
                    const baseDiscount = parseFloat(baseDiscountMatch[1].replace(',', '.')) / 100;
                    effectiveDiscountPercent = (1 - ((1 - baseDiscount) * (1 - match.rate))) * 100;
                }
            }

            const effectivePriceLabel = effectivePrice.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            const effectiveDiscountLabel = effectiveDiscountPercent === null
                ? null
                : Math.abs(effectiveDiscountPercent).toLocaleString('de-DE', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1
                });
            const voucherDiscountLabel = (match.rate * 100).toLocaleString('de-DE', {
                maximumFractionDigits: 2
            });

            if (discountRow) {
                const offerLink = priceSpan.closest('a');
                if (offerLink) {
                    const originalTooltip = getOriginalOfferTitle(offerLink);
                    if (originalTooltip) {
                        offerLink.dataset.bmOriginalTooltip = originalTooltip;
                    }

                    const effectiveTooltip = effectiveDiscountLabel === null
                        ? `Gutscheinrabatt: ${voucherDiscountLabel}%. Effektivpreis nach Händlerrabatt: ${effectivePriceLabel} €.`
                        : `Gutscheinrabatt: ${voucherDiscountLabel}%. ` +
                            `Effektivpreis nach Händlerrabatt: ${effectivePriceLabel} € ` +
                            `(${effectiveDiscountLabel}% Rabatt ` +
                            `${priceReference.relation} von ` +
                            `${formatEuroValue(priceReference.value)} €).`;
                    const combinedTooltip = [originalTooltip, effectiveTooltip].filter(Boolean).join(' ');

                    if (offerLink.dataset.bmTooltip !== combinedTooltip) {
                        offerLink.dataset.bmTooltip = combinedTooltip;
                        offerLink.setAttribute('title', combinedTooltip);
                        offerLink.dispatchEvent(new CustomEvent(
                            'bm-tooltip-updated',
                            { bubbles: true }
                        ));
                    }
                }

                discountRow.dataset.bmDiscountApplied = 'true';
                discountRow.dataset.bmRetailerRate = String(match.rate);
                discountRow.dataset.bmRetailerDomain = match.domain;
                discountRow.dataset.bmEffectivePrice = String(effectivePrice);
                if (effectiveDiscountPercent !== null) {
                    discountRow.dataset.bmEffectiveDiscount = String(effectiveDiscountPercent);
                } else {
                    delete discountRow.dataset.bmEffectiveDiscount;
                }
                discountRow.classList.add('bm-has-retailer-discount');
            }
        });
    }

    // ==========================================
    // 4. RABATT-RECHNER PRO MODUL
    // ==========================================
    let isModifying = false;

    function calculateDiscount() {
            if (isModifying) return;
            isModifying = true;

            try {
                const existingRow = document.getElementById('all-time-bestpreis-discount');

                const prices = [];
                const offerPrices = [];

                // Aktuelle Preise sammeln
                const priceElements = document.querySelectorAll(
                    '.content.setdetails .topprice, ' +
                    '#offerlist .theprice, #offerlist .price, ' +
                    '#offerlist .offer-price, #offerlist td.price, ' +
                    '#offerlist span.price'
                );
                priceElements.forEach(el => {
                    if (el.closest('[data-bm-sold-out="true"]')) {
                        return;
                    }
                    const inlineDecoration = el.style?.textDecoration || '';
                    if (
                        el.closest('del, s, .strike, .stroke, .uvp') ||
                        /line-through/i.test(inlineDecoration)
                    ) {
                        return;
                    }
                    if (el.classList.contains('shipping') || el.closest('.shipping-costs')) {
                        return;
                    }

                    const text = el.textContent.trim();
                    const priceMatch = text.match(/(\d+[\d\s.,]*)\s*€/);
                    if (priceMatch) {
                        let priceStr = priceMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
                        let price = parseFloat(priceStr);
                        if (!isNaN(price) && price > 0) {
                            prices.push(price);
                        }
                    }
                });

                document.querySelectorAll(
                    '#offerlist .medium-4.small-9.columns.pricerow'
                ).forEach(priceRow => {
                    if (priceRow.dataset.bmSoldOut === 'true') return;
                    const priceSpan = priceRow.querySelector('span.price');
                    const price = priceSpan ? getBaseOfferPrice(priceSpan) : null;
                    if (price !== null && price > 0) {
                        offerPrices.push(price);
                    }
                });

                const uniqueSortedPrices = [...new Set(prices)].sort((a, b) => a - b);
                const uniqueSortedOfferPrices = [
                    ...new Set(offerPrices)
                ].sort((a, b) => a - b);

                let hasOfferComparison = false;
                if (uniqueSortedOfferPrices.length >= 2) {
                    const price1 = uniqueSortedOfferPrices[0]; // Günstigstes Angebot
                    // uniqueSortedOfferPrices entsteht aus einem Set numerischer Werte, d.h. exakt
                    // identische Preise sind hier bereits herausgefiltert. price2 ist also immer
                    // schon der nächst-*unterschiedliche* (höhere) Preis - "wenn zweitbestes
                    // identisch, dann drittbestes nehmen" ist dadurch automatisch erfüllt.
                    const price2 = uniqueSortedOfferPrices[1]; // nächstteureres, abweichendes Angebot

                    // Rabatt als ganze Zahl runden
                    const discount = ((1 - (price1 / price2)) * 100).toFixed(0);

                    if (Number(discount) > 0) {
                        ensureFeaturedBlackBubble(discount);
                        createBestPriceBlackBubble(discount);
                        hasOfferComparison = true;
                    }
                }
                if (!hasOfferComparison) {
                    document.querySelectorAll('.black-discount-bubble')
                        .forEach(element => element.remove());
                }

                // All-Time-Bestpreis suchen und einfügen
                if (uniqueSortedPrices.length >= 1) {
                    const currentBestPrice = uniqueSortedPrices[0];
                    const historicalData = findAllTimeBestPrice();
                    if (historicalData) {
                        insertAllTimeDiscountRow(
                            currentBestPrice,
                            historicalData.price,
                            historicalData.element,
                            historicalData.detailSuffix
                        );
                    } else {
                        existingRow?.remove();
                    }
                } else {
                    existingRow?.remove();
                }

            } catch (e) {
                console.error("Fehler im Brickmerge-Script:", e);
            } finally {
                isModifying = false;
            }
    }

        // Wenn es auf dem Produktbild keine rote UVP-Bubble gibt, fehlt sonst die
        // Vorlage zum Klonen. In dem Fall zeigen wir die schwarze Bubble einzeln.
    function ensureFeaturedBlackBubble(discountText) {
            const featuredContainers = [
                document.querySelector(
                    '.content.setdetails .large-3.medium-4.columns.hide-for-small'
                ),
                document.querySelector(
                    '.content.setdetails .show-for-small-only.text-center'
                )
            ].filter(Boolean);

            featuredContainers.forEach(container => {
                let bubble = container.querySelector(':scope > .bm-featured-black-bubble');
                if (!bubble) {
                    bubble = document.createElement('div');
                    bubble.className = 'black-discount-bubble bm-featured-black-bubble';
                    container.prepend(bubble);
                }
                const nativeRedBubble = Array.from(container.querySelectorAll(
                    ':scope > .off, :scope > span[style*="position"], ' +
                    ':scope > div[style*="position"]'
                )).find(element =>
                    element !== bubble &&
                    !element.classList.contains('black-discount-bubble') &&
                    /%/.test(element.textContent || '')
                );
                bubble.classList.toggle(
                    'bm-featured-black-bubble-stacked',
                    Boolean(nativeRedBubble)
                );
                bubble.textContent = `${discountText}%`;
                bubble.title = `${discountText}% günstiger als das nächstteurere Angebot`;
            });
    }

        // Der Abstand zum nächstteureren Angebot gehört auch immer an den
        // Brickmerge-Bestpreis, unabhängig davon, ob dort ein UVP-Badge existiert.
    function createBestPriceBlackBubble(discountText) {
            document.querySelectorAll('.topprice').forEach(topprice => {
                let badge = topprice.querySelector(
                    ':scope > .bm-bestprice-black-bubble'
                );
                topprice.querySelectorAll(':scope > .bm-bestprice-black-bubble')
                    .forEach((candidate, index) => {
                        if (index > 0) candidate.remove();
                    });
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className =
                        'black-discount-bubble bm-bestprice-black-bubble';
                    topprice.appendChild(badge);
                }
                badge.textContent = `${discountText}%`;
                badge.title = `${discountText}% günstiger als das nächstteurere Angebot`;
                const hasNativeDiscountBubble = Array.from(
                    topprice.querySelectorAll(
                        ':scope > .off, :scope > span[style*="position"], ' +
                        ':scope > div[style*="position"]'
                    )
                ).some(element => {
                    if (element.classList.contains('black-discount-bubble')) return false;
                    if (!/%/.test(element.textContent || '')) return false;
                    const inlineStyle = element.getAttribute('style') || '';
                    return element.classList.contains('off') ||
                        /position\s*:\s*absolute/i.test(inlineStyle);
                });
                badge.classList.toggle(
                    'bm-bestprice-black-bubble-single',
                    !hasNativeDiscountBubble
                );
                topprice.style.setProperty('position', 'relative');
            });
    }

        // Suche nach dem "bisherigen Bestpreis"
    function findAllTimeBestPrice() {
            const roots = [
                document.querySelector('.content.setdetails .productprice'),
                document.getElementById('ol2nd')
            ].filter(Boolean);
            if (roots.length === 0) {
                const details = document.querySelector('.content.setdetails');
                if (details) roots.push(details);
            }

            for (const root of roots) {
                const walker = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_TEXT
                );
                let node;
                while (node = walker.nextNode()) {
                    if (/(?:bisheriger\s+bestpreis|all-time-bestpreis)/i.test(
                        node.nodeValue
                    )) {
                        const container = node.parentElement;
                        const historicalInfo = parseHistoricalBestPriceText(
                            container.textContent
                        );
                        if (historicalInfo) {
                            return { element: container, ...historicalInfo };
                        }
                    }
                }
            }
            return null;
    }

    function updateSidebarHistoricalBestPriceDetail(matchedElement, detailSuffix) {
            writeHistoricalBestPriceDetailToSidebar(
                nativeChartHistoricalBestPriceInfo?.detailSuffix || detailSuffix,
                matchedElement
            );
    }

        // Fügt die Rabatt-Zeile ein
    function insertAllTimeDiscountRow(currentPrice, allTimeBest, matchedElement, detailSuffix = '') {
            // Differenz: Negativ = günstiger, Positiv = teurer
            const diffPercent = ((currentPrice - allTimeBest) / allTimeBest) * 100;

            // Farbe: Grün, wenn günstiger oder gleich (negativ/0), Rot wenn teurer (positiv)
            const color = diffPercent <= 0 ? '#1b5e20' : '#b71c1c';
            const signPrefix = diffPercent > 0 ? '+' : '';
            const percentStr = `${signPrefix}${diffPercent.toFixed(1).replace('.', ',')}%`;

            // Als eigene Zeile einfügen: die umliegenden Infozeilen (UVP, 180-Tage-
            // Bestpreis, etc.) sind alle durch "<br />&nbsp;|" voneinander getrennt,
            // hier wird exakt demselben Muster gefolgt, statt inline anzuhängen
            // (sonst rutscht der Text ohne Umbruch direkt hinter "vor X Tagen").
            let newEl = document.getElementById('all-time-bestpreis-discount');
            if (!newEl) {
                newEl = document.createElement('span');
                newEl.id = 'all-time-bestpreis-discount';
                newEl.innerHTML = `<br />&nbsp;<span class="contentcolor" style="color: #b00;">|</span> <a class="bm-price-history-link" href="#bm-price-chart-overlay" aria-controls="bm-price-chart-overlay">Differenz zum ATB: <strong></strong></a>`;
            }
            const value = newEl.querySelector('strong');
            if (value) {
                if (value.textContent !== percentStr) value.textContent = percentStr;
                if (value.style.color !== color) value.style.color = color;
            }

            updateSidebarHistoricalBestPriceDetail(matchedElement, detailSuffix);
            if (newEl.previousSibling !== matchedElement) {
                matchedElement.parentNode.insertBefore(newEl, matchedElement.nextSibling);
            }
            decoratePriceHistoryLinks();
    }

    // ==========================================
    // 6. VERSANDKOSTEN + SORTIERUNG
    // ==========================================
    function removeOfferListPriceDecorations() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        offerlist.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid]'
        ).forEach(priceRow => {
            priceRow.style.removeProperty('background-image');
            priceRow.style.removeProperty('background-size');
            priceRow.closest('.row.collapse')?.querySelectorAll('.lowest')
                .forEach(element => element.classList.remove('lowest'));
        });

        offerlist.querySelectorAll('.price > span[style]').forEach(span => {
            const isAbsoluteBadge = span.style.position === 'absolute';
            const isPercentage = /^\s*\d+(?:[.,]\d+)?\s*%\s*$/.test(span.textContent);
            if (isAbsoluteBadge && isPercentage) span.remove();
        });
    }

    function injectMarketplaceOffers(offers) {
        const offerlist = document.getElementById('offerlist');
        const firstPriceRow = offerlist?.querySelector(
            '.medium-4.small-9.columns.pricerow:not([data-bm-marketplace="true"])'
        );
        const parent = firstPriceRow?.closest('.row.collapse')?.parentElement;
        if (!offerlist || !parent) {
            if (offerlist && !offerlist.dataset.bmMarketplaceRetryScheduled) {
                offerlist.dataset.bmMarketplaceRetryScheduled = 'true';
                window.setTimeout(() => {
                    delete offerlist.dataset.bmMarketplaceRetryScheduled;
                    injectMarketplaceOffers(offers);
                }, 250);
            }
            return;
        }

        parent.querySelectorAll('.bm-marketplace-offer').forEach(row => row.remove());

        offers.forEach(offer => {
            const price = parseEuroValue(offer.priceText);
            const hasUnknownPrice = price === null && offer.allowUnknownPrice === true;
            if ((!hasUnknownPrice && price === null) || !offer.url) return;
            // Die Zeilen werden bei jedem synchronisierten Abruf neu aufgebaut;
            // daher soll auch jeder Einbau sichtbar animiert werden.
            const animateEntry = true;

            const mid = `market-${offer.key}`;
            const wrapper = document.createElement('div');
            wrapper.className = 'row collapse bm-marketplace-offer';
            if (animateEntry) wrapper.classList.add('bm-offer-entering');
            wrapper.dataset.bmSource = offer.source || 'marketplace';
            wrapper.dataset.bmMarketplace = 'true';
            wrapper.dataset.bmShortcutId = `btn-${offer.key}`;

            const iconColumn = document.createElement('div');
            iconColumn.className = 'goto medium-1 small-3 columns bm-marketplace-logo-column';
            const iconRow = document.createElement('div');
            iconRow.id = `mid${mid}`;
            iconRow.className = `pricerow ${mid} row-a text-center bm-marketplace-logo-cell`;
            iconRow.dataset.mid = mid;
            const iconLink = document.createElement('a');
            iconLink.href = offer.searchUrl || offer.url;
            iconLink.target = '_blank';
            iconLink.rel = 'noopener noreferrer';
            iconLink.title = offer.searchUrl
                ? `Suchabfrage für dieses Set bei ${offer.label} öffnen`
                : `${offer.label} öffnen`;
            iconLink.setAttribute('aria-label', iconLink.title);
            if (offer.searchUrl) {
                iconLink.dataset.bmKeepTooltip = 'true';
            }
            if (offer.logoUrl || offer.logoText) {
                iconLink.classList.add('bm-marketplace-logo-link');
            }
            if (offer.key === 'ebay') {
                iconLink.classList.add('bm-ebay-logo-link', 'bm-ebay-de-source');
            } else if (offer.key === 'ebay-fr') {
                iconLink.classList.add('bm-ebay-logo-link', 'bm-ebay-fr-source');
            }
            if (offer.key === 'ebay' || offer.key === 'ebay-fr') {
                const sellerAccountType = normalizeEbaySellerAccountType(
                    offer.sellerAccountType
                );
                iconLink.classList.add(sellerAccountType === 'BUSINESS'
                    ? 'bm-ebay-commercial'
                    : sellerAccountType === 'INDIVIDUAL'
                        ? 'bm-ebay-private'
                        : 'bm-ebay-standard');
            }
            if (offer.logoText) {
                const wordLogo = document.createElement('span');
                wordLogo.className = `bm-marketplace-logo ${offer.key === 'leboncoin'
                    ? 'bm-leboncoin-word-logo'
                    : 'bm-vinted-word-logo'}`;
                wordLogo.textContent = offer.logoText;
                wordLogo.style.setProperty('color', '#222', 'important');
                wordLogo.style.setProperty('font-size', '1rem', 'important');
                wordLogo.style.setProperty('font-weight', '700', 'important');
                wordLogo.style.setProperty('line-height', '20px', 'important');
                iconLink.appendChild(wordLogo);
                if (offer.logoCaption) {
                    iconLink.classList.add('bm-has-caption');
                    const caption = document.createElement('span');
                    caption.className = 'bm-marketplace-logo-caption';
                    caption.textContent = offer.logoCaption;
                    iconLink.appendChild(caption);
                }
            } else if (offer.logoUrl) {
                const image = document.createElement('img');
                image.src = offer.logoUrl;
                image.alt = offer.label;
                image.className = 'bm-marketplace-logo';
                if (offer.logoClass) image.classList.add(offer.logoClass);
                if (offer.key === 'bo') image.classList.add('bm-brickowl-logo');
                if (offer.key === 'vinted') image.classList.add('bm-vinted-word-logo');
                if (offer.key === 'leboncoin') image.classList.add('bm-leboncoin-word-logo');
                if (offer.key === 'kleinanzeigen') {
                    image.classList.add('bm-kleinanzeigen-logo');
                }
                image.loading = 'lazy';
                image.decoding = 'async';
                image.referrerPolicy = 'no-referrer';
                if (offer.logoFallbackUrl) {
                    image.addEventListener('error', () => {
                        if (image.src !== offer.logoFallbackUrl) {
                            image.src = offer.logoFallbackUrl;
                        }
                    }, { once: true });
                }
                iconLink.appendChild(image);
                if (offer.logoCaption) {
                    iconLink.classList.add('bm-has-caption');
                    const caption = document.createElement('span');
                    caption.className = 'bm-marketplace-logo-caption';
                    caption.textContent = offer.logoCaption;
                    caption.title = offer.logoCaption;
                    iconLink.appendChild(caption);
                }
            } else {
                iconLink.textContent = offer.label.slice(0, 1);
            }
            if (offer.logoBadge) {
                const badge = document.createElement('span');
                badge.className = 'bm-marketplace-country-badge';
                badge.textContent = offer.logoBadge;
                badge.title = offer.logoBadgeLabel || offer.label;
                badge.setAttribute('aria-label', badge.title);
                iconLink.appendChild(badge);
            }
            normalizeMarketplaceLogoLink(iconLink);
            if (offer.logoCountryFlag) {
                const stage = iconLink.querySelector('.bm-marketplace-logo-stage');
                if (stage && !stage.querySelector('.bm-marketplace-country-flag')) {
                    const flag = document.createElement('span');
                    flag.className = 'bm-marketplace-country-flag';
                    flag.textContent = offer.logoCountryFlag;
                    flag.title = offer.logoCountryLabel || offer.label;
                    flag.setAttribute('aria-label', flag.title);
                    stage.appendChild(flag);
                }
            }
            if (offer.logoDomainSuffix) {
                const stage = iconLink.querySelector('.bm-marketplace-logo-stage');
                if (stage && !stage.querySelector('.bm-ebay-domain-suffix')) {
                    const suffix = document.createElement('span');
                    suffix.className = 'bm-ebay-domain-suffix';
                    suffix.textContent = offer.logoDomainSuffix;
                    suffix.setAttribute('aria-hidden', 'true');
                    stage.appendChild(suffix);
                }
            }
            iconRow.appendChild(iconLink);
            iconColumn.appendChild(iconRow);

            const priceRow = document.createElement('div');
            priceRow.className = `medium-4 small-9 columns pricerow ${mid} row-a`;
            priceRow.dataset.mid = mid;
            priceRow.dataset.bmSource = offer.source || 'marketplace';
            priceRow.dataset.bmMarketplace = 'true';
            priceRow.dataset.bmShortcutId = `btn-${offer.key}`;
            if (offer.shippingStatus === 'paid' &&
                Number.isFinite(Number(offer.shippingCost))) {
                priceRow.dataset.bmShippingCost = String(Number(offer.shippingCost));
            } else if (offer.shippingStatus === 'free') {
                priceRow.dataset.bmShippingFree = 'true';
            } else {
                priceRow.dataset.bmShippingUnknown = 'true';
            }
            if (hasUnknownPrice) priceRow.dataset.bmPriceUnknown = 'true';
            if (offer.priceSource) {
                priceRow.dataset.bmPriceSource = offer.priceSource;
            }

            const offerLink = document.createElement('a');
            offerLink.href = offer.url;
            offerLink.target = '_blank';
            offerLink.rel = 'noopener noreferrer';
            offerLink.className = 'tooltipster';
            const shippingTitle = offer.shippingStatus === 'paid' &&
                Number.isFinite(Number(offer.shippingCost))
                ? `Versandkosten: ${formatEuroValue(Number(offer.shippingCost))} €.`
                : offer.shippingStatus === 'free'
                    ? 'Versandkostenfrei.'
                    : 'Versandkosten unbekannt.';
            offerLink.title = hasUnknownPrice
                ? `Link zu ${offer.label}. Preis unbekannt.`
                : (
                    `Link zu ${offer.label} - ` +
                    `${offer.priceSource ? `${offer.priceSource}. ` : ''}` +
                    `Preis: ${formatEuroValue(price)} €. ` +
                    shippingTitle
                );

            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            const merchant = document.createElement('span');
            merchant.className = 'show-for-small-only merchant';
            merchant.append(`${offer.label}`);
            merchant.appendChild(document.createElement('br'));
            priceSpan.appendChild(merchant);
            priceSpan.append(
                hasUnknownPrice ? 'Preis unbekannt' : `${formatEuroValue(price)} €`
            );
            offerLink.appendChild(priceSpan);
            priceRow.appendChild(offerLink);
            wrapper.appendChild(iconColumn);
            wrapper.appendChild(priceRow);
            parent.appendChild(wrapper);
            if (animateEntry) {
                window.setTimeout(
                    () => wrapper.classList.remove('bm-offer-entering'),
                    280
                );
            }
        });

        mergeSoldOutOffersIntoOfferList();
        window.setTimeout(applyOfferPresentation, 0);
    }

    // Fehlt bei Brickmerge eine Versandangabe, gilt das Angebot als versandkostenfrei.
    // Die zusätzlich abgefragten Marktplatzpreise sind die einzige Ausnahme.
    function parseEuroValue(text) {
        if (!text) return null;
        const match = text.match(/(\d+[\d\s.,]*)\s*€/);
        if (!match) return null;
        const value = parseFloat(match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(value) ? value : null;
    }

    function formatEuroValue(value) {
        return value.toLocaleString('de-DE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getBaseOfferPrice(priceSpan) {
        const originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
        if (originalPrice) {
            const value = parseEuroValue(originalPrice.textContent);
            if (value !== null) {
                priceSpan.dataset.bmBasePrice = String(value);
                return value;
            }
        }

        const storedPrice = Number(priceSpan.dataset.bmBasePrice);
        if (Number.isFinite(storedPrice) && storedPrice > 0) return storedPrice;

        const clone = priceSpan.cloneNode(true);
        clone.querySelectorAll('span').forEach(span => span.remove());
        const value = parseEuroValue(clone.textContent);
        if (value !== null) priceSpan.dataset.bmBasePrice = String(value);
        return value;
    }

    function ensureOriginalPriceElement(priceSpan) {
        let originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
        if (originalPrice) return originalPrice;

        const basePrice = getBaseOfferPrice(priceSpan);
        if (basePrice === null) return null;

        const priceTextNode = Array.from(priceSpan.childNodes).find(node => {
            return node.nodeType === 3 && parseEuroValue(node.textContent) !== null;
        });
        if (!priceTextNode) return null;

        originalPrice = document.createElement('span');
        originalPrice.className = 'bm-original-price';
        originalPrice.textContent = `${formatEuroValue(basePrice)} €`;
        priceTextNode.replaceWith(originalPrice);
        return originalPrice;
    }

    function placeNodeAfter(referenceNode, node) {
        if (referenceNode.nextSibling !== node) referenceNode.after(node);
    }

    function getNativeShippingSpan(priceSpan) {
        return Array.from(priceSpan.querySelectorAll(':scope > span.small'))
            .find(span => {
                if (span.classList.contains('merchant') ||
                    span.classList.contains('code') ||
                    span.classList.contains('show-for-small-only') ||
                    span.classList.contains('bm-effective-info')) return false;
                return /VK|Versand|^\+\s*[\d.,]+\s*€\s*=/i.test(span.textContent.trim());
            }) || null;
    }

    function readShippingDetails(priceSpan) {
        const explicitShippingRow = priceSpan.closest(
            '[data-bm-shipping-cost], [data-bm-shipping-free], [data-bm-shipping-unknown]'
        );
        if (explicitShippingRow?.dataset.bmShippingCost) {
            const cost = Number(explicitShippingRow.dataset.bmShippingCost);
            if (Number.isFinite(cost) && cost >= 0) {
                return cost <= 0.004
                    ? { status: 'free', cost: 0 }
                    : { status: 'paid', cost };
            }
        }
        if (explicitShippingRow?.dataset.bmShippingFree === 'true') {
            return { status: 'free', cost: 0 };
        }
        if (explicitShippingRow?.dataset.bmShippingUnknown === 'true') {
            return { status: 'unknown', cost: null };
        }

        // Alza berechnet fuer diese Angebote pauschal 0,98 Euro Versand. Die
        // Haendlerregel steht vor den von Brickmerge gelieferten Angaben, damit
        // ein dort noch hinterlegter alter Versandwert sicher ersetzt wird.
        const merchantName = getOfferMerchantName(priceSpan);
        if (/\balza(?:\.de)?\b/i.test(merchantName)) {
            return { status: 'paid', cost: 0.98 };
        }

        const title = getOriginalOfferTitle(priceSpan.closest('a'));
        const titleCostMatch = title.match(
            /\+\s*(?:Versand(?:skosten)?)\s*(\d+[\d\s.,]*)\s*€/i
        );
        if (titleCostMatch) {
            const cost = parseEuroValue(`${titleCostMatch[1]} €`);
            if (cost !== null) return { status: 'paid', cost };
        }
        if (/Versandkostenfrei|kostenloser Versand|VK frei/i.test(title)) {
            return { status: 'free', cost: 0 };
        }

        const nativeShipping = getNativeShippingSpan(priceSpan);
        if (nativeShipping) {
            const nativeText = nativeShipping.textContent.trim();
            if (/VK frei|Versandkostenfrei|kostenloser Versand/i.test(nativeText)) {
                return { status: 'free', cost: 0 };
            }
            const nativeCost = parseEuroValue(nativeText);
            if (nativeCost !== null) return { status: 'paid', cost: nativeCost };
        }

        if (/\bsmyths\b/i.test(merchantName)) {
            const offerPrice = getBaseOfferPrice(priceSpan);
            if (offerPrice !== null) {
                return offerPrice >= 20
                    ? { status: 'free', cost: 0 }
                    : { status: 'paid', cost: 3.95 };
            }
            return { status: 'unknown', cost: null };
        }

        return { status: 'free', cost: 0 };
    }

    function injectShippingCostsFromOfferTitles() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const basePrice = getBaseOfferPrice(priceSpan);
            if (basePrice === null) return;

            const shipping = readShippingDetails(priceSpan);
            const shippingStatus = shipping.status === 'paid'
                ? 'paid'
                : shipping.status === 'unknown'
                    ? 'unknown'
                    : 'free';
            let small = priceSpan.querySelector(':scope > .bm-shipping-info') ||
                getNativeShippingSpan(priceSpan);
            if (!small) {
                small = document.createElement('span');
                priceSpan.appendChild(small);
            }

            small.className = 'small bm-shipping-info';
            small.classList.add(`bm-shipping-${shippingStatus}`);
            small.dataset.shippingStatus = shippingStatus;
            const setShippingText = text => {
                if (small.textContent !== text) small.textContent = text;
            };

            if (shippingStatus === 'paid') {
                small.dataset.shippingCost = String(shipping.cost);
                setShippingText(`VK ${formatEuroValue(shipping.cost)} €`);
                small.title = `Versandkosten: ${formatEuroValue(shipping.cost)} €; Gesamtpreis: ${formatEuroValue(basePrice + shipping.cost)} €`;
            } else if (shippingStatus === 'free') {
                small.dataset.shippingCost = '0';
                setShippingText('VK frei');
                small.title = `Versandkostenfrei; Gesamtpreis: ${formatEuroValue(basePrice)} €`;
            } else {
                delete small.dataset.shippingCost;
                setShippingText('VK unbekannt');
                small.title = 'Versandkosten und Gesamtpreis unbekannt';
            }
        });
    }

    function getOfferMerchantName(priceSpan) {
        const merchantSpan = priceSpan.querySelector('.merchant');
        const merchantText = merchantSpan?.textContent?.trim();
        if (merchantText) return merchantText;

        const row = priceSpan.closest('[data-mid]');
        const mid = row?.getAttribute('data-mid');
        const icon = mid ? document.querySelector(`#mid${mid} img[alt]`) : null;
        if (icon?.alt) return icon.alt.trim();

        const title = getOriginalOfferTitle(priceSpan.closest('a'));
        return title.match(/Link zu (.+?)(?:\s+-\s+|$)/i)?.[1]?.trim() || '';
    }

    function formatPercentValue(value, maximumFractionDigits = 1, minimumFractionDigits = 1) {
        return value.toLocaleString('de-DE', {
            minimumFractionDigits,
            maximumFractionDigits
        });
    }

    function updateOfferTooltips() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        const priceReference = getDiscountPriceReference();

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const offerLink = priceSpan.closest('a');
            const priceRow = priceSpan.closest('.pricerow');
            const offerPrice = getBaseOfferPrice(priceSpan);
            const shippingSpan = priceSpan.querySelector(':scope > .bm-shipping-info');
            if (!offerLink || !priceRow || offerPrice === null || !shippingSpan) return;

            const originalTooltip = getOriginalOfferTitle(offerLink);
            const merchantName = getOfferMerchantName(priceSpan);
            const shippingStatus = shippingSpan.dataset.shippingStatus === 'paid'
                ? 'paid'
                : shippingSpan.dataset.shippingStatus === 'unknown'
                    ? 'unknown'
                    : 'free';
            const shippingCost = shippingStatus === 'paid'
                ? Number(shippingSpan.dataset.shippingCost || 0)
                : shippingStatus === 'free'
                    ? 0
                    : null;
            const totalPrice = shippingCost === null ? null : offerPrice + shippingCost;
            const retailerRate = Number(priceRow.dataset.bmRetailerRate || 0);
            const effectivePrice = Math.round(
                (offerPrice * (1 - retailerRate) + Number.EPSILON) * 100
            ) / 100;
            const parts = [];

            if (merchantName) parts.push(`Händler: ${merchantName}.`);
            if (priceRow.dataset.bmPriceSource) {
                parts.push(`${priceRow.dataset.bmPriceSource}.`);
            }
            parts.push(`Angebotspreis: ${formatEuroValue(offerPrice)} €.`);

            if (shippingStatus === 'paid') {
                parts.push(`Versandkosten: ${formatEuroValue(shippingCost)} €.`);
            } else if (shippingStatus === 'free') {
                parts.push('Versandkosten: frei.');
            } else {
                parts.push('Versandkosten: unbekannt.');
            }

            if (totalPrice === null) {
                parts.push('Gesamtpreis: wegen unbekannter Versandkosten nicht berechenbar.');
            } else {
                parts.push(`Gesamtpreis: ${formatEuroValue(totalPrice)} €.`);
            }

            if (retailerRate > 0) {
                parts.push(`Gutscheinrabatt: ${formatPercentValue(retailerRate * 100, 2, 0)}%.`);
                let effectiveText = `Effektiv: ${formatEuroValue(effectivePrice)} €`;
                if (priceReference) {
                    const effectiveDiscount = Math.max(
                        0,
                        (1 - (effectivePrice / priceReference.value)) * 100
                    );
                    effectiveText +=
                        ` (${formatPercentValue(effectiveDiscount)}% ${priceReference.relation})`;
                }
                parts.push(`${effectiveText}.`);
                if (shippingCost === null) {
                    parts.push('Effektiver Gesamtpreis: wegen unbekannter Versandkosten nicht berechenbar.');
                } else {
                    parts.push(`Effektiver Gesamtpreis: ${formatEuroValue(effectivePrice + shippingCost)} €.`);
                }
            } else if (priceReference) {
                const referenceDiscount = Math.max(
                    0,
                    (1 - (offerPrice / priceReference.value)) * 100
                );
                parts.push(
                    `Rabatt ${priceReference.relation}: ` +
                    `${formatPercentValue(referenceDiscount)}%.`
                );
            }

            const timestamp = originalTooltip.match(/Preisangabe vom\s+(.+?):\s*[\d.,]+\s*€/i)?.[1];
            if (timestamp) parts.push(`Stand: ${timestamp}.`);

            const tooltip = parts.join(' ');
            if (offerLink.dataset.bmTooltip !== tooltip) {
                offerLink.dataset.bmTooltip = tooltip;
                offerLink.setAttribute('title', tooltip);
                offerLink.dispatchEvent(new CustomEvent(
                    'bm-tooltip-updated',
                    { bubbles: true }
                ));
            }
        });
    }

    function syncEffectivePriceLabels() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        offerlist.querySelectorAll('.bm-best-price-label').forEach(label => label.remove());
        offerlist.querySelectorAll('.bm-effective-row').forEach(row => {
            row.classList.remove('bm-effective-row');
        });
        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const priceRow = priceSpan.closest('.pricerow');
            const retailerRate = Number(priceRow?.dataset.bmRetailerRate || 0);
            let info = priceSpan.querySelector(':scope > .bm-effective-info');
            const originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
            const shipping = priceSpan.querySelector(':scope > .bm-shipping-info');
            const merchant = priceSpan.querySelector(':scope > .merchant');

            if (!priceRow || retailerRate <= 0) {
                info?.remove();
                if (originalPrice) {
                    originalPrice.classList.remove('bm-original-secondary');
                    originalPrice.removeAttribute('title');
                    originalPrice.removeAttribute('aria-label');
                    if (merchant) {
                        placeNodeAfter(merchant, originalPrice);
                    } else if (priceSpan.firstChild !== originalPrice) {
                        priceSpan.prepend(originalPrice);
                    }
                    if (shipping) placeNodeAfter(originalPrice, shipping);
                }
                return;
            }

            const offerPrice = getBaseOfferPrice(priceSpan);
            if (offerPrice === null) {
                info?.remove();
                return;
            }

            const effectivePrice = Math.round(
                (offerPrice * (1 - retailerRate) + Number.EPSILON) * 100
            ) / 100;
            const label = `(effektiv ${formatEuroValue(effectivePrice)} €)`;

            if (!info) {
                info = document.createElement('span');
                info.className = 'bm-effective-info';
            }
            const stableOriginalPrice = originalPrice || ensureOriginalPriceElement(priceSpan);
            if (!stableOriginalPrice) {
                info.remove();
                return;
            }

            stableOriginalPrice.classList.remove('bm-original-secondary');
            stableOriginalPrice.title = `Angebotspreis: ${formatEuroValue(offerPrice)} €`;
            stableOriginalPrice.setAttribute(
                'aria-label',
                `Angebotspreis ${formatEuroValue(offerPrice)} Euro`
            );

            if (merchant) {
                placeNodeAfter(merchant, stableOriginalPrice);
            } else if (priceSpan.firstChild !== stableOriginalPrice) {
                priceSpan.prepend(stableOriginalPrice);
            }
            placeNodeAfter(stableOriginalPrice, info);
            if (shipping) {
                placeNodeAfter(info, shipping);
            }

            priceRow.closest('.row.collapse')?.classList.add('bm-effective-row');
            if (info.textContent !== label) info.textContent = label;
            info.title = `Persönlicher Rabatt: ${formatPercentValue(retailerRate * 100, 2, 0)}%`;
        });
    }

    function syncOfferDiscountBubbles() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        const priceReference = getDiscountPriceReference();
        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const priceRow = priceSpan.closest('.pricerow');
            const basePrice = getBaseOfferPrice(priceSpan);
            const retailerRate = Number(priceRow?.dataset.bmRetailerRate || 0);
            const comparedPrice = basePrice === null
                ? null
                : Math.round(
                    (basePrice * (1 - retailerRate) + Number.EPSILON) * 100
                ) / 100;
            const shippingSpan = priceSpan.querySelector(
                ':scope > .bm-shipping-info'
            );
            const shippingStatus = shippingSpan?.dataset.shippingStatus;
            const shippingCost =
                shippingStatus === 'paid'
                    ? Number(shippingSpan.dataset.shippingCost || 0)
                    : null;
            let discountPercent = null;
            let totalDiscountPercent = null;

            if (comparedPrice !== null && priceReference) {
                discountPercent =
                    (1 - (comparedPrice / priceReference.value)) * 100;
                if (shippingCost !== null && Number.isFinite(shippingCost)) {
                    totalDiscountPercent =
                        (1 - (
                            (comparedPrice + shippingCost) /
                            priceReference.value
                        )) * 100;
                }
            } else {
                const title = getOriginalOfferTitle(priceSpan.closest('a'));
                const originalDiscount = title.match(
                    /(\d+(?:[.,]\d+)?)%\)\s*gespart/i
                );
                if (originalDiscount) {
                    const baseDiscount = Number(
                        originalDiscount[1].replace(',', '.')
                    ) / 100;
                    discountPercent = retailerRate > 0
                        ? (1 - ((1 - baseDiscount) * (1 - retailerRate))) * 100
                        : baseDiscount * 100;
                }
            }

            let bubble = priceSpan.querySelector(':scope > .bm-offer-discount-bubble');
            priceSpan.querySelectorAll(':scope > .bm-offer-discount-bubble')
                .forEach((candidate, index) => {
                    if (index > 0) candidate.remove();
                });

            if (!bubble) {
                bubble = document.createElement('span');
                bubble.className = 'bm-offer-discount-bubble';
                priceSpan.appendChild(bubble);
            }
            if (discountPercent === null || discountPercent <= 0) {
                bubble.style.display = 'none';
            } else {
                bubble.style.removeProperty('display');
                const label = `${Math.round(discountPercent)}%`;
                if (bubble.textContent !== label) bubble.textContent = label;
                bubble.title =
                    `Rabatt ${priceReference?.relation || 'zum Referenzpreis'}: ` +
                    `${formatPercentValue(discountPercent)}%`;
                bubble.setAttribute(
                    'aria-label',
                    `Rabatt ${priceReference?.relation || 'zum Referenzpreis'} ` +
                    `${formatPercentValue(discountPercent)} Prozent`
                );
            }

            let totalBubble = priceSpan.querySelector(
                ':scope > .bm-total-discount-bubble'
            );
            priceSpan.querySelectorAll(':scope > .bm-total-discount-bubble')
                .forEach((candidate, index) => {
                    if (index > 0) candidate.remove();
                });

            if (!totalBubble) {
                totalBubble = document.createElement('span');
                totalBubble.className = 'bm-total-discount-bubble';
                priceSpan.appendChild(totalBubble);
            }
            if (totalDiscountPercent === null || totalDiscountPercent <= 0) {
                totalBubble.style.display = 'none';
                return;
            }
            totalBubble.style.removeProperty('display');
            const totalLabel = `${Math.round(totalDiscountPercent)}%`;
            if (totalBubble.textContent !== totalLabel) {
                totalBubble.textContent = totalLabel;
            }
            totalBubble.title =
                `Rabatt ${priceReference?.relation || 'zum Referenzpreis'} inklusive Versand: ` +
                `${formatPercentValue(totalDiscountPercent)}%`;
            totalBubble.setAttribute(
                'aria-label',
                `Rabatt ${priceReference?.relation || 'zum Referenzpreis'} inklusive Versand ` +
                `${formatPercentValue(totalDiscountPercent)} Prozent`
            );
        });
    }

    function sortOffersByConfiguredPrice() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        const personalSettings = loadPersonalDiscountSettings();
        const sortMode = personalSettings.enabled ? 'effective' : 'offer';

        const offers = Array.from(
            offerlist.querySelectorAll('.medium-4.small-9.columns.pricerow[data-mid]')
        ).filter(priceRow => !priceRow.closest('#soldOut')).map((priceRow, originalIndex) => {
            const priceSpan = priceRow.querySelector('span.price');
            const basePrice = priceSpan ? getBaseOfferPrice(priceSpan) : null;
            const retailerRate = Number(priceRow.dataset.bmRetailerRate || 0);
            const effectivePrice = basePrice === null
                ? null
                : Math.round((basePrice * (1 - retailerRate) + Number.EPSILON) * 100) / 100;
            return {
                wrapper: priceRow.closest('.row.collapse'),
                priceRow,
                priceSpan,
                price: sortMode === 'effective' ? effectivePrice : basePrice,
                originalIndex
            };
        }).filter(offer => offer.wrapper && offer.wrapper.parentElement);

        const groups = new Map();
        offers.forEach(offer => {
            const parent = offer.wrapper.parentElement;
            if (!groups.has(parent)) groups.set(parent, []);
            groups.get(parent).push(offer);
        });

        groups.forEach((group, parent) => {
            const originalOrder = group.map(offer => offer.wrapper);
            originalOrder.forEach(wrapper => {
                wrapper.getAnimations?.()
                    .filter(animation => animation.id === 'bm-offer-reorder')
                    .forEach(animation => animation.cancel());
                wrapper.classList.remove('bm-offer-reordering');
            });
            const originalPositions = new Map(
                originalOrder.map(wrapper => [
                    wrapper,
                    wrapper.getBoundingClientRect()
                ])
            );
            const insertionAnchor = originalOrder[originalOrder.length - 1]?.nextSibling || null;
            group.sort((a, b) => {
                if (a.price === null && b.price === null) return a.originalIndex - b.originalIndex;
                if (a.price === null) return 1;
                if (b.price === null) return -1;
                return (a.price - b.price) || (a.originalIndex - b.originalIndex);
            });

            group.forEach((offer, index) => {
                const stripeClass = index % 2 === 0 ? 'row-b' : 'row-a';
                const otherStripeClass = stripeClass === 'row-a' ? 'row-b' : 'row-a';
                offer.wrapper.querySelectorAll('.row-a, .row-b').forEach(element => {
                    if (
                        element.classList.contains(stripeClass) &&
                        !element.classList.contains(otherStripeClass)
                    ) {
                        return;
                    }
                    element.classList.remove(otherStripeClass);
                    element.classList.add(stripeClass);
                });

                offer.wrapper.querySelectorAll('.lowest').forEach(element => element.classList.remove('lowest'));
            });

            const orderChanged = group.some(
                (offer, index) => offer.wrapper !== originalOrder[index]
            );
            if (orderChanged) {
                const fragment = document.createDocumentFragment();
                group.forEach(offer => fragment.appendChild(offer.wrapper));
                parent.insertBefore(fragment, insertionAnchor);

                if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    group.forEach(offer => {
                        const before = originalPositions.get(offer.wrapper);
                        const after = offer.wrapper.getBoundingClientRect();
                        const deltaX = before ? before.left - after.left : 0;
                        const deltaY = before ? before.top - after.top : 0;
                        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

                        offer.wrapper.classList.add('bm-offer-reordering');
                        const animation = offer.wrapper.animate?.([
                            { transform: `translate(${deltaX}px, ${deltaY}px)` },
                            { transform: 'translate(0, 0)' }
                        ], {
                            duration: 380,
                            easing: 'cubic-bezier(.22, .8, .25, 1)'
                        });
                        if (!animation) {
                            offer.wrapper.classList.remove('bm-offer-reordering');
                            return;
                        }
                        animation.id = 'bm-offer-reorder';
                        animation.finished.catch(() => {}).finally(() => {
                            offer.wrapper.classList.remove('bm-offer-reordering');
                        });
                    });
                }
            }
        });
    }

    let offerPresentationRunning = false;
    let offerPresentationObserver = null;
    const observeOfferPresentationMutations = () => {
        const target = document.getElementById('offerlist');
        if (!offerPresentationObserver || !target) return;
        offerPresentationObserver.observe(target, {
            childList: true,
            subtree: true,
            characterData: true
        });
    };
    const ensureOfferPresentationObserver = () => {
        const target = document.getElementById('offerlist');
        if (!target) return false;
        if (!offerPresentationObserver) {
            offerPresentationObserver = new MutationObserver(() => {
                if (!offerPresentationRunning) scheduleOfferPresentation();
            });
        }
        offerPresentationObserver.disconnect();
        observeOfferPresentationMutations();
        return true;
    };
    function applyOfferPresentation() {
        if (offerPresentationRunning) return;
        offerPresentationRunning = true;
        // Die folgenden Schritte verändern die Offerlist selbst. Während ihrer
        // synchronen Ausführung muss der Observer diese eigenen Änderungen nicht
        // erneut als neue Brickmerge-Daten verarbeiten.
        offerPresentationObserver?.disconnect();
        try {
            runOfferPresentationSteps();
        } finally {
            offerPresentationRunning = false;
            observeOfferPresentationMutations();
        }
    }

    let offerPresentationTimer;
    const scheduleOfferPresentation = () => {
        clearTimeout(offerPresentationTimer);
        offerPresentationTimer = setTimeout(applyOfferPresentation, 80);
    };

    const offerlistIsReady = ensureOfferPresentationObserver();
    if (!offerlistIsReady) {
        const pendingOfferlistObserver = new MutationObserver(() => {
            if (!ensureOfferPresentationObserver()) return;
            pendingOfferlistObserver.disconnect();
            applyOfferPresentation();
        });
        pendingOfferlistObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        window.setTimeout(() => pendingOfferlistObserver.disconnect(), 10000);
    } else {
        applyOfferPresentation();
    }

    if (document.readyState !== 'complete') {
        window.addEventListener('load', scheduleOfferPresentation, { once: true });
    }

})();}).catch(error => {
    document.documentElement.classList.remove('bm-extension-preclean');
    console.error('Brickmerge Tools konnte nicht gestartet werden.', error);
});


(() => {
    'use strict';

    const STYLE_ID = 'bm-depot-quick-add-style';
    const SALE_SETTINGS_KEY = 'brickmerge-depot-sale-thresholds-v1';
    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .bmd-open-button {
                display:inline-flex!important;align-items:center!important;
                justify-content:center!important;gap:.5rem;width:auto;
                min-width:0;margin:0 0 .35rem!important;
                font-family:inherit!important;line-height:1.2!important;
                white-space:nowrap;box-sizing:border-box;cursor:pointer
            }
            .bmd-open-button:hover,.bmd-open-button:focus {
                outline:none
            }
            .bmd-open-button .bmd-button-content {
                display:inline-flex!important;align-items:center;gap:.35rem
            }
            .bmd-open-button .bmd-button-icon {
                display:inline-flex;align-items:center;justify-content:center;
                width:1.2rem;height:1.2rem;flex:0 0 1.2rem;
                line-height:1
            }
            .bmd-open-button .bmd-button-icon svg {
                display:block;width:1.15rem;height:1.15rem;fill:none;
                stroke:currentColor;stroke-width:1.8;stroke-linecap:round;
                stroke-linejoin:round
            }
            .bmd-button-label-mobile { display:none }
            .bm-chart-controls .bmd-open-button {
                flex:0 0 auto
            }
            .bm-chart-controls.bmd-has-depot-button {
                display:grid!important;
                grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
                align-items:stretch!important;column-gap:.4rem!important;
                width:100%;box-sizing:border-box
            }
            .bm-chart-controls.bmd-has-depot-button.bm-has-price-refresh {
                grid-template-columns:repeat(3,minmax(0,1fr))!important
            }
            .bm-chart-controls.bmd-has-depot-button > #chartTrigger,
            .bm-chart-controls.bmd-has-depot-button > .bmd-open-button,
            .bm-chart-controls.bmd-has-depot-button > .bm-detail-all-prices-refresh {
                width:100%!important;min-width:0!important;max-width:none!important;
                margin-right:0!important;margin-left:0!important;
                box-sizing:border-box
            }
            .bm-chart-controls.bmd-has-depot-button > .bm-chart-best-price {
                grid-column:1/-1
            }
            body.bmd-overlay-open { overflow:hidden!important }
            .bmd-overlay {
                position:fixed;inset:0;z-index:2147483000;display:flex;
                align-items:center;justify-content:center;padding:1rem;
                background:rgba(0,0,0,.64);box-sizing:border-box;
                animation:bm-ean-fade-in .18s ease-out
            }
            .bmd-dialog {
                display:flex;width:min(40rem,100%);
                max-height:calc(100vh - 2rem);max-height:calc(100dvh - 2rem);
                flex-direction:column;overflow:hidden;border:0;
                border-top:5px solid #b00;border-radius:4px;background:#fff;
                color:#333;text-align:left;box-shadow:0 18px 48px rgba(0,0,0,.32);
                animation:bm-ean-zoom-in .18s ease-out
            }
            .bmd-dialog-header {
                display:flex;min-height:64px;flex:0 0 auto;align-items:center;
                justify-content:space-between;gap:.6rem;
                padding:.8rem .8rem .8rem 1.25rem;border-bottom:1px solid #ddd;
                background:#fff!important;box-shadow:none!important;
                box-sizing:border-box
            }
            .bmd-dialog-header h3 {
                min-width:0;margin:0!important;padding:0!important;
                overflow:visible;color:#333!important;
                -webkit-text-fill-color:#333!important;
                background:none!important;font-size:1.25rem!important;
                font-weight:700!important;line-height:1.2!important;
                text-shadow:none!important;white-space:normal
            }
            .bmd-close {
                display:inline-flex!important;width:40px;min-width:40px;height:40px;
                flex:0 0 40px;align-items:center;justify-content:center;
                margin:0!important;padding:0!important;border:0!important;
                border-radius:4px!important;background:#f7eaea!important;
                color:#800!important;font:bold 1.8rem/1 Arial,sans-serif!important;
                text-shadow:none!important;cursor:pointer
            }
            .bmd-close:hover,.bmd-close:focus {
                background:#b00!important;color:#fff!important;outline:none
            }
            .bmd-dialog-body {
                min-height:0;overflow:auto;padding:.85rem 1rem 1rem;
                background:#fff
            }
            .bmd-loading,.bmd-login,.bmd-status {
                display:block;margin:0;font-size:.8rem;line-height:1.4
            }
            .bmd-fields {
                display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
                gap:.55rem .75rem
            }
            .bmd-field { display:block;min-width:0;margin:0 }
            .bmd-field-wide { grid-column:1/-1 }
            .bmd-field>span {
                display:block;margin-bottom:.15rem;color:#777;font-size:.64rem;
                font-weight:400;line-height:1.25;text-transform:uppercase
            }
            .bmd-field input,.bmd-field select {
                display:block;width:100%;height:2.15rem;margin:0;
                padding:.3rem .45rem;border:1px solid #ccc;background:#fff;
                color:#333;font-size:.82rem;box-sizing:border-box
            }
            .bmd-field input[readonly] { background:#eee;font-weight:700 }
            .bmd-new-storage { margin-top:.35rem!important }
            .bmd-submit { width:100%;margin:.75rem 0 0!important }
            .bmd-status { min-height:1.1rem;padding-top:.45rem;color:#666 }
            .bmd-status-ok { color:#476600;font-weight:700 }
            .bmd-status-error { color:#b00;font-weight:700 }
            #dpWrap .bmd-growth {
                display:block;margin-top:.18rem;font-size:.68rem;font-weight:700;
                line-height:1.25;white-space:nowrap
            }
            #dpWrap .bmd-positive,.bmd-dashboard-dialog .bmd-positive { color:#2e7d32!important }
            #dpWrap .bmd-negative,.bmd-dashboard-dialog .bmd-negative { color:#b00020!important }
            #dpWrap .bmd-neutral,.bmd-dashboard-dialog .bmd-neutral { color:#666!important }
            #dpWrap .bmd-performance-percent,
            .bmd-dashboard-dialog .bmd-performance-percent { font-weight:800 }
            #dpWrap .bmd-growth-total { font-size:1rem;font-weight:700 }
            #dpWrap .bmd-parts-link {
                display:inline-block;margin-left:.15rem;padding:0 .2rem;
                color:#555;font-size:.68rem;font-weight:600;line-height:1.25;
                text-decoration:underline;white-space:nowrap
            }
            #dpWrap .bmd-parts-link:hover,#dpWrap .bmd-parts-link:focus {
                background:#600;color:#fff;text-decoration:none;outline:none
            }
            #dpWrap .bmd-sale-threshold {
                display:block;width:100%;margin:.18rem 0 0;padding:0;border:0;
                background:none!important;color:#555!important;font:600 .66rem/1.25 inherit;
                text-align:right;text-decoration:underline;cursor:pointer
            }
            #dpWrap .bmd-sale-threshold:hover,#dpWrap .bmd-sale-threshold:focus {
                color:#900!important;background:none!important;outline:none
            }
            #dpWrap .bmd-dashboard-button { margin:0!important }
            .bmd-dashboard-dialog { width:min(74rem,100%) }
            .bmd-dashboard-summary {
                display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;
                margin:0 0 .9rem
            }
            .bmd-dashboard-kpi {
                min-width:0;padding:.75rem .85rem;border-left:3px solid #b00;
                background:#f4f4f4
            }
            .bmd-dashboard-kpi span { display:block;color:#777;font-size:.68rem }
            .bmd-dashboard-kpi strong { display:block;margin-top:.15rem;color:#222;font-size:1.05rem }
            .bmd-dashboard-kpi small {
                display:block;margin-top:.18rem;color:#777;font-size:.65rem;line-height:1.25
            }
            .bmd-dashboard-kpi.bmd-kpi-positive { border-left-color:#2e7d32 }
            .bmd-dashboard-kpi.bmd-kpi-negative { border-left-color:#b00020 }
            .bmd-dashboard-kpi.bmd-kpi-neutral { border-left-color:#777 }
            .bmd-sale-settings {
                margin:0 0 .9rem;padding:.75rem .85rem;background:#fff8ee;
                border-left:3px solid #ff771a
            }
            .bmd-sale-settings h4,.bmd-dashboard-section h4 {
                margin:0 0 .55rem!important;color:#333!important;font-size:.95rem!important
            }
            .bmd-sale-settings-grid {
                display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;
                align-items:end;gap:.55rem
            }
            .bmd-sale-settings-grid .bmd-field input { background:#fff }
            .bmd-sale-formula { margin:.5rem 0 0;color:#666;font-size:.7rem;line-height:1.35 }
            .bmd-dashboard-tabs { display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 .6rem }
            .bmd-dashboard-tab {
                margin:0!important;padding:.48rem .7rem!important;border:1px solid #ccc!important;
                border-radius:2px!important;background:#eee!important;color:#444!important;
                font:.75rem/1.1 inherit!important;cursor:pointer
            }
            .bmd-dashboard-tab[aria-selected="true"] {
                border-color:#900!important;background:#900!important;color:#fff!important
            }
            .bmd-dashboard-table-wrap { overflow:auto;border:1px solid #ddd }
            .bmd-dashboard-table { width:100%;margin:0;border-collapse:collapse;font-size:.76rem }
            .bmd-dashboard-table th,.bmd-dashboard-table td {
                padding:.48rem .55rem;border-bottom:1px solid #e5e5e5;text-align:right;
                white-space:nowrap
            }
            .bmd-dashboard-table th { background:#eee;color:#555;font-size:.67rem;text-transform:uppercase }
            .bmd-dashboard-table th:first-child,.bmd-dashboard-table td:first-child {
                min-width:10rem;text-align:left;white-space:normal
            }
            .bmd-dashboard-table tbody tr:last-child td { border-bottom:0 }
            .bmd-dashboard-table tbody tr:hover td { background:#faf5f5 }
            .bmd-dashboard-setlink { color:#900;font-weight:700;text-decoration:none }
            .bmd-dashboard-setlink:hover,.bmd-dashboard-setlink:focus {
                text-decoration:underline;outline:none
            }
            .bmd-dashboard-bar {
                display:inline-block;height:.45rem;margin-left:.35rem;border-radius:1rem;
                background:#b00;vertical-align:middle
            }
            .bmd-dashboard-note { margin:.55rem 0 0;color:#777;font-size:.68rem }
            .bmd-dashboard-rankings {
                display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;
                margin-top:.9rem
            }
            .bmd-dashboard-ranking { min-width:0 }
            .bmd-dashboard-ranking h4 { margin-bottom:.4rem!important }
            .bmd-dashboard-ranking .bmd-dashboard-table th:first-child,
            .bmd-dashboard-ranking .bmd-dashboard-table td:first-child {
                min-width:7rem
            }
            .bmd-dashboard-coverage {
                display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;
                margin-top:.9rem
            }
            .bmd-dashboard-coverage-item { padding:.65rem .75rem;background:#f4f4f4 }
            .bmd-dashboard-coverage-item span { display:block;color:#777;font-size:.65rem }
            .bmd-dashboard-coverage-item strong { display:block;margin-top:.1rem;font-size:.9rem }
            .bmd-threshold-result {
                margin:.75rem 0 0;padding:.75rem;background:#f4f4f4;text-align:center
            }
            .bmd-threshold-result strong { display:block;color:#900;font-size:1.35rem }
            .bmd-threshold-actions { display:flex;gap:.5rem;margin-top:.7rem }
            .bmd-threshold-actions .button { flex:1;margin:0!important }
            @media screen and (max-width:640px) {
                .bmd-overlay { padding:0 }
                .bmd-dialog {
                    width:100vw;height:100vh;height:100dvh;
                    max-height:none;border-radius:0
                }
                .bmd-dialog-header {
                    min-height:64px;padding:max(11px,env(safe-area-inset-top))
                        max(10px,env(safe-area-inset-right)) 10px
                        max(15px,env(safe-area-inset-left))
                }
                .bmd-dialog-header h3 { font-size:1.08rem!important }
                .bmd-open-button { min-width:0;flex:0 0 auto;font-size:.7rem!important }
                .bmd-button-label-full { display:none }
                .bmd-button-label-mobile { display:inline }
                .bmd-fields { grid-template-columns:1fr }
                .bmd-field-wide { grid-column:auto }
                .bmd-dashboard-summary { grid-template-columns:repeat(2,minmax(0,1fr)) }
                .bmd-dashboard-rankings,.bmd-dashboard-coverage { grid-template-columns:1fr }
                .bmd-sale-settings-grid { grid-template-columns:1fr }
                .bmd-dashboard-table th,.bmd-dashboard-table td { padding:.42rem }
                #dpWrap .bmd-sale-threshold { text-align:left }
            }
        `;
        document.head.appendChild(style);
    }

    function getSetNumber() {
        return globalThis.BM_getBrickmergeSetNumber?.(window.location.href) ||
            window.location.pathname.match(/\/(\d{4,7})-\d+_[^/]+\/?$/)?.[1] ||
            null;
    }

    function today() {
        const date = new Date();
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function parseEuro(text) {
        const match = String(text || '').replace(/\u00a0/g, ' ')
            .match(/(\d[\d\s.,]*)\s*€/);
        if (!match) return null;
        const raw = match[1].replace(/\s/g, '');
        const decimalSeparator = raw.lastIndexOf(',') > raw.lastIndexOf('.')
            ? ','
            : '.';
        const normalized = decimalSeparator === ','
            ? raw.replace(/\./g, '').replace(',', '.')
            : raw.replace(/,/g, '');
        const value = Number(normalized);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    function currentBestPrice() {
        for (const element of document.querySelectorAll(
            '.content.setdetails .topprice, .content.setdetails .pa-bestprice'
        )) {
            const price = parseEuro(element.textContent);
            if (price !== null) return price;
        }
        return null;
    }

    function formatPrice(value) {
        return Number.isFinite(value)
            ? value.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
                useGrouping: false
            })
            : '';
    }

    function defaultSaleSettings() {
        return {
            defaults: { feePercent: 0, fixedFee: 0, shipping: 6.99 },
            sets: {}
        };
    }

    function normalizeSaleValues(value, fallback = defaultSaleSettings().defaults) {
        const number = (candidate, defaultValue, maximum) => {
            const parsed = Number(candidate);
            return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum
                ? parsed
                : defaultValue;
        };
        return {
            feePercent: number(value?.feePercent, fallback.feePercent, 99.99),
            fixedFee: number(value?.fixedFee, fallback.fixedFee, 10000),
            shipping: number(value?.shipping, fallback.shipping, 10000)
        };
    }

    function readSaleSettings() {
        const defaults = defaultSaleSettings();
        try {
            const stored = JSON.parse(localStorage.getItem(SALE_SETTINGS_KEY) || '{}');
            const normalizedDefaults = normalizeSaleValues(
                stored?.defaults,
                defaults.defaults
            );
            const sets = {};
            Object.entries(stored?.sets || {}).forEach(([setNumber, values]) => {
                if (/^\d{3,7}$/.test(setNumber)) {
                    sets[setNumber] = normalizeSaleValues(values, normalizedDefaults);
                }
            });
            return { defaults: normalizedDefaults, sets };
        } catch (error) {
            return defaults;
        }
    }

    function writeSaleSettings(settings) {
        localStorage.setItem(SALE_SETTINGS_KEY, JSON.stringify(settings));
    }

    function saleValuesForSet(setNumber) {
        const settings = readSaleSettings();
        return settings.sets[setNumber] || settings.defaults;
    }

    function calculateSaleThreshold(purchasePrice, values) {
        const price = Number(purchasePrice);
        const feePercent = Number(values?.feePercent);
        const fixedFee = Number(values?.fixedFee);
        const shipping = Number(values?.shipping);
        const retainedShare = 1 - feePercent / 100;
        if (!Number.isFinite(price) || price < 0 ||
            !Number.isFinite(feePercent) || feePercent < 0 ||
            !Number.isFinite(fixedFee) || fixedFee < 0 ||
            !Number.isFinite(shipping) || shipping < 0 ||
            retainedShare <= 0) return null;
        return (price + fixedFee + shipping) / retainedShare;
    }

    function formatCurrency(value) {
        return Number.isFinite(value)
            ? `${value.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })} €`
            : '–';
    }

    function performanceClass(value) {
        if (!Number.isFinite(value) || Math.abs(value) < 0.000001) {
            return 'bmd-neutral';
        }
        return value > 0 ? 'bmd-positive' : 'bmd-negative';
    }

    function formatPercent(value, digits = 1) {
        return Number.isFinite(value)
            ? signed(value, digits, ' %')
            : '–';
    }

    function input(type, name, attributes = {}) {
        const element = document.createElement('input');
        element.type = type;
        element.name = name;
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'value') element.value = value;
            else if (key === 'required') element.required = Boolean(value);
            else element.setAttribute(key, value);
        });
        return element;
    }

    function field(caption, control, wide = false) {
        const label = document.createElement('label');
        label.className = `bmd-field${wide ? ' bmd-field-wide' : ''}`;
        const text = document.createElement('span');
        text.textContent = caption;
        label.append(text, control);
        return label;
    }

    let depotBasePromise = null;
    const depotDataPromises = new Map();

    /*
     * In Firefox/Tampermonkey kann das globale fetch() aus dem isolierten
     * Userscript-Kontext stammen. Dann sieht Brickmerge trotz angemeldeter
     * Seite keine Sitzungscookies. Der Fetch der echten Seite laeuft dagegen
     * mit dem Origin der Detailseite und teilt deren Login-Sitzung.
     */
    function brickmergeFetch(path, options = {}) {
        const pageWindow = typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;
        const pageFetch = typeof pageWindow.fetch === 'function'
            ? pageWindow.fetch.bind(pageWindow)
            : window.fetch.bind(window);
        return pageFetch(new URL(path, window.location.origin).href, {
            ...options,
            credentials: 'include',
            redirect: 'follow',
            cache: 'no-store'
        });
    }

    async function loadDepotBase() {
        if (depotBasePromise) return depotBasePromise;
        depotBasePromise = (async () => {
        const response = await brickmergeFetch('/?a=depot', {
            headers: { Accept: 'text/html' }
        });
        if (!response.ok) throw new Error('Bestandsseite nicht erreichbar.');
        const depot = new DOMParser().parseFromString(
            await response.text(),
            'text/html'
        );
        const form = depot.querySelector('#dpAddForm');
        const listId = form?.querySelector('input[name="l"]')?.value;
        if (!form || !listId) throw new Error('Bitte melde dich bei brickmerge an.');
        const storageOptions = Array.from(
            form.querySelector('#dpAddStorage')?.options || []
        ).map(option => ({
            value: option.value,
            label: option.textContent.trim()
        }));
        return { listId, storageOptions };
        })();
        try {
            return await depotBasePromise;
        } catch (error) {
            depotBasePromise = null;
            throw error;
        }
    }

    async function loadDepotData(setNumber = '') {
        const normalizedSetNumber = String(setNumber || '').trim();
        if (normalizedSetNumber && depotDataPromises.has(normalizedSetNumber)) {
            return depotDataPromises.get(normalizedSetNumber);
        }
        const request = (async () => {
            const base = await loadDepotBase();
            if (!/^\d{3,7}$/.test(normalizedSetNumber)) {
                return { ...base, stock: null };
            }
            const params = new URLSearchParams({
                a: 'depot',
                l: base.listId,
                partial: '1',
                sort: 'nr',
                dir: '1',
                dpfilter: 'alle',
                q: normalizedSetNumber,
                page: '1'
            });
            const response = await brickmergeFetch(`/?${params.toString()}`, {
                headers: { Accept: 'text/html' }
            });
            if (!response.ok) return { ...base, stock: null };
            const result = new DOMParser().parseFromString(
                await response.text(),
                'text/html'
            );
            const exactRow = Array.from(
                result.querySelectorAll('.pa-row[data-nr][data-stock]')
            ).find(row => String(row.dataset.nr || '') === normalizedSetNumber);
            const parsedStock = Number.parseInt(exactRow?.dataset.stock || '', 10);
            return {
                ...base,
                stock: Number.isFinite(parsedStock) ? Math.max(0, parsedStock) : 0
            };
        })();
        if (normalizedSetNumber) depotDataPromises.set(normalizedSetNumber, request);
        try {
            return await request;
        } catch (error) {
            if (normalizedSetNumber) depotDataPromises.delete(normalizedSetNumber);
            throw error;
        }
    }

    function setDetailStock(button, stock) {
        if (!button || !Number.isFinite(Number(stock))) return;
        const normalizedStock = Math.max(0, Math.trunc(Number(stock)));
        button.dataset.bmdStock = String(normalizedStock);
        button.querySelectorAll(
            '.bmd-button-label-full, .bmd-button-label-mobile'
        ).forEach(label => {
            label.textContent = `Bestand: ${normalizedStock}`;
        });
        button.title = normalizedStock === 1
            ? '1 Stück im Bestand – weiteren Einkauf erfassen'
            : `${normalizedStock} Stück im Bestand – weiteren Einkauf erfassen`;
        button.setAttribute('aria-label', button.title);
    }

    function renderForm(container, setNumber, depotData) {
        container.replaceChildren();
        const form = document.createElement('form');
        form.action = '/';
        form.method = 'post';
        form.append(
            input('hidden', 'a', { value: 'depot' }),
            input('hidden', 'l', { value: depotData.listId })
        );

        const fields = document.createElement('div');
        fields.className = 'bmd-fields';
        fields.append(
            field('Setnummer', input('text', 'addset', {
                value: setNumber,
                readonly: 'readonly'
            })),
            field('Menge', input('number', 'lotqty', {
                value: '1', min: '1', max: '9999', required: true
            })),
            field('Einkaufsdatum', input('date', 'lotdate', { value: today() })),
            field('Einkaufspreis', input('text', 'lotprice', {
                value: formatPrice(currentBestPrice()),
                maxlength: '12',
                placeholder: '239,99',
                inputmode: 'decimal'
            }))
        );

        const condition = document.createElement('select');
        condition.name = 'lotcondition';
        [['1', 'neu'], ['0', 'gebraucht']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            condition.appendChild(option);
        });
        fields.appendChild(field('Zustand', condition));

        const storage = document.createElement('select');
        storage.name = 'lotstorage';
        const options = depotData.storageOptions.length
            ? depotData.storageOptions
            : [
                { value: '', label: 'ohne Lagerort' },
                { value: '__new__', label: '+ Neues Lager hinzufügen' }
            ];
        options.forEach(entry => {
            const option = document.createElement('option');
            option.value = entry.value;
            option.textContent = entry.label;
            storage.appendChild(option);
        });
        const storageField = field('Lager', storage, true);
        const newStorage = input('text', 'lotstoragenew', {
            maxlength: '50',
            placeholder: 'Name des Lagers'
        });
        newStorage.className = 'bmd-new-storage';
        newStorage.hidden = true;
        storageField.appendChild(newStorage);
        fields.appendChild(storageField);
        fields.appendChild(field('Notiz zur Charge', input('text', 'lotnote', {
            maxlength: '255',
            placeholder: 'z. B. VIP 10%'
        }), true));
        form.appendChild(fields);

        storage.addEventListener('change', () => {
            const isNew = storage.value === '__new__';
            newStorage.hidden = !isNew;
            newStorage.required = isNew;
            if (isNew) newStorage.focus();
        });

        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'button small smallRedButton bmd-submit';
        submit.textContent = 'Zum Bestand hinzufügen';
        const status = document.createElement('span');
        status.className = 'bmd-status';
        status.setAttribute('role', 'status');
        form.append(submit, status);

        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const addedQuantity = Number.parseInt(
                form.elements.lotqty.value || '1',
                10
            );
            submit.disabled = true;
            status.className = 'bmd-status';
            status.textContent = 'Wird hinzugefügt …';
            try {
                const response = await brickmergeFetch('/', {
                    method: 'POST',
                    body: new URLSearchParams(new FormData(form)),
                    headers: {
                        Accept: 'text/html',
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    }
                });
                const result = new DOMParser().parseFromString(
                    await response.text(),
                    'text/html'
                );
                const serverError = result.querySelector('.dp-err');
                if (!response.ok || serverError) {
                    throw new Error(
                        serverError?.textContent.replace(/\s+/g, ' ').trim() ||
                        'Hinzufügen fehlgeschlagen.'
                    );
                }
                if (!result.querySelector('#dpWrap')) {
                    throw new Error('Bitte melde dich bei brickmerge an.');
                }
                form.elements.lotqty.value = '1';
                form.elements.lotdate.value = today();
                form.elements.lotprice.value = formatPrice(currentBestPrice());
                form.elements.lotnote.value = '';
                newStorage.value = '';
                const detailButton = document.querySelector(
                    `.bmd-open-button[data-bmd-set-number="${setNumber}"]`
                );
                const previousStock = Number.parseInt(
                    detailButton?.dataset.bmdStock || '',
                    10
                );
                if (detailButton && Number.isFinite(previousStock)) {
                    setDetailStock(
                        detailButton,
                        previousStock + (Number.isFinite(addedQuantity)
                            ? addedQuantity
                            : 1)
                    );
                } else {
                    depotDataPromises.delete(setNumber);
                    void loadDepotData(setNumber).then(data => {
                        setDetailStock(detailButton, data.stock);
                    }).catch(() => {});
                }
                status.className = 'bmd-status bmd-status-ok';
                status.textContent = `LEGO ${setNumber} wurde hinzugefügt.`;
            } catch (error) {
                status.className = 'bmd-status bmd-status-error';
                status.textContent = error?.message || 'Hinzufügen fehlgeschlagen.';
            } finally {
                submit.disabled = false;
            }
        });
        container.appendChild(form);
    }

    let activeOverlay = null;
    let activeTrigger = null;

    function closeOverlay() {
        if (!activeOverlay) return;
        activeOverlay.remove();
        activeOverlay = null;
        document.body.classList.remove('bmd-overlay-open');
        document.removeEventListener('keydown', handleKeydown);
        activeTrigger?.focus();
        activeTrigger = null;
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') closeOverlay();
    }

    function mountOverlay(titleText, trigger, dialogClass = '') {
        if (activeOverlay) return null;
        activeTrigger = trigger || null;
        const overlay = document.createElement('div');
        overlay.className = 'bmd-overlay';
        const dialog = document.createElement('section');
        dialog.className = `bmd-dialog${dialogClass ? ` ${dialogClass}` : ''}`;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'bmd-dialog-title');

        const header = document.createElement('header');
        header.className = 'bmd-dialog-header';
        const title = document.createElement('h3');
        title.id = 'bmd-dialog-title';
        title.textContent = titleText;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bmd-close';
        close.textContent = '×';
        close.title = 'Schließen';
        close.setAttribute('aria-label', 'Dialog schließen');
        close.addEventListener('click', closeOverlay);
        header.append(title, close);

        const body = document.createElement('div');
        body.className = 'bmd-dialog-body';
        dialog.append(header, body);
        overlay.appendChild(dialog);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });

        activeOverlay = overlay;
        document.body.appendChild(overlay);
        document.body.classList.add('bmd-overlay-open');
        document.addEventListener('keydown', handleKeydown);
        close.focus();
        return { overlay, dialog, body, close };
    }

    function openSaleThresholdOverlay(setNumber, purchasePrice, trigger) {
        const mounted = mountOverlay(
            `Verkaufsschwelle für LEGO ${setNumber}`,
            trigger
        );
        if (!mounted) return;
        const { body } = mounted;
        const settings = readSaleSettings();
        const hasOverride = Boolean(settings.sets[setNumber]);
        const current = settings.sets[setNumber] || settings.defaults;
        const fields = document.createElement('div');
        fields.className = 'bmd-fields';

        const fee = input('number', 'feePercent', {
            value: String(current.feePercent), min: '0', max: '99.99',
            step: '0.01', inputmode: 'decimal'
        });
        const fixed = input('number', 'fixedFee', {
            value: String(current.fixedFee), min: '0', step: '0.01',
            inputmode: 'decimal'
        });
        const shipping = input('number', 'shipping', {
            value: String(current.shipping), min: '0', step: '0.01',
            inputmode: 'decimal'
        });
        fields.append(
            field('Ø Einkaufspreis', input('text', 'purchasePrice', {
                value: formatPrice(purchasePrice), readonly: 'readonly'
            })),
            field('Verkaufsgebühr in %', fee),
            field('Fixgebühr in €', fixed),
            field('Versand in €', shipping)
        );

        const result = document.createElement('div');
        result.className = 'bmd-threshold-result';
        const resultLabel = document.createElement('span');
        resultLabel.textContent = 'Mindestens erforderlicher Verkaufspreis';
        const resultValue = document.createElement('strong');
        const resultDetail = document.createElement('small');
        result.append(resultLabel, resultValue, resultDetail);

        const refreshResult = () => {
            const values = normalizeSaleValues({
                feePercent: fee.value,
                fixedFee: fixed.value,
                shipping: shipping.value
            }, current);
            const threshold = calculateSaleThreshold(purchasePrice, values);
            resultValue.textContent = formatCurrency(threshold);
            resultDetail.textContent =
                `${formatCurrency(purchasePrice)} EK + ` +
                `${formatCurrency(values.shipping)} Versand + ` +
                `${formatCurrency(values.fixedFee)} Fixgebühr; ` +
                `${formatPrice(values.feePercent)} % Verkaufsgebühr`;
        };
        [fee, fixed, shipping].forEach(control => {
            control.addEventListener('input', refreshResult);
        });
        refreshResult();

        const actions = document.createElement('div');
        actions.className = 'bmd-threshold-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'button small smallRedButton';
        save.textContent = 'Für dieses Set speichern';
        save.addEventListener('click', () => {
            const latest = readSaleSettings();
            latest.sets[setNumber] = normalizeSaleValues({
                feePercent: fee.value,
                fixedFee: fixed.value,
                shipping: shipping.value
            }, latest.defaults);
            writeSaleSettings(latest);
            closeOverlay();
            scheduleDepotUpdate();
        });
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'button small smallGreyButton';
        reset.textContent = hasOverride ? 'Standard verwenden' : 'Abbrechen';
        reset.addEventListener('click', () => {
            if (hasOverride) {
                const latest = readSaleSettings();
                delete latest.sets[setNumber];
                writeSaleSettings(latest);
                scheduleDepotUpdate();
            }
            closeOverlay();
        });
        actions.append(save, reset);

        const note = document.createElement('p');
        note.className = 'bmd-dashboard-note';
        note.textContent =
            'Die Schwelle ist der kalkulatorische Break-even ohne Gewinnaufschlag. ' +
            'Gebühren werden prozentual vom Verkaufspreis gerechnet.';
        body.append(fields, result, actions, note);
    }

    function openOverlay(setNumber, trigger) {
        if (activeOverlay) return;
        activeTrigger = trigger;
        const overlay = document.createElement('div');
        overlay.className = 'bmd-overlay';
        const dialog = document.createElement('section');
        dialog.className = 'bmd-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'bmd-dialog-title');

        const header = document.createElement('header');
        header.className = 'bmd-dialog-header';
        const title = document.createElement('h3');
        title.id = 'bmd-dialog-title';
        title.textContent = `LEGO ${setNumber} zum Bestand hinzufügen`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bmd-close';
        close.textContent = '×';
        close.title = 'Schließen';
        close.setAttribute('aria-label', 'Formular schließen');
        close.addEventListener('click', closeOverlay);
        header.append(title, close);

        const body = document.createElement('div');
        body.className = 'bmd-dialog-body';
        const loading = document.createElement('span');
        loading.className = 'bmd-loading';
        loading.textContent = 'Bestandsformular wird geladen …';
        body.appendChild(loading);
        dialog.append(header, body);
        overlay.appendChild(dialog);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });

        activeOverlay = overlay;
        document.body.appendChild(overlay);
        document.body.classList.add('bmd-overlay-open');
        document.addEventListener('keydown', handleKeydown);
        close.focus();

        loadDepotData(setNumber).then(data => {
            if (!body.isConnected) return;
            renderForm(body, setNumber, data);
            body.querySelector('input[name="lotqty"]')?.focus();
        }).catch(error => {
            if (!body.isConnected) return;
            const message = document.createElement('span');
            message.className = 'bmd-login';
            message.append(document.createTextNode(
                `${error?.message || 'Bestandsformular nicht verfügbar'} `
            ));
            const link = document.createElement('a');
            link.href = '/?a=depot';
            link.textContent = 'Zum Bestand';
            message.appendChild(link);
            body.replaceChildren(message);
        });
    }

    function setupDetailButton() {
        const setNumber = getSetNumber();
        const chartTrigger = document.getElementById('chartTrigger');
        const host = chartTrigger?.parentElement ||
            document.querySelector('.content.setdetails .productprice');
        if (!setNumber || !host || document.querySelector('.bmd-open-button')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
            'button small smallGreyButton bmd-open-button bm-detail-action-button';
        button.dataset.bmdSetNumber = setNumber;
        const content = document.createElement('span');
        content.className = 'bmd-button-content';
        const icon = document.createElement('span');
        icon.className = 'bmd-button-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML =
            '<svg viewBox="0 0 24 24" focusable="false">' +
            '<path d="M4 7h16v13H4z"/>' +
            '<path d="M3 3h18v4H3z"/>' +
            '<path d="M9 11h6"/>' +
            '</svg>';
        const fullLabel = document.createElement('span');
        fullLabel.className = 'bmd-button-label-full';
        fullLabel.textContent = 'Bestand';
        const mobileLabel = document.createElement('span');
        mobileLabel.className = 'bmd-button-label-mobile';
        mobileLabel.textContent = 'Bestand';
        content.append(icon, fullLabel, mobileLabel);
        button.appendChild(content);
        button.title = 'Dieses Set zum Bestand hinzufügen';
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', () => openOverlay(setNumber, button));
        if (chartTrigger) {
            host.classList.add('bmd-has-depot-button');
            chartTrigger.insertAdjacentElement('afterend', button);
        } else {
            host.appendChild(button);
        }

        // Die serverseitige Suche berücksichtigt auch große, paginierte Depots.
        // Schlägt sie fehl (z. B. ausgeloggt), bleibt der neutrale Button stehen.
        void loadDepotData(setNumber).then(data => {
            setDetailStock(button, data.stock);
        }).catch(() => {});
    }

    function parseNumber(value, german = false) {
        const text = String(value ?? '').trim();
        if (!text) return null;
        const normalized = german
            ? text.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
            : text.replace(',', '.');
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function signed(value, digits, suffix) {
        return `${value > 0 ? '+' : ''}${value.toLocaleString('de-DE', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        })}${suffix}`;
    }

    function dateAtUtcMidnight(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const date = Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );
        return Number.isFinite(date) ? date : null;
    }

    function calculateAnnualizedReturn(row, currentBest) {
        const item = row.dataset.item;
        const lots = document.querySelector(`.dp-lots[data-for="${item}"]`);
        if (!item || !lots || !Number.isFinite(currentBest) || currentBest <= 0) {
            return null;
        }

        const todayValue = today();
        const valuationDate = dateAtUtcMidnight(todayValue);
        const cashFlows = [];
        let totalQuantity = 0;
        for (const lot of lots.querySelectorAll('.dp-lot[data-lot]')) {
            const edit = lot.querySelector('.dp-editlot');
            const quantity = Number.parseInt(edit?.dataset.qty || '', 10);
            const price = parseNumber(edit?.dataset.price, true);
            const purchaseDate = dateAtUtcMidnight(edit?.dataset.date);
            if (!Number.isFinite(quantity) || quantity <= 0 ||
                price === null || price <= 0 || purchaseDate === null ||
                purchaseDate > valuationDate) {
                return null;
            }
            totalQuantity += quantity;
            cashFlows.push({
                years: (valuationDate - purchaseDate) /
                    (365.2425 * 24 * 60 * 60 * 1000),
                amount: -(quantity * price)
            });
        }
        if (!cashFlows.length || totalQuantity <= 0 ||
            !cashFlows.some(flow => flow.years > 0)) return null;

        const valuation = totalQuantity * currentBest;
        const netPresentValue = rate => valuation + cashFlows.reduce(
            (sum, flow) => sum + flow.amount /
                Math.pow(1 + rate, flow.years),
            0
        );

        let low = -0.999999;
        let high = 1;
        let lowValue = netPresentValue(low);
        let highValue = netPresentValue(high);
        while (Number.isFinite(highValue) && highValue < 0 && high < 1e9) {
            high = high * 2 + 1;
            highValue = netPresentValue(high);
        }
        if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) ||
            lowValue > 0 || highValue < 0) return null;

        for (let iteration = 0; iteration < 100; iteration += 1) {
            const middle = (low + high) / 2;
            const value = netPresentValue(middle);
            if (!Number.isFinite(value)) return null;
            if (value < 0) low = middle;
            else high = middle;
        }
        const rate = (low + high) / 2;
        return Number.isFinite(rate) ? rate * 100 : null;
    }

    function eolGroup(value) {
        const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
        if (!match) return 'Kein EOL';
        const target = Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );
        const current = dateAtUtcMidnight(today());
        if (!Number.isFinite(target) || !Number.isFinite(current)) return 'Kein EOL';
        if (target < current) return 'Ausgelaufen';
        const months = (target - current) / (365.2425 / 12 * 24 * 60 * 60 * 1000);
        if (months <= 12) return 'EOL in ≤ 12 Monaten';
        if (months <= 24) return 'EOL in 13–24 Monaten';
        return 'EOL in > 24 Monaten';
    }

    function parseDepotPage(documentNode) {
        const rows = Array.from(documentNode.querySelectorAll(
            '#dpTableBody .pa-row[data-item][data-nr]'
        ));
        const lotBlocks = new Map(Array.from(
            documentNode.querySelectorAll('#dpTableBody .dp-lots[data-for]')
        ).map(block => [block.dataset.for, block]));
        const records = [];

        rows.forEach(row => {
            const item = String(row.dataset.item || '');
            const setNumber = String(row.dataset.nr || '');
            const name = String(row.dataset.name || '').trim() || `LEGO ${setNumber}`;
            const theme = String(row.dataset.theme || '').trim() || 'Ohne Thema';
            const eol = String(row.dataset.eol || '');
            const best = parseNumber(row.dataset.best);
            const detailUrl = String(row.dataset.url || '').trim();
            const saleValues = saleValuesForSet(setNumber);
            const valuationDate = dateAtUtcMidnight(today());
            const enrichRecord = record => {
                const currentValue = best !== null && best > 0
                    ? best * record.quantity
                    : null;
                const netPerPiece = best !== null && best > 0
                    ? best * (1 - saleValues.feePercent / 100) -
                        saleValues.fixedFee - saleValues.shipping
                    : null;
                const purchaseTimestamp = dateAtUtcMidnight(record.purchaseDate);
                return {
                    ...record,
                    name,
                    detailUrl,
                    best,
                    currentValue,
                    netValue: netPerPiece === null
                        ? null
                        : netPerPiece * record.quantity,
                    ageDays: purchaseTimestamp !== null &&
                        purchaseTimestamp <= valuationDate
                        ? (valuationDate - purchaseTimestamp) /
                            (24 * 60 * 60 * 1000)
                        : null
                };
            };
            const lotRows = Array.from(
                lotBlocks.get(item)?.querySelectorAll('.dp-lot[data-lot]') || []
            );
            let addedLot = false;
            lotRows.forEach(lot => {
                const edit = lot.querySelector('.dp-editlot');
                const quantity = Number.parseInt(edit?.dataset.qty || '', 10);
                if (!Number.isFinite(quantity) || quantity <= 0) return;
                const price = parseNumber(edit?.dataset.price, true);
                const conditionValue = String(edit?.dataset.condition || '');
                const storageValue = String(edit?.dataset.storage || '').trim();
                records.push(enrichRecord({
                    item,
                    setNumber,
                    theme,
                    eol: eolGroup(eol),
                    eolRaw: eol,
                    storage: storageValue || 'Ohne Lagerort',
                    condition: conditionValue === '0' ? 'gebraucht' : 'neu',
                    quantity,
                    capital: price !== null && price >= 0 ? price * quantity : null,
                    purchaseDate: String(edit?.dataset.date || '')
                }));
                addedLot = true;
            });

            if (!addedLot) {
                const quantity = Number.parseInt(row.dataset.stock || '', 10);
                if (!Number.isFinite(quantity) || quantity <= 0) return;
                const average = parseNumber(row.dataset.avg);
                records.push(enrichRecord({
                    item,
                    setNumber,
                    theme,
                    eol: eolGroup(eol),
                    eolRaw: eol,
                    storage: String(row.dataset.storage || '').trim() || 'Ohne Lagerort',
                    condition: /gebraucht/i.test(row.dataset.cond || '')
                        ? 'gebraucht'
                        : 'neu',
                    quantity,
                    capital: average !== null && average >= 0
                        ? average * quantity
                        : null,
                    purchaseDate: ''
                }));
            }
        });
        return records;
    }

    async function fetchDepotDashboardPage(listId, page) {
        const params = new URLSearchParams({
            a: 'depot',
            l: listId,
            partial: '1',
            sort: 'nr',
            dir: '1',
            dpfilter: 'alle',
            storage: '',
            q: '',
            page: String(page)
        });
        const response = await brickmergeFetch(`/?${params.toString()}`, {
            headers: { Accept: 'text/html' }
        });
        if (!response.ok) throw new Error(`Depot-Seite ${page} nicht erreichbar.`);
        const documentNode = new DOMParser().parseFromString(
            await response.text(),
            'text/html'
        );
        const meta = documentNode.querySelector('#dpMeta');
        if (!meta) throw new Error('Depotdaten konnten nicht gelesen werden.');
        return {
            records: parseDepotPage(documentNode),
            pages: Math.max(1, Number.parseInt(meta.dataset.pages || '1', 10) || 1)
        };
    }

    let depotDashboardCache = null;
    let depotDashboardPromise = null;
    async function loadDepotDashboardData(onProgress = () => {}, force = false) {
        if (!force && depotDashboardCache &&
            Date.now() - depotDashboardCache.savedAt < 120000) {
            onProgress(depotDashboardCache.pages, depotDashboardCache.pages);
            return depotDashboardCache;
        }
        if (depotDashboardPromise) return depotDashboardPromise;
        depotDashboardPromise = (async () => {
            const base = await loadDepotBase();
            const first = await fetchDepotDashboardPage(base.listId, 1);
            const records = [...first.records];
            onProgress(1, first.pages);
            let nextPage = 2;
            let completed = 1;
            const worker = async () => {
                while (nextPage <= first.pages) {
                    const page = nextPage;
                    nextPage += 1;
                    const result = await fetchDepotDashboardPage(base.listId, page);
                    records.push(...result.records);
                    completed += 1;
                    onProgress(completed, first.pages);
                }
            };
            await Promise.all(Array.from(
                { length: Math.min(4, Math.max(0, first.pages - 1)) },
                () => worker()
            ));
            depotDashboardCache = {
                records,
                pages: first.pages,
                savedAt: Date.now()
            };
            return depotDashboardCache;
        })();
        try {
            return await depotDashboardPromise;
        } finally {
            depotDashboardPromise = null;
        }
    }

    function aggregateDepot(records, dimension) {
        const groups = new Map();
        records.forEach(record => {
            const key = record[dimension] || 'Ohne Angabe';
            if (!groups.has(key)) {
                groups.set(key, {
                    label: key,
                    items: new Set(),
                    pieces: 0,
                    capital: 0,
                    currentValue: 0,
                    netValue: 0,
                    comparableCapital: 0,
                    comparableValue: 0,
                    comparableNetValue: 0,
                    weightedAgeDays: 0,
                    agedPieces: 0,
                    missingPieces: 0,
                    missingOfferPieces: 0
                });
            }
            const group = groups.get(key);
            group.items.add(record.item);
            group.pieces += record.quantity;
            if (record.capital === null) group.missingPieces += record.quantity;
            else group.capital += record.capital;
            if (record.currentValue === null) {
                group.missingOfferPieces += record.quantity;
            } else {
                group.currentValue += record.currentValue;
                group.netValue += record.netValue || 0;
            }
            if (record.capital !== null && record.currentValue !== null) {
                group.comparableCapital += record.capital;
                group.comparableValue += record.currentValue;
                group.comparableNetValue += record.netValue || 0;
            }
            if (record.ageDays !== null) {
                group.weightedAgeDays += record.ageDays * record.quantity;
                group.agedPieces += record.quantity;
            }
        });
        return Array.from(groups.values()).map(group => ({
            ...group,
            sets: group.items.size,
            grossProfit: group.comparableValue - group.comparableCapital,
            grossReturn: group.comparableCapital > 0
                ? (group.comparableValue - group.comparableCapital) /
                    group.comparableCapital * 100
                : null,
            netProfit: group.comparableNetValue - group.comparableCapital,
            netReturn: group.comparableCapital > 0
                ? (group.comparableNetValue - group.comparableCapital) /
                    group.comparableCapital * 100
                : null,
            averageAgeDays: group.agedPieces > 0
                ? group.weightedAgeDays / group.agedPieces
                : null
        })).sort((a, b) => b.capital - a.capital ||
            a.label.localeCompare(b.label, 'de'));
    }

    function aggregateDepotSets(records) {
        const sets = new Map();
        records.forEach(record => {
            if (!sets.has(record.item)) {
                sets.set(record.item, {
                    item: record.item,
                    setNumber: record.setNumber,
                    name: record.name,
                    detailUrl: record.detailUrl,
                    theme: record.theme,
                    eol: record.eol,
                    pieces: 0,
                    capital: 0,
                    currentValue: 0,
                    netValue: 0,
                    comparableCapital: 0,
                    comparableValue: 0,
                    comparableNetValue: 0,
                    missingCapital: false,
                    missingOffer: false
                });
            }
            const set = sets.get(record.item);
            set.pieces += record.quantity;
            if (record.capital === null) set.missingCapital = true;
            else set.capital += record.capital;
            if (record.currentValue === null) set.missingOffer = true;
            else {
                set.currentValue += record.currentValue;
                set.netValue += record.netValue || 0;
            }
            if (record.capital !== null && record.currentValue !== null) {
                set.comparableCapital += record.capital;
                set.comparableValue += record.currentValue;
                set.comparableNetValue += record.netValue || 0;
            }
        });
        return Array.from(sets.values()).map(set => ({
            ...set,
            grossProfit: set.comparableValue - set.comparableCapital,
            grossReturn: set.comparableCapital > 0
                ? (set.comparableValue - set.comparableCapital) /
                    set.comparableCapital * 100
                : null,
            netProfit: set.comparableNetValue - set.comparableCapital,
            netReturn: set.comparableCapital > 0
                ? (set.comparableNetValue - set.comparableCapital) /
                    set.comparableCapital * 100
                : null
        }));
    }

    function renderDepotDashboard(body, data) {
        body.replaceChildren();
        const records = data.records;
        const setSummaries = aggregateDepotSets(records);
        const itemIds = new Set(records.map(record => record.item));
        const pieces = records.reduce((sum, record) => sum + record.quantity, 0);
        const capital = records.reduce(
            (sum, record) => sum + (record.capital === null ? 0 : record.capital),
            0
        );
        const missingPieces = records.reduce(
            (sum, record) => sum + (record.capital === null ? record.quantity : 0),
            0
        );
        const missingOfferPieces = records.reduce(
            (sum, record) => sum +
                (record.currentValue === null ? record.quantity : 0),
            0
        );
        const currentValue = records.reduce(
            (sum, record) => sum + (record.currentValue || 0),
            0
        );
        const netValue = records.reduce(
            (sum, record) => sum + (record.netValue || 0),
            0
        );
        const comparableCapital = records.reduce(
            (sum, record) => sum +
                (record.capital !== null && record.currentValue !== null
                    ? record.capital
                    : 0),
            0
        );
        const comparableValue = records.reduce(
            (sum, record) => sum +
                (record.capital !== null && record.currentValue !== null
                    ? record.currentValue
                    : 0),
            0
        );
        const comparableNetValue = records.reduce(
            (sum, record) => sum +
                (record.capital !== null && record.currentValue !== null
                    ? record.netValue || 0
                    : 0),
            0
        );
        const grossProfit = comparableValue - comparableCapital;
        const grossReturn = comparableCapital > 0
            ? grossProfit / comparableCapital * 100
            : null;
        const netProfit = comparableNetValue - comparableCapital;
        const netReturn = comparableCapital > 0
            ? netProfit / comparableCapital * 100
            : null;
        const agedPieces = records.reduce(
            (sum, record) => sum + (record.ageDays === null ? 0 : record.quantity),
            0
        );
        const averageAgeDays = agedPieces > 0
            ? records.reduce(
                (sum, record) => sum +
                    (record.ageDays === null ? 0 : record.ageDays * record.quantity),
                0
            ) / agedPieces
            : null;
        const expiredCapital = records.filter(record => record.eol === 'Ausgelaufen')
            .reduce((sum, record) => sum + (record.capital || 0), 0);
        const expiredShare = capital > 0 ? expiredCapital / capital * 100 : null;
        const dataCoverage = pieces > 0
            ? (pieces - Math.max(missingPieces, missingOfferPieces)) / pieces * 100
            : null;

        const summary = document.createElement('div');
        summary.className = 'bmd-dashboard-summary';
        [
            {
                label: 'Gebundenes Kapital',
                value: formatCurrency(capital),
                detail: `${itemIds.size.toLocaleString('de-DE')} Sets · ` +
                    `${pieces.toLocaleString('de-DE')} Stück`
            },
            {
                label: 'Aktueller Angebotswert',
                value: formatCurrency(currentValue),
                detail: missingOfferPieces
                    ? `${missingOfferPieces} Stück ohne Angebot`
                    : 'alle Stücke mit Angebot'
            },
            {
                label: 'Gewinn/Verlust zum EK',
                value: formatCurrency(grossProfit),
                detail: formatPercent(grossReturn),
                performance: grossReturn
            },
            {
                label: 'Netto nach Verkaufskosten',
                value: formatCurrency(netProfit),
                detail: `${formatPercent(netReturn)} zum EK`,
                performance: netReturn
            },
            {
                label: 'Ø Haltedauer',
                value: averageAgeDays === null
                    ? '–'
                    : `${Math.round(averageAgeDays).toLocaleString('de-DE')} Tage`,
                detail: averageAgeDays === null
                    ? 'keine Einkaufsdaten'
                    : `${(averageAgeDays / 365.2425).toLocaleString('de-DE', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1
                    })} Jahre`
            },
            {
                label: 'Kapital in EOL-Sets',
                value: formatCurrency(expiredCapital),
                detail: `${formatPercent(expiredShare)} des Kapitals`
            },
            {
                label: 'Netto-Verkaufswert',
                value: formatCurrency(netValue),
                detail: 'nach Gebühren, Fixkosten und Versand'
            },
            {
                label: 'Datenabdeckung',
                value: formatPercent(dataCoverage, 0),
                detail: `${missingPieces} ohne EK · ${missingOfferPieces} ohne Angebot`
            }
        ].forEach(entry => {
            const card = document.createElement('div');
            card.className = 'bmd-dashboard-kpi';
            if (Object.hasOwn(entry, 'performance')) {
                card.classList.add(entry.performance > 0
                    ? 'bmd-kpi-positive'
                    : entry.performance < 0
                        ? 'bmd-kpi-negative'
                        : 'bmd-kpi-neutral');
            }
            const label = document.createElement('span');
            label.textContent = entry.label;
            const value = document.createElement('strong');
            value.textContent = entry.value;
            if (Object.hasOwn(entry, 'performance')) {
                value.classList.add(performanceClass(entry.performance));
            }
            const detail = document.createElement('small');
            detail.textContent = entry.detail;
            if (Object.hasOwn(entry, 'performance')) {
                detail.classList.add(
                    'bmd-performance-percent',
                    performanceClass(entry.performance)
                );
            }
            card.append(label, value, detail);
            summary.appendChild(card);
        });

        const saleSettings = readSaleSettings();
        const settingsBox = document.createElement('section');
        settingsBox.className = 'bmd-sale-settings';
        const settingsTitle = document.createElement('h4');
        settingsTitle.textContent = 'Standard für Verkaufsschwellen';
        const settingsGrid = document.createElement('div');
        settingsGrid.className = 'bmd-sale-settings-grid';
        const fee = input('number', 'dashboardFee', {
            value: String(saleSettings.defaults.feePercent), min: '0',
            max: '99.99', step: '0.01', inputmode: 'decimal'
        });
        const fixed = input('number', 'dashboardFixed', {
            value: String(saleSettings.defaults.fixedFee), min: '0',
            step: '0.01', inputmode: 'decimal'
        });
        const shipping = input('number', 'dashboardShipping', {
            value: String(saleSettings.defaults.shipping), min: '0',
            step: '0.01', inputmode: 'decimal'
        });
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'button small smallRedButton';
        save.textContent = 'Standard speichern';
        save.addEventListener('click', () => {
            const latest = readSaleSettings();
            latest.defaults = normalizeSaleValues({
                feePercent: fee.value,
                fixedFee: fixed.value,
                shipping: shipping.value
            }, latest.defaults);
            writeSaleSettings(latest);
            save.textContent = 'Gespeichert ✓';
            window.setTimeout(() => { save.textContent = 'Standard speichern'; }, 1400);
            scheduleDepotUpdate();
        });
        settingsGrid.append(
            field('Verkaufsgebühr in %', fee),
            field('Fixgebühr in €', fixed),
            field('Versand in €', shipping),
            save
        );
        const formula = document.createElement('p');
        formula.className = 'bmd-sale-formula';
        formula.textContent =
            'Break-even = (Einkaufspreis + Versand + Fixgebühr) ÷ ' +
            '(1 − Verkaufsgebühr). Einzelne Sets lassen sich direkt in der ' +
            'Bestpreisspalte abweichend konfigurieren.';
        settingsBox.append(settingsTitle, settingsGrid, formula);

        const section = document.createElement('section');
        section.className = 'bmd-dashboard-section';
        const title = document.createElement('h4');
        title.textContent = 'Aufteilung des gebundenen Kapitals';
        const tabs = document.createElement('div');
        tabs.className = 'bmd-dashboard-tabs';
        tabs.setAttribute('role', 'tablist');
        const tableWrap = document.createElement('div');
        tableWrap.className = 'bmd-dashboard-table-wrap';
        const dimensions = [
            ['theme', 'Thema'],
            ['storage', 'Lager'],
            ['condition', 'Zustand'],
            ['eol', 'EOL']
        ];

        const showDimension = dimension => {
            tabs.querySelectorAll('.bmd-dashboard-tab').forEach(button => {
                button.setAttribute(
                    'aria-selected',
                    String(button.dataset.dimension === dimension)
                );
            });
            const table = document.createElement('table');
            table.className = 'bmd-dashboard-table';
            const head = document.createElement('thead');
            const headRow = document.createElement('tr');
            [
                'Gruppe', 'Sets', 'Stück', 'Kapital', 'Akt. Wert',
                'Gewinn', 'Rendite', 'Kapitalanteil'
            ].forEach(text => {
                const th = document.createElement('th');
                th.textContent = text;
                headRow.appendChild(th);
            });
            head.appendChild(headRow);
            const tbody = document.createElement('tbody');
            aggregateDepot(records, dimension).forEach(group => {
                const row = document.createElement('tr');
                const share = capital > 0 ? group.capital / capital * 100 : 0;
                const values = [
                    group.label,
                    group.sets.toLocaleString('de-DE'),
                    group.pieces.toLocaleString('de-DE'),
                    formatCurrency(group.capital),
                    formatCurrency(group.currentValue),
                    formatCurrency(group.grossProfit)
                ];
                values.forEach((value, index) => {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    if (index === 5) {
                        cell.classList.add(performanceClass(group.grossProfit));
                    }
                    row.appendChild(cell);
                });
                const returnCell = document.createElement('td');
                returnCell.textContent = formatPercent(group.grossReturn);
                returnCell.classList.add(
                    'bmd-performance-percent',
                    performanceClass(group.grossReturn)
                );
                row.appendChild(returnCell);
                const shareCell = document.createElement('td');
                shareCell.append(document.createTextNode(
                    `${share.toLocaleString('de-DE', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1
                    })} %`
                ));
                const bar = document.createElement('span');
                bar.className = 'bmd-dashboard-bar';
                bar.style.width = `${Math.max(2, Math.min(60, share * 0.6))}px`;
                bar.setAttribute('aria-hidden', 'true');
                shareCell.appendChild(bar);
                row.appendChild(shareCell);
                const missing = [];
                if (group.missingPieces > 0) {
                    missing.push(`${group.missingPieces} Stück ohne Einkaufspreis`);
                }
                if (group.missingOfferPieces > 0) {
                    missing.push(`${group.missingOfferPieces} Stück ohne Angebot`);
                }
                row.title = missing.join(' · ');
                tbody.appendChild(row);
            });
            table.append(head, tbody);
            tableWrap.replaceChildren(table);
        };

        dimensions.forEach(([dimension, label]) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'bmd-dashboard-tab';
            tab.dataset.dimension = dimension;
            tab.textContent = label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(dimension === 'theme'));
            tab.addEventListener('click', () => showDimension(dimension));
            tabs.appendChild(tab);
        });
        section.append(title, tabs, tableWrap);
        showDimension('theme');

        const rankings = document.createElement('div');
        rankings.className = 'bmd-dashboard-rankings';
        const buildRanking = (heading, entries) => {
            const panel = document.createElement('section');
            panel.className = 'bmd-dashboard-ranking';
            const panelTitle = document.createElement('h4');
            panelTitle.textContent = heading;
            const wrapper = document.createElement('div');
            wrapper.className = 'bmd-dashboard-table-wrap';
            const table = document.createElement('table');
            table.className = 'bmd-dashboard-table';
            const head = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['Set', 'Kapital', 'Rendite'].forEach(label => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            head.appendChild(headerRow);
            const tbody = document.createElement('tbody');
            if (entries.length === 0) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 3;
                cell.textContent = 'Keine vollständigen Daten';
                row.appendChild(cell);
                tbody.appendChild(row);
            } else {
                entries.slice(0, 7).forEach(entry => {
                    const row = document.createElement('tr');
                    const setCell = document.createElement('td');
                    const link = document.createElement('a');
                    link.className = 'bmd-dashboard-setlink';
                    link.href = entry.detailUrl || `/?find=${encodeURIComponent(
                        entry.setNumber
                    )}`;
                    link.textContent = `${entry.setNumber} · ${entry.name}`;
                    link.title = `${entry.pieces} Stück · ${entry.theme}`;
                    setCell.appendChild(link);
                    const capitalCell = document.createElement('td');
                    capitalCell.textContent = formatCurrency(entry.capital);
                    const returnCell = document.createElement('td');
                    returnCell.textContent = formatPercent(entry.grossReturn);
                    returnCell.classList.add(
                        'bmd-performance-percent',
                        performanceClass(entry.grossReturn)
                    );
                    row.append(setCell, capitalCell, returnCell);
                    tbody.appendChild(row);
                });
            }
            table.append(head, tbody);
            wrapper.appendChild(table);
            panel.append(panelTitle, wrapper);
            return panel;
        };
        rankings.append(
            buildRanking(
                'Größte Kapitalpositionen',
                [...setSummaries].filter(set => set.capital > 0)
                    .sort((a, b) => b.capital - a.capital)
            ),
            buildRanking(
                'Stärkste Gewinner',
                [...setSummaries].filter(set => set.grossReturn > 0)
                    .sort((a, b) => b.grossReturn - a.grossReturn)
            ),
            buildRanking(
                'Stärkste Verlierer',
                [...setSummaries].filter(set => set.grossReturn < 0)
                    .sort((a, b) => a.grossReturn - b.grossReturn)
            )
        );

        const coverage = document.createElement('div');
        coverage.className = 'bmd-dashboard-coverage';
        [
            [
                'Einkaufspreise vorhanden',
                pieces > 0 ? (pieces - missingPieces) / pieces * 100 : null,
                `${missingPieces} Stück ohne EK`
            ],
            [
                'Aktuelle Angebote vorhanden',
                pieces > 0 ? (pieces - missingOfferPieces) / pieces * 100 : null,
                `${missingOfferPieces} Stück ohne Angebot`
            ],
            [
                'Einkaufsdatum vorhanden',
                pieces > 0 ? agedPieces / pieces * 100 : null,
                `${pieces - agedPieces} Stück ohne Datum`
            ]
        ].forEach(([labelText, percentageValue, detailText]) => {
            const item = document.createElement('div');
            item.className = 'bmd-dashboard-coverage-item';
            const label = document.createElement('span');
            label.textContent = labelText;
            const value = document.createElement('strong');
            value.textContent = formatPercent(percentageValue, 0);
            const detail = document.createElement('span');
            detail.textContent = detailText;
            item.append(label, value, detail);
            coverage.appendChild(item);
        });

        const note = document.createElement('p');
        note.className = 'bmd-dashboard-note';
        note.textContent = missingPieces > 0
            ? `${missingPieces.toLocaleString('de-DE')} Stück ohne Einkaufspreis ` +
                'sind im gebundenen Kapital nicht enthalten.'
            : `Alle ${data.pages.toLocaleString('de-DE')} Depot-Seiten wurden berücksichtigt.`;
        body.append(summary, settingsBox, section, rankings, coverage, note);
    }

    function openDepotDashboard(trigger, force = false) {
        const mounted = mountOverlay('Depot-Dashboard', trigger, 'bmd-dashboard-dialog');
        if (!mounted) return;
        const { body } = mounted;
        const loading = document.createElement('span');
        loading.className = 'bmd-loading';
        loading.textContent = 'Depot wird vollständig geladen …';
        body.appendChild(loading);
        loadDepotDashboardData((completed, pages) => {
            if (loading.isConnected) {
                loading.textContent = `Depot wird geladen: ${completed} von ${pages} Seiten …`;
            }
        }, force).then(data => {
            if (body.isConnected) renderDepotDashboard(body, data);
        }).catch(error => {
            if (!body.isConnected) return;
            const message = document.createElement('span');
            message.className = 'bmd-status bmd-status-error';
            message.textContent = error?.message || 'Dashboard konnte nicht geladen werden.';
            body.replaceChildren(message);
        });
    }

    function setupDepotDashboardButton() {
        const wrap = document.getElementById('dpWrap');
        const tools = wrap?.querySelector('.dp-headtools');
        if (!tools || tools.querySelector('.bmd-dashboard-button')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button small smallGreyButton bmd-dashboard-button';
        button.textContent = '📊 Dashboard';
        button.title = 'Depot nach Thema, Lager, Zustand und EOL auswerten';
        button.addEventListener('click', () => openDepotDashboard(button));
        tools.prepend(button);
    }

    function updateDepotSaleThresholds() {
        const wrap = document.getElementById('dpWrap');
        if (!wrap) return;
        wrap.querySelectorAll('#dpTableBody .pa-row[data-nr][data-avg]')
            .forEach(row => {
                const setNumber = String(row.dataset.nr || '');
                const average = parseNumber(row.dataset.avg);
                const cell = row.querySelector('.pa-c-best');
                let thresholdButton = cell?.querySelector('.bmd-sale-threshold');
                if (!cell || !setNumber || average === null || average < 0) {
                    thresholdButton?.remove();
                    return;
                }
                const settings = readSaleSettings();
                const hasOverride = Boolean(settings.sets[setNumber]);
                const values = saleValuesForSet(setNumber);
                const threshold = calculateSaleThreshold(average, values);
                if (!thresholdButton) {
                    thresholdButton = document.createElement('button');
                    thresholdButton.type = 'button';
                    thresholdButton.className = 'bmd-sale-threshold';
                    cell.appendChild(thresholdButton);
                }
                thresholdButton.textContent =
                    `Verkaufsschwelle: ${formatCurrency(threshold)}` +
                    (hasOverride ? ' •' : '');
                thresholdButton.title =
                    `${formatPrice(values.feePercent)} % Gebühr + ` +
                    `${formatCurrency(values.fixedFee)} Fixgebühr + ` +
                    `${formatCurrency(values.shipping)} Versand` +
                    (hasOverride ? ' (Set-Werte)' : ' (Standardwerte)');
                thresholdButton.onclick = event => {
                    event.stopPropagation();
                    openSaleThresholdOverlay(setNumber, average, thresholdButton);
                };
            });
    }

    function updateDepotPartsLinks() {
        const wrap = document.getElementById('dpWrap');
        if (!wrap) return;
        wrap.querySelectorAll('#dpTableBody .pa-row[data-nr]')
            .forEach(row => {
                const setNumber = String(row.dataset.nr || '').trim();
                if (!/^\d{3,7}$/.test(setNumber) ||
                    row.querySelector('.bmd-parts-link')) return;
                const subline = row.querySelector('.dp-subline') ||
                    row.querySelector('.pa-c-set');
                if (!subline) return;
                const link = document.createElement('a');
                link.className = 'bmd-parts-link';
                link.href =
                    'https://www.bricklink.com/catalogItemInv.asp?S=' +
                    encodeURIComponent(`${setNumber}-1`);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = '🧱 Einzelteile';
                link.title = `BrickLink-Einzelteileinventar für LEGO ${setNumber}`;
                link.setAttribute('aria-label', link.title);
                subline.appendChild(link);
            });
    }

    function updateDepotGrowth() {
        const wrap = document.getElementById('dpWrap');
        if (!wrap) return;
        wrap.querySelectorAll('#dpTableBody .pa-row[data-avg][data-best]')
            .forEach(row => {
                const average = parseNumber(row.dataset.avg);
                const best = parseNumber(row.dataset.best);
                const cell = row.querySelector('.pa-c-best');
                let growth = cell?.querySelector('.bmd-growth');
                if (!cell || average === null || average <= 0 ||
                    best === null || best <= 0) {
                    growth?.remove();
                    return;
                }
                const difference = best - average;
                const percentage = difference / average * 100;
                const annualized = calculateAnnualizedReturn(row, best);
                if (!growth) {
                    growth = document.createElement('span');
                    growth.className = 'bmd-growth';
                    cell.appendChild(growth);
                }
                growth.className = 'bmd-growth';
                const differenceValue = document.createElement('span');
                differenceValue.className = performanceClass(difference);
                differenceValue.textContent = signed(difference, 2, ' €');
                const percentageValue = document.createElement('span');
                percentageValue.className =
                    `bmd-performance-percent ${performanceClass(percentage)}`;
                percentageValue.textContent = signed(percentage, 1, ' %');
                growth.replaceChildren(
                    differenceValue,
                    document.createTextNode(' / '),
                    percentageValue,
                    document.createTextNode(' zum EK')
                );
                if (annualized !== null) {
                    const annualizedValue = document.createElement('span');
                    annualizedValue.className =
                        `bmd-performance-percent ${performanceClass(annualized)}`;
                    annualizedValue.textContent = signed(annualized, 1, ' %');
                    growth.append(
                        document.createTextNode(' · '),
                        annualizedValue,
                        document.createTextNode(' p.a.')
                    );
                }
                growth.title =
                    'Aktueller Bestpreis abzüglich durchschnittlichem Einkaufspreis' +
                    (annualized === null
                        ? ''
                        : '; p.a. = kalkulatorische annualisierte Rendite (XIRR) ' +
                            'aus allen Einkaufschargen bis heute');
            });

        const stats = wrap.querySelector('.dp-statsbar');
        if (!stats) return;
        let stat = stats.querySelector('.bmd-growth-stat');
        if (!stat) {
            stat = document.createElement('span');
            stat.className = 'dp-stat bmd-growth-stat';
            const label = document.createElement('span');
            label.className = 'dp-statlabel';
            label.textContent = 'Wertsteigerung zum EK';
            const value = document.createElement('span');
            value.className = 'dp-statval bmd-growth-total';
            const percentage = document.createElement('span');
            percentage.className = 'dp-statsub bmd-growth-percent';
            stat.append(label, value, percentage);
            stats.appendChild(stat);
        }

        const value = stat.querySelector('.bmd-growth-total');
        const percentage = stat.querySelector('.bmd-growth-percent');
        const buy = parseNumber(wrap.querySelector('#dpSumBuy')?.textContent, true);
        const best = parseNumber(wrap.querySelector('#dpSumBest')?.textContent, true);
        const missingBuy = Number(wrap.querySelector('#dpCntNoPrice')?.textContent || 0);
        const missingOffer = Number(wrap.querySelector('#dpCntNoOffer')?.textContent || 0);
        if (buy === null || buy <= 0 || best === null || missingBuy || missingOffer) {
            value.classList.remove('bmd-positive', 'bmd-negative');
            value.classList.add('bmd-neutral');
            percentage.classList.remove(
                'bmd-positive', 'bmd-negative', 'bmd-performance-percent'
            );
            percentage.classList.add('bmd-neutral');
            value.textContent = '–';
            percentage.textContent = 'nicht vollständig berechenbar';
            return;
        }
        const difference = best - buy;
        value.classList.remove('bmd-positive', 'bmd-negative', 'bmd-neutral');
        value.classList.add(performanceClass(difference));
        value.textContent = signed(difference, 2, ' €');
        const percentageValue = difference / buy * 100;
        percentage.classList.remove('bmd-positive', 'bmd-negative', 'bmd-neutral');
        percentage.classList.add(
            'bmd-performance-percent',
            performanceClass(percentageValue)
        );
        percentage.textContent = signed(percentageValue, 1, ' %');
    }

    let depotObserver = null;
    let depotUpdateScheduled = false;
    function observeDepot() {
        const wrap = document.getElementById('dpWrap');
        if (depotObserver && wrap) {
            depotObserver.observe(wrap, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }
    function scheduleDepotUpdate() {
        if (depotUpdateScheduled) return;
        depotUpdateScheduled = true;
        window.setTimeout(() => {
            depotUpdateScheduled = false;
            depotObserver?.disconnect();
            updateDepotGrowth();
            updateDepotSaleThresholds();
            updateDepotPartsLinks();
            setupDepotDashboardButton();
            observeDepot();
        }, 0);
    }
    function setupDepotGrowth() {
        if (!document.getElementById('dpWrap') || depotObserver) return;
        depotObserver = new MutationObserver(scheduleDepotUpdate);
        scheduleDepotUpdate();
    }

    installStyles();
    setupDetailButton();
    setupDepotGrowth();
    setupDepotDashboardButton();
    window.addEventListener('load', () => {
        setupDetailButton();
        setupDepotGrowth();
        setupDepotDashboardButton();
    }, { once: true });
})();
