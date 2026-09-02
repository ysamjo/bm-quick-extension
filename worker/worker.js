import { isCompleteEbaySetTitle } from "./lib/ebay-title-filter.js";
import { handleEbayDrafts } from "./ebay-drafts.js";
import { handleEbayOAuth } from "./ebay-oauth.js";

// src/legacy.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var cachedToken = null;
var tokenExpiresAt = 0;
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*"
};
var KLAZ_CACHE_VERSION = "v7";
var KLAZ_CACHE_TTL_SECONDS = 2 * 60 * 60;
var KLAZ_EMPTY_CACHE_TTL_SECONDS = 20 * 60;
var KLAZ_MIN_REFERENCE_PRICE_RATIO = 0.5;
var EBAY_CACHE_VERSION = "v2";
var EBAY_FR_CACHE_VERSION = "v3";
var EBAY_MINIFIG_CACHE_VERSION = "v6";
var EBAY_CACHE_TTL_SECONDS = 2 * 60 * 60;
var EBAY_EMPTY_CACHE_TTL_SECONDS = 20 * 60;
var ebay_price_worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && ["/oauth/start", "/oauth/callback", "/oauth/declined"].includes(url.pathname)) {
      return handleEbayOAuth(request, url, env);
    }
    if (request.method === "POST" && (url.pathname === "/v1/preview" || url.pathname === "/v1/drafts" || url.pathname === "/v1/draft-status")) {
      return handleEbayDrafts(request, url, env, { getApplicationToken, normalizeOffer });
    }
    if (request.method === "GET" && url.pathname === "/ebay-webhook") {
      return handleWebhookChallenge(url, env);
    }
    if (request.method === "POST" && url.pathname === "/ebay-webhook") {
      await request.text();
      return json({ received: true });
    }
    if (request.method === "GET" && url.pathname === "/price") {
      try {
        return await handlePrice(request, url, env, ctx);
      } catch (error) {
        console.error("eBay price request failed", error);
        return json({
          error: "eBay-Abfrage fehlgeschlagen",
          details: String(error?.message || error)
        }, 502);
      }
    }
    if (request.method === "GET" && url.pathname === "/ebay-fr") {
      try {
        return await handlePrice(request, url, env, ctx);
      } catch (error) {
        console.error("eBay France price request failed", error);
        return json({
          error: "eBay.fr-Abfrage fehlgeschlagen",
          details: String(error?.message || error)
        }, 502);
      }
    }
    if (request.method === "GET" && url.pathname === "/ebay-minifig") {
      try {
        return await handleEbayMinifigPrice(request, url, env, ctx);
      } catch (error) {
        console.error("eBay minifigure request failed", error);
        return json({ error: "eBay-Minifigurenabfrage fehlgeschlagen" }, 502);
      }
    }
    if (request.method === "GET" && url.pathname === "/kleinanzeigen") {
      return handleKleinanzeigen(request, url, env, ctx);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...JSON_HEADERS,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-bm-client-id"
        }
      });
    }
    return json({
      ok: true,
      usage: "/price?ean=5702017812816&set=76443",
      kleinanzeigen: "/kleinanzeigen?set=10305",
      webhook: "/ebay-webhook"
    });
  }
};
async function handleKleinanzeigen(request, url, env, ctx) {
  const setNumber = (url.searchParams.get("set") || "").trim();
  if (!/^\d{3,7}$/.test(setNumber)) {
    return json({
      error: "LEGO-Setnummer muss aus 3 bis 7 Ziffern bestehen"
    }, 400);
  }
  if (!env.KLAZ_API_KEY) {
    return json({ error: "Kleinanzeigen-Agent API-Secret fehlt" }, 500);
  }
  const requestedReferencePrice = Number(url.searchParams.get("best"));
  const referencePrice = Number.isFinite(requestedReferencePrice) && requestedReferencePrice > 0 && requestedReferencePrice <= 1e4 ? roundMoney(requestedReferencePrice) : null;
  const cache = caches.default;
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = `/__cache/kleinanzeigen-${KLAZ_CACHE_VERSION}`;
  cacheUrl.search = new URLSearchParams({
    set: setNumber,
    best: referencePrice === null ? "none" : referencePrice.toFixed(2)
  }).toString();
  const cacheKey = new Request(cacheUrl.href, { method: "GET" });
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return addResponseHeaders(cachedResponse, {
      "cache-control": "no-store",
      "x-worker-cache": "HIT"
    });
  }
  const rateLimitResponse = await enforceUpstreamRateLimit(
    request,
    env,
    "kleinanzeigen"
  );
  if (rateLimitResponse) return rateLimitResponse;
  const searchUrl = new URL(
    "https://api.kleinanzeigen-agent.de/api/v2/kleinanzeigen/search"
  );
  searchUrl.searchParams.set("q", `LEGO ${setNumber}`);
  searchUrl.searchParams.set("size", "100");
  searchUrl.searchParams.set("category_id", "23");
  searchUrl.searchParams.set("picture_required", "true");
  searchUrl.searchParams.set("attr[condition]", "new");
  const upstreamResponse = await fetch(searchUrl, {
    headers: {
      accept: "application/json",
      klaz_key: env.KLAZ_API_KEY
    }
  });
  const payload = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    return json({
      error: "Kleinanzeigen-Agent API",
      upstreamStatus: upstreamResponse.status,
      errorCode: payload?.error_code || null
    }, upstreamResponse.status);
  }
  const normalizedOffers = normalizeKleinanzeigenOffers(payload, setNumber);
  const {
    offers,
    excludedCount,
    excludedBelowReferencePrice,
    minimumReferencePrice
  } = excludeSuspiciousLowPrices(
    normalizedOffers,
    referencePrice
  );
  const found = offers.length > 0;
  const ttlSeconds = found ? KLAZ_CACHE_TTL_SECONDS : KLAZ_EMPTY_CACHE_TTL_SECONDS;
  const updatedAt = /* @__PURE__ */ new Date();
  const expiresAt = new Date(updatedAt.getTime() + ttlSeconds * 1e3);
  const body = {
    setNumber,
    found,
    cheapest: found ? offers[0] : null,
    comparedOffers: offers.length,
    excludedSuspiciousOffers: excludedCount,
    excludedBelowReferencePrice,
    referencePrice,
    minimumReferencePrice,
    offers: offers.slice(0, 10),
    updatedAt: updatedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const cacheResponse = json(body, 200, {
    "cache-control": `public, max-age=${ttlSeconds}`
  });
  const storeInCache = cache.put(cacheKey, cacheResponse);
  if (ctx?.waitUntil) ctx.waitUntil(storeInCache);
  else await storeInCache;
  return json(body, 200, {
    "cache-control": "no-store",
    "x-worker-cache": "MISS"
  });
}
__name(handleKleinanzeigen, "handleKleinanzeigen");
function normalizeKleinanzeigenOffers(payload, setNumber) {
  const escapedSetNumber = escapeRegExp(setNumber);
  const setNumberPattern = new RegExp(
    `(?:^|[^0-9])${escapedSetNumber}(?:[^0-9]|$)`
  );
  const ads = Array.isArray(payload?.data?.ads) ? payload.data.ads : [];
  return ads.map((ad) => {
    const title = String(ad?.title || "").trim();
    const description = String(ad?.description || "");
    const searchableText = `${title} ${description}`;
    const titleSetNumbers = title.match(/\b\d{3,7}\b/g) || [];
    const hasDifferentSetNumber = titleSetNumbers.some(
      (candidate) => candidate !== setNumber
    );
    const itemPrice = Number(ad?.price?.amount);
    const itemUrl = String(ad?.ad_url || "").trim();
    const status = String(ad?.status || "").toUpperCase();
    const condition = getKleinanzeigenCondition(ad);
    if (!setNumberPattern.test(searchableText) || condition !== "new" || hasMissingMinifigureSignal(searchableText) || hasIncompleteSetSignal(title, description) || hasDifferentSetNumber || !Number.isFinite(itemPrice) || itemPrice <= 0 || !itemUrl || ad?.deleted === true || status && status !== "ACTIVE") {
      return null;
    }
    return {
      title,
      price: roundMoney(itemPrice),
      currency: ad?.price?.currency_code || "EUR",
      negotiable: ad?.price?.negotiable === true,
      city: String(ad?.location?.city || ad?.location?.name || "").trim(),
      shippingAvailable: ad?.shipping_available === true,
      condition,
      url: itemUrl,
      createdAt: ad?.created_at || null
    };
  }).filter(Boolean).sort((a, b) => a.price - b.price);
}
__name(normalizeKleinanzeigenOffers, "normalizeKleinanzeigenOffers");
function getKleinanzeigenCondition(ad) {
  const conditionValues = [];
  const appendPrimitiveValues = /* @__PURE__ */ __name((value) => {
    if (Array.isArray(value)) {
      value.forEach(appendPrimitiveValues);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(appendPrimitiveValues);
      return;
    }
    if (value !== null && value !== void 0) {
      conditionValues.push(String(value));
    }
  }, "appendPrimitiveValues");
  appendPrimitiveValues(ad?.condition);
  appendPrimitiveValues(ad?.condition_s);
  Object.entries(ad?.details || {}).forEach(([key, value]) => {
    if (/condition|zustand/i.test(key)) appendPrimitiveValues(value);
  });
  (Array.isArray(ad?.attributes) ? ad.attributes : []).forEach((attribute) => {
    const identifier = [
      attribute?.key,
      attribute?.name,
      attribute?.id,
      attribute?.type,
      attribute?.label
    ].filter(Boolean).join(" ");
    if (/condition|zustand/i.test(identifier) || /condition_s/i.test(JSON.stringify(attribute))) {
      appendPrimitiveValues(attribute);
    }
  });
  const normalizedValues = conditionValues.map((value) => value.toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
  const isExactlyNew = normalizedValues.some(
    (value) => value === "new" || value === "neu" || /(?:^|[\s_:=-])condition(?:_s)?[\s_:=-]+new(?:$|[\s,;])/i.test(value) || /(?:^|[\s_:=-])zustand[\s_:=-]+neu(?:$|[\s,;])/i.test(value)
  );
  return isExactlyNew ? "new" : "not-new-or-unknown";
}
__name(getKleinanzeigenCondition, "getKleinanzeigenCondition");
function hasIncompleteSetSignal(title, description) {
  const titleText = String(title || "");
  const searchableText = `${titleText} ${String(description || "")}`;
  const hardExclusionPattern = /\b(?:ersatzteile?|einzelteile?|kleinteile?|anleitungen?|bauanleitungen?|manuals?|instructions?|stickers?|aufkleber|leerkarton|ovp\s*leer|leere\s+(?:ovp|box|verpackung)|box\s*only|empty\s*box|unvollst[aä]ndig|incomplete|moc|custom|kompatibel|compatible|konvolut|parts?\s*only|minifig(?:ur(?:e|en)?|ure?s?)\s*only)\b/i;
  if (hardExclusionPattern.test(searchableText)) return true;
  const onlyAccessoryPattern = /\b(?:nur|lediglich|ausschlie(?:ß|ss)lich|only)\s+(?:die\s+|das\s+|den\s+)?(?:figuren?|minifig(?:ur(?:e|en)?|ure?s?)|steine|teile|parts?|karton|box|ovp|verpackung|anleitung)\b/i;
  if (onlyAccessoryPattern.test(searchableText)) return true;
  const accessoryTitlePattern = /\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?|steine|teile|parts?|karton|box|ovp|verpackung|anleitung)\b/i;
  const completeSetSignal = /\b(?:set|komplett|vollst[aä]ndig|complete|sealed|ovp|neu|new|ungeöffnet|unopened)\b/i;
  return accessoryTitlePattern.test(titleText) && !completeSetSignal.test(titleText);
}
__name(hasIncompleteSetSignal, "hasIncompleteSetSignal");
function excludeSuspiciousLowPrices(offers, referencePrice = null) {
  const minimumReferencePrice = Number.isFinite(referencePrice) ? roundMoney(referencePrice * KLAZ_MIN_REFERENCE_PRICE_RATIO) : null;
  const referenceFilteredOffers = minimumReferencePrice === null ? offers : offers.filter((offer) => offer.price >= minimumReferencePrice);
  const excludedBelowReferencePrice = offers.length - referenceFilteredOffers.length;
  if (referenceFilteredOffers.length < 4) {
    return {
      offers: referenceFilteredOffers,
      excludedCount: excludedBelowReferencePrice,
      excludedBelowReferencePrice,
      minimumReferencePrice
    };
  }
  const prices = referenceFilteredOffers.map((offer) => offer.price).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  const minimumCrediblePrice = median * 0.3;
  const credibleOffers = referenceFilteredOffers.filter(
    (offer) => offer.price >= minimumCrediblePrice
  );
  const medianFilteredOffers = credibleOffers.length > 0 ? credibleOffers : referenceFilteredOffers;
  const excludedByMedian = credibleOffers.length > 0 ? referenceFilteredOffers.length - credibleOffers.length : 0;
  return {
    offers: medianFilteredOffers,
    excludedCount: excludedBelowReferencePrice + excludedByMedian,
    excludedBelowReferencePrice,
    minimumReferencePrice
  };
}
__name(excludeSuspiciousLowPrices, "excludeSuspiciousLowPrices");
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegExp, "escapeRegExp");
function buildLeboncoinSearchUrl(setNumber) {
  const url = new URL("https://www.leboncoin.fr/recherche");
  url.searchParams.set("text", `lego ${setNumber}`);
  url.searchParams.set("shippable", "1");
  url.searchParams.set("transaction_status", "search__no_value");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("item_condition", "1");
  return url.toString();
}
__name(buildLeboncoinSearchUrl, "buildLeboncoinSearchUrl");
function parseListingPrice(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 1e4 ? normalizeMoney(value) : null;
  }
  const text = normalizedText(value);
  if (!text) return null;
  const currencyMatch = text.match(/(?:[\u20ac$£]|eur|€)/i);
  const cleaned = text.replace(/[^0-9.,-]/g, " ").trim();
  if (!cleaned) return null;
  const numericMatch = cleaned.match(/-?\d[\d.,]*\d|\d/);
  if (!numericMatch) return null;
  const raw = numericMatch[0];
  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");
  let normalized = raw;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = raw.replace(",", ".");
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0 || number > 1e4) return null;
  void currencyMatch;
  return normalizeMoney(number);
}
__name(parseListingPrice, "parseListingPrice");
function computeTotalCost(listing) {
  if (!listing || typeof listing !== "object") return null;
  const explicitTotal = parseListingPrice(
    listing.total ?? listing.totalPrice ?? listing.total_item_price ?? listing.totalPriceAmount
  );
  if (explicitTotal !== null) return explicitTotal;
  const price = parseListingPrice(listing.price);
  if (price === null) return null;
  const shipping = parseListingPrice(listing.shippingFee ?? listing.shipping_price ?? listing.shipping ?? listing.delivery_price) ?? 0;
  const protection = parseListingPrice(listing.buyerProtectionFee ?? listing.buyer_fee ?? listing.buyerProtection ?? listing.protectionFee) ?? 0;
  const fees = parseListingPrice(listing.fees ?? listing.serviceFee ?? listing.platformFee) ?? 0;
  return roundMoney(price + shipping + protection + fees);
}
__name(computeTotalCost, "computeTotalCost");
function dedupeByListingIdOrUrl(listings) {
  if (!Array.isArray(listings)) return [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const listing of listings) {
    if (!listing) continue;
    const id = listing.id !== null && listing.id !== void 0 ? String(listing.id).trim() : "";
    const url = listing.url !== null && listing.url !== void 0 ? String(listing.url).trim() : "";
    const key = id || url;
    if (!key) {
      result.push(listing);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(listing);
  }
  return result;
}
__name(dedupeByListingIdOrUrl, "dedupeByListingIdOrUrl");
function isRelevantLegoListing(title, description, setNumber) {
  const titleText = normalizedText(title);
  const descriptionText = normalizedText(description);
  if (!titleText || !setNumber) return false;
  if (!isCompleteEbaySetTitle(titleText, setNumber)) return false;
  if (hasIncompleteSetSignal(titleText, descriptionText)) return false;
  if (hasMissingMinifigureSignal(`${titleText} ${descriptionText}`)) return false;
  return true;
}
__name(isRelevantLegoListing, "isRelevantLegoListing");
function normalizeVintedItems(rawItems, setNumber) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => {
    if (!item || typeof item !== "object") return null;
    const title = normalizedText(
      item.title ?? item.name ?? item.brandTitle ?? item.item_title ?? item.catalogTitle
    );
    const description = normalizedText(item.description ?? item.item_description ?? "");
    if (!isRelevantLegoListing(title, description, setNumber)) return null;
    const price = parseListingPrice(item.totalPrice ?? item.total_item_price ?? item.price);
    if (price === null) return null;
    const total = computeTotalCost(item) ?? price;
    const rawUrl = item.url ?? item.link ?? item.permalink ?? item.item_url;
    const url = absolutizeUrl(rawUrl, "https://www.vinted.de");
    if (!url) return null;
    const id = item.id !== null && item.id !== void 0 ? String(item.id) : null;
    const imageUrl = item.photo ?? item.imageUrl ?? item.image ?? item.photoUrl ?? null;
    const condition = item.statusTitle ?? item.condition ?? item.status ?? null;
    const location = item.location ?? item.city ?? item.country ?? null;
    const shippingAvailable = item.shippingFee !== null && item.shippingFee !== void 0
      ? parseListingPrice(item.shippingFee) !== null
      : item.shipping !== null && item.shipping !== void 0
        ? Boolean(item.shipping)
        : null;
    const sellerName = item.user?.login ?? item.user?.id ?? item.sellerName ?? item.seller ?? null;
    return {
      marketplace: "vinted",
      id,
      title,
      price,
      currency: item.currency ?? item.currencyCode ?? "EUR",
      url,
      imageUrl,
      condition: condition ? String(condition) : null,
      location: location ? String(location) : null,
      shippingAvailable,
      sellerName: sellerName ? String(sellerName) : null,
      total,
      raw: item
    };
  }).filter(Boolean);
}
__name(normalizeVintedItems, "normalizeVintedItems");
function normalizeLeboncoinItems(rawItems, setNumber) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => {
    if (!item || typeof item !== "object") return null;
    const title = normalizedText(
      item.subject ?? item.title ?? item.name ?? item.headline
    );
    const description = normalizedText(item.body ?? item.description ?? "");
    const brand = normalizedText(
      item.attributes?.games_and_toys_brand ?? item.brand ?? item.brandName ?? ""
    );
    if (!/\blego\b/i.test(title) && !/^lego$/i.test(brand)) return null;
    if (!isRelevantLegoListing(title, description, setNumber)) return null;
    const frenchAccessoryPattern = /\b(?:support\s+mural|bo[iî]te\s+(?:lego\s+)?vide|bo[iî]te\s+seule|notice|manuel|instructions?|sans\s+(?:figurines?|pi[eè]ces?)|pi[eè]ces?\s+d[eé]tach[eé]es?|vitrine|[eé]clairage)\b/i;
    if (frenchAccessoryPattern.test(`${title} ${description}`)) return null;
    const condition = item.attributes ? extractLeboncoinCondition(item.attributes) : null;
    const isNew = /\b(?:neuf|neuve|scell[eé]e?|new|sealed)\b/i.test(title) ||
      /^(?:etatneuf|neuf|new)$/i.test(String(condition || ""));
    if (!isNew || String(item.status || "active").toLowerCase() !== "active" ||
      String(item.attributes?.transaction_status || "").toLowerCase() === "sold") return null;
    const deliveryText = `${title} ${description} ${normalizedText(item.shipping ?? item.delivery ?? item.shippingType ?? item.attributes?.shipping_type ?? "")}`;
    if (/\b(?:nur\s+abholung|abholung\s+only|only\s+pickup|pickup\s+only|remise\s+en\s+main\s+propre|retrait\s+sur\s+place)\b/i.test(deliveryText)) return null;
    const price = parseListingPrice(item.price ?? item.price_amount ?? item.total);
    if (price === null) return null;
    const rawUrl = item.url ?? item.link ?? item.permalink;
    const url = absolutizeUrl(rawUrl, "https://www.leboncoin.fr");
    if (!url) return null;
    const rawId = item.id ?? item.listingId;
    const id = rawId !== null && rawId !== void 0 ? String(rawId) : null;
    const imageUrl = item.images?.thumb ?? item.imageUrl ?? item.image ??
      item.images?.[0] ?? item.thumbUrls?.[0] ?? item.imageUrls?.[0] ?? null;
    const location = item.location ?? item.city ?? item.region ?? null;
    const rawShippable = item.shippable ?? item.attributes?.shippable;
    const shippingAvailable = rawShippable !== null && rawShippable !== void 0
      ? /^(?:true|1|yes|oui)$/i.test(String(rawShippable))
      : item.shipping_price !== null && item.shipping_price !== void 0
        ? parseListingPrice(item.shipping_price) !== null
        : null;
    if (shippingAvailable === false) return null;
    const shippingCost = parseListingPrice(
      item.shippingCost ?? item.shipping_price ?? item.delivery_price ?? item.attributes?.shipping_price
    );
    const transactionFee = shippingAvailable === true
      ? roundMoney(0.7 + price * 0.05)
      : null;
    const total = roundMoney(price + (shippingCost ?? 0) + (transactionFee ?? 0));
    const sellerName = item.owner?.name ?? item.sellerName ?? item.user?.name ?? null;
    return {
      marketplace: "leboncoin",
      id,
      title,
      price,
      currency: item.currency ?? "EUR",
      url,
      imageUrl,
      condition: condition ? String(condition) : null,
      location: location ? String(location) : null,
      shippingAvailable,
      shippingCost,
      transactionFee,
      sellerName: sellerName ? String(sellerName) : null,
      total,
      raw: item
    };
  }).filter(Boolean);
}
__name(normalizeLeboncoinItems, "normalizeLeboncoinItems");
function normalizeKleinanzeigenApifyItems(rawItems, setNumber) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => {
    if (!item || typeof item !== "object") return null;
    const title = normalizedText(item.title ?? item.subject ?? item.name ?? item.headline ?? item.product?.title);
    const description = normalizedText(item.description ?? item.body ?? item.product?.description ?? "");
    const condition = normalizedText(item.condition ?? item.zustand ?? item.itemCondition ?? item.offer?.condition ?? item.product?.attributes?.Zustand ?? item.attributes?.listing_attributes?.Zustand ?? item.specifications?.Zustand ?? "");
    const brand = normalizedText(item.brand ?? item.manufacturer ?? item.marke ?? "");
    if ((!/\blego\b/i.test(title) && !/^lego$/i.test(brand)) || !isRelevantLegoListing(title, description, setNumber)) return null;
    // Die Kleinanzeigen-Such-URL enthält zwar den Neu-Filter, der Apify-Actor
    // liefert aber teils trotzdem gebrauchte Anzeigen zurück. Nur ein explizit
    // als "Neu" gekennzeichneter Zustand darf in die Offerlist gelangen.
    if (!/^(?:neu|new)\b/i.test(condition)) return null;
    if (/\b(?:beleuchtungsset|ersatzteile?|vitrine|nur\s+teile|anleitung|karton|leere?\s+box|(?:fehlen|fehlende?)\s+(?:ein\s+paar\s+|einige\s+|mehrere\s+)?(?:teile|steine)|nicht\s+\d+\s*prozentig\s+alles\s+drin)\b/i.test(`${title} ${description}`)) return null;
    const shippingText = `${title} ${description} ${normalizedText(item.shipping ?? item.delivery ?? item.shippingType ?? item.fulfillment ?? "")}`;
    if (/\b(?:nur\s+abholung|abholung\s+only|only\s+pickup|pickup\s+only|selbstabholung)\b/i.test(shippingText)) return null;
    const price = parseListingPrice(item.price ?? item.priceAmount ?? item.amount ?? item.cost ?? item.pricing?.price);
    if (price === null) return null;
    const shippingCost = parseListingPrice(item.shippingCost ?? item.shipping_price ?? item.deliveryCost ?? item.delivery_price ?? item.versandkosten ?? item.shipping);
    const rawUrl = item.url ?? item.link ?? item.adUrl ?? item.ad_url ?? item.itemUrl ?? item.permalink ?? item.product?.url;
    const url = absolutizeUrl(rawUrl, "https://www.kleinanzeigen.de");
    if (!url) return null;
    const shippingLabel = normalizedText(item.shipping ?? item.delivery ?? item.shippingType ?? "");
    const rawShipping = item.shippingAvailable ?? item.shipping_available ?? item.shippable ?? item.hasShipping ?? item.versand ?? item.availability?.shipping_available;
    const shippingAvailable = /\bversand\b/i.test(shippingLabel)
      ? true
      : rawShipping === null || rawShipping === void 0
        ? null
        : !/^(?:false|0|no|nein|abholung)$/i.test(String(rawShipping));
    return {
      marketplace: "kleinanzeigen",
      id: item.id ?? item.listingId ?? item.listing_id ?? item.adId ?? item.ad_id ?? item.itemId ?? item.product?.listing_id ?? null,
      title,
      price,
      currency: item.currency ?? "EUR",
      url,
      imageUrl: item.imageUrl ?? item.image ?? item.image_url ?? item.thumbnail ?? item.images?.[0] ?? item.media?.main_image_url ?? item.media?.primary_image_url ?? null,
      condition: condition || null,
      location: typeof item.location === "string" ? item.location : item.location?.display_location ?? item.location?.locality ?? item.city ?? item.ort ?? null,
      shippingAvailable,
      shippingCost,
      sellerName: item.sellerName ?? item.seller?.seller_name ?? item.seller?.name ?? (typeof item.seller === "string" ? item.seller : null) ?? item.user?.name ?? null,
      total: roundMoney(price + (shippingCost ?? 0)),
      raw: item
    };
  }).filter(Boolean);
}
__name(normalizeKleinanzeigenApifyItems, "normalizeKleinanzeigenApifyItems");
function parseGoogleShoppingDelivery(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/kostenlos|gratis|free\s+delivery/i.test(text)) return 0;
  return parseListingPrice(text);
}
__name(parseGoogleShoppingDelivery, "parseGoogleShoppingDelivery");
function normalizeGoogleShoppingResults(payload, setNumber, best = null) {
  const items = Array.isArray(payload?.shopping_results)
    ? payload.shopping_results
    : [];
  const offers = items.map((item) => {
    if (!item || typeof item !== "object") return null;
    const title = normalizedText(item.title ?? item.name ?? "");
    if (!/\blego\b/i.test(title) ||
      !isRelevantLegoListing(title, item.snippet ?? "", setNumber)) return null;
    if (normalizedText(item.second_hand_condition)) return null;
    if (/[£$]|\bCHF\b/i.test(normalizedText(item.price ?? ""))) return null;
    const itemPrice = parseListingPrice(item.extracted_price ?? item.price);
    if (itemPrice === null) return null;
    const shippingCost = parseGoogleShoppingDelivery(item.delivery);
    const total = roundMoney(itemPrice + (shippingCost ?? 0));
    const rawUrl = item.product_link ?? item.link ?? item.serpapi_product_api;
    const url = absolutizeUrl(rawUrl, "https://www.google.com");
    if (!url) return null;
    const shopName = [
      item.source,
      item.source_name,
      item.shopName,
      typeof item.seller === "string" ? item.seller : item.seller?.name,
      typeof item.merchant === "string" ? item.merchant : item.merchant?.name,
      typeof item.retailer === "string" ? item.retailer : item.retailer?.name,
      typeof item.store === "string" ? item.store : item.store?.name,
      typeof item.vendor === "string" ? item.vendor : item.vendor?.name
    ].map(normalizedText).find(Boolean) ||
      (/^true$/i.test(normalizedText(item.multiple_sources)) ? "Mehrere Händler" : null);
    return {
      marketplace: "google-shopping",
      id: item.product_id ?? item.position ?? null,
      title,
      itemPrice,
      price: itemPrice,
      shippingCost,
      shippingAvailable: shippingCost !== null ? true : null,
      total,
      currency: "EUR",
      url,
      imageUrl: item.thumbnail ?? item.thumbnails?.[0] ?? null,
      shopName,
      delivery: normalizedText(item.delivery ?? "") || null,
      raw: item
    };
  }).filter(Boolean);
  const filtered = excludeSuspiciousLowPrices(offers, best);
  return filtered.offers.sort((left, right) => left.total - right.total);
}
__name(normalizeGoogleShoppingResults, "normalizeGoogleShoppingResults");
function normalizeKlarnaItems(rawItems, setNumber) {
  if (!Array.isArray(rawItems)) return [];
  const offers = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const title = normalizedText(item.name ?? item.productTitle ?? item.title ?? `LEGO ${setNumber}`);
    if (!/\blego\b/i.test(title) || !isRelevantLegoListing(title, item.description ?? "", setNumber)) continue;
    const productUrl = absolutizeUrl(
      item.productUrl ?? item.product_url ?? item.url,
      "https://www.klarna.com/de/"
    ) || `https://www.klarna.com/de/shopping/?q=${encodeURIComponent(`LEGO ${setNumber}`)}`;
    const imageValue = Array.isArray(item.images) ? item.images[0] : item.images ?? item.image;
    const imageUrl = absolutizeUrl(imageValue, "https://www.klarna.com/");
    const addOffer = (merchant, value, extra = {}) => {
      const shopName = normalizedText(merchant);
      const currency = normalizedText(
        extra.currency ?? extra.currencyCode ?? extra.price?.currency ?? "EUR"
      ).toUpperCase();
      if (currency && currency !== "EUR" && currency !== "€") return;
      const priceValue = value && typeof value === "object"
        ? value.value ?? value.amount ?? value.price
        : value;
      const itemPrice = parseListingPrice(priceValue);
      if (!shopName || itemPrice === null) return;
      const shippingValue = extra.shippingCost && typeof extra.shippingCost === "object"
        ? extra.shippingCost.value ?? extra.shippingCost.amount
        : extra.shippingCost;
      const shippingCost = parseListingPrice(shippingValue);
      const url = absolutizeUrl(
        extra.offerUrl ?? extra.offer_url ?? item.offerUrl ?? item.offer_url,
        productUrl
      ) || productUrl;
      offers.push({
        marketplace: "klarna",
        id: `${item.ean ?? item.productId ?? setNumber}-${shopName}`,
        title: normalizedText(extra.offerName ?? extra.name ?? title),
        itemPrice,
        price: itemPrice,
        shippingCost,
        shippingAvailable: shippingCost !== null ? true : null,
        total: roundMoney(itemPrice + (shippingCost ?? 0)),
        currency: "EUR",
        url,
        imageUrl,
        shopName,
        delivery: normalizedText(extra.delivery ?? "") || null,
        raw: { item, merchant: shopName, value }
      });
    };
    if (item.shop && typeof item.shop === "object" && !Array.isArray(item.shop)) {
      Object.entries(item.shop).forEach(([merchant, value]) => addOffer(merchant, value));
    }
    if (Array.isArray(item.offers)) {
      item.offers.forEach(offer => {
        const merchantValue = offer?.retailer ?? offer?.merchant ?? offer?.shop ?? offer?.seller;
        const merchant = merchantValue && typeof merchantValue === "object"
          ? merchantValue.name ?? merchantValue.merchantName ?? merchantValue.displayName ?? merchantValue.title
          : merchantValue;
        addOffer(
          merchant,
          offer?.price ?? offer?.amount ?? offer?.value,
          offer || {}
        );
      });
    }
  }
  return offers.sort((left, right) => left.total - right.total);
}
__name(normalizeKlarnaItems, "normalizeKlarnaItems");
function normalizeStockxItems(rawItems, setNumber) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => {
    if (!item || typeof item !== "object") return null;
    const title = normalizedText(item.title ?? item.name ?? item.model ?? "");
    const description = normalizedText(item.description ?? "");
    if (!/\blego\b/i.test(title) ||
      !isRelevantLegoListing(title, description, setNumber)) return null;
    const nativePrice = parseListingPrice(
      item.lowestAsk ?? item.lowest_ask ?? item.market?.lowestAsk
    );
    if (nativePrice === null) return null;
    const originalCurrency = String(
      item.currency ?? item.currencyCode ?? item.market?.currency ?? ""
    ).trim().toUpperCase();
    const region = String(item.region ?? item.country ?? "DE").trim().toUpperCase();
    // Ein US-Lowest-Ask ist auch nach Währungsumrechnung kein deutscher
    // StockX-Preis. Nur explizit lokalisierte EUR/DE-Daten übernehmen.
    const price = originalCurrency === "EUR" && region === "DE"
      ? nativePrice
      : null;
    if (price === null) return null;
    const rawUrl =
      item.productUrl ?? item.product_url ?? item.url ?? item.link ??
      (item.productSlug || item.slug
        ? `https://stockx.com/${item.productSlug || item.slug}`
        : null);
    const url = absolutizeUrl(rawUrl, "https://stockx.com");
    if (!url) return null;
    return {
      marketplace: "stockx",
      id: item.id ?? item.productId ?? item.product_id ?? item.productSlug ?? null,
      title,
      price,
      total: price,
      currency: "EUR",
      originalPrice: nativePrice,
      originalCurrency,
      region,
      url,
      imageUrl: item.thumbUrl ?? item.thumbnailUrl ?? item.imageUrl ??
        item.images?.[0] ?? null,
      condition: "Neu",
      shippingAvailable: null,
      shippingCost: null,
      sellerName: "StockX",
      highestBid: parseListingPrice(item.highestBid ?? item.highest_bid),
      lastSale: parseListingPrice(item.lastSale ?? item.last_sale),
      raw: item
    };
  }).filter(Boolean);
}
__name(normalizeStockxItems, "normalizeStockxItems");
function normalizeIdealoItems(rawItems) {
  const candidates = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const price = parseListingPrice(value.price ?? value.offerPrice ?? value.offer_price ?? value.amount);
    const rawUrl = value.offerUrl ?? value.offer_url ?? value.deepLink ?? value.deep_link ?? value.url ?? value.link ?? value.productUrl ?? value.product_url;
    if (price !== null) {
      const shipping = parseListingPrice(value.shippingCost ?? value.shipping ?? value.deliveryCost ?? value.delivery_price);
      const declaredTotal = parseListingPrice(value.total ?? value.totalPrice ?? value.total_price);
      const shopName = normalizedText(value.shopName ?? value.shop_name ?? value.sellerId ?? value.seller_id ?? value.shop?.name ?? value.merchant?.name ?? value.retailer?.name ?? value.seller?.name ?? value.store?.name ?? value.vendor?.name ?? value.shop ?? value.merchant ?? value.retailer ?? value.seller ?? value.store ?? value.vendor ?? "");
      const logoUrl = value.logo ?? value.logoUrl ?? value.logo_url ?? value.shopLogo ?? value.shop_logo ?? value.shop?.logo ?? value.shop?.logoUrl ?? value.shop?.logo_url ?? null;
      candidates.push({
        marketplace: "idealo",
        id: value.id ?? value.offerId ?? value.offer_id ?? value.sellerId ?? value.seller_id ?? null,
        title: normalizedText(value.title ?? value.name ?? "Idealo-Angebot"),
        price,
        currency: value.currency ?? "EUR",
        url: rawUrl ? absolutizeUrl(rawUrl, "https://www.idealo.fr") : null,
        imageUrl: logoUrl,
        logoUrl,
        shopName: shopName || null,
        shippingCost: shipping,
        shippingAvailable: shipping !== null ? true : null,
        total: declaredTotal ?? roundMoney(price + (shipping ?? 0)),
        raw: value
      });
    }
    Object.entries(value).forEach(([key, child]) => {
      if (/offers?|shops?|merchants?|results?|items?|prices?/i.test(key)) visit(child);
    });
  };
  visit(rawItems);
  const seen = new Set();
  return candidates.filter((offer) => {
    const key = `${offer.url}|${offer.total}|${offer.shopName || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.total - b.total).slice(0, 3);
}
__name(normalizeIdealoItems, "normalizeIdealoItems");
function extractLeboncoinCondition(attributes) {
  if (attributes && !Array.isArray(attributes) && typeof attributes === "object") {
    const value = attributes.condition ?? attributes.item_condition;
    return value !== null && value !== void 0 ? String(value) : null;
  }
  if (!Array.isArray(attributes)) return null;
  for (const attr of attributes) {
    if (!attr) continue;
    const key = String(attr.key ?? attr.name ?? attr.id ?? "").toLowerCase();
    const value = attr.value ?? attr.label ?? attr.values;
    if (/condition|etat|zustand/i.test(key)) {
      if (Array.isArray(value)) return value.map((v) => String(v ?? "")).filter(Boolean).join(", ") || null;
      return value !== null && value !== void 0 ? String(value) : null;
    }
  }
  return null;
}
__name(extractLeboncoinCondition, "extractLeboncoinCondition");
function absolutizeUrl(value, baseUrl) {
  const raw = normalizedText(value);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}
__name(absolutizeUrl, "absolutizeUrl");
async function handleWebhookChallenge(url, env) {
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    return json({ error: "challenge_code fehlt" }, 400);
  }
  if (!env.EBAY_VERIFICATION_TOKEN || !env.EBAY_WEBHOOK_ENDPOINT) {
    return json({ error: "Webhook-Secrets fehlen" }, 500);
  }
  const input = challengeCode + env.EBAY_VERIFICATION_TOKEN + env.EBAY_WEBHOOK_ENDPOINT;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  const challengeResponse = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return json({ challengeResponse });
}
__name(handleWebhookChallenge, "handleWebhookChallenge");
async function handlePrice(request, url, env, ctx) {
  const isFrance = url.pathname === "/ebay-fr";
  const marketplace = isFrance ? "EBAY_FR" : "EBAY_DE";
  const deliveryCountry = isFrance ? "FR" : "DE";
  const ean = (url.searchParams.get("ean") || "").trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json({ error: "EAN/GTIN muss 8, 12, 13 oder 14 Ziffern haben" }, 400);
  }
  const setNumber = (url.searchParams.get("set") || "").trim();
  if (setNumber && !/^\d{3,7}$/.test(setNumber)) {
    return json({
      error: "LEGO-Setnummer muss aus 3 bis 7 Ziffern bestehen"
    }, 400);
  }
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    return json({ error: "eBay-API-Secrets fehlen" }, 500);
  }
  const cache = caches.default;
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = `/__cache/ebay-price-${marketplace.toLowerCase()}-${EBAY_CACHE_VERSION}`;
  cacheUrl.search = new URLSearchParams({
    ean,
    set: setNumber || ""
  }).toString();
  const cacheKey = new Request(cacheUrl.href, { method: "GET" });
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return addResponseHeaders(cachedResponse, {
      "cache-control": "no-store",
      "x-worker-cache": "HIT"
    });
  }
  const rateLimitResponse = await enforceUpstreamRateLimit(
    request,
    env,
    isFrance ? "ebay-fr" : "ebay"
  );
  if (rateLimitResponse) return rateLimitResponse;
  const accessToken = await getApplicationToken(env);
  const searches = [
    { source: "GTIN", parameter: "gtin", value: ean },
    ...setNumber ? [{ source: "SET_NUMBER", parameter: "q", value: `LEGO ${setNumber}` }] : []
  ];
  const payloads = await Promise.all(
    searches.map((search) => searchEbayOffers(search, accessToken, {
      marketplaceId: marketplace,
      deliveryCountry,
      itemLocationCountry: isFrance ? "FR" : null,
      acceptLanguage: isFrance ? "fr-FR" : "de-DE",
      categoryId: isFrance ? null : "19006"
    }))
  );
  const offersByItemId = /* @__PURE__ */ new Map();
  payloads.forEach(({ source, items }) => {
    items.forEach((item) => {
      const offer = normalizeOffer(item, setNumber, source, {
        requiredCategoryId: isFrance ? null : "19006",
        titleLocale: isFrance ? "fr" : "de"
      });
      if (!offer) return;
      const existing = offersByItemId.get(offer.itemId);
      if (existing) {
        existing.matchSources = [
          .../* @__PURE__ */ new Set([...existing.matchSources, ...offer.matchSources])
        ];
      } else {
        offersByItemId.set(offer.itemId, offer);
      }
    });
  });
  const normalizedOffers = [...offersByItemId.values()].sort((a, b) => a.total - b.total);
  const { offers, excludedCount } = excludeSuspiciousEbayLowPrices(
    normalizedOffers
  );
  if (offers.length === 0) {
    const body2 = {
      ean,
      setNumber: setNumber || null,
      marketplace,
      deliveryCountry,
      found: false,
      message: `Kein vollständiges neues Set mit bekannten Versandkosten nach ${isFrance ? "Frankreich" : "Deutschland"} gefunden`
    };
    const cacheResponse2 = json(body2, 404, {
      "cache-control": `public, max-age=${EBAY_EMPTY_CACHE_TTL_SECONDS}`
    });
    const storeInCache2 = cache.put(cacheKey, cacheResponse2);
    if (ctx?.waitUntil) ctx.waitUntil(storeInCache2);
    else await storeInCache2;
    return json(body2, 404, {
      "cache-control": "no-store",
      "x-worker-cache": "MISS"
    });
  }
  const body = {
    ean,
    setNumber: setNumber || null,
    marketplace,
    deliveryCountry,
    found: true,
    cheapest: offers[0],
    comparedOffers: offers.length,
    excludedSuspiciousOffers: excludedCount,
    offers: offers.slice(0, 10)
  };
  const cacheResponse = json(body, 200, {
    "cache-control": `public, max-age=${EBAY_CACHE_TTL_SECONDS}`
  });
  const storeInCache = cache.put(cacheKey, cacheResponse);
  if (ctx?.waitUntil) ctx.waitUntil(storeInCache);
  else await storeInCache;
  return json(body, 200, {
    "cache-control": "no-store",
    "x-worker-cache": "MISS"
  });
}
__name(handlePrice, "handlePrice");
async function handleEbayMinifigPrice(request, url, env, ctx) {
  const itemNo = (url.searchParams.get("itemNo") || "").trim().toLowerCase();
  if (!/^(?=.*[a-z])(?=.*\d)[a-z0-9-]{2,32}$/.test(itemNo)) {
    return json({ error: "Ungültige BrickLink-Minifiguren-ID" }, 400);
  }
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    return json({ error: "eBay-API-Secrets fehlen" }, 500);
  }
  const cache = caches.default;
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = `/__cache/ebay-minifig-${EBAY_MINIFIG_CACHE_VERSION}`;
  cacheUrl.search = new URLSearchParams({ itemNo }).toString();
  const cacheKey = new Request(cacheUrl.href, { method: "GET" });
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return addResponseHeaders(cachedResponse, {
      "cache-control": "no-store",
      "x-worker-cache": "HIT"
    });
  }
  const rateLimitResponse = await enforceUpstreamRateLimit(request, env, "ebay-minifig");
  if (rateLimitResponse) return rateLimitResponse;
  const accessToken = await getApplicationToken(env);
  const { items } = await searchEbayOffers({
    source: "ITEM_NUMBER",
    parameter: "q",
    value: `LEGO ${itemNo}`
  }, accessToken, {
    marketplaceId: "EBAY_DE",
    deliveryCountry: "DE",
    acceptLanguage: "de-DE",
    categoryId: null
  });
  const normalizedOffers = items.map((item) => normalizeEbayMinifigOffer(item, itemNo)).filter(Boolean);
  const {
    offers,
    excludedCount: excludedSuspiciousOffers
  } = filterEbayMinifigPriceOutliers(normalizedOffers);
  if (offers.length === 0) {
    const body2 = {
      itemNo,
      marketplace: "EBAY_DE",
      deliveryCountry: "DE",
      found: false,
      message: "Keine passende neue Minifigur mit Sofort-Kaufen gefunden"
    };
    const cacheResponse2 = json(body2, 404, {
      "cache-control": `public, max-age=${EBAY_EMPTY_CACHE_TTL_SECONDS}`
    });
    const storeInCache2 = cache.put(cacheKey, cacheResponse2);
    if (ctx?.waitUntil) ctx.waitUntil(storeInCache2);
    else await storeInCache2;
    return json(body2, 404, {
      "cache-control": "no-store",
      "x-worker-cache": "MISS"
    });
  }
  const body = {
    itemNo,
    marketplace: "EBAY_DE",
    deliveryCountry: "DE",
    found: true,
    cheapest: offers[0],
    comparedOffers: offers.length,
    excludedSuspiciousOffers,
    offers: offers.slice(0, 10)
  };
  const cacheResponse = json(body, 200, {
    "cache-control": `public, max-age=${EBAY_CACHE_TTL_SECONDS}`
  });
  const storeInCache = cache.put(cacheKey, cacheResponse);
  if (ctx?.waitUntil) ctx.waitUntil(storeInCache);
  else await storeInCache;
  return json(body, 200, {
    "cache-control": "no-store",
    "x-worker-cache": "MISS"
  });
}
__name(handleEbayMinifigPrice, "handleEbayMinifigPrice");
function normalizeEbayMinifigOffer(item, itemNo) {
  const title = String(item.title || "").trim();
  if (!title || !/\blego\b/i.test(title)) return null;
  // Search summaries for variation groups expose the cheapest variation price,
  // while itemWebUrl can open a different (and more expensive) variation.
  // Without a variation-specific URL that price cannot be represented reliably.
  if (item.itemGroupHref || item.itemGroupType) return null;
  const exactItemNoPattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(itemNo)}(?:[^a-z0-9]|$)`,
    "i"
  );
  if (!exactItemNoPattern.test(title)) return null;
  if (/\b(?:custom|compatible|kompatibel|clone|fake|fälschung|printed|bedruckt|lot|bundle|konvolut|sammlung|collection|set\s+of|kopf|head|torso|beine|legs?|zubehör|accessor(?:y|ies))\b/i.test(title)) return null;
  if (String(item.conditionId || "") !== "1000") return null;
  if (!Array.isArray(item.buyingOptions) || !item.buyingOptions.includes("FIXED_PRICE")) return null;
  const itemPrice = Number(item.price?.value);
  if (!Number.isFinite(itemPrice) || itemPrice < 0) return null;
  const shippingCosts = (item.shippingOptions || []).map((option) => Number(option.shippingCost?.value)).filter(Number.isFinite);
  const shipping = shippingCosts.length > 0 ? Math.min(...shippingCosts) : 0;
  return {
    title,
    itemId: item.itemId,
    itemPrice: roundMoney(itemPrice),
    shipping: roundMoney(shipping),
    total: roundMoney(itemPrice + shipping),
    currency: item.price?.currency || "EUR",
    condition: item.condition,
    seller: item.seller?.username,
    url: item.itemWebUrl,
    image: item.image?.imageUrl,
    matchSources: ["ITEM_NUMBER"]
  };
}
__name(normalizeEbayMinifigOffer, "normalizeEbayMinifigOffer");
function filterEbayMinifigPriceOutliers(offers) {
  const credibleOffers = [...offers].sort((a, b) => a.total - b.total);
  let excludedCount = 0;
  while (credibleOffers.length > 1) {
    const cheapest = Number(credibleOffers[0]?.itemPrice);
    const nextCheapest = Number(credibleOffers[1]?.itemPrice);
    if (!Number.isFinite(cheapest) || !Number.isFinite(nextCheapest) ||
      cheapest >= nextCheapest * 0.5) break;
    credibleOffers.shift();
    excludedCount += 1;
  }
  return { offers: credibleOffers, excludedCount };
}
__name(filterEbayMinifigPriceOutliers, "filterEbayMinifigPriceOutliers");
async function searchEbayOffers(search, accessToken, options = {}) {
  const marketplaceId = options.marketplaceId || "EBAY_DE";
  const deliveryCountry = options.deliveryCountry || "DE";
  const acceptLanguage = options.acceptLanguage || "de-DE";
  const categoryId = options.categoryId === void 0 ? "19006" : options.categoryId;
  const itemLocationCountry = options.itemLocationCountry || null;
  const searchUrl = new URL(
    "https://api.ebay.com/buy/browse/v1/item_summary/search"
  );
  searchUrl.searchParams.set(search.parameter, search.value);
  if (categoryId) searchUrl.searchParams.set("category_ids", categoryId);
  searchUrl.searchParams.set("fieldgroups", "EXTENDED");
  searchUrl.searchParams.set("limit", "200");
  searchUrl.searchParams.set("sort", "price");
  const filters = [
    `deliveryCountry:${deliveryCountry}`,
    "conditionIds:{1000}",
    "buyingOptions:{FIXED_PRICE}"
  ];
  if (itemLocationCountry) {
    filters.push(`itemLocationCountry:${itemLocationCountry}`);
  }
  searchUrl.searchParams.set("filter", filters.join(","));
  const response = await fetch(searchUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-ebay-c-marketplace-id": marketplaceId,
      "accept-language": acceptLanguage
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `eBay Browse API (${search.source}): ${JSON.stringify(data)}`
    );
  }
  return {
    source: search.source,
    items: Array.isArray(data.itemSummaries) ? data.itemSummaries : []
  };
}
__name(searchEbayOffers, "searchEbayOffers");
function normalizeOffer(item, setNumber, matchSource, options = {}) {
  const {
    requiredCategoryId = "19006",
    titleLocale = "de"
  } = options;
  const title = String(item.title || "").trim();
  if (!title || !/\blego\b/i.test(title)) return null;
  if (hasMissingMinifigureSignal([
    title,
    item.shortDescription,
    item.subtitle
  ].filter(Boolean).join(" "))) return null;
  if (setNumber && !isCompleteEbaySetTitle(
    title,
    setNumber,
    titleLocale
  )) return null;
  if (String(item.conditionId || "") !== "1000") return null;
  if (!Array.isArray(item.buyingOptions) || !item.buyingOptions.includes("FIXED_PRICE")) return null;
  const categoryIds = [
    ...Array.isArray(item.leafCategoryIds) ? item.leafCategoryIds : [],
    ...Array.isArray(item.categories) ? item.categories.map((category) => category?.categoryId) : []
  ].map(String);
  if (requiredCategoryId && categoryIds.length > 0 &&
    !categoryIds.includes(requiredCategoryId)) return null;
  const itemPrice = Number(item.price?.value);
  const shippingCosts = (item.shippingOptions || []).map((option) => Number(option.shippingCost?.value)).filter(Number.isFinite);
  if (!Number.isFinite(itemPrice) || shippingCosts.length === 0) return null;
  const shipping = Math.min(...shippingCosts);
  const total = itemPrice + shipping;
  return {
    title,
    itemId: item.itemId,
    itemPrice: roundMoney(itemPrice),
    shipping: roundMoney(shipping),
    total: roundMoney(total),
    currency: item.price.currency,
    condition: item.condition,
    seller: item.seller?.username,
    url: item.itemWebUrl,
    image: item.image?.imageUrl,
    matchSources: [matchSource]
  };
}
__name(normalizeOffer, "normalizeOffer");
function hasMissingMinifigureSignal(text) {
  return /\b(?:ohne|fehlen(?:de|den)?|fehlende?r?|without|no|missing)\s+(?:lego\s+)?(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?|figs?|figures?)\b/i.test(String(text || ""));
}
__name(hasMissingMinifigureSignal, "hasMissingMinifigureSignal");
async function enforceUpstreamRateLimit(request, env, route) {
  if (!env.UPSTREAM_RATE_LIMITER?.limit) return null;
  const clientId = String(request.headers.get("x-bm-client-id") || "").trim();
  const ip = request.headers.get("cf-connecting-ip") || "";
  const key = /^[a-f0-9-]{36}$/i.test(clientId) ? `client:${route}:${clientId.toLowerCase()}` : `ip:${route}:${ip || "unknown"}`;
  const result = await env.UPSTREAM_RATE_LIMITER.limit({ key });
  if (result.success) return null;
  return json({
    error: "Zu viele externe Preisabfragen. Bitte kurz warten.",
    retryAfterSeconds: 60
  }, 429, {
    "retry-after": "60",
    "cache-control": "no-store"
  });
}
__name(enforceUpstreamRateLimit, "enforceUpstreamRateLimit");
function excludeSuspiciousEbayLowPrices(offers) {
  const nextBestFilteredOffers = [...offers].sort((a, b) => a.total - b.total);
  let excludedByNextBest = 0;
  while (nextBestFilteredOffers.length > 1) {
    const cheapestTotal = Number(nextBestFilteredOffers[0]?.total);
    const nextCheapestTotal = Number(nextBestFilteredOffers[1]?.total);
    if (!Number.isFinite(cheapestTotal) || !Number.isFinite(nextCheapestTotal) ||
      cheapestTotal >= nextCheapestTotal * 0.5) break;
    nextBestFilteredOffers.shift();
    excludedByNextBest += 1;
  }
  if (nextBestFilteredOffers.length < 4) {
    return { offers: nextBestFilteredOffers, excludedCount: excludedByNextBest };
  }
  const totals = nextBestFilteredOffers.map((offer) => offer.total).sort((a, b) => a - b);
  const middle = Math.floor(totals.length / 2);
  const median = totals.length % 2 ? totals[middle] : (totals[middle - 1] + totals[middle]) / 2;
  const minimumCredibleTotal = median * 0.3;
  const credibleOffers = nextBestFilteredOffers.filter(
    (offer) => offer.total >= minimumCredibleTotal
  );
  return {
    offers: credibleOffers.length > 0 ? credibleOffers : nextBestFilteredOffers,
    excludedCount: excludedByNextBest + (credibleOffers.length > 0
      ? nextBestFilteredOffers.length - credibleOffers.length
      : 0)
  };
}
__name(excludeSuspiciousEbayLowPrices, "excludeSuspiciousEbayLowPrices");
async function getApplicationToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`eBay OAuth fehlgeschlagen: ${JSON.stringify(data)}`);
  }
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, data.expires_in - 120) * 1e3;
  return cachedToken;
}
__name(getApplicationToken, "getApplicationToken");
function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
__name(roundMoney, "roundMoney");
function addResponseHeaders(response, extraHeaders) {
  const headers = new Headers(response.headers);
  Object.entries(extraHeaders).forEach(([name, value]) => {
    headers.set(name, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(addResponseHeaders, "addResponseHeaders");
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}
__name(json, "json");

// src/index.js
var VERSION = "2.5.6";
var CACHE_SCHEMA = "bm-central-v22";
var OFFER_DISMISSAL_TTL_SECONDS = 180 * 24 * 60 * 60;
var OFFER_DISMISSAL_MAX_ENTRIES = 200;
var EBAY_FR_SHARED_CACHE_VERSION = "v6";
var inflightRequests = /* @__PURE__ */ new Map();
var JSON_HEADERS2 = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "x-worker-cache, x-bm-upstream-url, x-bm-key-source"
});
var TTL = Object.freeze({
  ebay: 2 * 60 * 60,
  ebayMinifig: 2 * 60 * 60,
  kleinanzeigen: 2 * 60 * 60,
  kleinanzeigenEmpty: 20 * 60,
  vinted: 2 * 60 * 60,
  leboncoin: 2 * 60 * 60,
  vintedEmpty: 20 * 60,
  leboncoinEmpty: 20 * 60,
  stockx: 2 * 60 * 60,
  stockxEmpty: 20 * 60,
  googleShopping: 2 * 60 * 60,
  googleShoppingEmpty: 20 * 60,
  klarna: 2 * 60 * 60,
  klarnaEmpty: 20 * 60,
  idealo: 2 * 60 * 60,
  idealoEmpty: 20 * 60,
  brickbank: 2 * 60 * 60,
  bricklinkCatalog: 24 * 60 * 60,
  bricklinkOffers: 2 * 60 * 60,
  bricklinkSetOffer: 2 * 60 * 60,
  bricklinkSetOfferEmpty: 20 * 60,
  bricklinkMinifigPrice: 2 * 60 * 60,
  bricklinkSetMinifigs: 24 * 60 * 60,
  bricklinkPriceGuide: 24 * 60 * 60,
  bricklinkInventory: 24 * 60 * 60,
  rebrickableSetMinifigs: 24 * 60 * 60
});
var APIFY_BASE = "https://api.apify.com/v2";
var APIFY_RUN_TIMEOUT_MS = 55 * 1000;
var APIFY_POLL_INTERVAL_MS = 1500;
var APIFY_JOB_TTL_SECONDS = 15 * 60;
var APIFY_MARKETPLACES = ["vinted", "leboncoin", "kleinanzeigen", "stockx"];
var SCRAPEGRAPH_BASE = "https://v2-api.scrapegraphai.com/api";
var SCRAPEGRAPH_TIMEOUT_MS = 12 * 1000;
var SCRAPEGRAPH_JOB_TTL_SECONDS = 15 * 60;
var SCRAPEGRAPH_PRODUCT_TTL_SECONDS = 7 * 24 * 60 * 60;
var APIFY_CONFIG = Object.freeze({
  vinted: Object.freeze({
    actorId: "scrape.badger~vinted-scraper",
    cacheVersion: "v3",
    listingHost: "www.vinted.de",
    normalize: normalizeVintedItems,
    buildInput(setNumber) {
      return {
        market: "de",
        max_results: 8,
        mode: "Search Items",
        order: "relevance",
        query: `Lego ${setNumber}`,
        status_ids: "6"
      };
    }
  }),
  leboncoin: Object.freeze({
    actorId: "blackfalcondata~leboncoin-scraper",
    cacheVersion: "v8",
    listingHost: "www.leboncoin.fr",
    normalize: normalizeLeboncoinItems,
    buildInput(setNumber) {
      return {
        startUrls: [buildLeboncoinSearchUrl(setNumber)],
        allowLowConfidence: false,
        compact: false,
        descriptionFormat: "all",
        emitExpired: true,
        emitUnchanged: false,
        excludeEmptyFields: false,
        extractContacts: false,
        includeDetails: false,
        includePhone: false,
        incrementalMode: false,
        maxResults: 10,
        mode: "listings",
        notifyOnlyChanges: false,
        skipReposts: true,
      };
    }
  }),
  kleinanzeigen: Object.freeze({
    actorId: "fatihtahta~ebay-kleinanzeigen-scraper",
    cacheVersion: "v5",
    listingHost: "www.kleinanzeigen.de",
    maxTotalChargeUsd: 1,
    normalize: normalizeKleinanzeigenApifyItems,
    buildInput(setNumber) {
      return {
        queries: [`LEGO ${setNumber}`],
        category: "23",
        condition: ["new"],
        offer_type: "for_sale",
        shipping: "shipping_available",
        enrich_data: false,
        maximize_coverage: false,
        limit: 10
      };
    }
  }),
  stockx: Object.freeze({
    actorId: "crawlerbros~stockx-scraper",
    cacheVersion: "v3",
    listingHost: "stockx.com",
    maxTotalChargeUsd: 0.1,
    normalize: normalizeStockxItems,
    buildInput(setNumber) {
      return {
        mode: "search",
        searchQuery: `lego ${setNumber}`,
        country: "DE",
        currency: "EUR",
        fetchProductDetails: false,
        maxItems: 3,
        maxPages: 1,
        useProxy: true,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"]
        }
      };
    }
  })
});
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return corsPreflight();
    const url = new URL(request.url);
    const isDismissalWrite = url.pathname === "/offers/dismissals" &&
      request.method === "POST";
    if (request.method !== "GET" && !isDismissalWrite &&
      !url.pathname.startsWith("/ebay-webhook")) {
      return json2({ error: "Methode nicht erlaubt." }, 405);
    }
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json2({
          ok: true,
          name: "Getdata API",
          version: VERSION,
          cache: env.BM_CACHE ? "edge+kv" : "edge",
          endpoints: [
            "/price",
            "/ebay-fr",
            "/ebay-minifig",
            "/kleinanzeigen",
            "/vinted",
            "/leboncoin",
            "/stockx",
            "/google-shopping",
            "/klarna",
            "/scrapegraph/status?job=...",
            "/idealo",
            "/bricklink",
            "/offers/dismissals",
            "/offers/cache",
            "/offers/refresh",
            "/apify/status?job=...",
            "/proxy/brickbank",
            "/proxy/bricklink/catalog",
            "/proxy/bricklink/offers",
            "/proxy/bricklink/minifig-price",
            "/proxy/bricklink/set-minifigs",
            "/proxy/bricklink/price-guide",
            "/proxy/bricklink/inventory",
            "/proxy/bricklink/legacy-inventory",
            "/proxy/rebrickable/set-minifigs"
          ]
        });
      }
      if (url.pathname === "/price") {
        return handleLegacyCached(request, url, env, ctx, "ebay");
      }
      if (url.pathname === "/ebay-fr") {
        return handleEbayFrance(request, url, env, ctx);
      }
      if (url.pathname === "/ebay-minifig") {
        if (!env.LEGACY_WORKER?.fetch) {
          return json2({
            error: "Der gekapselte eBay-Worker ist nicht gebunden.",
            code: "EBAY_WORKER_MISSING"
          }, 503);
        }
        return addCors(await env.LEGACY_WORKER.fetch(request));
      }
      if (url.pathname === "/kleinanzeigen") {
        return handleKleinanzeigenApiFirst(
          request,
          url,
          env,
          ctx
        );
      }
      if (url.pathname === "/vinted") {
        return startApifyMarketplaceJob(request, url, env, "vinted");
      }
      if (url.pathname === "/leboncoin") {
        return startApifyMarketplaceJob(request, url, env, "leboncoin");
      }
      if (url.pathname === "/stockx") {
        return startApifyMarketplaceJob(request, url, env, "stockx");
      }
      if (url.pathname === "/klarna") {
        return startScrapeGraphKlarnaJob(request, url, env);
      }
      if (url.pathname === "/google-shopping") {
        return handleGoogleShopping(request, url, env, ctx);
      }
      if (url.pathname === "/idealo") {
        return startApifyIdealoJob(request, url, env);
      }
      if (url.pathname === "/bricklink") {
        return handleBricklinkSetOffer(request, url, env, ctx);
      }
      if (url.pathname === "/offers/dismissals") {
        return handleOfferDismissals(request, url, env);
      }
      if (url.pathname === "/offers/cache") {
        return handleOfferBundle(request, url, env, ctx, true);
      }
      if (url.pathname === "/offers/refresh") {
        return handleOfferBundle(request, url, env, ctx, false);
      }
      if (url.pathname === "/apify/status") {
        return handleApifyJobStatus(request, url, env);
      }
      if (url.pathname === "/scrapegraph/status") {
        return handleScrapeGraphKlarnaJobStatus(request, url, env);
      }
      if (url.pathname === "/ebay-webhook") {
        if (env.LEGACY_WORKER?.fetch) {
          return addCors(await env.LEGACY_WORKER.fetch(request));
        }
        return addCors(await ebay_price_worker_default.fetch(request, env, ctx));
      }
      if (url.pathname === "/proxy/brickbank") {
        return handleBrickbank(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/catalog") {
        return handleBricklinkCatalog(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/offers") {
        return handleBricklinkOffers(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/minifig-price") {
        return handleBricklinkMinifigPrice(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/set-minifigs") {
        return handleBricklinkSetMinifigs(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/price-guide") {
        return handleBricklinkPriceGuide(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/inventory") {
        return handleBricklinkInventory(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/bricklink/legacy-inventory") {
        return handleBricklinkLegacyInventory(request, url, env, ctx);
      }
      if (url.pathname === "/proxy/rebrickable/set-minifigs") {
        return handleRebrickableSetMinifigs(request, url, env, ctx);
      }
      return json2({ error: "Endpunkt nicht gefunden." }, 404);
    } catch (error) {
      console.error("Getdata API request failed", {
        path: url.pathname,
        message: String(error?.message || error)
      });
      return json2({
        error: "Die Datenquelle konnte nicht geladen werden.",
        details: String(error?.message || error)
      }, 502);
    }
  }
};
async function handleLegacyCached(request, url, env, ctx, source) {
  return handleEbayCached(request, url, env, ctx, {
    cacheKeyPrefix: "ebay-filter-v5",
    rateLimitRoute: source,
    titleLocale: "de"
  });
}
async function handleEbayFrance(request, url, env, ctx) {
  return handleEbayCached(request, url, env, ctx, {
    cacheKeyPrefix: `ebay-fr-${EBAY_FR_SHARED_CACHE_VERSION}`,
    rateLimitRoute: "ebay-fr",
    titleLocale: "fr"
  });
}
async function handleEbayCached(request, url, env, ctx, options) {
  const {
    cacheKeyPrefix,
    rateLimitRoute,
    titleLocale
  } = options;
  const ean = cleanDigits(url.searchParams.get("ean"), 8, 14);
  const setNumber = cleanSetNumber(url.searchParams.get("set"), true);
  if (!ean || !/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json2({ error: "EAN/GTIN muss 8, 12, 13 oder 14 Ziffern haben" }, 400);
  }
  if (url.searchParams.get("set") && !setNumber) {
    return json2({ error: "Ung\xFCltige LEGO-Setnummer." }, 400);
  }
  return cachedUpstream(request, env, ctx, {
    cacheKey: `${cacheKeyPrefix}:${ean}:${setNumber || "none"}`,
    ttlSeconds: TTL.ebay,
    rateLimitRoute,
    cacheOnly: url.searchParams.get("cache") === "only",
    fetcher: async () => env.LEGACY_WORKER?.fetch
      ? filterEbayPriceResponse(
        await env.LEGACY_WORKER.fetch(new Request(url.href, request)),
        setNumber,
        titleLocale
      )
      : json2({
        error: "Der gekapselte eBay-Worker ist nicht gebunden.",
        code: "EBAY_WORKER_MISSING"
      }, 503)
  });
}
async function filterEbayPriceResponse(response, setNumber, titleLocale = "de") {
  const payload = await response.clone().json().catch(() => null);
  if (!payload || !Array.isArray(payload.offers)) return response;
  const offers = filterRelevantEbayOffers(
    payload.offers,
    setNumber,
    titleLocale
  );
  const additionallyExcluded = payload.offers.length - offers.length;
  if (additionallyExcluded === 0) return response;
  if (offers.length === 0) {
    return json2({
      ...payload,
      found: false,
      cheapest: null,
      comparedOffers: 0,
      excludedIrrelevantOffers: Number(payload.excludedIrrelevantOffers || 0) +
        additionallyExcluded,
      offers: [],
      message: "Kein vollst\xE4ndiges neues LEGO-Set gefunden."
    }, 404);
  }
  return json2({
    ...payload,
    found: true,
    cheapest: offers[0],
    comparedOffers: offers.length,
    excludedIrrelevantOffers: Number(payload.excludedIrrelevantOffers || 0) +
      additionallyExcluded,
    offers: offers.slice(0, 10)
  });
}
function filterRelevantEbayOffers(offers, setNumber, titleLocale) {
  return offers.filter((offer) => {
    const title = String(offer?.title || "").trim();
    return title && (!setNumber || isCompleteEbaySetTitle(
      title,
      setNumber,
      titleLocale
    ));
  }).sort((a, b) => Number(a?.total) - Number(b?.total));
}

const OFFER_BUNDLE_SOURCES = Object.freeze([
  "ebay",
  "ebay-fr",
  "kleinanzeigen",
  "vinted",
  "leboncoin",
  "stockx",
  "klarna",
  "idealo",
  "bricklink"
]);

function parseOfferBundleSources(value) {
  const requested = String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const selected = requested.length > 0 ? requested : OFFER_BUNDLE_SOURCES;
  return OFFER_BUNDLE_SOURCES.filter((source) => selected.includes(source));
}

async function readBundleResponse(response) {
  const payload = await response.clone().json().catch(() => null);
  const savedAt = Number(response.headers.get("x-bm-saved-at"));
  const cacheMetadata = {
    cacheState: response.headers.get("x-worker-cache") || "",
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null
  };
  if (response.status === 202 || payload?.pending || payload?.jobId) {
    return {
      ...cacheMetadata,
      state: "pending",
      jobId: payload?.jobId || null,
      statusUrl: payload?.statusUrl || null,
      pollAfterMs: Number(payload?.pollAfterMs) || 1500
    };
  }
  if (!response.ok || payload?.error) {
    return {
      ...cacheMetadata,
      state: "error",
      status: response.status,
      code: payload?.code || null,
      message: payload?.error || "Preisquelle nicht erreichbar."
    };
  }
  if (payload?.cacheMiss) return { ...cacheMetadata, state: "missing", data: null };
  return { ...cacheMetadata, state: "ready", data: payload };
}

async function handleOfferBundle(request, url, env, ctx, cacheOnly) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  const ean = cleanDigits(url.searchParams.get("ean"), 8, 14);
  const best = normalizeMoney(url.searchParams.get("best"));
  if (!setNumber || !ean || !/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json2({
      error: "Gültige LEGO-Setnummer und EAN sind erforderlich."
    }, 400);
  }
  const selectedSources = parseOfferBundleSources(url.searchParams.get("sources"));
  const makeSourceUrl = (path) => {
    const sourceUrl = new URL(path, url.origin);
    sourceUrl.searchParams.set("set", setNumber);
    sourceUrl.searchParams.set("ean", ean);
    if (best !== null) sourceUrl.searchParams.set("best", best.toFixed(2));
    sourceUrl.searchParams.set("async", "1");
    if (cacheOnly) sourceUrl.searchParams.set("cache", "only");
    if (!cacheOnly && path === "/kleinanzeigen") {
      sourceUrl.searchParams.set("fallback", "apify");
    }
    return sourceUrl;
  };
  const operations = {
    ebay: () => handleLegacyCached(
      request,
      makeSourceUrl("/price"),
      env,
      ctx,
      "ebay"
    ),
    "ebay-fr": () => handleEbayFrance(
      request,
      makeSourceUrl("/ebay-fr"),
      env,
      ctx
    ),
    kleinanzeigen: () => handleKleinanzeigenApiFirst(
      request,
      makeSourceUrl("/kleinanzeigen"),
      env,
      ctx
    ),
    vinted: () => startApifyMarketplaceJob(
      request,
      makeSourceUrl("/vinted"),
      env,
      "vinted"
    ),
    leboncoin: () => startApifyMarketplaceJob(
      request,
      makeSourceUrl("/leboncoin"),
      env,
      "leboncoin"
    ),
    stockx: () => startApifyMarketplaceJob(
      request,
      makeSourceUrl("/stockx"),
      env,
      "stockx"
    ),
    klarna: () => startScrapeGraphKlarnaJob(
      request,
      makeSourceUrl("/klarna"),
      env
    ),
    idealo: () => startApifyIdealoJob(
      request,
      makeSourceUrl("/idealo"),
      env
    ),
    bricklink: () => handleBricklinkSetOffer(
      request,
      makeSourceUrl("/bricklink"),
      env,
      ctx
    )
  };
  const entries = await Promise.all(selectedSources.map(async (source) => {
    try {
      return [source, await readBundleResponse(await operations[source]())];
    } catch (error) {
      return [source, {
        state: "error",
        code: error?.code || "SOURCE_FAILED",
        message: "Preisquelle nicht erreichbar."
      }];
    }
  }));
  const sources = Object.fromEntries(entries);
  return json2({
    setNumber,
    ean,
    cacheOnly,
    complete: selectedSources.every((source) => sources[source]?.state === "ready"),
    sources
  });
}

async function handleKleinanzeigenCached(request, url, env, ctx) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  if (!setNumber) {
    return json2({ error: "LEGO-Setnummer muss aus 3 bis 7 Ziffern bestehen" }, 400);
  }
  const best = normalizeMoney(url.searchParams.get("best"));
  if (!env.KLAZ_API_KEY) {
    return json2({
      error: "Kleinanzeigen-Agent API-Secret fehlt im Worker.",
      code: "KLAZ_WORKER_SECRET_MISSING"
    }, 503);
  }
  const cacheResponse = await cachedUpstream(request, env, ctx, {
    cacheKey: `kleinanzeigen:${setNumber}:${best ?? "none"}`,
    ttlSeconds: TTL.kleinanzeigen,
    rateLimitRoute: "kleinanzeigen",
    cacheOnly: url.searchParams.get("cache") === "only",
    fetcher: async () => {
      const response = await ebay_price_worker_default.fetch(request, env, ctx);
      return normalizeKleinanzeigenError(response);
    }
  });
  return addHeaders(cacheResponse, {
    "x-bm-key-source": "worker-secret-or-cache"
  });
}
async function handleGoogleShopping(request, url, env, ctx) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  const ean = cleanDigits(url.searchParams.get("ean"), 8, 14);
  if (!setNumber || !ean || !/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json2({ error: "Gültige LEGO-Setnummer und EAN sind erforderlich." }, 400);
  }
  if (!env.SERPAPI_API_KEY) {
    return json2({
      error: "SERPAPI_API_KEY fehlt im Worker-Secret.",
      code: "SERPAPI_API_KEY_MISSING"
    }, 503);
  }
  return cachedUpstream(request, env, ctx, {
    cacheKey: `google-shopping:v1:${setNumber}:${ean}`,
    ttlSeconds: TTL.googleShopping,
    rateLimitRoute: "google-shopping",
    cacheOnly: url.searchParams.get("cache") === "only",
    fetcher: async () => {
      const upstreamUrl = new URL("https://serpapi.com/search.json");
      upstreamUrl.searchParams.set("engine", "google_shopping");
      upstreamUrl.searchParams.set("q", `LEGO ${setNumber} ${ean}`);
      upstreamUrl.searchParams.set("google_domain", "google.de");
      upstreamUrl.searchParams.set("gl", "de");
      upstreamUrl.searchParams.set("hl", "de");
      upstreamUrl.searchParams.set("location", "Germany");
      upstreamUrl.searchParams.set("api_key", env.SERPAPI_API_KEY);
      const response = await fetch(upstreamUrl, {
        headers: { accept: "application/json" }
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.error) {
        return json2({
          error: "Google Shopping konnte nicht geladen werden.",
          code: response.status === 429 ? "SERPAPI_LIMIT_REACHED" : "SERPAPI_REQUEST_FAILED",
          upstreamStatus: response.status
        }, response.status === 429 ? 429 : 502);
      }
      // Der Preisvergleichswert beeinflusst nicht den externen Suchlauf. So
      // bleibt derselbe Google-Cache auch bei wechselnden Brickmerge-Preisen
      // wiederverwendbar.
      const offers = normalizeGoogleShoppingResults(payload, setNumber);
      const searchUrl = String(payload?.search_metadata?.google_url ||
        `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`LEGO ${setNumber}`)}`);
      return json2({
        setNumber,
        ean,
        marketplace: "google-shopping",
        found: offers.length > 0,
        cheapest: offers[0] || null,
        comparedOffers: offers.length,
        offers: offers.slice(0, 10),
        searchUrl
      }, 200, {
        "cache-control": `public, max-age=${offers.length > 0
          ? TTL.googleShopping
          : TTL.googleShoppingEmpty}`
      });
    }
  });
}
__name(handleGoogleShopping, "handleGoogleShopping");
async function normalizeKleinanzeigenError(response) {
  if (response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  const errorText = JSON.stringify(payload || {});
  const creditsExhausted = response.status === 402 || response.status === 429 && /credit|quota|guthaben|kontingent/i.test(errorText) || /credits?.*(?:0|empty|exhausted)|insufficient.*credits?/i.test(errorText);
  if (!creditsExhausted) return response;
  return json2({
    error: "Die Credits des Kleinanzeigen-Agent API-Secrets sind aufgebraucht.",
    code: "CREDITS_EXHAUSTED",
    upstreamStatus: response.status
  }, response.status === 429 ? 429 : 402);
}
async function handleKleinanzeigenApiFirst(request, url, env, ctx) {
  const apiResponse = await handleKleinanzeigenCached(request, url, env, ctx);
  const apiBody = await apiResponse.clone().json().catch(() => null);
  if (apiResponse.ok && apiBody?.found) return apiResponse;
  // Ein bereits bezahlter Apify-Lauf muss auch nach einem Seitenreload
  // verfügbar bleiben. Diese Abfrage liest ausschließlich den Rohdaten-Cache
  // und darf niemals selbst einen Actor starten.
  if (env.BM_CACHE) {
    const apifyCacheUrl = new URL(url);
    apifyCacheUrl.searchParams.set("cache", "only");
    const apifyCacheResponse = await startApifyMarketplaceJob(
      request,
      apifyCacheUrl,
      env,
      "kleinanzeigen"
    );
    const apifyCacheBody = await apifyCacheResponse.clone().json().catch(() => null);
    if (apifyCacheResponse.ok && apifyCacheBody?.found) {
      return apifyCacheResponse;
    }
  }
  if (url.searchParams.get("cache") === "only") return apiResponse;
  if (url.searchParams.get("fallback") !== "apify") return apiResponse;
  if (!env.APIFY_TOKEN) return apiResponse;
  return startApifyMarketplaceJob(request, url, env, "kleinanzeigen");
}
__name(handleKleinanzeigenApiFirst, "handleKleinanzeigenApiFirst");
async function handleBrickbank(request, url, env, ctx) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  if (!setNumber) return json2({ error: "Ung\xFCltige LEGO-Setnummer." }, 400);
  const upstreamUrl = `https://brickbank.app/public/ajax/search/?db=pvg&s=${encodeURIComponent(`${setNumber}-1`)}`;
  return proxyFixed(request, env, ctx, {
    cacheKey: `brickbank:pvg:${setNumber}-1`,
    ttlSeconds: TTL.brickbank,
    rateLimitRoute: "brickbank",
    upstreamUrl,
    headers: jsonRequestHeaders()
  });
}
async function handleOfferDismissals(request, url, env) {
  if (!env.BM_CACHE?.get || !env.BM_CACHE?.put) {
    return json2({ error: "BM_CACHE fehlt im Worker." }, 503);
  }
  const clientId = String(request.headers.get("x-bm-client-id") || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(clientId)) {
    return json2({ error: "Ungültige Client-ID." }, 400);
  }

  let payload = null;
  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 8 * 1024) {
      return json2({ error: "Anfrage zu groß." }, 413);
    }
    payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json2({ error: "Ungültige JSON-Anfrage." }, 400);
    }
  }

  const setNumber = cleanSetNumber(
    request.method === "POST" ? payload?.setNumber : url.searchParams.get("set")
  );
  if (!setNumber) {
    return json2({ error: "Ungültige LEGO-Setnummer." }, 400);
  }

  const key = `offer-dismissals:v1:${clientId}:${setNumber}`;
  const now = Date.now();
  const cutoff = now - OFFER_DISMISSAL_TTL_SECONDS * 1e3;
  const stored = await env.BM_CACHE.get(key, "json").catch(() => null);
  let entries = Array.isArray(stored?.entries)
    ? stored.entries.filter((entry) =>
      typeof entry?.identity === "string" &&
      entry.identity.length > 0 && entry.identity.length <= 1200 &&
      Number.isFinite(Number(entry.dismissedAt)) &&
      Number(entry.dismissedAt) >= cutoff
    )
    : [];

  if (request.method === "POST") {
    const rateLimitResponse = await enforceRateLimit(
      request,
      env,
      "offer-dismissals"
    );
    if (rateLimitResponse) return rateLimitResponse;

    if (payload.clear === true) {
      entries = [];
    } else {
      const identity = String(payload.identity || "").trim();
      if (!identity || identity.length > 1200) {
        return json2({ error: "Ungültige Angebots-ID." }, 400);
      }
      entries = entries.filter((entry) => entry.identity !== identity);
      if (payload.dismissed !== false) {
        entries.push({ identity, dismissedAt: now });
      }
    }

    entries.sort((left, right) =>
      Number(right.dismissedAt) - Number(left.dismissedAt)
    );
    entries = entries.slice(0, OFFER_DISMISSAL_MAX_ENTRIES);
    if (entries.length === 0 && env.BM_CACHE.delete) {
      await env.BM_CACHE.delete(key);
    } else {
      await env.BM_CACHE.put(key, JSON.stringify({
        version: 1,
        setNumber,
        updatedAt: now,
        entries
      }), { expirationTtl: OFFER_DISMISSAL_TTL_SECONDS });
    }
  }

  return json2({
    setNumber,
    dismissed: entries,
    count: entries.length
  }, 200, { "cache-control": "no-store" });
}
async function handleBricklinkCatalog(request, url, env, ctx) {
  const type = url.searchParams.get("type") === "M" ? "M" : "S";
  const item = cleanCatalogItem(url.searchParams.get("item"));
  if (!item) return json2({ error: "Ung\xFCltige BrickLink-Artikelnummer." }, 400);
  const upstreamUrl = new URL("https://www.bricklink.com/v2/catalog/catalogitem.page");
  upstreamUrl.searchParams.set(type, item);
  return proxyFixed(request, env, ctx, {
    cacheKey: `bricklink:catalog:${type}:${item}`,
    ttlSeconds: TTL.bricklinkCatalog,
    rateLimitRoute: "bricklink",
    upstreamUrl: upstreamUrl.href,
    headers: htmlHeaders()
  });
}
async function handleBricklinkOffers(request, url, env, ctx) {
  const itemId = cleanDigits(url.searchParams.get("itemid"), 1, 12);
  const region = url.searchParams.get("region") === "EU" ? "EU" : "DE";
  if (!itemId) return json2({ error: "Ung\xFCltige BrickLink-Item-ID." }, 400);
  const upstreamUrl = new URL("https://www.bricklink.com/ajax/clone/catalogifs.ajax");
  upstreamUrl.search = bricklinkMinifigOfferParams(itemId, region).toString();
  return proxyFixed(request, env, ctx, {
    cacheKey: `bricklink:offers:${region.toLowerCase()}:new:${itemId}`,
    ttlSeconds: TTL.bricklinkOffers,
    rateLimitRoute: "bricklink",
    upstreamUrl: upstreamUrl.href,
    headers: jsonRequestHeaders("https://www.bricklink.com/")
  });
}
async function handleBricklinkSetOffer(request, url, env, ctx) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  if (!setNumber) {
    return json2({ error: "Ungültige LEGO-Setnummer." }, 400);
  }
  return cachedUpstream(request, env, ctx, {
    cacheKey: `bricklink:set-offer:v2:${setNumber}`,
    ttlSeconds: TTL.bricklinkSetOffer,
    rateLimitRoute: "bricklink",
    cacheOnly: url.searchParams.get("cache") === "only",
    fetcher: async () => {
      const catalogUrl = new URL(
        "https://www.bricklink.com/v2/catalog/catalogitem.page"
      );
      catalogUrl.searchParams.set("S", `${setNumber}-1`);
      const catalogResponse = await fetch(catalogUrl, {
        headers: htmlHeaders(),
        redirect: "follow"
      });
      if (!catalogResponse.ok) {
        return json2({ error: "BrickLink-Katalog nicht erreichbar." }, 502);
      }
      const itemId = parseBricklinkCatalogItemId(await catalogResponse.text());
      if (!itemId) {
        return json2({
          setNumber,
          marketplace: "bricklink",
          found: false,
          cheapest: null,
          comparedOffers: 0
        }, 200, {
          "cache-control": `public, max-age=${TTL.bricklinkSetOfferEmpty}`
        });
      }
      const offersUrl = new URL(
        "https://www.bricklink.com/ajax/clone/catalogifs.ajax"
      );
      offersUrl.search = bricklinkMinifigOfferParams(itemId, "DE").toString();
      const offersResponse = await fetch(offersUrl, {
        headers: jsonRequestHeaders(catalogUrl.href),
        redirect: "follow"
      });
      if (!offersResponse.ok) {
        return json2({ error: "BrickLink-Angebote nicht erreichbar." }, 502);
      }
      const normalized = normalizeBricklinkSetOffers(
        await offersResponse.json().catch(() => null),
        setNumber
      );
      const found = normalized.length > 0;
      const updatedAt = new Date();
      const ttlSeconds = found
        ? TTL.bricklinkSetOffer
        : TTL.bricklinkSetOfferEmpty;
      return json2({
        setNumber,
        marketplace: "bricklink",
        found,
        cheapest: found ? normalized[0] : null,
        comparedOffers: normalized.length,
        offers: normalized.slice(0, 10),
        updatedAt: updatedAt.toISOString(),
        expiresAt: new Date(updatedAt.getTime() + ttlSeconds * 1e3).toISOString()
      }, 200, {
        "cache-control": `public, max-age=${ttlSeconds}`
      });
    }
  });
}
function bricklinkMinifigOfferParams(itemId, region) {
  const params = new URLSearchParams({
    itemid: itemId,
    ss: "DE",
    cond: "N",
    ii: "0",
    iconly: "0",
    rpp: "100",
    pi: "1",
    st: "1"
  });
  if (region === "EU") params.set("reg", "-1");
  else params.set("loc", "DE");
  return params;
}
async function handleBricklinkMinifigPrice(request, url, env, ctx) {
  const itemNo = cleanCatalogItem(url.searchParams.get("itemNo"));
  const region = url.searchParams.get("region") === "EU" ? "EU" : "DE";
  if (!itemNo) {
    return json2({ error: "Ung\xFCltige BrickLink-Minifiguren-ID." }, 400);
  }
  return cachedUpstream(request, env, ctx, {
    cacheKey: `bricklink:minifig-current-price-v4:${region.toLowerCase()}:${itemNo.toLowerCase()}`,
    ttlSeconds: TTL.bricklinkMinifigPrice,
    rateLimitRoute: "bricklink",
    fetcher: async () => {
      const catalogUrl = new URL(
        "https://www.bricklink.com/v2/catalog/catalogitem.page"
      );
      catalogUrl.searchParams.set("M", itemNo);
      const catalogResponse = await fetch(catalogUrl.href, {
        method: "GET",
        headers: htmlHeaders("https://www.bricklink.com/"),
        redirect: "follow"
      });
      if (!catalogResponse.ok) {
        return json2({ error: "BrickLink-Katalog nicht erreichbar." }, 502);
      }
      const catalogHtml = await catalogResponse.text();
      const itemId = cleanDigits(
        catalogHtml.match(/\bidItem\s*:\s*(\d+)/)?.[1],
        1,
        12
      );
      if (!itemId) {
        return json2({ error: "BrickLink-Minifigur nicht gefunden." }, 404);
      }

      const offersUrl = new URL(
        "https://www.bricklink.com/ajax/clone/catalogifs.ajax"
      );
      const offerParams = bricklinkMinifigOfferParams(itemId, region);
      offersUrl.search = offerParams.toString();
      const offersResponse = await fetch(offersUrl.href, {
        method: "GET",
        headers: jsonRequestHeaders("https://www.bricklink.com/"),
        redirect: "follow"
      });
      if (!offersResponse.ok) {
        return json2({ error: "BrickLink-Angebote nicht erreichbar." }, 502);
      }
      const payload = await offersResponse.json().catch(() => null);
      if (!payload || !Array.isArray(payload.list)) {
        return json2({ error: "Ung\xFCltige BrickLink-Antwort." }, 502);
      }
      const prices = payload.list.filter((offer) => {
        return (region === "EU" || offer?.strSellerCountryCode === "DE") &&
          offer?.codeNew === "N" && offer?.codeComplete !== "I";
      }).map(parseBricklinkOfferPrice).filter((price) => price !== null).sort((a, b) => a - b);
      return json2({
        itemNo,
        itemId,
        price: prices[0] ?? null,
        currency: "EUR",
        region,
        condition: "N"
      });
    }
  });
}
function decodeBricklinkHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function extractBricklinkMinifigItems(html) {
  const items = [];
  const seen = new Set();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(String(html || "")))) {
    const row = rowMatch[1];
    const itemMatch = row.match(
      /(?:catalogitem\.page|catalogItemInv\.asp)\?M=([^"'&#\s<>]+)/i
    );
    if (!itemMatch) continue;
    let itemNo = itemMatch[1];
    try {
      itemNo = decodeURIComponent(itemNo);
    } catch (error) {
      // BrickLink item numbers are normally plain ASCII.
    }
    itemNo = cleanCatalogItem(itemNo);
    if (!itemNo || seen.has(itemNo.toLowerCase())) continue;
    seen.add(itemNo.toLowerCase());
    const imageName = row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1];
    const boldName = row.match(/<b\b[^>]*>([\s\S]*?)<\/b>/i)?.[1];
    const quantity = Number(row.match(/<td\b[^>]*>\s*(\d+)\s*<\/td>/i)?.[1] || 1);
    const imagePath = row.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || "";
    items.push({
      itemNo,
      name: decodeBricklinkHtmlText(imageName || boldName || itemNo),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      imageUrl: imagePath.startsWith("//") ? `https:${imagePath}` : imagePath
    });
  }
  return items;
}
function extractBricklinkMinifigItemNos(html) {
  const itemNos = extractBricklinkMinifigItems(html).map((item) => item.itemNo);
  const seen = new Set(itemNos.map((itemNo) => itemNo.toLowerCase()));
  const pattern = /(?:catalogitem\.page|catalogItemInv\.asp)\?M=([^"'&#\s<>]+)/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    let itemNo = match[1];
    try {
      itemNo = decodeURIComponent(itemNo);
    } catch {
      // BrickLink item numbers are normally plain ASCII.
    }
    itemNo = cleanCatalogItem(itemNo);
    if (!itemNo || seen.has(itemNo.toLowerCase())) continue;
    seen.add(itemNo.toLowerCase());
    itemNos.push(itemNo);
  }
  return itemNos;
}
async function handleBricklinkSetMinifigs(request, url, env, ctx) {
  const set = cleanCatalogItem(url.searchParams.get("set"));
  if (!set || !/^\d{3,7}-\d+$/.test(set)) {
    return json2({ error: "Ung\xFCltige BrickLink-Setnummer." }, 400);
  }
  return cachedUpstream(request, env, ctx, {
    cacheKey: `bricklink:set-minifigs:v2:${set}`,
    ttlSeconds: TTL.bricklinkSetMinifigs,
    rateLimitRoute: "bricklink",
    fetcher: async () => {
      const catalogUrl = new URL("https://www.bricklink.com/v2/catalog/catalogitem.page");
      catalogUrl.searchParams.set("S", set);
      const catalogResponse = await fetch(catalogUrl.href, {
        headers: htmlHeaders("https://www.bricklink.com/"),
        redirect: "follow"
      });
      if (!catalogResponse.ok) return json2({ error: "BrickLink-Katalog nicht erreichbar." }, 502);
      const catalogHtml = await catalogResponse.text();
      const itemId = cleanDigits(catalogHtml.match(/\bidItem\s*:\s*(\d+)/)?.[1], 1, 12);
      if (!itemId) return json2({ error: "BrickLink-Set nicht gefunden." }, 404);

      const inventoryUrl = new URL("https://www.bricklink.com/v2/catalog/catalogitem_invtab.page");
      inventoryUrl.search = new URLSearchParams({
        idItem: itemId,
        st: "1",
        show_invid: "0",
        show_matchcolor: "0",
        show_pglink: "0",
        show_pcc: "0",
        show_missingpcc: "0",
        itemNoSeq: set
      }).toString();
      const inventoryResponse = await fetch(inventoryUrl.href, {
        headers: htmlHeaders("https://www.bricklink.com/"),
        redirect: "follow"
      });
      if (!inventoryResponse.ok) return json2({ error: "BrickLink-Inventar nicht erreichbar." }, 502);
      const items = extractBricklinkMinifigItems(await inventoryResponse.text());
      const itemNos = items.map((item) => item.itemNo);
      return json2({ set, itemId, items, itemNos, count: items.length });
    }
  });
}
async function handleBricklinkPriceGuide(request, url, env, ctx) {
  const itemType = /^[A-Z]$/.test(url.searchParams.get("itemType") || "") ? url.searchParams.get("itemType") : "M";
  const itemNo = cleanCatalogItem(url.searchParams.get("itemNo"));
  if (!itemNo) return json2({ error: "Ung\xFCltige BrickLink-Artikelnummer." }, 400);
  const upstreamUrl = new URL("https://www.bricklink.com/ajax/clone/catalogpg.ajax");
  upstreamUrl.search = new URLSearchParams({
    itemType,
    itemNo,
    chartType: "price",
    gross: "1"
  }).toString();
  return proxyFixed(request, env, ctx, {
    cacheKey: `bricklink:price-guide:${itemType}:${itemNo}`,
    ttlSeconds: TTL.bricklinkPriceGuide,
    rateLimitRoute: "bricklink",
    upstreamUrl: upstreamUrl.href,
    headers: jsonRequestHeaders("https://www.bricklink.com/")
  });
}
async function handleBricklinkInventory(request, url, env, ctx) {
  const itemId = cleanDigits(url.searchParams.get("itemid"), 1, 12);
  const itemNo = cleanCatalogItem(url.searchParams.get("item"));
  if (!itemId || !itemNo) return json2({ error: "Ung\xFCltige BrickLink-Inventardaten." }, 400);
  const upstreamUrl = new URL("https://www.bricklink.com/v2/catalog/catalogitem_invtab.page");
  upstreamUrl.search = new URLSearchParams({
    idItem: itemId,
    st: "1",
    show_invid: "0",
    show_matchcolor: "0",
    show_pglink: "0",
    show_pcc: "0",
    show_missingpcc: "0",
    itemNoSeq: itemNo
  }).toString();
  return proxyFixed(request, env, ctx, {
    cacheKey: `bricklink:inventory:${itemId}:${itemNo}`,
    ttlSeconds: TTL.bricklinkInventory,
    rateLimitRoute: "bricklink",
    upstreamUrl: upstreamUrl.href,
    headers: htmlHeaders("https://www.bricklink.com/")
  });
}
async function handleBricklinkLegacyInventory(request, url, env, ctx) {
  const set = cleanCatalogItem(url.searchParams.get("set"));
  if (!set) return json2({ error: "Ung\xFCltige BrickLink-Setnummer." }, 400);
  const upstreamUrl = new URL("https://www.bricklink.com/catalogItemInv.asp");
  upstreamUrl.search = new URLSearchParams({ S: set, viewItemType: "M" }).toString();
  return proxyFixed(request, env, ctx, {
    cacheKey: `bricklink:legacy-inventory:${set}`,
    ttlSeconds: TTL.bricklinkInventory,
    rateLimitRoute: "bricklink",
    upstreamUrl: upstreamUrl.href,
    headers: htmlHeaders("https://www.bricklink.com/")
  });
}
async function handleRebrickableSetMinifigs(request, url, env, ctx) {
  const set = cleanCatalogItem(url.searchParams.get("set"));
  if (!set || !/^\d{3,7}-\d+$/.test(set)) {
    return json2({ error: "Ung\xFCltige Rebrickable-Setnummer." }, 400);
  }
  const keyResult = getRebrickableKey(request, env);
  if (keyResult.error) return keyResult.error;
  const upstreamUrl = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(set)}/minifigs/?page_size=100`;
  return cachedUpstream(request, env, ctx, {
    cacheKey: `rebrickable:set-minifigs:${set}`,
    ttlSeconds: TTL.rebrickableSetMinifigs,
    rateLimitRoute: "rebrickable",
    fetcher: async () => {
      return fetch(upstreamUrl, {
        headers: {
          ...jsonRequestHeaders(),
          Authorization: `key ${keyResult.key}`
        }
      });
    }
  });
}
function getRebrickableKey(request, env) {
  const workerKey = normalizeSecret(env.REBRICKABLE_API_KEY, /^[A-Za-z0-9]{16,80}$/);
  const supplied = request.headers.get("x-bm-rebrickable-key");
  const personalKey = normalizeSecret(supplied, /^[A-Za-z0-9]{16,80}$/);
  if (supplied && !personalKey) {
    return {
      error: json2({ error: "Der pers\xF6nliche Rebrickable-API-Key ist ung\xFCltig formatiert." }, 400)
    };
  }
  if (workerKey) return { key: workerKey, source: "worker" };
  if (!personalKey) {
    return {
      error: json2({
        error: "Das Rebrickable-Secret fehlt im Worker.",
        code: "REBRICKABLE_SECRET_MISSING"
      }, 401)
    };
  }
  return { key: personalKey, source: "personal" };
}
async function proxyFixed(request, env, ctx, options) {
  return cachedUpstream(request, env, ctx, {
    cacheKey: options.cacheKey,
    ttlSeconds: options.ttlSeconds,
    rateLimitRoute: options.rateLimitRoute,
    fetcher: () => fetch(options.upstreamUrl, {
      method: "GET",
      headers: options.headers,
      redirect: "follow"
    })
  });
}
async function cachedUpstream(request, env, ctx, options) {
  const fullCacheKey = `${CACHE_SCHEMA}:${options.cacheKey}`;
  const cached = await readSharedCache(request, env, fullCacheKey);
  if (cached) return recordResponse(cached.record, cached.layer);
  if (options.cacheOnly) {
    return json2({ found: false, cacheMiss: true }, 200, {
      "x-worker-cache": "MISS-ONLY"
    });
  }
  if (inflightRequests.has(fullCacheKey)) {
    const record = await inflightRequests.get(fullCacheKey);
    return recordResponse(record, "COALESCED");
  }
  const task = (async () => {
    const rateLimitResponse = await enforceRateLimit(
      request,
      env,
      options.rateLimitRoute
    );
    if (rateLimitResponse) return responseRecord(rateLimitResponse, 0);
    const response = await options.fetcher();
    const cacheControlMaxAge = Number(
      response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1]
    );
    const ttlSeconds = Number.isFinite(cacheControlMaxAge)
      ? cacheControlMaxAge
      : options.ttlSeconds;
    const record = await responseRecord(response, ttlSeconds);
    if (record.ttlSeconds > 0 && record.status >= 200 && record.status < 300) {
      const write = writeSharedCache(request, env, fullCacheKey, record);
      if (ctx?.waitUntil) ctx.waitUntil(write);
      else await write;
    }
    return record;
  })();
  inflightRequests.set(fullCacheKey, task);
  try {
    const record = await task;
    return recordResponse(record, "MISS");
  } finally {
    inflightRequests.delete(fullCacheKey);
  }
}
async function responseRecord(response, ttlSeconds) {
  const body = await response.text();
  return {
    status: response.status,
    statusText: response.statusText,
    body,
    contentType: response.headers.get("content-type") || "text/plain; charset=utf-8",
    upstreamUrl: response.headers.get("x-bm-upstream-url") || response.url || "",
    savedAt: Date.now(),
    ttlSeconds: Number(ttlSeconds) || 0
  };
}
async function readSharedCache(request, env, key) {
  const edgeKey = makeEdgeCacheKey(request, key);
  const edgeResponse = await caches.default.match(edgeKey);
  if (edgeResponse) {
    const record = await edgeResponse.json().catch(() => null);
    if (isFreshRecord(record)) return { record, layer: "HIT-EDGE" };
  }
  if (env.BM_CACHE?.get) {
    const record = await env.BM_CACHE.get(key, { type: "json", cacheTtl: 60 }).catch(() => null);
    if (isFreshRecord(record)) {
      const edgeWrite = putEdgeCache(edgeKey, record);
      if (typeof edgeWrite?.catch === "function") edgeWrite.catch(() => {
      });
      return { record, layer: "HIT-KV" };
    }
  }
  return null;
}
async function writeSharedCache(request, env, key, record) {
  const edgeKey = makeEdgeCacheKey(request, key);
  const writes = [putEdgeCache(edgeKey, record)];
  if (env.BM_CACHE?.put) {
    writes.push(env.BM_CACHE.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(60, record.ttlSeconds)
    }));
  }
  await Promise.allSettled(writes);
}
function putEdgeCache(edgeKey, record) {
  return caches.default.put(edgeKey, new Response(JSON.stringify(record), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${Math.max(60, record.ttlSeconds)}`
    }
  }));
}
function makeEdgeCacheKey(request, key) {
  const url = new URL(request.url);
  url.pathname = `/__bm_cache/${stableHash(key)}`;
  url.search = "";
  return new Request(url.href, { method: "GET" });
}
function isFreshRecord(record) {
  return Boolean(record && typeof record.body === "string" && Number(record.savedAt) + Number(record.ttlSeconds) * 1e3 > Date.now());
}
function recordResponse(record, cacheState) {
  const headers = {
    "content-type": record.contentType,
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-worker-cache, x-bm-upstream-url, x-bm-key-source, x-bm-saved-at",
    "cache-control": "no-store",
    "x-worker-cache": cacheState,
    "x-bm-saved-at": String(record.savedAt)
  };
  if (record.upstreamUrl) headers["x-bm-upstream-url"] = record.upstreamUrl;
  return new Response(record.body, {
    status: record.status,
    statusText: record.statusText,
    headers
  });
}
async function enforceRateLimit(request, env, route) {
  const clientId = String(request.headers.get("x-bm-client-id") || "").trim();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const checks = [];
  if (env.UPSTREAM_RATE_LIMITER?.limit) {
    const actor = /^[a-f0-9-]{36}$/i.test(clientId) ? `client:${clientId.toLowerCase()}` : `ip-fallback:${ip}`;
    checks.push(env.UPSTREAM_RATE_LIMITER.limit({ key: `${route}:${actor}` }));
  }
  if (env.UPSTREAM_IP_RATE_LIMITER?.limit) {
    checks.push(env.UPSTREAM_IP_RATE_LIMITER.limit({ key: `${route}:ip:${ip}` }));
  }
  if (checks.length === 0) return null;
  const results = await Promise.all(checks);
  if (results.every((result) => result.success)) return null;
  return json2({
    error: "Zu viele externe Abfragen. Bitte kurz warten.",
    retryAfterSeconds: 60
  }, 429, { "retry-after": "60" });
}
function htmlHeaders(referer = "") {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
  };
  if (referer) headers.Referer = referer;
  return headers;
}
function jsonRequestHeaders(referer = "") {
  const headers = {
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
  };
  if (referer) headers.Referer = referer;
  return headers;
}
function cleanSetNumber(value, optional = false) {
  const normalized = String(value || "").trim();
  if (!normalized && optional) return "";
  return /^\d{3,7}$/.test(normalized) ? normalized : "";
}
function cleanDigits(value, min, max) {
  const normalized = String(value || "").trim();
  const pattern = new RegExp(`^\\d{${min},${max}}$`);
  return pattern.test(normalized) ? normalized : "";
}
function cleanCatalogItem(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : "";
}
function normalizeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1e4 ? Math.round(number * 100) / 100 : null;
}
function parseBricklinkMoneyDetails(value) {
  const text = normalizedText(value);
  const match = text.match(
    /(?:EUR|\u20AC)\s*([\d.,]+)|([\d.,]+)\s*(?:EUR|\u20AC)/i
  );
  if (!match) return null;
  const raw = match[1] || match[2];
  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");
  let normalized = raw;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = raw.replace(",", ".");
  }
  const decimalIndex = Math.max(commaIndex, dotIndex);
  const decimalPlaces = decimalIndex >= 0
    ? raw.length - decimalIndex - 1
    : 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= 1e4
    ? { amount, decimalPlaces }
    : null;
}
function parseBricklinkMoney(value) {
  const details = parseBricklinkMoneyDetails(value);
  return details ? normalizeMoney(details.amount) : null;
}
function parseBricklinkOfferPrice(offer) {
  const details = parseBricklinkMoneyDetails(offer?.mInvSalePrice || "") ??
    parseBricklinkMoneyDetails(offer?.mDisplaySalePrice || "");
  if (!details) return null;

  // BrickLink liefert bei einem nicht-deutschen Worker-Standort die Preise
  // umsatzsteuerpflichtiger EU-Händler als Nettowert mit mehr als zwei
  // Nachkommastellen. Die deutsche BrickLink-Oberfläche zeigt für denselben
  // Bestand dagegen den Endkundenpreis inklusive 19 % deutscher MwSt.
  const consumerPrice = details.decimalPlaces > 2
    ? details.amount * 1.19
    : details.amount;
  return normalizeMoney(consumerPrice);
}
function parseBricklinkCatalogItemId(html) {
  const value = String(html || "").match(/\bidItem\s*[:=]\s*(\d+)/)?.[1] || "";
  return cleanDigits(value, 1, 12);
}
function normalizeBricklinkSetOffers(payload, setNumber) {
  const cleanSet = cleanSetNumber(setNumber);
  if (!cleanSet || !Array.isArray(payload?.list)) return [];
  const url = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${cleanSet}-1#T=S&O={%22ss%22:%22DE%22,%22cond%22:%22N%22,%22ii%22:0,%22loc%22:%22DE%22,%22iconly%22:0}`;
  return payload.list.filter((offer) =>
    offer?.strSellerCountryCode === "DE" &&
    offer?.codeNew === "N" &&
    offer?.codeComplete !== "I"
  ).map((offer) => {
    const price = parseBricklinkOfferPrice(offer);
    if (price === null) return null;
    return {
      id: String(offer?.idInv || offer?.id || "").trim(),
      title: `LEGO ${cleanSet}-1 neu und vollständig`,
      seller: normalizedText(offer?.strStorename || ""),
      price,
      total: price,
      shippingCost: null,
      url,
      marketplace: "bricklink",
      condition: "new"
    };
  }).filter(Boolean).sort((left, right) => left.total - right.total);
}
function normalizeSecret(value, pattern) {
  const normalized = String(value || "").trim();
  return pattern.test(normalized) ? normalized : "";
}
function normalizedText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
function stableHash(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS2,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": [
        "content-type",
        "x-bm-client-id",
        "x-bm-rebrickable-key"
      ].join(", "),
      "access-control-max-age": "86400"
    }
  });
}
function addCors(response) {
  return addHeaders(response, {
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-worker-cache, x-bm-upstream-url, x-bm-key-source"
  });
}
function addHeaders(response, values) {
  const headers = new Headers(response.headers);
  Object.entries(values).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
function json2(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS2, "cache-control": "no-store", ...extraHeaders }
  });
}
async function normalizeMarketplaceItems(marketplace, rawItems, setNumber, env) {
  const config = APIFY_CONFIG[marketplace];
  return config.normalize(rawItems, setNumber);
}
__name(normalizeMarketplaceItems, "normalizeMarketplaceItems");
function extractScrapeGraphJson(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.json && typeof payload.json === "object") return payload.json;
  if (payload.data?.json && typeof payload.data.json === "object") return payload.data.json;
  if (payload.data?.json_data && typeof payload.data.json_data === "object") return payload.data.json_data;
  if (payload.response?.json && typeof payload.response.json === "object") return payload.response.json;
  return null;
}
__name(extractScrapeGraphJson, "extractScrapeGraphJson");
async function scrapeGraphExtract(env, body) {
  if (!env.SGAI_API_KEY) {
    throw Object.assign(new Error("SGAI_API_KEY fehlt im Worker-Secret"), { code: "SGAI_API_KEY_MISSING" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPEGRAPH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${SCRAPEGRAPH_BASE}/extract`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "SGAI-APIKEY": env.SGAI_API_KEY
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("ScrapeGraphAI-Zeitüberschreitung"), { code: "SGAI_TIMEOUT" });
    }
    throw Object.assign(new Error("ScrapeGraphAI-Anfrage fehlgeschlagen"), { code: "SCRAPEGRAPH_REQUEST_FAILED" });
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "SGAI_AUTH_FAILED"
      : response.status === 402
        ? "SGAI_CREDITS_EXHAUSTED"
        : response.status === 429
          ? "SGAI_RATE_LIMIT"
          : "SCRAPEGRAPH_REQUEST_FAILED";
    throw Object.assign(new Error("ScrapeGraphAI-Abruf fehlgeschlagen"), { code, upstreamStatus: response.status });
  }
  const data = extractScrapeGraphJson(payload);
  if (!data) throw Object.assign(new Error("ScrapeGraphAI lieferte keine strukturierten Daten"), { code: "SGAI_INVALID_RESPONSE" });
  return data;
}
__name(scrapeGraphExtract, "scrapeGraphExtract");
function klarnaSearchUrl(setNumber, ean) {
  return `https://www.klarna.com/de/shopping/?q=${encodeURIComponent(`LEGO ${setNumber} ${ean}`)}`;
}
__name(klarnaSearchUrl, "klarnaSearchUrl");
function validKlarnaProductUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && /(^|\.)klarna\.com$/i.test(parsed.hostname) && /\/de\/shopping\/pl\//i.test(parsed.pathname)
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
__name(validKlarnaProductUrl, "validKlarnaProductUrl");
function klarnaExtractBody(url, prompt, schema) {
  return {
    url,
    prompt,
    schema,
    fetchConfig: { mode: "js", stealth: true, country: "de", wait: 1500 }
  };
}
__name(klarnaExtractBody, "klarnaExtractBody");
function klarnaProductSchema() {
  return {
    type: "object",
    properties: {
      product_url: { type: "string" },
      title: { type: "string" },
      set_number: { type: "string" },
      ean: { type: "string" },
      image_url: { type: "string" }
    },
    required: ["product_url", "title"]
  };
}
__name(klarnaProductSchema, "klarnaProductSchema");
function klarnaOffersSchema() {
  return {
    type: "object",
    properties: {
      offers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            merchant: { type: "string" },
            title: { type: "string" },
            price: { type: ["number", "string"] },
            shipping: { type: ["number", "string", "null"] },
            currency: { type: "string" },
            url: { type: "string" },
            delivery: { type: "string" }
          },
          required: ["merchant", "price", "url"]
        }
      }
    },
    required: ["offers"]
  };
}
__name(klarnaOffersSchema, "klarnaOffersSchema");
function normalizeScrapeGraphKlarnaOffers(data, setNumber, productUrl, imageUrl) {
  const rawOffers = (Array.isArray(data?.offers) ? data.offers : [])
    .filter((offer) => {
      const merchant = normalizedText(offer?.merchant);
      const offerUrl = String(offer?.url || "").trim();
      return merchant && offerUrl && !/^javascript:/i.test(offerUrl);
    });
  const item = {
    name: `LEGO ${setNumber}`,
    productUrl,
    image: imageUrl,
    offers: rawOffers.map((offer) => ({
      retailer: offer?.merchant,
      title: offer?.title,
      price: offer?.price,
      shippingCost: offer?.shipping,
      currency: offer?.currency,
      offerUrl: normalizeMerchantUrl(offer?.url),
      delivery: offer?.delivery
    }))
  };
  return normalizeKlarnaItems([item], setNumber);
}
__name(normalizeScrapeGraphKlarnaOffers, "normalizeScrapeGraphKlarnaOffers");
function normalizeMerchantUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" && parsed.hostname.includes(".") ? parsed.href : null;
  } catch {
    return null;
  }
}
__name(normalizeMerchantUrl, "normalizeMerchantUrl");
async function startScrapeGraphKlarnaJob(request, url, env) {
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  const ean = cleanDigits(url.searchParams.get("ean"), 8, 14);
  if (!setNumber || !/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json2({ error: "Gültige LEGO-Setnummer und EAN sind erforderlich." }, 400);
  }
  if (!env.BM_CACHE?.get || !env.BM_CACHE?.put) return json2({ error: "BM_CACHE fehlt im Worker" }, 503);
  const best = normalizeMoney(url.searchParams.get("best"));
  const offersKey = `${CACHE_SCHEMA}:scrapegraph:klarna:offers:v1:${ean}`;
  const cachedOffers = await env.BM_CACHE.get(offersKey, "json");
  if (Array.isArray(cachedOffers)) {
    return json2(buildApifyMarketplaceResult("klarna", setNumber, cachedOffers, best, null), 200, { "x-worker-cache": "HIT" });
  }
  if (url.searchParams.get("cache") === "only") {
    return json2({ setNumber, ean, marketplace: "klarna", found: false, cacheMiss: true }, 200, { "x-worker-cache": "MISS-ONLY" });
  }
  if (!env.SGAI_API_KEY) return json2({ error: "SGAI_API_KEY fehlt im Worker-Secret", code: "SGAI_API_KEY_MISSING" }, 503);
  const cachedProduct = await env.BM_CACHE.get(`${CACHE_SCHEMA}:scrapegraph:klarna:product:v1:${ean}`, "json");
  const jobId = crypto.randomUUID();
  await env.BM_CACHE.put(`scrapegraph-job:${jobId}`, JSON.stringify({
    type: "klarna",
    phase: validKlarnaProductUrl(cachedProduct?.url) ? "offers" : "product",
    setNumber,
    ean,
    best,
    offersKey,
    searchUrl: klarnaSearchUrl(setNumber, ean),
    productUrl: validKlarnaProductUrl(cachedProduct?.url),
    productTitle: normalizedText(cachedProduct?.title),
    imageUrl: cachedProduct?.imageUrl || null,
    createdAt: Date.now()
  }), { expirationTtl: SCRAPEGRAPH_JOB_TTL_SECONDS });
  return json2({ pending: true, jobId, statusUrl: `/scrapegraph/status?job=${encodeURIComponent(jobId)}`, pollAfterMs: 1500 }, 202);
}
__name(startScrapeGraphKlarnaJob, "startScrapeGraphKlarnaJob");
async function handleScrapeGraphKlarnaJobStatus(request, url, env) {
  const jobId = String(url.searchParams.get("job") || "").trim();
  if (!jobId || !env.BM_CACHE?.get || !env.BM_CACHE?.put) return json2({ error: "Ungültige ScrapeGraphAI-Job-ID." }, 400);
  const key = `scrapegraph-job:${jobId}`;
  const job = await env.BM_CACHE.get(key, "json");
  if (!job) return json2({ error: "ScrapeGraphAI-Job nicht gefunden oder abgelaufen.", code: "SGAI_JOB_NOT_FOUND" }, 404);
  if (job.result) return json2(job.result);
  try {
    if (job.phase === "product") {
      const data = await scrapeGraphExtract(env, klarnaExtractBody(
        job.searchUrl,
        `Finde auf dieser deutschen Klarna-Seite exakt das LEGO-Produkt mit Setnummer ${job.setNumber} und EAN ${job.ean}. Liefere nur die Produktdetail-URL, den vollständigen Produkttitel, Setnummer, EAN und Bild-URL. Keine Zubehör-, Minifiguren- oder ähnliche Treffer.`,
        klarnaProductSchema()
      ));
      const productUrl = validKlarnaProductUrl(data.product_url ?? data.productUrl ?? data.url);
      const title = normalizedText(data.title);
      if (!productUrl || !/\blego\b/i.test(title) || !isRelevantLegoListing(title, "", job.setNumber)) {
        const result = buildApifyMarketplaceResult("klarna", job.setNumber, [], job.best, null);
        job.result = result;
        job.status = "SUCCEEDED";
        await env.BM_CACHE.put(job.offersKey, JSON.stringify([]), { expirationTtl: TTL.klarnaEmpty });
        await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: SCRAPEGRAPH_JOB_TTL_SECONDS });
        return json2(result);
      }
      const extractedSet = cleanSetNumber(data.set_number ?? data.setNumber);
      const extractedEan = cleanDigits(data.ean, 8, 14);
      if ((extractedSet && extractedSet !== job.setNumber) ||
        (extractedEan && extractedEan !== job.ean)) {
        const result = buildApifyMarketplaceResult("klarna", job.setNumber, [], job.best, null);
        job.result = result;
        job.status = "SUCCEEDED";
        await env.BM_CACHE.put(job.offersKey, JSON.stringify([]), { expirationTtl: TTL.klarnaEmpty });
        await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: SCRAPEGRAPH_JOB_TTL_SECONDS });
        return json2(result);
      }
      job.phase = "offers";
      job.productUrl = productUrl;
      job.productTitle = title;
      job.imageUrl = absolutizeUrl(data.image_url ?? data.imageUrl, productUrl);
      await env.BM_CACHE.put(`${CACHE_SCHEMA}:scrapegraph:klarna:product:v1:${job.ean}`, JSON.stringify({ url: productUrl, title, imageUrl: job.imageUrl }), { expirationTtl: SCRAPEGRAPH_PRODUCT_TTL_SECONDS });
      await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: SCRAPEGRAPH_JOB_TTL_SECONDS });
      return json2({ pending: true, jobId, phase: "offers", pollAfterMs: 1500 }, 202);
    }
    const data = await scrapeGraphExtract(env, klarnaExtractBody(
      job.productUrl,
      `Extrahiere alle deutschen Händlerangebote für genau dieses LEGO-Produkt ${job.setNumber} (EAN ${job.ean}). Für jedes Angebot: Händlername, Artikeltitel, Preis, Versandkosten, Währung, direkte Händler-URL und Lieferhinweis. Nur EUR-Angebote und keine Zubehör- oder Minifiguren-Angebote.`,
      klarnaOffersSchema()
    ));
    const offers = normalizeScrapeGraphKlarnaOffers(data, job.setNumber, job.productUrl, job.imageUrl);
    const result = buildApifyMarketplaceResult("klarna", job.setNumber, offers, job.best, null);
    await env.BM_CACHE.put(job.offersKey, JSON.stringify(offers), { expirationTtl: result.found ? TTL.klarna : TTL.klarnaEmpty });
    job.result = result;
    job.status = "SUCCEEDED";
    await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: SCRAPEGRAPH_JOB_TTL_SECONDS });
    return json2(result);
  } catch (error) {
    return json2({ error: "ScrapeGraphAI-Status konnte nicht verarbeitet werden.", code: error?.code || "SCRAPEGRAPH_REQUEST_FAILED", upstreamStatus: error?.upstreamStatus || null, jobId }, error?.code === "SGAI_RATE_LIMIT" ? 429 : error?.code === "SGAI_CREDITS_EXHAUSTED" ? 402 : error?.code === "SGAI_AUTH_FAILED" || error?.code === "SGAI_API_KEY_MISSING" ? 503 : 502);
  }
}
__name(handleScrapeGraphKlarnaJobStatus, "handleScrapeGraphKlarnaJobStatus");
function buildApifyMarketplaceResult(marketplace, setNumber, offers, best, runId = null) {
  const filtered = excludeSuspiciousLowPrices(offers, best);
  const sortedOffers = [...filtered.offers]
    .sort((a, b) => Number(a.total) - Number(b.total))
    .slice(0, 10);
  return {
    setNumber,
    marketplace,
    found: sortedOffers.length > 0,
    cheapest: sortedOffers[0] || null,
    comparedOffers: sortedOffers.length,
    excludedSuspiciousOffers: filtered.excludedCount,
    excludedBelowReferencePrice: filtered.excludedBelowReferencePrice,
    referencePrice: best,
    minimumReferencePrice: filtered.minimumReferencePrice,
    offers: sortedOffers,
    sources: {
      [marketplace]: {
        success: true,
        count: sortedOffers.length,
        runId
      }
    }
  };
}
__name(buildApifyMarketplaceResult, "buildApifyMarketplaceResult");
// Lange Actor-Läufe werden für die Extension als Job ausgeführt. So bleibt
// keine einzelne Worker-Anfrage offen, während Apify noch scrape't.
async function startApifyActor(env, actorId, input, maxTotalChargeUsd = 0.05) {
  const token = env.APIFY_TOKEN;
  if (!token) throw Object.assign(new Error("APIFY_TOKEN fehlt"), { code: "APIFY_TOKEN_MISSING" });
  const response = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${encodeURIComponent(token)}&maxTotalChargeUsd=${maxTotalChargeUsd}&timeout=300`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const error = Object.assign(new Error(`Apify Actor-Start fehlgeschlagen (HTTP ${response.status})`), {
      code: response.status === 429 ? "APIFY_RATE_LIMIT" : "ACTOR_START_FAILED",
      upstreamStatus: response.status
    });
    throw error;
  }
  const payload = await response.json().catch(() => null);
  const data = payload?.data || payload;
  if (!data?.id) throw Object.assign(new Error("Apify Actor-Start: keine Run-ID erhalten"), { code: "ACTOR_START_NO_RUN_ID" });
  return { runId: data.id, status: data.status || "RUNNING" };
}
__name(startApifyActor, "startApifyActor");

async function getApifyRun(env, runId) {
  const token = env.APIFY_TOKEN;
  const response = await fetch(`${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw Object.assign(new Error(`Apify Run-Status fehlgeschlagen (HTTP ${response.status})`), { code: "ACTOR_POLL_FAILED", upstreamStatus: response.status });
  const payload = await response.json().catch(() => null);
  return payload?.data || payload;
}
__name(getApifyRun, "getApifyRun");

async function getApifyDatasetItems(env, runData, input) {
  const datasetId = runData?.defaultDatasetId;
  if (!datasetId) return [];
  const token = env.APIFY_TOKEN;
  const limit = Number(input?.maxResults || input?.max_results || input?.maxItems || 10);
  const response = await fetch(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}&limit=${limit}&clean=true`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw Object.assign(new Error(`Apify Dataset-Abruf fehlgeschlagen (HTTP ${response.status})`), { code: "DATASET_FETCH_FAILED", upstreamStatus: response.status });
  return await response.json().catch(() => []);
}
__name(getApifyDatasetItems, "getApifyDatasetItems");

async function startApifyMarketplaceJob(request, url, env, marketplace) {
  const config = APIFY_CONFIG[marketplace];
  const setNumber = cleanSetNumber(url.searchParams.get("set"));
  const ean = cleanDigits(url.searchParams.get("ean"), 8, 14);
  if (!config || !setNumber || marketplace === "klarna" && !/^\d{8}$|^\d{12,14}$/.test(ean)) {
    return json2({ error: "Ungültige Marktplatz-, Setnummer- oder EAN-Angabe." }, 400);
  }
  if (!env.BM_CACHE) return json2({ error: "BM_CACHE fehlt im Worker" }, 503);
  try {
    const best = normalizeMoney(url.searchParams.get("best"));
    const rawResultCacheKey = marketplace === "kleinanzeigen"
      ? `${CACHE_SCHEMA}:apify-raw:${marketplace}:${config.cacheVersion}:${setNumber}`
      : null;
    if (rawResultCacheKey) {
      const cachedRawResult = await env.BM_CACHE.get(rawResultCacheKey, "json");
      if (Array.isArray(cachedRawResult?.offers)) {
        return json2(buildApifyMarketplaceResult(
          marketplace,
          setNumber,
          cachedRawResult.offers,
          best,
          cachedRawResult.runId || null
        ), 200, { "x-worker-cache": "HIT" });
      }
    }
    const resultCacheKey = rawResultCacheKey
      ? null
      : `${CACHE_SCHEMA}:apify-result:${marketplace}:${config.cacheVersion}:${setNumber}:${best ?? "none"}`;
    const cachedResult = resultCacheKey
      ? await env.BM_CACHE.get(resultCacheKey, "json")
      : null;
    if (cachedResult) return json2(cachedResult, 200, { "x-worker-cache": "HIT" });
    if (url.searchParams.get("cache") === "only") {
      return json2({
        setNumber,
        marketplace,
        found: false,
        cacheMiss: true
      }, 200, { "x-worker-cache": "MISS-ONLY" });
    }
    if (!env.APIFY_TOKEN) {
      return json2({
        error: "APIFY_TOKEN fehlt im Worker-Secret",
        code: "APIFY_TOKEN_MISSING"
      }, 503);
    }
    const input = config.buildInput(setNumber, ean);
    const started = await startApifyActor(
      env,
      config.actorId,
      input,
      config.maxTotalChargeUsd || 0.05
    );
    const jobId = crypto.randomUUID();
    await env.BM_CACHE.put(`apify-job:${jobId}`, JSON.stringify({
      type: "marketplace", marketplace, setNumber, best, actorId: config.actorId,
      input, resultCacheKey, rawResultCacheKey, runId: started.runId,
      status: started.status,
      createdAt: Date.now()
    }), { expirationTtl: APIFY_JOB_TTL_SECONDS });
    return json2({ pending: true, jobId, statusUrl: `/apify/status?job=${encodeURIComponent(jobId)}`, pollAfterMs: 1500 }, 202);
  } catch (error) {
    console.error("Apify marketplace start failed", {
      marketplace,
      setNumber,
      code: error?.code || "ACTOR_START_FAILED",
      upstreamStatus: error?.upstreamStatus || null
    });
    return json2({
      error: "Apify-Lauf konnte nicht gestartet werden.",
      code: error?.code || "ACTOR_START_FAILED",
      upstreamStatus: error?.upstreamStatus || null
    }, error?.code === "APIFY_RATE_LIMIT" ? 429 : 502);
  }
}
__name(startApifyMarketplaceJob, "startApifyMarketplaceJob");

async function startApifyIdealoJob(request, url, env) {
  const ean = String(url.searchParams.get("ean") || "").replace(/\D/g, "");
  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) return json2({ error: "EAN ist ungültig." }, 400);
  if (!env.BM_CACHE) return json2({ error: "BM_CACHE fehlt im Worker" }, 503);
  try {
    const input = { operation: "search-by-gtin", country: "fr", values: [ean] };
    const resultCacheKey = `${CACHE_SCHEMA}:apify-result:idealo:${ean}`;
    const cachedResult = await env.BM_CACHE.get(resultCacheKey, "json");
    if (cachedResult) return json2(cachedResult, 200, { "x-worker-cache": "HIT" });
    if (url.searchParams.get("cache") === "only") {
      return json2({
        ean,
        country: "fr",
        found: false,
        cacheMiss: true
      }, 200, { "x-worker-cache": "MISS-ONLY" });
    }
    if (!env.APIFY_TOKEN) {
      return json2({
        error: "APIFY_TOKEN fehlt im Worker-Secret",
        code: "APIFY_TOKEN_MISSING"
      }, 503);
    }
    const started = await startApifyActor(env, "pricepirate~idealo-price-data-api", input);
    const jobId = crypto.randomUUID();
    await env.BM_CACHE.put(`apify-job:${jobId}`, JSON.stringify({ type: "idealo", ean, actorId: "pricepirate~idealo-price-data-api", input, resultCacheKey, runId: started.runId, status: started.status, createdAt: Date.now() }), { expirationTtl: APIFY_JOB_TTL_SECONDS });
    return json2({ pending: true, jobId, statusUrl: `/apify/status?job=${encodeURIComponent(jobId)}`, pollAfterMs: 1500 }, 202);
  } catch (error) {
    return json2({ error: "Idealo-Apify-Lauf konnte nicht gestartet werden.", code: error?.code || "ACTOR_START_FAILED" }, error?.code === "APIFY_RATE_LIMIT" ? 429 : 502);
  }
}
__name(startApifyIdealoJob, "startApifyIdealoJob");

async function handleApifyJobStatus(request, url, env) {
  const jobId = String(url.searchParams.get("job") || "").trim();
  if (!jobId || !env.BM_CACHE) return json2({ error: "Ungültige Apify-Job-ID." }, 400);
  const key = `apify-job:${jobId}`;
  const job = await env.BM_CACHE.get(key, "json");
  if (!job) return json2({ error: "Apify-Job nicht gefunden oder abgelaufen.", code: "APIFY_JOB_NOT_FOUND" }, 404);
  if (job.result) return json2(job.result);
  try {
    const run = await getApifyRun(env, job.runId);
    if (["READY", "RUNNING", "ABORTING"].includes(run?.status)) {
      job.status = run.status;
      await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: APIFY_JOB_TTL_SECONDS });
      return json2({ pending: true, jobId, status: run.status, pollAfterMs: 1500 }, 202);
    }
    if (run?.status !== "SUCCEEDED") {
      job.status = run?.status || "FAILED";
      job.error = { code: "ACTOR_RUN_FAILED", runStatus: job.status };
      await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: APIFY_JOB_TTL_SECONDS });
      return json2({ error: "Apify-Lauf fehlgeschlagen.", jobId, ...job.error }, 502);
    }
    const items = await getApifyDatasetItems(env, run, job.input);
    let result;
    if (job.type === "idealo") {
      const offers = normalizeIdealoItems(items);
      result = { ean: job.ean, country: "fr", found: offers.length > 0, cheapest: offers[0] || null, comparedOffers: offers.length, offers: offers.slice(0, 3), sources: { idealo: { success: true, count: offers.length, runId: job.runId } } };
    } else {
      const config = APIFY_CONFIG[job.marketplace];
      const normalized = await normalizeMarketplaceItems(
        job.marketplace,
        items,
        job.setNumber,
        env
      );
      const deduped = dedupeByListingIdOrUrl(normalized);
      result = buildApifyMarketplaceResult(
        job.marketplace,
        job.setNumber,
        deduped,
        job.best,
        job.runId
      );
      if (job.rawResultCacheKey) {
        const rawTtlSeconds = deduped.length > 0
          ? TTL[job.marketplace]
          : TTL[`${job.marketplace}Empty`];
        await env.BM_CACHE.put(job.rawResultCacheKey, JSON.stringify({
          offers: deduped,
          runId: job.runId,
          updatedAt: new Date().toISOString()
        }), { expirationTtl: rawTtlSeconds || 20 * 60 });
      }
    }
    const actorStartedAt = Date.parse(run?.startedAt || "");
    const actorFinishedAt = Date.parse(run?.finishedAt || "");
    result.performance = {
      totalMs: Math.max(0, Date.now() - Number(job.createdAt || Date.now())),
      queueMs: Number.isFinite(actorStartedAt) ? Math.max(0, actorStartedAt - Number(job.createdAt || actorStartedAt)) : null,
      actorRunMs: Number.isFinite(actorStartedAt) && Number.isFinite(actorFinishedAt) ? Math.max(0, actorFinishedAt - actorStartedAt) : null,
      pollIntervalMs: 1500
    };
    job.result = result;
    job.status = "SUCCEEDED";
    if (job.resultCacheKey) {
      const ttlSeconds = job.type === "idealo"
        ? (result.found ? TTL.idealo : TTL.idealoEmpty)
        : (result.found ? TTL[job.marketplace] : TTL[`${job.marketplace}Empty`]);
      await env.BM_CACHE.put(job.resultCacheKey, JSON.stringify(result), { expirationTtl: ttlSeconds || 20 * 60 });
    }
    await env.BM_CACHE.put(key, JSON.stringify(job), { expirationTtl: APIFY_JOB_TTL_SECONDS });
    return json2(result);
  } catch (error) {
    return json2({ error: "Apify-Status konnte nicht verarbeitet werden.", code: error?.code || "ACTOR_POLL_FAILED", jobId }, 502);
  }
}
__name(handleApifyJobStatus, "handleApifyJobStatus");
var __test = Object.freeze({
  cleanSetNumber,
  cleanCatalogItem,
  normalizeMoney,
  parseBricklinkMoney,
  parseBricklinkOfferPrice,
  parseBricklinkCatalogItemId,
  normalizeBricklinkSetOffers,
  bricklinkMinifigOfferParams,
  isCompleteEbaySetTitle,
  normalizeEbayMinifigOffer,
  filterEbayMinifigPriceOutliers,
  excludeSuspiciousEbayLowPrices,
  stableHash,
  buildLeboncoinSearchUrl,
  parseListingPrice,
  computeTotalCost,
  dedupeByListingIdOrUrl,
  isRelevantLegoListing,
  normalizeVintedItems,
  normalizeLeboncoinItems,
  normalizeKleinanzeigenApifyItems,
  normalizeKlarnaItems,
  parseGoogleShoppingDelivery,
  normalizeGoogleShoppingResults,
  normalizeStockxItems,
  normalizeIdealoItems,
  extractBricklinkMinifigItemNos,
  extractBricklinkMinifigItems,
  APIFY_CONFIG,
  roundMoney
});
export {
  __test,
  ebay_price_worker_default as legacyEbayWorker,
  index_default as default
};
