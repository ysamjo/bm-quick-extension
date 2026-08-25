import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __test, legacyEbayWorker } from '../worker.js';

const context = { waitUntil() {} };
globalThis.caches ??= {
  default: {
    async match() { return undefined; },
    async put() {}
  }
};

test('health reports version and KV binding', async () => {
  const response = await worker.fetch(
    new Request('https://getdata.example/health'),
    { BM_CACHE: {} },
    context
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, '2.5.4');
  assert.equal(body.cache, 'edge+kv');
});

test('BrickLink money parser handles German and international EUR formats', () => {
  assert.equal(__test.parseBricklinkMoney('EUR 1.234,56'), 1234.56);
  assert.equal(__test.parseBricklinkMoney('12,34 \u20AC'), 12.34);
  assert.equal(__test.parseBricklinkMoney('\u20AC 9.99'), 9.99);
  assert.equal(__test.parseBricklinkMoney('USD 12.34'), null);
});

test('BrickLink prices include German VAT for net inventory values', () => {
  assert.equal(__test.parseBricklinkOfferPrice({
    mDisplaySalePrice: 'US $13.50',
    mInvSalePrice: 'EUR 11.7227'
  }), 13.95);
  assert.equal(__test.parseBricklinkOfferPrice({
    mDisplaySalePrice: 'US $442.40',
    mInvSalePrice: 'EUR 378.1513'
  }), 450);
  assert.equal(__test.parseBricklinkOfferPrice({
    mDisplaySalePrice: 'EUR 12.34',
    mInvSalePrice: ''
  }), 12.34);
});

test('dismissed offers are persisted per client and set in KV', async () => {
  const values = new Map();
  const env = {
    BM_CACHE: {
      async get(key, type) {
        const value = values.get(key);
        return type === 'json' && value ? JSON.parse(value) : value ?? null;
      },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); }
    }
  };
  const clientId = 'b8fd03c9-c0ea-4fe0-8a15-a09995b56bb8';
  const identity = 'bricklink-de|543459993';
  const dismissResponse = await worker.fetch(new Request(
    'https://getdata.example/offers/dismissals',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bm-client-id': clientId
      },
      body: JSON.stringify({ setNumber: '75397', identity, dismissed: true })
    }
  ), env, context);
  assert.equal(dismissResponse.status, 200);

  const readResponse = await worker.fetch(new Request(
    'https://getdata.example/offers/dismissals?set=75397',
    { headers: { 'x-bm-client-id': clientId } }
  ), env, context);
  assert.equal(readResponse.status, 200);
  const readBody = await readResponse.json();
  assert.equal(readBody.count, 1);
  assert.equal(readBody.dismissed[0].identity, identity);

  const clearResponse = await worker.fetch(new Request(
    'https://getdata.example/offers/dismissals',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bm-client-id': clientId
      },
      body: JSON.stringify({ setNumber: '75397', clear: true })
    }
  ), env, context);
  assert.equal(clearResponse.status, 200);
  assert.equal((await clearResponse.json()).count, 0);
});

test('BrickLink minifigure offer parameters distinguish DE and EU', () => {
  const de = __test.bricklinkMinifigOfferParams('257546', 'DE');
  assert.equal(de.get('loc'), 'DE');
  assert.equal(de.get('reg'), null);

  const eu = __test.bricklinkMinifigOfferParams('257546', 'EU');
  assert.equal(eu.get('loc'), null);
  assert.equal(eu.get('reg'), '-1');
});

test('BrickLink set offers are normalized for the shared cache', () => {
  assert.equal(
    __test.parseBricklinkCatalogItemId('<script>var idItem = 257546;</script>'),
    '257546'
  );
  const offers = __test.normalizeBricklinkSetOffers({
    list: [
      {
        idInv: 3,
        strSellerCountryCode: 'DE',
        codeNew: 'N',
        codeComplete: 'C',
        mInvSalePrice: 'EUR 89.95',
        strStorename: 'Günstig'
      },
      {
        idInv: 2,
        strSellerCountryCode: 'DE',
        codeNew: 'N',
        codeComplete: 'C',
        mInvSalePrice: 'EUR 99,95',
        strStorename: 'Teurer'
      },
      {
        idInv: 1,
        strSellerCountryCode: 'FR',
        codeNew: 'N',
        codeComplete: 'C',
        mInvSalePrice: 'EUR 79.95'
      }
    ]
  }, '42154');
  assert.equal(offers.length, 2);
  assert.equal(offers[0].total, 89.95);
  assert.equal(offers[0].seller, 'Günstig');
  assert.match(offers[0].url, /S=42154-1/);
});

test('eBay title filter rejects display accessories and minifigure-only offers', () => {
  const relevant = [
    'LEGO Technic 42154 Ford GT 2022 Neu OVP komplettes Set',
    'LEGO Icons 10333 Barad-dur Neu OVP mit 11 Minifiguren'
  ];
  const irrelevant = [
    'Acryl Vitrine Display Case für LEGO Technic 42154',
    'Display Stand für LEGO 42154 Ford GT',
    'LED Beleuchtungsset für LEGO Icons 10333',
    'LEGO 10333 Minifiguren Set komplett neu',
    'Alle 11 Minifiguren aus LEGO Set 10333 neu'
  ];
  relevant.forEach((title) => assert.equal(
    __test.isCompleteEbaySetTitle(
      title,
      title.includes('42154') ? '42154' : '10333'
    ),
    true,
    title
  ));
  irrelevant.forEach((title) => assert.equal(
    __test.isCompleteEbaySetTitle(
      title,
      title.includes('42154') ? '42154' : '10333'
    ),
    false,
    title
  ));
});

