import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = projectDir;
const sourceDir = path.join(projectDir, 'src');
const packageJson = JSON.parse(
    await fs.readFile(path.join(projectDir, 'package.json'), 'utf8')
);
const version = packageJson.version;
const rawBaseUrl =
    'https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main';
const manifestUrl = `${rawBaseUrl}/package.json`;

const sourceFiles = [
    ['shared.js', 'shared.js'],
    ['preclean.js', 'preclean.js'],
    ['worker-api-bridge.js', 'worker-api-bridge.js'],
    ['overview-price-badges.js', 'overview-price-badges.js'],
    ['brickmerge-tweaker-v140.js', 'brickmerge-tweaker.js']
];

const copyFileWithRetry = async (source, destination, attempts = 4) => {
    if (path.resolve(source) === path.resolve(destination)) return;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await fs.copyFile(source, destination);
            return;
        } catch (error) {
            lastError = error;
            if (!['ETIMEDOUT', 'EBUSY', 'EIO'].includes(error?.code) ||
                attempt === attempts) throw error;
            await new Promise(resolve => setTimeout(resolve, attempt * 300));
        }
    }
    throw lastError;
};

if (process.argv.includes('--sync')) {
    await fs.mkdir(sourceDir, { recursive: true });
    for (const [extensionName, localName] of sourceFiles) {
        await copyFileWithRetry(
            path.join(extensionDir, extensionName),
            path.join(sourceDir, localName)
        );
    }
}

if (process.argv.includes('--sync-icons')) {
    const extensionIconDir = path.join(extensionDir, 'icons');
    const userscriptIconDir = path.join(projectDir, 'icons');
    await fs.mkdir(userscriptIconDir, { recursive: true });
    const iconEntries = await fs.readdir(extensionIconDir, {
        withFileTypes: true
    });
    for (const entry of iconEntries.filter(item => item.isFile())) {
        await copyFileWithRetry(
            path.join(extensionIconDir, entry.name),
            path.join(userscriptIconDir, entry.name)
        );
    }
}

const mainMetadata = `// ==UserScript==
// @name         Brickmerge Tweaker
// @namespace    https://brickmerge.de/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=brickmerge.de
// @version      ${version}
// @description  Brickmerge Tools für Desktop und Mobilgeräte mit gemeinsamem Marktplatz-Cache.
// @match        https://www.brickmerge.de/*
// @match        https://brickmerge.de/*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.registerMenuCommand
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      getdata.andreas-9b7.workers.dev
// @connect      ebay-price-api.andreas-9b7.workers.dev
// @connect      brickmerge-toolkit-api.andreas-9b7.workers.dev
// @connect      www.bricklink.com
// @connect      bricklink.com
// @connect      www.brickowl.com
// @connect      brickowl.com
// @connect      *.brickowl.com
// @connect      www.rebrickable.com
// @connect      rebrickable.com
// @connect      brickbank.app
// @connect      duckduckgo.com
// @run-at       document-start
// @noframes
// @updateURL    ${rawBaseUrl}/brickmerge-tweaks.js
// @downloadURL  ${rawBaseUrl}/brickmerge-tweaks.js
// ==/UserScript==`;

const metaGptMetadata = `// ==UserScript==
// @name         Brickmerge Meta-GPT Bridge
// @namespace    https://brickmerge.de/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @version      ${version}
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
// @updateURL    ${rawBaseUrl}/brickmerge-meta-gpt.user.js
// @downloadURL  ${rawBaseUrl}/brickmerge-meta-gpt.user.js
// ==/UserScript==`;

const createRemoteLoader = ({ cacheKey, runtimeUrl, label }) => `(() => {
    'use strict';

    const CACHE_KEY = ${JSON.stringify(cacheKey)};
    const MANIFEST_URL = ${JSON.stringify(manifestUrl)};
    const RUNTIME_URL = ${JSON.stringify(runtimeUrl)};
    const LABEL = ${JSON.stringify(label)};

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
        return source + '\\n//# sourceURL=' + RUNTIME_URL;
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
            if (!/^\\d+\\.\\d+\\.\\d+(?:[-+].+)?$/.test(latestVersion)) {
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
})();`;

const readSource = async name => fs.readFile(path.join(sourceDir, name), 'utf8');
const adaptExtensionSource = source => source.replace(
    /\bchrome\./g,
    'BM_MOBILE_CHROME.'
).replace(/\btypeof chrome\b/g, 'typeof BM_MOBILE_CHROME');
const bootstrap = await readSource('mobile-bootstrap.js');
const shared = await readSource('shared.js');
const preclean = adaptExtensionSource(await readSource('preclean.js'));
const workerBridge = adaptExtensionSource(
    await readSource('worker-api-bridge.js')
);
const runtimeModules = await Promise.all([
    'overview-price-badges.js',
    'brickmerge-tweaker.js'
].map(async name => adaptExtensionSource(await readSource(name))));

const runtime = `(() => {
    'use strict';
    let started = false;
    const startBrickmergeTools = () => {
        if (started) return;
        started = true;
${runtimeModules.map(source => source.split('\n').map(
    line => line ? `        ${line}` : ''
).join('\n')).join('\n\n')}
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startBrickmergeTools, { once: true });
    } else {
        startBrickmergeTools();
    }
})();`;

const normalizeOutput = parts => parts
    .map(part => part.trim())
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n*$/, '\n');

const mainRuntimeFile = 'brickmerge-tweaks.runtime.js';
const metaGptRuntimeFile = 'brickmerge-meta-gpt.runtime.js';
const mainRuntimeOutput = normalizeOutput([
    bootstrap,
    shared,
    preclean,
    workerBridge,
    runtime
]);
const metaGptRuntimeOutput = normalizeOutput([
    await readSource('meta-gpt-bridge.js')
]);
const mainLoaderOutput = normalizeOutput([
    mainMetadata,
    createRemoteLoader({
        cacheKey: 'brickmerge-loader-runtime-v1',
        runtimeUrl: `${rawBaseUrl}/${mainRuntimeFile}`,
        label: 'Brickmerge Loader'
    })
]);
const metaGptLoaderOutput = normalizeOutput([
    metaGptMetadata,
    createRemoteLoader({
        cacheKey: 'brickmerge-meta-gpt-loader-runtime-v1',
        runtimeUrl: `${rawBaseUrl}/${metaGptRuntimeFile}`,
        label: 'Brickmerge Meta-GPT Loader'
    })
]);

await Promise.all([
    fs.writeFile(path.join(projectDir, mainRuntimeFile), mainRuntimeOutput),
    fs.writeFile(path.join(projectDir, metaGptRuntimeFile), metaGptRuntimeOutput),
    fs.writeFile(path.join(projectDir, 'brickmerge-tweaks.js'), mainLoaderOutput),
    fs.writeFile(
        path.join(projectDir, 'brickmerge-meta-gpt.user.js'),
        metaGptLoaderOutput
    )
]);

console.log(
    `Built Brickmerge loaders ${version}: ` +
    `${mainLoaderOutput.length}/${mainRuntimeOutput.length} bytes and ` +
    `${metaGptLoaderOutput.length}/${metaGptRuntimeOutput.length} bytes`
);
