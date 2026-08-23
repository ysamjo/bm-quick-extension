(() => {
    'use strict';

    const core = globalThis.BM_SIDE_PANEL_CORE;
    const elements = Object.fromEntries([
        'page-host', 'status-card', 'status-text', 'manual-form', 'manual-query',
        'product', 'product-image', 'product-name', 'set-number', 'ean-row',
        'ean', 'brickmerge-price', 'brickmerge-discount', 'brickmerge-link',
        'offers-section', 'cache-summary', 'offers', 'refresh-offers',
        'links-section', 'marketplace-links', 'rescan'
    ].map(id => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
        document.getElementById(id)]));

    let currentProduct = null;
    let currentSettings = null;
    let activeTabId = null;
    let loadSequence = 0;
    let rescanTimer = null;

    const formatEuro = value => Number(value).toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + ' €';

    const setStatus = (text, state = 'loading') => {
        elements.statusText.textContent = text;
        elements.statusCard.classList.toggle('is-error', state === 'error');
        elements.statusCard.classList.toggle('is-done', state === 'done');
        elements.statusCard.hidden = !text;
    };

    const getClientId = async () => {
        const key = globalThis.BM_EXTENSION_STORAGE_KEYS.workerClientId;
        const stored = await chrome.storage.local.get(key);
        if (typeof stored[key] === 'string' && stored[key]) return stored[key];
        const clientId = crypto.randomUUID();
        await chrome.storage.local.set({ [key]: clientId });
        return clientId;
    };

    const workerRequest = async (url, acceptedStatuses = [200]) => {
        const clientId = await getClientId();
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'X-BM-Client-ID': clientId },
            cache: 'no-store',
            credentials: 'omit'
        });
        let payload = null;
        try { payload = await response.json(); } catch {}
        if (!acceptedStatuses.includes(response.status) || !payload) {
            throw new Error(payload?.error || `Preisabruf fehlgeschlagen (${response.status})`);
        }
        return { status: response.status, payload };
    };

    const findProductJson = value => {
        if (Array.isArray(value)) {
            for (const entry of value) {
                const found = findProductJson(entry);
                if (found) return found;
            }
        } else if (value && typeof value === 'object') {
            const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
            if (types.includes('Product')) return value;
            if (value['@graph']) return findProductJson(value['@graph']);
        }
        return null;
    };

    const parseBrickmergeProduct = (html, finalUrl) => {
        const documentValue = new DOMParser().parseFromString(html, 'text/html');
        let productJson = null;
        for (const script of documentValue.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                productJson = findProductJson(JSON.parse(script.textContent));
                if (productJson) break;
            } catch {}
        }
        const canonical = documentValue.querySelector('link[rel="canonical"]')?.href ||
            productJson?.url || finalUrl;
        const uvpText = documentValue.querySelector('[title="unverbindliche Preisempfehlung"]')?.textContent || '';
        return core.normalizeBrickmergeProduct({
            productJson,
            canonical,
            finalUrl,
            setNumber: documentValue.querySelector('meta[itemprop="mpn"]')?.content,
            ean: documentValue.querySelector('meta[itemprop="gtin13"]')?.content,
            name: documentValue.querySelector('meta[property="og:title"]')?.content,
            image: documentValue.querySelector('meta[property="og:image"]')?.content,
            bestPrice: documentValue.querySelector('meta[itemprop="lowPrice"]')?.content,
            referencePrice: uvpText.replace(/^.*?UVP/i, '')
        });
    };

    const lookupBrickmerge = async query => {
        const url = new URL('https://www.brickmerge.de/');
        url.searchParams.set('find', String(query).trim());
        const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
        if (!response.ok) throw new Error(`Brickmerge antwortet mit HTTP ${response.status}`);
        return parseBrickmergeProduct(await response.text(), response.url);
    };

    function detectLegoProductPage() {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
        const validSet = value => /^\d{3,7}$/.test(value) && !/^(?:19|20)\d{2}$/.test(value);
        const validGtin = value => {
            if (!/^\d{13}$/.test(value)) return false;
            const sum = value.slice(0, 12).split('').reduce((total, digit, index) =>
                total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
            return (10 - (sum % 10)) % 10 === Number(value[12]);
        };
        const values = selector => Array.from(document.querySelectorAll(selector))
            .flatMap(element => [
                element.getAttribute('content'),
                element.getAttribute('value'),
                element.textContent
            ]).map(normalize).filter(Boolean);
        const productObjects = [];
        const visit = value => {
            if (Array.isArray(value)) return value.forEach(visit);
            if (!value || typeof value !== 'object') return;
            const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
            if (types.includes('Product')) productObjects.push(value);
            if (value['@graph']) visit(value['@graph']);
        };
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try { visit(JSON.parse(script.textContent)); } catch {}
        }
        const jsonProduct = productObjects[0] || {};
        const setCandidates = [
            jsonProduct.mpn,
            ...values('meta[itemprop="mpn"], meta[property="product:retailer_item_id"], [itemprop="mpn"]'),
            location.pathname.match(/\/(\d{3,7})-\d+_/)?.[1],
            location.search.match(/[?&](?:find|q|query|search)=.*?\b(\d{3,7})\b/i)?.[1],
            document.title.match(/\bLEGO\D{0,18}(\d{3,7})\b/i)?.[1],
            document.querySelector('h1')?.textContent?.match(/\b(\d{3,7})\b/)?.[1]
        ].map(normalize).filter(validSet);
        const eanCandidates = [
            jsonProduct.gtin13,
            jsonProduct.gtin,
            ...values('meta[itemprop="gtin13"], meta[property="product:ean"], [itemprop="gtin13"]')
        ].map(value => normalize(value).replace(/\D/g, '')).filter(validGtin);
        if (!setCandidates[0] && !eanCandidates[0]) {
            const text = normalize(document.body?.innerText).slice(0, 220000);
            const legoSet = text.match(/\bLEGO(?:®)?\D{0,24}(\d{3,7})\b/i)?.[1];
            if (validSet(legoSet || '')) setCandidates.push(legoSet);
            const ean = text.match(/\b(?:EAN|GTIN)\D{0,10}(\d{13})\b/i)?.[1];
            if (validGtin(ean || '')) eanCandidates.push(ean);
        }
        return {
            setNumber: setCandidates[0] || '',
            ean: eanCandidates.find(value => value.startsWith('570201')) || eanCandidates[0] || '',
            name: normalize(jsonProduct.name || document.querySelector('h1')?.textContent || document.title),
            hostname: location.hostname,
            url: location.href
        };
    }

    const detectActivePage = async tab => {
        if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) return null;
        const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: detectLegoProductPage
        });
        return result || null;
    };

    const renderMarketplaceLinks = setNumber => {
        elements.marketplaceLinks.replaceChildren();
        for (const link of core.buildMarketplaceLinks(
            setNumber,
            currentSettings?.linkRows?.france === true
        )) {
            const anchor = document.createElement('a');
            anchor.className = 'marketplace-link';
            anchor.href = link.url;
            anchor.textContent = `${link.label} ↗`;
            anchor.addEventListener('click', event => {
                event.preventDefault();
                chrome.tabs.create({ url: link.url });
            });
            elements.marketplaceLinks.appendChild(anchor);
        }
        elements.linksSection.hidden = false;
    };

    const renderProduct = product => {
        currentProduct = product;
        elements.product.hidden = false;
        elements.productName.textContent = product.name || `LEGO Set ${product.setNumber}`;
        elements.setNumber.textContent = product.setNumber;
        elements.ean.textContent = product.ean || 'nicht gefunden';
        elements.eanRow.hidden = !product.ean;
        elements.productImage.hidden = !product.image;
        if (product.image) {
            elements.productImage.src = product.image;
            elements.productImage.alt = product.name || `LEGO Set ${product.setNumber}`;
        } else {
            elements.productImage.removeAttribute('src');
        }
        elements.brickmergePrice.textContent = product.bestPrice
            ? formatEuro(product.bestPrice)
            : 'nicht verfügbar';
        const discount = core.calculateDiscount(product.referencePrice, product.bestPrice);
        elements.brickmergeDiscount.hidden = discount === null;
        elements.brickmergeDiscount.textContent = discount === null ? '' : `${discount}%`;
        elements.brickmergeLink.href = product.detailUrl;
        elements.offersSection.hidden = !product.ean;
        renderMarketplaceLinks(product.setNumber);
    };

    const renderOffers = bundle => {
        elements.offers.replaceChildren();
        const offers = core.offersFromBundle(bundle, currentProduct);
        for (const offer of offers) {
            const anchor = document.createElement('a');
            anchor.className = 'offer-row';
            anchor.href = offer.url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.title = offer.title || `${offer.label} öffnen`;
            const label = document.createElement('span');
            label.className = 'offer-label';
            label.textContent = offer.label;
            const price = document.createElement('span');
            price.className = 'offer-price';
            price.textContent = formatEuro(offer.total);
            anchor.append(label, price);
            elements.offers.appendChild(anchor);
        }
        if (offers.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-offers';
            empty.textContent = 'Noch keine passenden Preise im Cache.';
            elements.offers.appendChild(empty);
        }
        const selected = core.enabledSources(currentSettings);
        const missingCount = selected.filter(source =>
            bundle?.sources?.[source]?.state !== 'ready'
        ).length;
        elements.cacheSummary.textContent = offers.length > 0
            ? `${offers.length} Quelle${offers.length === 1 ? '' : 'n'} · ${missingCount} nicht im Cache`
            : `${missingCount} Quellen noch nicht im Cache`;
    };

    const loadCache = async sequence => {
        if (!currentProduct?.ean || sequence !== loadSequence) return;
        const sources = core.enabledSources(currentSettings);
        const baseUrl = globalThis.BM_normalizeWorkerBaseUrl();
        const { payload } = await workerRequest(core.buildBundleUrl(
            baseUrl,
            '/offers/cache',
            currentProduct,
            sources
        ));
        if (sequence !== loadSequence) return;
        renderOffers(payload);
    };

    const showManualSearch = message => {
        elements.manualForm.hidden = false;
        setStatus(message, 'done');
    };

    const loadQuery = async (query, sequence, detected = null) => {
        setStatus('Brickmerge-Produktdaten werden geladen …');
        let product = null;
        try { product = await lookupBrickmerge(query); } catch {}
        if (sequence !== loadSequence) return;
        if (!product && detected?.setNumber && detected?.ean) {
            product = {
                setNumber: detected.setNumber,
                ean: detected.ean,
                name: detected.name || `LEGO Set ${detected.setNumber}`,
                image: '',
                bestPrice: null,
                referencePrice: null,
                detailUrl: `https://www.brickmerge.de/?find=${encodeURIComponent(detected.setNumber)}`
            };
        }
        if (!product) {
            showManualSearch('Kein eindeutiges LEGO-Set gefunden.');
            return;
        }
        elements.manualForm.hidden = true;
        renderProduct(product);
        setStatus('Cachewerte werden geladen …');
        try {
            await loadCache(sequence);
            if (sequence === loadSequence) setStatus('Aktuelle Seite erkannt.', 'done');
        } catch (error) {
            if (sequence === loadSequence) {
                setStatus(`Cache nicht erreichbar: ${error.message}`, 'error');
                renderOffers(null);
            }
        }
    };

    const loadActiveTab = async () => {
        const sequence = ++loadSequence;
        currentProduct = null;
        elements.product.hidden = true;
        elements.offersSection.hidden = true;
        elements.linksSection.hidden = true;
        elements.manualForm.hidden = true;
        setStatus('Aktive Seite wird geprüft …');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (sequence !== loadSequence) return;
        activeTabId = tab?.id || null;
        let hostname = 'Keine normale Webseite';
        try { hostname = new URL(tab?.url || '').hostname || hostname; } catch {}
        elements.pageHost.textContent = hostname;
        let detected = null;
        try { detected = await detectActivePage(tab); } catch {}
        if (sequence !== loadSequence) return;
        if (!detected?.setNumber && !detected?.ean) {
            showManualSearch('Auf dieser Seite wurde kein LEGO-Set erkannt.');
            return;
        }
        await loadQuery(detected.setNumber || detected.ean, sequence, detected);
    };

    const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

    const pollJob = async (baseUrl, entry) => {
        let statusUrl = globalThis.BM_resolveWorkerUrl(entry.statusUrl, baseUrl);
        for (let attempt = 0; attempt < 60; attempt += 1) {
            const response = await workerRequest(statusUrl, [200, 202]);
            if (response.status === 200 && !response.payload.pending) return;
            statusUrl = globalThis.BM_resolveWorkerUrl(
                response.payload.statusUrl || statusUrl,
                baseUrl
            );
            await delay(Number(response.payload.pollAfterMs) || entry.pollAfterMs || 1800);
        }
        throw new Error('Preisaktualisierung dauert zu lange.');
    };

    const refreshOffers = async () => {
        if (!currentProduct?.ean || elements.refreshOffers.disabled) return;
        const sequence = loadSequence;
        const sources = core.enabledSources(currentSettings);
        const baseUrl = globalThis.BM_normalizeWorkerBaseUrl();
        elements.refreshOffers.disabled = true;
        elements.refreshOffers.classList.add('is-loading');
        elements.refreshOffers.querySelector('.refresh-label').textContent =
            'Weitere Marktplätze werden abgerufen …';
        setStatus('Marktplätze werden aktualisiert …');
        try {
            const refresh = await workerRequest(core.buildBundleUrl(
                baseUrl,
                '/offers/refresh',
                currentProduct,
                sources
            ));
            const pending = Object.values(refresh.payload.sources || {})
                .filter(entry => entry?.state === 'pending' && entry.statusUrl);
            await Promise.allSettled(pending.map(entry => pollJob(baseUrl, entry)));
            if (sequence !== loadSequence) return;
            await loadCache(sequence);
            setStatus('Weitere Marktplätze wurden geladen.', 'done');
        } catch (error) {
            if (sequence === loadSequence) {
                setStatus(`Preisaktualisierung fehlgeschlagen: ${error.message}`, 'error');
            }
        } finally {
            elements.refreshOffers.disabled = false;
            elements.refreshOffers.classList.remove('is-loading');
            elements.refreshOffers.querySelector('.refresh-label').textContent =
                'Weitere Marktplätze abrufen';
        }
    };

    const init = async () => {
        const stored = await chrome.storage.local.get('settings');
        currentSettings = globalThis.BM_mergeSettings(stored.settings);
        await loadActiveTab();
    };

    elements.manualForm.addEventListener('submit', event => {
        event.preventDefault();
        const query = elements.manualQuery.value.replace(/\s+/g, ' ').trim();
        if (!query) return;
        const sequence = ++loadSequence;
        void loadQuery(query, sequence);
    });
    elements.rescan.addEventListener('click', () => void loadActiveTab());
    elements.refreshOffers.addEventListener('click', () => void refreshOffers());
    elements.brickmergeLink.addEventListener('click', event => {
        event.preventDefault();
        if (currentProduct?.detailUrl) chrome.tabs.create({ url: currentProduct.detailUrl });
    });
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', async () => {
            const value = button.dataset.copy === 'ean'
                ? currentProduct?.ean
                : currentProduct?.setNumber;
            if (!value) return;
            await navigator.clipboard.writeText(value);
            const original = button.textContent;
            button.textContent = '✓';
            setTimeout(() => { button.textContent = original; }, 900);
        });
    });
    chrome.tabs.onActivated.addListener(() => {
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => void loadActiveTab(), 120);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (tabId !== activeTabId || changeInfo.status !== 'complete') return;
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => void loadActiveTab(), 180);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        currentSettings = globalThis.BM_mergeSettings(changes.settings.newValue);
        if (currentProduct) {
            renderMarketplaceLinks(currentProduct.setNumber);
            void loadCache(loadSequence);
        }
    });

    void init();
})();
