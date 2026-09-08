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

test('catalog and search URLs like Vinted detect set numbers from search_text and Lego queries', () => {
    const vinted5 = detector.detect(productDocument({
        title: 'Artikel | Vinted',
        h1: 'Artikel'
    }), new URL('https://www.vinted.de/catalog?search_text=lego+60458'));
    assert.equal(vinted5?.setNumber, '60458');
    assert.equal(vinted5?.name, 'LEGO 60458');

    const vinted4 = detector.detect(productDocument({
        title: 'Artikel | Vinted',
        h1: 'Artikel'
    }), new URL('https://www.vinted.de/catalog?search_text=lego+7592'));
    assert.equal(vinted4?.setNumber, '7592');

    const kleinanzeigen = detector.detect(productDocument({
        title: 'Kleinanzeigen'
    }), new URL('https://www.kleinanzeigen.de/s-lego-60458/k0'));
    assert.equal(kleinanzeigen?.setNumber, '60458');

    const amazonReversed = detector.detect(productDocument({
        title: 'Amazon.de'
    }), new URL('https://www.amazon.de/s?k=60458+lego'));
    assert.equal(amazonReversed?.setNumber, '60458');
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
    assert.match(source, /width: min\(400px, calc\(100vw - 24px\)\)/);
    assert.match(source, /pointerEvents: 'none'/);
    assert.match(source, /<aside class="panel"/);
    assert.match(source, /grid-template-columns: auto minmax\(0, 1fr\) auto auto auto/);
    assert.match(source, /class="brand-logo" src="\$\{chrome\.runtime\.getURL\('icons\/icon128\.png'\)\}"/);
    assert.match(source, /aria-label="Brickmerge-Startseite"/);
    assert.match(source, /const navigateHome = \(\) => \{/);
    assert.match(source, /homeButton\.addEventListener\('click'/);
    assert.doesNotMatch(source, /brand-wordmark/);
    assert.match(source, /aria-label="In neuem Tab öffnen"/);
    assert.match(source, /aria-label="Brickmerge-Suche starten"/);
    assert.doesNotMatch(source, /grid-column: 1 \/ -1/);
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
    assert.match(background, /chrome\.action\.setBadgeText\(\{ tabId, text: badgeText \}\)/);
    assert.match(background, /fetchBrickmergeBestPrice/);
    assert.match(background, /chrome\.action\.onClicked\.addListener/);
    assert.match(background, /type: 'bm-show-floating-sidebar'/);
    assert.doesNotMatch(background, /chrome\.sidePanel/);
    assert.match(
        background,
        /chrome\.action\.setPopup\(\{ tabId, popup: hasSelection \? '' : DEFAULT_POPUP \}\)/
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
    const options = fs.readFileSync(
        new URL('../options/options.html', import.meta.url),
        'utf8'
    );
    const popupCalls = [];
    const titleCalls = [];
    const panelMessages = [];
    let currentSelection = '';
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
                    if (message.type === 'bm-get-current-selection') {
                        return { term: currentSelection };
                    }
                    panelMessages.push({
                        tabId,
                        message: {
                            ...message,
                            product: message.product ? { ...message.product } : undefined
                        }
                    });
                    return { ok: true };
                }
            }
        }
    });

    vm.runInContext(background, backgroundContext);
    assert.equal(typeof messageListener, 'function');
    assert.equal(typeof actionClickListener, 'function');

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

    currentSelection = 'LEGO Orchidee 10311';
    messageListener(
        { type: 'bm-page-selection-changed', term: currentSelection },
        { tab: { id: 42 } },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(popupCalls.at(-1), { tabId: 42, popup: '' });

    actionClickListener({ id: 42 });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(panelMessages.at(-1), {
        tabId: 42,
        message: {
            type: 'bm-show-floating-sidebar',
            product: {
                setNumber: 'LEGO Orchidee 10311',
                name: 'LEGO Orchidee 10311'
            }
        }
    });

    currentSelection = '';
    messageListener(
        { type: 'bm-page-selection-changed', term: '' },
        { tab: { id: 42 } },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(popupCalls.at(-1), {
        tabId: 42,
        popup: 'popup/popup.html'
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

    actionClickListener({ id: 42 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(panelMessages.at(-1).tabId, 42);

    const selectionPopup = fs.readFileSync(
        new URL('../selection-popup.js', import.meta.url),
        'utf8'
    );
    assert.match(selectionPopup, /type: 'bm-page-selection-changed'/);
    assert.match(selectionPopup, /type !== 'bm-get-current-selection'/);
    assert.match(selectionPopup, /document\.addEventListener\('selectionchange'/);
    assert.match(selectionPopup, /sendResponse\(\{ term \}\)/);
    assert.doesNotMatch(selectionPopup, /attachShadow|createElement|Google Lucky|bubble/);
    assert.match(options, /<h2>Markierungssuche<\/h2>/);
    assert.match(options, /Zeigt beim Markieren nichts an/);
    assert.match(popup, /id="query"[^>]*autofocus/);
    assert.match(popup, /placeholder="Setnummer oder Suchbegriff"/);
});

test('floating sidebar automatically collapses to the right on outside click', () => {
    const source = fs.readFileSync(
        new URL('../page-overlay.js', import.meta.url),
        'utf8'
    );
    assert.match(source, /outsideHandler = event => \{/);
    assert.match(source, /document\.addEventListener\('pointerdown',\s*outsideHandler,\s*true\)/);
    assert.match(source, /document\.removeEventListener\('pointerdown',\s*outsideHandler,\s*true\)/);
    assert.match(source, /path\.includes\(host\)\s*\|\|\s*event\.target === host/);
    assert.match(source, /setCollapsed\(true\)/);
    assert.match(source, /panel\.classList\.contains\('is-collapsed'\)/);
});

test('best price badge formatting and update action state', async () => {
    const sharedSource = fs.readFileSync(
        new URL('../shared.js', import.meta.url),
        'utf8'
    );
    const sharedContext = vm.createContext({ globalThis: {} });
    vm.runInContext(sharedSource, sharedContext);

    assert.equal(typeof sharedContext.globalThis.BM_formatBadgePrice, 'function');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(79.97), '80€');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(149.99), '150€');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(749.95), '750€');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(1049), '1k');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(1250), '1.3k');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(0), '');
    assert.equal(sharedContext.globalThis.BM_formatBadgePrice(null), '');

    assert.equal(sharedContext.globalThis.BM_parsePrice('79.97'), 79.97);
    assert.equal(sharedContext.globalThis.BM_parsePrice('79,97'), 79.97);
    assert.equal(sharedContext.globalThis.BM_parsePrice('1.250,00'), 1250);

    const backgroundSource = fs.readFileSync(
        new URL('../background.js', import.meta.url),
        'utf8'
    );
    const badgeCalls = [];
    const titleCalls = [];
    let messageListener = null;
    const unusedEvent = { addListener() {} };
    const bgContext = vm.createContext({
        URL,
        Headers,
        console: { error() {} },
        importScripts() {},
        BM_mergeSettings(value) { return value || {}; },
        BM_formatBadgePrice: sharedContext.globalThis.BM_formatBadgePrice,
        BM_parsePrice: sharedContext.globalThis.BM_parsePrice,
        BM_formatEuro: sharedContext.globalThis.BM_formatEuro,
        fetch: async () => ({
            ok: true,
            text: async () => `
                <script type="application/ld+json">
                {
                    "@type": "Product",
                    "offers": {
                        "@type": "AggregateOffer",
                        "lowPrice": "79.97"
                    }
                }
                </script>
            `
        }),
        chrome: {
            action: {
                async setBadgeText(options) { badgeCalls.push({ ...options }); },
                async setBadgeBackgroundColor() {},
                async setBadgeTextColor() {},
                async setPopup() {},
                async setTitle(options) { titleCalls.push({ ...options }); },
                onClicked: { addListener() {} }
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

    vm.runInContext(backgroundSource, bgContext);

    // Simulate product detection
    messageListener({
        type: 'bm-page-product-detected',
        product: { setNumber: '42154', name: 'Ford GT', hostname: 'amazon.de' }
    }, { tab: { id: 101 } }, () => {});

    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(badgeCalls.some(call => call.tabId === 101 && call.text === '✓'));
    assert.ok(badgeCalls.some(call => call.tabId === 101 && call.text === '80€'));
    assert.equal(badgeCalls.at(-1).text, '80€');
    assert.match(titleCalls.at(-1).title, /Bestpreis ab 79,97 €/);
});

test('background onUpdated detects set immediately from URL and supports SPA route updates', async () => {
    const backgroundSource = fs.readFileSync(
        new URL('../background.js', import.meta.url),
        'utf8'
    );
    const badgeCalls = [];
    const popupCalls = [];
    let onUpdatedListener = null;
    const sentTabMessages = [];
    const unusedEvent = { addListener() {} };
    const bgContext = vm.createContext({
        URL,
        Headers,
        console: { error() {} },
        importScripts() {},
        BM_mergeSettings(value) { return value || {}; },
        BM_formatBadgePrice: price => `${Math.round(price)}€`,
        BM_parsePrice: price => Number(price) || null,
        BM_formatEuro: price => String(price),
        fetch: async () => ({
            ok: true,
            text: async () => '{"lowPrice": "19.00"}'
        }),
        chrome: {
            action: {
                async setBadgeText(options) { badgeCalls.push({ ...options }); },
                async setBadgeBackgroundColor() {},
                async setBadgeTextColor() {},
                async setPopup(options) { popupCalls.push({ ...options }); },
                async setTitle() {},
                onClicked: { addListener() {} }
            },
            runtime: {
                onInstalled: unusedEvent,
                onStartup: unusedEvent,
                onMessage: { addListener() {} }
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
                onUpdated: {
                    addListener(listener) { onUpdatedListener = listener; }
                },
                onRemoved: unusedEvent,
                async sendMessage(tabId, msg) {
                    sentTabMessages.push({ tabId, msg });
                    return { ok: true };
                }
            }
        }
    });

    vm.runInContext(backgroundSource, bgContext);
    assert.equal(typeof onUpdatedListener, 'function');

    // Simulate tab loading Vinted URL
    onUpdatedListener(
        202,
        { status: 'loading' },
        { id: 202, url: 'https://www.vinted.de/catalog?search_text=lego+60458' }
    );
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(badgeCalls.some(call => call.tabId === 202 && call.text === '19€' || call.text === '✓'));
    assert.deepEqual(popupCalls.at(-1), { tabId: 202, popup: '' });

    // Simulate SPA URL update on same tab
    onUpdatedListener(
        202,
        { url: 'https://www.vinted.de/catalog?search_text=lego+7592' },
        { id: 202, url: 'https://www.vinted.de/catalog?search_text=lego+7592' }
    );
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(sentTabMessages.some(m => m.tabId === 202 && m.msg?.type === 'bm-detect-page-now'));
});

