(() => {
    'use strict';

    const originalRequest = globalThis.GM_xmlhttpRequest;
    if (typeof originalRequest !== 'function') return;

    const storageKeys = globalThis.BM_EXTENSION_STORAGE_KEYS;
    const knownWorkerHosts = new Set([
        new URL(globalThis.BM_WORKER_DEFAULT_BASE_URL).hostname,
        new URL(globalThis.BM_WORKER_PREVIOUS_BASE_URL).hostname,
        new URL(globalThis.BM_WORKER_LEGACY_BASE_URL).hostname
    ]);
    let configPromise = null;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (Object.keys(changes).some(key => Object.values(storageKeys).includes(key))) {
            configPromise = null;
        }
    });

    async function getConfig() {
        if (configPromise) return configPromise;
        configPromise = (async () => {
            const values = await chrome.storage.local.get(Object.values(storageKeys));
            let clientId = String(values[storageKeys.workerClientId] || '').trim();
            if (!/^[a-f0-9-]{36}$/i.test(clientId)) {
                clientId = crypto.randomUUID();
                await chrome.storage.local.set({ [storageKeys.workerClientId]: clientId });
            }
            return {
                baseUrl: BM_normalizeWorkerBaseUrl(values[storageKeys.workerBaseUrl]),
                clientId
            };
        })().catch(error => {
            configPromise = null;
            throw error;
        });
        return configPromise;
    }

    function makeWorkerUrl(baseUrl, path, parameters = {}) {
        const url = new URL(path, `${baseUrl}/`);
        Object.entries(parameters).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });
        return url.href;
    }

    function rewriteTarget(rawUrl, config) {
        const source = new URL(rawUrl);

        if (knownWorkerHosts.has(source.hostname)) {
            return {
                url: new URL(`${source.pathname}${source.search}`, `${config.baseUrl}/`).href,
                provider: source.pathname === '/kleinanzeigen' ? 'kleinanzeigen' : 'worker'
            };
        }

        if (source.hostname === 'brickbank.app' &&
            source.pathname === '/public/ajax/search/') {
            const set = source.searchParams.get('s')?.match(/^(\d{3,7})-\d+$/)?.[1];
            if (set) {
                return {
                    url: makeWorkerUrl(config.baseUrl, '/proxy/brickbank', { set }),
                    provider: 'brickbank'
                };
            }
        }

        if (source.hostname === 'www.bricklink.com' ||
            source.hostname === 'bricklink.com') {
            if (source.pathname === '/v2/catalog/catalogitem.page') {
                const type = source.searchParams.has('M') ? 'M' : 'S';
                const item = source.searchParams.get(type);
                if (item) {
                    return {
                        url: makeWorkerUrl(config.baseUrl, '/proxy/bricklink/catalog', {
                            type,
                            item
                        }),
                        provider: 'bricklink'
                    };
                }
            }
            if (source.pathname === '/ajax/clone/catalogifs.ajax') {
                return {
                    url: makeWorkerUrl(config.baseUrl, '/proxy/bricklink/offers', {
                        itemid: source.searchParams.get('itemid'),
                        region: source.searchParams.get('reg') === '-1'
                            ? 'EU'
                            : 'DE'
                    }),
                    provider: 'bricklink'
                };
            }
            if (source.pathname === '/ajax/clone/catalogpg.ajax') {
                return {
                    url: makeWorkerUrl(config.baseUrl, '/proxy/bricklink/price-guide', {
                        itemType: source.searchParams.get('itemType') || 'M',
                        itemNo: source.searchParams.get('itemNo')
                    }),
                    provider: 'bricklink'
                };
            }
            if (source.pathname === '/v2/catalog/catalogitem_invtab.page') {
                return {
                    url: makeWorkerUrl(config.baseUrl, '/proxy/bricklink/inventory', {
                        itemid: source.searchParams.get('idItem'),
                        item: source.searchParams.get('itemNoSeq')
                    }),
                    provider: 'bricklink'
                };
            }
            if (source.pathname.toLowerCase() === '/catalogiteminv.asp') {
                return {
                    url: makeWorkerUrl(config.baseUrl, '/proxy/bricklink/legacy-inventory', {
                        set: source.searchParams.get('S')
                    }),
                    provider: 'bricklink'
                };
            }
        }

        if (source.hostname === 'www.brickowl.com' || source.hostname === 'brickowl.com') {
            return { url: source.href, provider: 'brickowl-direct' };
        }

        if (source.hostname === 'rebrickable.com' ||
            source.hostname === 'www.rebrickable.com') {
            const setMatch = source.pathname.match(
                /^\/api\/v3\/lego\/sets\/([^/]+)\/minifigs\/?$/i
            );
            if (setMatch) {
                return {
                    url: makeWorkerUrl(
                        config.baseUrl,
                        '/proxy/rebrickable/set-minifigs',
                        { set: decodeURIComponent(setMatch[1]) }
                    ),
                    provider: 'rebrickable'
                };
            }
        }

        return { url: source.href, provider: '' };
    }

    function getResponseHeader(headers, name) {
        const target = String(name).toLowerCase();
        for (const line of String(headers || '').split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator < 0) continue;
            if (line.slice(0, separator).trim().toLowerCase() === target) {
                return line.slice(separator + 1).trim();
            }
        }
        return '';
    }

    function bridgedRequest(details) {
        let aborted = false;
        let activeRequest = null;

        void getConfig().then(config => {
            if (aborted) return;
            const rewritten = rewriteTarget(details.url, config);
            const headers = { ...(details.headers || {}) };
            Object.keys(headers).forEach(name => {
                if (name.toLowerCase() === 'x-bm-client-id') delete headers[name];
            });
            if (new URL(rewritten.url).origin === new URL(config.baseUrl).origin) {
                headers['X-BM-Client-ID'] = config.clientId;
            }

            if (rewritten.provider === 'rebrickable') {
                delete headers.Authorization;
                delete headers.authorization;
            }

            const originalOnload = details.onload;
            activeRequest = originalRequest({
                ...details,
                url: rewritten.url,
                headers,
                onload(response) {
                    const upstreamUrl = getResponseHeader(
                        response.responseHeaders,
                        'x-bm-upstream-url'
                    );
                    originalOnload?.({
                        ...response,
                        finalUrl: upstreamUrl || response.finalUrl
                    });
                }
            });
        }).catch(error => {
            if (!aborted) details.onerror?.(error);
        });

        return {
            abort() {
                if (aborted) return;
                aborted = true;
                activeRequest?.abort?.();
            }
        };
    }

    globalThis.GM_xmlhttpRequest = bridgedRequest;
    if (globalThis.GM) {
        globalThis.GM.xmlHttpRequest = bridgedRequest;
        globalThis.GM.xmlhttpRequest = bridgedRequest;
    }
})();
