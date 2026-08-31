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

test('manifest registers badge detection and modifies the embedded page', () => {
    const manifest = JSON.parse(fs.readFileSync(
        new URL('../manifest.json', import.meta.url),
        'utf8'
    ));
    assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
    assert.equal(manifest.permissions.includes('sidePanel'), true);
    assert.equal(manifest.permissions.includes('scripting'), false);
    assert.equal(manifest.content_scripts.some(entry =>
        entry.js?.includes('page-product-detector.js')
    ), true);
    const brickmergeScripts = manifest.content_scripts.filter(entry =>
        entry.matches?.includes('https://www.brickmerge.de/*') &&
        !entry.js?.includes('page-product-detector.js')
    );
    assert.equal(brickmergeScripts.every(entry => entry.all_frames === true), true);
});

test('side panel embeds the responsive Brickmerge page', () => {
    const html = fs.readFileSync(
        new URL('../sidepanel/sidepanel.html', import.meta.url),
        'utf8'
    );
    const source = fs.readFileSync(
        new URL('../sidepanel/sidepanel.js', import.meta.url),
        'utf8'
    );
    const styles = fs.readFileSync(
        new URL('../sidepanel/sidepanel.css', import.meta.url),
        'utf8'
    );
    const brickmergeFont = fs.readFileSync(
        new URL('../fonts/open-sans-v18-latin-regular.woff2', import.meta.url)
    );
    assert.match(html, /id="brickmerge-frame"/);
    assert.match(html, /id="panel-search-form"/);
    assert.doesNotMatch(html, /class="app-header"/);
    assert.doesNotMatch(html, /sidepanel-core\.js/);
    assert.match(source, /chrome\.tabs\.sendMessage/);
    assert.match(source, /www\.brickmerge\.de/);
    assert.match(source, /panel-query/);
    assert.doesNotMatch(source, /chrome\.tabs\.onActivated\.addListener/);
    assert.match(
        source,
        /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo, tab\)/
    );
    assert.match(source, /changeInfo\.status !== 'complete' \|\| !tab\?\.active/);
    assert.match(source, /lastCompletedTabUrl/);
    assert.match(source, /currentUrl !== nextUrl/);
    assert.match(source, /newly navigated page is still wiring up/);
    assert.match(source, /loadActiveTab\(tabId\)/);
    assert.doesNotMatch(source, /pageHost|id=["']rescan["']/);
    assert.match(styles, /@font-face[\s\S]*?font-family: "Open Sans"/);
    assert.match(styles, /open-sans-v18-latin-regular\.woff2/);
    assert.match(styles, /button, input \{ font: inherit; \}/);
    assert.ok(brickmergeFont.byteLength > 10_000);
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

test('toolbar click opens the side panel only for a detected product', () => {
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
    assert.match(
        background,
        /chrome\.sidePanel\.setPanelBehavior\(\{[\s\S]*?openPanelOnActionClick: true/
    );
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
    let messageListener = null;
    const unusedEvent = { addListener() {} };
    const backgroundContext = vm.createContext({
        URL,
        Headers,
        console: { error() {} },
        importScripts() {},
        BM_mergeSettings(value) { return value || {}; },
        chrome: {
            sidePanel: {
                async setPanelBehavior() {}
            },
            action: {
                async setBadgeText() {},
                async setBadgeBackgroundColor() {},
                async setBadgeTextColor() {},
                async setPopup(options) { popupCalls.push({ ...options }); },
                async setTitle(options) { titleCalls.push({ ...options }); }
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
                onRemoved: unusedEvent
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
    assert.match(popup, /id="query"[^>]*autofocus/);
    assert.match(popup, /placeholder="Setnummer oder Suchbegriff"/);
});
