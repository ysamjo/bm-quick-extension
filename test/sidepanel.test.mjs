import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = fs.readFileSync(
    new URL('../sidepanel/sidepanel-core.js', import.meta.url),
    'utf8'
);
const context = vm.createContext({ URL, module: { exports: {} } });
vm.runInContext(coreSource, context);
const core = context.module.exports;

test('side panel validates LEGO GTIN-13 values', () => {
    assert.equal(core.isValidGtin13('5702017424965'), true);
    assert.equal(core.isValidGtin13('5702017424964'), false);
});

test('side panel normalizes Brickmerge Product JSON-LD', () => {
    const product = core.normalizeBrickmergeProduct({
        productJson: {
            '@type': 'Product',
            url: 'https://www.brickmerge.de/42154-1_lego-technic-ford-gt-2022',
            name: 'LEGO Technic 42154 Ford GT 2022',
            mpn: '42154',
            gtin13: '5702017424965',
            image: ['https://www.brickmerge.de/img/sets/l/LEGO_42154.jpg'],
            offers: { lowPrice: '74.39' }
        },
        referencePrice: 'UVP 119,99 €'
    });
    assert.equal(product.setNumber, '42154');
    assert.equal(product.ean, '5702017424965');
    assert.equal(product.bestPrice, 74.39);
    assert.equal(product.referencePrice, 119.99);
});

test('side panel excludes France sources while France is disabled', () => {
    const sources = Array.from(core.enabledSources({
        linkRows: { france: false },
        offerShops: {}
    }));
    assert.deepEqual(sources, [
        'ebay', 'bricklink', 'kleinanzeigen', 'vinted', 'stockx'
    ]);
});

test('side panel uses only cached ready offers and sorts by total price', () => {
    const offers = Array.from(core.offersFromBundle({
        sources: {
            ebay: {
                state: 'ready',
                data: {
                    found: true,
                    cheapest: { total: 89.95, url: 'https://www.ebay.de/itm/1' }
                }
            },
            bricklink: {
                state: 'ready',
                data: {
                    found: true,
                    cheapest: {
                        itemPrice: 70,
                        shipping: 5,
                        url: 'https://www.bricklink.com/v2/catalog/catalogitem.page?S=42154-1'
                    }
                }
            },
            vinted: { state: 'missing' }
        }
    }, { bestPrice: 74.39 }));
    assert.deepEqual(offers.map(offer => offer.source), ['bricklink', 'ebay']);
    assert.deepEqual(offers.map(offer => offer.total), [75, 89.95]);
});

test('side panel marketplace links follow the France setting', () => {
    const withoutFrance = Array.from(core.buildMarketplaceLinks('42154', false));
    const withFrance = Array.from(core.buildMarketplaceLinks('42154', true));
    assert.equal(withoutFrance.some(link => link.label === 'eBay FR'), false);
    assert.equal(withFrance.some(link => link.label === 'eBay FR'), true);
    assert.match(withoutFrance.find(link => link.label === 'BrickLink').url, /42154-1/);
});

test('manifest registers the official side panel and required permissions', () => {
    const manifest = JSON.parse(fs.readFileSync(
        new URL('../manifest.json', import.meta.url),
        'utf8'
    ));
    assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
    assert.equal(manifest.permissions.includes('sidePanel'), true);
    assert.equal(manifest.permissions.includes('scripting'), true);
});
