import { getEbayUserAccessToken } from './ebay-oauth.js';

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
    if (url.pathname === '/v1/draft-status') {
      const token = await getUserToken(env);
      const taskIds = [...new Set((body.taskIds || []).map(String).filter(Boolean))].slice(0, 50);
      const tasks = [];
      for (const taskId of taskIds) tasks.push(await getSellerHubDraftTask(taskId, token));
      return json({ tasks });
    }
    const results = [];
    for (const row of body.rows || []) results.push(await processRow(row, action, env, helpers));
    return json({ results });
  } catch (error) {
    console.error('eBay draft request failed', { message: String(error?.message || error) });
    return json({ error: String(error?.message || error) }, 400);
  }
}

async function getSellerHubDraftTask(taskId, token) {
  const response = await fetch(`https://api.ebay.com/sell/feed/v1/task/${encodeURIComponent(taskId)}`, {
    headers: { authorization: `Bearer ${token}`, 'x-ebay-c-marketplace-id': MARKETPLACE_ID }
  });
  const text = await limitedText(response, 256_000);
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) return { taskId, status: 'FEHLER', message: data.errors?.[0]?.message || `eBay Feed-Status ${response.status}` };
  return {
    taskId,
    status: data.status || 'UNBEKANNT',
    successCount: data.uploadSummary?.successCount ?? null,
    failureCount: data.uploadSummary?.failureCount ?? null
  };
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
    const eBay = await createSellerHubDraft(row, itemPrice, image.urls, env);
    return { ...result, draftId: eBay.sku, taskId: eBay.taskId, status: 'ENTWURF EINGEREICHT' };
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

async function createSellerHubDraft(row, itemPrice, imageUrls, env) {
  const token = await getUserToken(env);
  const sku = sanitizeSku(row.sku || `LEGO-${row.setNumber}`);
  const storedTask = env.EBAY_OAUTH_STORE && await env.EBAY_OAUTH_STORE.get(`ebay:draft-task:${sku}`);
  if (storedTask) return { sku, taskId: storedTask };

  const taskResponse = await fetch('https://api.ebay.com/sell/feed/v1/task', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-ebay-c-marketplace-id': MARKETPLACE_ID
    },
    body: JSON.stringify({ feedType: 'FX_LISTING', schemaVersion: '1.0' })
  });
  const taskText = await limitedText(taskResponse, 256_000);
  let taskData = {};
  try { taskData = JSON.parse(taskText); } catch {}
  if (!taskResponse.ok) throw new Error(taskData.errors?.[0]?.message || `eBay Feed-Task ${taskResponse.status}`);
  const taskId = taskData.taskId || extractTaskId(taskResponse.headers.get('location'));
  if (!taskId) throw new Error('eBay Feed API hat keine Task-ID geliefert.');

  const csv = buildSellerHubDraftCsv(row, sku, itemPrice, imageUrls[0], env);
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv;charset=UTF-8' }), `ebay-draft-${sku}.csv`);
  const uploadResponse = await fetch(`https://api.ebay.com/sell/feed/v1/task/${encodeURIComponent(taskId)}/upload_file`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-ebay-c-marketplace-id': MARKETPLACE_ID },
    body: form
  });
  const uploadText = await limitedText(uploadResponse, 256_000);
  if (!uploadResponse.ok) {
    let uploadData = {};
    try { uploadData = JSON.parse(uploadText); } catch {}
    throw new Error(uploadData.errors?.[0]?.message || `eBay Feed-Upload ${uploadResponse.status}`);
  }
  if (env.EBAY_OAUTH_STORE) {
    await env.EBAY_OAUTH_STORE.put(`ebay:draft-task:${sku}`, taskId, { expirationTtl: 30 * 24 * 60 * 60 });
  }
  return { sku, taskId };
}

export function buildSellerHubDraftCsv(row, sku, itemPrice, imageUrl, env) {
  const title = String(row.title || `LEGO ${row.setNumber}`).trim().slice(0, 80);
  const isDuplo = /duplo/i.test(`${row.duplo || ''} ${title}`);
  const safety = isDuplo
    ? '<p>LEGO DUPLO ist für Kinder unter 3 Jahren geeignet. Bitte die Altersempfehlung auf der Originalverpackung beachten.</p>'
    : '<p><strong>Achtung:</strong> Nicht für Kinder unter 36 Monaten geeignet. Kleine Teile. Erstickungsgefahr.</p>';
  const description = row.description || `${env.EBAY_LISTING_DESCRIPTION_TEMPLATE || `<p><strong>${escapeHtml(title)}</strong></p><p>Neu und originalverpackt.</p>`}${safety}<p>Hersteller: LEGO System A/S, Aastvej 1, 7190 Billund, Dänemark.</p>`;
  const header = 'Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8);Custom label (SKU);Category ID;Title;UPC;Price;Quantity;Item photo URL;Condition ID;Description;Format';
  const values = ['Draft', sku, env.EBAY_CATEGORY_ID || '19006', title, row.ean || '', itemPrice.toFixed(2), String(Number(row.quantity)), imageUrl || '', 'NEW', description, 'FixedPrice'];
  return `\uFEFF#INFO;Version=0.0.2;Template= eBay-draft-listings-template_DE;;;;;;;\r\n#INFO Action und Category ID sind erforderliche Felder. 1) Stellen Sie Action auf Draft ein. 2) Die Kategorie-ID für Ihre Angebote finden Sie hier: https://pages.ebay.com/sellerinformation/news/categorychanges.html;;;;;;;;;\r\n#INFO Nachdem Sie Ihren Entwurf erfolgreich im Berichte-Tab Ihres Verkäufer-Cockpit Pro heruntergeladen haben; können Sie die Entwürfe hier zu aktiven Angeboten vervollständigen: https://www.ebay.de/sh/lst/drafts;;;;;;;;;\r\n#INFO;;;;;;;;;;\r\n${header}\r\n${values.map(csvCell).join(';')}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sanitizeSku(value) {
  const sku = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  if (!sku) throw new Error('Keine gültige SKU erzeugbar.');
  return sku;
}

function extractTaskId(location) {
  const match = String(location || '').match(/\/task\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
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
  return getEbayUserAccessToken(env);
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
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } }); }
