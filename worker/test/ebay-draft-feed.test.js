import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSellerHubDraftCsv } from '../ebay-drafts.js';

const env = { EBAY_CATEGORY_ID: '19006' };

test('Seller-Hub-Entwurf entspricht der deutschen eBay-CSV-Vorlage', () => {
  const csv = buildSellerHubDraftCsv({
    setNumber: '10424',
    title: 'LEGO DUPLO 10424 Spins Familienmomente',
    ean: '5702017583785',
    quantity: 2,
    duplo: 'DUPLO'
  }, 'LEGO-10424', 29.5, 'https://example.test/10424.jpg', env);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Action\(SiteID=Germany\|Country=DE\|Currency=EUR\|Version=1193\|CC=UTF-8\)/);
  assert.match(csv, /Draft;LEGO-10424;19006;LEGO DUPLO 10424 Spins Familienmomente;5702017583785;29\.50;2;https:\/\/example\.test\/10424\.jpg;NEW;/);
  assert.match(csv, /für Kinder unter 3 Jahren geeignet/);
  assert.doesNotMatch(csv, /Nicht für Kinder unter 36 Monaten geeignet/);
  assert.ok(csv.endsWith('\r\n'));
});

test('Nicht-DUPLO-Entwurf enthält den Kleinteilehinweis', () => {
  const csv = buildSellerHubDraftCsv({ setNumber: '10329', title: 'LEGO Icons 10329', quantity: 1 }, 'LEGO-10329', 89.99, 'https://example.test/10329.jpg', env);
  assert.match(csv, /Nicht für Kinder unter 36 Monaten geeignet/);
});