test('eBay France rejects French lighting, display and incomplete-set titles', () => {
  const relevant = [
    'LEGO Star Wars 75302 La Navette Impériale neuf scellé',
    "LEGO Ideas 21330 Maman j'ai raté l'avion neuf complet 3955 pièces"
  ];
  const irrelevant = [
    "Kit d'éclairage LED pour LEGO 75302",
    'Lumière LED pour LEGO Star Wars 75302',
    'Lampe pour LEGO Ideas 21330',
    'Vitrine acrylique pour LEGO Ideas 21330',
    'Boîte vide LEGO Ideas 21330',
    'Notice seule pour LEGO 21330',
    'Lot de figurines LEGO Ideas 21330',
    'Support mural pour LEGO Star Wars 75302',
    'LEGO Ideas 21330 sans figurines'
  ];
  relevant.forEach((title) => assert.equal(
    __test.isCompleteEbaySetTitle(
      title,
      title.includes('75302') ? '75302' : '21330',
      'fr'
    ),
    true,
    title
  ));
  irrelevant.forEach((title) => assert.equal(
    __test.isCompleteEbaySetTitle(
      title,
      title.includes('75302') ? '75302' : '21330',
      'fr'
    ),
    false,
    title
  ));
});

test('eBay minifigure filter accepts the exact BrickLink ID only', () => {
  const base = {
    itemId: 'v1|205269965168|0',
    conditionId: '1000',
    condition: 'Neu',
    buyingOptions: ['FIXED_PRICE'],
    price: { value: '7.70', currency: 'EUR' },
    shippingOptions: [{ shippingCost: { value: '1.90', currency: 'EUR' } }],
    itemWebUrl: 'https://www.ebay.de/itm/205269965168'
  };
  const matching = __test.normalizeEbayMinifigOffer({
    ...base,
    title: 'LEGO Harry Potter Minifigur hp481 Neu'
  }, 'hp481');
  assert.equal(matching.total, 9.6);
  assert.equal(matching.itemId, 'v1|205269965168|0');

  assert.equal(__test.normalizeEbayMinifigOffer({
    ...base,
    title: 'LEGO Harry Potter Minifigur hp4810 Neu'
  }, 'hp481'), null);
  assert.equal(__test.normalizeEbayMinifigOffer({
    ...base,
    title: 'LEGO Custom Minifigur hp481 Neu'
  }, 'hp481'), null);
  assert.equal(__test.normalizeEbayMinifigOffer({
    ...base,
    title: 'LEGO Harry Potter Minifigur hp481 Neu',
    itemGroupHref: 'https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=205269965168',
    itemGroupType: 'SELLER_DEFINED_VARIATIONS',
    price: { value: '1.89', currency: 'EUR' }
  }, 'hp481'), null);
});

test('eBay minifigure prices below half of the next offer are discarded', () => {
  const offer = (itemPrice, shipping = 0) => ({
    itemPrice,
    shipping,
    total: itemPrice + shipping
  });
  const filtered = __test.filterEbayMinifigPriceOutliers([
    offer(1.89, 1.8),
    offer(5.45, 1.3),
    offer(6.79, 0)
  ]);
  assert.equal(filtered.excludedCount, 1);
  assert.equal(filtered.offers.length, 2);
  assert.equal(filtered.offers[0].itemPrice, 5.45);

  const exactHalf = __test.filterEbayMinifigPriceOutliers([
    offer(5),
    offer(10)
  ]);
  assert.equal(exactHalf.excludedCount, 0);
});

test('regular eBay offers below half of the next delivered price are discarded', () => {
  const filtered = __test.excludeSuspiciousEbayLowPrices([
    { total: 40 },
    { total: 100 },
    { total: 110 }
  ]);
  assert.equal(filtered.excludedCount, 1);
  assert.deepEqual(filtered.offers.map(offer => offer.total), [100, 110]);

  const exactHalf = __test.excludeSuspiciousEbayLowPrices([
    { total: 50 },
    { total: 100 }
  ]);
  assert.equal(exactHalf.excludedCount, 0);
});

