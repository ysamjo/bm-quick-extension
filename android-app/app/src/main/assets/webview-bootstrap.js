(() => {
    'use strict';
    if (globalThis.__bmNativeBridgeReady) return;
    globalThis.__bmNativeBridgeReady = true;

    const pending = new Map();
    let requestSequence = 0;

    const parseStoredValue = (raw, fallback) => {
        if (raw === null || raw === undefined || raw === '') return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
    };

    globalThis.GM_getValue = (key, fallback = null) =>
        parseStoredValue(BrickmergeNative.getValue(String(key)), fallback);

    globalThis.GM_setValue = (key, value) => {
        BrickmergeNative.setValue(String(key), JSON.stringify(value));
    };

    globalThis.GM_deleteValue = key => {
        BrickmergeNative.deleteValue(String(key));
    };

    globalThis.GM_setClipboard = text => {
        BrickmergeNative.copyText(String(text ?? ''));
    };

    globalThis.GM_xmlhttpRequest = details => {
        const id = `bm-${Date.now()}-${++requestSequence}`;
        pending.set(id, details || {});
        BrickmergeNative.request(
            id,
            String(details?.url || ''),
            String(details?.method || 'GET'),
            JSON.stringify(details?.headers || {}),
            details?.data === undefined || details?.data === null
                ? ''
                : String(details.data),
            Number(details?.timeout) || 15000
        );
        return {
            abort() {
                if (!pending.has(id)) return;
                const current = pending.get(id);
                pending.delete(id);
                BrickmergeNative.abortRequest(id);
                current?.onabort?.();
            }
        };
    };

    globalThis.__bmNativeComplete = (id, result) => {
        const details = pending.get(id);
        if (!details) return;
        pending.delete(id);
        if (!result?.ok) {
            details.onerror?.(new Error(result?.error || 'Netzwerkfehler'));
            return;
        }
        details.onload?.({
            status: Number(result.status) || 0,
            responseText: String(result.responseText || ''),
            responseHeaders: String(result.responseHeaders || ''),
            finalUrl: String(result.finalUrl || details.url || '')
        });
    };

    globalThis.GM = {
        getValue: globalThis.GM_getValue,
        setValue: globalThis.GM_setValue,
        deleteValue: globalThis.GM_deleteValue,
        xmlHttpRequest: globalThis.GM_xmlhttpRequest,
        xmlhttpRequest: globalThis.GM_xmlhttpRequest
    };
    globalThis.unsafeWindow = globalThis;
})();
