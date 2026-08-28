const DEFAULT_SHIPPING = 4.99;
const MARKETPLACE_ID = 'EBAY_DE';

export async function handleEbayDrafts(request, url, env, helpers) {
  if (request.method !== 'POST') return json({ error: 'Nur POST ist erlaubt.' }, 405);
  if (!env.DRAFT_API_TOKEN || !(await sameSecret(request.headers.get('authorization') || '', env.DRAFT_API_TOKEN))) {
    return json({ error: 'Nicht autorisiert.' }, 401);
  }
  const action = url.pathname === '/v1/preview' ? 'preview' : 'draft';
  try {
    const body = await request.json();
    const results = [];
    for (const row of body.rows || []) results.push(await processRow(row, action, env, helpers));
    return json({ results });
  } catch (error) {
    console.error('eBay draft request failed', { message: String(error?.message || error) });
    return json({ error: String(error?.message || error) }, 400);
  }
}

async function processRow(row, action, env, helpers) {
  const base = { rowNumber: row.rowNumber, shippingPrice: DEFAULT_SHIPPING, messages: [] };
  const validation = validateRow(row);
  if (!validation.ok) return { ...base, status: 'NICHT BERECHTIGT', messages: validation.messages };
  const threshold = validateThreshold(row);
  if (!threshold.ok) return { ...base, status: 'NICHT BERECHTIGT', messages: threshold.messages };

  const offers = await searchCommercialOffers(row, env, helpers);
  if (!offers.length) return { ...base, status: 'PRÜFEN', messages: ['Kein passendes gewerbliches eBay-Angebot mit bekanntem Versand gefunden.'] };
  const competitor = offers[0];
  const totalPrice = roundMoney(competitor.total - Number(env.DRAFT_PRICE_UNDERCUT_EUR || 0.01));
  const itemPrice = roundMoney(totalPrice - DEFAULT_SHIPPING);
  if (itemPrice <= 0) return { ...base, status: 'PRÜFEN', messages: ['Der Zielpreis ergibt nach 4,99 EUR Versand keinen gültigen Artikelpreis.'] };

  const profit = calculateProfit(row, totalPrice, env);
  if (!profit.ok) return { ...base, status: 'PRÜFEN', itemPrice, totalPrice, competitorTotal: competitor.total, competitorUrl: competitor.url, messages: profit.messages };

  const image = await resolveImages(row, competitor, env);
  const legal = validateListingConfig(row, env);
  const result = {
    ...base,
    status: action === 'preview' ? 'VORSCHAU' : 'ENTWURF BEREIT',
    itemPrice,
    totalPrice,
    competitorTotal: competitor.total,
    competitorUrl: competitor.url,
    imageSource: image.source,
    messages: [...legal.messages, ...image.messages]
  };
  if (action === 'preview' || env.EBAY_DRAFT_WRITES_ENABLED !== 'true') return result;
  if (!legal.ok || !image.urls.length) return { ...result, status: 'PRÜFEN', messages: [...result.messages, 'eBay-Schreibzugriff wegen fehlender Pflichtdaten oder Bilder übersprungen.'] };

  try {
    const eBay = await createUnpublishedOffer(row, itemPrice, image.urls, env);
    return { ...result, draftId: eBay.sku, offerId: eBay.offerId, status: 'ENTWURF BEREIT' };
  } catch (error) {
    return { ...result, status: 'FEHLER', messages: [...result.messages, String(error?.message || error)] };
  }
}

function validateRow(row) {
  const messages = [];
  if (!row.setNumber && !row.ean) messages.push('Setnummer oder EAN fehlt.');
  if (!(Number(row.quantity) > 0)) messages.push('Bestand ist nicht größer als 0.');
  if (/^(ja|yes|true|verkauft)$/i.test(String(row.sold || '').trim())) messages.push('Set ist als verkauft markiert.');
  return { ok: messages.length === 0, messages };
}

