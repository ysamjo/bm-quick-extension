import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HARD_EXCLUSION_PATTERN, isCompleteEbaySetTitle } from '../lib/ebay-title-filter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SHARED = path.resolve(here, '../../src/shared.js');

// Schneidet ein Regex-Literal heraus, ohne sich von "/" in Zeichenklassen
// oder von maskierten Schraegstrichen taeuschen zu lassen.
function literalAfter(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const start = source.indexOf('/', source.indexOf('=', at));
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === ']') { inClass = false; continue; }
    if (ch === '/' && !inClass) {
      const end = source.indexOf(';', i);
      return source.slice(start, end < 0 ? i + 1 : end);
    }
  }
  return null;
}

test('die Ausschlussliste des Clients ist wortgleich mit der des Workers', t => {
  if (!fs.existsSync(CLIENT_SHARED)) {
    t.skip('Userscript/src/shared.js nicht vorhanden - eigenstaendiger Worker-Checkout');
    return;
  }
  const clientLiteral = literalAfter(
    fs.readFileSync(CLIENT_SHARED, 'utf8'),
    'BM_EXCLUDED_OFFER_TITLE_PATTERN ='
  );
  assert.ok(clientLiteral, 'BM_EXCLUDED_OFFER_TITLE_PATTERN in src/shared.js nicht gefunden');

  const workerLiteral = `/${HARD_EXCLUSION_PATTERN.source}/${HARD_EXCLUSION_PATTERN.flags}`;

  assert.equal(
    clientLiteral,
    workerLiteral,
    'Die Ausschlussliste ist auseinandergelaufen. Kanonisch ist ' +
    'HARD_EXCLUSION_PATTERN in worker/lib/ebay-title-filter.js - den Wert dort ' +
    'aendern und wortgleich nach globalThis.BM_EXCLUDED_OFFER_TITLE_PATTERN in ' +
    'Userscript/src/shared.js uebertragen.'
  );
});

test('die Ausschlussliste deckt die beiden nachgezogenen Faelle ab', () => {
  // "manuals" und "leere OVP/Box/Verpackung" standen nur in den Worker-Kopien
  // und fehlten im Client.
  assert.equal(HARD_EXCLUSION_PATTERN.test('LEGO 42154 manuals only'), true);
  assert.equal(HARD_EXCLUSION_PATTERN.test('LEGO 42154 leere OVP'), true);
  assert.equal(HARD_EXCLUSION_PATTERN.test('LEGO 42154 leere Verpackung'), true);

  // Weiterhin erlaubt: ein vollstaendiges Set mit Zubehoer im Titel.
  assert.equal(HARD_EXCLUSION_PATTERN.test('LEGO Technic 42154 Neu OVP ungeoeffnet'), false);
  assert.equal(isCompleteEbaySetTitle('LEGO Technic 42154 Neu OVP ungeoeffnet', '42154'), true);
});