test('eBay minifigure route searches by BrickLink ID and returns the matching listing', async () => {
  const originalFetch = globalThis.fetch;
  let browseUrl = null;
  globalThis.fetch = async (requestUrl) => {
    const currentUrl = new URL(requestUrl);
    if (currentUrl.pathname.includes('/identity/v1/oauth2/token')) {
      return Response.json({ access_token: 'token', expires_in: 7200 });
    }
    browseUrl = currentUrl;
    return Response.json({
      itemSummaries: [
        {
          title: 'LEGO Harry Potter Minifigur hp481 Neu',
          itemId: 'v1|variation-group|0',
          itemGroupHref: 'https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=variation-group',
          itemGroupType: 'SELLER_DEFINED_VARIATIONS',
          conditionId: '1000',
          condition: 'Neu',
          buyingOptions: ['FIXED_PRICE'],
          price: { value: '1.89', currency: 'EUR' },
          shippingOptions: [{ shippingCost: { value: '1.80', currency: 'EUR' } }],
          itemWebUrl: 'https://www.ebay.de/itm/variation-group'
        },
        {
          title: 'LEGO Harry Potter Minifigur hp481 Neu',
          itemId: 'v1|205269965168|0',
          conditionId: '1000',
          condition: 'Neu',
          buyingOptions: ['FIXED_PRICE'],
          price: { value: '7.70', currency: 'EUR' },
          shippingOptions: [{ shippingCost: { value: '1.90', currency: 'EUR' } }],
          itemWebUrl: 'https://www.ebay.de/itm/205269965168'
        },
        {
          title: 'LEGO Harry Potter Minifigur hp4810 Neu',
          itemId: 'v1|wrong|0',
          conditionId: '1000',
          buyingOptions: ['FIXED_PRICE'],
          price: { value: '1.00', currency: 'EUR' },
          shippingOptions: [{ shippingCost: { value: '0', currency: 'EUR' } }]
        }
      ]
    });
  };
  try {
    const response = await legacyEbayWorker.fetch(
      new Request('https://getdata.example/ebay-minifig?itemNo=hp481'),
      { EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret' },
      context
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.found, true);
    assert.equal(body.cheapest.itemId, 'v1|205269965168|0');
    assert.equal(body.comparedOffers, 1);
    assert.equal(browseUrl.searchParams.get('q'), 'LEGO hp481');
    assert.equal(browseUrl.searchParams.get('category_ids'), null);
    assert.match(browseUrl.searchParams.get('filter'), /buyingOptions:\{FIXED_PRICE\}/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Brickmerge details are no longer served by the Worker', async () => {
  const response = await worker.fetch(
    new Request('https://getdata.example/brickmerge/details?set=42154'),
    {},
    context
  );
  assert.equal(response.status, 404);
});

test('offer bundle cache endpoint never starts an upstream request on a miss', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('Upstream darf bei cache-only nicht aufgerufen werden');
  };
  try {
    const response = await worker.fetch(
      new Request(
        'https://getdata.example/offers/cache?' +
        'set=42154&ean=5702017424965&sources=ebay,ebay-fr,vinted,leboncoin,stockx,idealo,bricklink'
      ),
      { BM_CACHE: { async get() { return null; } } },
      context
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.cacheOnly, true);
    assert.equal(body.complete, false);
    assert.deepEqual(
      Object.fromEntries(Object.entries(body.sources).map(([key, value]) => [key, value.state])),
      {
        ebay: 'missing',
        'ebay-fr': 'missing',
        vinted: 'missing',
        leboncoin: 'missing',
        stockx: 'missing',
        idealo: 'missing',
        bricklink: 'missing'
      }
    );
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('offer bundle publishes cache layer and timestamp for refreshed eBay data', async () => {
  let forwardedPath = '';
  const response = await worker.fetch(
    new Request(
      'https://getdata.example/offers/refresh?' +
      'set=42154&ean=5702017424965&sources=ebay'
    ),
    {
      BM_CACHE: {
        async get() { return null; },
        async put() {}
      },
      LEGACY_WORKER: {
        async fetch(request) {
          forwardedPath = new URL(request.url).pathname;
          return Response.json({
            found: true,
            cheapest: { total: 89.95 },
            offers: [{ title: 'LEGO Technic 42154 Ford GT Neu OVP', total: 89.95 }]
          });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sources.ebay.state, 'ready');
  assert.equal(body.sources.ebay.cacheState, 'MISS');
  assert.equal(body.sources.ebay.data.found, true);
  assert.equal(Number.isFinite(body.sources.ebay.savedAt), true);
  assert.equal(body.sources.ebay.savedAt > 0, true);
  assert.equal(forwardedPath, '/price');
});

test('secret-dependent price route uses the unchanged legacy Worker', async () => {
  let forwardedUrl = '';
  const response = await worker.fetch(
    new Request('https://getdata.example/price?ean=5702017812816&set=76443'),
    {
      LEGACY_WORKER: {
        async fetch(request) {
          forwardedUrl = request.url;
          return Response.json({ delegated: true });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delegated, true);
  assert.equal(new URL(forwardedUrl).pathname, '/price');
});

test('eBay France uses EBAY_FR and delivery to France', async () => {
  const originalFetch = globalThis.fetch;
  const browseRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const requestUrl = String(input);
    if (requestUrl.includes('/identity/v1/oauth2/token')) {
      return Response.json({ access_token: 'test-token', expires_in: 7200 });
    }
    browseRequests.push({ url: new URL(requestUrl), headers: new Headers(init.headers) });
    return Response.json({
      itemSummaries: [{
        title: "Kit d'éclairage LED pour LEGO Star Wars 75302",
        itemId: 'v1|light|0',
        conditionId: '1000',
        condition: 'Neuf',
        buyingOptions: ['FIXED_PRICE'],
        price: { value: '19.99', currency: 'EUR' },
        shippingOptions: [{ shippingCost: { value: '0.00', currency: 'EUR' } }],
        seller: { username: 'vendeur-lumiere' },
        itemWebUrl: 'https://www.ebay.fr/itm/light'
      }, {
        title: 'LEGO Star Wars 75302 Imperial Shuttle Neu OVP',
        itemId: 'v1|123|0',
        conditionId: '1000',
        condition: 'Neuf',
        buyingOptions: ['FIXED_PRICE'],
        price: { value: '79.99', currency: 'EUR' },
        shippingOptions: [{ shippingCost: { value: '5.00', currency: 'EUR' } }],
        seller: { username: 'vendeur-fr' },
        itemWebUrl: 'https://www.ebay.fr/itm/123'
      }]
    });
  };
  try {
    const response = await legacyEbayWorker.fetch(
      new Request('https://getdata.example/ebay-fr?ean=5702016914474&set=75302'),
      { EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret' },
      context
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.found, true);
    assert.equal(body.marketplace, 'EBAY_FR');
    assert.equal(body.cheapest.total, 84.99);
    assert.equal(body.offers.length, 1);
    assert.doesNotMatch(body.cheapest.title, /éclairage/i);
    assert.equal(browseRequests.length, 2);
    browseRequests.forEach(({ url, headers }) => {
      assert.equal(headers.get('x-ebay-c-marketplace-id'), 'EBAY_FR');
      assert.match(url.searchParams.get('filter'), /deliveryCountry:FR/);
      assert.match(url.searchParams.get('filter'), /itemLocationCountry:FR/);
      assert.doesNotMatch(url.searchParams.get('filter'), /sellerAccountTypes/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('eBay France is delegated to the isolated eBay Worker when bound', async () => {
  let forwardedUrl = '';
  const response = await worker.fetch(
    new Request('https://getdata.example/ebay-fr?ean=5702016914474&set=75302'),
    {
      LEGACY_WORKER: {
        async fetch(request) {
          forwardedUrl = request.url;
          return Response.json({
            found: true,
            marketplace: 'EBAY_FR',
            deliveryCountry: 'FR',
            cheapest: { itemPrice: 79.99, shipping: 5, total: 84.99 },
            offers: []
          });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  assert.equal(new URL(forwardedUrl).pathname, '/ebay-fr');
  assert.equal((await response.json()).marketplace, 'EBAY_FR');
});

test('getdata applies the French title filter to delegated eBay France offers', async () => {
  const response = await worker.fetch(
    new Request('https://getdata.example/ebay-fr?ean=5702016914474&set=75302'),
    {
      LEGACY_WORKER: {
        async fetch() {
          return Response.json({
            found: true,
            marketplace: 'EBAY_FR',
            cheapest: {
              title: "Kit d'éclairage LED pour LEGO 75302",
              total: 19.99
            },
            offers: [
              { title: "Kit d'éclairage LED pour LEGO 75302", total: 19.99 },
              { title: 'LEGO Star Wars 75302 Navette Impériale neuf scellé', total: 84.99 }
            ]
          });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.comparedOffers, 1);
  assert.equal(body.cheapest.total, 84.99);
  assert.equal(body.excludedIrrelevantOffers, 1);
});

test('eBay minifigure route is delegated to the isolated eBay Worker', async () => {
  let forwardedUrl = '';
  const response = await worker.fetch(
    new Request('https://getdata.example/ebay-minifig?itemNo=sh1000'),
    {
      LEGACY_WORKER: {
        async fetch(request) {
          forwardedUrl = request.url;
          return Response.json({ found: true, isolated: true });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isolated, true);
  assert.equal(new URL(forwardedUrl).pathname, '/ebay-minifig');
});

test('getdata removes irrelevant offers returned by the legacy eBay Worker', async () => {
  const response = await worker.fetch(
    new Request(
      'https://getdata.example/price?ean=5702017424965&set=42154'
    ),
    {
      LEGACY_WORKER: {
        async fetch() {
          return Response.json({
            found: true,
            cheapest: { title: 'Vitrine für LEGO 42154', total: 29.99 },
            comparedOffers: 2,
            offers: [
              { title: 'Vitrine für LEGO 42154', total: 29.99 },
              {
                title: 'LEGO Technic 42154 Ford GT Neu OVP komplettes Set',
                total: 89.99
              }
            ]
          });
        }
      }
    },
    context
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.comparedOffers, 1);
  assert.equal(body.excludedIrrelevantOffers, 1);
  assert.equal(body.cheapest.total, 89.99);
});

test('Kleinanzeigen uses the Worker secret before the Apify fallback', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  let usedSecret = '';
  globalThis.fetch = async (input, init = {}) => {
    requestedUrls.push(String(input));
    usedSecret = new Headers(init.headers).get('klaz_key') || '';
    return Response.json({
      data: {
        ads: [{
          title: 'LEGO Technic 42154 Ford GT Neu OVP',
          description: 'Komplettes Set mit Versand',
          condition: 'new',
          price: { amount: 89.99, currency_code: 'EUR' },
          ad_url: 'https://www.kleinanzeigen.de/s-anzeige/42154-test',
          status: 'ACTIVE',
          shipping_available: true
        }]
      }
    });
  };
  try {
    const response = await worker.fetch(
      new Request('https://getdata.example/kleinanzeigen?set=42154&async=1'),
      { KLAZ_API_KEY: 'klaz_worker_secret', APIFY_TOKEN: 'apify-secret' },
      context
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).found, true);
    assert.equal(usedSecret, 'klaz_worker_secret');
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /api\.kleinanzeigen-agent\.de/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kleinanzeigen starts Apify asynchronously when the primary API fails', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  let storedJob = null;
  globalThis.fetch = async input => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('api.kleinanzeigen-agent.de')) {
      return Response.json({ error_code: 'temporary' }, { status: 503 });
    }
    if (url.includes('/acts/memo23~kleinanzeigen-search-scraper-ppe/runs')) {
      return Response.json({ data: { id: 'fallback-run', status: 'RUNNING' } });
    }
    return new Response('', { status: 500 });
  };
  try {
    const response = await worker.fetch(
      new Request('https://getdata.example/kleinanzeigen?set=42154&async=1&fallback=apify'),
      {
        KLAZ_API_KEY: 'klaz_worker_secret',
        APIFY_TOKEN: 'apify-secret',
        BM_CACHE: {
          async get() { return null; },
          async put(key, value) {
            if (key.startsWith('apify-job:')) storedJob = JSON.parse(value);
          }
        }
      },
      context
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).pending, true);
    assert.equal(storedJob?.marketplace, 'kleinanzeigen');
    assert.equal(storedJob?.runId, 'fallback-run');
    assert.equal(requestedUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatic Kleinanzeigen requests never start the paid Apify fallback', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('api.kleinanzeigen-agent.de')) {
      return Response.json({ error_code: 'temporary' }, { status: 503 });
    }
    throw new Error('Apify darf ohne expliziten Fallback nicht starten');
  };
  try {
    const response = await worker.fetch(
      new Request('https://getdata.example/kleinanzeigen?set=42154&async=1'),
      {
        KLAZ_API_KEY: 'klaz_worker_secret',
        APIFY_TOKEN: 'apify-secret'
      },
      context
    );
    assert.equal(response.status, 503);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /api\.kleinanzeigen-agent\.de/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual offer refresh explicitly enables the Kleinanzeigen Apify fallback', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('api.kleinanzeigen-agent.de')) {
      return Response.json({ error_code: 'temporary' }, { status: 503 });
    }
    if (url.includes('/acts/memo23~kleinanzeigen-search-scraper-ppe/runs')) {
      return Response.json({ data: { id: 'manual-fallback-run', status: 'RUNNING' } });
    }
    return new Response('', { status: 500 });
  };
  try {
    const response = await worker.fetch(
      new Request(
        'https://getdata.example/offers/refresh?' +
        'set=42154&ean=5702017424965&sources=kleinanzeigen'
      ),
      {
        KLAZ_API_KEY: 'klaz_worker_secret',
        APIFY_TOKEN: 'apify-secret',
        BM_CACHE: {
          async get() { return null; },
          async put() {}
        }
      },
      context
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sources.kleinanzeigen.state, 'pending');
    assert.equal(
      requestedUrls.some(url => /kleinanzeigen-search-scraper-ppe/.test(url)),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kleinanzeigen reuses raw Apify results when the comparison price changes', async () => {
  const originalFetch = globalThis.fetch;
  let actorCalls = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('api.kleinanzeigen-agent.de')) {
      return Response.json({ error_code: 'temporary' }, { status: 503 });
    }
    actorCalls += 1;
    throw new Error('Der vorhandene Rohdaten-Cache muss den Actor-Aufruf verhindern');
  };
  try {
    const rawCacheKey = 'bm-central-v22:apify-raw:kleinanzeigen:v4:42154';
    const response = await worker.fetch(
      new Request(
        'https://getdata.example/kleinanzeigen?' +
        'set=42154&best=100&async=1&fallback=apify'
      ),
      {
        KLAZ_API_KEY: 'klaz_worker_secret',
        APIFY_TOKEN: 'apify-secret',
        BM_CACHE: {
          async get(key) {
            if (key !== rawCacheKey) return null;
            return {
              offers: [{
                id: 'cached-offer',
                title: 'LEGO Technic 42154 Ford GT Neu OVP',
                price: 60,
                total: 60,
                url: 'https://www.kleinanzeigen.de/s-anzeige/cached-offer'
              }],
              runId: 'cached-run'
            };
          },
          async put() {}
        }
      },
      context
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-worker-cache'), 'HIT');
    const body = await response.json();
    assert.equal(body.found, true);
    assert.equal(body.cheapest.total, 60);
    assert.equal(body.referencePrice, 100);
    assert.equal(actorCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

  test('Rebrickable API and page routes require the Worker secret', async () => {
    for (const path of [
      '/proxy/rebrickable/set-minifigs?set=42154-1'
    ]) {
      const response = await worker.fetch(
        new Request(`https://getdata.example${path}`),
        {},
        context
      );
      assert.equal(response.status, 401);
      assert.equal(
        (await response.json()).code,
        'REBRICKABLE_SECRET_MISSING'
      );
    }
  });

test('BrickLink-Minifiguren-IDs werden aus dem Setinventar dedupliziert', () => {
    const html = '<a href="catalogitem.page?M=idea123">A</a>' +
      '<a href="catalogItemInv.asp?M=idea123">A2</a>' +
      '<a href="catalogitem.page?M=idea124&amp;x=1">B</a>';
    assert.deepEqual(
      __test.extractBricklinkMinifigItemNos(html),
      ['idea123', 'idea124']
    );
});

test('BrickLink-Minifiguren werden mit Namen und Menge strukturiert extrahiert', () => {
  const html = `
    <tr>
      <td><img src="//img.bricklink.com/twn389.png" alt="Haunted House Butler &amp; Top Hat"></td>
      <td>2</td>
      <td><a href="/v2/catalog/catalogitem.page?M=twn389&">twn389</a></td>
      <td><b>Haunted House Butler</b></td>
    </tr>`;
  assert.deepEqual(__test.extractBricklinkMinifigItems(html), [{
    itemNo: 'twn389',
    name: 'Haunted House Butler & Top Hat',
    quantity: 2,
    imageUrl: 'https://img.bricklink.com/twn389.png'
  }]);
});

  test('buildLeboncoinSearchUrl erzeugt die erwartete Such-URL', () => {
    const url = new URL(__test.buildLeboncoinSearchUrl('71426'));
    assert.equal(url.searchParams.get('text'), 'lego 71426');
    assert.equal(url.searchParams.get('shippable'), '1');
    assert.equal(url.searchParams.get('transaction_status'), 'search__no_value');
    assert.equal(url.searchParams.get('sort'), 'relevance');
    assert.equal(url.searchParams.get('order'), null);
    assert.equal(url.searchParams.get('item_condition'), '1');
  });

  test('APIFY_CONFIG.vinted.buildInput erzeugt das exakte Vinted-Actor-Input', () => {
    const input = __test.APIFY_CONFIG.vinted.buildInput('71426');
    assert.deepEqual(input, {
      market: 'de',
      max_results: 8,
      mode: 'Search Items',
      order: 'relevance',
      query: 'Lego 71426',
      status_ids: '6'
    });
  });

  test('APIFY_CONFIG.leboncoin.buildInput erzeugt das exakte Leboncoin-Actor-Input', () => {
    const input = __test.APIFY_CONFIG.leboncoin.buildInput('71426');
    assert.equal(input.maxResults, 10);
    assert.equal(input.mode, 'listings');
    assert.equal(input.skipReposts, true);
    assert.equal(input.extractContacts, false);
    assert.deepEqual(input.startUrls, [__test.buildLeboncoinSearchUrl('71426')]);
    const searchUrl = new URL(input.startUrls[0]);
    assert.equal(searchUrl.searchParams.get('text'), 'lego 71426');
    assert.equal(searchUrl.searchParams.get('sort'), 'relevance');
    assert.equal(searchUrl.searchParams.get('item_condition'), '1');
    assert.equal(searchUrl.searchParams.get('shippable'), '1');
    assert.equal(input.query, undefined);
    assert.equal(input.sort, undefined);
  });

  test('StockX verwendet drei Treffer und das erforderliche 0,10-USD-Lauflimit', () => {
    const config = __test.APIFY_CONFIG.stockx;
    assert.equal(config.actorId, 'crawlerbros~stockx-scraper');
    assert.equal(config.maxTotalChargeUsd, 0.1);
    assert.deepEqual(config.buildInput('21130'), {
      mode: 'search',
      searchQuery: 'lego 21130',
      country: 'DE',
      currency: 'EUR',
      fetchProductDetails: false,
      maxItems: 3,
      maxPages: 1,
      useProxy: true,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
      }
    });
  });

  test('parseListingPrice normalisiert Zahlen, Strings und deutsche Währungsformate defensiv', () => {
    assert.equal(__test.parseListingPrice(12.5), 12.5);
    assert.equal(__test.parseListingPrice('12.50'), 12.5);
    assert.equal(__test.parseListingPrice('12,50 €'), 12.5);
    assert.equal(__test.parseListingPrice('9.99'), 9.99);
    assert.equal(__test.parseListingPrice(null), null);
    assert.equal(__test.parseListingPrice(''), null);
    assert.equal(__test.parseListingPrice('kein preis'), null);
    assert.equal(__test.parseListingPrice(-1), null);
  });

  test('computeTotalCost summiert Preis, Versand, Schutzgebühr und sonstige Gebühren', () => {
    assert.equal(__test.computeTotalCost({ price: 10 }), 10);
    assert.equal(__test.computeTotalCost({
      price: 10, shippingFee: 3, buyerProtectionFee: 1, fees: 0.5
    }), 14.5);
    assert.equal(__test.computeTotalCost({ total: 13.5, price: 10 }), 13.5);
    assert.equal(__test.computeTotalCost({ total_item_price: 15.99 }), 15.99);
    assert.equal(__test.computeTotalCost(null), null);
    assert.equal(__test.computeTotalCost({ price: null }), null);
  });

  test('dedupeByListingIdOrUrl entfernt Duplikate nach ID und URL', () => {
    const listings = [
      { id: '1', url: 'https://a.de/1', price: 10 },
      { id: '1', url: 'https://a.de/1x', price: 10 },
      { url: 'https://a.de/2', price: 20 },
      { url: 'https://a.de/2', price: 20 },
      { id: '3', url: 'https://a.de/3', price: 30 }
    ];
    const result = __test.dedupeByListingIdOrUrl(listings);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, '1');
    assert.equal(result[1].url, 'https://a.de/2');
    assert.equal(result[2].id, '3');
  });

  test('normalizeVintedItems filtert irrelevante Listings und normalisiert valide', () => {
    const rawItems = [
      { id: 'v1', title: 'LEGO 71426 Bowser Neu OVP', price: '45,00 €', url: 'https://www.vinted.de/items/v1', shippingFee: '3,00 €', buyerProtectionFee: '1,00 €' },
      { id: 'v2', title: 'Minifiguren aus LEGO 71426', price: '10,00 €', url: 'https://www.vinted.de/items/v2' },
      { id: 'v3', title: 'Ersatzteile für LEGO 71426', price: 5, url: 'https://www.vinted.de/items/v3' },
      { id: 'v4', title: 'LEGO 10333 Barad-dur', price: '80,00 €', url: 'https://www.vinted.de/items/v4' },
      { id: 'v5', title: 'LEGO 71426 neu', price: 50, url: 'relativ/zu/vinted' }
    ];
    const result = __test.normalizeVintedItems(rawItems, '71426');
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'v1');
    assert.equal(result[0].price, 45);
    assert.equal(result[0].total, 49);
    assert.equal(result[0].marketplace, 'vinted');
    assert.equal(result[0].raw.title, 'LEGO 71426 Bowser Neu OVP');
    assert.equal(result[1].id, 'v5');
    assert.equal(result[1].url.startsWith('https://www.vinted.de/'), true);
  });

  test('normalizeLeboncoinItems filtert irrelevante Listings und normalisiert valide', () => {
    const rawItems = [
      { id: 'l1', subject: 'LEGO 71426 neuf', price: '40,00 €', url: 'https://www.leboncoin.fr/ad/l1', attributes: [{ key: 'condition', value: 'Neuf' }] },
      { id: 'l2', subject: 'Vitrine pour LEGO 71426', price: '20,00 €', url: 'https://www.leboncoin.fr/ad/l2' },
      { id: 'l3', subject: 'LEGO 42154 Ford GT', price: '70,00 €', url: 'https://www.leboncoin.fr/ad/l3' },
      { id: 'l4', subject: 'Marklin 71426 train connexion', price: 3, url: 'https://www.leboncoin.fr/ad/l4', attributes: { condition: 'etatneuf' } },
      { id: 'l5', subject: 'Playmobil 71426 neuf', price: 4, url: 'https://www.leboncoin.fr/ad/l5', attributes: { condition: 'etatneuf' } },
      { id: 'l6', subject: 'LEGO 71426 neuf - seulement remise en main propre', price: 25, url: 'https://www.leboncoin.fr/ad/l6', attributes: { condition: 'etatneuf', shippable: 'false' } },
      { id: 'l7', subject: 'LEGO 71426 neuf', price: 30, url: 'https://www.leboncoin.fr/ad/l7', attributes: { condition: 'etatneuf', shippable: 'false' } },
      { listingId: '3246277023', title: 'LEGO Super Mario 71426 Plante Piranha neuf', price: 55, url: 'https://www.leboncoin.fr/ad/jeux_jouets/3246277023', city: 'Paris', thumbUrls: ['https://img.leboncoin.fr/example.jpg'], attributes: { condition: 'etatneuf', shippable: 'true' } }
    ];
    const result = __test.normalizeLeboncoinItems(rawItems, '71426');
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'l1');
    assert.equal(result[0].price, 40);
    assert.equal(result[0].marketplace, 'leboncoin');
    assert.equal(result[0].condition, 'Neuf');
    assert.equal(result[1].id, '3246277023');
    assert.equal(result[1].shippingAvailable, true);
    assert.equal(result[1].transactionFee, 3.45);
    assert.equal(result[1].total, 58.45);
  });

  test('Kleinanzeigen-Apify-Input und Filter behalten Versandangebote und verwerfen Abholung', () => {
    const input = __test.APIFY_CONFIG.kleinanzeigen.buildInput('71426');
    assert.equal(input.maxItems, 10);
    assert.match(input.startUrls[0].url, /lego-71426/);
    assert.match(input.startUrls[0].url, /condition_s:new/);
    const result = __test.normalizeKleinanzeigenApifyItems([
      { id: 'k1', title: 'LEGO 71426', condition: 'Neu', price: '49,99 €', itemUrl: 'https://www.kleinanzeigen.de/s-anzeige/k1', shippingCost: '4,99 €', shippingAvailable: true },
      { id: 'k2', title: 'LEGO 71426 neu OVP, nur Abholung', price: '39,99 €', url: 'https://www.kleinanzeigen.de/s-anzeige/k2' },
      { id: 'k3', title: 'Playmobil 71426 neu', price: '5 €', url: 'https://www.kleinanzeigen.de/s-anzeige/k3' }
    ], '71426');
    assert.equal(result.length, 1);
    assert.equal(result[0].total, 54.98);
    assert.equal(result[0].shippingCost, 4.99);
  });

  test('StockX übernimmt nur den lokalisierten deutschen EUR-Lowest-Ask', () => {
    const result = __test.normalizeStockxItems([
      {
        id: 'sx1',
        title: 'LEGO Minecraft The Nether Railway Set 21130',
        lowestAsk: 124,
        currency: 'EUR',
        region: 'DE',
        productUrl: 'https://stockx.com/lego-minecraft-21130',
        thumbUrl: 'https://images.stockx.com/21130.png'
      },
      {
        id: 'sx2',
        title: 'LEGO Minecraft Minifiguren für 21130',
        lowestAsk: 20,
        currency: 'EUR',
        region: 'DE',
        productUrl: 'https://stockx.com/minifigures-21130'
      },
      {
        id: 'sx3',
        title: 'LEGO Set 21131',
        lowestAsk: 90,
        currency: 'EUR',
        region: 'DE',
        productUrl: 'https://stockx.com/lego-21131'
      },
      {
        id: 'sx4',
        title: 'LEGO Minecraft The Nether Railway Set 21130',
        lowestAsk: 100,
        currency: 'USD',
        region: 'US',
        productUrl: 'https://stockx.com/lego-minecraft-21130-us'
      }
    ], '21130');
    assert.equal(result.length, 1);
    assert.equal(result[0].marketplace, 'stockx');
    assert.equal(result[0].price, 124);
    assert.equal(result[0].currency, 'EUR');
    assert.equal(result[0].originalPrice, 124);
    assert.equal(result[0].originalCurrency, 'EUR');
    assert.equal(result[0].region, 'DE');
    assert.equal(result.some(item => item.id === 'sx4'), false);
  });

  test('Idealo normalisiert und sortiert die drei günstigsten Händlerangebote', () => {
    const result = __test.normalizeIdealoItems([{
      status: 'found',
      result: {
        name: 'LEGO Testset',
        offers: [
          { sellerId: 'shop-c', shop_name: 'Shop C', price: 39, shipping: 4.99, total: 43.99, shop_url: 'https://shop-c.example/p' },
          { sellerId: 'shop-a', shop_name: 'Shop A', price: 35, shipping: 0, total: 35, shop_url: 'https://shop-a.example/p' },
          { sellerId: 'shop-b', shop_name: 'Shop B', price: 36, shipping: 2, total: 38, shop_url: 'https://shop-b.example/p' },
          { sellerId: 'shop-d', shop_name: 'Shop D', price: 10, shipping: 2, total: 12, shop_url: 'https://shop-d.example/p' }
        ]
      }
    }]);
    assert.equal(result.length, 3);
    assert.equal(result[0].shopName, 'Shop D');
    assert.equal(result[0].total, 12);
    assert.equal(result[2].shopName, 'Shop B');
  });

  test('Apify-Marktplatz-Route lehnt ohne APIFY_TOKEN asynchron ab', async () => {
    const response = await worker.fetch(
      new Request('https://getdata.example/vinted?set=71426'),
      { BM_CACHE: { async get() { return null; } } },
      context
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'APIFY_TOKEN_MISSING');
  });

  test('Apify-Marktplatz-Route lehnt ungültige Setnummern ab', async () => {
    const response = await worker.fetch(
      new Request('https://getdata.example/vinted?set=abc'),
      { APIFY_TOKEN: 'test-token' },
      context
    );
    assert.equal(response.status, 400);
  });

  test('Asynchroner Apify-Abruf liefert ein vorhandenes Ergebnis ohne neuen Actor-Start', async () => {
    const cachedResult = {
      setNumber: '71426',
      marketplace: 'vinted',
      found: true,
      cheapest: { id: 'cached', total: 42 },
      offers: [{ id: 'cached', total: 42 }]
    };
    const response = await worker.fetch(
      new Request('https://getdata.example/vinted?set=71426&best=100&async=1'),
      {
        APIFY_TOKEN: 'secret',
        BM_CACHE: {
          async get(key) {
            return key === 'bm-central-v22:apify-result:vinted:v3:71426:100' ? cachedResult : null;
          }
        }
      },
      context
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-worker-cache'), 'HIT');
    assert.deepEqual(await response.json(), cachedResult);
  });

  test('Asynchroner Actor-Start meldet Fehler ohne Token-Leck', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('Actor unavailable', { status: 500 });
    try {
      const response = await worker.fetch(
        new Request('https://getdata.example/vinted?set=71426'),
        {
          APIFY_TOKEN: 'super-secret-token-never-log',
          BM_CACHE: { async get() { return null; } }
        },
        context
      );
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.code, 'ACTOR_START_FAILED');
      const bodyText = JSON.stringify(body);
      assert.equal(bodyText.includes('super-secret-token'), false, 'Token darf nicht in der Antwort-Leak');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
