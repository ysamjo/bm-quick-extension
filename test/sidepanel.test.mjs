import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const detectorSource = fs.readFileSync(
    new URL('../page-product-detector.js', import.meta.url),
    'utf8'
);
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(detectorSource, context);
const detector = context.module.exports;

const productDocument = product => ({
    title: product.title || product.name || '',
    body: { innerText: product.body || '' },
    querySelector(selector) {
        if (
            ['#productTitle', '#title', 'h1#title'].includes(selector) &&
            product.productTitle
        ) {
            return { textContent: product.productTitle };
        }
        if (selector === 'h1' && product.h1) return { textContent: product.h1 };
        return null;
    },
    querySelectorAll(selector) {
        if (selector === 'script[type="application/ld+json"]') {
            return [{ textContent: JSON.stringify(product) }];
        }
        return [];
    }
});

test('page detector validates LEGO GTIN-13 values', () => {
    assert.equal(detector.validGtin13('5702017424965'), true);
    assert.equal(detector.validGtin13('5702017424964'), false);
});

test('page detector reads a LEGO Product JSON-LD object', () => {
    const product = detector.detect(productDocument({
        '@type': 'Product',
        name: 'LEGO Technic 42154 Ford GT 2022',
        brand: { name: 'LEGO' },
        mpn: '42154',
        gtin13: '5702017424965'
    }), new URL('https://shop.example/lego-ford-gt'));
    assert.equal(product.setNumber, '42154');
    assert.equal(product.ean, '5702017424965');
});

test('numeric merchant SKU is not mistaken for a LEGO set', () => {
    const product = detector.detect(productDocument({
        '@type': 'Product',
        name: 'Coffee machine',
        brand: { name: 'Example' },
        mpn: '42154'
    }), new URL('https://shop.example/coffee-machine?q=42154'));
    assert.equal(product, null);
});

test('page detector accepts LEGO plus a five-digit number in URL, title, or h1', () => {
    for (const source of [
        { url: 'https://shop.example/lego/31168', title: 'Product page' },
        { url: 'https://shop.example/product', title: 'LEGO 31168 kaufen' },
        { url: 'https://shop.example/product', title: 'Produkt', h1: 'LEGO Set 31168' }
    ]) {
        const product = detector.detect(productDocument(source), new URL(source.url));
        assert.equal(product?.setNumber, '31168');
    }
});

test('five-digit number without LEGO context is not detected', () => {
    const product = detector.detect(productDocument({
        title: 'Klemmbausteine 31168',
        h1: 'Bausatz 31168'
    }), new URL('https://shop.example/product/31168'));
    assert.equal(product, null);
});

test('Amazon marketplaces detect the set from the product title', () => {
    for (const marketplace of ['es', 'it', 'de', 'fr', 'co.uk']) {
        const product = detector.detect(productDocument({
            title: `LEGO Architecture London 21034 : Amazon.${marketplace}`,
            productTitle: 'LEGO Architecture London 21034',
            h1: 'Product summary presents key product information'
        }), new URL(
            `https://www.amazon.${marketplace}/dp/B01J41MPF8?language=en_GB`
        ));
        assert.equal(product?.setNumber, '21034', marketplace);
        assert.equal(product?.hostname, `www.amazon.${marketplace}`);
    }
});

test('manifest registers badge detection and the floating sidebar', () => {
    const manifest = JSON.parse(fs.readFileSync(
        new URL('../manifest.json', import.meta.url),
        'utf8'
    ));
    assert.equal(manifest.side_panel, undefined);
    assert.equal(manifest.permissions.includes('sidePanel'), false);
    assert.equal(manifest.permissions.includes('scripting'), false);
    assert.equal(manifest.content_scripts.some(entry =>
        entry.js?.includes('page-product-detector.js') &&
        entry.js?.includes('page-overlay.js')
    ), true);
    const brickmergeScripts = manifest.content_scripts.filter(entry =>
        entry.matches?.includes('https://www.brickmerge.de/*') &&
        !entry.js?.includes('page-product-detector.js')
    );
    assert.equal(brickmergeScripts.every(entry => entry.all_frames === true), true);
});

test('floating sidebar embeds Brickmerge without blocking the merchant page', () => {
    const source = fs.readFileSync(
        new URL('../page-overlay.js', import.meta.url),
        'utf8'
    );
    const rules = JSON.parse(fs.readFileSync(
        new URL('../rules/brickmerge-overlay.json', import.meta.url),
        'utf8'
    ));
    assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/);
    assert.match(source, /<iframe title="Brickmerge Setdetails">/);
    assert.match(source, /type !== 'bm-show-floating-sidebar'/);
    assert.match(source, /www\.brickmerge\.de/);
    assert.match(source, /event\.key !== 'Escape'/);
    assert.match(source, /width: min\(460px, calc\(100vw - 24px\)\)/);
    assert.match(source, /pointerEvents: 'none'/);
    assert.match(source, /<aside class="panel"/);
    assert.doesNotMatch(source, /class="backdrop"|aria-modal="true"/);
    assert.equal(rules[0].action.type, 'modifyHeaders');
    assert.deepEqual(rules[0].action.responseHeaders, [{
        header: 'x-frame-options',
        operation: 'remove'
    }]);
    assert.deepEqual(rules[0].condition.resourceTypes, ['sub_frame']);
    assert.deepEqual(
        rules[0].condition.requestDomains,
        ['brickmerge.de', 'www.brickmerge.de']
    );
});

