globalThis.BM_EXTENSION_DEFAULTS = Object.freeze({
    settingsSchemaVersion: 3,
    cleaner: true,
    detailLayout: true,
    linkPanel: true,
    copyAndMinifigures: true,
    priceCalculations: true,
    shippingAndSorting: true,
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
        googleShopping: true,
        klarna: true,
        idealo: true,
        smyths: true,
        mueller: true,
        bricklink: true,
        brickowl: true
    },
    linkRows: {
        marketplaces: true,
        france: globalThis.BM_PLATFORM?.franceDefault !== false,
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
    'google-shopping',
    'klarna',
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
globalThis.BM_getPlausibleMarketplaceOffers = (
    source,
    result,
    referencePrice,
    getPrice = offer => Number(offer?.total ?? offer?.price)
) => {
    const candidates = [
        result?.cheapest,
        ...(Array.isArray(result?.offers) ? result.offers : [])
    ].filter(Boolean);
    const seen = new Set();
    return candidates
        .filter(candidate => {
            const price = getPrice(candidate);
            const identity = `${candidate?.url || ''}:${price}`;
            if (seen.has(identity)) return false;
            seen.add(identity);
            return globalThis.BM_isMarketplacePricePlausible(
                source,
                price,
                referencePrice
            );
        })
        .sort((left, right) => getPrice(left) - getPrice(right));
};
globalThis.BM_selectPlausibleMarketplaceOffer = (
    source,
    result,
    referencePrice,
    getPrice = offer => Number(offer?.total ?? offer?.price)
) => globalThis.BM_getPlausibleMarketplaceOffers(
    source,
    result,
    referencePrice,
    getPrice
)[0] || null;
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
            quantity: Math.max(1, Number.parseInt(entry?.quantity, 10) || 1),
            tokens: [...globalThis.BM_normalizeMinifigNameTokens(
                entry?.set_name || entry?.name
            )]
        }))
        .filter(entry => entry.id && entry.name);
    const targets = (Array.isArray(brickLinkItems) ? brickLinkItems : [])
        .map(item => ({
            id: String(item?.itemNo || item?.item_no || '').trim(),
            name: String(item?.name || '').trim(),
            quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1),
            tokens: [...globalThis.BM_normalizeMinifigNameTokens(item?.name)]
        }))
        .filter(item => item.id && item.name);
    if (sources.length === 0 || targets.length === 0) return new Map();

    const scorePair = (source, target) => {
        const targetTokenSet = new Set(target.tokens);
        const common = source.tokens.filter(token => targetTokenSet.has(token));
        const leadingNameMatches = Boolean(
            source.tokens[0] && source.tokens[0] === target.tokens[0]
        );
        if (common.length < 2 && !leadingNameMatches) return 0;
        const coverage = common.length / source.tokens.length;
        const precision = common.length / target.tokens.length;
        const quantityAdjustment = source.quantity === target.quantity
            ? 0.08
            : -0.08;
        // Charakter-Namen wie Bogrod oder Griphook sind aussagekräftiger als
        // gemeinsam vorkommende Farb- und Kleidungsbegriffe.
        const leadingNameBonus = leadingNameMatches ? 0.55 : 0;
        return (coverage * 0.68) + (precision * 0.32) +
            quantityAdjustment + leadingNameBonus;
    };

    const weights = sources.map(source =>
        targets.map(target => scorePair(source, target))
    );

    // Maximale Gesamtzuordnung statt gieriger Einzelentscheidungen. Dadurch
    // werden ähnliche Varianten (z. B. zwei Harry-Potter-Figuren) gemeinsam
    // optimal verteilt. Zusätzliche Nullspalten erlauben ungemappte Quellen.
    const solveMaximumWeightAssignment = matrix => {
        const rowCount = matrix.length;
        const realColumnCount = matrix[0]?.length || 0;
        const columnCount = realColumnCount + rowCount;
        const rowPotential = Array(rowCount + 1).fill(0);
        const columnPotential = Array(columnCount + 1).fill(0);
        const matchedRow = Array(columnCount + 1).fill(0);
        const previousColumn = Array(columnCount + 1).fill(0);

        for (let row = 1; row <= rowCount; row += 1) {
            matchedRow[0] = row;
            let currentColumn = 0;
            const minimumReducedCost = Array(columnCount + 1).fill(Infinity);
            const used = Array(columnCount + 1).fill(false);
            do {
                used[currentColumn] = true;
                const currentRow = matchedRow[currentColumn];
                let delta = Infinity;
                let nextColumn = 0;
                for (let column = 1; column <= columnCount; column += 1) {
                    if (used[column]) continue;
                    const weight = column <= realColumnCount
                        ? matrix[currentRow - 1][column - 1]
                        : 0;
                    const reducedCost = -weight - rowPotential[currentRow] -
                        columnPotential[column];
                    if (reducedCost < minimumReducedCost[column]) {
                        minimumReducedCost[column] = reducedCost;
                        previousColumn[column] = currentColumn;
                    }
                    if (minimumReducedCost[column] < delta) {
                        delta = minimumReducedCost[column];
                        nextColumn = column;
                    }
                }
                for (let column = 0; column <= columnCount; column += 1) {
                    if (used[column]) {
                        rowPotential[matchedRow[column]] += delta;
                        columnPotential[column] -= delta;
                    } else {
                        minimumReducedCost[column] -= delta;
                    }
                }
                currentColumn = nextColumn;
            } while (matchedRow[currentColumn] !== 0);

            do {
                const nextColumn = previousColumn[currentColumn];
                matchedRow[currentColumn] = matchedRow[nextColumn];
                currentColumn = nextColumn;
            } while (currentColumn !== 0);
        }

        const assignment = Array(rowCount).fill(-1);
        for (let column = 1; column <= realColumnCount; column += 1) {
            if (matchedRow[column] > 0) {
                assignment[matchedRow[column] - 1] = column - 1;
            }
        }
        return assignment;
    };

    const crosswalk = new Map();
    solveMaximumWeightAssignment(weights).forEach((targetIndex, sourceIndex) => {
        if (targetIndex < 0 || weights[sourceIndex][targetIndex] < 0.42) return;
        crosswalk.set(sources[sourceIndex].id, targets[targetIndex].id);
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
