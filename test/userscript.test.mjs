import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
    new URL('../brickmerge-tweaks.js', import.meta.url),
    'utf8'
);

test('mobile userscript metadata keeps automatic GitHub updates', () => {
    assert.match(source, /@version\s+5\.0\.0/);
    assert.match(source, /@run-at\s+document-start/);
    assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com/);
    assert.match(source, /@connect\s+getdata\.andreas-9b7\.workers\.dev/);
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
    assert.match(source, /logoBadge:\s*'DE'/);
    assert.match(source, /logoBadge:\s*'FR'/);
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

test('France remains disabled by default and can be toggled from the script menu', () => {
    assert.match(source, /france:\s*false/);
    assert.match(source, /Frankreich-Angebote umschalten/);
});
