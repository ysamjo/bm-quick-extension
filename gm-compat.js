(() => {
    'use strict';

    const storageKey = key => `gm:${key}`;

    globalThis.GM_getValue = async (key, fallback = null) => {
        const result = await chrome.storage.local.get(storageKey(key));
        const value = result[storageKey(key)];
        return value === undefined ? fallback : value;
    };

    globalThis.GM_setValue = async (key, value) => {
        await chrome.storage.local.set({ [storageKey(key)]: value });
    };

    globalThis.GM_deleteValue = async key => {
        await chrome.storage.local.remove(storageKey(key));
    };

    globalThis.GM_setClipboard = text => {
        const value = String(text ?? '');
        if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(value).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
                document.documentElement.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            });
        }
    };

    globalThis.GM_xmlhttpRequest = details => {
        let aborted = false;
        const timeout = Number(details.timeout) || 0;
        let timeoutId = null;

        if (timeout > 0) {
            timeoutId = window.setTimeout(() => {
                aborted = true;
                details.ontimeout?.();
            }, timeout);
        }

        chrome.runtime.sendMessage({
            type: 'bm-fetch-text',
            request: {
                url: details.url,
                method: details.method || 'GET',
                headers: details.headers || {}
            }
        }).then(result => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (aborted) return;
            if (!result?.ok) {
                details.onerror?.(new Error(result?.error || 'Netzwerkfehler'));
                return;
            }
            details.onload?.({
                status: result.status,
                responseText: result.responseText,
                responseHeaders: result.responseHeaders,
                finalUrl: result.finalUrl
            });
        }).catch(error => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (!aborted) details.onerror?.(error);
        });

        return {
            abort() {
                if (aborted) return;
                aborted = true;
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                details.onabort?.();
            }
        };
    };

    globalThis.GM = {
        getValue: globalThis.GM_getValue,
        setValue: globalThis.GM_setValue,
        deleteValue: globalThis.GM_deleteValue,
        xmlHttpRequest: globalThis.GM_xmlhttpRequest
    };
})();
