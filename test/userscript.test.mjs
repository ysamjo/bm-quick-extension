import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const loaderSource = fs.readFileSync(
    new URL('../brickmerge-tweaks.js', import.meta.url),
    'utf8'
);
const source = fs.readFileSync(
    new URL('../brickmerge-tweaks.runtime.js', import.meta.url),
    'utf8'
);
const metaGptLoaderSource = fs.readFileSync(
    new URL('../brickmerge-meta-gpt.user.js', import.meta.url),
    'utf8'
);
const metaGptSource = fs.readFileSync(
    new URL('../brickmerge-meta-gpt.runtime.js', import.meta.url),
    'utf8'
);

test('mobile userscript metadata keeps automatic GitHub updates', () => {
    assert.match(loaderSource, /@version\s+5\.5\.13/);
    assert.match(loaderSource, /@run-at\s+document-start/);
    assert.match(
        loaderSource,
        /@updateURL\s+https:\/\/raw\.githubusercontent\.com/
    );
    assert.match(
        loaderSource,
        /@connect\s+getdata\.andreas-9b7\.workers\.dev/
    );
    assert.match(loaderSource, /@connect\s+raw\.githubusercontent\.com/);
    assert.match(loaderSource, /@grant\s+unsafeWindow/);
});

test('loaders use a validated GitHub runtime with a local fallback', () => {
    for (const loader of [loaderSource, metaGptLoaderSource]) {
        assert.match(loader, /\/package\.json/);
        assert.match(loader, /GM_xmlhttpRequest/);
        assert.match(loader, /new Function/);
        assert.match(loader, /Cache-Control': 'no-cache/);
        assert.match(loader, /await writeValue\(CACHE_KEY/);
        assert.match(loader, /if \(hasCache\)/);
    }
    assert.match(loaderSource, /brickmerge-tweaks\.runtime\.js/);
    assert.match(
        metaGptLoaderSource,
        /brickmerge-meta-gpt\.runtime\.js/
    );
    assert.doesNotMatch(source, /==UserScript==/);
    assert.doesNotMatch(metaGptSource, /==UserScript==/);
});

test('loader executes its cached runtime without downloading it again', async () => {
    const requests = [];
    const cachedRuntime = `globalThis.BM_LOADER_TEST =
        (globalThis.BM_LOADER_TEST || 0) + 1;${' '.repeat(120)}`;
    const context = vm.createContext({
        URL,
        GM_getValue: async () => ({
            version: '5.5.11',
            source: cachedRuntime
        }),
        GM_setValue: async () => assert.fail('cache rewrite not expected'),
        GM_xmlhttpRequest(details) {
            requests.push(new URL(details.url).pathname);
            details.onload({
                status: 200,
                responseText: JSON.stringify({ version: '5.5.11' })
            });
        },
        console: { error() {}, warn() {} }
    });

    vm.runInContext(loaderSource, context);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(context.BM_LOADER_TEST, 1);
    assert.deepEqual(requests, [
        '/ysamjo/bm-quick-extension/refs/heads/main/package.json'
    ]);
});

test('main userscript runs only on Brickmerge', () => {
    assert.doesNotMatch(loaderSource, /@match\s+https:\/\/chatgpt\.com/);
    assert.doesNotMatch(source, /runMetaGptTransfer/);
    assert.doesNotMatch(source, /brickmerge-meta-gpt-pending/);
});

test('Meta-GPT bridge is a separate GitHub-backed userscript', () => {
    assert.match(
        metaGptLoaderSource,
        /@name\s+Brickmerge Meta-GPT Bridge/
    );
    assert.match(metaGptLoaderSource, /@version\s+5\.5\.13/);
    assert.match(
        metaGptLoaderSource,
        /@match\s+https:\/\/chatgpt\.com\/g\/g-LZvgtoTB9-meta-preisvergleich-gpt\*/
    );
    assert.match(
        metaGptLoaderSource,
        /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/ysamjo\/bm-quick-extension\/refs\/heads\/main\/brickmerge-meta-gpt\.user\.js/
    );
    assert.doesNotMatch(
        metaGptLoaderSource,
        /@match\s+https:\/\/(?:www\.)?brickmerge\.de/
    );
    assert.doesNotMatch(
        metaGptSource,
        /GM_(?:get|set|delete)Value|chrome\.storage/
    );
});

test('Brickmerge builds a self-contained Meta-GPT transfer URL', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL, URLSearchParams });
    vm.runInContext(sharedSource, context);
    const transfer = {
        id: 'transfer-123',
        prompt: 'Prüfe Set 75313.',
        createdAt: 123456789
    };
    const transferUrl = new URL(
        context.BM_buildMetaGptTransferUrl(transfer)
    );
    const serialized = new URLSearchParams(
        transferUrl.hash.replace(/^#/, '')
    ).get('bm-meta-transfer');

    assert.equal(transferUrl.origin, 'https://chatgpt.com');
    assert.equal(
        transferUrl.pathname,
        '/g/g-LZvgtoTB9-meta-preisvergleich-gpt'
    );
    assert.deepEqual(JSON.parse(serialized), transfer);
});