function validateThreshold(row) {
  const ek = row.ek;
  const brickmerge = Number(row.brickmergePrice);
  const isGwp = typeof ek === 'number' && Number.isFinite(ek) && ek === 0;
  const messages = [];
  if (typeof ek !== 'number' || !Number.isFinite(ek)) messages.push('EK fehlt oder ist ungültig.');
  if (Number.isFinite(ek) && ek < 0) messages.push('EK ist negativ und muss geklärt werden.');
  if (!isGwp && Number.isFinite(ek) && (!Number.isFinite(brickmerge) || brickmerge <= ek * 1.75)) messages.push('Brickmerge-Preis liegt nicht mehr als 75 % über dem EK.');
  return { ok: messages.length === 0, messages };
}

function calculateProfit(row, totalPrice, env) {
  const keys = ['EBAY_FEE_PERCENT', 'EBAY_FEE_FIXED_EUR', 'ACTUAL_SHIPPING_COST_EUR', 'PACKAGING_COST_EUR', 'MIN_PROFIT_EUR'];
  const missing = keys.filter(key => env[key] === undefined || env[key] === '');
  if (missing.length) return { ok: false, messages: ['Margen-Konfiguration fehlt: ' + missing.join(', ') + '.'] };
  const values = keys.map(key => Number(env[key]));
  if (!values.every(Number.isFinite)) return { ok: false, messages: ['Margen-Konfiguration enthält ungültige Zahlen.'] };
  const [feePercent, fixedFee, actualShipping, packaging, minimum] = values;
  const ek = Number(row.ek) > 0 ? Number(row.ek) : 0;
  const profit = totalPrice - (totalPrice * feePercent / 100 + fixedFee) - actualShipping - packaging - ek;
  return profit >= minimum
    ? { ok: true, profit }
    : { ok: false, messages: [`Erwarteter Gewinn ${profit.toFixed(2)} EUR liegt unter dem Mindestgewinn ${minimum.toFixed(2)} EUR.`] };
}

async function searchCommercialOffers(row, env, helpers) {
  const token = await helpers.getApplicationToken(env);
  const searches = [];
  if (row.ean) searches.push(['gtin', row.ean]);
  if (row.setNumber) searches.push(['q', `LEGO ${row.setNumber}`]);
  const results = [];
  for (const [parameter, value] of searches) {
    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.set(parameter, value);
    searchUrl.searchParams.set('category_ids', env.EBAY_CATEGORY_ID || '19006');
    searchUrl.searchParams.set('fieldgroups', 'EXTENDED');
    searchUrl.searchParams.set('limit', '200');
    searchUrl.searchParams.set('sort', 'price');
    searchUrl.searchParams.set('filter', 'deliveryCountry:DE,sellerAccountTypes:{BUSINESS},conditionIds:{1000},buyingOptions:{FIXED_PRICE}');
    const response = await fetch(searchUrl, { headers: { authorization: `Bearer ${token}`, 'x-ebay-c-marketplace-id': MARKETPLACE_ID, 'accept-language': 'de-DE' } });
    const data = await response.json();
    if (!response.ok) throw new Error(`eBay Browse API: ${JSON.stringify(data)}`);
    for (const item of data.itemSummaries || []) {
      const offer = helpers.normalizeOffer(item, row.setNumber, parameter === 'gtin' ? 'GTIN' : 'SET_NUMBER', { requiredCategoryId: env.EBAY_CATEGORY_ID || '19006', titleLocale: 'de' });
      if (offer) results.push(offer);
    }
  }
  const unique = [...new Map(results.map(offer => [offer.itemId, offer])).values()];
  return unique.sort((a, b) => a.total - b.total);
}

