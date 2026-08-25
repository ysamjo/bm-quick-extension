// ==UserScript==
// @name         Brickmerge Meta-GPT Bridge
// @namespace    https://brickmerge.de/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @version      5.6.11
// @description  Übergibt Brickmerge-Setdaten automatisch an den Meta Preisvergleich GPT.
// @match        https://chatgpt.com/g/g-LZvgtoTB9-meta-preisvergleich-gpt*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// @noframes
// @updateURL    https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-meta-gpt.user.js
// @downloadURL  https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-meta-gpt.user.js
// ==/UserScript==

(() => {
    'use strict';

    const CACHE_KEY = "brickmerge-meta-gpt-loader-runtime-v1";
    const MANIFEST_URL = "https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/package.json";
    const RUNTIME_URL = "https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-meta-gpt.runtime.js";
    const LABEL = "Brickmerge Meta-GPT Loader";

    const readValue = async (key, fallback) => {
        if (typeof GM_getValue === 'function') {
            return Promise.resolve(GM_getValue(key, fallback));
        }
        if (typeof globalThis.GM?.getValue === 'function') {
            return Promise.resolve(globalThis.GM.getValue(key, fallback));
        }
        return fallback;
    };

    const writeValue = async (key, value) => {
        if (typeof GM_setValue === 'function') {
            return Promise.resolve(GM_setValue(key, value));
        }
        if (typeof globalThis.GM?.setValue === 'function') {
            return Promise.resolve(globalThis.GM.setValue(key, value));
        }
    };

    const request = details => new Promise((resolve, reject) => {
        const handler = typeof GM_xmlhttpRequest === 'function'
            ? GM_xmlhttpRequest
            : globalThis.GM?.xmlHttpRequest;
        if (typeof handler !== 'function') {
            reject(new Error('GM_xmlhttpRequest ist nicht verfügbar.'));
            return;
        }
        handler({
            ...details,
            onload: response => {
                if (response.status >= 200 && response.status < 300) {
                    resolve(response.responseText);
                } else {
                    reject(new Error('HTTP ' + response.status));
                }
            },
            onerror: () => reject(new Error('Netzwerkfehler')),
            ontimeout: () => reject(new Error('Zeitüberschreitung'))
        });
    });

    const fetchText = url => {
        const freshUrl = new URL(url);
        freshUrl.searchParams.set('_bm', String(Date.now()));
        return request({
            method: 'GET',
            url: freshUrl.href,
            headers: { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
            timeout: 15000
        });
    };

    const validate = source => {
        if (typeof source !== 'string' || source.length < 100) {
            throw new TypeError('Leere oder unvollständige Runtime.');
        }
        new Function(source);
        return source + '\n//# sourceURL=' + RUNTIME_URL;
    };

    const execute = source => eval(validate(source));

    const start = async () => {
        let cached = null;
        try {
            cached = await readValue(CACHE_KEY, null);
        } catch (error) {
            console.warn('[' + LABEL + '] Cache nicht lesbar:', error);
        }
        const hasCache = typeof cached?.version === 'string' &&
            typeof cached?.source === 'string';
        let cacheValid = false;
        let executed = false;

        if (hasCache) {
            try {
                validate(cached.source);
                cacheValid = true;
                executed = true;
                execute(cached.source);
            } catch (error) {
                console.error('[' + LABEL + '] Runtime-Fehler:', error);
            }
        }

        try {
            const manifest = JSON.parse(await fetchText(MANIFEST_URL));
            const latestVersion = String(manifest?.version || '').trim();
            if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(latestVersion)) {
                throw new TypeError('Ungültige Versionsangabe.');
            }
            if (cacheValid && cached.version === latestVersion) return;

            const source = await fetchText(RUNTIME_URL);
            validate(source);
            try {
                await writeValue(CACHE_KEY, {
                    version: latestVersion,
                    source
                });
            } catch (error) {
                console.warn('[' + LABEL + '] Cache nicht schreibbar:', error);
            }
            if (!executed) execute(source);
        } catch (error) {
            if (!executed) {
                console.error('[' + LABEL + '] Laden fehlgeschlagen:', error);
            } else {
                console.warn('[' + LABEL + '] Updateprüfung fehlgeschlagen:', error);
            }
        }
    };

    void start();
})();
