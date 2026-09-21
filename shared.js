globalThis.BM_EXTENSION_DEFAULTS = Object.freeze({
    settingsSchemaVersion: 3,
    cleaner: true,
    detailLayout: true,
    linkPanel: true,
    copyAndMinifigures: true,
    priceCalculations: true,
    shippingAndSorting: true,
    selectionPopup: true,
    searchInSidebar: true,
    networkBlocking: true,
    luckyFallback: true,
    autoContinueRedirect: true,
    marketplacesInOfferlist: true,
    listView: true,
    twoColumnGrid: false,
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
        tools: true,
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
// Brickmerge nennt seinen eigenen Bestpreis auch im JSON-LD-Block des ersten
// HTML. Solange die Händlerzeilen noch nicht gerendert sind, ist das die
// einzige Referenz, gegen die die 50%-Plausibilität geprüft werden kann.
globalThis.BM_getJsonLdBestPrice = (doc = globalThis.document) => {
    const toPrice = value => {
        if (typeof value === 'number') {
            return Number.isFinite(value) && value > 0 ? value : null;
        }
        const text = String(value || '').trim();
        if (!text) return null;
        const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const prices = [];
    Array.from(doc?.querySelectorAll?.('script[type="application/ld+json"]') || [])
        .forEach(node => {
            let data = null;
            try {
                data = JSON.parse(node.textContent || '');
            } catch {
                return;
            }
            const entries = Array.isArray(data) ? data : (data?.['@graph'] || [data]);
            entries.filter(entry => entry?.['@type'] === 'Product').forEach(product => {
                const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
                offers.forEach(offer => {
                    if (!offer) return;
                    if (String(offer.priceCurrency || 'EUR').toUpperCase() !== 'EUR') return;
                    if (/outofstock|soldout/i.test(String(offer.availability || ''))) return;
                    const price = toPrice(offer.lowPrice ?? offer.price ?? product.lowPrice);
                    if (price !== null) prices.push(price);
                });
            });
        });
    return prices.length > 0 ? Math.min(...prices) : null;
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
    'idealo',
    'mueller'
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
globalThis.BM_EXCLUDED_OFFER_TITLE_PATTERN =
    /\b(?:ersatzteile?|einzelteile?|kleinteile?|anleitungen?|bauanleitungen?|manuals?|instructions?|stickers?|aufkleber|leerkarton|leere\s+(?:ovp|box|verpackung)|ovp\s*leer|box\s*only|empty\s*box|unvollst[aä]ndig|incomplete|incomplet(?:e|es|s)?|ohne\s+(?:figuren|minifiguren|steine|teile|anleitung|ovp)|sans\s+(?:figurines?|minifigurines?|pi[eè]ces?|briques?|bo[iî]te|notice)|moc|custom|kompatibel|compatible|konvolut|bundle|parts?\s*only|(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)\s*only|figurines?\s+seules?|minifigurines?\s+seules?|lot\s+(?:de\s+|of\s+|von\s+)?(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|pack\s+(?:de\s+|of\s+)?(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|set\s+(?:de\s+|of\s+|aus\s+)(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|toutes\s+les\s+(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|nur\s+(?:die\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|(?:only|just)\s+(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)(?:[^\n,;]{0,60}?)\s+(?:du|from|aus|vom)\s+(?:dem\s+|der\s+|the\s+)?set|(?:[a-z]{2,5}\d{3,5}[a-z]?\s+(?:figurines?|minifigs?|minifigure?s?|minifiguren?|figure?n?)|(?:figurines?|minifigs?|minifigure?s?|minifiguren?|figure?n?)\s+[a-z]{2,5}\d{3,5}[a-z]?)|pi[eè]ces?\s+d[eé]tach[eé]es?|lot\s+de\s+pi[eè]ces?|pi[eè]ces?\s+seules?|autocollants?|vitrinen?|schauk[aä]sten?|schutzhauben?|staubschutz|display\s*(?:case|box|stand)|showcase|acryl(?:glas)?(?:box|haube|vitrine)?|acrylic\s*(?:case|box|display)|pr[eé]sentoir(?:s)?|support(?:s)?\s+(?:mural|d['’]?exposition)|socle(?:s)?\s+d['’]?exposition|bo[iî]te(?:s)?\s+(?:acrylique|de\s+protection|vide|seule)|housse(?:s)?\s+anti[- ]?poussi[eè]re|protection(?:s)?\s+anti[- ]?poussi[eè]re|light(?:ing)?[- ]?(?:kits?|sets?)|(?:led[- ]?)?licht[- ]?(?:sets?|kits?)|(?:led[- ]?)?beleuchtungs?[- ]?(?:sets?|kits?)|led[- ]?(?:ferngesteuerte[s|r|n]?|mit\s+fernbedienung|fernbedienung|remote[- ]?control(?:led)?|wireless|kabellose[s|r|n]?|funk[- ]?)?\s*(?:licht[- ]?|beleuchtungs?[- ]?)?(?:beleuchtung|leuchten|lampen|strip|streifen|kits?|sets?)|(?:ferngesteuerte[s|r|n]?|kabellose[s|r|n]?|remote[- ]?control(?:led)?)\s+(?:led[- ]?|licht[- ]?|beleuchtungs?[- ]?)(?:kits?|sets?)|(?:led[- ]?)?kit[- ]?led|kit(?:[- ]*(?:d['’\s]*|de\s*)?|s\s+)?(?:led|lumi[eè]res?|[eé]clairages?|light(?:ing)?)(?:\s+(?:t[eé]l[eé]command[eé](?:e|es|s)?|avec\s+t[eé]l[eé]commande))?|(?:led[- ]?)?[eé]clairage(?:s)?(?:\s+led)?|(?:led[- ]?)?lumi[eè]re(?:s)?(?:\s+led)?|t[eé]l[eé]command[eé](?:e|es|s)?|nur\s+(?:das\s+)?(?:licht|led|beleuchtung)|(?:ohne|kein|sans|without)\s+(?:lego|modell|briques?|mod[eè]le)|(?:lego|modell|briques?|mod[eè]le)\s+(?:nicht\s+(?:enthalten|inklusive)|non\s+inclus(?:es?)?|not\s+included)|briksmax|lightailing|light\s*my\s*bricks|game\s*of\s*bricks|brickbling|yeabricks|kyglaring|vonado|lelightgo|brickshine|another[- ]?brick(?:[- ]?shop)?|wandhalterung|wall\s*mount|(?:bausteine?|klemmbausteine?)[- ]?(?:set|bausatz)?\s*(?:wie|ähnlich|ahnlich)|(?:wie|ähnlich|ahnlich)\s+lego|(?:nicht\s+von\s+lego|kein\s+lego|keine\s+lego|not\s+lego|no\s+lego|nicht\s+original\s+lego)|(?:building[- ]?)?block[- ]?sets?|china[- ]?(?:klon|clone)s?|(?:lego[- ]?)?plagiat(?:e)?|(?:fake|kopie)[- ]?lego|knock[- ]?offs?|bootlegs?|mould[- ]?king|mold[- ]?king|cobi|lepin|bluebrixx|blue[- ]?brixx|cada|ca[- ]?da|xingbao|sembo(?:\s*blocks?)?|sluban|qman|keeppley|panlos(?:\s*brick)?|reobrix|pantasy|funwhole|decool|forange|leji|sy\s*blocks?|wange\s*(?:blocks?|bricks?|set|bausteine?)|kazi\s*(?:blocks?|bricks?|set|bausteine?)|star\s*plan|space\s*wars)\b/i;

globalThis.BM_isExcludedOfferTitle = title => {
    return Boolean(title) && globalThis.BM_EXCLUDED_OFFER_TITLE_PATTERN.test(String(title));
};

globalThis.BM_EXCLUDED_OFFER_SELLER_PATTERN =
    /\b(?:another[-_ ]?brick(?:[-_ ]?shop)?|briksmax|lightailing|gameofbricks|game[-_ ]of[-_ ]bricks|brickbling|yeabricks|kyglaring|vonado|lelightgo|brickshine)\b/i;

globalThis.BM_isExcludedOfferSeller = seller => {
    return Boolean(seller) && globalThis.BM_EXCLUDED_OFFER_SELLER_PATTERN.test(String(seller));
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
            const title = candidate?.title || candidate?.name || candidate?.model || '';
            if (title && globalThis.BM_isExcludedOfferTitle(title)) return false;
            const seller = typeof candidate?.seller === 'string'
                ? candidate.seller
                : String(
                    candidate?.seller?.username ||
                    candidate?.seller?.name ||
                    candidate?.sellerName ||
                    candidate?.merchantName ||
                    ''
                );
            if (seller && globalThis.BM_isExcludedOfferSeller(seller)) return false;
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
globalThis.BM_dedupeMarketplaceOffers = (
    offers,
    sourceOrder = ['google-shopping', 'klarna'],
    isCandidateAvailable = () => true,
    reservedOffers = []
) => {
    const normalizedOffers = Array.isArray(offers) ? offers.filter(Boolean) : [];
    const priority = new Map(sourceOrder.map((source, index) => [source, index]));
    const comparisonSources = new Set(priority.keys());
    const normalizeMerchant = value => String(value || '')
        .toLocaleLowerCase('de')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\.(?:de|com|net|shop)\b/g, '')
        .replace(/\b(?:gmbh|ag|kg|deutschland)\b/g, '')
        .replace(/[^a-z0-9]+/g, '');
    const normalizeUrl = value => {
        try {
            const url = new URL(String(value || ''));
            return `${url.hostname.toLowerCase()}${url.pathname}`
                .replace(/\/+$/, '');
        } catch {
            return '';
        }
    };
    const signatures = candidate => {
        const price = Number(candidate?.dedupePrice);
        if (!Number.isFinite(price) || price <= 0) return [];
        const priceKey = Math.round(price * 100);
        const merchant = normalizeMerchant(
            candidate?.dedupeMerchant || candidate?.merchantName ||
            candidate?.logoCaption
        );
        const targetUrl = normalizeUrl(candidate?.dedupeUrl || candidate?.url);
        return [
            merchant ? `merchant:${merchant}:${priceKey}` : '',
            !merchant && targetUrl ? `url:${targetUrl}:${priceKey}` : ''
        ].filter(Boolean);
    };
    const seen = new Set();
    (Array.isArray(reservedOffers) ? reservedOffers : []).forEach(offer => {
        signatures(offer).forEach(key => seen.add(key));
    });
    const dedupedBySource = new Map();
    const availableCandidates = offer => {
        const candidates = Array.isArray(offer.candidateOffers) &&
            offer.candidateOffers.length > 0
            ? offer.candidateOffers
            : [offer];
        return candidates.filter(candidate =>
            candidate && isCandidateAvailable(candidate)
        );
    };
    const nextAlternativePrice = offer => {
        const prices = availableCandidates(offer)
            .map(candidate => Number(candidate.dedupePrice))
            .filter(price => Number.isFinite(price) && price > 0)
            .sort((left, right) => left - right);
        return prices.length > 1 ? prices[1] : Number.POSITIVE_INFINITY;
    };
    const comparisonOffers = normalizedOffers
        .filter(offer => comparisonSources.has(offer.key))
        .sort((left, right) => {
            const leftAlternative = nextAlternativePrice(left);
            const rightAlternative = nextAlternativePrice(right);
            if (leftAlternative !== rightAlternative) {
                if (!Number.isFinite(leftAlternative)) return -1;
                if (!Number.isFinite(rightAlternative)) return 1;
                return rightAlternative - leftAlternative;
            }
            return priority.get(left.key) - priority.get(right.key);
        });

    comparisonOffers.forEach(offer => {
        const uniqueCandidates = availableCandidates(offer).filter(candidate => {
            const keys = signatures(candidate);
            if (keys.some(key => seen.has(key))) return false;
            keys.forEach(key => seen.add(key));
            return true;
        });
        if (uniqueCandidates.length === 0) return;
        dedupedBySource.set(offer.key, {
            ...uniqueCandidates[0],
            candidateOffers: uniqueCandidates
        });
    });

    return normalizedOffers.map(offer => {
        if (!comparisonSources.has(offer.key)) return offer;
        return dedupedBySource.get(offer.key) || null;
    }).filter(Boolean);
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
        const match = url.pathname.match(/^\/(\d{4,7})(?:-[\da-z]+)?(?:_[^/]+)?\/?$/i);
        return match ? match[1] : null;
    } catch {
        return null;
    }
};

globalThis.BM_isCollectibleMinifigures = (
    doc = globalThis.document,
    urlValue = globalThis.location?.href
) => {
    try {
        const url = new URL(urlValue, 'https://www.brickmerge.de/');
        const pathname = decodeURIComponent(url.pathname);
        if (/^\/LEGO-Collectable(?:%20|\s+)Minifigures\b/i.test(url.pathname) ||
            /^\/LEGO-Collectable(?:%20|\s+)Minifigures\b/i.test(pathname) ||
            /\b\d{5}[-_a-z0-9]*[-_]lego[-_]collectable[-_]minifigures\b/i.test(url.pathname)) {
            return true;
        }
    } catch {}

    if (/^LEGO®?\s+Collectable\s+Minifigures\b/i.test(doc?.title || '')) {
        return true;
    }

    // 1. Breadcrumb navigation
    const breadcrumbLink = doc?.querySelector?.(
        '[itemtype*="BreadcrumbList"] a[href*="LEGO-Collectable"], ' +
        '.breadcrumb a[href*="LEGO-Collectable"], ' +
        'nav[aria-label="breadcrumb"] a[href*="LEGO-Collectable"]'
    );
    if (breadcrumbLink) {
        return true;
    }

    // 2. Direct theme link on page (https://www.brickmerge.de/LEGO-Collectable%20Minifigures)
    if (doc?.querySelector?.(
        'a[href*="/LEGO-Collectable%20Minifigures"], ' +
        'a[href*="/LEGO-Collectable Minifigures"], ' +
        'a[href*="/LEGO-Collectable-Minifigures"], ' +
        'a[href*="brickmerge.de/LEGO-Collectable%20Minifigures"], ' +
        'a[href*="brickmerge.de/LEGO-Collectable Minifigures"], ' +
        'a[href*="LEGO-Collectable%20Minifigures"], ' +
        'a[href*="LEGO-Collectable Minifigures"]'
    )) {
        return true;
    }

    return false;
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

globalThis.BM_mergeSettings = value => ({
    ...globalThis.BM_EXTENSION_DEFAULTS,
    ...(value || {}),
    listView: value?.listView !== undefined ? value.listView === true : (value?.twoColumnGrid !== false),
    twoColumnGrid: value?.twoColumnGrid === true,
    marketplacesInOfferlist: value?.marketplacesInOfferlist !== false,
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

globalThis.BM_parsePrice = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value || '').replace(/\s/g, '');
    const match = text.match(/\d[\d.,]*/);
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

globalThis.BM_formatBadgePrice = price => {
    const num = Number(price);
    if (!Number.isFinite(num) || num <= 0) return '';
    if (num >= 1000) {
        const k = (num / 1000).toFixed(1);
        return `${k}k`.replace('.0k', 'k');
    }
    return `${Math.round(num)}€`;
};

globalThis.BM_formatEuro = price => {
    const num = Number(price);
    if (!Number.isFinite(num)) return '';
    return num.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

globalThis.BM_normalizeEbaySellerAccountType = value => {
    const normalized = String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
    if ([
        'INDIVIDUAL', 'PRIVATE', 'PERSONAL', 'NON_BUSINESS',
        'PRIVATE_SELLER', 'INDIVIDUAL_SELLER', 'PERSONAL_SELLER'
    ].includes(normalized)) {
        return 'INDIVIDUAL';
    }
    if ([
        'BUSINESS', 'COMMERCIAL', 'PROFESSIONAL',
        'BUSINESS_SELLER', 'COMMERCIAL_SELLER', 'PROFESSIONAL_SELLER'
    ].includes(normalized)) {
        return 'BUSINESS';
    }
    return '';
};

globalThis.BM_SHOP_SHIPPING_RULES = Object.freeze([
    {
        name: 'LEGO Online Shop',
        pattern: /\b(?:lego|lego\.com|lego\s*shop|lego\s*store)\b/i,
        freeFrom: 55.00,
        standardCost: 3.95
    },
    {
        name: 'Smyths Toys',
        pattern: /\bsmyths(?:\s*toys)?\b/i,
        freeFrom: 29.00,
        standardCost: 3.95
    },
    {
        name: 'Müller',
        pattern: /\bm[üu]ller(?:\.de)?\b/i,
        freeFrom: 49.00,
        standardCost: 4.95,
        pickupFree: true
    },
    {
        name: 'Galaxus',
        pattern: /\bgalaxus(?:\.de)?\b/i,
        freeFrom: 30.00,
        standardCost: 3.90
    },
    {
        name: 'Amazon',
        pattern: /\bamazon(?:\.de)?\b/i,
        freeFrom: 39.00,
        standardCost: 3.99
    },
    {
        name: 'Proshop',
        pattern: /\bproshop(?:\.de)?\b/i,
        freeFrom: 100.00,
        standardCost: 4.99
    },
    {
        name: 'Steinehelden',
        pattern: /\bsteinehelden(?:\.de)?\b/i,
        freeFrom: 60.00,
        standardCost: 4.50
    },
    {
        name: 'JB Spielwaren',
        pattern: /\bjb[- ]?spielwaren\b/i,
        freeFrom: 150.00,
        standardCost: 4.99
    },
    {
        name: 'Alza',
        pattern: /\balza(?:\.de)?\b/i,
        freeFrom: null,
        standardCost: 0.98
    }
]);

globalThis.BM_findShopShippingRule = merchantName => {
    if (!merchantName) return null;
    return globalThis.BM_SHOP_SHIPPING_RULES.find(rule => rule.pattern.test(merchantName)) || null;
};

