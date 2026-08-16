(() => {
    'use strict';

    const CARD_SELECTOR = '#productrow .wrapper div.slide[id^="set"]';
    const CONCURRENCY = 4;
    const SOURCE_ORDER = Object.freeze([
        'ebay',
        'ebay-fr',
        'kleinanzeigen',
        'vinted',
        'leboncoin',
        'stockx',
        'idealo',
        'bricklink'
    ]);
    const SOURCE_LABELS = Object.freeze({
        ebay: 'eBay',
        'ebay-fr': 'eBay FR',
        kleinanzeigen: 'Kleinanzeigen',
        vinted: 'Vinted',
        leboncoin: 'Leboncoin',
        stockx: 'StockX',
        idealo: 'Idealo FR',
        bricklink: 'BrickLink'
    });
    const SOURCE_SETTING_KEYS = Object.freeze({
        'ebay-fr': 'ebayFr'
    });

    const cleanDigits = (value, min, max) => {
        const normalized = String(value || '').trim();
        return new RegExp(`^\\d{${min},${max}}$`).test(normalized)
            ? normalized
            : '';
    };

    const parsePrice = value => {
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

    const normalizeEbaySellerAccountType = value => {
        const normalized = String(value || '').trim().toUpperCase();
        if (normalized === 'BUSINESS' || normalized === 'COMMERCIAL') {
            return 'BUSINESS';
        }
        if (normalized === 'INDIVIDUAL' || normalized === 'PRIVATE') {
            return 'INDIVIDUAL';
        }
        return '';
    };

    const extractCardData = card => {
        if (!card?.querySelector) return null;
        const idSet = String(card.id || '').match(/^set(\d{3,7})-\d+$/)?.[1] || '';
        const mpnSet = card.querySelector('meta[itemprop="mpn"]')
            ?.getAttribute?.('content') || '';
        const setNumber = cleanDigits(idSet || mpnSet, 3, 7);
        const ean = cleanDigits(
            card.querySelector('meta[itemprop="gtin13"]')
                ?.getAttribute?.('content'),
            8,
            14
        );
        if (!setNumber || !ean) return null;
        const priceArea = card.querySelector('.productprice.productpricelist');
        const uvpText = priceArea?.querySelector('.small.stroke')?.textContent || '';
        return {
            setNumber,
            ean,
            bestPrice: parsePrice(
                priceArea?.querySelector('meta[itemprop="lowPrice"]')
                    ?.getAttribute?.('content') ||
                priceArea?.querySelector('.theprice')?.textContent
            ),
            referencePrice: parsePrice(uvpText.replace(/^.*?UVP/i, '')),
            detailUrl: card.querySelector('.producttitle a.detail')?.href || ''
        };
    };

    const calculateDiscount = (referencePrice, effectivePrice) => {
        const reference = Number(referencePrice);
        const price = Number(effectivePrice);
        if (!Number.isFinite(reference) || reference <= 0 ||
            !Number.isFinite(price) || price <= 0) return null;
        const savings = Math.max(
            0,
            Math.round((reference - price + Number.EPSILON) * 100) / 100
        );
        return {
            savings,
            percentage: Math.max(0, Math.round((savings / reference) * 100))
        };
    };

    const buildBundleUrl = (baseUrl, path, data, sources = SOURCE_ORDER) => {
        const url = new URL(path, `${String(baseUrl).replace(/\/+$/, '')}/`);
        url.searchParams.set('set', data.setNumber);
        url.searchParams.set('ean', data.ean);
        if (Number.isFinite(data.bestPrice) && data.bestPrice > 0) {
            url.searchParams.set('best', Number(data.bestPrice).toFixed(2));
        }
        url.searchParams.set('sources', sources.join(','));
        return url.href;
    };

    const selectDisplayOffer = payload => {
        if (!payload?.found || !payload.cheapest) return null;
        const itemPrice = Number(payload.cheapest.itemPrice);
        const shipping = Number(payload.cheapest.shipping);
        const explicitTotal = Number(payload.cheapest.total ?? payload.cheapest.price);
        const total = Number.isFinite(explicitTotal) && explicitTotal > 0
            ? explicitTotal
            : Number.isFinite(itemPrice) && itemPrice > 0 && Number.isFinite(shipping)
                ? itemPrice + shipping
                : itemPrice;
        if (!Number.isFinite(total) || total <= 0) return null;
        const url = String(payload.cheapest.url || '').trim();
        if (!/^https:\/\//i.test(url)) return null;
        const sellerData = payload.cheapest.seller;
        const seller = typeof sellerData === 'string'
            ? sellerData.trim()
            : String(sellerData?.username || sellerData?.name || '').trim();
        const sellerAccountType = normalizeEbaySellerAccountType(
            payload.cheapest.sellerAccountType ||
            payload.cheapest.sellerType ||
            sellerData?.sellerAccountType
        );
        return {
            total: Math.round((total + Number.EPSILON) * 100) / 100,
            itemPrice: Number.isFinite(itemPrice) ? itemPrice : null,
            shipping: Number.isFinite(shipping) ? shipping : null,
            url,
            title: String(payload.cheapest.title || '').trim(),
            seller,
            sellerAccountType,
            shopName: String(
                payload.cheapest.shopName || payload.cheapest.merchantName || ''
            ).trim(),
            comparedOffers: Number(payload.comparedOffers) || 0
        };
    };

    const selectBundleOffers = (bundle, data) => SOURCE_ORDER.flatMap(source => {
        const entry = bundle?.sources?.[source];
        if (entry?.state !== 'ready') return [];
        const sourceData = entry.data?.result || entry.data?.data || entry.data;
        const candidates = [
            sourceData?.cheapest,
            ...(Array.isArray(sourceData?.offers) ? sourceData.offers : [])
        ].filter(Boolean);
        const seen = new Set();
        const offer = candidates
            .map(candidate => selectDisplayOffer({
                ...sourceData,
                found: true,
                cheapest: candidate
            }))
            .filter(candidate => {
                if (!candidate) return false;
                const identity = `${candidate.url}:${candidate.total}`;
                if (seen.has(identity)) return false;
                seen.add(identity);
                return BM_isMarketplacePricePlausible(
                    source,
                    candidate.total,
                    data?.bestPrice
                );
            })
            .sort((left, right) => left.total - right.total)[0] || null;
        const savedAt = Number(entry.savedAt);
        const label = source === 'idealo' && offer?.shopName
            ? offer.shopName
            : SOURCE_LABELS[source];
        return offer ? [{
            source,
            label,
            ...offer,
            cacheState: String(entry.cacheState || ''),
            savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null
        }] : [];
    });

    const selectEffectiveOffer = (data, offers) => {
        const nativePrice = Number(data?.bestPrice);
        const nativeOffer = Number.isFinite(nativePrice) && nativePrice > 0
            ? {
                source: 'brickmerge',
                label: 'Brickmerge',
                total: Math.round((nativePrice + Number.EPSILON) * 100) / 100,
                url: String(data?.detailUrl || '')
            }
            : null;
        return [nativeOffer, ...(offers || [])]
            .filter(offer => Number.isFinite(Number(offer?.total)) && Number(offer.total) > 0)
            .sort((left, right) => Number(left.total) - Number(right.total))[0] || null;
    };

    const sortPriceEntries = (entries, direction = 'asc') => [...entries].sort((left, right) => {
        const leftPrice = Number(left?.price);
        const rightPrice = Number(right?.price);
        const leftValid = Number.isFinite(leftPrice) && leftPrice > 0;
        const rightValid = Number.isFinite(rightPrice) && rightPrice > 0;
        if (leftValid !== rightValid) return leftValid ? -1 : 1;
        if (!leftValid) return Number(left?.index || 0) - Number(right?.index || 0);
        const difference = direction === 'desc'
            ? rightPrice - leftPrice
            : leftPrice - rightPrice;
        return difference || Number(left?.index || 0) - Number(right?.index || 0);
    });

    const getOverviewSortMode = value => {
        const sort = new URL(value, 'https://www.brickmerge.de/').searchParams.get('sort');
        if (sort === 'priceup') return 'price-asc';
        if (sort === 'pricedown') return 'price-desc';
        if (sort === 'maxsaving') return 'saving-desc';
        if (['maxdiscount', 'maxpercent', 'savingpercent'].includes(sort)) {
            return 'percentage-desc';
        }
        return '';
    };

    const sortOverviewEntries = (entries, mode) => {
        const metric = mode === 'saving-desc'
            ? 'savings'
            : mode === 'percentage-desc'
                ? 'percentage'
                : 'price';
        const direction = mode === 'price-asc' ? 'asc' : 'desc';
        return sortPriceEntries(entries.map((entry, position) => ({
            entry,
            index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : position,
            price: entry?.[metric]
        })), direction).map(wrapper => wrapper.entry);
    };

    const applyDiscountDom = (card, offerBox, discount, formatValue) => {
        if (!card || !offerBox || !discount) return;
        const savingsLabel = Array.from(offerBox.querySelectorAll('.small'))
            .find(element => /^gespart\s*:/i.test(element.textContent?.trim() || ''));
        const savingsNode = savingsLabel?.nextSibling;
        if (savingsNode?.nodeType === 3) {
            savingsNode.textContent = savingsNode.textContent.replace(
                /[\d.,]+\s*€/,
                `${formatValue(discount.savings)} €`
            );
        }
        const percentage = Array.from(offerBox.children)
            .find(element => element.tagName === 'STRONG' && /^\d+%$/.test(
                element.textContent?.trim() || ''
            ));
        if (percentage) percentage.textContent = `${discount.percentage}%`;
        const bubble = card.querySelector(':scope > .off');
        if (bubble) {
            bubble.textContent = `${discount.percentage}%`;
            bubble.hidden = discount.percentage === 0;
        }
    };

    const createLimiter = limit => {
        const pending = [];
        let active = 0;
        const drain = () => {
            while (active < limit && pending.length > 0) {
                const entry = pending.shift();
                active += 1;
                Promise.resolve().then(entry.task).then(entry.resolve, entry.reject)
                    .finally(() => {
                        active -= 1;
                        drain();
                    });
            }
        };
        return task => new Promise((resolve, reject) => {
            pending.push({ task, resolve, reject });
            drain();
        });
    };

    const enabledSources = settings => {
        const franceEnabled = settings?.linkRows?.france === true;
        const franceSources = new Set(['ebay-fr', 'leboncoin', 'idealo']);
        return SOURCE_ORDER.filter(source => {
            if (franceSources.has(source) && !franceEnabled) return false;
            const settingKey = SOURCE_SETTING_KEYS[source] || source;
            return settings.offerShops?.[settingKey] !== false;
        });
    };

    // Auf Übersichtsseiten werden ausschließlich vorhandene Worker-Cachewerte
    // gelesen. Neue Kleinanzeigen-Abfragen starten nur auf Set-Detailseiten.
    const buttonSources = settings => enabledSources(settings)
        .filter(source => source !== 'kleinanzeigen');

    const core = Object.freeze({
        CARD_SELECTOR,
        SOURCE_ORDER,
        cleanDigits,
        parsePrice,
        extractCardData,
        calculateDiscount,
        buildBundleUrl,
        selectDisplayOffer,
        selectBundleOffers,
        selectEffectiveOffer,
        sortPriceEntries,
        getOverviewSortMode,
        sortOverviewEntries,
        applyDiscountDom,
        createLimiter,
        enabledSources,
        buttonSources
    });
    globalThis.BM_OVERVIEW_PRICE_CORE = core;
    if (typeof module !== 'undefined' && module.exports) module.exports = core;

    if (typeof document === 'undefined' || typeof BM_MOBILE_CHROME === 'undefined' ||
        !chrome.storage?.local) return;

    globalThis.BM_DB_UNIFIED_REFRESH = true;

    const formatEuro = value => Number(value).toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const ensureStyles = () => {
        if (document.getElementById('bm-overview-price-styles')) return;
        const style = document.createElement('style');
        style.id = 'bm-overview-price-styles';
        style.textContent = `
            .bm-overview-marketplace-prices {
                display: grid;
                gap: 2px;
                clear: both;
                width: calc(100% - 0.5rem);
                margin: 0.38rem auto 0;
            }
            .bm-overview-marketplace-offer {
                display: flex !important;
                align-items: center;
                justify-content: space-between;
                gap: 0.35rem;
                min-width: 0;
                padding: 0.23rem 0.38rem;
                border-left: 3px solid #f4d348;
                background: #f6f6f6 !important;
                color: #555 !important;
                font-size: 0.68rem;
                line-height: 1.1;
                text-decoration: none !important;
                transition: background-color 140ms ease, box-shadow 140ms ease;
            }
            .bm-overview-marketplace-offer:hover,
            .bm-overview-marketplace-offer:focus-visible {
                background: #fff !important;
                color: #333 !important;
                box-shadow: 1px 1px 4px rgba(0, 0, 0, 0.2);
                outline: none;
            }
            .bm-overview-marketplace-source {
                overflow: hidden;
                color: #333 !important;
                font-weight: 650;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .bm-overview-marketplace-price {
                flex: 0 0 auto;
                color: #b40000 !important;
                font-size: 0.72rem;
                font-weight: 700;
                white-space: nowrap;
            }
            .bm-overview-effective-price {
                white-space: nowrap;
            }
            .bm-overview-effective-source {
                display: inline-block;
                margin-left: 0.28rem;
                color: #666 !important;
                font-size: 0.66rem;
                font-weight: 650;
                text-decoration: none !important;
                vertical-align: baseline;
            }
            .bm-overview-effective-source:hover,
            .bm-overview-effective-source:focus-visible {
                color: #a80000 !important;
                text-decoration: underline !important;
                outline: none;
            }
            .bm-detail-all-prices-refresh.is-loading {
                pointer-events: none;
                opacity: 0.78;
            }
            .bm-detail-all-prices-refresh.is-loading .bm-detail-refresh-icon {
                animation: bm-all-prices-spin 700ms linear infinite;
            }
            .bm-detail-all-prices-refresh {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                align-self: stretch;
                gap: 0.35rem;
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
                min-height: 0;
                margin: 0 0 0.35rem !important;
                font-family: inherit !important;
                line-height: 1.2;
                white-space: nowrap;
                text-decoration: none;
                transition: background-color 150ms ease, color 150ms ease;
                box-sizing: border-box;
            }
            .bm-detail-all-prices-refresh:hover,
            .bm-detail-all-prices-refresh:focus-visible {
                text-decoration: none;
            }
            .bm-detail-refresh-icon {
                display: inline-flex;
                width: 1.2rem;
                height: 1.2rem;
                flex: 0 0 1.2rem;
                align-items: center;
                justify-content: center;
                line-height: 1;
            }
            .bm-detail-refresh-icon svg {
                display: block;
                width: 1.15rem;
                height: 1.15rem;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .bm-chart-controls.bm-has-price-refresh {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                align-items: stretch !important;
                column-gap: 0.4rem !important;
                width: 100%;
                box-sizing: border-box;
            }
            .bm-chart-controls.bm-has-price-refresh.bmd-has-depot-button {
                grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            }
            .bm-chart-controls.bm-has-price-refresh > #chartTrigger,
            .bm-chart-controls.bm-has-price-refresh > .bmd-open-button,
            .bm-chart-controls.bm-has-price-refresh > .bm-detail-all-prices-refresh {
                display: flex !important;
                height: 44px !important;
                min-height: 44px !important;
                align-items: center !important;
                justify-content: center !important;
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                margin-right: 0 !important;
                margin-left: 0 !important;
                line-height: 1 !important;
                text-align: center !important;
                vertical-align: middle !important;
                box-sizing: border-box;
            }
            .bm-chart-controls.bm-has-price-refresh > #chartTrigger .chartbutton,
            .bm-chart-controls.bm-has-price-refresh > .bmd-open-button .bmd-button-content {
                display: inline-flex !important;
                width: 100% !important;
                height: 1.2rem !important;
                min-height: 1.2rem !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 0.35rem !important;
                margin: 0 !important;
                padding: 0 !important;
                line-height: 1 !important;
                text-align: center !important;
                vertical-align: middle !important;
            }
            .bm-chart-controls.bm-has-price-refresh .bm-chart-label-full,
            .bm-chart-controls.bm-has-price-refresh .bmd-button-label-full,
            .bm-chart-controls.bm-has-price-refresh .bm-refresh-label {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                height: 1.2rem;
                margin: 0 !important;
                padding: 0 !important;
                line-height: 1.2rem !important;
                text-align: center !important;
                vertical-align: middle !important;
            }
            .bm-chart-controls.bm-has-price-refresh .bm-chart-label-mobile,
            .bm-chart-controls.bm-has-price-refresh .bmd-button-label-mobile {
                display: none !important;
            }
            .bm-chart-controls.bm-has-price-refresh > .bm-chart-best-price {
                grid-column: 1 / -1;
            }
            .bm-detail-all-prices-refresh:focus-visible {
                outline: 2px solid #aaa;
                outline-offset: 2px;
            }
            @media only screen and (max-width: 40em) {
                .bm-detail-all-prices-refresh {
                    padding-right: 0.3rem !important;
                    padding-left: 0.3rem !important;
                    font-size: 0.7rem !important;
                }
                .bm-chart-controls.bm-has-price-refresh .bm-chart-label-full,
                .bm-chart-controls.bm-has-price-refresh .bmd-button-label-full {
                    display: none !important;
                }
                .bm-chart-controls.bm-has-price-refresh .bm-chart-label-mobile,
                .bm-chart-controls.bm-has-price-refresh .bmd-button-label-mobile {
                    display: inline-flex !important;
                    align-items: center;
                    justify-content: center;
                    height: 1.2rem;
                    margin: 0 !important;
                    padding: 0 !important;
                    line-height: 1.2rem !important;
                    text-align: center !important;
                    vertical-align: middle !important;
                }
            }
            @keyframes bm-all-prices-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) {
                .bm-overview-marketplace-offer { transition: none; }
                .bm-detail-all-prices-refresh.is-loading .bm-detail-refresh-icon {
                    animation: none;
                }
            }
        `;
        document.documentElement.appendChild(style);
    };

    const getClientId = async () => {
        const key = globalThis.BM_EXTENSION_STORAGE_KEYS?.workerClientId ||
            'gm:brickmerge-worker-client-id-v1';
        const values = await chrome.storage.local.get(key);
        let clientId = String(values[key] || '').trim();
        if (!/^[a-f0-9-]{36}$/i.test(clientId)) {
            clientId = crypto.randomUUID();
            await chrome.storage.local.set({ [key]: clientId });
        }
        return clientId;
    };

    const requestJson = async (url, acceptedStatuses = [200]) => {
        const clientId = await getClientId();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    Accept: 'application/json',
                    'X-BM-Client-ID': clientId
                },
                timeout: 30000,
                onload: response => {
                    let payload = null;
                    try { payload = JSON.parse(response.responseText); } catch {}
                    if (acceptedStatuses.includes(response.status) && payload) {
                        resolve({ status: response.status, payload });
                    } else {
                        reject(new Error(`Preisabruf fehlgeschlagen (${response.status})`));
                    }
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Preisabruf Timeout'))
            });
        });
    };

    const delay = milliseconds => new Promise(resolve => {
        window.setTimeout(resolve, milliseconds);
    });

    const pollJob = async (workerBaseUrl, sourceState) => {
        let statusUrl = BM_resolveWorkerUrl(sourceState.statusUrl, workerBaseUrl);
        for (let attempt = 0; attempt < 60; attempt += 1) {
            const { status, payload } = await requestJson(statusUrl, [200, 202]);
            if (status === 200 && !payload.pending) return payload;
            statusUrl = BM_resolveWorkerUrl(
                payload.statusUrl || statusUrl,
                workerBaseUrl
            );
            await delay(Number(payload.pollAfterMs) || sourceState.pollAfterMs || 1800);
        }
        throw new Error('Preisaktualisierung dauert zu lange');
    };

    const refreshBundle = async (workerBaseUrl, data, sources, onSourceUpdate) => {
        const refresh = await requestJson(
            buildBundleUrl(workerBaseUrl, '/offers/refresh', data, sources)
        );
        const sourceEntries = Object.entries(refresh.payload.sources || {});
        const reportedSources = new Set();
        const reportSource = (source, state, payload = null, error = '') => {
            if (reportedSources.has(source)) return;
            if (!['ready', 'empty', 'error'].includes(state)) return;
            reportedSources.add(source);
            onSourceUpdate?.({ source, state, payload, error });
        };

        sourceEntries.forEach(([source, entry]) => {
            if (entry?.state === 'ready') {
                reportSource(source, 'ready', entry.data || entry.result || entry);
            } else if (entry?.state === 'empty') {
                reportSource(source, 'empty');
            } else if (entry?.state === 'error') {
                reportSource(source, 'error', null, entry.error || entry.message || '');
            }
        });

        const pending = sourceEntries
            .filter(([, entry]) => entry?.state === 'pending' && entry.statusUrl);
        await Promise.allSettled(pending.map(([source, entry]) =>
            pollJob(workerBaseUrl, entry).then(payload => {
                reportSource(source, payload?.found === false ? 'empty' : 'ready', payload);
                return payload;
            }).catch(error => {
                reportSource(source, 'error', null, String(error?.message || error));
                throw error;
            })
        ));

        const bundle = (await requestJson(
            buildBundleUrl(workerBaseUrl, '/offers/cache', data, sources)
        )).payload;
        sources.forEach(source => {
            if (reportedSources.has(source)) return;
            const entry = bundle?.sources?.[source];
            if (entry?.state === 'ready') {
                reportSource(source, 'ready', entry.data || entry.result || entry);
            } else if (entry?.state === 'empty') {
                reportSource(source, 'empty');
            } else {
                reportSource(
                    source,
                    'error',
                    null,
                    entry?.error || entry?.message || 'Kein Ergebnis empfangen'
                );
            }
        });
        return bundle;
    };

    const cacheDetail = offer => {
        const parts = [];
        if (offer.savedAt) {
            parts.push(`Stand: ${new Date(offer.savedAt).toLocaleString('de-DE')}`);
        }
        if (offer.cacheState) parts.push(`Cache: ${offer.cacheState}`);
        return parts.join(' · ');
    };

    const createDetailRefreshButton = () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
            'button small smallGreyButton bm-detail-all-prices-refresh ' +
            'bm-detail-action-button';
        button.innerHTML =
            '<span class="bm-detail-refresh-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" focusable="false">' +
            '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/>' +
            '<path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 9"/>' +
            '<path d="M5.5 15A7 7 0 0 0 17.8 17.8L20 15"/>' +
            '</svg></span>' +
            '<span class="bm-refresh-label">Preise</span>';
        button.title = 'Weitere Marktplätze gemeinsam abrufen.';
        button.setAttribute('aria-label', 'Weitere Marktplätze abrufen');
        return button;
    };

    const setRefreshButtonState = (button, state, error = '') => {
        button.classList.toggle('is-loading', state === 'loading');
        button.disabled = state === 'loading';
        const label = state === 'loading'
            ? 'Lädt …'
            : state === 'done'
                ? 'Geladen'
                : state === 'error'
                    ? 'Erneut'
                    : 'Preise';
        button.querySelector('.bm-refresh-label').textContent = label;
        button.title = state === 'loading'
            ? 'Weitere Marktplätze werden abgerufen'
            : state === 'done'
                ? 'Weitere Marktplätze wurden abgerufen'
                : state === 'error'
                    ? String(error || 'Preisaktualisierung fehlgeschlagen')
                    : 'Weitere Marktplätze gemeinsam abrufen.';
        button.setAttribute('aria-label', button.title);
    };

    const applyEffectiveCardPrice = (card, data, offers) => {
        const priceArea = card.querySelector('.productprice.productpricelist');
        const offerBox = priceArea?.querySelector('.offerbox') || priceArea;
        if (!priceArea || !offerBox) return null;
        const effective = selectEffectiveOffer(data, offers);
        if (!effective) {
            delete card.dataset.bmEffectivePrice;
            delete card.dataset.bmEffectiveSource;
            return null;
        }

        card.dataset.bmEffectivePrice = String(effective.total);
        card.dataset.bmEffectiveSource = effective.source;
        const discount = calculateDiscount(data.referencePrice, effective.total);
        if (discount) {
            card.dataset.bmEffectiveSavings = String(discount.savings);
            card.dataset.bmEffectiveDiscountPercent = String(discount.percentage);
        } else {
            delete card.dataset.bmEffectiveSavings;
            delete card.dataset.bmEffectiveDiscountPercent;
        }
        let price = offerBox.querySelector('.theprice');
        if (!price) {
            const prefix = document.createElement('span');
            prefix.className = 'bm-overview-effective-price';
            prefix.append('ab ');
            price = document.createElement('span');
            price.className = 'theprice';
            prefix.appendChild(price);
            offerBox.prepend(prefix);
        }
        price.textContent = `${formatEuro(effective.total)} €`;

        let lowPrice = priceArea.querySelector('meta[itemprop="lowPrice"]');
        if (!lowPrice) {
            lowPrice = document.createElement('meta');
            lowPrice.setAttribute('itemprop', 'lowPrice');
            offerBox.appendChild(lowPrice);
        }
        lowPrice.setAttribute('content', Number(effective.total).toFixed(2));

        applyDiscountDom(card, offerBox, discount, formatEuro);

        let source = offerBox.querySelector('.bm-overview-effective-source');
        if (effective.source === 'brickmerge') {
            source?.remove();
        } else {
            if (!source) {
                source = document.createElement('a');
                source.className = 'bm-overview-effective-source';
                source.target = '_blank';
                source.rel = 'noopener noreferrer';
                price.after(source);
            }
            source.href = effective.url;
            source.textContent = `bei ${effective.label}`;
            source.title = `${effective.label}-Angebot öffnen`;
        }
        return effective;
    };

    const sortOverviewCards = (cards, mode) => {
        if (!mode) return;
        const groups = new Map();
        cards.forEach(card => {
            if (!card.parentElement) return;
            if (!groups.has(card.parentElement)) groups.set(card.parentElement, []);
            groups.get(card.parentElement).push(card);
        });
        groups.forEach((groupCards, parent) => {
            const sorted = sortOverviewEntries(groupCards.map((card, index) => ({
                card,
                index,
                price: parsePrice(card.dataset.bmEffectivePrice),
                savings: parsePrice(card.dataset.bmEffectiveSavings),
                percentage: parsePrice(card.dataset.bmEffectiveDiscountPercent)
            })), mode).map(entry => entry.card);
            const first = groupCards[0];
            if (!first) return;
            const marker = document.createComment('bm-effective-price-sort');
            parent.insertBefore(marker, first);
            const fragment = document.createDocumentFragment();
            sorted.forEach(card => fragment.appendChild(card));
            marker.after(fragment);
            marker.remove();
            parent.querySelectorAll(':scope > .yeardivider').forEach(divider => {
                divider.hidden = true;
            });
        });
    };

    const renderCardBundle = (card, data, bundle, sources) => {
        const priceArea = card.querySelector('.productprice.productpricelist');
        if (!priceArea) return;
        const offerBox = priceArea.querySelector('.offerbox') || priceArea;
        let container = offerBox.querySelector('.bm-overview-marketplace-prices');
        if (!container) {
            container = document.createElement('div');
            container.className = 'bm-overview-marketplace-prices';
            offerBox.appendChild(container);
        }
        container.replaceChildren();
        const offers = selectBundleOffers(bundle, data)
            .filter(offer => sources.includes(offer.source));
        applyEffectiveCardPrice(card, data, offers);
        offers
            .forEach(offer => {
                const link = document.createElement('a');
                link.className = 'bm-overview-marketplace-offer';
                link.href = offer.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.title = [
                    offer.title || `${offer.label}-Angebot öffnen`,
                    cacheDetail(offer)
                ].filter(Boolean).join(' · ');
                const source = document.createElement('span');
                source.className = 'bm-overview-marketplace-source';
                source.textContent = offer.label;
                const price = document.createElement('strong');
                price.className = 'bm-overview-marketplace-price';
                price.textContent = `${formatEuro(offer.total)} €`;
                link.append(source, price);
                container.appendChild(link);
            });

        card.dataset.bmPriceLookupState = 'complete';
    };

    const extractDetailData = () => {
        const setNumber = cleanDigits(
            globalThis.BM_getBrickmergeSetNumber?.(location.href),
            3,
            7
        );
        const ean = cleanDigits(
            document.querySelector('.bm-ean-line-link[data-ean]')?.dataset.ean ||
            document.querySelector('meta[itemprop="gtin13"]')?.getAttribute('content') ||
            Array.from(document.querySelectorAll('.content.setdetails p'))
                .find(paragraph => /EAN\s*:/i.test(paragraph.textContent || ''))
                ?.textContent.match(/EAN\s*:\s*(\d{8}|\d{12,14})/i)?.[1],
            8,
            14
        );
        if (!setNumber || !ean) return null;
        const prices = Array.from(document.querySelectorAll(
            '#offerlist .pricerow:not([data-bm-marketplace="true"]) span.price'
        )).map(span => parsePrice(span.textContent)).filter(Number.isFinite);
        return {
            setNumber,
            ean,
            bestPrice: prices.length ? Math.min(...prices) : null
        };
    };

    const mountDetailRefresh = (settings, workerBaseUrl) => {
        const offerlist = document.getElementById('offerlist');
        const chartTrigger = document.getElementById('chartTrigger');
        const host = chartTrigger?.parentElement;
        if (!offerlist || !chartTrigger || !host) return false;
        const sources = buttonSources(settings);
        let button = document.querySelector('.bm-detail-all-prices-refresh');
        if (!button) {
            button = createDetailRefreshButton();
        }
        host.classList.add('bm-chart-controls', 'bm-has-price-refresh');
        const depotButton = host.querySelector(':scope > .bmd-open-button');
        const insertAfter = depotButton || chartTrigger;
        if (insertAfter.nextElementSibling !== button) {
            insertAfter.insertAdjacentElement('afterend', button);
        }
        if (button.dataset.bmRefreshBound !== 'true') {
            button.dataset.bmRefreshBound = 'true';
            button.addEventListener('click', async () => {
                const data = extractDetailData();
                if (!data) {
                    setRefreshButtonState(
                        button,
                        'error',
                        'Setnummer oder EAN konnte noch nicht gelesen werden.'
                    );
                    return;
                }
                if (sources.length === 0) {
                    setRefreshButtonState(
                        button,
                        'error',
                        'In den Einstellungen ist kein weiterer Marktplatz aktiviert.'
                    );
                    return;
                }
                setRefreshButtonState(button, 'loading');
                const completedSources = new Set();
                const handleSourceUpdate = update => {
                    if (!update?.source || completedSources.has(update.source)) return;
                    completedSources.add(update.source);
                    const label = button.querySelector('.bm-refresh-label');
                    if (label) {
                        label.textContent = `${completedSources.size}/${sources.length}`;
                    }
                    if (update.state === 'ready') {
                        document.dispatchEvent(new CustomEvent(
                            'bm-marketplace-source-update',
                            {
                                detail: {
                                    setNumber: data.setNumber,
                                    source: update.source,
                                    state: update.state,
                                    payload: update.payload
                                }
                            }
                        ));
                    }
                };
                try {
                    await refreshBundle(
                        workerBaseUrl,
                        data,
                        sources,
                        handleSourceUpdate
                    );
                    setRefreshButtonState(button, 'done');
                } catch (error) {
                    setRefreshButtonState(
                        button,
                        'error',
                        String(error?.message || error)
                    );
                }
            });
        }
        return true;
    };

    const start = settings => {
        const workerBaseUrl = globalThis.BM_WORKER_DEFAULT_BASE_URL;
        const detailSet = globalThis.BM_getBrickmergeSetNumber?.(location.href);
        if (detailSet) {
            ensureStyles();
            let observer = null;
            const tryMount = () => {
                if (mountDetailRefresh(settings, workerBaseUrl)) {
                    return true;
                }
                return false;
            };
            tryMount();
            observer = new MutationObserver(() => tryMount());
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
            [250, 750, 1800].forEach(delay => window.setTimeout(tryMount, delay));
            window.setTimeout(() => observer?.disconnect(), 15000);
            return;
        }

        if (settings.overviewPriceBadges === false) return;
        ensureStyles();
        const sources = enabledSources(settings);

        const productRow = document.getElementById('productrow');
        if (!productRow) return;
        const limit = createLimiter(CONCURRENCY);
        const overviewSortMode = getOverviewSortMode(location.href);
        const debug = globalThis.BM_OVERVIEW_PRICE_DEBUG = {
            observed: 0,
            valid: 0,
            cacheRequests: 0,
            errors: 0
        };

        const loadCard = card => limit(async () => {
            if (card.dataset.bmPriceLookupDone === 'true' ||
                card.dataset.bmPriceLookupState === 'loading') return;
            card.dataset.bmPriceLookupState = 'loading';
            const data = extractCardData(card);
            if (!data) {
                card.dataset.bmPriceLookupDone = 'true';
                card.dataset.bmPriceLookupState = 'invalid-gtin';
                return;
            }
            applyEffectiveCardPrice(card, data, []);
            debug.valid += 1;
            debug.cacheRequests += 1;
            try {
                const bundle = (await requestJson(
                    buildBundleUrl(workerBaseUrl, '/offers/cache', data, sources)
                )).payload;
                renderCardBundle(card, data, bundle, sources);
            } catch (error) {
                debug.errors += 1;
                card.dataset.bmPriceLookupState = 'error';
                console.debug('Brickmerge Tools DB: Cache konnte nicht gelesen werden.', error);
            } finally {
                card.dataset.bmPriceLookupDone = 'true';
            }
        });

        const observer = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    observer.unobserve(entry.target);
                    void loadCard(entry.target);
                });
            }, { rootMargin: '700px 0px', threshold: 0.01 })
            : null;

        const observeCards = root => {
            const cards = [];
            if (root?.matches?.(CARD_SELECTOR)) cards.push(root);
            root?.querySelectorAll?.(CARD_SELECTOR).forEach(card => cards.push(card));
            cards.forEach(card => {
                if (card.dataset.bmPriceObserved === 'true') return;
                card.dataset.bmPriceObserved = 'true';
                debug.observed += 1;
                if (observer) observer.observe(card);
                else void loadCard(card);
            });
        };

        const loadAndSortCards = root => {
            const cards = [];
            if (root?.matches?.(CARD_SELECTOR)) cards.push(root);
            root?.querySelectorAll?.(CARD_SELECTOR).forEach(card => cards.push(card));
            const newCards = cards.filter(card =>
                card.dataset.bmPriceObserved !== 'true'
            );
            if (newCards.length === 0) return;
            const pending = newCards.map(card => {
                card.dataset.bmPriceObserved = 'true';
                debug.observed += 1;
                return loadCard(card);
            });
            void Promise.allSettled(pending).then(() => {
                sortOverviewCards(
                    Array.from(document.querySelectorAll(CARD_SELECTOR)),
                    overviewSortMode
                );
            });
        };

        if (overviewSortMode) loadAndSortCards(document);
        else observeCards(document);
        new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (overviewSortMode) loadAndSortCards(node);
                    else observeCards(node);
                });
            });
        }).observe(productRow, { childList: true, subtree: true });
    };

    chrome.storage.local.get('settings').then(({ settings }) => {
        start(globalThis.BM_mergeSettings(settings));
    }).catch(error => {
        console.debug('Brickmerge Tools DB: Marktplatzmodul konnte nicht starten.', error);
    });
})();