test('embedded Brickmerge header is hidden only in the side panel frame', () => {
    const source = fs.readFileSync(
        new URL('../preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(source, /bm-sidepanel-frame/);
    assert.match(source, /#filterrow/);
    assert.match(source, /\.top-tab/);
    assert.match(source, /BreadcrumbList/);
    assert.match(source, /font-size:\s*100%/);
    assert.doesNotMatch(source, /width:\s*125%|zoom:\s*0\.8|font-size:\s*80%/);
    assert.match(source, /overflow-x:\s*hidden/);
    assert.match(source, /\.content\.setdetails h1/);
});

test('toolbar click opens the floating sidebar only for a detected product', () => {
    const background = fs.readFileSync(
        new URL('../background.js', import.meta.url),
        'utf8'
    );
    const popup = fs.readFileSync(
        new URL('../popup/popup.html', import.meta.url),
        'utf8'
    );
    assert.match(background, /chrome\.action\.setPopup\(\{ tabId, popup: '' \}\)/);
    assert.match(background, /function isBrickmergePage\(product\)/);
    assert.match(background, /text: onBrickmergePage \? '' : '✓'/);
    assert.match(background, /chrome\.action\.onClicked\.addListener/);
    assert.match(background, /type: 'bm-show-floating-sidebar'/);
    assert.doesNotMatch(background, /chrome\.sidePanel/);
    assert.match(
        background,
        /chrome\.action\.setPopup\(\{ tabId, popup: DEFAULT_POPUP \}\)/
    );
    assert.match(popup, /id="search-form"/);
    assert.match(popup, /id="open-options"/);
    assert.doesNotMatch(popup, /id="open-sidepanel"/);
});

test('toolbar search popup is activated when no LEGO set is detected', async () => {
    const background = fs.readFileSync(
        new URL('../background.js', import.meta.url),
        'utf8'
    );
    const popup = fs.readFileSync(
        new URL('../popup/popup.html', import.meta.url),
        'utf8'
    );
    const popupCalls = [];
    const titleCalls = [];
    const panelMessages = [];
    let messageListener = null;
    let actionClickListener = null;
    const unusedEvent = { addListener() {} };
    const backgroundContext = vm.createContext({
        URL,
        Headers,
        console: { error() {} },
        importScripts() {},
        BM_mergeSettings(value) { return value || {}; },
        chrome: {
            action: {
                async setBadgeText() {},
                async setBadgeBackgroundColor() {},
                async setBadgeTextColor() {},
                async setPopup(options) { popupCalls.push({ ...options }); },
                async setTitle(options) { titleCalls.push({ ...options }); },
                onClicked: {
                    addListener(listener) { actionClickListener = listener; }
                }
            },
            runtime: {
                onInstalled: unusedEvent,
                onStartup: unusedEvent,
                onMessage: {
                    addListener(listener) { messageListener = listener; }
                }
            },
            storage: {
                local: {
                    async get() { return {}; },
                    async set() {}
                },
                onChanged: unusedEvent
            },
            declarativeNetRequest: {
                async updateEnabledRulesets() {}
            },
            tabs: {
                onUpdated: unusedEvent,
                onRemoved: unusedEvent,
                async sendMessage(tabId, message) {
                    panelMessages.push({ tabId, message: { ...message } });
                    return { ok: true };
                }
            }
        }
    });

    vm.runInContext(background, backgroundContext);
    assert.equal(typeof messageListener, 'function');

    messageListener(
        {
            type: 'bm-page-product-detected',
            product: { setNumber: '42154', ean: '5702017424965' }
        },
        { tab: { id: 42 } },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(popupCalls.at(-1), { tabId: 42, popup: '' });

    messageListener(
        { type: 'bm-page-product-detected', product: null },
        { tab: { id: 42 } },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(popupCalls.at(-1), {
        tabId: 42,
        popup: 'popup/popup.html'
    });
    assert.deepEqual(titleCalls.at(-1), {
        tabId: 42,
        title: 'Brickmerge Tools'
    });

    const panelResponse = await new Promise(resolve => {
        const keepChannelOpen = messageListener(
            {
                type: 'bm-open-floating-sidebar',
                product: { setNumber: '21034' }
            },
            { tab: { id: 42 } },
            resolve
        );
        assert.equal(keepChannelOpen, true);
    });
    assert.deepEqual({ ...panelResponse }, { ok: true });
    assert.deepEqual(panelMessages.at(-1), {
        tabId: 42,
        message: {
            type: 'bm-show-floating-sidebar',
            product: { setNumber: '21034' }
        }
    });
    assert.deepEqual(popupCalls.at(-1), { tabId: 42, popup: '' });

    assert.equal(typeof actionClickListener, 'function');
    actionClickListener({ id: 42 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(panelMessages.at(-1).tabId, 42);

    const selectionPopup = fs.readFileSync(
        new URL('../selection-popup.js', import.meta.url),
        'utf8'
    );
    assert.match(selectionPopup, /let selectedTerm = ''/);
    assert.match(selectionPopup, /url\.searchParams\.set\('btnI', '1'\)/);
    assert.match(selectionPopup, /site:brickmerge\.de \$\{term\}/);
    assert.match(selectionPopup, /class="bubble-link"/);
    assert.match(selectionPopup, /target="_blank"/);
    assert.doesNotMatch(selectionPopup, /bm-fetch-text|bm-open-overlay/);
    assert.match(popup, /id="query"[^>]*autofocus/);
    assert.match(popup, /placeholder="Setnummer oder Suchbegriff"/);
});
