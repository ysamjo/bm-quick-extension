globalThis.BM_EXTENSION_DEFAULTS = Object.freeze({
    settingsSchemaVersion: 3,
    cleaner: true,
    detailLayout: true,
    linkPanel: true,
    copyAndMinifigures: true,
    priceCalculations: true,
    shippingAndSorting: true,
    overviewPriceBadges: true,
    selectionPopup: true,
    networkBlocking: true,
    luckyFallback: true,
    autoContinueRedirect: true,
    metaGptBridge: true,
    offerShops: {
        ebay: true,
        ebayFr: true,
        kleinanzeigen: true,
        vinted: true,
        leboncoin: true,
        stockx: true,
        idealo: true,
        smyths: true,
        mueller: true,
        bricklink: true,
        brickowl: true
    },
    linkRows: {
        marketplaces: true,
        france: true,
        resources: true,
        history: true
    }
});

globalThis.BM_WORKER_DEFAULT_BASE_URL =
    'https://getdata.andreas-9b7.workers.dev';
globalThis.BM_WORKER_PREVIOUS_BASE_URL =
    'https://brickmerge-toolkit-api.andreas-9b7.workers.dev';
globalThis.BM_WORKER_LEGACY_BASE_URL =
    'https://ebay-price-api.andreas-9b7.workers.dev';
globalThis.BM_META_GPT_TRANSFER_HASH_KEY = 'bm-meta-transfer';
globalThis.BM_buildMetaGptTransferUrl = (
    transfer,
    baseUrl = 'https://chatgpt.com/g/g-LZvgtoTB9-meta-preisvergleich-gpt'
) => {
    const id = String(transfer?.id || '').trim();
    const prompt = String(transfer?.prompt || '').trim();
    const createdAt = Number(transfer?.createdAt);
    if (!id || !prompt || !Number.isFinite(createdAt)) {
        throw new TypeError('Ungültiger Meta-GPT-Transfer.');
    }
    const url = new URL(baseUrl);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    fragment.set(
        globalThis.BM_META_GPT_TRANSFER_HASH_KEY,
        JSON.stringify({ id, prompt, createdAt })
    );
    url.hash = fragment.toString();
    return url.href;
};
globalThis.BM_MARKETPLACE_MIN_REFERENCE_RATIO = 0.5;
globalThis.BM_MARKETPLACE_REFERENCE_FILTER_SOURCES = Object.freeze([
    'ebay',
    'ebay-fr',
    'kleinanzeigen',
    'vinted',
    'leboncoin',
    'stockx',
    'idealo'
]);
globalThis.BM_getMarketplaceMinimumPrice = referencePrice => {
    const reference = Number(referencePrice);
    if (!Number.isFinite(reference) || reference <= 0) return null;
    const referenceCents = Math.round(reference * 100);
    return Math.ceil(
        referenceCents * globalThis.BM_MARKETPLACE_MIN_REFERENCE_RATIO
    ) / 100;
};
globalThis.BM_isMarketplacePricePlausible = (
    source,
    price,
    referencePrice
) => {
    if (!globalThis.BM_MARKETPLACE_REFERENCE_FILTER_SOURCES.includes(source)) {
        return true;
    }
    const candidate = Number(price);
    if (!Number.isFinite(candidate) || candidate <= 0) return false;
    const minimum = globalThis.BM_getMarketplaceMinimumPrice(referencePrice);
    if (minimum === null) return true;
    return candidate + Number.EPSILON >= minimum;
};
globalThis.BM_EXTENSION_STORAGE_KEYS = Object.freeze({
    workerBaseUrl: 'bm:worker-base-url-v1',
    workerClientId: 'gm:brickmerge-worker-client-id-v1'
});

globalThis.BM_normalizeWorkerBaseUrl = value => {
    const candidate = String(value || globalThis.BM_WORKER_DEFAULT_BASE_URL).trim();
    if (candidate.replace(/\/+$/, '') === globalThis.BM_WORKER_PREVIOUS_BASE_URL) {
        return globalThis.BM_WORKER_DEFAULT_BASE_URL;
    }
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'https:' || url.username || url.password) {
            return globalThis.BM_WORKER_DEFAULT_BASE_URL;
        }
        url.pathname = url.pathname.replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.href.replace(/\/$/, '');
    } catch {
        return globalThis.BM_WORKER_DEFAULT_BASE_URL;
    }
};

