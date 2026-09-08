(() => {
    'use strict';

    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const validSet = value => /^\d{3,7}$/.test(value) &&
        !/^(?:19|20)\d{2}$/.test(value);
    const fiveDigitSet = value => normalize(value).match(/(?:^|[^\d])(\d{5})(?!\d)/)?.[1] || '';
    const validGtin13 = value => {
        const digits = String(value || '').replace(/\D/g, '');
        if (!/^\d{13}$/.test(digits)) return false;
        const sum = digits.slice(0, 12).split('').reduce((total, digit, index) =>
            total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
        return (10 - (sum % 10)) % 10 === Number(digits[12]);
    };

    const detect = (documentValue, locationValue) => {
        const values = selector => Array.from(
            documentValue.querySelectorAll(selector)
        ).flatMap(element => [
            element.getAttribute('content'),
            element.getAttribute('value'),
            element.textContent
        ]).map(normalize).filter(Boolean);
        const products = [];
        const visit = value => {
            if (Array.isArray(value)) return value.forEach(visit);
            if (!value || typeof value !== 'object') return;
            const types = Array.isArray(value['@type'])
                ? value['@type']
                : [value['@type']];
            if (types.includes('Product')) products.push(value);
            if (value['@graph']) visit(value['@graph']);
        };
        for (const script of documentValue.querySelectorAll(
            'script[type="application/ld+json"]'
        )) {
            try { visit(JSON.parse(script.textContent)); } catch {}
        }

        const product = products.find(entry => /\bLEGO\b/i.test(
            normalize(entry?.brand?.name || entry?.brand) + ' ' +
            normalize(entry?.name)
        )) || products[0] || {};
        const productTitle = normalize(
            documentValue.querySelector('#productTitle')?.textContent ||
            documentValue.querySelector('#title')?.textContent ||
            documentValue.querySelector('h1#title')?.textContent
        );
        const heading = normalize(documentValue.querySelector('h1')?.textContent);
        const title = normalize(documentValue.title);
        const pageName = normalize(
            product.name || productTitle ||
            documentValue.querySelector('h1')?.textContent || documentValue.title
        );
        const brand = normalize(product?.brand?.name || product?.brand);
        const decodedUrl = (() => {
            try {
                return decodeURIComponent(`${locationValue.pathname} ${locationValue.search}`);
            } catch {
                return `${locationValue.pathname} ${locationValue.search}`;
            }
        })();
        const sourceText = `${decodedUrl} ${title} ${heading}`;
        const pageLooksLikeLego = /\bLEGO(?:®)?\b/i.test(
            `${sourceText} ${pageName} ${brand}`
        );
        const isBrickmergePage = /(?:^|\.)brickmerge\.de$/i.test(
            locationValue.hostname
        );
        const metadataSets = pageLooksLikeLego
            ? [
                product.mpn,
                ...values(
                    'meta[itemprop="mpn"], ' +
                    'meta[property="product:retailer_item_id"], [itemprop="mpn"]'
                )
            ]
            : [];

        const urlLegoSet = pageLooksLikeLego
            ? decodedUrl.match(/\blego\b[^\w%&+=/]{0,6}(\d{3,7})\b/i)?.[1] ||
              decodedUrl.match(/\b(\d{3,7})\b[^\w%&+=/]{0,6}\blego\b/i)?.[1] || ''
            : '';
        const searchParamSet = (pageLooksLikeLego || isBrickmergePage)
            ? locationValue.search.match(
                /[?&](?:find|q|query|search(?:_text|_query|term)?|k(?:eywords?)?|_nkw|s)=[^&]*?\b(\d{3,7})\b/i
            )?.[1] || ''
            : '';
        const bmUrlSet = isBrickmergePage
            ? locationValue.pathname.match(/\/(\d{3,7})-\d+/)?.[1] || ''
            : '';

        const setCandidates = [
            bmUrlSet,
            urlLegoSet,
            searchParamSet,
            pageLooksLikeLego
                ? fiveDigitSet(productTitle) || fiveDigitSet(title) ||
                    fiveDigitSet(sourceText)
                : '',
            pageName.match(/\bLEGO(?:®)?\D{0,24}(\d{3,7})\b/i)?.[1],
            ...metadataSets
        ].map(normalize).filter(validSet);
        const eanCandidates = [
            product.gtin13,
            product.gtin,
            ...values(
                'meta[itemprop="gtin13"], meta[property="product:ean"], ' +
                '[itemprop="gtin13"]'
            )
        ].map(value => normalize(value).replace(/\D/g, ''))
            .filter(validGtin13);

        if (!setCandidates[0] && pageLooksLikeLego) {
            const text = normalize(documentValue.body?.innerText).slice(0, 180000);
            const set = text.match(/\bLEGO(?:®)?\D{0,24}(\d{3,7})\b/i)?.[1];
            if (validSet(set || '')) setCandidates.push(set);
            const ean = text.match(/\b(?:EAN|GTIN)\D{0,10}(\d{13})\b/i)?.[1];
            if (validGtin13(ean || '')) eanCandidates.push(ean);
        }

        const setNumber = setCandidates[0] || '';
        const ean = eanCandidates.find(value => value.startsWith('570201')) ||
            eanCandidates[0] || '';
        if (!setNumber && !ean) return null;

        let displayName = pageName;
        if ((!displayName || /^(?:Artikel|Katalog|Suche|Search|Catalog)$/i.test(displayName)) && setNumber) {
            displayName = `LEGO ${setNumber}`;
        }

        return {
            setNumber,
            ean,
            name: displayName,
            url: locationValue.href,
            hostname: locationValue.hostname
        };
    };

    const api = Object.freeze({ validSet, validGtin13, fiveDigitSet, detect });
    globalThis.BM_PAGE_PRODUCT_DETECTOR = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (typeof document === 'undefined' || typeof chrome === 'undefined' ||
        !chrome.runtime?.sendMessage) return;

    let lastSignature = '';
    const report = force => {
        const product = detect(document, location);
        const signature = JSON.stringify(product);
        if (force || signature !== lastSignature) {
            lastSignature = signature;
            void chrome.runtime.sendMessage({
                type: 'bm-page-product-detected',
                product
            }).catch(() => {});
        }
        return product;
    };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'bm-detect-page-now') return false;
        sendResponse({ product: report(true) });
        return false;
    });

    report(true);
    window.setTimeout(() => report(false), 1500);
    window.setTimeout(() => report(false), 5000);
    window.setTimeout(() => report(false), 12000);
    window.addEventListener('pageshow', () => report(false));
    const titleElement = document.querySelector('title');
    if (titleElement && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => report(false)).observe(titleElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    const hookHistory = method => {
        try {
            const original = history[method];
            if (typeof original !== 'function') return;
            history[method] = function(...args) {
                const result = original.apply(this, args);
                window.setTimeout(() => report(false), 50);
                return result;
            };
        } catch {}
    };
    hookHistory('pushState');
    hookHistory('replaceState');
    window.addEventListener('popstate', () => {
        window.setTimeout(() => report(false), 50);
    });

    let lastReportedUrl = location.href;
    window.setInterval(() => {
        if (location.href !== lastReportedUrl) {
            lastReportedUrl = location.href;
            report(false);
        }
    }, 1000);
})();
