import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
    new URL('../brickmerge-tweaks.js', import.meta.url),
    'utf8'
);

test('mobile userscript metadata keeps automatic GitHub updates', () => {
    assert.match(source, /@version\s+5\.5\.6/);
    assert.match(source, /@run-at\s+document-start/);
    assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com/);
    assert.match(source, /@connect\s+getdata\.andreas-9b7\.workers\.dev/);
    assert.match(source, /@grant\s+unsafeWindow/);
});

test('overview cards read marketplace prices without starting refresh jobs', () => {
    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const loadCard = overviewSource.match(
        /const loadCard = card => limit\(async \(\) => \{[\s\S]*?\n\s*\}\);\n\n\s*const observer/
    )?.[0] || '';

    assert.match(loadCard, /\/offers\/cache/);
    assert.doesNotMatch(loadCard, /refreshBundle|\/offers\/refresh/);
});

test('extension APIs are adapted to the mobile userscript bridge', () => {
    assert.match(source, /globalThis\.BM_MOBILE_CHROME/);
    assert.doesNotMatch(source, /\bchrome\.(?:storage|runtime)/);
    assert.match(source, /brickmerge-mobile-storage:/);
    assert.match(source, /raw\.githubusercontent\.com\/ysamjo\/bm-quick-extension/);
});

test('current extension marketplace and minifigure features are bundled', () => {
    assert.match(source, /https:\/\/getdata\.andreas-9b7\.workers\.dev/);
    assert.match(source, /Weitere Marktplätze abrufen/);
    assert.match(source, /bm-ebay-de-source/);
    assert.match(source, /bm-ebay-fr-source/);
    assert.match(source, /bm-ebay-logo-link/);
    assert.match(
        source,
        /Basis: niedrigster aktueller BrickLink-EU-Neupreis je Figur, ohne Versand/
    );
    for (const sourceName of [
        'kleinanzeigen', 'vinted', 'leboncoin', 'stockx', 'idealo', 'bricklink'
    ]) {
        assert.match(source, new RegExp(sourceName, 'i'));
    }
});

test('France is enabled by default and can be toggled from the script menu', () => {
    assert.match(source, /france:\s*true/);
    assert.match(source, /Frankreich-Angebote umschalten/);
});

test('worker status URLs stay on the configured worker origin', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    assert.equal(
        context.BM_resolveWorkerUrl('/apify/status?job=abc'),
        'https://getdata.andreas-9b7.workers.dev/apify/status?job=abc'
    );
    assert.throws(
        () => context.BM_resolveWorkerUrl('https://example.com/status'),
        /fremden Origin/
    );
});

test('worker client ID is never forwarded to third-party requests', async () => {
    const bridgeSource = fs.readFileSync(
        new URL('../src/worker-api-bridge.js', import.meta.url),
        'utf8'
    );
    const clientId = '12345678-1234-4123-8123-123456789abc';
    const requests = [];
    const originalRequest = details => {
        requests.push(details);
        return { abort() {} };
    };
    const context = vm.createContext({
        URL,
        crypto: { randomUUID: () => clientId },
        GM_xmlhttpRequest: originalRequest,
        GM: { xmlHttpRequest: originalRequest },
        BM_EXTENSION_STORAGE_KEYS: {
            workerBaseUrl: 'worker-url',
            workerClientId: 'worker-client-id'
        },
        BM_WORKER_DEFAULT_BASE_URL:
            'https://getdata.andreas-9b7.workers.dev',
        BM_WORKER_PREVIOUS_BASE_URL:
            'https://brickmerge-toolkit-api.andreas-9b7.workers.dev',
        BM_WORKER_LEGACY_BASE_URL:
            'https://ebay-price-api.andreas-9b7.workers.dev',
        BM_normalizeWorkerBaseUrl: () =>
            'https://getdata.andreas-9b7.workers.dev',
        chrome: {
            storage: {
                local: {
                    get: async () => ({ 'worker-client-id': clientId }),
                    set: async () => {}
                },
                onChanged: { addListener() {} }
            }
        }
    });
    vm.runInContext(bridgeSource, context);

    context.GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://www.brickowl.com/catalog/123',
        headers: { Accept: 'text/html', 'x-bm-client-id': 'leak-me' }
    });
    context.GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://getdata.andreas-9b7.workers.dev/price?ean=12345678',
        headers: { Accept: 'application/json' }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://www.brickowl.com/catalog/123');
    assert.equal(
        Object.keys(requests[0].headers)
            .some(name => name.toLowerCase() === 'x-bm-client-id'),
        false
    );
    assert.equal(requests[1].headers['X-BM-Client-ID'], clientId);
});
