(() => {
    'use strict';

    const SOURCE_ORDER = Object.freeze([
        'ebay',
        'bricklink',
        'kleinanzeigen',
        'vinted',
        'stockx',
        'ebay-fr',
        'leboncoin',
        'idealo'
    ]);
    const SOURCE_LABELS = Object.freeze({
        ebay: 'eBay DE',
        bricklink: 'BrickLink',
        kleinanzeigen: 'Kleinanzeigen',
        vinted: 'Vinted',
        stockx: 'StockX',
        'ebay-fr': 'eBay FR 🇫🇷',
        leboncoin: 'Leboncoin 🇫🇷',
        idealo: 'Idealo FR 🇫🇷'
    });
    const SOURCE_SETTING_KEYS = Object.freeze({ 'ebay-fr': 'ebayFr' });
    const FRANCE_SOURCES = new Set(['ebay-fr', 'leboncoin', 'idealo']);

    const parsePrice = value => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const match = String(value || '').replace(/\s/g, '').match(/\d[\d.,]*/);
        if (!match) return null;
        const raw = match[0];
        const comma = raw.lastIndexOf(',');
        const dot = raw.lastIndexOf('.');
        const normalized = comma > dot
            ? raw.replace(/\./g, '').replace(',', '.')
            : raw.replace(/,/g, '');
        const number = Number(normalized);
        return Number.isFinite(number) && number > 0 ? number : null;
    };

    const calculateDiscount = (referencePrice, price) => {
        const reference = Number(referencePrice);
        const current = Number(price);
        if (!Number.isFinite(reference) || reference <= 0 ||
            !Number.isFinite(current) || current <= 0 || current >= reference) {
            return null;
        }
        return Math.max(0, Math.round(((reference - current) / reference) * 100));
    };

    const isValidGtin13 = value => {
        const digits = String(value || '').trim();
        if (!/^\d{13}$/.test(digits)) return false;
        const sum = digits.slice(0, 12).split('').reduce((total, digit, index) =>
            total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
        return (10 - (sum % 10)) % 10 === Number(digits[12]);
    };

    const normalizeBrickmergeProduct = value => {
        const product = value?.productJson || {};
        const canonical = String(value?.canonical || product.url || '').trim();
        const canonicalSet = canonical.match(/brickmerge\.de\/(\d{3,7})-\d+_/i)?.[1] || '';
        const setNumber = String(product.mpn || value?.setNumber || canonicalSet).trim();
        const ean = String(product.gtin13 || value?.ean || '').trim();
        const imageValue = Array.isArray(product.image)
            ? product.image[0]
            : product.image || value?.image;
        if (!/^\d{3,7}$/.test(setNumber) || !isValidGtin13(ean)) return null;
        return {
            setNumber,
            ean,
            name: String(product.name || value?.name || `LEGO Set ${setNumber}`)
                .trim().replace(/\s+Preisvergleich.*$/i, ''),
            image: /^https:\/\//i.test(String(imageValue || ''))
                ? String(imageValue)
                : '',
            bestPrice: parsePrice(product.offers?.lowPrice ?? value?.bestPrice),
            referencePrice: parsePrice(value?.referencePrice),
            detailUrl: /^https:\/\/www\.brickmerge\.de\/\d{3,7}-\d+_/i.test(canonical)
                ? canonical
                : String(value?.finalUrl || canonical)
        };
    };

    const enabledSources = settings => SOURCE_ORDER.filter(source => {
        if (FRANCE_SOURCES.has(source) && settings?.linkRows?.france !== true) {
            return false;
        }
        const settingKey = SOURCE_SETTING_KEYS[source] || source;
        return settings?.offerShops?.[settingKey] !== false;
    });

    const buildBundleUrl = (baseUrl, path, product, sources) => {
        const url = new URL(path, `${String(baseUrl).replace(/\/+$/, '')}/`);
        url.searchParams.set('set', product.setNumber);
        url.searchParams.set('ean', product.ean);
        if (Number.isFinite(Number(product.bestPrice))) {
            url.searchParams.set('best', Number(product.bestPrice).toFixed(2));
        }
        url.searchParams.set('sources', sources.join(','));
        return url.href;
    };

    const normalizeOffer = payload => {
        const itemPrice = parsePrice(payload?.itemPrice);
        const shipping = parsePrice(payload?.shipping) ?? 0;
        const explicitTotal = parsePrice(payload?.total ?? payload?.price ?? payload?.amount);
        const total = explicitTotal ?? (itemPrice !== null ? itemPrice + shipping : null);
        const url = String(payload?.url || payload?.link || payload?.itemUrl || '').trim();
        if (!Number.isFinite(total) || total <= 0 || !/^https:\/\//i.test(url)) {
            return null;
        }
        return {
            total: Math.round((total + Number.EPSILON) * 100) / 100,
            url,
            title: String(payload?.title || '').trim(),
            shopName: String(payload?.shopName || payload?.merchantName || '').trim()
        };
    };

    const offersFromBundle = (bundle, product) => SOURCE_ORDER.flatMap(source => {
        const entry = bundle?.sources?.[source];
        if (entry?.state !== 'ready') return [];
        const data = entry.data?.result || entry.data?.data || entry.data;
        if (data?.found === false) return [];
        const raw = [
            data?.cheapest,
            ...(Array.isArray(data?.offers) ? data.offers : []),
            ...(Array.isArray(data?.results) ? data.results : []),
            ...(Array.isArray(data?.items) ? data.items : [])
        ].filter(Boolean);
        const seen = new Set();
        const candidates = raw.map(normalizeOffer).filter(offer => {
            if (!offer) return false;
            const identity = `${offer.url}:${offer.total}`;
            if (seen.has(identity)) return false;
            seen.add(identity);
            const plausibility = globalThis.BM_isMarketplacePricePlausible;
            return typeof plausibility !== 'function' || plausibility(
                source,
                offer.total,
                product?.bestPrice
            );
        }).sort((left, right) => left.total - right.total);
        const offer = candidates[0];
        if (!offer) return [];
        return [{
            source,
            label: source === 'idealo' && offer.shopName
                ? offer.shopName
                : SOURCE_LABELS[source],
            ...offer,
            savedAt: Number(entry.savedAt) || null
        }];
    }).sort((left, right) => left.total - right.total);

    const buildMarketplaceLinks = (setNumber, franceEnabled) => {
        const set = encodeURIComponent(String(setNumber || ''));
        const links = [
            ['eBay', `https://www.ebay.de/sch/i.html?_nkw=LEGO+${set}&LH_BIN=1`],
            ['Kleinanzeigen', `https://www.kleinanzeigen.de/s-spielzeug/sortierung:preis/lego-${set}/k0c23+spielzeug.condition_s:new`],
            ['Vinted', `https://www.vinted.de/catalog?search_text=lego+${set}`],
            ['StockX', `https://stockx.com/search?s=lego%20${set}`],
            ['BrickLink', `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${set}-1`],
            ['BrickOwl', `https://www.brickowl.com/search/catalog?cat=3&query=${set}-1`]
        ];
        if (franceEnabled) links.push(
            ['eBay FR', `https://www.ebay.fr/sch/i.html?_nkw=lego+${set}&LH_BIN=1&LH_ItemCondition=1000&_sop=15`],
            ['Leboncoin', `https://www.leboncoin.fr/recherche?text=lego%20${set}&shippable=1&sort=relevance&item_condition=1`],
            ['Idealo FR', `https://www.idealo.fr/rslt.html?q=${set}`]
        );
        return links.map(([label, url]) => ({ label, url }));
    };

    const core = Object.freeze({
        SOURCE_ORDER,
        SOURCE_LABELS,
        parsePrice,
        calculateDiscount,
        isValidGtin13,
        normalizeBrickmergeProduct,
        enabledSources,
        buildBundleUrl,
        normalizeOffer,
        offersFromBundle,
        buildMarketplaceLinks
    });
    globalThis.BM_SIDE_PANEL_CORE = core;
    if (typeof module !== 'undefined' && module.exports) module.exports = core;
})();
