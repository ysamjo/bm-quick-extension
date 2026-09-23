import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// :first-of-type und :last-of-type vergleichen den TAG, nicht die Klasse.
// "div.productprice:first-of-type" trifft deshalb das erste div der Kachel —
// in unseren Karten ein <a>-Wrapper-Kind, nie .productprice selbst. Eine Regel
// wie ".productprice:not(:first-of-type) { display: none }" versteckt damit
// jeden Preis, auch den einzigen. Genau das hat beide Kachel-Ansichten
// gleichzeitig kaputt gemacht.
//
// Korrekt sind nur die Geschwister-Kombinatoren ".productprice ~ .productprice"
// und ".offerbox ~ .offerbox" — sie vergleichen die Klasse selbst.

const ROOT = path.resolve(import.meta.dirname, '../..');

const SOURCES = [
    ['Userscript/src/brickmerge-tweaker.js', 'Userscript/src/overview-price-badges.js', 'Userscript/src/preclean.js']
        .map(f => path.join(ROOT, f)),
    [path.join(ROOT, 'Android/app/src/main/assets/webview-bootstrap.js')],
    [path.join(ROOT, 'Android/app/src/main/java/de/brickmerge/MainActivity.java')],
];

const OFFENDER = /\.[A-Za-z][-\w]*:not\(:first-of-type\)|\.[A-Za-z][-\w]*:(?:first|last|nth)-of-type/g;

test('Kein klassenbezogenes :first-of-type / :last-of-type in einer CSS-Schicht', () => {
    for (const group of SOURCES) {
        for (const file of group) {
            const src = fs.readFileSync(file, 'utf8');
            const hits = src.split('\n')
                .map((line, i) => [i + 1, line.match(OFFENDER)])
                .filter(([, m]) => m);
            assert.deepEqual(
                hits, [],
                `${path.relative(ROOT, file)} verwendet klassenbezogene of-type-Pseudoklassen:\n` +
                hits.map(([n, m]) => `  Zeile ${n}: ${m.join(', ')} -> stattdessen ".a ~ .a"`).join('\n')
            );
        }
    }
});

test('Kachel-Optik ist positiv scoped: kein html:not(.bm-view-list) und keine negative Ansichtsklasse', () => {
    const tweaker = fs.readFileSync(path.join(ROOT, 'Userscript/src/brickmerge-tweaker.js'), 'utf8');
    assert.doesNotMatch(tweaker, /html:not\(\.bm-view-list\)/);
    assert.doesNotMatch(tweaker, /globalCss[^]*?html\.bm-view-list/);
    // Ein fehlendes data-bm-view bedeutet "keine Kachel-Optik". Das war beim
    // classList-Entfernen von bm-view-list genau umgekehrt.
    assert.match(tweaker, /function bmClearViewMode\(\)\s*\{\s*delete document\.documentElement\.dataset\.bmView;/);
});
