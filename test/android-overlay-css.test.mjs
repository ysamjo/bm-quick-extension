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
//   A  src/brickmerge-tweaker.js -> die CSS-Literal des Runtime
//      injiziert zuletzt, in boot.onload
//
// Alle drei setzen dieselben Selektoren, alle mit !important. Bei gleicher
// Spezifitaet entscheidet die Dokumentreihenfolge: A gewinnt. E und C sind damit
// reine Vorlauf-Kopien — sie duerfen vom Ergebnis her nichts anderes erzeugen
// als A, sonst springt das Layout, sobald das Runtime geladen ist. Genau das ist
// passiert (Header-Padding 12px -> 14px, Bubble 36px -> 32px, Kachelhoehe 105px
// -> 155px).
//
// Noch teurer sind Regeln, die E/C *nur dort* gibt: ihr html.bm-android-app-
// Praefix macht sie spezifischer als jede Unpraefix-Regel des Runtime, beide
// !important — die Vorlauf-Kopie gewinnt dann dauerhaft, nicht nur bis zum
// Laden. Deshalb vergleicht dieser Test auch gegen die entpraefixte Runtime-
// Regel (ALLOW_LIST markiert die Fälle, die bewusst als App-OVERRIDE gemeint sind).
//
// Der Test prueft nur Deklarationen, die in beiden Quellen vorkommen; Zusatz-
// eigenschaften der Vorlauf-Kopien (z.B. background, das A nicht setzt) sind
// erlaubt und bleiben wirksam.

const readIf = (relative) => {
    try {
        return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
    } catch {
        return null;
    }
};