async function createUnpublishedOffer(row, itemPrice, imageUrls, env) {
  if (!env.EBAY_REFRESH_TOKEN) throw new Error('EBAY_REFRESH_TOKEN fehlt.');
  const token = await getUserToken(env);
  const sku = row.sku || `LEGO-${row.setNumber}`;
  const existing = await ebayUserFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, token);
  const existingOffer = existing.offers?.[0];
  if (existingOffer?.offerId) return { sku, offerId: existingOffer.offerId };
  const aspects = { Marke: ['LEGO'] };
  if (row.ean) aspects.EAN = [row.ean];
  if (/duplo/i.test(String(row.duplo || ''))) aspects.Altersstufe = ['2+'];
  const inventory = { product: { title: row.title || `LEGO ${row.setNumber}`, imageUrls, aspects }, condition: 'NEW', availability: { shipToLocationAvailability: { quantity: Number(row.quantity) } } };
  if (env.EBAY_REGULATORY_JSON) inventory.regulatory = JSON.parse(env.EBAY_REGULATORY_JSON);
  await ebayUserFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, token, { method: 'PUT', body: inventory });
  const offer = await ebayUserFetch('/sell/inventory/v1/offer', token, { method: 'POST', body: {
    sku, marketplaceId: MARKETPLACE_ID, format: 'FIXED_PRICE', availableQuantity: Number(row.quantity), categoryId: env.EBAY_CATEGORY_ID,
    listingDescription: row.description || env.EBAY_LISTING_DESCRIPTION_TEMPLATE || row.title || `LEGO ${row.setNumber}`,
    pricingSummary: { price: { value: itemPrice.toFixed(2), currency: 'EUR' } }, merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY,
    listingPolicies: { fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID, paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID, returnPolicyId: env.EBAY_RETURN_POLICY_ID }
  } });
  return { sku, offerId: offer.offerId || '' };
}

async function resolveImages(row, competitor, env) {
  const messages = [];
  const urls = [];
  if (env.LEGO_IMAGES_ENABLED === 'true' && row.legoImageUrl) urls.push(row.legoImageUrl);
  if (env.LEGO_IMAGES_ENABLED === 'true' && !urls.length && row.legoProductUrl) {
    const html = await limitedText(await fetch(row.legoProductUrl, { headers: { 'user-agent': 'LEGO-eBay-Draft-Tool/1.0' } }), 2_000_000);
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (match) urls.push(decodeHtml(match[1]));
  }
  if (!urls.length && competitor.image) {
    urls.push(competitor.image);
    messages.push('eBay-Katalogbild als Fallback verwendet.');
    return { urls, source: 'eBay-Katalog', messages };
  }
  return { urls: [...new Set(urls)].slice(0, 12), source: urls.length ? 'LEGO.de' : 'keine', messages: urls.length ? [...messages, 'LEGO.de-Bild verwendet; Nutzungsrecht vor Veröffentlichung prüfen.'] : ['Kein Bild gefunden.'] };
}

function validateListingConfig(row, env) {
  const required = ['EBAY_CATEGORY_ID', 'EBAY_FULFILLMENT_POLICY_ID', 'EBAY_PAYMENT_POLICY_ID', 'EBAY_RETURN_POLICY_ID', 'EBAY_MERCHANT_LOCATION_KEY'];
  const missing = required.filter(key => !env[key]);
  const messages = missing.length ? ['eBay-Konfiguration fehlt: ' + missing.join(', ') + '.'] : [];
  if (env.EBAY_DRAFT_WRITES_ENABLED === 'true' && !env.EBAY_REGULATORY_JSON) messages.push('GPSR-Regulierungsdaten fehlen.');
  return { ok: messages.length === 0, messages };
}

async function getUserToken(env) {
  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.EBAY_REFRESH_TOKEN });
  if (env.EBAY_USER_SCOPES) body.set('scope', env.EBAY_USER_SCOPES);
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST', headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('eBay-Benutzer-OAuth fehlgeschlagen.');
  return data.access_token;
}

async function ebayUserFetch(path, token, options = {}) {
  const response = await fetch(`https://api.ebay.com${path}`, { method: options.method || 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'accept-language': 'de-DE' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await limitedText(response, 1_000_000);
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(data.errors?.[0]?.message || `eBay Inventory API ${response.status}`);
  return data;
}

async function limitedText(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total <= maxBytes) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) { await reader.cancel('response too large'); throw new Error('Externe Antwort ist zu groß.'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function sameSecret(header, expected) {
  const supplied = header.replace(/^Bearer\s+/i, '');
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  return a === b;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeHtml(value) { return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"'); }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } }); }