test('Meta-GPT bridge accepts only fresh, bounded transfers', () => {
    const bridgeSource = fs.readFileSync(
        new URL('../src/meta-gpt-bridge.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URLSearchParams });
    vm.runInContext(bridgeSource, context);
    const now = 1_800_000;
    const toHash = transfer => `#bm-meta-transfer=${encodeURIComponent(
        JSON.stringify(transfer)
    )}`;
    const valid = {
        id: 'abc',
        prompt: 'Set 75313 prüfen',
        createdAt: now - 1000
    };

    assert.deepEqual(
        { ...context.BM_META_GPT_BRIDGE_CORE.parseTransfer(toHash(valid), now) },
        valid
    );
    assert.equal(
        context.BM_META_GPT_BRIDGE_CORE.parseTransfer(toHash({
            ...valid,
            createdAt: now - (11 * 60 * 1000)
        }), now),
        null
    );
    assert.equal(
        context.BM_META_GPT_BRIDGE_CORE.parseTransfer(toHash({
            ...valid,
            prompt: 'x'.repeat(5001)
        }), now),
        null
    );
    assert.equal(
        context.BM_META_GPT_BRIDGE_CORE.parseTransfer(
            '#bm-meta-transfer=not-json',
            now
        ),
        null
    );
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

test('search result pages skip the marketplace overview module', () => {
    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(overviewSource, context);

    assert.equal(
        context.BM_OVERVIEW_PRICE_CORE.isSearchPage(
            'https://www.brickmerge.de/?find=75313'
        ),
        true
    );
    assert.equal(
        context.BM_OVERVIEW_PRICE_CORE.isSearchPage(
            'https://www.brickmerge.de/LEGO-Star-Wars/'
        ),
        false
    );
    assert.match(
        overviewSource,
        /if \(isSearchPage\(location\.href\)\) return;/
    );
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

test('minifigure crosswalk assigns similar variants globally by character identity', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    const crosswalk = context.BM_buildMinifigCrosswalk([
        {
            set_num: 'fig-014338',
            set_name: 'Bogrod',
            quantity: 1
        },
        {
            set_num: 'fig-014349',
            set_name:
                'Griphook - Dark Bluish Grey Hair, Black Torso, White Arms, Black Legs',
            quantity: 1
        },
        {
            set_num: 'fig-014337',
            set_name: 'Harry Potter, Dark Blue Jacket, Sand Blue Legs',
            quantity: 1
        },
        {
            set_num: 'fig-014341',
            set_name:
                'Harry Potter, Sand Blue Shirt, Short Dark Tan Legs, Excited',
            quantity: 1
        }
    ], [
        {
            itemNo: 'hp455',
            name: 'Bogrod - Dark Bluish Gray Pinstripe Suit',
            quantity: 1
        },
        {
            itemNo: 'hp445',
            name: 'Griphook Goblin - Black Pinstripe Vest',
            quantity: 1
        },
        {
            itemNo: 'hp443',
            name: 'Harry Potter - Dark Blue Hoodie, Sand Blue Legs',
            quantity: 1
        },
        {
            itemNo: 'hp449',
            name:
                'Harry Potter - Sand Blue Jacket, Dark Tan Short Legs, Broken Glasses',
            quantity: 1
        }
    ]);

    assert.equal(crosswalk.get('fig-014338'), 'hp455');
    assert.equal(crosswalk.get('fig-014349'), 'hp445');
    assert.equal(crosswalk.get('fig-014337'), 'hp443');
    assert.equal(crosswalk.get('fig-014341'), 'hp449');
    assert.equal(new Set(crosswalk.values()).size, 4);
});

test('eBay offers below half the Brickmerge price are rejected', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    assert.equal(
        context.BM_isMarketplacePricePlausible('ebay', 49.99, 100),
        false
    );
    assert.equal(
        context.BM_isMarketplacePricePlausible('ebay-fr', 49.99, 100),
        false
    );
    assert.equal(
        context.BM_isMarketplacePricePlausible('ebay', 50, 100),
        true
    );
    const selected = context.BM_selectPlausibleMarketplaceOffer(
        'ebay',
        {
            found: true,
            cheapest: { total: 3.39, url: 'https://www.ebay.de/itm/too-cheap' },
            offers: [
                { total: 499.99, url: 'https://www.ebay.de/itm/second' },
                { total: 486.35, url: 'https://www.ebay.de/itm/lowest-plausible' }
            ]
        },
        420.17
    );
    assert.equal(selected.total, 486.35);
    assert.equal(selected.url, 'https://www.ebay.de/itm/lowest-plausible');
    assert.match(
        source,
        /BM_selectPlausibleMarketplaceOffer\(\s*'ebay',[\s\S]*?getEbayOfferTotal/
    );
    assert.match(
        source,
        /BM_selectPlausibleMarketplaceOffer\(\s*'ebay-fr',[\s\S]*?getEbayOfferTotal/
    );
    assert.match(source, /ebay-worker-complete-set-v5/);
    assert.match(source, /ebay-fr-worker-complete-set-v3/);
    assert.match(source, /&best=\$\{encodeURIComponent\(ebayReferenceCachePart\)\}/);
});

test('mobile offer rows grow when price details wrap', () => {
    const tweakerSource = fs.readFileSync(
        new URL('../src/brickmerge-tweaker.js', import.meta.url),
        'utf8'
    );
    const mobileOfferStyles = tweakerSource.match(
        /@media screen and \(max-width: 640px\) \{[\s\S]*?#offerlist \.row\.collapse\.bm-marketplace-offer\.bm-effective-row[\s\S]*?\n\s*\}/
    )?.[0] || '';

    assert.match(mobileOfferStyles, /height:\s*auto !important/);
    assert.match(mobileOfferStyles, /min-height:\s*54px(?: !important)?/);
    assert.match(mobileOfferStyles, /display:\s*flex !important/);
    assert.match(mobileOfferStyles, /align-items:\s*center/);
    assert.match(mobileOfferStyles, /align-self:\s*center/);
    assert.doesNotMatch(
        mobileOfferStyles,
        /^\s*height:\s*(?:54|64)px !important/m
    );
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