// --------------------------------------------------------------- Mini-Parser
// Liefert CSS-Regeln mit Selektor, Rumpf und umschliessenden At-Rules
// (@media-Kette und @keyframes-Name — sonst vergleicht man zwei verschiedene
// "to"-Schluessel).
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
            if (selector.startsWith('@')) stack.push({ at: selector });
            else stack.push({ rule: true, selector, line: preludeLine, bodyAt: i + 1 });
            prelude = '';
        } else if (ch === '}') {
            const top = stack.pop();
            if (top && top.rule) {
                const scope = stack.map((s) => s.at).filter(Boolean).join(' ');
                rules.push({
                    selector: top.selector,
                    body: clean.slice(top.bodyAt, i).replace(/\s+/g, ' ').trim(),
                    scope,
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

// Kommata auf hoechster Ebene — innerhalb von :is(...), [title="a,b"] oder
// URL-Notation sind sie Teil des Selektors.
function splitSelectors(selector) {
    const parts = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i];
        if (quote) {
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') depth += 1;
        else if (ch === ')' || ch === ']') depth -= 1;
        else if (ch === ',' && depth === 0) {
            parts.push(selector.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(selector.slice(start));
    return parts;
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
function bySelector(rules) {
    const out = new Map();
    for (const rule of rules) {
        for (const raw of splitSelectors(rule.selector)) {
            const selector = raw.trim();
            if (!selector) continue;
            const key = `${rule.scope} ${selector}`;
            if (!out.has(key)) out.set(key, { props: new Map(), line: rule.line, selector, scope: rule.scope });
            const entry = out.get(key);
            for (const [property, value] of declarations(rule.body)) {
                entry.props.set(property, { value, line: rule.line });
            }
        }
    }
    return out;
}

// Whitespace, Kommata und das !important des Vorlauf-Schutzes sind kein Befund.
const normalize = (value) =>
    value.replace(/\s*!\s*important\s*$/i, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();

const APP_PREFIX = 'html.bm-android-app ';

// App-OVERRIDE: die Vorlauf-Schicht darf hier bewusst anders enden als die
// Unpraefix-Regel des Runtime, weil die App-Shell ohne Site-Fuss auskommt.
const ALLOW_LIST = new Set([
    'html.bm-android-app #wrap.bm-set-wrap|margin-bottom'
]);

// ------------------------------------------------------------ CSS aus Dateien
function templateLiteral(lines, startNeedle) {
    const start = lines.findIndex((l) => l.includes(startNeedle));
    assert.ok(start >= 0, `${startNeedle} nicht gefunden`);
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*`;\s*$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    assert.ok(end > start, `Ende des Literals ${startNeedle} nicht gefunden`);
    const first = lines[start].slice(lines[start].indexOf('`') + 1);
    return { css: [first, ...lines.slice(start + 1, end)].join('\n'), lineOffset: start + 1 };
}

// Jedes Template-Literal, das nach CSS aussieht — das Runtime verteilt seine
// Regeln auf mehrere <style>-Bloes (globalCss, Dialoge, Depot-Blatt).
function cssLiterals(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*(?:(?:const|let|var)\s+[\w.$]+|[\w.$]+\.textContent)\s*=\s*`\s*$/.test(lines[i])) continue;
        let end = -1;
        for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*`;\s*$/.test(lines[j])) {
                end = j;
                break;
            }
        }
        if (end < 0) continue;
        const css = lines.slice(i + 1, end).join('\n');
        const braces = (css.match(/{/g) || []).length;
        const colons = (css.match(/:/g) || []).length;
        if (braces >= 3 && colons > braces) out.push({ css, lineOffset: i + 1 });
    }
    return out;
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
const tweakerLines = tweakerSource.split('\n');
const bootstrapSource = readIf('../../Android/app/src/main/assets/webview-bootstrap.js');
const javaSource = readIf('../../Android/app/src/main/java/de/brickmerge/MainActivity.java');

// Spaetere Literale gewinnen — wie die Documentreihenfolge der style-Elemente.
const runtimeMap = new Map();
const globalCss = templateLiteral(tweakerLines, 'const globalCss = `');
for (const literal of [globalCss, ...cssLiterals(tweakerLines)]) {
    for (const [key, entry] of bySelector(parseRules(literal.css, literal.lineOffset))) {
        runtimeMap.set(key, entry);
    }
}

const isAppPrefixed = (rule) => /html\.bm-android-app/.test(rule.selector);
// Fuer die Wurzel-Ebenen-Pruefung nur das Haupt-Blatt: die Dialog- und
// Depot-Literale des Runtime kennen eigene Breakpoints.
const runtimeOverlay = parseRules(globalCss.css, globalCss.lineOffset).filter(isAppPrefixed);
const runtimeGlobalOverlay = bySelector(parseRules(globalCss.css, globalCss.lineOffset));

// -------------------------------------------------------------------- Tests
test('Runtime-Overlay-Regeln liegen auf Root-Ebene, nicht in einem Breakpoint', () => {
    // Genau hier lag ein Denkfehler: die Praefix-Regeln ab Z.5483 stehen NICHT im
    // @media (max-width: 768px) von Z.4943 — das schliesst bereits bei Z.5206.
    // Waeren sie im Breakpoint, wuerden sie auf breiten Geraeten gar nicht greifen.
    assert.ok(runtimeOverlay.length > 0, 'keine Overlay-Regeln gefunden');
    const inMedia = runtimeOverlay.filter((r) => r.scope);
    assert.deepEqual(
        inMedia.map((r) => `Z.${r.line}: ${r.scope}`),
        [],
        'Overlay-Regeln mit Praefix duerfen nicht in einem @media stehen'
    );
});

test('Runtime und Vorlauf-Schichten enthalten denselben Selektor-Level', () => {
    // Der Drift-Test unten vergleicht pro (Selektor-, Eigenschafts-)Paar. Damit er
    // ueberhaupt etwas prueft, muss das Runtime selbst unzpraefixierte Regeln
    // kennen — sonst vergleicht man nur Aepfel mit Aepfeln aus derselben Quelle.
    assert.ok([...runtimeMap.keys()].some((k) => !k.includes(APP_PREFIX)), 'nur praefixierte Runtime-Regeln');
});

const compareLayers = (label, map) => {
    const problems = [];
    for (const [key, entry] of map) {
        const candidates = [key];
        if (entry.selector.startsWith(APP_PREFIX)) {
            candidates.push(`${entry.scope} ${entry.selector.slice(APP_PREFIX.length)}`);
        }
        let runtime = null;
        for (const candidate of candidates) {
            runtime = runtimeMap.get(candidate);
            if (runtime) break;
        }
        if (!runtime) continue;
        for (const [property, value] of entry.props) {
            const runtimeValue = runtime.props.get(property);
            if (!runtimeValue) continue;
            if (ALLOW_LIST.has(`${entry.selector}|${property}`)) continue;
            if (normalize(value.value) === normalize(runtimeValue.value)) continue;
            problems.push(
                `${label} Z.${value.line}  ${entry.scope ? `${entry.scope} ` : ''}${entry.selector}\n` +
                `      ${property}: ${value.value}   <-- Vorlauf-Kopie\n` +
                `      ${property}: ${runtimeValue.value}   <-- Runtime, gewinnt (src/brickmerge-tweaker.js Z.${runtimeValue.line})`
            );
        }
    }
    return problems;
};

test('Vorlauf-Schichten widersprechen dem Runtime in keiner geteilten Regel',
    { skip: !bootstrapSource || !javaSource ? 'Android-Repo nicht im Arbeitsverzeichnis' : false }, () => {
        const bootstrap = bySelector(
            parseRules(templateLiteral(bootstrapSource.split('\n'), 'appShellStyle.textContent = `').css)
        );
        const early = bySelector(parseRules(earlyShellCss(javaSource).css));
        const problems = [
            ...compareLayers('webview-bootstrap.js', bootstrap),
            ...compareLayers('MainActivity.java (FAST_STYLE_INJECTOR)', early)
        ];

        assert.deepEqual(
            problems,
            [],
            'Die Vorlauf-Kopien der Android-Overlay-CSS weichen vom Runtime ab. Sie werden vor dem ' +
            'Runtime geladen und erzeugen deshalb einen sichtbaren Sprung, sobald das Runtime greift. ' +
            'Weicht eine praefixierte Kopie von einer unpraefixten Runtime-Regel ab, ueberschreibt sie ' +
            'das Runtime sogar dauerhaft (hoehere Spezifitaet, beide !important). Also: Werte in ' +
            'webview-bootstrap.js bzw. MainActivity.java auf die Runtime-Werte ziehen:\n\n' +
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

// Die Rabatt-Bubbles waren der Fall, den die Kaskadenpruefung oben nicht sieht:
// ihre Selektoren tragen kein html.bm-android-app, trotzdem existieren sie in
// allen drei Schichten — mit unterschiedlichen Zahlen (36/46/11.5 gegen
// 32/42/10.5). Weil E und C vor dem Runtime greifen, bedeutet das einen
// sichtbaren Sprung beim Laden; gleiche Zahlen heben ihn auf.
const BUBBLE_PROPS = ['top', 'left', 'width', 'height', 'font-size'];
const isBubbleRule = (selector) =>
    /bm-card-black-bubble$/.test(selector) || /(^|\s)\.off$/.test(selector);

test('Rabatt-Bubbles nutzen in allen drei Schichten dieselbe kompakte Groesse',
    { skip: !bootstrapSource || !javaSource ? 'Android-Repo nicht im Arbeitsverzeichnis' : false }, () => {
        const bootstrap = bySelector(
            parseRules(templateLiteral(bootstrapSource.split('\n'), 'appShellStyle.textContent = `').css)
        );
        const early = bySelector(parseRules(earlyShellCss(javaSource).css));

        const bubbles = [...runtimeGlobalOverlay.keys()].filter(isBubbleRule);
        assert.ok(bubbles.length >= 2, `keine Bubble-Regeln im Runtime gefunden: ${bubbles}`);

        // Die Norm ist die kompakte Kachelgroesse, nicht die alte 36er-Version.
        const card = runtimeGlobalOverlay.get(bubbles.find((s) => /bm-card-black-bubble$/.test(s)));
        assert.equal(card.props.get('width')?.value, '32px !important');
        assert.equal(card.props.get('font-size')?.value, '10.5px !important');

        const problems = [];
        for (const selector of bubbles) {
            for (const [name, map] of [['webview-bootstrap.js', bootstrap], ['MainActivity.java (FAST_STYLE_INJECTOR)', early]]) {
                const other = map.get(selector);
                if (!other) continue;
                for (const property of BUBBLE_PROPS) {
                    const runtimeValue = runtimeGlobalOverlay.get(selector).props.get(property);
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