globalThis.BM_resolveWorkerUrl = (value, baseUrl) => {
    const normalizedBase = globalThis.BM_normalizeWorkerBaseUrl(baseUrl);
    const base = new URL(`${normalizedBase}/`);
    const resolved = new URL(String(value || ''), base);
    if (resolved.origin !== base.origin) {
        throw new TypeError('Worker-Status-URL hat einen fremden Origin.');
    }
    return resolved.href;
};

globalThis.BM_getBrickmergeSetNumber = value => {
    try {
        const url = new URL(value, 'https://www.brickmerge.de/');
        const match = url.pathname.match(/^\/(\d{4,7})-\d+_[^/]+\/?$/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
};

globalThis.BM_normalizeMinifigNameTokens = value => {
    const stopWords = new Set([
        'a', 'an', 'and', 'the', 'with', 'without', 'of', 'in', 'on',
        'male', 'female', 'minifig', 'minifigure', 'figure'
    ]);
    return new Set(String(value || '')
        .toLocaleLowerCase('en')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/grey/g, 'gray')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(token => token.length > 1 && !stopWords.has(token)));
};

globalThis.BM_buildMinifigCrosswalk = (rebrickableEntries, brickLinkItems) => {
    const sources = (Array.isArray(rebrickableEntries) ? rebrickableEntries : [])
        .map(entry => ({
            id: String(entry?.set_num || '').trim(),
            name: String(entry?.set_name || entry?.name || '').trim(),
            quantity: Math.max(1, Number.parseInt(entry?.quantity, 10) || 1)
        }))
        .filter(entry => entry.id && entry.name);
    const targets = (Array.isArray(brickLinkItems) ? brickLinkItems : [])
        .map(item => ({
            id: String(item?.itemNo || item?.item_no || '').trim(),
            name: String(item?.name || '').trim(),
            quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1)
        }))
        .filter(item => item.id && item.name);
    const candidates = [];

    sources.forEach(source => {
        const sourceTokens = globalThis.BM_normalizeMinifigNameTokens(source.name);
        if (sourceTokens.size === 0) return;
        targets.forEach(target => {
            const targetTokens = globalThis.BM_normalizeMinifigNameTokens(target.name);
            const common = [...sourceTokens].filter(token => targetTokens.has(token));
            if (common.length < 2) return;
            const coverage = common.length / sourceTokens.size;
            const precision = common.length / targetTokens.size;
            const quantityAdjustment = source.quantity === target.quantity ? 0.08 : -0.08;
            const score = (coverage * 0.68) + (precision * 0.32) + quantityAdjustment;
            candidates.push({ sourceId: source.id, targetId: target.id, score });
        });
    });

    candidates.sort((a, b) => b.score - a.score);
    const usedSources = new Set();
    const usedTargets = new Set();
    const crosswalk = new Map();
    candidates.forEach(candidate => {
        if (candidate.score < 0.42 ||
            usedSources.has(candidate.sourceId) ||
            usedTargets.has(candidate.targetId)) return;
        usedSources.add(candidate.sourceId);
        usedTargets.add(candidate.targetId);
        crosswalk.set(candidate.sourceId, candidate.targetId);
    });
    return crosswalk;
};

globalThis.BM_parseBrickmergeDetailLines = values => {
    const allowedLabels = [
        'Teile', 'Minifiguren', 'Setgewicht', 'OVP-Maße', 'Release',
        'UVP', 'bisheriger Bestpreis', 'akt. brickmerge Preis', 'POV'
    ];
    const fields = [];
    for (const rawValue of values || []) {
        const line = String(rawValue || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[|·•]+\s*/, '')
            .replace(/\s*Korrektur melden\s*/gi, ' ')
            .trim();
        if (!line) continue;
        for (const label of allowedLabels) {
            const prefix = `${label}:`;
            const index = line.toLocaleLowerCase('de').indexOf(
                prefix.toLocaleLowerCase('de')
            );
            if (index < 0) continue;
            const value = line.slice(index + prefix.length).trim();
            if (value && !fields.some(field => field.label === label)) {
                fields.push({ label, value });
            }
            break;
        }
    }
    return fields;
};

globalThis.BM_mergeSettings = value => ({
    ...globalThis.BM_EXTENSION_DEFAULTS,
    ...(value || {}),
    offerShops: {
        ...globalThis.BM_EXTENSION_DEFAULTS.offerShops,
        ...(value?.offerShops || {})
    },
    linkRows: {
        ...globalThis.BM_EXTENSION_DEFAULTS.linkRows,
        ...(value?.linkRows || {})
    }
});

globalThis.BM_isFranceEnabled = settings =>
    settings?.linkRows?.france === true;
