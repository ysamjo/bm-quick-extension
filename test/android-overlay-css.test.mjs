import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Die Android-Overlay-CSS existiert zwangslaeufig mehrfach: sie muss schon vor
// dem Laden des Runtime stehen, sonst sieht man beim Start einen Sprung.
//
//   E  MainActivity.java  FAST_STYLE_INJECTOR -> #bm-early-app-shell
//      injiziert in onPageStarted, also vor dem ersten Bild
//   C  webview-bootstrap.js -> #bm-android-app-shell
//      injiziert, sobald das Bootstrap-Skript geladen ist
//   A  src/brickmerge-tweaker.js -> globalStyle (das Runtime)
//      injiziert zuletzt, in boot.onload
//
// Alle drei setzen dieselben Selektoren mit demselben Praefix html.bm-android-app,
// alle mit !important. Bei gleicher Spezifitaet entscheidet die Dokumentreihenfolge:
// A gewinnt. E und C sind damit reine Vorlauf-Kopien — sie duerfen vom Ergebnis her
// nichts anderes erzeugen als A, sonst springt das Layout, sobald das Runtime
// geladen ist. Genau das ist passiert (Header-Padding 12px -> 14px, Schliessen-
// Knopf 8px -> 10px, unterer Abstand 20px -> 24px).
//
// Dieser Test haelt die drei Kopien deckungsgleich. Er prueft nur Deklarationen,
// die in beiden Quellen vorkommen; Zusatz-Eigenschaften der Vorlauf-Kopien (z.B.
// background, das A nicht setzt) sind erlaubt und bleiben wirksam.

const readIf = (relative) => {
    try {
        return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
    } catch {
        return null;
    }
};

// --------------------------------------------------------------- Mini-Parser
// Liefert CSS-Regeln mit Selektor, Rumpf und umschliessender @media-Bedingung.
function parseRules(css, lineOffset = 1) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const rules = [];
    const stack = [];
    let prelude = '';
    let preludeLine = lineOffset;
    let line = lineOffset;
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch === '\n') {
            line += 1;
            continue;
        }
        if (ch === '{') {
            const selector = prelude.replace(/\s+/g, ' ').trim();
            if (selector.startsWith('@media')) stack.push({ media: selector });
            else stack.push({ rule: true, selector, line: preludeLine, bodyAt: i + 1 });
            prelude = '';
        } else if (ch === '}') {
            const top = stack.pop();
            if (top && top.rule) {
                rules.push({
                    selector: top.selector,
                    body: clean.slice(top.bodyAt, i).replace(/\s+/g, ' ').trim(),
                    media: stack.map((s) => s.media).filter(Boolean).join(' && '),
                    line: top.line
                });
            }
            prelude = '';
        } else {
            if (!prelude) preludeLine = line;
            prelude += ch;
        }
    }
    return rules;
}

const declarations = (body) =>
    body
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const at = part.indexOf(':');
            return at < 0 ? [part, ''] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
        });

// Einfacher Selektor -> { Eigenschaft: Wert }. Spaetere Regel derselben Quelle
// ueberschreibt fruehere — wie im Browser.
function bySimpleSelector(rules) {
    const out = new Map();
    for (const rule of rules) {
        for (const raw of rule.selector.split(',')) {
            const selector = raw.trim();
            if (!selector) continue;
            if (!out.has(selector)) out.set(selector, { props: new Map(), line: rule.line });
            const entry = out.get(selector);
            for (const [property, value] of declarations(rule.body)) {
                entry.props.set(property, { value, line: rule.line });
            }
        }
    }
    return out;
}

const normalize = (value) => value.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ CSS aus Dateien
function runtimeCss(source) {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => l.includes('const globalCss = `'));
    assert.ok(start >= 0, 'const globalCss = ` nicht gefunden');
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*`;\s*$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    assert.ok(end > start, 'Ende des globalCss-Literals nicht gefunden');
    const first = lines[start].slice(lines[start].indexOf('`') + 1);
    return { css: [first, ...lines.slice(start + 1, end)].join('\n'), lineOffset: start + 1 };
}

function bootstrapCss(source) {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => l.includes('appShellStyle.textContent = `'));
    assert.ok(start >= 0, 'appShellStyle.textContent nicht gefunden');
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*`;\s*$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    assert.ok(end > start, 'Ende des appShellStyle-Literals nicht gefunden');
    const first = lines[start].slice(lines[start].indexOf('`') + 1);
    return { css: [first, ...lines.slice(start + 1, end)].join('\n'), lineOffset: start + 1 };
}

