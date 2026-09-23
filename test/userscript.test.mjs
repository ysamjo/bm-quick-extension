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
const sharedSource = fs.readFileSync(
    new URL('../shared.js', import.meta.url),
    'utf8'
);
const tweakerSource = fs.readFileSync(
    new URL('../src/brickmerge-tweaker.js', import.meta.url),
    'utf8'
);
const backgroundSource = fs.readFileSync(
    new URL('../background.js', import.meta.url),
    'utf8'
);
const gmCompatSource = fs.readFileSync(
    new URL('../gm-compat.js', import.meta.url),
    'utf8'
);
const precleanSource = fs.readFileSync(
    new URL('../src/preclean.js', import.meta.url),
    'utf8'
);

test('mobile userscript metadata keeps automatic GitHub updates', () => {
    assert.match(loaderSource, /@version\s+\d+\.\d+\.\d+/);
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
    assert.match(metaGptLoaderSource, /@version\s+\d+\.\d+\.\d+/);
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

test('all overview pages leave Brickmerge prices and sorting unchanged', () => {
    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const start = overviewSource.match(
        /const start = settings => \{[\s\S]*?\n\s*\};\n\n\s*chrome\.storage/
    )?.[0] || '';

    assert.match(start, /if \(!detailSet\) return;/);
    assert.doesNotMatch(start, /productrow|CARD_SELECTOR|\/offers\/cache/);
});

test('the detail-only marketplace module also excludes search pages', () => {
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
        /if \(!detailSet\) return;/
    );
});

test('manual marketplace refresh includes Kleinanzeigen and keeps marketplace errors compact', () => {
    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(overviewSource, context);

    const sources = context.BM_OVERVIEW_PRICE_CORE.buttonSources({
        linkRows: { france: false },
        offerShops: {}
    });
    assert.equal(Array.from(sources).includes('kleinanzeigen'), true);
    assert.match(tweakerSource, /bm-kleinanzeigen-error-badge/);
    assert.match(tweakerSource, /bm-idealo-error-badge/);
    assert.match(tweakerSource, /Das kostenlose Idealo-Kontingent von 50 Abfragen ist aufgebraucht/);
    assert.match(tweakerSource, /kann der Apify-Fallback manuell versucht werden/);
    assert.match(
        tweakerSource,
        /applyApifyMarketplaceResult\(\s*'kleinanzeigen',\s*'Kleinanzeigen'/
    );
    assert.doesNotMatch(tweakerSource, /bm-kleinanzeigen-feedback/);
});

test('Google Shopping loads the best SerpApi result directly into the offer list', () => {
    assert.match(sharedSource, /googleShopping:\s*true/);
    assert.match(tweakerSource, /\/google-shopping\?ean=/);
    assert.match(tweakerSource, /btn-google-shopping/);
    assert.match(tweakerSource, /google-shopping-worker/);
    assert.match(tweakerSource, /logo-google-shopping\.png/);
    const resourcesSection = tweakerSource.match(
        /key: 'resources',[\s\S]*?key: 'history'/
    )?.[0] || '';
    assert.match(resourcesSection, /btn-google-shopping/);
    assert.match(tweakerSource, /merchantName:\s*shopName/);
    assert.match(tweakerSource, /offer\.merchantName \|\| offer\.label/);
});

test('resources include a direct Mydealz search for the detected LEGO set', () => {
    assert.match(tweakerSource, /name: "Mydealz"/);
    assert.match(
        tweakerSource,
        /https:\/\/www\.mydealz\.de\/search\?q=\$\{encodeURIComponent\(`Lego "\$\{setNum\}"`\)\}/
    );
});

test('Google Shopping and Klarna offers are deduplicated by merchant and price', () => {
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);
    const offers = context.BM_dedupeMarketplaceOffers([
        {
            key: 'google-shopping',
            merchantName: 'Amazon.de',
            dedupePrice: 99.99,
            url: 'https://amazon.de/dp/example'
        },
        {
            key: 'klarna',
            candidateOffers: [
                {
                    key: 'klarna',
                    merchantName: 'Amazon',
                    dedupePrice: 99.99,
                    url: 'https://klarna.com/de/shopping/product/example'
                },
                {
                    key: 'klarna',
                    merchantName: 'MediaMarkt',
                    dedupePrice: 104.99,
                    url: 'https://klarna.com/de/shopping/product/example'
                }
            ]
        }
    ]);

    assert.equal(offers.length, 2);
    assert.equal(offers[0].key, 'google-shopping');
    assert.equal(offers[1].merchantName, 'MediaMarkt');
    assert.equal(offers[1].candidateOffers.length, 1);

    const googleAdvances = context.BM_dedupeMarketplaceOffers([
        {
            key: 'google-shopping',
            candidateOffers: [
                {
                    key: 'google-shopping',
                    merchantName: 'Amazon.de',
                    dedupePrice: 99.99
                },
                {
                    key: 'google-shopping',
                    merchantName: 'Otto',
                    dedupePrice: 102.99
                }
            ]
        },
        {
            key: 'klarna',
            merchantName: 'Amazon',
            dedupePrice: 99.99
        }
    ]);
    assert.equal(googleAdvances[0].merchantName, 'Otto');
    assert.equal(googleAdvances[1].merchantName, 'Amazon');
    assert.match(tweakerSource, /logo-klarna\.png/);

    const nativeDuplicate = context.BM_dedupeMarketplaceOffers([
        {
            key: 'google-shopping',
            candidateOffers: [
                {
                    key: 'google-shopping',
                    merchantName: 'MediaMarkt.de',
                    dedupePrice: 104.99
                },
                {
                    key: 'google-shopping',
                    merchantName: 'Otto',
                    dedupePrice: 106.99
                }
            ]
        }
    ], ['google-shopping', 'klarna'], () => true, [
        { merchantName: 'MediaMarkt', dedupePrice: 104.99 }
    ]);
    assert.equal(nativeDuplicate[0].merchantName, 'Otto');
    assert.match(tweakerSource, /BM_dedupeMarketplaceOffers/);
    assert.match(tweakerSource, /dedupeMerchant:\s*shopName/);
    assert.match(
        tweakerSource,
        /storeOffers\(\[\{\s*\.\.\.candidateOffers\[0\],\s*candidateOffers/
    );
});

test('search fallback uses Google Lucky when no Brickmerge target is resolved', () => {
    assert.match(tweakerSource, /const googleLuckyUrl = new URL\('https:\/\/www\.google\.com\/search'\)/);
    assert.match(tweakerSource, /window\.location\.replace\(target \|\| googleLuckyUrl\.href\)/);
});

test('stock action is integrated into the 4-button action row and opens the native depot form', () => {
    const setupDetailButton = tweakerSource.match(
        /function setupDetailButton\(\) \{[\s\S]*?\n\s*function parseNumber/
    )?.[0] || '';

    assert.match(tweakerSource, /function openNativeDepotAdd\(setNumber\)/);
    assert.match(tweakerSource, /searchParams\.get\('a'\) === 'depotadd'/);
    assert.match(tweakerSource, /#myModal #modalform, #modalform/);
    assert.match(
        setupDetailButton,
        /depotButton\.addEventListener\('click', \(\) => openNativeDepotAdd\(setNumber\)\)/
    );
    assert.match(setupDetailButton, /\.bm-detail-action-buttons-row/);
    assert.match(setupDetailButton, /\.bmd-alarm-button/);
    assert.match(setupDetailButton, /\.bmd-wishlist-button/);
    assert.match(setupDetailButton, /\.bmd-roi-calculator-button/);
    assert.match(setupDetailButton, /\.bmd-depot-button/);
    assert.doesNotMatch(tweakerSource, /list\.appendChild\(stockButton\)/);
    assert.doesNotMatch(tweakerSource, /list\.appendChild\(btn\)/);
    assert.match(tweakerSource, /list\.querySelectorAll\('button, \.bmd-open-button/);
    assert.doesNotMatch(setupDetailButton, /chartTrigger/);
});

test('depot action opens the native modal via the same Foundation trigger as alarm and wishlist', () => {
    const depotFn = tweakerSource.slice(
        tweakerSource.indexOf('function openNativeDepotAdd'),
        tweakerSource.indexOf('function openNativePriceAlarm')
    );
    const alarmFn = tweakerSource.slice(
        tweakerSource.indexOf('function openNativePriceAlarm'),
        tweakerSource.indexOf('function openNativeWishlistAdd')
    );
    const wishlistFn = tweakerSource.slice(
        tweakerSource.indexOf('function openNativeWishlistAdd'),
        tweakerSource.indexOf('function mountDetailActionRowIntoLinkPanel')
    );

    // brickmerge.de öffnet die Modale über Foundation (Reveal). Ein reiner
    // DOM-click auf den dynamisch erzeugten <a data-reveal-id> reicht nicht —
    // sonst passiert beim Klick auf "Depot" schlicht nichts.
    [depotFn, alarmFn, wishlistFn].forEach(fn => {
        assert.match(fn, /window\.\$ && typeof \$\(nativeLink\)\.foundation === 'function'/);
        assert.match(fn, /\$\(nativeLink\)\.trigger\('click'\)/);
        assert.match(fn, /else \{\s*nativeLink\.click\(\);\s*\}/);
    });
});

test('action-row buttons keep a gap between icon and text', () => {
    // ensureButtonIcon() hängt das Icon IN .bmd-button-content ein, nicht als
    // Geschwister des Buttons. Der gap des Buttons erreicht es deshalb nicht —
    // der Abstand muss am Icon stehen (Grid-Fall wie Tools-Zeile).
    assert.match(tweakerSource, /content\.prepend\(icon\)/);

    const gridIconRule = tweakerSource.match(
        /\.bm-detail-action-buttons-row \.bmd-open-button \.bmd-button-icon \{[\s\S]*?\}/
    )?.[0] || '';
    assert.notEqual(gridIconRule, '', 'Grid-Regel für .bmd-button-icon nicht gefunden');
    assert.match(gridIconRule, /margin:\s*0\s+4px\s+0\s+0\s*!important/);
});

test('the dismiss X of an additional offer sits in the yellow stripe, not over the discount bubble', () => {
    // Zusätzliche Angebote (.bm-marketplace-offer) tragen links einen gelben
    // Markenstreifen. Das Verwerfen-X lag rechts auf der Rabattblase (gemessen
    // bei 412px: X 341-363, Blase 331-363) und gehört in den verbreiterten
    // Streifen links.
    const stripeRule = tweakerSource.match(
        /#offerlist \.row\.collapse\.bm-marketplace-offer\.bm-offer-dismissible \{[\s\S]*?\}/
    )?.[0] || '';
    assert.notEqual(stripeRule, '', 'Streifen-Regel für aufgerufene Zusatzangebote fehlt');
    assert.match(stripeRule, /inset 29px 0 0 #f8dc62/);
    assert.match(stripeRule, /inset 30px 0 0 #d3b437/);
    // Ohne diese Einrückung liegt das X auf dem Anbieterlogo.
    assert.match(stripeRule, /padding-left:\s*26px\s*!important/);

    const stripeBefore = tweakerSource.match(
        /#offerlist \.row\.collapse\.bm-marketplace-offer\.bm-offer-dismissible::before \{[\s\S]*?\}/
    )?.[0] || '';
    assert.notEqual(stripeBefore, '', 'Streifen-Pseudoelement fehlt');
    assert.match(stripeBefore, /width:\s*30px/);
    // Streifen und Box-Shadow müssen dieselbe Geometrie beschreiben.
    assert.match(stripeBefore, /#f8dc62 29px/);
    assert.match(stripeBefore, /#d3b437 29px/);
    assert.match(stripeBefore, /#d3b437 30px/);

    const xRule = tweakerSource.match(
        /#offerlist \.row\.collapse\.bm-marketplace-offer\.bm-offer-dismissible\s*> \.bm-offer-dismiss \{[\s\S]*?\}/
    )?.[0] || '';
    assert.notEqual(xRule, '', 'X-Regel für Zusatzangebote fehlt');
    assert.match(xRule, /left:\s*4px/);
    assert.match(xRule, /right:\s*auto/);

    // Die Grundregel bleibt rechts: nur die Zusatzangebote wandern nach links.
    const baseRule = tweakerSource.match(/#offerlist \.bm-offer-dismiss \{[\s\S]*?\}/)?.[0] || '';
    assert.match(baseRule, /right:\s*4px/);
    assert.doesNotMatch(baseRule, /left:\s*4px/);
});

test('the depot IIFE reaches observeUntil and BM_SETTINGS across the IIFE boundary', () => {
    // Die Haupt-Runtime (IIFE #1) definiert observeUntil und BM_SETTINGS; der
    // Depot-Baustein (IIFE #2) ist ein EIGENER Scope und kann sie nicht per
    // Closure sehen. Ohne die globalThis-Exporte wirft der Depot-Klick
    // "ReferenceError: observeUntil is not defined" und tut schlicht nichts.
    assert.match(tweakerSource, /globalThis\.observeUntil = observeUntil;/);
    assert.match(tweakerSource, /globalThis\.BM_SETTINGS = BM_SETTINGS;/);

    const depotIife = tweakerSource.slice(
        tweakerSource.indexOf("const STYLE_ID = 'bm-depot-quick-add-style'")
    );
    assert.ok(depotIife.length > 1000, 'Depot-IIFE nicht gefunden');
    assert.match(depotIife, /observeUntil\(fillCurrentPrice, 5000\)/);
    assert.match(depotIife, /globalThis\.bmSetupDetailButton/);
});

test('depot page stays native while detail pages keep the stock action', () => {
    const startup = tweakerSource.slice(
        tweakerSource.lastIndexOf('const isDepotInventoryPage')
    );

    assert.match(
        startup,
        /return action === 'depot' \|\| Boolean\(document\.getElementById\('dpWrap'\)\)/
    );
    assert.match(startup, /if \(isDepotInventoryPage\(\)\) return/);
    assert.match(startup, /setupDetailButton\(\)/);
    assert.doesNotMatch(startup, /setupDepotGrowth\(\)/);
    assert.doesNotMatch(startup, /setupDepotDashboardButton\(\)/);
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
    assert.match(source, /function selectEffectiveEuMinifigPrice\(dePrice, euPrice\)/);
    assert.match(source, /Math\.min\(\.\.\.validPrices\)/);
    assert.match(source, /getRawSharedMinifigPrice\(blItemNo, 'DE'\)/);
    assert.match(source, /getRawSharedMinifigPrice\(blItemNo, 'EU'\)/);
    assert.match(source, /bricklink-minifig-current-total-eu-v10/);
    for (const sourceName of [
        'kleinanzeigen', 'vinted', 'leboncoin', 'stockx', 'klarna', 'idealo', 'bricklink'
    ]) {
        assert.match(source, new RegExp(sourceName, 'i'));
    }
});

test('EU minifigure price always includes the valid German offer', () => {
    const functionSource = tweakerSource.match(
        /function selectEffectiveEuMinifigPrice\(dePrice, euPrice\) \{[\s\S]*?\n\s*\}/
    )?.[0];
    assert.ok(functionSource);
    const selectPrice = Function(
        `${functionSource}; return selectEffectiveEuMinifigPrice;`
    )();

    assert.equal(selectPrice(42.01, 37.70), 37.70);
    assert.equal(selectPrice(42.01, null), 42.01);
    assert.equal(selectPrice(42.01, 49.99), 42.01);
    assert.equal(selectPrice(null, null), null);
});

test('marketplace refresh is a text action in the personal discount toolbar', () => {
    assert.match(source, /document\.createElement\('a'\)/);
    assert.match(source, /offerlist\?\.querySelector\('\.bm-offer-toolbar'\)/);
    assert.match(source, /toolbar\.insertBefore\(button, discountControl \|\| null\)/);
    assert.doesNotMatch(source, /host\.classList\.add\('bm-chart-controls', 'bm-has-price-refresh'\)/);
    assert.match(source, /<span class="bm-plus-icon" aria-hidden="true">\+<\/span>/);
});

test('personal discount switch and settings label form one control', () => {
    const toolbarMarkup = tweakerSource.match(
        /toolbar\.innerHTML = `[\s\S]*?`;\n\s*firstOffer/
    )?.[0] || '';
    assert.match(toolbarMarkup, /class="switch"/);
    assert.match(
        toolbarMarkup,
        /class="bm-discount-settings-trigger"[\s\S]*?Persönlicher Rabatt/
    );
    assert.doesNotMatch(toolbarMarkup, /bm-discount-toolbar-label/);
    assert.doesNotMatch(toolbarMarkup, /<svg/);
    assert.match(
        tweakerSource,
        /bm-discount-settings-trigger'\)\.addEventListener\('click', open\)/
    );
});

test('small chart opens price history while the native trigger stays hidden', () => {
    assert.match(tweakerSource, /document\.getElementById\('chartdiv2'\)/);
    assert.match(tweakerSource, /summaryChart\.classList\.add\('bm-chart-detail-trigger'\)/);
    assert.match(tweakerSource, /openPriceChartOverlay\?\.\(\)/);
    assert.match(tweakerSource, /textNode\.nodeValue = 'Händler-Details'/);
    assert.doesNotMatch(tweakerSource, /Händler-Details · amCharts/);
    assert.match(tweakerSource, /chartTrigger\.classList\.add\('bm-native-chart-loader'\)/);
    assert.match(
        tweakerSource,
        /#chartTrigger\.bm-native-chart-loader \{[\s\S]*?display: none !important/
    );
    assert.doesNotMatch(tweakerSource, /fullLabel\.textContent = 'Details anzeigen'/);
    assert.match(
        tweakerSource,
        /DOMContentLoaded'[\s\S]*?setupPriceChartOverlay/
    );
    assert.match(
        tweakerSource,
        /window\.addEventListener\([\s\S]*?'load'[\s\S]*?setupPriceChartOverlay/
    );
});

test('marketplace and discount actions use the compact text toolbar', () => {
    assert.match(
        tweakerSource,
        /\.bm-offer-toolbar \{[\s\S]*?display: flex;[\s\S]*?justify-content: space-between/
    );
    assert.match(
        tweakerSource,
        /\.bm-discount-toolbar-control \{[\s\S]*?flex: 0 0 auto;[\s\S]*?width: auto;[\s\S]*?white-space: nowrap;/
    );
    assert.match(
        source,
        /\.bm-detail-all-prices-refresh \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow: hidden;[\s\S]*?background: transparent !important;/
    );
    assert.match(
        source,
        /\.bm-detail-all-prices-refresh \.bm-refresh-label \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/
    );
    assert.match(source, /bm-refresh-error-message/);
    assert.match(source, /Bitte erneut versuchen/);
    assert.match(source, /Marktplätze werden geladen …/);
    assert.doesNotMatch(tweakerSource, /\.bm-chart-controls\.bmd-has-depot-button/);
});

test('tracked Brickmerge coupon links open the shop without reloading the set page', () => {
    const normalizeLinks = tweakerSource.match(
        /function normalizeBrickmergeTrackedOfferLinks\(\) \{[\s\S]*?\n\s*function runOfferPresentationSteps/
    )?.[0] || '';
    assert.match(normalizeLinks, /a\[href\*="go2i="\]\[href\*="go2m="\]/);
    assert.match(normalizeLinks, /new URL\('\/go2\/'/);
    assert.match(normalizeLinks, /searchParams\.set\('m', merchantId\)/);
    assert.match(normalizeLinks, /searchParams\.set\('i', itemNumber\)/);
    assert.match(normalizeLinks, /link\.removeAttribute\('onclick'\)/);
    // Gutschein-Angebote (bei eBay der Regelfall) waren bisher ausgenommen –
    // genau ihr href führt aber auf die Trefferliste statt zum Händler.
    assert.doesNotMatch(normalizeLinks, /querySelector\('\.code'\)/);
    assert.doesNotMatch(normalizeLinks, /link\.hasAttribute\('onclick'\)/);
    assert.match(
        tweakerSource,
        /\[true, normalizeBrickmergeTrackedOfferLinks\],[\s\S]*?\[true, syncDismissedOfferRows\]/
    );
});

test('tile merchant links go to the shop redirect instead of the brickmerge hit list', () => {
    const go2Source = tweakerSource.match(
        /function bmGo2DirectUrl\(candidate\) \{[\s\S]*?\n    \}/
    )?.[0];
    assert.ok(go2Source, 'bmGo2DirectUrl fehlt');
    const extractSource = tweakerSource.match(
        /function bmExtractShopUrlFromHtml\(html\) \{[\s\S]*?\n    \}/
    )?.[0];
    assert.ok(extractSource, 'bmExtractShopUrlFromHtml fehlt');

    const [bmGo2DirectUrl, bmExtractShopUrlFromHtml] = new Function(
        `${go2Source}; ${extractSource}; return [bmGo2DirectUrl, bmExtractShopUrlFromHtml];`
    )();

    // Code-Angebot: Trefferlisten-href mit go2i/go2m wird zum /go2/-Ziel des onclick
    assert.equal(
        bmGo2DirectUrl('/index.php?find=10311-1&go2i=10311-1&go2m=332'),
        'https://www.brickmerge.de/go2/?i=10311-1&m=332'
    );
    // Ein echtes /go2/-Ziel und fremde Adressen bleiben unangetastet
    assert.equal(
        bmGo2DirectUrl('https://www.brickmerge.de/go2/?m=412&i=75419-1'),
        'https://www.brickmerge.de/go2/?m=412&i=75419-1'
    );
    assert.equal(
        bmGo2DirectUrl('https://www.ebay.de/sch/i.html?_nkw=lego+10311'),
        'https://www.ebay.de/sch/i.html?_nkw=lego+10311'
    );

    // Der extrahierte Kachel-Link folgt dem topprice-href des Code-Angebots
    assert.equal(
        bmExtractShopUrlFromHtml(
            '<div class="topprice"><a href="/index.php?find=10311-1&amp;go2i=10311-1&amp;go2m=332" ' +
            'onclick="setTimeout(function(){window.location.href=\'/go2/?m=332&amp;i=10311-1\';},100);" ' +
            'title="Link zu eBay.de">29,59 € <span class="small code">[Code]</span></a></div>'
        ),
        'https://www.brickmerge.de/go2/?i=10311-1&m=332'
    );
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

// Ohne Referenzpreis wäre die 50%-Plausibilität ein stiller No-Op. Brickmerge
// liefert seinen Bestpreis aber im JSON-LD des ersten HTML mit.
test('Der JSON-LD-Bestpreis füllt die Referenz, bevor Händlerzeilen gerendert sind', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    const docWith = payloads => ({
        querySelectorAll: () => payloads.map(text => ({
            textContent: typeof text === 'string' ? text : JSON.stringify(text)
        }))
    });
    const aggregate = offer => ({
        '@context': 'https://schema.org/',
        '@type': 'Product',
        offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'EUR',
            lowPrice: '1499.99',
            availability: 'https://schema.org/InStock',
            ...offer
        }
    });

    assert.equal(context.BM_getJsonLdBestPrice(docWith([aggregate()])), 1499.99);
    assert.equal(
        context.BM_getJsonLdBestPrice(docWith([aggregate({ lowPrice: '1.499,99' })])),
        1499.99,
        'auch deutsch formatierte Zahlen dürfen die Referenz nicht kippen'
    );
    assert.equal(
        context.BM_getJsonLdBestPrice(
            docWith([
                aggregate({ lowPrice: '181.99' }),
                aggregate({ lowPrice: undefined, price: 90.5 })
            ])
        ),
        90.5
    );
    assert.equal(
        context.BM_getJsonLdBestPrice(
            docWith([aggregate({ availability: 'https://schema.org/OutOfStock' })])
        ),
        null,
        'ein Ausverkaufspreis ist keine Referenz für den aktuellen Bestpreis'
    );
    assert.equal(
        context.BM_getJsonLdBestPrice(docWith([aggregate({ priceCurrency: 'USD' })])),
        null
    );
    assert.equal(context.BM_getJsonLdBestPrice(docWith(['{kein json'])), null);
    assert.equal(context.BM_getJsonLdBestPrice(docWith([])), null);
    assert.equal(context.BM_getJsonLdBestPrice(undefined), null);

    // Der Tweaker darf die JSON-LD-Zahl nur als Ersatz benutzen, nicht zuerst.
    assert.match(
        tweakerSource,
        /if \(prices\.length > 0\) return Math\.min\(\.\.\.prices\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*return globalThis\.BM_getJsonLdBestPrice\?\.\(document\) \?\? null;/
    );

    // Die gefundene Referenz muss wirklich durch den Filter laufen.
    assert.equal(
        context.BM_isMarketplacePricePlausible(
            'idealo',
            49.99,
            context.BM_getJsonLdBestPrice(docWith([aggregate({ lowPrice: '100' })]))
        ),
        false
    );
});

test('BrickOwl lässt nur versiegelte Lots durch die Zustandsliste', () => {
    const helperSource = tweakerSource.match(
        /const BRICKOWL_SEALED_CONDITIONS = \[[\s\S]*?const isSealedBrickOwlCondition = condition => \{[\s\S]*?\n            \};/
    )?.[0];
    assert.ok(helperSource, 'Zustandsliste von BrickOwl nicht gefunden');
    const context = vm.createContext({ String, Array, Object });
    vm.runInContext(`${helperSource}\nglobalThis.check = isSealedBrickOwlCondition;`, context);

    // Die zehn BrickOwl-Zustände: nur news darf übrig bleiben.
    assert.equal(context.check('Neu (Versiegelt)'), true);
    assert.equal(context.check('  neu   (versiegelt) '), true);
    assert.equal(context.check('New (Sealed)'), true);
    ['Neu', 'Neu (Vollständig)', 'Neu (Unvollständig)', 'Gebraucht (Komplett)',
        'Gebraucht (Unvollständig)', 'Gebraucht (Wie Neu)', 'Gebraucht (Gut)',
        'Gebraucht (Akzeptabel)', 'Sonstiges', ''].forEach(label => {
        assert.equal(context.check(label), false, `${label} darf nicht als versiegelt gelten`);
    });

    // Der alte Test ließ wegen \bNeu\b auch „Neu (Unvollständig)" durch.
    assert.doesNotMatch(tweakerSource, /Neu\\s\*\(\?:Sealed\|Versiegelt\)[\s\S]{0,120}\\bNeu\\b/);
    assert.match(
        tweakerSource,
        /if \(!isSealedBrickOwlCondition\(condition\)\) \{\s*return null;\s*\}/
    );
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
    const alternatives = context.BM_getPlausibleMarketplaceOffers(
        'ebay-fr',
        {
            cheapest: { total: 100, url: 'https://www.ebay.fr/itm/first' },
            offers: [
                { total: 125, url: 'https://www.ebay.fr/itm/second' },
                { total: 140, url: 'https://www.ebay.fr/itm/third' }
            ]
        },
        180
    );
    assert.deepEqual(
        Array.from(alternatives, offer => offer.total),
        [100, 125, 140]
    );
    assert.match(
        source,
        /createEbayWorkerCandidates[\s\S]*?BM_getPlausibleMarketplaceOffers/
    );
    assert.match(source, /ebay-worker-complete-set-v5/);
    assert.match(source, /ebay-fr-worker-complete-set-v3/);
    assert.match(source, /&best=\$\{encodeURIComponent\(ebayReferenceCachePart\)\}/);
});

test('lighting sets, light kits and accessories are excluded by title', () => {
    const sharedSource = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    assert.equal(
        context.BM_isExcludedOfferTitle('Licht-Set für LEGO 75384'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LED Licht Set passend für LEGO 10333'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LED-Lichtset für LEGO 42154'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Briksmax Licht-Set für LEGO 42154'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Light Kit for LEGO 10333'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Kit LED Télécommandé pour LEGO Harry Potter ¤ Tour du Grand Escalier ¤76454¤NEUF'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Kit LED pour LEGO 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Kit d éclairage LED pour LEGO Harry Potter 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Kit de lumière pour LEGO 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Vitrine pour LEGO 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Boite acrylique pour LEGO 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Sans figurines LEGO 76454'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO Star Wars 75384 Crimson Firehawk Neu OVP'),
        false
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO Harry Potter 76454 Tour du Grand Escalier Neuf Scellé'),
        false
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Mould King 13056 Sternenzerstörer'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Cobi 2540 Panzer Bausteine-Set wie LEGO'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Lepin 05007 Star Plan Falcon Block Set'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Custom Set kompatibel mit LEGO 10333'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('BlueBrixx Burg Blaustein'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('CaDA C61042 Bausatz'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Space Wars Millennium Falcon Block Set'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Klemmbausteine wie LEGO'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Technic 42154 kein LEGO original'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Building Block Set 75192'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO X FILES IDEAS lot de 8 minifigs originales du set 21369 NEUVES'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO Star Wars 75192 lot of 4 minifigures'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO 76454 nur Figuren aus Set'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO® Speed Champions Minifiguren Doc Brown und  Marty McFly aus dem Set 77256'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO Ideas 21369 Akte X Mulder & Scully Neu OVP'),
        false
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LED Ferngesteuertes Set für Lego Herr der Ringe ¤ Die Grafschaft ¤ 10354 ¤ NEU'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Kit LED télécommandé pour LEGO Seigneur des anneaux ¤ La Comté ¤ 10354 ¤ NEUF'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('Another Brick Shop LED Kit pour LEGO 10354'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferTitle('LEGO 10354 Der Herr der Ringe: Das Auenland Neu & OVP'),
        false
    );
    assert.equal(
        context.BM_isExcludedOfferSeller('another_brick'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferSeller('Another Brick Shop'),
        true
    );
    assert.equal(
        context.BM_isExcludedOfferSeller('luckyrosa'),
        false
    );

    const filtered = context.BM_getPlausibleMarketplaceOffers(
        'ebay',
        {
            cheapest: { title: 'Licht-Set für LEGO 75384', total: 29.99, url: 'https://www.ebay.de/itm/light' },
            offers: [
                {
                    title: 'LED Ferngesteuertes Set für Lego Herr der Ringe ¤ Die Grafschaft ¤ 10354 ¤ NEU',
                    seller: 'another_brick',
                    total: 133.19,
                    url: 'https://www.ebay.de/itm/397363041523'
                },
                {
                    title: 'LEGO® Icons 10354 Der Herr der Ringe: Das Auenland OVP! Neu!',
                    seller: 'luckyrosa',
                    total: 225.49,
                    url: 'https://www.ebay.de/itm/178450629602'
                },
                { title: 'LEGO 75384 Crimson Firehawk Neu', total: 49.99, url: 'https://www.ebay.de/itm/set' }
            ]
        },
        50
    );
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].title, 'LEGO 75384 Crimson Firehawk Neu');
    assert.equal(filtered[1].title, 'LEGO® Icons 10354 Der Herr der Ringe: Das Auenland OVP! Neu!');
});

test('offer rows can be dismissed and marketplace alternatives move up', () => {
    assert.match(tweakerSource, /DISMISSED_OFFERS_KEY/);
    assert.match(tweakerSource, /VISITED_OFFERS_KEY/);
    assert.match(tweakerSource, /function markOfferVisited\(/);
    assert.match(tweakerSource, /if \(!isOfferVisited\(identity\)\)/);
    assert.match(tweakerSource, /addEventListener\('auxclick', rememberVisit\)/);
    assert.match(tweakerSource, /function syncDismissedOfferRows\(/);
    assert.match(tweakerSource, /className = 'bm-offer-dismiss'/);
    assert.match(tweakerSource, /new CustomEvent\('bm-offer-dismissed'/);
    assert.match(tweakerSource, /candidateOffers/);
    assert.match(tweakerSource, /showOfferDismissToast/);
    assert.match(tweakerSource, /Verworfene wieder anzeigen/);
    assert.match(tweakerSource, /scheduleOfferPresentation\(\)/);
    assert.match(tweakerSource, /right:\s*(?:-1\.55rem|4px)/);
    assert.match(tweakerSource, /\/offers\/dismissals/);
    assert.match(tweakerSource, /bm-offer-dismissals-synced/);
    assert.match(backgroundSource, /isDismissalWrite/);
    assert.match(gmCompatSource, /data:\s*details\.data/);
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
    assert.match(source, /franceDefault:\s*true/);
    assert.match(source, /france:\s*globalThis\.BM_PLATFORM\?\.franceDefault !== false/);
    assert.match(source, /Frankreich-Angebote:.*umschalten/);
    assert.doesNotMatch(source, /className = 'bm-france-toggle'/);
    assert.doesNotMatch(source, /bm-france-toggle-row/);
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

test('eBay Offerlist uses black logos with distinct source markers', () => {
    assert.doesNotMatch(
        tweakerSource,
        /filter:\s*grayscale\(1\) brightness\(0\)/
    );
    assert.match(tweakerSource, /function ensureBlackEbayWordmark\(/);
    assert.match(tweakerSource, /bm-ebay-wordmark/);
    assert.match(tweakerSource, /BM_EBAY_WORDMARK_HEIGHT = 400\.75098/);
    assert.match(tweakerSource, /createElementNS/);
    // Wortmarke und Verkäufer-Marke sitzen in EINEM SVG: die Marke wird als
    // <g> in dieselbe Figur gesetzt statt als eigenes Span daneben.
    assert.match(tweakerSource, /bm-ebay-seller-mark/);
    assert.match(
        tweakerSource,
        /viewBox="0 0 \$\{width\} \$\{BM_EBAY_WORDMARK_HEIGHT\}"/
    );
    assert.doesNotMatch(tweakerSource, /bm-ebay-seller-type-icon/);
    assert.doesNotMatch(tweakerSource, /grid-template-columns:\s*50px 18px/);
    assert.match(tweakerSource, /bm-ebay-original-click-target/);
    assert.match(tweakerSource, /const originalImage = stage\.querySelector/);
    assert.match(tweakerSource, /bm-marketplace-logo-row/);
    assert.match(tweakerSource, /Gewerblicher eBay-Verkäufer/);
    assert.match(tweakerSource, /Privater eBay-Verkäufer/);
    assert.match(tweakerSource, /logoCountryFlag:\s*isFrance \? '🇫🇷' : ''/);
    assert.match(tweakerSource, /bm-marketplace-country-flag-fr/);
    assert.match(tweakerSource, /flag\.textContent = offer\.logoCountryFlag/);
    assert.match(tweakerSource, /viewBox="0 0 3 2"/);
    assert.match(tweakerSource, /PRIVATE_SELLER/);
    assert.match(tweakerSource, /isBusinessSeller/);
    assert.match(
        tweakerSource,
        /offer\.key === 'ebay' \? 'INDIVIDUAL' : ''/
    );
    assert.doesNotMatch(tweakerSource, /logoDomainSuffix:\s*'\.(?:de|fr)'/);
    // Die eBay-Zelle bekommt dieselbe Innenkante wie die Händlerbilder: links
    // sitzt der 9 px Streifen der Zeile, sonst schneidet er die Wortmarke an.
    assert.match(
        tweakerSource,
        /#offerlist \.bm-ebay-logo-link,\s*\n\s*#offerlist \.bm-ebay-logo-link\.bm-has-meta \{[\s\S]*?padding: 2px 7px 1px !important/
    );
    // Keine eigene Größenordnung: es gilt der gemeinsame 92%/84%-Rahmen.
    assert.doesNotMatch(
        tweakerSource,
        /\.bm-marketplace-logo-stage > \.bm-ebay-wordmark \{[^}]*max-width:\s*100%/
    );
});


test('historical best price replaces duplicate relative date labels', () => {
    assert.match(tweakerSource, /function removeRelativeDayLabelsFromBestPriceLines\(/);
    assert.ok(
        tweakerSource.includes(
            ".replace(/(?:^|\\s)(?:heute|gestern)\\s*!?/gi, '')"
        )
    );
});

test('volume detail line matches native Brickmerge formatting without hover', () => {
    assert.match(tweakerSource, /volumeLine\.className = 'bm-volume-line';/);
    assert.doesNotMatch(tweakerSource, /volumeLine\.className = 'bm-volume-line bm-detail-line-link'/);
    assert.doesNotMatch(tweakerSource, /volumeLine\.title/);
    assert.match(tweakerSource, /document\.createTextNode\('\\u00A0\| Volumen: '\)/);
    assert.match(tweakerSource, /boldValue\.textContent = `\${formattedVolume} l\${pricePerLiter}`;/);
    assert.match(tweakerSource, /` \| \${formatEuroPerLiter\(bestPrice, volumeLiters\)}`/);
    assert.match(tweakerSource, /safeValue\.toFixed\(1\)/);
    assert.match(tweakerSource, /formatted\.replace\('\.', ','\)/);
    assert.match(tweakerSource, /toLocaleString\('de-DE'/);
    assert.match(tweakerSource, /`\${formattedPrice} €\/l`/);
});

test('box dimensions renamed to Maße and Abmessungen line is collapsible via icon toggle', () => {
    assert.match(tweakerSource, /textNode\.nodeValue\.replace\(\/Box-Maße\\s\*:\/i,\s*'Maße:'\)/);
    assert.match(tweakerSource, /bm-dimensions-toggle-btn/);
    assert.match(tweakerSource, /bm-dimensions-ruler-icon/);
    assert.match(tweakerSource, /bm-dimensions-chevron/);
    assert.match(tweakerSource, /bm-model-dimensions-wrapper/);
    assert.match(tweakerSource, /bm-model-dimensions-line/);
    assert.match(tweakerSource, /bmDimensionsSlideDown/);
    assert.match(tweakerSource, /bmDimensionsSlideUp/);
    assert.match(tweakerSource, /Modell-Abmessungen einblenden/);
    assert.match(tweakerSource, /Modell-Abmessungen ausblenden/);
    assert.match(tweakerSource, /toggleBtn\.after\(dimensionsWrapper\);/);
    assert.match(tweakerSource, /const targetAnchor = dimensionsWrapper \|\| toggleBtn \|\| link;/);
});

test('safety warning is replaced with EN 71 pictograms under instructions', () => {
    assert.match(tweakerSource, /function isSetEligibleForSafetyWarning\(/);
    assert.match(tweakerSource, /function replaceSafetyWarningWithPictograms\(/);
    assert.match(tweakerSource, /function createSafetyWarningBlock\(/);
    assert.match(tweakerSource, /bm-safety-warning-block/);
    assert.match(tweakerSource, /bm-safety-pictograms/);
    assert.match(tweakerSource, /bm-picto-03/);
    assert.match(tweakerSource, /bm-picto-triangle/);
    assert.match(tweakerSource, /0-3/);
    assert.match(tweakerSource, /opacity:\s*0\.85;/);
    assert.match(tweakerSource, /filter:\s*grayscale\(100%\);/);
    assert.match(tweakerSource, /stroke="#444"/);
    assert.match(tweakerSource, /\.bm-safety-warning-text strong \{\s*color:\s*#444;/);
    assert.match(tweakerSource, /#ol2nd \.bm-sidebar-instructions/);
    assert.match(tweakerSource, /sidebarInstructions\.appendChild\(warningBlock\)/);
    assert.match(tweakerSource, /bm-sidebar-warning/);
    assert.match(tweakerSource, /bm-detail-warning/);
    assert.match(tweakerSource, /bm-instruction-section/);
});

test('overall best price box is inserted above Brickmerge best price with matching style when marketplace is cheaper', () => {
    assert.match(tweakerSource, /function syncOverallBestPriceBox\(/);
    assert.match(tweakerSource, /bm-overall-bestprice/);
    assert.match(tweakerSource, /bm-overall-bestprice-label/);
    assert.match(tweakerSource, /isMarketplaceCheaper/);
    assert.match(tweakerSource, /Bestpreis:/);
    assert.match(tweakerSource, /Brickmerge-Bestpreis:/);
    assert.match(tweakerSource, /retailerLabel\.textContent\s*=\s*'Bestpreis:';/);
    assert.match(tweakerSource, /bm-topprice-logo-cell/);
    assert.match(tweakerSource, /bm-offer-row-highlight/);
    assert.match(tweakerSource, /padding:\s*0\.5rem\s+4\.5rem\s+0\.5rem\s+0\.6rem;/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-bestprice-bubble/);
    assert.match(tweakerSource, /bestPriceBox\.style\.display\s*=\s*['"]block['"]/);
    assert.match(tweakerSource, /existingBlackBubble/);
});

test('calculation price basis and marketplaces in offerlist are controlled by settings', () => {
    assert.match(tweakerSource, /function getPriceBasisMode\(/);
    assert.match(tweakerSource, /BM_SETTINGS\.marketplacesInOfferlist === false/);
    assert.match(tweakerSource, /return 'retailer';/);
    assert.match(tweakerSource, /return 'overall';/);
    assert.match(tweakerSource, /syncGlobalPriceBasisToggle/);
    assert.doesNotMatch(tweakerSource, /function createPriceBasisToggle/);
    assert.match(tweakerSource, /isMarketplaceCheaper/);
    assert.match(tweakerSource, /syncPriceBasisCalculations/);
    assert.match(tweakerSource, /function syncMarketplaceDealBadge/);
    assert.match(tweakerSource, /function getDetailsNameElement\(/);
    assert.match(tweakerSource, /function ensureH1CopyButton\(/);
    assert.match(tweakerSource, /function ensureDetailsNameCopyButton\(/);
    assert.match(tweakerSource, /function createNameCopyButton\(/);
    assert.match(tweakerSource, /copyBtn\.classList\.add\('bm-name-copy-btn'\);/);
    assert.match(tweakerSource, /productPrice\.querySelector\('\.bm-price-basis-switch-row'\)\?\.remove\(\)/);

    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);
    vm.runInContext(overviewSource, context);

    const defaultSettings = context.BM_mergeSettings();
    assert.strictEqual(defaultSettings.marketplacesInOfferlist, true);

    const disabledSettings = context.BM_mergeSettings({ marketplacesInOfferlist: false });
    assert.deepStrictEqual(
        Array.from(context.BM_OVERVIEW_PRICE_CORE.enabledSources(disabledSettings)),
        []
    );
    assert.deepStrictEqual(
        Array.from(context.BM_OVERVIEW_PRICE_CORE.buttonSources(disabledSettings)),
        []
    );
});

test('all-time best difference calculation uses calculation price basis and removes green styling', () => {
    assert.match(tweakerSource, /function insertAllTimeDiscountRow\(/);
    assert.doesNotMatch(tweakerSource, /diffPercent\s*<=\s*0\s*\?\s*['"]#1b5e20['"]/);
    assert.match(tweakerSource, /const\s+color\s*=\s*diffPercent\s*>\s*0\s*\?\s*['"]#b71c1c['"]\s*:\s*['"]['"]/);
    assert.match(tweakerSource, /value\.style\.removeProperty\(['"]color['"]\)/);
    assert.match(tweakerSource, /getCalculationBestPrice\(\)\s*\?\?\s*\(uniqueSortedPrices/);
    assert.match(tweakerSource, /Math\.round\(\(\(currentPrice - allTimeBest\) \/ allTimeBest\) \* 100\)/);
    assert.match(tweakerSource, /\$\{signPrefix\}\$\{diffPercent\}%/);
});

test('black discount bubble accounts for personal retailer discounts', () => {
    assert.match(tweakerSource, /function getOfferRowPrice\(/);
    assert.match(tweakerSource, /getOfferRowPrice\(priceRow,\s*priceSpan\)/);
    assert.match(tweakerSource, /row\?\.dataset\?\.bmEffectivePrice/);
    assert.match(tweakerSource, /row\?\.dataset\?\.bmRetailerRate/);
    assert.match(
        tweakerSource,
        /offerPricesSummary\.retailerBest !== null &&\s*Math\.abs\(price1 - offerPricesSummary\.retailerBest\) <= 0\.004/
    );
});

test('minifigure details line removes "in diesem Set"', () => {
    assert.match(tweakerSource, /function cleanMinifigureExclusiveText\(/);
    assert.match(tweakerSource, /cleanMinifigureExclusiveText,\s*linkPackageDimensionsCalculator/);
    assert.match(tweakerSource, /node\.nodeValue\.replace\([\s\S]*?in diesem Set/);
});

test('sold out offers have uniform background, left indicator bar, and remain sorted by price without discounts', () => {
    assert.match(tweakerSource, /#offerlist \.row\.collapse\.bm-sold-out-offer::before/);
    assert.match(tweakerSource, /#offerlist \.row\.collapse\.bm-sold-out-offer \.bm-marketplace-logo-link/);
    assert.match(tweakerSource, /#offerlist \.bm-sold-out-overlay\s*\{[\s\S]*?z-index:\s*8/);
    assert.match(tweakerSource, /#offerlist \.bm-sold-out-badge\s*\{[\s\S]*?z-index:\s*9/);
    assert.match(tweakerSource, /discountRow\?\.dataset\.bmSoldOut === 'true' \|\|\s*discountRow\?\.closest\('\.bm-sold-out-offer'\)/);
    assert.match(tweakerSource, /priceRow\?\.dataset\.bmSoldOut === 'true' \|\|\s*priceRow\?\.closest\('\.bm-sold-out-offer'\)/);
    assert.doesNotMatch(tweakerSource, /aSoldOut !== bSoldOut/);
});

test('historical best price is abbreviated to ATB with tooltip and formatted suffix, and akt. brickmerge Preis is shortened', () => {
    assert.match(tweakerSource, /function formatHistoricalBestPriceSuffix\(/);
    assert.match(tweakerSource, /function renameHistoricalBestPriceLabel\(/);
    assert.match(tweakerSource, /function renameAktBrickmergePreisLabel\(/);
    assert.match(tweakerSource, /function setupAtbTooltip\(/);
    assert.match(tweakerSource, /bm-atb-tooltip/);
    assert.match(tweakerSource, /Historisch niedrigster je bei brickmerge erfasster Preis für dieses Set/);
    assert.match(tweakerSource, /bm-atb-abbr/);
    assert.match(tweakerSource, /title = 'All-Time-Bestpreis'/);
    assert.match(tweakerSource, /textContent = 'ATB'/);
    assert.match(tweakerSource, /akt\. Bestpreis/);

    const formatSuffixMatch = tweakerSource.match(/function formatHistoricalBestPriceSuffix\([\s\S]*?\n    \}/);
    assert.ok(formatSuffixMatch, 'formatHistoricalBestPriceSuffix function found');
    const fn = new Function('detailSuffix', `${formatSuffixMatch[0]}; return formatHistoricalBestPriceSuffix(detailSuffix);`);
    assert.equal(fn('am 27.08.2026 bei eBay.de.'), 'am 27.08.26');
    assert.equal(fn('am 05.12.2023 bei Proshop.de'), 'am 05.12.23');
    assert.equal(fn('/ 45% am 27.08.2026 bei LEGO.com.'), '/ 45% am 27.08.26');
    assert.equal(fn('(27.08.26, eBay)'), 'am 27.08.26');
    assert.equal(fn('am 21.04.2026 bei eBay.de.'), 'am 21.04.26');
});

test('collectible minifigures detection and set number parsing support -x suffixes', () => {
    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);

    assert.equal(
        context.BM_getBrickmergeSetNumber('https://www.brickmerge.de/71047-x_lego-collectable-minifigures-dungeons-dragons'),
        '71047'
    );
    assert.equal(
        context.BM_getBrickmergeSetNumber('https://www.brickmerge.de/71046-36_lego-collectable-minifigures-lego-minifiguren-serie-26-space-36er-box'),
        '71046'
    );
    assert.equal(
        context.BM_getBrickmergeSetNumber('https://www.brickmerge.de/75192-1_lego-star-wars-millennium-falcon'),
        '75192'
    );
    assert.equal(
        context.BM_getBrickmergeSetNumber('https://www.brickmerge.de/75192'),
        '75192'
    );
    assert.equal(
        context.BM_getBrickmergeSetNumber('https://www.brickmerge.de/75192-1'),
        '75192'
    );

    // CMF by URL
    assert.equal(
        context.BM_isCollectibleMinifigures(
            {},
            'https://www.brickmerge.de/71047-x_lego-collectable-minifigures-dungeons-dragons'
        ),
        true
    );
    assert.equal(
        context.BM_isCollectibleMinifigures(
            {},
            'https://www.brickmerge.de/71046-36_lego-collectable-minifigures-lego-minifiguren-serie-26-space-36er-box'
        ),
        true
    );
    // Non-CMF
    assert.equal(
        context.BM_isCollectibleMinifigures(
            {},
            'https://www.brickmerge.de/75192-1_lego-star-wars-millennium-falcon'
        ),
        false
    );
    // CMF by Document Title
    assert.equal(
        context.BM_isCollectibleMinifigures(
            { title: 'LEGO® Collectable Minifigures 71047 Dungeons & Dragons®' },
            'https://www.brickmerge.de/71047'
        ),
        true
    );
    // CMF by Theme Anchor
    assert.equal(
        context.BM_isCollectibleMinifigures(
            {
                querySelector: selector => selector.includes('LEGO-Collectable%20Minifigures') ? {} : null
            },
            'https://www.brickmerge.de/71047'
        ),
        true
    );
    // Footer link (?find=Collectable%20Minifigures%202026) must NOT trigger CMF
    assert.equal(
        context.BM_isCollectibleMinifigures(
            {
                querySelector: selector => selector.includes('find=Collectable') ? {} : null
            },
            'https://www.brickmerge.de/72038-1_lego-super-mario-mario-kart-wario-und-waluigi'
        ),
        false
    );
});

test('resources group places CMF Scanner link at the front for collectible minifigures', () => {
    assert.match(tweakerSource, /id:\s*"btn-cmf-scanner"/);
    assert.match(tweakerSource, /name:\s*"CMF Scanner"/);
    assert.match(tweakerSource, /https:\/\/brickbank\.app\/cmf\/scanner\//);
    assert.match(tweakerSource, /icon\("brickbank\.app"\)/);

    // Verify it is placed in the resources group before Rebrickable
    const resourcesSection = tweakerSource.match(
        /key:\s*'resources'[\s\S]*?links:\s*\[[\s\S]*?name:\s*"Rebrickable"/
    )?.[0] || '';
    assert.match(resourcesSection, /btn-cmf-scanner/);
    assert.match(resourcesSection, /isCmf/);
});

test('tap hand overlay on product images is hidden via CSS and removed from DOM', () => {
    const precleanSource = fs.readFileSync(
        new URL('../src/preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(precleanSource, /span\.tap,\s*\.tap\s*\{[\s\S]*?display:\s*none\s*!important/);
    assert.match(precleanSource, /background-image:\s*none\s*!important/);
    assert.match(tweakerSource, /span\.tap,\s*\.tap\s*\{[\s\S]*?display:\s*none\s*!important/);
    assert.match(tweakerSource, /document\.querySelectorAll\('span\.tap, \.tap'\)\.forEach/);
});

test('theme and search page top SEO clutter and Telegram promo are hidden via cleaner styles and removed from DOM', () => {
    const precleanSource = fs.readFileSync(
        new URL('../src/preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(precleanSource, /\.content\.noPadBottom > \.row:first-child \.small-12\.column > \.small-12:not\(\.setdetails\)/);
    assert.match(precleanSource, /\.small-12\.medium-4\.large-3\.right/);
    assert.match(tweakerSource, /\.content\.noPadBottom > \.row:first-child \.small-12\.column > \.small-12:not\(\.setdetails\)/);
    assert.match(tweakerSource, /document\.querySelectorAll\('\.content\.noPadBottom > \.row:first-child \.small-12\.column > \.small-12:not\(\.setdetails\)'\)\.forEach/);
});

test('account subnavigation bar (bm-usernav) is hidden via CSS and removed from DOM', () => {
    const precleanSource = fs.readFileSync(
        new URL('../src/preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(precleanSource, /\.bm-usernav/);
    assert.match(tweakerSource, /\.bm-usernav/);
    assert.match(tweakerSource, /document\.querySelectorAll\('\.bm-usernav'\)\.forEach/);
});

test('effective prices from personal retailer discounts are visible in topprice green bar', () => {
    assert.match(tweakerSource, /function syncTopPriceEffectiveValues\(/);
    assert.match(tweakerSource, /function ensureTopPriceOriginalPriceElement\(/);
    assert.match(tweakerSource, /\[BM_SETTINGS\.priceCalculations, syncTopPriceEffectiveValues\]/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-effective-info\s*\{/);
    assert.match(tweakerSource, /color:\s*#ffffff\s*!important;/);
    assert.match(tweakerSource, /font-weight:\s*400;/);
    assert.match(tweakerSource, /white-space:\s*nowrap\s*!important;/);
    assert.match(tweakerSource, /padding:\s*0\.5rem\s*2\.[45]rem\s*0\.5rem\s*0\.3rem\s*!important;/);
    assert.match(tweakerSource, /retailerBestOffer/);
    assert.match(tweakerSource, /bm-topprice-effective-info/);
    assert.match(tweakerSource, /bm-effective-info bm-topprice-effective-info/);
    assert.match(tweakerSource, /bmReplacedRetailer/);
    assert.match(tweakerSource, /bmOriginalHtml/);
});

test('retailer topprice bars deduplicate merchants and ensure no line wrap in price cell', () => {
    assert.match(tweakerSource, /function normalizeMerchantName\(/);
    assert.match(tweakerSource, /function getBarMerchantIdentifier\(/);
    assert.match(tweakerSource, /function matchesActiveBest\(/);
    assert.match(tweakerSource, /seenMerchants\.has\(ident\)/);
    assert.match(tweakerSource, /bar\.remove\(\)/);
    assert.match(tweakerSource, /allRetailerTopPrices\[0\]\.before\(existingBar\)/);
    assert.match(tweakerSource, /\\u00a0€/);
});

test('ATB abbreviation is placed outside anchor tag and not linked to price comparison chart', () => {
    assert.match(tweakerSource, /anchor\.parentNode\.insertBefore\(atbSpan,\s*anchor\)/);
    assert.match(tweakerSource, /anchor\.parentNode\.insertBefore\(document\.createTextNode\(': '\),\s*anchor\)/);
    assert.match(tweakerSource, /event\.target\.closest\?\.\('\.bm-atb-abbr'\)/);
    assert.match(tweakerSource, /link\.previousElementSibling\?\.classList\?\.contains\('bm-atb-abbr'\)/);
    assert.match(tweakerSource, /Differenz zum <span class="bm-atb-abbr/);

    const isPriceHistoryLinkMatch = tweakerSource.match(/function isPriceHistoryLink\(link\) \{[\s\S]*?\n    \}/);
    assert.ok(isPriceHistoryLinkMatch);
    const isPriceHistoryLink = new Function('link', `${isPriceHistoryLinkMatch[0]}; return isPriceHistoryLink(link);`);

    assert.match(tweakerSource, /\$1€/);
    assert.match(tweakerSource, /am \$\{dd\}\.\$\{mm\}\.\$\{shortYear\}/);

    assert.equal(isPriceHistoryLink({
        classList: { contains: cls => cls === 'bm-price-history-link' },
        textContent: '18,51€ / 54% am 21.04.26'
    }), true);

    assert.equal(isPriceHistoryLink({
        previousElementSibling: { classList: { contains: cls => cls === 'bm-atb-abbr' } },
        textContent: '18,51€ / 54% am 21.04.26'
    }), true);

    assert.equal(isPriceHistoryLink({
        textContent: 'Zum Shop'
    }), false);
});

test('brickmerge LEGO Deal-Score is shortened to Deal-Score', () => {
    assert.match(tweakerSource, /function shortenDealScoreLabel\(/);
    assert.match(tweakerSource, /brickmerge\\s\+LEGO\\s\+Deal-Score/);
    assert.match(tweakerSource, /'Deal-Score'/);

    const shortenDealScoreLabelMatch = tweakerSource.match(/function shortenDealScoreLabel\(\) \{[\s\S]*?\n    \}/);
    assert.ok(shortenDealScoreLabelMatch);
});

test('safety warning is placed under product description or fallback targets', () => {
    assert.match(tweakerSource, /#ol1st \.bm-instruction-source \.bm-safety-warning-block/);
    assert.match(tweakerSource, /bm-mobile-parts-stock-wrap/);
    assert.match(tweakerSource, /const mobileTarget = descSection \|\| mobileStockWrap \|\| partsSection/);
    assert.match(tweakerSource, /detailWarning\.previousElementSibling !== mobileTarget/);
    assert.match(tweakerSource, /mobileTarget\.insertAdjacentElement\('afterend', detailWarning\)/);
    assert.match(tweakerSource, /\.bm-detail-layout > \.bm-detail-warning/);
});

test('minifigure overlay integrates BrickLink set-minifigs API fallback and graceful empty state', () => {
    assert.match(tweakerSource, /loadBrickLinkApiInventory/);
    assert.match(tweakerSource, /fetchBrickLinkSetMinifigs\(\)/);
    assert.match(tweakerSource, /entry\?\.set_num \|\| entry\?\.itemNo/);
    assert.match(tweakerSource, /Keine Minifiguren in diesem Set enthalten\./);
});

test('eBay minifigure price in minifigure overlay is removed when marketplacesInOfferlist is false', () => {
    assert.match(tweakerSource, /const isEbayMinifigEnabled = \(\) =>/);
    assert.match(tweakerSource, /BM_SETTINGS\.marketplacesInOfferlist !== false/);
    assert.match(tweakerSource, /BM_isOfferShopEnabled\('ebay-minifig'\)/);
    assert.match(tweakerSource, /if \(!ebayEnabled\) \{\s*ebayLink\?\.remove\(\);/);
});

test('minifigure overlay includes set title in header subtitle', () => {
    assert.match(tweakerSource, /const getDetailSetTitle = setNumber =>/);
    assert.match(tweakerSource, /const setTitle = getDetailSetTitle\((?:activeSetNum|setNum)\);/);
    assert.match(tweakerSource, /const setLabel = setTitle \|\| \((?:activeSetNum|setNum)/);
});

test('minifigure overlay table rows override host site zebra striping with white background', () => {
    assert.match(
        tweakerSource,
        /\.bm-minifig-content tr:nth-of-type\(even\)[\s\S]*?background:#fff !important;/
    );
    assert.match(
        tweakerSource,
        /\.bm-minifig-content td:first-child[\s\S]*?grid-row:1;/
    );
    assert.doesNotMatch(
        tweakerSource,
        /\.bm-minifig-content td:first-child[\s\S]*?grid-row:1 \/ span 2;/
    );
});

test('chart, EAN, and minifigure overlays have robust, bulletproof close buttons', () => {
    // Chart close button is a flex item in header and reset properly
    assert.match(tweakerSource, /\.bm-chart-dialog-close\s*\{[\s\S]*?display:\s*inline-flex\s*!important/);
    assert.match(tweakerSource, /\.bm-chart-dialog-close\s*\{[\s\S]*?margin:\s*0 0 0 auto\s*!important/);
    assert.match(tweakerSource, /\.bm-chart-dialog-header\s*\{[\s\S]*?justify-content:\s*space-between/);

    // EAN close button is styled with !important resets against Foundation button rules
    assert.match(tweakerSource, /\.bm-ean-close\s*\{[\s\S]*?display:\s*inline-flex\s*!important/);
    assert.match(tweakerSource, /\.bm-ean-close\s*\{[\s\S]*?padding:\s*0\s*!important/);
    assert.match(tweakerSource, /\.bm-ean-close\s*\{[\s\S]*?background:\s*#F1F5F9\s*!important/);

    // Minifigure linking is included in set detail initializers
    assert.match(tweakerSource, /linkMinifigureDetails/);
    assert.match(tweakerSource, /runSetDetailInitializers\(\)\s*\{[\s\S]*?linkMinifigureDetails/);
});

test('static shop shipping rules detect merchants and free shipping thresholds', () => {
    const context = vm.createContext({ globalThis: {} });
    const currentShared = fs.readFileSync(
        new URL('../src/shared.js', import.meta.url),
        'utf8'
    );
    vm.runInContext(currentShared, context);

    const findRule = context.globalThis.BM_findShopShippingRule;
    assert.equal(typeof findRule, 'function');

    // LEGO Online Shop
    const legoRule = findRule('LEGO Online Shop');
    assert.ok(legoRule);
    assert.equal(legoRule.freeFrom, 55.0);
    assert.equal(legoRule.standardCost, 3.95);

    // Smyths
    const smythsRule = findRule('Smyths Toys');
    assert.ok(smythsRule);
    assert.equal(smythsRule.freeFrom, 29.0);

    // Müller
    const muellerRule = findRule('Müller Drogerie');
    assert.ok(muellerRule);
    assert.equal(muellerRule.freeFrom, 49.0);
    assert.equal(muellerRule.pickupFree, true);

    // Galaxus
    const galaxusRule = findRule('Galaxus.de');
    assert.ok(galaxusRule);
    assert.equal(galaxusRule.freeFrom, 30.0);

    // Amazon
    const amazonRule = findRule('Amazon.de');
    assert.ok(amazonRule);
    assert.equal(amazonRule.freeFrom, 39.0);

    // Alza
    const alzaRule = findRule('Alza');
    assert.ok(alzaRule);
    assert.equal(alzaRule.freeFrom, null);
    assert.equal(alzaRule.standardCost, 0.98);

    // Unknown
    assert.equal(findRule('Unbekannter Shop'), null);
});

test('tweaker incorporates shop shipping rules and threshold hints', () => {
    assert.match(tweakerSource, /globalThis\.BM_findShopShippingRule\?\.\(merchantName\)/);
    assert.match(tweakerSource, /offerPrice >= rule\.freeFrom/);
    assert.match(tweakerSource, /rule\.freeFrom - offerPrice/);
    assert.match(tweakerSource, /small\.dataset\.shippingFreeFrom/);
    assert.match(tweakerSource, /small\.dataset\.shippingRemaining/);
    assert.match(tweakerSource, /ab \$\{formatEuroValue\(shipping\.freeFrom\)\} € versandkostenfrei/);
    assert.doesNotMatch(tweakerSource, /ab \$\{Math\.round\(shipping\.freeFrom\)\} € frei/);
});

test('ROI and target sale price calculator provides presets and correct margin math', () => {
    assert.match(tweakerSource, /MARKETPLACE_PRESETS\s*=/);
    assert.match(tweakerSource, /ebay_comm/);
    assert.match(tweakerSource, /amazon/);
    assert.match(tweakerSource, /stockx/);
    assert.match(tweakerSource, /bricklink/);
    assert.match(tweakerSource, /bmd-roi-calculator-button/);
    assert.match(tweakerSource, /openRoiCalculatorOverlay/);

    // Context for formula verification
    const context = {
        calculateRequiredSalePrice: null
    };
    const code = tweakerSource.slice(
        tweakerSource.indexOf('function calculateRequiredSalePrice'),
        tweakerSource.indexOf('function calculateSaleThreshold')
    );
    vm.runInNewContext(`${code}; calculateRequiredSalePrice = calculateRequiredSalePrice;`, context);
    const { calculateRequiredSalePrice } = context;

    // Test 0% ROI (Break-Even): EK 100, 10% fee, 0 fix, 5 shipping => (100 + 5) / 0.9 = 116.67
    const breakEven = calculateRequiredSalePrice(100, 0, { feePercent: 10, fixedFee: 0, shipping: 5 });
    assert.ok(breakEven);
    assert.equal(Math.round(breakEven.targetPrice * 100) / 100, 116.67);
    assert.equal(Math.round(breakEven.profit * 100) / 100, 0);

    // Test 20% ROI: EK 100, 20% ROI => EK+Gewinn = 120. With 10% fee, 0 fix, 5 shipping => (120 + 5) / 0.9 = 138.89
    const roi20 = calculateRequiredSalePrice(100, 20, { feePercent: 10, fixedFee: 0, shipping: 5 });
    assert.ok(roi20);
    assert.equal(Math.round(roi20.targetPrice * 100) / 100, 138.89);
    assert.equal(Math.round(roi20.profit * 100) / 100, 20.00);

    // Amazon preset math: 15% fee, 0.99 fix, 6.99 shipping on 100 € EK with 25% margin
    // target = (100 * 1.25 + 0.99 + 6.99) / 0.85 = 132.98 / 0.85 = 156.45
    const amazonRoi = calculateRequiredSalePrice(100, 25, { feePercent: 15, fixedFee: 0.99, shipping: 6.99 });
    assert.ok(amazonRoi);
    assert.equal(Math.round(amazonRoi.targetPrice * 100) / 100, 156.45);
    assert.equal(Math.round(amazonRoi.profit * 100) / 100, 25.00);
});

test('calculateCagr accurately computes annualized return with holding threshold', () => {
    assert.match(tweakerSource, /function calculateCagr/);
    const context = { calculateCagr: null };
    const code = tweakerSource.slice(
        tweakerSource.indexOf('function calculateCagr'),
        tweakerSource.indexOf('function parseEolDate')
    );
    vm.runInNewContext(`${code}; calculateCagr = calculateCagr;`, context);
    const { calculateCagr } = context;

    // Under 30 days => null
    assert.strictEqual(calculateCagr(120, 100, 20 / 365.2425), null);
    // Exactly 1 year, +20%
    const cagr1y = calculateCagr(120, 100, 1.0);
    assert.ok(cagr1y !== null);
    assert.equal(Math.round(cagr1y * 10) / 10, 20.0);
    // 2 years, +44% (1.44^0.5 - 1 = +20%)
    const cagr2y = calculateCagr(144, 100, 2.0);
    assert.ok(cagr2y !== null);
    assert.equal(Math.round(cagr2y * 10) / 10, 20.0);
    // Loss: 1 year, -10%
    const cagrLoss = calculateCagr(90, 100, 1.0);
    assert.ok(cagrLoss !== null);
    assert.equal(Math.round(cagrLoss * 10) / 10, -10.0);
    // Invalid capital or value
    assert.strictEqual(calculateCagr(100, 0, 1.0), null);
    assert.strictEqual(calculateCagr(0, 100, 1.0), -100);
});

test('parseEolDate parses YYYYMMDD and standard dates', () => {
    assert.match(tweakerSource, /function parseEolDate/);
    const context = {
        parseEolDate: null,
        dateAtUtcMidnight: (val) => {
            const m = String(val || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
        }
    };
    const code = tweakerSource.slice(
        tweakerSource.indexOf('function parseEolDate'),
        tweakerSource.indexOf('function eolGroup')
    );
    vm.runInNewContext(`${code}; parseEolDate = parseEolDate;`, context);
    const { parseEolDate } = context;

    const ts1 = parseEolDate('20241231');
    assert.strictEqual(ts1, Date.UTC(2024, 11, 31));
    const ts2 = parseEolDate('2023-06-15');
    assert.strictEqual(ts2, Date.UTC(2023, 5, 15));
    assert.strictEqual(parseEolDate(''), null);
    assert.strictEqual(parseEolDate(null), null);
});

test('depot dashboard integrates risk check, exit radar and CAGR ranking', () => {
    assert.match(tweakerSource, /function renderRiskCheck/);
    assert.match(tweakerSource, /function renderExitRadar/);
    assert.match(tweakerSource, /Portfolio- & Klumpenrisiko-Check/);
    assert.match(tweakerSource, /EOL-Exit-Planer & Liquidations-Radar/);
    assert.match(tweakerSource, /Stärkste Jahresrendite \(p\.a\.\)/);
    assert.match(tweakerSource, /Ø Jahresrendite \(CAGR\)/);
    assert.match(tweakerSource, /bmd-stage-fresh/);
    assert.match(tweakerSource, /bmd-stage-maturing/);
    assert.match(tweakerSource, /bmd-stage-mature/);
    assert.match(tweakerSource, /bmd-status-ready/);
});

test('depot inventory offer row integration parses merchants, calculates average EKs, and protects calculations', () => {
    // Assert required functions and selectors exist in tweaker source
    assert.match(tweakerSource, /function extractLotMerchant/);
    assert.match(tweakerSource, /function injectDepotInventoryOfferRow/);
    assert.match(tweakerSource, /function syncDepotOfferRow/);
    assert.match(tweakerSource, /bm-depot-inventory-offer/);
    assert.match(tweakerSource, /bm-depot-inventory-tag/);
    assert.match(tweakerSource, /Dein Kauf/);
    assert.match(tweakerSource, /data-bm-depot-inventory/);
    assert.match(tweakerSource, /'depot-inventory'/);
    assert.match(tweakerSource, /dpfilter=alle/);

    // Verify exclusions in first IIFE
    assert.match(tweakerSource, /\.pricerow:not\(\[data-bm-marketplace="true"\]\):not\(\[data-bm-depot-inventory="true"\]\)/);
    assert.match(tweakerSource, /\.pricerow\[data-bm-marketplace="true"\]:not\(\[data-bm-depot-inventory="true"\]\)/);
    assert.match(tweakerSource, /discountRow\?\.dataset\.bmDepotInventory === 'true'/);
    assert.match(tweakerSource, /priceRow\?\.dataset\.bmDepotInventory === 'true'/);

    // Extract extractLotMerchant for isolated verification
    const merchantContext = { extractLotMerchant: null };
    const extractCode = tweakerSource.slice(
        tweakerSource.indexOf('function extractLotMerchant'),
        tweakerSource.indexOf('async function loadDepotData')
    );
    vm.runInNewContext(`${extractCode}; extractLotMerchant = extractLotMerchant;`, merchantContext);
    const { extractLotMerchant } = merchantContext;

    // Test 1: Merchant from edit.dataset.note or merchant
    assert.equal(extractLotMerchant(null, { dataset: { note: 'Amazon' } }), 'Amazon');
    assert.equal(extractLotMerchant(null, { dataset: { merchant: 'Smyths Toys' } }), 'Smyths Toys');
    assert.equal(extractLotMerchant(null, { dataset: { shop: 'LEGO' } }), 'LEGO');
    assert.equal(extractLotMerchant(null, { dataset: { seller: 'Alternate' } }), 'Alternate');

    // Test 2: Fallback from lot element
    const fakeLot = {
        querySelector(selector) {
            if (selector.includes('dp-note')) return { textContent: '  Müller  ' };
            return null;
        },
        textContent: 'Lot 1 (Amazon)'
    };
    assert.equal(extractLotMerchant(fakeLot, null), 'Müller');

    const fakeLotTextOnly = {
        querySelector() { return null; },
        textContent: 'Lot 1 (Alternate)'
    };
    assert.equal(extractLotMerchant(fakeLotTextOnly, null), 'Alternate');
});

test('depot inventory offer row correctly displays single vs multiple merchants and prices', () => {
    // Single merchant with multi-price
    const testLots1 = [
        { qty: 1, price: 100, merchant: 'Amazon' },
        { qty: 2, price: 130, merchant: 'Amazon' }
    ];
    let totalQty1 = 0;
    let totalCap1 = 0;
    const prices1 = new Set();
    const merchants1 = new Set();
    testLots1.forEach(l => {
        totalQty1 += l.qty;
        totalCap1 += l.price * l.qty;
        prices1.add(l.price);
        if (l.merchant) merchants1.add(l.merchant);
    });
    const avg1 = Math.round((totalCap1 / totalQty1 + Number.EPSILON) * 100) / 100;
    const isMultiPrice1 = prices1.size > 1;
    const merchantLabel1 = merchants1.size > 1 ? 'Divers' : (Array.from(merchants1)[0] || '');
    assert.equal(avg1, 120);
    assert.equal(isMultiPrice1, true);
    assert.equal(merchantLabel1, 'Amazon');

    // Multiple merchants with same price
    const testLots2 = [
        { qty: 1, price: 150, merchant: 'Amazon' },
        { qty: 1, price: 150, merchant: 'LEGO Shop' }
    ];
    const prices2 = new Set();
    const merchants2 = new Set();
    testLots2.forEach(l => {
        prices2.add(l.price);
        if (l.merchant) merchants2.add(l.merchant);
    });
    const isMultiPrice2 = prices2.size > 1;
    const merchantLabel2 = merchants2.size > 1 ? 'Divers' : (Array.from(merchants2)[0] || '');
    assert.equal(isMultiPrice2, false);
    assert.equal(merchantLabel2, 'Divers');
});

test('Google Sheets Sync settings storage and retrieval', () => {
    assert.match(tweakerSource, /SHEETS_SYNC_SETTINGS_KEY = 'brickmerge-depot-sheets-sync-v1'/);
    assert.match(tweakerSource, /function readSheetsSyncSettings/);
    assert.match(tweakerSource, /function saveSheetsSyncSettings/);

    const context = {
        window: {
            localStorage: {
                _store: {},
                getItem(k) { return this._store[k] || null; },
                setItem(k, v) { this._store[k] = String(v); }
            }
        },
        SHEETS_SYNC_SETTINGS_KEY: 'brickmerge-depot-sheets-sync-v1'
    };
    const code = tweakerSource.slice(
        tweakerSource.indexOf('function readSheetsSyncSettings'),
        tweakerSource.indexOf('function copyToClipboard')
    );
    vm.runInNewContext(`${code}; readSheetsSyncSettings = readSheetsSyncSettings; saveSheetsSyncSettings = saveSheetsSyncSettings;`, context);
    const { readSheetsSyncSettings, saveSheetsSyncSettings } = context;

    // Default settings
    const defaults = readSheetsSyncSettings();
    assert.equal(defaults.webhookUrl, '');
    assert.equal(defaults.sheetName, 'Brickmerge Depot');
    assert.equal(defaults.mode, 'lots');
    assert.equal(defaults.lastSyncedAt, null);

    // Save settings
    saveSheetsSyncSettings({
        webhookUrl: 'https://script.google.com/macros/s/xyz/exec',
        sheetName: 'Mein Lego Depot',
        mode: 'sets',
        lastSyncedAt: 1700000000000,
        lastSyncedCount: 50
    });

    const updated = readSheetsSyncSettings();
    assert.equal(updated.webhookUrl, 'https://script.google.com/macros/s/xyz/exec');
    assert.equal(updated.sheetName, 'Mein Lego Depot');
    assert.equal(updated.mode, 'sets');
    assert.equal(updated.lastSyncedAt, 1700000000000);
    assert.equal(updated.lastSyncedCount, 50);
});

test('Google Sheets Sync buildSheetsPayload in lots and sets mode', () => {
    assert.match(tweakerSource, /function buildSheetsPayload/);

    const context = {};
    const code = tweakerSource.slice(
        tweakerSource.indexOf('function buildSheetsPayload'),
        tweakerSource.indexOf('async function postToGoogleSheets')
    );
    vm.runInNewContext(`${code}; buildSheetsPayload = buildSheetsPayload;`, context);
    const { buildSheetsPayload } = context;

    const sampleRecords = [
        {
            item: '101',
            setNumber: '75192',
            name: 'Millennium Falcon',
            theme: 'Star Wars',
            quantity: 1,
            condition: 'neu',
            capital: 600.0,
            best: 750.0,
            currentValue: 750.0,
            purchaseDate: '2023-01-15',
            merchant: 'Amazon',
            storage: 'Keller',
            eol: 'Aktiv',
            ageDays: 300
        },
        {
            item: '101',
            setNumber: '75192',
            name: 'Millennium Falcon',
            theme: 'Star Wars',
            quantity: 2,
            condition: 'neu',
            capital: 1400.0,
            best: 750.0,
            currentValue: 1500.0,
            purchaseDate: '2023-06-01',
            merchant: 'LEGO Store',
            storage: 'Dachboden',
            eol: 'Aktiv',
            ageDays: 160
        },
        {
            item: '102',
            setNumber: '10300',
            name: 'Zurück in die Zukunft Zeitmaschine',
            theme: 'Creator Expert',
            quantity: 1,
            condition: 'neu',
            capital: 150.0,
            best: 180.0,
            currentValue: 180.0,
            purchaseDate: '2023-05-10',
            merchant: 'Smyths Toys',
            storage: 'Regal 1',
            eol: 'EOL',
            ageDays: 180
        }
    ];

    // 1. Lots mode
    const lotsPayload = buildSheetsPayload(sampleRecords, { sheetName: 'Test Depot', mode: 'lots' });
    assert.equal(lotsPayload.sheetName, 'Test Depot');
    assert.equal(lotsPayload.mode, 'lots');
    assert.equal(lotsPayload.headers.length, 17);
    assert.ok(lotsPayload.headers.includes('Setnummer'));
    assert.ok(lotsPayload.headers.includes('EK Einzel (€)'));
    assert.ok(lotsPayload.headers.includes('Händler'));
    assert.ok(lotsPayload.headers.includes('Brickmerge-Link'));
    assert.equal(lotsPayload.rows.length, 3);

    // Check first lot row (Falcon Lot 1)
    const lot1 = lotsPayload.rows[0];
    assert.equal(lot1[0], '75192');
    assert.equal(lot1[1], 'Millennium Falcon');
    assert.equal(lot1[3], 1);
    assert.equal(lot1[5], 600.0);
    assert.equal(lot1[6], 600.0);
    assert.equal(lot1[7], 750.0);
    assert.equal(lot1[8], 750.0);
    assert.equal(lot1[9], 150.0);
    assert.equal(lot1[10], 25.0);
    assert.equal(lot1[12], 'Amazon');
    assert.equal(lot1[13], 'Keller');
    assert.equal(lot1[15], 300);
    assert.ok(lot1[16].includes('75192'));

    // Summary check
    assert.equal(lotsPayload.summary.totalSets, 2);
    assert.equal(lotsPayload.summary.totalPieces, 4);
    assert.equal(lotsPayload.summary.totalCapital, 2150.0);
    assert.equal(lotsPayload.summary.totalCurrentValue, 2430.0);
    assert.equal(lotsPayload.summary.totalProfit, 280.0);

    // 2. Sets mode (aggregation)
    const setsPayload = buildSheetsPayload(sampleRecords, { sheetName: 'Aggregiert', mode: 'sets' });
    assert.equal(setsPayload.sheetName, 'Aggregiert');
    assert.equal(setsPayload.mode, 'sets');
    assert.equal(setsPayload.rows.length, 2);
    assert.ok(setsPayload.headers.includes('Ø-EK Einzel (€)'));

    // Aggregated 75192
    const aggFalcon = setsPayload.rows.find(r => r[0] === '75192');
    assert.ok(aggFalcon);
    assert.equal(aggFalcon[3], 3);
    assert.equal(aggFalcon[4], 666.67);
    assert.equal(aggFalcon[5], 2000.0);
    assert.equal(aggFalcon[7], 2250.0);
    assert.equal(aggFalcon[8], 250.0);
    assert.equal(aggFalcon[9], 12.5);
    assert.ok(aggFalcon[10].includes('Amazon'));
    assert.ok(aggFalcon[10].includes('LEGO Store'));
});

test('Google Sheets Apps Script webhook template contains robust handling and number formats', () => {
    assert.match(tweakerSource, /const GOOGLE_APPS_SCRIPT_TEMPLATE = `/);
    assert.match(tweakerSource, /function doPost\(e\)/);
    assert.match(tweakerSource, /function doGet\(e\)/);
    assert.match(tweakerSource, /SpreadsheetApp\.getActiveSpreadsheet\(\)/);
    assert.match(tweakerSource, /sheet\.setFrozenRows\(1\)/);
    assert.match(tweakerSource, /autoResizeColumn/);
    assert.match(tweakerSource, /setNumberFormat\('#,##0\.00 "€"'\)/);
    assert.match(tweakerSource, /setNumberFormat\('0\.0 "%"'\)/);
    assert.match(tweakerSource, /setNumberFormat\('yyyy-mm-dd'\)/);
});

test('Google Sheets UI elements and menu commands are wired', () => {
    assert.match(tweakerSource, /function setupGoogleSheetsDepotSync\(\)/);
    assert.match(tweakerSource, /bmd-sheets-sync-btn-group/);
    assert.match(tweakerSource, /bmd-sheets-sync-btn/);
    assert.match(tweakerSource, /bmd-sheets-settings-btn/);
    assert.match(tweakerSource, /openGoogleSheetsConfigOverlay/);
    assert.match(tweakerSource, /executeGoogleSheetsSync/);
    assert.match(tweakerSource, /📑 Google Sheet Depot-Sync/);
    assert.match(tweakerSource, /⚙️ Google Sheet Sync Einstellungen/);
});

test('depot inventory offer row integrates ROI calculator button with actual purchase price', () => {
    assert.match(tweakerSource, /bmd-depot-roi-btn/);
    assert.match(tweakerSource, /bmd-depot-roi-icon/);
    assert.match(tweakerSource, /bmd-depot-roi-text/);
    assert.match(tweakerSource, /openRoiCalculatorOverlay\(setNumber, depotData\.purchasePrice, roiButton\)/);
    assert.match(tweakerSource, /event\.stopPropagation\(\)/);
});

test('list view integrates compact 2-row layout, inline EOL badge, and merchant resolver', () => {
    assert.match(tweakerSource, /bmEnhanceListViewCards/);
    assert.match(tweakerSource, /bmResolveCardMerchant/);
    assert.match(tweakerSource, /bmExtractCheapestMerchantFromHtml/);
    assert.match(tweakerSource, /bmExtractEolFromHtml/);
    assert.match(tweakerSource, /bmListEolCache/);
    assert.match(tweakerSource, /\.bm-list-eol/);
    assert.match(tweakerSource, /\.bm-list-merchant/);
    assert.match(tweakerSource, /grid-template-areas:\s*["']thumb header["']\s*["']thumb price["']/);
});

test('list view keeps the price on one line and the merchant in its own row', () => {
    // Der Preis startet bündig unter dem Titel: das Theme-Padding der offerbox fällt weg.
    assert.match(
        tweakerSource,
        /html\[data-bm-view="list"\][^}]+\.productprice \.offerbox \{\s*min-height: 0 !important;[\s\S]*?padding: 0 !important;/
    );
    // Zwei eigene Zeilen in .productprice: Preisreihe, darunter der Händler.
    assert.match(
        tweakerSource,
        /html\[data-bm-view="list"\][^}]+\.productprice \{[\s\S]*?flex-direction: column !important;[\s\S]*?align-items: flex-start !important;/
    );
    assert.match(tweakerSource, /\(priceArea \|\| offerBox\)\.appendChild\(merchantBadge\);/);
    assert.doesNotMatch(tweakerSource, /fragment\.appendChild\(merchantBadge\)/);
    // In der Ein-Spalten-Liste darf die Preiszeile nicht umbrechen; nur der UVP gibt Breite nach.
    assert.match(
        tweakerSource,
        /html\[data-bm-view="list"\][^}]+\.productprice \.offerbox \{\s*flex-wrap: nowrap !important;\s*\}/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.stroke \{\s*flex: 0 1 auto !important;[\s\S]*?text-overflow: ellipsis !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.bm-list-black-bubble \{\s*flex: 0 0 auto !important;/
    );
    assert.match(
        tweakerSource,
        /html\[data-bm-view="list"\][^}]+\.productprice \.offerbox \{[\s\S]*?font-size: 0 !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.theprice \{[\s\S]*?order: 1 !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > :is\(\.off, \.bm-list-off\) \{[\s\S]*?order: 2 !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.bm-list-black-bubble \{[\s\S]*?order: 3 !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.stroke \{[\s\S]*?order: 4 !important;/
    );
    assert.match(
        tweakerSource,
        /\.offerbox > \.bm-list-eol \{\s*order: 5 !important;\s*\}/
    );
});

test('list view EOL extraction accurately parses specification rows, product tags, and textual EOL without external requests', () => {
    const htmlSpec = '<br /> | Release: <strong>11/2022</strong>, EOL: <strong>&asymp;07/2027</strong>, <span class="tooltipster">PLC:</span>';
    const htmlRetired = '<br /> | Release: <strong>10/2019</strong>, EOL: <strong>12/2022</strong>,';

    const specMatch = htmlSpec.match(/EOL:\s*<strong>\s*([^<]+)<\/strong>/i);
    assert.ok(specMatch);
    assert.equal(specMatch[1].replace(/&asymp;|≈/g, '').trim(), '07/2027');

    const retiredMatch = htmlRetired.match(/EOL:\s*<strong>\s*([^<]+)<\/strong>/i);
    assert.ok(retiredMatch);
    assert.equal(retiredMatch[1].replace(/&asymp;|≈/g, '').trim(), '12/2022');

    assert.match(tweakerSource, /fetch\(task\.url,\s*\{\s*credentials:\s*['"]same-origin['"]\s*\}\)/);
});

test('mobile filter bar integrates 3x2 grid layout, SVG category icons, and clean zero-scrolling display', () => {
    assert.match(tweakerSource, /#contenttoprow\s+\.small-12\.columns\s*\{[^}]*display:\s*grid\s*!important/);
    assert.match(tweakerSource, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*!important/);
    assert.match(tweakerSource, /\.bm-filter-icon/);
    assert.match(tweakerSource, /\.bm-filter-svg/);
    assert.match(tweakerSource, /\.bm-filter-label/);
    assert.match(tweakerSource, /openFilterBottomSheet/);
    assert.match(tweakerSource, /filterConfigs/);
});

test('reveal modal dialogs (Rabattalarm, Deal-Alarm, Login) are centered and styled modernly', () => {
    assert.match(tweakerSource, /\.reveal-modal,\s*#myModal/);
    assert.match(tweakerSource, /margin:\s*auto\s*!important/);
    assert.match(tweakerSource, /width:\s*calc\(100vw\s*-\s*32px\)\s*!important/);
    assert.match(tweakerSource, /max-width:\s*440px\s*!important/);
    assert.match(tweakerSource, /#myModal\s+\.modalheader/);
    assert.match(tweakerSource, /#myModal\s+\.close-reveal-modal/);
});

test('view switcher is restricted to pages with set offers and protects merchants and themes grids', () => {
    assert.match(tweakerSource, /body:has\(\.wrapper\.merchants\)\s+\.bm-view-switcher/);
    assert.match(tweakerSource, /body:has\(\.wrapper\.themen\)\s+\.bm-view-switcher/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+:is\(#productrow,\s*\.productrow\)\s+\.wrapper:not\(\.merchants\):not\(\.themen\):not\(\.brickstores\)/);
    assert.match(tweakerSource, /hasSetOffers/);
    assert.match(tweakerSource, /isDetailPage/);
    // Der URL-Regex frueherer Versionen hat auch die Haendler-Filterseite ausgesperrt,
    // obwohl die echte Set-Inserate hat. Kachel-Optik haengt jetzt an [data-bm-card].
    assert.doesNotMatch(tweakerSource, /isNonOfferListingPage/);
    assert.doesNotMatch(tweakerSource, /LEGO-Themen\|themen/);
});

test('filter dropdown arrows are completely removed from pseudo-elements', () => {
    assert.match(tweakerSource, /#contenttoprow\s+a\.button\.dropdown::before/);
    assert.match(tweakerSource, /#contenttoprow\s+a\.button\.dropdown::after/);
    assert.match(tweakerSource, /\.viewDropDown::before/);
    assert.match(tweakerSource, /\.viewDropDown::after/);
    const precleanSource = fs.readFileSync(
        new URL('../src/preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(precleanSource, /#contenttoprow\s+\.dropdown\.button::before/);
    assert.match(precleanSource, /#contenttoprow\s+\.dropdown\.button::after/);
});

test('eBay logo in best price box is one SVG figure sized like the other logos', () => {
    assert.match(tweakerSource, /function createEbayLogoHtml/);
    assert.match(tweakerSource, /function decorateNativeToppriceEbayLogo/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell\.bm-ebay-logo-link\.bm-has-meta/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell\s+\.bm-ebay-wordmark/);
    // Die Figur nutzt dieselbe Zellengröße wie die Händlerbilder daneben.
    assert.match(
        tweakerSource,
        /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell\s+\.bm-marketplace-logo\s*\{[^}]*max-width:\s*84px\s*!important;[^}]*max-height:\s*31px\s*!important;/
    );

    // Verify that "gewerblich" caption and layout breaks are prevented in the best price box
    assert.doesNotMatch(tweakerSource, /captionText:\s*'gewerblich'/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell\s+\.bm-marketplace-logo-meta/);
});

test('merchant page list view synchronously resolves merchant and prevents EOL fetch overwrites', () => {
    assert.match(tweakerSource, /function bmGetPageMerchantName/);
    assert.match(tweakerSource, /const pageMerchant = bmGetPageMerchantName\(\);/);
    assert.match(tweakerSource, /curNeedsMerchant\s*\?\s*merchant =>/);
    assert.match(tweakerSource, /\(curNeedsEol && tEol\)\s*\?\s*eol =>/);
    assert.match(tweakerSource, /card\.dataset\.bmNeedsMerchant\s*=\s*needsMerchant/);
    assert.match(tweakerSource, /card\.dataset\.bmNeedsEol\s*=\s*needsEol/);
    assert.match(tweakerSource, /\.bm-list-merchant:empty/);

    // Regex-Prüfungen der Händler-Erkennung
    const sampleSwitchHtml = '<a href="/?theme=Top-Angebote&fm=419&sc=1">Nur Baby-Walz Bestpreisangebote zeigen</a>';
    const matchSwitch = sampleSwitchHtml.match(/(?:Nur|Keine)\s+(.*?)\s+Bestpreis/i);
    assert.ok(matchSwitch);
    assert.equal(matchSwitch[1], 'Baby-Walz');

    const sampleTitle = 'LEGO® bei Baby-Walz im Preisvergleich | Brickmerge';
    const matchTitle = sampleTitle.match(/LEGO[®]?\s+bei\s+([^|]+?)(?:\s+im\s+Preisvergleich|\s*\|)/i);
    assert.ok(matchTitle);
    assert.equal(matchTitle[1], 'Baby-Walz');
});

test('best price switch on merchant pages spans full grid width and is styled as modern toggle card', () => {
    assert.match(tweakerSource, /#contenttoprow\s+\.small-12\.columns\s*>\s*\.button:has\(form\[name="sctoggle"\]\)/);
    assert.match(tweakerSource, /#contenttoprow\s+\.bm-bestprice-toggle\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*!important/);
    assert.match(tweakerSource, /#contenttoprow\s+\.bm-bestprice-toggle\s*\{[^}]*display:\s*flex\s*!important/);
    assert.match(tweakerSource, /\.bm-bestprice-toggle-label/);
    assert.match(tweakerSource, /sctoggleWrapper\s*\.querySelectorAll\('\.bm-bestprice-star-icon,\s*\[class\*="star" i\]'\)\s*\.forEach\(el\s*=>\s*el\.remove\(\)\)/);
    assert.match(tweakerSource, /link\.firstChild\.nodeValue\s*=\s*link\.firstChild\.nodeValue\s*\.replace\(\/\^\[\\s\\u2605\\u2606\\u2b50\\u2729\\u272a\\u272f\]\+\//);
    assert.match(tweakerSource, /#contenttoprow\s+form\[name="sctoggle"\]\s+\.slider\.round/);
    assert.match(tweakerSource, /\.bm-bestprice-toggle\.bm-bestprice-active/);
    assert.match(tweakerSource, /#contenttoprow\s+\.bm-bestprice-toggle\.bm-bestprice-active\s+form\[name="sctoggle"\]\s+\.slider\.round/);
    assert.match(tweakerSource, /sctoggleWrapper\.classList\.toggle\(['"]bm-bestprice-active['"]/);
    assert.match(tweakerSource, /sctoggleWrapper\.addEventListener\(['"]click['"],\s*executeToggle,\s*true\)/);
});

test('preclean.js scopes sctoggle to detail pages and does not block merchant filter bar', () => {
    assert.match(precleanSource, /#offerlist\s+form\[name="sctoggle"\]/);
    assert.match(precleanSource, /\.content\.setdetails\s+form\[name="sctoggle"\]/);
    assert.doesNotMatch(precleanSource, /html\.bm-extension-cleaner-enabled\s+form\[name="sctoggle"\],/);
});

test('bmExtractEolFromHtml handles flexible EOL markup with entities and producttags', () => {
    // 1. EOL with &asymp; outside or inside strong
    const htmlAsympOutside = '<div>EOL: &asymp;<strong>08/2026</strong>, Release: <strong>01/2024</strong></div>';
    const htmlNoTag = '<div>EOL: 12/2025, Release: 03/2023</div>';
    const htmlTagSpan = '<span class="producttag">Auslaufartikel 12/24</span>';
    const htmlRetired = '<div>Status: Auslaufartikel</div>';

    const specMatchOutside = htmlAsympOutside.match(/EOL\s*[:]\s*(?:<[^>]+>\s*)*(?:&asymp;|≈)?\s*(?:<[^>]+>\s*)*([^<,;\n\r]+)/i);
    assert.ok(specMatchOutside);
    assert.match(specMatchOutside[1], /08\/2026/);

    const specMatchNoTag = htmlNoTag.match(/EOL\s*[:]\s*(?:<[^>]+>\s*)*(?:&asymp;|≈)?\s*(?:<[^>]+>\s*)*([^<,;\n\r]+)/i);
    assert.ok(specMatchNoTag);
    assert.match(specMatchNoTag[1], /12\/2025/);

    const tagMatchSpan = htmlTagSpan.match(/class=["'][^"']*producttag[^"']*["'][^>]*>([^<]*(?:auslauf|eol|end of life)[^<]*)<\/[a-z0-9]+>/i);
    assert.ok(tagMatchSpan);
    assert.match(tagMatchSpan[1], /12\/24/);

    assert.ok(/Auslaufartikel/i.test(htmlRetired));

    assert.match(tweakerSource, /function bmApplyEolToAllCards/);
    assert.match(tweakerSource, /bmApplyEolToAllCards\(task\.setKey,\s*eol\)/);
});

test('list view swaps placement of percentage discount and EOL badge, and classic grid cards integrate merchant and EOL', () => {
    // 1. List view: EOL badge at top-left, discount badge inline in offerbox
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.bm-list-eol[^}]*top:\s*4px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.bm-list-eol[^}]*left:\s*4px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.off[^}]*position:\s*static\s*!important/);
    assert.match(tweakerSource, /offBadge\.classList\.add\(['"]bm-list-off['"]\)/);

    // 2. Classic grid cards: bookmark/alarm icons hidden, top-badge top-right, EOL in offerbox, split CTA
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+a\[id\^="merk"\]/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.bm-card-top-badge[^}]*top:\s*4px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.bm-card-top-badge[^}]*right:\s*4px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productprice\s+\.bm-list-eol/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.bm-split-cta/);
    assert.match(tweakerSource, /function bmApplyMerchantToCard/);
});

test('set detail page adds native modal CTAs for Preisalarm and Wunschliste near depot button and removes icons from listview', () => {
    assert.match(tweakerSource, /function openNativePriceAlarm/);
    assert.match(tweakerSource, /function openNativeWishlistAdd/);
    assert.match(tweakerSource, /a=pricealarm&i=/);
    assert.match(tweakerSource, /a=wishlistadd&i=/);
    assert.match(tweakerSource, /bmd-alarm-button/);
    assert.match(tweakerSource, /bmd-wishlist-button/);

    // Listview removes icons and resets padding
    assert.match(tweakerSource, /card\.querySelectorAll\('a\[id\^="merk"\], a\[id\^="a"\], a\[id\^="dp"\], \.bm-slidebadge'\)\.forEach\(el => el\.remove\(\)\)/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.producttitle[^}]*padding-right:\s*0\s*!important/);
});

test('marketplace best price box logo cell stretches 100% height and red discount bubble is strictly for UVP discounts without negative signs', () => {
    // 1. Logo cell stretch & height
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-overall-bestprice-link\s+\.bm-topprice-logo-cell[^}]*align-self:\s*stretch\s*!important/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-overall-bestprice-link\s+\.bm-topprice-logo-cell[^}]*min-height:\s*100%\s*!important/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[^}]*height:\s*100%\s*!important/);
    assert.doesNotMatch(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[^}]*height:\s*35px\s*!important/);

    // 2. No negative percentage bubbles or rogue red bubble vs retailer
    assert.doesNotMatch(tweakerSource, /bubbleText\s*=\s*`-\$\{discountPercent\}%`/);
    assert.doesNotMatch(tweakerSource, /günstiger als Brickmerge-Bestpreis\s*\(\$\{formatEuroValue\(retailerBest - marketplaceBest\.price\)\}\s*€ Ersparnis\)/);
});

test('mobile view narrows merchant logo column by 10% in offerlist (22.5%) and bestprice bar (22.5%)', () => {
    // 1. Offerlist columns narrowed from 25% to 22.5% on mobile
    assert.match(tweakerSource, /#offerlist\s+\.row\.collapse\s*>\s*\.goto\.small-3\.columns[^}]*width:\s*22\.5%\s*!important/);
    assert.match(tweakerSource, /#offerlist\s+\.row\.collapse\s*>\s*\.medium-4\.small-9\.columns\.pricerow[^}]*width:\s*77\.5%\s*!important/);
    assert.match(tweakerSource, /#offerlist\s+\.row\.collapse\.bm-effective-row\s*>\s*\.goto\.small-3\.columns[^}]*width:\s*22\.5%\s*!important/);
    assert.match(tweakerSource, /#offerlist\s+\.row\.collapse\.bm-effective-row\s*>\s*\.medium-4\.small-9\.columns\.pricerow[^}]*width:\s*77\.5%\s*!important/);

    // 2. Topprice logo column matches offerlist 22.5% on mobile
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[^}]*width:\s*22\.5%\s*!important/);
});
test('theme line is inserted under article number with leading pipe and breadcrumbs are hidden on mobile', () => {
    assert.match(tweakerSource, /function insertThemeUnderArticleNumber/);
    assert.match(tweakerSource, /\.bm-theme-row/);
    // Die Beschriftung gehört in den Anker, damit die Zeile komplett markiert.
    assert.match(
        tweakerSource,
        /&nbsp;\|\s*<a class="bm-detail-line-link bm-theme-link"[^>]*>Theme:\s*<strong>/
    );
    assert.match(tweakerSource, /@media\s*\(max-width:\s*64em\)\s*\{[\s\S]*?\[itemscope\]\[itemtype\*="BreadcrumbList"\][\s\S]*?display:\s*none\s*!important;/);
});

test('Info-Block markiert jede Zeile gleich und ohne hängenden Fokus', () => {
    const hoverRule = tweakerSource.match(
        /\.bm-detail-line-link:hover,[\s\S]*?\n        \}/
    );
    assert.ok(hoverRule, 'Die gemeinsame Hover-Regel des Info-Blocks fehlt');
    assert.match(hoverRule[0], /\.bm-designer-link:hover/);
    assert.match(hoverRule[0], /\.bm-theme-link:hover/);
    assert.match(hoverRule[0], /\.bm-price-history-link:hover/);
    // :focus ohne -visible bleibt nach dem Klick stehen und wirkt wie ein
    // zweiter, unerklärlicher Zustand.
    assert.doesNotMatch(hoverRule[0], /:focus(?!-visible)/);

    // Theme und Designer ziehen die Beschriftung in den Anker, damit die ganze
    // Zeile markiert wird – anders als vorher.
    assert.match(tweakerSource, /function takeDesignerLabelFrom/);
    assert.match(
        tweakerSource,
        /createDesignerLink\(\s*designer,\s*index === 0 \? label : ''/
    );

    // Die Sprungmarke „akt. Bestpreis" kommt mit einer Hintergrundfarbe als
    // inline-Feld vom Server – ohne !important bliebe sie beim Hover stehen.
    assert.match(hoverRule[0], /background-color:\s*#700\s*!important/);
    assert.match(
        tweakerSource,
        /root\.querySelectorAll\('a\[href="#offerlist"\]'\)\.forEach\(\s*anchor => \{\s*anchor\.classList\.add\('bm-detail-line-link'\)/
    );
});

test('startseite centers Deal-Alarm and hides SEO intro paragraphs without hiding jump targets', () => {
    assert.match(tweakerSource, /function removeThemePromoBlock/);
    assert.match(tweakerSource, /\.content\.isIntro\s+\.showmore/);
    assert.match(tweakerSource, /\.bmh,\s*\.bmh-actionsRow[\s\S]*?text-align:\s*center\s*!important/);
    assert.doesNotMatch(tweakerSource, /\.content\.isIntro\s*>\s*\.row:first-child/);
    assert.match(tweakerSource, /#highlights,\s*#produktbilder,\s*#bauanleitungen,\s*#brickmerge_telegram/);
    assert.match(tweakerSource, /function setupJumpLinks/);
});

test('go to top button keeps the app look: borderless, on top, raised', () => {
    assert.match(tweakerSource, /#toTop\s*\{[^}]*border:\s*none\s*!important/);
    assert.match(tweakerSource, /#toTop\s*\{[^}]*z-index:\s*2147483647\s*!important/);
    assert.match(tweakerSource, /#toTop\s*\{[^}]*opacity:\s*0\.9\s*!important/);
    assert.match(tweakerSource, /#toTop\s*\{[^}]*box-shadow:\s*0 4px 14px rgba\(0, 0, 0, 0\.3\)\s*!important/);
    assert.match(
        tweakerSource,
        /#toTop:hover,\s*#toTop:active,\s*#toTop:focus\s*\{\s*opacity:\s*1\s*!important/
    );
});

test('modal dialogs hide desktop scrollbars while preserving scrolling', () => {
    assert.match(tweakerSource, /\.reveal-modal,\s*#myModal,\s*\.bm-modal,[\s\S]*?scrollbar-width:\s*none\s*!important/);
    assert.match(tweakerSource, /\.reveal-modal::-webkit-scrollbar,[\s\S]*?display:\s*none\s*!important/);
});

test('desktop filters remain original and setupMobileFilterBar scopes strictly to mobile', () => {
    assert.match(tweakerSource, /function setupMobileFilterBar\(\)\s*\{[\s\S]*?window\.innerWidth\s*>\s*768/);
});

test('direct shop links decode HTML entities &amp; and &#38; in URL parameters', () => {
    assert.match(tweakerSource, /rawUrl\s*=\s*rawUrl\.replace\(\/&amp;\/g,\s*'&'\)\.replace\(\/&#0\*38;\/g,\s*'&'\)/);
    assert.match(tweakerSource, /const cleanUrl\s*=\s*bmGo2DirectUrl\(String\(shopUrl\)\.replace\(\/&amp;\/g,\s*'&'\)/);
});

test('desktop header with search bar remains original while tiles background is white', () => {
    assert.match(tweakerSource, /#productrowcontainer,\s*#productrow,\s*\.productrow,\s*#productrowcontainer\s*>\s*\.bm-view-switcher,\s*\.bm-view-switcher\s*\{[^}]*background:\s*#FFFFFF\s*!important/);
    assert.doesNotMatch(tweakerSource, /#wrap[^{]*\{[^}]*background:\s*#FFFFFF/);
    assert.doesNotMatch(tweakerSource, /#filterrow\s*\{[^}]*background:\s*#b00/);
    const precleanSource = fs.readFileSync(
        new URL('../src/preclean.js', import.meta.url),
        'utf8'
    );
    assert.match(precleanSource, /#productrowcontainer,\s*#productrow/);
    assert.doesNotMatch(precleanSource, /#wrap[^{]*\{[^}]*background:\s*#FFFFFF/);
    assert.doesNotMatch(precleanSource, /#filterrow\s*\{[^}]*background:\s*#b00/);
});

test('classic tile cards enlarge product image without grey area protrusion and remove useless line above CTAs', () => {
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productimg\s*\{[^}]*width:\s*100%\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productimg\s*\{[^}]*height:\s*155px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productimg\s+img\s*\{[^}]*max-height:\s*145px\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productprice\s*\{[^}]*height:\s*auto\s*!important/);
});

test('detail action row contains strictly 4 buttons without duplicates and sidebar parts list has zero action buttons', () => {
    // 1. Sidebar parts list strips any buttons
    assert.match(tweakerSource, /list\.querySelectorAll\('button, \.bmd-open-button, \.bmd-parts-stock-button, \.bmd-depot-button'\)\.forEach/);
    // 2. Stray buttons outside .bm-detail-action-buttons-row are removed
    assert.match(tweakerSource, /document\.querySelectorAll\('\.bmd-open-button, \.bmd-parts-stock-button, \.bmd-depot-button'\)\.forEach\(btn => \{/);
    assert.match(tweakerSource, /if \(!btn\.closest\('\.bm-detail-action-buttons-row'\)\) \{\s*btn\.remove\(\);/);
    // 3. Multiple action rows are removed – die frisch eingehängte Zeile bleibt
    assert.match(tweakerSource, /document\.querySelectorAll\('\.bm-detail-action-buttons-row'\)\.forEach\(row => \{\s*if \(row !== actionRow\) row\.remove\(\);/);
    // 4. In-row duplicates are purged
    assert.match(tweakerSource, /actionRow\.querySelectorAll\('\.bmd-alarm-button'\)\.forEach\(\(btn, idx\) => \{ if \(idx > 0\) btn\.remove\(\); \}\);/);
    assert.match(tweakerSource, /actionRow\.querySelectorAll\('\.bmd-wishlist-button'\)\.forEach\(\(btn, idx\) => \{ if \(idx > 0\) btn\.remove\(\); \}\);/);
    assert.match(tweakerSource, /actionRow\.querySelectorAll\('\.bmd-roi-calculator-button'\)\.forEach\(\(btn, idx\) => \{ if \(idx > 0\) btn\.remove\(\); \}\);/);
    assert.match(tweakerSource, /actionRow\.querySelectorAll\('\.bmd-depot-button'\)\.forEach\(\(btn, idx\) => \{ if \(idx > 0\) btn\.remove\(\); \}\);/);
    // 5. Order is guaranteed
    assert.match(tweakerSource, /actionRow\.appendChild\(alarmButton\);/);
    assert.match(tweakerSource, /actionRow\.appendChild\(wishlistButton\);/);
    assert.match(tweakerSource, /actionRow\.appendChild\(roiButton\);/);
    assert.match(tweakerSource, /actionRow\.appendChild\(depotButton\);/);
});

test('list view is removed on desktop and scoped strictly to mobile', () => {
    // 1. CSS scopes list view strictly to mobile max-width: 768px
    assert.match(tweakerSource, /@media screen and \(max-width:\s*768px\)\s*\{\s*html\[data-bm-view="list"\]\s+(?::is\(#productrow,\s*\.productrow\)|#productrow)/);
    // 2. CSS hides view switcher on desktop min-width: 769px
    assert.match(tweakerSource, /@media screen and \(min-width:\s*769px\)\s*\{\s*\.bm-view-switcher\s*\{\s*display:\s*none\s*!important;/);
    assert.match(precleanSource, /@media screen and \(min-width:\s*769px\)\s*\{\s*\.bm-view-switcher\s*\{\s*display:\s*none\s*!important;/);
    // 3. JS setupListingView checks desktop and removes list view + switcher
    assert.match(tweakerSource, /if\s*\(window\.innerWidth\s*>\s*768\)\s*\{\s*document\.querySelector\('\.bm-view-switcher'\)\?\.remove\(\);\s*bmSetViewMode\('tile'\);/);
    // 4. JS applyViewMode aborts and cleans up if triggered on desktop
    assert.match(tweakerSource, /const applyViewMode = \(mode,\s*persist\s*=\s*false\)\s*=>\s*\{\s*if\s*\(window\.innerWidth\s*>\s*768\)\s*\{\s*bmSetViewMode\('tile'\);/);
    // Die Ansicht sitzt nur noch im data-bm-view-Attribut: ein fehlender Wert bedeutet
    // "keine Kachel-Optik" und nicht, wie beim classList-Entfernen, "Kacheln".
    assert.doesNotMatch(tweakerSource, /classList\.(?:add|remove|toggle)\('bm-view-list'/);
});

test('app mode hides breadcrumbs, headlinerow, and set title without white gap', () => {
    assert.match(tweakerSource, /html\.bm-android-app\s+#headlinerow,\s*html\.bm-android-app\s+#headlinerow\s+h1/);
    assert.match(tweakerSource, /html\.bm-android-app\s+\.content\.setdetails\s+h1/);
    assert.match(precleanSource, /html\.bm-android-app\s+#headlinerow/);
    assert.match(precleanSource, /html\.bm-android-app\s+\.content\.setdetails\s+h1/);
});

test('android bootstrap hides breadcrumbs even without the bm-android-app class', () => {
    const bootstrapUrl = new URL(
        '../../Android/app/src/main/assets/webview-bootstrap.js',
        import.meta.url
    );
    if (!fs.existsSync(bootstrapUrl)) return;
    const bootstrapSource = fs.readFileSync(bootstrapUrl, 'utf8');

    // Fallback ohne Klassen-Präfix: greift auch, wenn html.bm-android-app
    // (noch) nicht am Dokument hängt – sonst bleibt die Breadcrumb-Leiste stehen.
    assert.match(
        bootstrapSource,
        /\[itemscope\]\[itemtype\*="BreadcrumbList"\],\s*\.breadcrumb,\s*\.breadcrumbs,\s*nav\[aria-label="breadcrumb"\],\s*nav\.breadcrumbs,\s*#headlinerow,\s*#headlinerow h1,\s*\.content\.setdetails h1,\s*\.setdetails h1\s*\{\s*display:\s*none\s*!important;/
    );
    // Nur ausblenden, niemals aus dem DOM entfernen: die Theme-Erkennung
    // (bm-theme-row) liest Links und Text aus den Breadcrumb-Knoten.
    assert.doesNotMatch(bootstrapSource, /BreadcrumbList[^\n]*\.remove\(\)/);
});

test('asset cache version is derived from asset content, never hand-maintained', () => {
    const activityUrl = new URL(
        '../../Android/app/src/main/java/de/brickmerge/MainActivity.java',
        import.meta.url
    );
    const gradleUrl = new URL('../../Android/app/build.gradle.kts', import.meta.url);
    if (!fs.existsSync(activityUrl) || !fs.existsSync(gradleUrl)) return;

    const activity = fs.readFileSync(activityUrl, 'utf8');
    const gradle = fs.readFileSync(gradleUrl, 'utf8');

    // Die Version kommt aus dem BuildConfig ...
    assert.match(activity, /ASSET_CACHE_VERSION\s*=\s*BuildConfig\.ASSET_CACHE_VERSION/);
    // ... und ist keine handgepflegte Zahl mehr. Von 1.3.11 bis 1.3.28 stand hier
    // unveraendert ?v=4, obwohl sich die Datei jedes Mal geaendert hat – der
    // WebView hat deshalb 18 Releases lang die alte Fassung ausgeliefert.
    assert.doesNotMatch(activity, /ASSET_CACHE_VERSION\s*=\s*\d+\s*;/);
    // Beide injizierten Assets nutzen denselben Wert, damit sie nicht auseinanderdriften.
    assert.match(activity, /webview-bootstrap\.js\?v="\s*\+\s*ASSET_CACHE_VERSION/);
    assert.match(activity, /brickmerge-runtime\.js\?v="\s*\+\s*ASSET_CACHE_VERSION/);
    // Abgeleitet aus dem Inhalt beider Assets.
    assert.match(gradle, /buildConfigField\(\s*"String"\s*,\s*"ASSET_CACHE_VERSION"/);
    assert.match(gradle, /webview-bootstrap\.js/);
    assert.match(gradle, /brickmerge-tweaks\.runtime\.js/);
});

test('android toolbar background is translucent so content scrolls behind it', () => {
    const bgUrl = new URL(
        '../../Android/app/src/main/res/drawable/toolbar_background.xml',
        import.meta.url
    );
    if (!fs.existsSync(bgUrl)) return;
    const bg = fs.readFileSync(bgUrl, 'utf8');
    // Nicht mehr undurchsichtig (#9E0000 / #B80000): die Leiste liegt als
    // Overlay über dem WebView, der Inhalt muss dahinter durchscheinen.
    assert.doesNotMatch(bg, /solid\s+android:color="#(9E0000|B80000)"\s*\/?>/);
    // Mindestens eine der Farben traegt einen Alpha-Kanal (8-stelliger Hex).
    assert.match(bg, /solid\s+android:color="#[0-9A-Fa-f]{8}"/);
});

test('list view layout hides direct child .off and redundant small text', () => {
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s*>\s*\.off[^{]*\{[^}]*display:\s*none\s*!important;/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.productprice\s+\.small:not\(\.stroke\)[^{]*\{[^}]*display:\s*none\s*!important;/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.bm-list-off/);
});

test('eBay logos use SVG France flag and topprice logo cell matches offerlist width on mobile', () => {
    assert.match(tweakerSource, /<svg\s+viewBox="0\s+0\s+3\s+2"\s+width="16"\s+height="11"/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[^{]*\{[^}]*width:\s*22\.5%\s*!important/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell\s+\.bm-marketplace-logo-meta/);
});

test('linkPackageDimensionsCalculator decouples ruler toggle and volume from Setgewicht', () => {
    assert.match(tweakerSource, /const\s+details\s*=\s*Array\.from\(\s*document\.querySelectorAll\('\.content\.setdetails\s+p'\)\s*\)\.find\(paragraph\s*=>\s*\/\(\?:Box-\)\?Maße\\s\*:\/i\.test\(paragraph\.textContent\s*\|\|\s*''\)\s*\|\|\s*\/Abmessungen/);
    assert.match(tweakerSource, /if\s*\(!width\s*\|\|\s*!length\s*\|\|\s*!height/);
});

test('detail action buttons row integrates SVG icons, harmonized styles, and sits directly below offers', () => {
    // 1. Spacing and placement directly after offersSection
    assert.match(tweakerSource, /const offersSection = soldOutActive \|\| document\.querySelector\('#ol1st > section:first-of-type'\)/);
    assert.match(tweakerSource, /offersSection\.after\(actionRow\);/);
    assert.match(tweakerSource, /document\.querySelectorAll\('#SoldOutContainer, #soldOut'\)\.forEach\(el => \{\s*if \(!el\.querySelector\('\.pricerow'\)\) \{\s*el\.remove\(\);/);

    // 2. Harmonized button design
    assert.match(tweakerSource, /\.bm-detail-action-buttons-row \.bmd-open-button\s*\{[^}]*background:\s*#F8FAFC\s*!important/);
    assert.match(tweakerSource, /\.bm-detail-action-buttons-row \.bmd-open-button\s*\{[^}]*color:\s*#B80000\s*!important/);
    assert.match(tweakerSource, /\.bm-detail-action-buttons-row \.bmd-open-button\s*\{[^}]*border:\s*1px solid #E2E8F0\s*!important/);
    assert.match(tweakerSource, /\.bm-detail-action-buttons-row \.bmd-open-button:hover[^{]*\{[^}]*background:\s*#B80000\s*!important/);

    // 3. SVG icons for all 4 buttons
    assert.match(tweakerSource, /ensureButtonIcon\(alarmButton, bellSvg\);/);
    assert.match(tweakerSource, /ensureButtonIcon\(wishlistButton, heartSvg\);/);
    assert.match(tweakerSource, /ensureButtonIcon\(roiButton, calcSvg\);/);
    assert.match(tweakerSource, /ensureButtonIcon\(depotButton, boxSvg\);/);
});

test('eBay France does not render text subtitle and mobile green bar aligns pixel-perfect', () => {
    // 1. No "eBay FR" subtitle caption
    assert.match(tweakerSource, /captionText && captionText !== 'gewerblich' && captionText !== 'eBay FR'/);
    assert.doesNotMatch(tweakerSource, /captionText:\s*isFrance\s*\?\s*'eBay FR'/);

    // 2. Mobile flex layout and matching widths for logo cell (22.5%) and price cell (77.5%)
    assert.match(tweakerSource, /@media\s*\(max-width:\s*768px\)\s*\{\s*\.content\.setdetails\s+\.topprice\s+a\s*(?:,\s*\.content\.setdetails\s+\.topprice\s+\.bm-overall-bestprice-link\s*)?\{[^}]*display:\s*flex\s*!important;\s*width:\s*100%\s*!important;/);
    assert.match(tweakerSource, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.content\.setdetails\s+\.topprice\s+\.bm-topprice-price-cell\s*\{[^}]*flex:\s*1 1 77\.5%\s*!important;\s*width:\s*77\.5%\s*!important;/);
});

test('BM_isExcludedOfferTitle accurately filters standalone minifigures without excluding complete sets', () => {
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(sharedSource, sandbox);

    // Excludes standalone minifig listings
    assert.equal(sandbox.BM_isExcludedOfferTitle('Lego Ani018 Figurine Sasha Animal Crossing 77055 Able Sisters Clothing Shop new'), true);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO sw0001 Figurine Han Solo'), true);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO Minifigur sw0123 Darth Vader'), true);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO Minifigures only'), true);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO Figurine Sasha du set 77055'), true);

    // Does not exclude complete sets that mention included minifigures
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO 10333 Barad-dûr mit 11 Minifiguren Neu OVP'), false);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO 75302 Imperial Shuttle mit 3 Minifiguren'), false);
    assert.equal(sandbox.BM_isExcludedOfferTitle('LEGO 77055 Able Sisters Clothing Shop neu'), false);
});

test('merchants grid has 2 columns up to 768px and card images have white background', () => {
    assert.match(precleanSource, /@media screen and \(max-width:\s*768px\)\s*\{\s*\.wrapper\.merchants#wrappernormal,\s*\.wrapper\.merchants,\s*\.wrapper\.themen#wrappernormal,\s*\.wrapper\.themen\s*(?:,\s*\.wrapper\.brickstores#wrappernormal\s*,\s*\.wrapper\.brickstores\s*)?\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important;/);
    assert.match(precleanSource, /#productrow\s+\.wrapper\s+div\.slide\s+\.productimg[\s\S]*?\{[^}]*background:\s*#FFFFFF\s*!important;\s*border:\s*none\s*!important;\s*\}/);
});

test('personal discounts default to disabled and top price logo cell aligns flush without green bleed', () => {
    // 1. Personal discounts are disabled by default
    assert.match(tweakerSource, /function getDefaultPersonalDiscountSettings\(\)\s*\{[\s\S]*?enabled:\s*false,[\s\S]*?return\s*\{\s*enabled:\s*false,\s*retailers\s*\};/);
    assert.match(tweakerSource, /const personalEnabled = Boolean\(personalSettings && personalSettings\.enabled === true\);/);

    // 2. eBay logo does not output "privat" caption
    assert.doesNotMatch(tweakerSource, /captionText:\s*(?:isPrivate\s*\?\s*)?'privat'/);
    assert.match(tweakerSource, /captionText !== 'privat'/);

    // 3. Robust mid extraction for /go2/?m=... links
    assert.match(tweakerSource, /function extractMidFromElementOrUrl/);
    assert.match(tweakerSource, /go2m\|fm\|mid\|m/);

    // 4. Mobile logo cell in topprice stretches and has pure white background
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[\s\S]*?align-self:\s*stretch\s*!important;/);
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice\s+\.bm-topprice-logo-cell[\s\S]*?background-color:\s*#ffffff\s*!important;/);
});

test('personal discounts and options save changes automatically without a save button', () => {
    // 1. Personal discount dialog has no save button and auto-saves on changes
    assert.doesNotMatch(tweakerSource, /class="button bm-settings-save"/);
    assert.match(tweakerSource, /const saveAndApplyCurrentSettings = \(\) =>/);
    assert.match(tweakerSource, /rateInput\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*saveAndApplyCurrentSettings\(\);/);
    assert.match(tweakerSource, /enabledInput\.addEventListener\('change',\s*\(\)\s*=>\s*\{[\s\S]*?saveAndApplyCurrentSettings\(\);/);
    assert.match(tweakerSource, /overlay\.querySelector\('\.bm-settings-reset'\)\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?saveAndApplyCurrentSettings\(\);/);

    // 2. Options page has no save button and auto-saves on reset
    const optionsHtml = fs.readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
    const optionsJs = fs.readFileSync(new URL('../options/options.js', import.meta.url), 'utf8');
    assert.doesNotMatch(optionsHtml, /<button[^>]*type="submit"[^>]*>Speichern<\/button>/);
    assert.match(optionsJs, /document\.getElementById\('reset'\)\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?await saveSettings\(\);/);
});

test('merchants and themen have centered 2-column grid and are excluded from wrapper flex override', () => {
    // 1. #productrow / .productrow .wrapper excludes merchants, themen, and brickstores from display: flex
    assert.match(tweakerSource, /(?::is\(#productrow,\s*\.productrow\)|#productrow)\s+\.wrapper:not\(\.merchants\):not\(\.themen\):not\(\.brickstores\),\s*(?::is\(#productrow,\s*\.productrow\)|#productrow)\s+\.wrapper#wrappernormal:not\(\.merchants\):not\(\.themen\):not\(\.brickstores\)\s*\{[^}]*display:\s*flex\s*!important;/);

    // 2. Both merchants and themen have centered grid styling
    assert.match(precleanSource, /@media screen and \(max-width:\s*768px\)\s*\{\s*\.wrapper\.merchants#wrappernormal,\s*\.wrapper\.merchants,\s*\.wrapper\.themen#wrappernormal,\s*\.wrapper\.themen\s*(?:,\s*\.wrapper\.brickstores#wrappernormal\s*,\s*\.wrapper\.brickstores\s*)?\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important;[^}]*justify-content:\s*center\s*!important;/);
});

test('detail page extracts red UVP discount and black comparison bubble, and cards animate percentage changes', () => {
    // 1. Check extraction functions exist in source
    assert.match(tweakerSource, /function bmExtractRedDiscountFromHtml\(html\)/);
    assert.match(tweakerSource, /function bmExtractBlackDiscountFromHtml\(html\)/);

    // 2. Check animation function exists and is exposed globally
    assert.match(tweakerSource, /function bmAnimateNumber\(element,\s*startVal,\s*endVal/);
    assert.match(tweakerSource, /globalThis\.BM_animateNumber\s*=\s*bmAnimateNumber/);

    // 3. Check discount apply function exists and applies red & black bubbles
    assert.match(tweakerSource, /function bmApplyDiscountsToCard\(card,\s*redDiscount,\s*blackDiscount\)/);
    assert.match(tweakerSource, /function bmApplyDiscountsToAllCards\(setKey,\s*redDiscount,\s*blackDiscount\)/);

    // 4. Test extraction logic on sample HTML
    const sampleHtml = `
        <div class="offerbox">
            <p><span class="theprice nowrap">8,79 &euro;</span>
            <span class="small">Ersparnis:</span> 11,20 &euro; (<strong>56%</strong>)
            <span class="nowrap small stroke" title="unverbindliche Preisempfehlung">UVP 19,99 &euro;</span></p>
        </div>
        <div id="offerlist">
            <div class="pricerow"><span class="price"><span class="show-for-small-only merchant">amazon<br /></span> 10,99 &euro;</span></div>
            <div class="pricerow"><span class="price"><span class="show-for-small-only merchant">MediaMarkt<br /></span> 10,99 &euro;</span></div>
            <div class="pricerow"><span class="price"><span class="show-for-small-only merchant">Steinehelden<br /></span> 13,45 &euro;</span></div>
        </div>
    `;

    const redMatch = sampleHtml.match(/Ersparnis:[\s\S]*?\(<strong>(\d+)%<\/strong>\)/i);
    assert.ok(redMatch);
    assert.equal(parseInt(redMatch[1], 10), 56);

    // Black bubble CSS rules
    assert.match(tweakerSource, /\.bm-card-black-bubble/);
    assert.match(tweakerSource, /\.bm-list-black-bubble/);
    assert.match(tweakerSource, /\.bm-bubble-updating/);

    // Unified selector across card containers
    assert.match(tweakerSource, /:is\(#productrow,\s*\.productrow\)/);
});

test('list view cards and price are fully clickable to detail page with pointer cursor, excluding merchant link', () => {
    // 1. Entire card attaches detailLink click handler
    assert.match(tweakerSource, /card\.dataset\.bmCardClickAttached\s*=\s*'true'/);
    assert.match(tweakerSource, /window\.location\.href\s*=\s*detailLink/);

    // 2. Merchant links and detail anchors are preserved and not overridden
    assert.match(tweakerSource, /\.bm-list-merchant,\s*\.bm-btn-shop,\s*\.bm-overview-effective-source/);
    assert.match(tweakerSource, /const\s+detailAnchor\s*=\s*e\.target\.closest\('\.producttitle a,\s*\.productimg a,\s*a\.detail'\)/);

    // 3. Price has no click blocking and no cursor: default
    assert.doesNotMatch(tweakerSource, /priceSpan\.style\.cursor\s*=\s*['"]default['"]/);
    assert.doesNotMatch(tweakerSource, /priceSpan\.addEventListener\(['"]click['"]/);

    // 4. CSS ensures pointer cursor on slide and theprice in list view
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\][^{]*\{[^}]*cursor:\s*pointer\s*!important/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.productprice\s+\.theprice[^{]*\{[^}]*cursor:\s*pointer\s*!important/);
});

test('depot view is styled like wishlist with card layout, KPI statsbar, and responsive mobile cards', () => {
    // 1. #dpWrap has KPI statsbar with CSS grid
    assert.match(tweakerSource, /#dpWrap\s+\.dp-statsbar\s*\{[^}]*display:\s*grid\s*!important/);
    assert.match(tweakerSource, /#dpWrap\s+\.dp-stat\s*\{[^}]*border-radius:\s*12px\s*!important/);

    // 2. #dpWrap table has clean card rows and no forced 580px min-width
    assert.doesNotMatch(tweakerSource, /#dpWrap\s+table\s*\{[^}]*min-width:\s*580px/);
    assert.match(tweakerSource, /#dpWrap\s+#dpTableBody\s+\.pa-row,\s*#dpWrap\s+\.pa-row\s*\{[^}]*border-radius:\s*12px\s*!important/);

    // 3. Mobile responsive styles turn table rows into standalone cards
    assert.match(tweakerSource, /@media\s+only\s+screen\s+and\s*\(max-width:\s*900px\)\s*\{[\s\S]*?#dpWrap\s+#dpTableBody\s+\.pa-row,\s*#dpWrap\s+\.pa-row\s*\{[^}]*display:\s*block\s*!important;[^}]*position:\s*relative\s*!important;/);
    assert.match(tweakerSource, /#dpWrap\s+\.pa-c-img[^{]*\{[^}]*position:\s*absolute\s*!important;[^}]*left:\s*10px\s*!important;/);

    // 4. enhanceDepotView adds data-label and class enhancements
    assert.match(tweakerSource, /function\s+enhanceDepotView\(\)/);
    assert.match(tweakerSource, /cell\.setAttribute\('data-label',\s*'Bestpreis'\)/);
    assert.match(tweakerSource, /cell\.setAttribute\('data-label',\s*'EK Ø'\)/);
    assert.match(tweakerSource, /cell\.setAttribute\('data-label',\s*'Bestand'\)/);
});

test('link-bar rows scroll as carousels and offerlist is flex', () => {
    // 1. Jede Linkleisten-Zeile bekommt Slider, Viewport und Scroll-Pfeile
    assert.match(tweakerSource, /slider\.className\s*=\s*['"]bm-link-slider['"]/);
    assert.match(tweakerSource, /viewport\.className\s*=\s*['"]bm-link-viewport['"]/);
    assert.match(tweakerSource, /bm-link-scroll\s+bm-link-scroll-prev/);
    assert.match(tweakerSource, /bm-link-scroll\s+bm-link-scroll-next/);

    // 2. Offerlist .row.collapse is a flex container on mobile screens
    assert.match(tweakerSource, /@media\s+screen\s+and\s*\(max-width:\s*640px\)\s*\{[\s\S]*?#offerlist\s+\.row\.collapse\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-wrap:\s*nowrap\s*!important;/);

    // 3. Link sliders have zIndex 20 and cursor pointer on scroll buttons
    assert.match(tweakerSource, /\.bm-link-scroll\s*\{[\s\S]*?z-index:\s*20;/);
    assert.match(tweakerSource, /\.bm-link-scroll\s*\{[\s\S]*?cursor:\s*pointer;/);
    assert.match(tweakerSource, /setupLinkSliders\(existingPanel\);/);
    assert.match(tweakerSource, /setupLinkSliders\(box\);/);
});

test('overview-price-badges uses resilient getRequestHandler instead of bare GM_xmlhttpRequest', () => {
    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    assert.match(overviewSource, /const getRequestHandler = \(\) =>/);
    assert.match(overviewSource, /typeof globalThis\.BrickmergeNative\?\.request === 'function'/);
    // Ensure no bare unqualified GM_xmlhttpRequest(...) call remains in overview-price-badges.js
    assert.doesNotMatch(overviewSource, /(?<![.\w])GM_xmlhttpRequest\s*\(/);
});

test('action buttons sit in one heading-less row below the offer list, not in the link bar', () => {
    // 1. Keine Linkleisten-Montage mehr: keine Tools-Zeile, kein Pill-Wrapper
    assert.doesNotMatch(tweakerSource, /bmd-tools-row/);
    assert.doesNotMatch(tweakerSource, /bmd-in-link-panel/);
    assert.doesNotMatch(tweakerSource, /mountDetailActionRowIntoLinkPanel/);
    assert.doesNotMatch(tweakerSource, /classList\.add\('bm-link'\)/);
    assert.doesNotMatch(
        tweakerSource,
        /className = 'bmd-open-button bmd-parts-stock-button bmd-[a-z-]+ bm-link'/
    );

    // 2. Die Reihe hängt direkt unter der Angebotsliste
    assert.match(tweakerSource, /offersSection\.after\(actionRow\)/);

    // 3. Vier gleich breite Buttons in einer Zeile – kein Scroller, keine Überschrift
    const rowRule = tweakerSource.match(/\.bm-detail-action-buttons-row \{([\s\S]*?)\}/)?.[1] || '';
    assert.notEqual(rowRule, '', 'Regel für die Aktionszeile fehlt');
    assert.match(rowRule, /display:\s*grid\s*!important/);
    assert.match(rowRule, /grid-template-columns:\s*repeat\(4,\s*1fr\)\s*!important/);
    assert.doesNotMatch(rowRule, /overflow-x/);

    // 3b. Auf schmalem Screen decken alle 4 Buttons die volle Breite ab, ohne ungleichmäßige Lücken dazwischen.
    assert.match(
        tweakerSource,
        /@media \(max-width: 480px\) \{\s*\.bm-detail-action-buttons-row \{[^}]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important;/
    );
    assert.doesNotMatch(
        tweakerSource,
        /@media \(max-width: 480px\) \{\s*\.bm-detail-action-buttons-row \{[^}]*?justify-content:\s*space-between/
    );

    // 4. Normale Aktionsbuttons: heller Rahmen, helle Fläche, rote Schrift
    const buttonRule =
        tweakerSource.match(/\.bm-detail-action-buttons-row \.bmd-open-button \{([\s\S]*?)\}/)?.[1] || '';
    assert.notEqual(buttonRule, '', 'Regel für die Aktionsbuttons fehlt');
    for (const declaration of [
        /border:\s*1px solid #E2E8F0\s*!important/,
        /border-radius:\s*8px\s*!important/,
        /background:\s*#F8FAFC\s*!important/,
        /color:\s*#B80000\s*!important/,
        /font-size:\s*11px\s*!important/,
        /font-weight:\s*700\s*!important/,
        /box-shadow:\s*0 1px 2px rgba\(0, 0, 0, 0\.04\)\s*!important/
    ]) {
        assert.match(buttonRule, declaration);
    }
    assert.match(
        tweakerSource,
        /\.bm-detail-action-buttons-row \.bmd-open-button:hover,[\s\S]*?background:\s*#B80000\s*!important[\s\S]*?color:\s*#FFFFFF\s*!important/
    );

    // 5. Icon 14x14 in Schriftfarbe
    assert.match(
        tweakerSource,
        /\.bm-detail-action-buttons-row \.bmd-open-button \.bmd-button-icon \{[\s\S]*?width:\s*14px\s*!important/
    );
    assert.match(
        tweakerSource,
        /\.bm-detail-action-buttons-row \.bmd-open-button \.bmd-button-icon svg \{[\s\S]*?stroke:\s*currentColor\s*!important/
    );

    // 6. ROI heißt in der Aktionszeile nur noch "ROI"
    assert.match(tweakerSource, /roiLabel\.textContent = 'ROI';/);
    assert.match(tweakerSource, /roiMobileLabel\.textContent = 'ROI';/);
});

test('setupDetailButton and applyOfferPresentation are safely dispatched without ReferenceError', () => {
    assert.doesNotMatch(tweakerSource, /setTimeout\s*\(\s*setupDetailButton\s*,/);
    assert.doesNotMatch(tweakerSource, /setTimeout\s*\(\s*applyOfferPresentation\s*,/);
    assert.match(tweakerSource, /globalThis\.bmSetupDetailButton\s*=\s*setupDetailButton/);
    assert.match(tweakerSource, /globalThis\.applyOfferPresentation\s*=\s*applyOfferPresentation/);
});

test('offerlist total discount bubble displays 0% when total price with shipping exceeds UVP or reference price', () => {
    assert.match(tweakerSource, /const roundedTotalDiscount = Math\.round\(totalDiscountPercent\);/);
    assert.match(tweakerSource, /const displayTotalDiscount = Math\.max\(0, roundedTotalDiscount\);/);
    assert.match(tweakerSource, /displayTotalDiscount === 0/);
    assert.match(tweakerSource, /totalBubble\.title =\s*`Rabatt \$\{relationText\} inklusive Versand: 0% \(Gesamtpreis über \$\{overReference\}\)`;/);
});

test('topprice green line is removed, commercial eBay logo renders tie icon, and preisfehler is hidden', () => {
    // 1. .topprice and .topprice a have transparent background and border-none to prevent green line under logo cell
    assert.match(tweakerSource, /\.content\.setdetails\s+\.topprice,\s*\.content\.setdetails\s+\.topprice\s+a\s*\{[^}]*background:\s*transparent\s*!important;[^}]*border-bottom:\s*none\s*!important;/);

    // 2. createEbayLogoHtml übergibt die Verkäufer-Marke an die eine SVG-Figur;
    //    für eBay FR steht stattdessen die Landesflagge.
    assert.match(tweakerSource, /ebayLogoSvgMarkup\(isFrance \? '' : kind\)/);
    assert.doesNotMatch(tweakerSource, /sellerBadgeHtml/);

    // 3. Preisfehler melden is removed from DOM and hidden via CSS
    assert.match(tweakerSource, /a\[href\*="preisfehler"\],\s*button\[onclick\*="preisfehler"\],\s*a\[data-reveal-id\*="preisfehler"\],\s*\.preisfehler\s*\{[^}]*display:\s*none\s*!important;/);
    assert.match(tweakerSource, /txt === 'preisfehler melden' \|\| txt\.includes\('preisfehler'\)/);
});

test('Müller appears as a link-list pill only while no Müller offer row exists', () => {
    // Brickbank kennt Müller nicht für jedes Set; ohne Preis gibt es keine
    // Angebotszeile und die Pille steht in der Marktplatz-Zeile.
    const group = tweakerSource.match(
        /id:\s*"btn-bl"[\s\S]*?\n\s*\]\n\s*\},/
    )?.[0] || '';
    assert.notEqual(group, '', 'Marktplatz-Gruppe der Linkleiste nicht gefunden');
    assert.match(
        group,
        /BM_isOfferShopEnabled\('mueller-search'\)/,
        'Die Müller-Pille muss an der Müller-Freigabe hängen, nicht bedingungslos stehen'
    );
    assert.match(group, /id:\s*"btn-mueller-search"/);
    // Der Link folgt der Brickbank-Auflösung; die Suche ist nur der Ersatz.
    assert.match(group, /url:\s*muellerProductUrl \|\| /);
    assert.match(group, /site:mueller\.de LEGO \$\{setNum\}/);
    assert.match(group, /icon\("mueller\.de"\)/);

    // Der Produktlink steht als .cc-btn auf Brickbanks Weiterleitungsseite und
    // wird nur gelesen, wenn keine Müller-Zeile entstanden ist.
    assert.match(
        tweakerSource,
        /const brickbankLinkPageUrl = \(vendor, setNumber\) =>\s*`https:\/\/brickbank\.app\/angebote\/link\/\$\{vendor\}\/\$\{String\(setNumber/
    );
    assert.match(tweakerSource, /data-location="\(\[a-z\]\{2\}\)"/);
    assert.match(tweakerSource, /makeApiCacheKey\('brickbank-link', setNumber\)/);
    assert.match(
        tweakerSource,
        /!offers\.some\(offer => offer\.key === 'mueller-search'\)/
    );
    // Die Angebotszeile selbst nutzt Brickbanks eigenes Klickout.
    assert.match(tweakerSource, /brickbankOffer\.url \|\|/);

    // Sie verschwindet, sobald irgendwo eine Müller-Zeile steht – Angebotszeilen
    // tragen data-bm-shortcut-id = "btn-<offer.key>", für Müller also
    // btn-mueller-search.
    const rules = tweakerSource.match(
        /const rules = \[[\s\S]*?\n\s*\];/
    )?.[0] || '';
    assert.notEqual(rules, '', 'Shortcut-Regeln der Linkleiste nicht gefunden');
    assert.match(rules, /id: 'btn-mueller-search', pattern: \/\\bm\[uü\]eller/);
});

test('Müller fragt Apify erst nach dem Brickbank-Fallback und nur auf der Detailseite ab', () => {
    // Kommentare dürfen die Reihenfolge-Prüfungen nicht zerschneiden.
    const codeOnly = tweakerSource.replace(/^\s*\/\/.*$/gm, '');
    // Jeder Müller-Actor-Lauf kostet Geld: Die Quelle darf nie im passiven
    // Zyklus laufen, sondern nur, wenn Brickbank tatsächlich keinen Müller-Preis
    // geliefert hat.
    assert.match(
        tweakerSource,
        /\['mueller', \{[\s\S]*?manualOnly: true\s*\}\]/
    );
    assert.match(
        tweakerSource,
        /apifyMarketplaceConfigs\.forEach\(\(config, source\) => \{\s*if \(config\.manualOnly\) return;/
    );

    const gate = tweakerSource.match(
        /let brickbankSettled = false;[\s\S]*?BM_muellerApifyNeeded = \(\) =>[\s\S]*?hasMuellerPrice\(\);/
    )?.[0] || '';
    assert.notEqual(gate, '', 'Müller-Gate im Tweaker nicht gefunden');
    assert.match(gate, /brickbankSettled &&/);
    assert.match(gate, /BM_isOfferShopEnabled\('mueller'\)/);
    assert.match(gate, /!hasMuellerPrice\(\)/);
    assert.match(
        gate,
        /hasNativeMerchantIn\(\s*getNativeMerchantEntries\(\),\s*\['müller', 'mueller'\]\s*\)/
    );

    // Jede Fallback-Meldung muss nach einer Brickbank-Abschlussmarkierung
    // passieren, sonst hängt Müller für immer in der Warteschleife. onLoad setzt
    // die Markierung einmal oben und meldet danach in beiden Zweigen.
    const settledCount = tweakerSource.match(/brickbankSettled = true;/g)?.length || 0;
    const fallbackCount = tweakerSource.match(/globalThis\.BM_fetchMuellerFromApifyCache\?\.\(\);/g)?.length || 0;
    assert.equal(settledCount, 3, 'Erwartet onLoad, onError und onTimeout');
    assert.equal(fallbackCount, settledCount + 1, 'zusätzlich der Nicht-200-Zweig');
    assert.match(
        tweakerSource,
        /onload: response => \{\s*brickbankSettled = true;\s*if \(response\.status !== 200\) \{/
    );
    assert.match(
        codeOnly,
        /if \(offers\.length > 0\) storeOffers\(offers\);\s*globalThis\.BM_fetchMuellerFromApifyCache\?\.\(\);/
    );
    // Der Fallback liest ausschließlich den Worker-Cache; ein bezahlter
    // Actor-Lauf beginnt erst mit dem Refresh-Button der Detailseite.
    assert.match(
        tweakerSource,
        /globalThis\.BM_fetchMuellerFromApifyCache = \(\) => \{[\s\S]*?fetchApifyMarketplaceOffer\(\s*'mueller',\s*'Müller',\s*'mueller\.de'\s*\);/
    );

    const overviewSource = fs.readFileSync(
        new URL('../src/overview-price-badges.js', import.meta.url),
        'utf8'
    );
    const context = vm.createContext({ URL });
    vm.runInContext(overviewSource, context);
    const { withMuellerSource, buttonSources } = context.BM_OVERVIEW_PRICE_CORE;

    // Die Arrays stammen aus einem vm-Kontext, deshalb über Strings vergleichen.
    const join = list => Array.from(list).join(',');
    assert.equal(
        join(withMuellerSource(['klarna', 'stockx'], true)),
        'klarna,stockx,mueller'
    );
    assert.equal(join(withMuellerSource(['klarna'], false)), 'klarna');
    assert.equal(
        join(withMuellerSource(['klarna', 'mueller'], true)),
        'klarna,mueller',
        'eine doppelte Müller-Quelle würde doppelt Geld kosten'
    );
    assert.equal(
        Array.from(buttonSources({ linkRows: {}, offerShops: { mueller: true } }))
            .includes('mueller'),
        false,
        'Müller gehört nicht zur Standardquelle des Refresh-Buttons'
    );
    // Ohne gelesene Setnummer bricht der Klick ab, bevor Apify erreicht wird.
    assert.match(overviewSource, /if \(!data\) \{[\s\S]*?Setnummer oder EAN konnte noch nicht gelesen werden/);
    assert.match(
        overviewSource,
        /const activeSources = withMuellerSource\(\s*sources,\s*globalThis\.BM_muellerApifyNeeded\?\.\(\) === true\s*\)/
    );
});

test('Jede Apify-Quelle steckt in der Liste der 50-Prozent-Prüfung', () => {
    const workerSource = fs.readFileSync(
        new URL('../worker/worker.js', import.meta.url),
        'utf8'
    );
    const apifyConfig = workerSource.match(
        /var APIFY_CONFIG = Object\.freeze\(\{([\s\S]*?)\n\}\);/
    )?.[1];
    assert.ok(apifyConfig, 'APIFY_CONFIG im Worker nicht gefunden');
    const apifySources = Array.from(
        apifyConfig.matchAll(/^ {2}(\w+): Object\.freeze\(\{/gm),
        match => match[1]
    );
    assert.ok(apifySources.length >= 6, 'APIFY_CONFIG scheint unvollständig zu lesen');

    const context = vm.createContext({ URL });
    vm.runInContext(sharedSource, context);
    const filtered = Array.from(
        context.BM_MARKETPLACE_REFERENCE_FILTER_SOURCES
    );
    // Idealo startet seinen Actor außerhalb von APIFY_CONFIG, ist aber
    // derselbe bezahlte Scraper-Pfad.
    for (const source of [...apifySources, 'idealo']) {
        assert.ok(
            filtered.includes(source),
            `${source} läuft über Apify, wird aber ohne Referenzpreis durchgelassen`
        );
    }
    assert.equal(
        context.BM_isMarketplacePricePlausible('mueller', 49.99, 149.99),
        false
    );
    assert.equal(
        context.BM_isMarketplacePricePlausible('mueller', 79.99, 149.99),
        true
    );
});

test('WAF-Chancen versacken im Cache, der Retry leert sie und Cookiebot-Embeds laufen an', () => {
    // Eine BrickLink-Challenge ist kein Datensatz: nicht schreiben und den
    // abgelaufenen Eintrag nicht als Ersatz zurückgeben.
    assert.match(tweakerSource, /const isWafChallenge = value =>/);
    assert.match(
        tweakerSource,
        /if \(isWafChallenge\(freshData\)\) \{\s*await deleteStoredValue\(key\)\.catch\(\(\) => \{\}\);\s*throw Object\.assign\(/
    );
    assert.match(
        tweakerSource,
        /if \(error\?\.bmWafChallenge\) throw error;\s*if \(cachedIsUsable && allowStaleOnError\) return cached\.data;/
    );

    // "Erneut versuchen" im Minifig-Overlay muss dieselben Schlüssel treffen,
    // die die Quellen beim Laden benutzen.
    assert.match(
        tweakerSource,
        /makeApiCacheKey\(\s*'rebrickable-minifigs-v1',\s*`\$\{activeSetNum\}-1`\s*\)/
    );
    assert.match(
        tweakerSource,
        /makeApiCacheKey\(\s*'bricklink-set-minifigs-v2',\s*`\$\{setNum \|\| activeSetNum\}-1`\s*\)/
    );
    assert.match(
        tweakerSource,
        /catalogItemInv\.asp\?S=\$\{activeSetNum\}-1&viewItemType=M/
    );
    assert.match(
        tweakerSource,
        /\]\.forEach\(key => \{\s*deleteStoredValue\(key\)\.catch\(\(\) => \{\}\);\s*\}\);/
    );

    // Die Videos warten auf ein Consent-Script, das nie läuft.
    assert.match(
        tweakerSource,
        /function activateCookieblockedEmbeds\(\) \{/
    );
    assert.match(
        tweakerSource,
        /setupEanBarcode,\s*activateCookieblockedEmbeds,/
    );
    assert.match(
        tweakerSource,
        /window\.setTimeout\(activateCookieblockedEmbeds, delay\)/
    );

    // Der Build darf nicht mehr in die Quelle zurückschreiben.
    const buildSource = fs.readFileSync(
        new URL('../build-userscript.mjs', import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(buildSource, /applySessionFixes|bm-session-fixes/);
    assert.equal(
        fs.existsSync(new URL('../apply-session-fixes.mjs', import.meta.url)),
        false
    );
});

test('Kacheln ohne aktuelles Angebot behalten Alarm-Link und UVP, ohne über den Rand zu hängen', () => {
    // Der Rabatt-Badge wird nachträglich erzeugt, die Bindung darf also kein
    // const sein: ein TypeError bricht die ganze Kachel-Schleife ab, die
    // site-eigenen .producttag-Pills bleiben ungeordnet und hängen über dem
    // Kachelrand.
    assert.match(
        tweakerSource,
        /let offBadge = card\.querySelector\(':scope > \.off, \.off'\);/
    );

    // Ohne Preiszeile sind Alarm-Link und UVP die einzigen Inhalte, die die
    // Kachel hat – die Preisnormalisierung darf sie nicht leeren.
    assert.match(tweakerSource, /const keepWhenNoPrice = !priceText/);
    assert.match(tweakerSource, /a:has\(\.alarmbutton\), \.small/);
    assert.match(tweakerSource, /keepWhenNoPrice\.forEach\(node => fragment\.appendChild\(node\)\);/);

    // Der Alarm-Link öffnet ein Modal – die Kachel-Klickfalle darf ihn nicht schlucken.
    assert.equal(
        (tweakerSource.match(/a\[target="_blank"\], a\[data-reveal-id\]/g) || []).length,
        2
    );
});






test('Toolbar-Suche lädt die Seitenleiste nach, statt in einen neuen Tab auszuweichen', () => {
    const popupSource = fs.readFileSync(
        new URL('../popup/popup.js', import.meta.url),
        'utf8'
    );

    // shared.js kennt den Helfer, der page-overlay.js per scripting nachlädt,
    // wenn ein Tab kein Content-Script hat (vor dem Update geöffnet, Incognito
    // ohne Freigabe, ausgeschlossene Seiten).
    assert.match(sharedSource, /globalThis\.BM_openFloatingSidebar = async \(tabId, product\) =>/);
    assert.match(sharedSource, /files: \['page-overlay\.js'\]/);
    assert.equal(
        JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
            .permissions.includes('scripting'),
        true
    );

    // Popup und Service Worker laufen beide über den Helfer.
    assert.match(popupSource, /await BM_openFloatingSidebar\(tab\.id, product\)/);
    assert.doesNotMatch(popupSource, /chrome\.tabs\.sendMessage/);
    assert.match(backgroundSource, /globalThis\.BM_openFloatingSidebar\(tabId, product\)/);

    // Ohne Seitenleiste füllt die Suche einen leeren Tab, statt einen zweiten zu öffnen.
    assert.match(popupSource, /chrome\.tabs\.update\(tab\.id, \{ url: url\.href \}\)/);
    assert.equal(
        (popupSource.match(/chrome\.tabs\.create\(\{ url: url\.href \}\)/g) || []).length,
        2
    );
});

test('Detailseiten-Blasen rasten über dem Bild ein, statt im Fluss zu driften', () => {
    const rule = tweakerSource.match(
        /\.content\.setdetails \.large-3\.medium-4\.columns\.hide-for-small\s*\n\s*> \.off:not\(\.bm-bestprice-black-bubble\)[\s\S]*?\n        \}/
    );
    assert.ok(rule, 'Detailseiten-.off-Regel fehlt');

    // Die native .off steht auf der Detailseite im Fluss (position: relative);
    // ohne absolutes Einrasten schieben top/left sie mittig ins Produktbild.
    assert.match(rule[0], /position: absolute !important;/);
    assert.match(rule[0], /top: 0\.45rem !important;/);
    assert.match(rule[0], /left: 0\.75rem !important;/);

    // Schwarze Blase nutzt dieselbe Ecke und rutscht nur, wenn eine rote da ist.
    const black = tweakerSource.match(
        /\.bm-featured-black-bubble \{[\s\S]*?\n        \}/
    );
    assert.ok(black, 'Schwarze Blase der Detailseite fehlt');
    assert.match(black[0], /position: absolute !important;/);
    assert.match(black[0], /left: 0\.75rem !important;/);
    assert.match(
        tweakerSource,
        /\.bm-featured-black-bubble\.bm-featured-black-bubble-stacked \{[\s\S]*?top: calc\(0\.45rem \+ 48px\)/
    );

    // Beide Blasen nutzen die Zwischengröße (42px: zwischen kompakt 32px und Original 50px).
    assert.match(rule[0], /width: 42px !important;/);
    assert.match(black[0], /width: 42px !important;/);

    // Die native .off bringt padding-top mit und schiebt den Text damit unter
    // die Blumenmitte — beide Blasen müssen die Innenschale zurückgeben.
    assert.match(rule[0], /padding: 0 !important;/);
    assert.match(black[0], /padding: 0 !important;/);

    // Anker-Regel: Blasen sitzen am Bühnen-Container (.large-3.medium-4.columns.hide-for-small / .show-for-small-only.text-center),
    // damit sie sauber in der oberen linken Ecke der Bühne stehen und nicht über dem zentrierten Produktbild liegen.
    assert.match(
        tweakerSource,
        /\.content\.setdetails \.large-3\.medium-4\.columns\.hide-for-small,\s*\n\s*\.content\.setdetails \.show-for-small-only\.text-center\s*\{[\s\S]*?position: relative !important;/
    );
    assert.match(
        tweakerSource,
        /\.content\.setdetails \.show-for-small-only\.text-center\s*\n\s*> \.off:not\(\.bm-bestprice-black-bubble\)/
    );
});

test('Angebotsliste wird auch ohne native brickmerge-Angebote mit eigenen Marktplatz-Angeboten aufgebaut', () => {
    // 1. ensureOfferListContainer existiert und baut #offerlist mit #ol1st > section und #ol2nd auf
    assert.match(tweakerSource, /function ensureOfferListContainer\(\)/);
    assert.match(tweakerSource, /globalThis\.BM_ensureOfferListContainer = ensureOfferListContainer;/);
    assert.match(tweakerSource, /offerlist\.id = 'offerlist';/);
    assert.match(tweakerSource, /ol1st\.id = 'ol1st';/);
    assert.match(tweakerSource, /section\.className = 'bm-offer-section';/);
    assert.match(tweakerSource, /ol2nd\.id = 'ol2nd';/);

    // 2. ensureOfferListContainer positioniert vor .bm-detail-action-buttons-row oder Fallbacks
    assert.match(tweakerSource, /actionRow && actionRow\.parentElement === detailLeft/);
    assert.match(tweakerSource, /detailLeft\.insertBefore\(offerlist, actionRow\)/);

    // 3. injectMarketplaceOffers stellt #offerlist sicher, wenn keines existiert
    assert.match(
        tweakerSource,
        /if \(!offerlist && Array\.isArray\(offers\) && offers\.length > 0\) \{\s*offerlist = ensureOfferListContainer\(\);\s*\}/
    );

    // 4. injectMarketplaceOffers findet section-Fallback auch wenn firstPriceRow null ist (EOL-Sets ohne Händlerangebote wie 71469)
    assert.match(
        tweakerSource,
        /parent = offerlist\.querySelector\('#ol1st > section:first-of-type'\) \|\|\s*offerlist\.querySelector\('#ol1st > section'\) \|\|\s*offerlist\.querySelector\('section'\);/
    );

    // 5. mergeSoldOutOffersIntoOfferList hängt an section an, selbst wenn keine aktiven Händlerpreise vorliegen
    assert.match(
        tweakerSource,
        /const target = firstMainPriceRow\?\.closest\('\.row\.collapse'\)\?\.parentElement \|\|\s*offerlist\.querySelector\('#ol1st > section:first-of-type'\) \|\|\s*offerlist\.querySelector\('#ol1st > section'\) \|\|\s*offerlist\.querySelector\('section'\);/
    );

    // 6. createDiscountSettingsUI räumt verwaiste Toolbars auf, wenn noch keine Angebotszeile existiert
    assert.match(
        tweakerSource,
        /if \(!offerlist \|\| !firstOffer\?\.parentElement\) \{\s*offerlist\?\.querySelector\('\.bm-offer-toolbar'\)\?\.remove\(\);\s*return;\s*\}/
    );

    // 7. currentBestPrice liest span.price im offerlist aus, falls .topprice fehlt
    assert.match(
        tweakerSource,
        /for \(const element of document\.querySelectorAll\(\s*'#offerlist span\.price'\s*\)\)/
    );
});

test('ensureOfferListContainer und injectMarketplaceOffers verhalten sich isoliert im DOM korrekt', () => {
    // Simulierte DOM-Knoten für ensureOfferListContainer
    function createMockNode(tagName = 'div', id = '', className = '') {
        const children = [];
        return {
            tagName: tagName.toUpperCase(),
            id,
            className,
            children,
            parentElement: null,
            appendChild(child) {
                child.parentElement = this;
                children.push(child);
                return child;
            },
            prepend(child) {
                child.parentElement = this;
                children.unshift(child);
                return child;
            },
            insertBefore(newNode, refNode) {
                newNode.parentElement = this;
                const idx = children.indexOf(refNode);
                if (idx !== -1) {
                    children.splice(idx, 0, newNode);
                } else {
                    children.push(newNode);
                }
                return newNode;
            },
            querySelector(selector) {
                if (selector === '#ol1st') return children.find(c => c.id === 'ol1st') || null;
                if (selector === '#ol2nd') return children.find(c => c.id === 'ol2nd') || null;
                if (selector.includes('section')) {
                    const ol1st = children.find(c => c.id === 'ol1st');
                    if (ol1st) {
                        return ol1st.children.find(c => c.tagName === 'SECTION') || null;
                    }
                    return children.find(c => c.tagName === 'SECTION') || null;
                }
                return null;
            }
        };
    }

    const mockBody = createMockNode('body');
    const mockDetailLeft = createMockNode('div', '', 'bm-detail-left');
    const mockActionRow = createMockNode('div', '', 'bm-detail-action-buttons-row');
    mockDetailLeft.appendChild(mockActionRow);
    mockBody.appendChild(mockDetailLeft);

    let docOfferlist = null;
    const mockDoc = {
        getElementById(id) {
            if (id === 'offerlist') return docOfferlist;
            return null;
        },
        querySelector(selector) {
            if (selector === '.content.setdetails .bm-detail-left') return mockDetailLeft;
            if (selector === '.bm-detail-action-buttons-row') return mockActionRow;
            return null;
        },
        createElement(tag) {
            return createMockNode(tag);
        }
    };

    const fnSource = tweakerSource.slice(
        tweakerSource.indexOf('function ensureOfferListContainer() {'),
        tweakerSource.indexOf('globalThis.BM_ensureOfferListContainer = ensureOfferListContainer;')
    );
    const ensureFn = new Function('document', `${fnSource}; return ensureOfferListContainer;`)(mockDoc);

    const createdOfferlist = ensureFn();
    assert.ok(createdOfferlist, 'Offerlist wurde erzeugt');
    assert.equal(createdOfferlist.id, 'offerlist');
    assert.equal(mockDetailLeft.children[0], createdOfferlist, 'Offerlist wurde vor der Action-Row eingefügt');
    assert.equal(mockDetailLeft.children[1], mockActionRow, 'Action-Row bleibt unter der Offerlist');

    const ol1st = createdOfferlist.querySelector('#ol1st');
    assert.ok(ol1st, '#ol1st wurde erzeugt');
    const section = ol1st.querySelector('section');
    assert.ok(section, 'section wurde in #ol1st erzeugt');
    assert.equal(section.className, 'bm-offer-section');

    // Zweiter Aufruf liefert dasselbe Element ohne Duplikate
    docOfferlist = createdOfferlist;
    const existing = ensureFn();
    assert.equal(existing, createdOfferlist);
});

test('grid view hides secondary price rows and trailing comparison lines in CSS and removes them in DOM enhancement', () => {
    // 1. CSS checks: secondary productprice, offerbox, and trailing comparison lines hidden in grid view
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.productprice\s*~\s*\.productprice/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.offerbox\s*~\s*\.offerbox/);
    assert.match(tweakerSource, /html\[data-bm-view="list"\]\s+\[data-bm-card\]\s+\.offerbox\s*~\s*\.offerbox/);
    // :first-of-type vergleicht den Tag, nicht die Klasse. .productprice ist die dritte div
    // der Kachel und waere damit immer versteckt gewesen — die einzelne Preiszeile fiel weg.
    assert.doesNotMatch(tweakerSource, /\.productprice:not\(:first-of-type\)/);
    assert.doesNotMatch(tweakerSource, /\.offerbox:not\(:first-of-type\)/);
    assert.match(tweakerSource, /html\[data-bm-view="tile"\]\s+\[data-bm-card\]\s+\.bm-split-cta\s*~\s*:is\(\.productprice,\s*\.offerbox,\s*\.pricerow,\s*\.small,\s*p\)/);

    // 2. DOM cleanup check: secondary productprice removal and trailing cleanup
    assert.match(tweakerSource, /const allPriceAreas = card\.querySelectorAll\('\.productprice'\);/);
    assert.match(tweakerSource, /trailingToRemove\.forEach\(el => el\.remove\(\)\);/);
});

