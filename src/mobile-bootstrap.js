(() => {
    'use strict';

    const STORAGE_PREFIX = 'brickmerge-mobile-storage:';
    const ASSET_BASE =
        'https://raw.githubusercontent.com/ysamjo/bm-quick-extension/main/';
    const listeners = new Set();

    const readValue = async (key, fallback) => {
        if (typeof GM_getValue === 'function') {
            return Promise.resolve(GM_getValue(`${STORAGE_PREFIX}${key}`, fallback));
        }
        if (typeof GM?.getValue === 'function') {
            return Promise.resolve(GM.getValue(`${STORAGE_PREFIX}${key}`, fallback));
        }
        return fallback;
    };

    const writeValue = async (key, value) => {
        if (typeof GM_setValue === 'function') {
            await Promise.resolve(GM_setValue(`${STORAGE_PREFIX}${key}`, value));
        } else if (typeof GM?.setValue === 'function') {
            await Promise.resolve(GM.setValue(`${STORAGE_PREFIX}${key}`, value));
        }
    };

    const deleteValue = async key => {
        if (typeof GM_deleteValue === 'function') {
            await Promise.resolve(GM_deleteValue(`${STORAGE_PREFIX}${key}`));
        } else if (typeof GM?.deleteValue === 'function') {
            await Promise.resolve(GM.deleteValue(`${STORAGE_PREFIX}${key}`));
        }
    };

    const normalizeKeys = keys => {
        if (typeof keys === 'string') return { names: [keys], defaults: {} };
        if (Array.isArray(keys)) return { names: keys, defaults: {} };
        if (keys && typeof keys === 'object') {
            return { names: Object.keys(keys), defaults: keys };
        }
        return { names: [], defaults: {} };
    };

    const local = {
        async get(keys) {
            const { names, defaults } = normalizeKeys(keys);
            const entries = await Promise.all(names.map(async key => [
                key,
                await readValue(key, defaults[key])
            ]));
            return Object.fromEntries(entries);
        },
        async set(values) {
            const changes = {};
            for (const [key, newValue] of Object.entries(values || {})) {
                const oldValue = await readValue(key, undefined);
                await writeValue(key, newValue);
                changes[key] = { oldValue, newValue };
            }
            listeners.forEach(listener => listener(changes, 'local'));
        },
        async remove(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            const changes = {};
            for (const key of names.filter(Boolean)) {
                const oldValue = await readValue(key, undefined);
                await deleteValue(key);
                changes[key] = { oldValue, newValue: undefined };
            }
            listeners.forEach(listener => listener(changes, 'local'));
        }
    };

    globalThis.BM_MOBILE_CHROME = {
        storage: {
            local,
            onChanged: {
                addListener(listener) {
                    if (typeof listener === 'function') listeners.add(listener);
                },
                removeListener(listener) {
                    listeners.delete(listener);
                }
            }
        },
        runtime: {
            getURL(path) {
                const cleanPath = String(path || '').replace(/^\/+/, '');
                return `${ASSET_BASE}${cleanPath}`;
            }
        }
    };

    const registerMenu = globalThis.GM_registerMenuCommand ||
        globalThis.GM?.registerMenuCommand;
    if (typeof registerMenu === 'function') {
        registerMenu('Frankreich-Angebote umschalten', async () => {
            const { settings } = await local.get('settings');
            const current = settings || {};
            const enabled = current.linkRows?.france === true;
            await local.set({
                settings: {
                    ...current,
                    linkRows: {
                        ...(current.linkRows || {}),
                        france: !enabled
                    }
                }
            });
            window.location.reload();
        });
    }
})();
