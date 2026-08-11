import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(projectDir, '../brickmerge-extension-db');
const sourceDir = path.join(projectDir, 'src');
const packageJson = JSON.parse(
    await fs.readFile(path.join(projectDir, 'package.json'), 'utf8')
);
const version = packageJson.version;

const sourceFiles = [
    ['shared.js', 'shared.js'],
    ['preclean.js', 'preclean.js'],
    ['worker-api-bridge.js', 'worker-api-bridge.js'],
    ['overview-price-badges.js', 'overview-price-badges.js'],
    ['brickmerge-tweaker-v140.js', 'brickmerge-tweaker.js'],
    ['meta-gpt-bridge.js', 'meta-gpt-bridge.js']
];

if (process.argv.includes('--sync')) {
    await fs.mkdir(sourceDir, { recursive: true });
    for (const [extensionName, localName] of sourceFiles) {
        await fs.copyFile(
            path.join(extensionDir, extensionName),
            path.join(sourceDir, localName)
        );
    }
    await fs.rm(path.join(projectDir, 'icons'), { recursive: true, force: true });
    await fs.cp(
        path.join(extensionDir, 'icons'),
        path.join(projectDir, 'icons'),
        { recursive: true }
    );
}

const metadata = `// ==UserScript==
// @name         Brickmerge Tweaker
// @namespace    https://brickmerge.de/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=brickmerge.de
// @version      ${version}
// @description  Brickmerge Tools für Desktop und Mobilgeräte mit gemeinsamem Marktplatz-Cache.
// @match        https://www.brickmerge.de/*
// @match        https://brickmerge.de/*
// @match        https://chatgpt.com/g/g-LZvgtoTB9-meta-preisvergleich-gpt*
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
// @updateURL    https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
// @downloadURL  https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
// ==/UserScript==`;

const readSource = async name => fs.readFile(path.join(sourceDir, name), 'utf8');
const adaptExtensionSource = source => source.replace(/\bchrome\./g, 'BM_MOBILE_CHROME.');
const bootstrap = await readSource('mobile-bootstrap.js');
const shared = await readSource('shared.js');
const preclean = adaptExtensionSource(await readSource('preclean.js'));
const workerBridge = adaptExtensionSource(
    await readSource('worker-api-bridge.js')
);
const runtimeModules = await Promise.all([
    'overview-price-badges.js',
    'brickmerge-tweaker.js',
    'meta-gpt-bridge.js'
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

const output = [
    metadata,
    bootstrap.trim(),
    shared.trim(),
    preclean.trim(),
    workerBridge.trim(),
    runtime.trim(),
].join('\n\n').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n');

await fs.writeFile(path.join(projectDir, 'brickmerge-tweaks.js'), output);
console.log(`Built Brickmerge Tweaker ${version} (${output.length} bytes)`);