function earlyShellCss(source) {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => l.includes('FAST_STYLE_INJECTOR ='));
    assert.ok(start >= 0, 'FAST_STYLE_INJECTOR nicht gefunden');
    const parts = [];
    for (let i = start; i < lines.length; i++) {
        if (/^\s*;/.test(lines[i]) || /"\s*;\s*$/.test(lines[i])) break;
        const m = lines[i].match(/^\s*"(.*)"\s*\+?\s*;?\s*$/);
        if (m) parts.push(m[1].replace(/\\\\"/g, '"').replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
    const js = parts.join('\n');
    const open = js.indexOf("s.textContent = '");
    assert.ok(open >= 0, 's.textContent im FAST_STYLE_INJECTOR nicht gefunden');
    const close = js.lastIndexOf("'");
    assert.ok(close > open, 'Ende des Stylesheet-Strings nicht gefunden');
    return { css: js.slice(open + "s.textContent = '".length, close), lineOffset: 1 };
}

// -------------------------------------------------------------------- Daten
const tweakerSource = fs.readFileSync(
    new URL('../src/brickmerge-tweaker.js', import.meta.url),
    'utf8'
);
const bootstrapSource = readIf(
    '../../Android/app/src/main/assets/webview-bootstrap.js'
);
const javaSource = readIf(
    '../../Android/app/src/main/java/de/brickmerge/MainActivity.java'
);

const isAppPrefixed = (rule) => /html\.bm-android-app/.test(rule.selector);

const runtime = runtimeCss(tweakerSource);
const runtimeOverlay = parseRules(runtime.css, runtime.lineOffset).filter(isAppPrefixed);
const runtimeMap = bySimpleSelector(runtimeOverlay);

// -------------------------------------------------------------------- Tests
test('Runtime-Overlay-Regeln liegen auf Root-Ebene, nicht in einem Breakpoint', () => {
    // Genau hier lag ein Denkfehler: die Praefix-Regeln ab Z.5483 stehen NICHT im
    // @media (max-width: 768px) von Z.4943 — das schliesst bereits bei Z.5206.
    // Waeren sie im Breakpoint, wuerden sie auf breiten Geraeten gar nicht greifen.
    assert.ok(runtimeOverlay.length > 0, 'keine Overlay-Regeln gefunden');
    const inMedia = runtimeOverlay.filter((r) => r.media);
    assert.deepEqual(
        inMedia.map((r) => `Z.${r.line}: ${r.media}`),
        [],
        'Overlay-Regeln mit Praefix duerfen nicht in einem @media stehen'
    );
});

test('Bootstrap und Early-Shell widersprechen dem Runtime nicht', { skip: !bootstrapSource || !javaSource ? 'Android-Repo nicht im Arbeitsverzeichnis' : false }, () => {
    const bootstrap = bootstrapCss(bootstrapSource);
    const early = earlyShellCss(javaSource);

    const sources = [
        { name: 'webview-bootstrap.js', map: bySimpleSelector(parseRules(bootstrap.css, bootstrap.lineOffset).filter(isAppPrefixed)), label: 'C' },
        { name: 'MainActivity.java (FAST_STYLE_INJECTOR)', map: bySimpleSelector(parseRules(early.css, early.lineOffset).filter(isAppPrefixed)), label: 'E' }
    ];

    const problems = [];
    for (const { name, map } of sources) {
        for (const [selector, runtimeEntry] of runtimeMap) {
            const other = map.get(selector);
            if (!other) continue;
            for (const [property, runtimeValue] of runtimeEntry.props) {
                const otherValue = other.props.get(property);
                if (!otherValue) continue;
                if (normalize(otherValue.value) === normalize(runtimeValue.value)) continue;
                problems.push(
                    `${name} Z.${otherValue.line}  ${selector}\n` +
                    `      ${property}: ${otherValue.value}   <-- Vorlauf-Kopie\n` +
                    `      ${property}: ${runtimeValue.value}   <-- Runtime, gewinnt (src/brickmerge-tweaker.js Z.${runtimeValue.line})`
                );
            }
        }
    }

    assert.deepEqual(
        problems,
        [],
        'Die Vorlauf-Kopien der Android-Overlay-CSS weichen vom Runtime ab. Sie werden vor dem ' +
        'Runtime geladen und erzeugen deshalb einen sichtbaren Sprung, sobald das Runtime greift. ' +
        'Die Werte in webview-bootstrap.js bzw. MainActivity.java auf die Runtime-Werte ziehen:\n\n' +
        problems.join('\n\n')
    );
});

test('Das Runtime wird nach dem Bootstrap geladen', { skip: !javaSource ? 'Android-Repo nicht im Arbeitsverzeichnis' : false }, () => {
    // Nur deshalb gewinnt die Runtime-Kopie die Kaskade: gleiche Selektoren,
    // gleiche Spezifitaet, beide !important — die Dokumentreihenfolge entscheidet.
    const start = javaSource.indexOf('RUNTIME_LOADER =');
    assert.ok(start >= 0, 'RUNTIME_LOADER nicht gefunden');
    // Nicht bis zum ersten ';' schneiden — die stehen innerhalb der JS-Strings.
    const next = javaSource.indexOf('private static final', start + 'RUNTIME_LOADER ='.length);
    const loader = javaSource.slice(start, next > start ? next : start + 2000);
    const bootOnload = loader.indexOf('boot.onload');
    const runtimeSrc = loader.indexOf('brickmerge-runtime.js');
    const appendRuntime = loader.indexOf('appendChild(runtime)');
    const appendBoot = loader.indexOf('appendChild(boot)');
    assert.ok(bootOnload >= 0 && runtimeSrc > bootOnload, 'Runtime muss in boot.onload erzeugt werden');
    assert.ok(appendRuntime > runtimeSrc, 'Runtime muss in boot.onload angehaengt werden');
    assert.ok(appendBoot > appendRuntime, 'Bootstrap muss nach dem Runtime-Aufbau angehaengt werden');
});

// Die Rabatt-Bubbles waren der Fall, den die obige Pruefung nicht sieht: ihre
// Selektoren tragen kein html.bm-android-app, trotzdem existieren sie in allen
// drei Schichten — mit unterschiedlichen Zahlen (36/46/11.5 gegen 32/42/10.5).
// Weil E und C vor dem Runtime greifen, bedeutet das einen sichtbaren Sprung
// beim Laden; gleiche Zahlen heben ihn auf.
const BUBBLE_PROPS = ['top', 'left', 'width', 'height', 'font-size'];
const isBubbleRule = (selector) =>
    /bm-card-black-bubble$/.test(selector) || /(^|\s)\.off$/.test(selector);

test('Rabatt-Bubbles nutzen in allen drei Schichten dieselbe kompakte Groesse',
    { skip: !bootstrapSource || !javaSource ? 'Android-Repo nicht im Arbeitsverzeichnis' : false }, () => {
        const runtimeMap = bySimpleSelector(parseRules(runtime.css, runtime.lineOffset));
        const bootstrapMap = bySimpleSelector(
            parseRules(bootstrapCss(bootstrapSource).css, bootstrapCss(bootstrapSource).lineOffset)
        );
        const early = earlyShellCss(javaSource);
        const earlyMap = bySimpleSelector(parseRules(early.css, early.lineOffset));

        const bubbles = [...runtimeMap.keys()].filter(isBubbleRule);
        assert.ok(bubbles.length >= 2, `keine Bubble-Regeln im Runtime gefunden: ${bubbles}`);

        // Die Norm ist die kompakte Kachelgroesse, nicht die alte 36er-Version.
        const card = runtimeMap.get(bubbles.find((s) => /bm-card-black-bubble$/.test(s)));
        assert.equal(card.props.get('width')?.value, '32px !important');
        assert.equal(card.props.get('font-size')?.value, '10.5px !important');

        const problems = [];
        for (const selector of bubbles) {
            for (const [name, map] of [['webview-bootstrap.js', bootstrapMap], ['MainActivity.java (FAST_STYLE_INJECTOR)', earlyMap]]) {
                const other = map.get(selector);
                if (!other) continue;
                for (const property of BUBBLE_PROPS) {
                    const runtimeValue = runtimeMap.get(selector).props.get(property);
                    const otherValue = other.props.get(property);
                    if (!runtimeValue || !otherValue) continue;
                    if (normalize(otherValue.value) === normalize(runtimeValue.value)) continue;
                    problems.push(
                        `${name} Z.${otherValue.line}  ${selector}\n` +
                        `      ${property}: ${otherValue.value}   <-- Vorlauf-Kopie\n` +
                        `      ${property}: ${runtimeValue.value}   <-- Runtime`
                    );
                }
            }
        }
        assert.deepEqual(problems, [], 'Die Vorlauf-Kopien der Bubble-Geometrie weichen vom Runtime ab:\n\n' + problems.join('\n\n'));
    });
