// ==UserScript==
// @name         Brickmerge Tweaker
// @namespace    https://brickmerge.de/
// @version      2.3
// @description  Optimiert Brickmerge mit Preisvergleich, persönlichen Rabatten, Marktplatzlinks und Zusatzinformationen.
// @match        https://www.brickmerge.de/*
// @match        https://brickmerge.de/*
// @match        https://chatgpt.com/g/g-LZvgtoTB9-meta-preisvergleich-gpt*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      www.bricklink.com
// @connect      mybrickdepot.de
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/ysamjo/bm-quick-extension/main/brickmerge-tweaks.js
// @downloadURL  https://raw.githubusercontent.com/ysamjo/bm-quick-extension/main/brickmerge-tweaks.js
// ==/UserScript==

(function () {
    'use strict';

    const META_GPT_PATH = '/g/g-LZvgtoTB9-meta-preisvergleich-gpt';
    const META_GPT_URL = `https://chatgpt.com${META_GPT_PATH}`;
    const META_GPT_PENDING_KEY = 'brickmerge-meta-gpt-pending-v1';
    const META_GPT_LAST_SUBMITTED_KEY = 'brickmerge-meta-gpt-last-submitted-v1';
    const META_GPT_MAX_PENDING_AGE = 10 * 60 * 1000;

    const setMetaGptValue = (key, value) =>
        Promise.resolve(GM_setValue(key, value));
    const getMetaGptValue = (key, fallback = null) =>
        Promise.resolve(GM_getValue(key, fallback));
    const deleteMetaGptValue = key =>
        Promise.resolve(GM_deleteValue(key));

    function waitForMetaGptElement(getElement, timeout = 60000) {
        return new Promise(resolve => {
            const immediate = getElement();
            if (immediate) {
                resolve(immediate);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = getElement();
                if (!element) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve(element);
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true
            });
            const timer = window.setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    function waitForPendingMetaGptTransfer(timeout = 10000) {
        return new Promise(resolve => {
            const startedAt = Date.now();
            const check = async () => {
                const transfer = await getMetaGptValue(META_GPT_PENDING_KEY);
                if (transfer?.id && transfer.prompt && transfer.createdAt) {
                    resolve(transfer);
                    return;
                }
                if (Date.now() - startedAt >= timeout) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 100);
            };
            void check();
        });
    }

    function findMetaGptPromptEditor() {
        return document.querySelector(
            '#prompt-textarea[contenteditable="true"], ' +
            'textarea#prompt-textarea, ' +
            'form textarea, ' +
            '[contenteditable="true"][data-lexical-editor="true"]'
        );
    }

    function fillMetaGptPromptEditor(editor, prompt) {
        editor.focus();

        if (editor instanceof HTMLTextAreaElement) {
            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            valueSetter?.call(editor, prompt);
        } else {
            document.execCommand('selectAll', false, null);
            const inserted = document.execCommand('insertText', false, prompt);
            if (!inserted || editor.textContent.trim() !== prompt) {
                const paragraph = document.createElement('p');
                paragraph.textContent = prompt;
                editor.replaceChildren(paragraph);
            }
        }

        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: prompt
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findMetaGptSendButton() {
        const directButton = document.querySelector(
            'button[data-testid="send-button"], ' +
            'button[data-testid="fruitjuice-send-button"]'
        );
        if (directButton) return directButton;

        return Array.from(document.querySelectorAll('form button')).find(button => {
            const label = [
                button.getAttribute('aria-label'),
                button.getAttribute('title')
            ].filter(Boolean).join(' ');
            return /send|senden|absenden/i.test(label);
        }) || null;
    }

    async function runMetaGptTransfer() {
        const transfer = await waitForPendingMetaGptTransfer();
        if (!transfer) return;
        if (Date.now() - transfer.createdAt > META_GPT_MAX_PENDING_AGE) {
            await deleteMetaGptValue(META_GPT_PENDING_KEY);
            return;
        }

        const lastSubmittedId = await getMetaGptValue(
            META_GPT_LAST_SUBMITTED_KEY
        );
        if (lastSubmittedId === transfer.id) {
            await deleteMetaGptValue(META_GPT_PENDING_KEY);
            return;
        }

        const editor = await waitForMetaGptElement(findMetaGptPromptEditor);
        if (!editor) return;
        fillMetaGptPromptEditor(editor, transfer.prompt);

        const sendButton = await waitForMetaGptElement(() => {
            const button = findMetaGptSendButton();
            return button && !button.disabled ? button : null;
        }, 15000);
        if (!sendButton) return;

        await setMetaGptValue(META_GPT_LAST_SUBMITTED_KEY, transfer.id);
        await deleteMetaGptValue(META_GPT_PENDING_KEY);
        sendButton.click();
    }

    if (location.pathname.startsWith(META_GPT_PATH)) {
        void runMetaGptTransfer();
        return;
    }

    // ==========================================
    // CONFIG
    // ==========================================
    const CONFIG = {
        // Rabattsatz (0-1) je Händler, der nach Gutschein-/Membercode effektiv gilt.
        // Die Brickmerge-Händler-ID (mid) ist das Hauptmerkmal. Dadurch werden
        // gleichnamige Länder-Shops wie amazon (ES) oder Thalia.at nicht verwechselt.
        // Die aliases dienen nur als exakter Fallback, falls Brickmerge die mid-
        // Kennung einmal nicht ausliefert.
        retailerDiscounts: {
            "lego.com": {
                label: "LEGO",
                mid: "3",
                rate: 0.1405,
                aliases: ["LEGO"]
            },
            "mueller.de": {
                label: "Müller",
                mid: "335",
                rate: 0.11,
                aliases: ["MÜLLER", "Mueller"]
            },
            "thalia.de": {
                label: "Thalia",
                mid: "331",
                rate: 0.10,
                aliases: ["Thalia"]
            },
            "amazon.de": {
                label: "Amazon",
                mid: "1",
                rate: 0.05,
                aliases: ["amazon"]
            }
        }
    };
    const LEGACY_RETAILER_SETTINGS_KEY = 'brickmerge-toolkit-retailer-discounts-v1';
    const PERSONAL_DISCOUNT_SETTINGS_KEY = 'brickmerge-toolkit-personal-discounts-v2';

    function getRetailerCatalog() {
        const catalog = new Map();
        Object.entries(CONFIG.retailerDiscounts).forEach(([key, discount]) => {
            catalog.set(key, { ...discount, key, isDefault: true });
        });

        document.querySelectorAll(
            '#offerlist .medium-4.small-9.columns.pricerow[data-mid]'
        ).forEach(priceRow => {
            const mid = priceRow.dataset.mid;
            const priceSpan = priceRow.querySelector('.price');
            if (!mid || !priceSpan) return;

            const knownEntry = Object.entries(CONFIG.retailerDiscounts)
                .find(([, discount]) => String(discount.mid) === String(mid));
            const key = knownEntry?.[0] || `mid:${mid}`;
            const knownDiscount = knownEntry?.[1];
            const label = getOfferMerchantName(priceSpan) ||
                knownDiscount?.label ||
                `Händler ${mid}`;

            catalog.set(key, {
                key,
                label,
                mid,
                rate: knownDiscount?.rate || 0,
                aliases: knownDiscount?.aliases || [label],
                isDefault: Boolean(knownDiscount)
            });
        });

        return Array.from(catalog.entries()).sort(([, a], [, b]) =>
            a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })
        );
    }

    function getDefaultPersonalDiscountSettings() {
        const retailers = Object.fromEntries(
            getRetailerCatalog().map(([key, discount]) => [
                key,
                {
                    enabled: discount.isDefault,
                    percent: discount.isDefault
                        ? Math.round(discount.rate * 10000) / 100
                        : 0
                }
            ])
        );
        return { enabled: true, retailers };
    }

    function loadPersonalDiscountSettings() {
        const defaults = getDefaultPersonalDiscountSettings();
        try {
            const stored = JSON.parse(
                localStorage.getItem(PERSONAL_DISCOUNT_SETTINGS_KEY) || 'null'
            );
            const legacy = JSON.parse(
                localStorage.getItem(LEGACY_RETAILER_SETTINGS_KEY) || '{}'
            );
            const savedRetailers = stored?.retailers || legacy;

            Object.entries(defaults.retailers).forEach(([key, fallback]) => {
                const candidate = savedRetailers?.[key];
                if (!candidate || typeof candidate !== 'object') return;

                const percent = Number(candidate.percent);
                defaults.retailers[key] = {
                    enabled: candidate.enabled !== false,
                    percent: Number.isFinite(percent)
                        ? Math.min(100, Math.max(0, percent))
                    : fallback.percent
                };
            });
            Object.entries(savedRetailers || {}).forEach(([key, candidate]) => {
                if (defaults.retailers[key] || !candidate || typeof candidate !== 'object') return;
                const percent = Number(candidate.percent);
                defaults.retailers[key] = {
                    enabled: candidate.enabled === true,
                    percent: Number.isFinite(percent)
                        ? Math.min(100, Math.max(0, percent))
                        : 0
                };
            });

            if (stored?.enabled === false) {
                defaults.enabled = false;
            }
        } catch (e) {
            console.warn('Brickmerge Toolkit: Persönliche Rabatte konnten nicht geladen werden.');
        }
        return defaults;
    }

    function savePersonalDiscountSettings(settings) {
        try {
            localStorage.setItem(PERSONAL_DISCOUNT_SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Brickmerge Toolkit: Persönliche Rabatte konnten nicht gespeichert werden.');
        }
    }

    function getConfiguredRetailerDiscounts() {
        const settings = loadPersonalDiscountSettings();
        if (!settings.enabled) return [];
        return getRetailerCatalog()
            .filter(([key]) => {
                const setting = settings.retailers[key];
                return setting?.enabled && Number(setting.percent) > 0;
            })
            .map(([key, discount]) => [
                key,
                {
                    ...discount,
                    rate: Number(settings.retailers[key].percent) / 100
                }
            ]);
    }

    // ==========================================
    // 0. GLOBALE STYLES (z.B. Cookiebot verstecken)
    // ==========================================
    const globalCss = `
        #CookiebotWidget, .CookiebotWidget, #cybotCookiebotDialog {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
        /* Preis-Spalte auf die durch die entfernte "Hier zu X!"-Spalte freiwerdende
           Breite ausdehnen. Nur ab der Foundation-"medium"-Breakpoint-Grenze, damit
           die (davon ohnehin unabhängige) Mobile-Ansicht unverändert bleibt.
           Gilt sowohl für die reguläre Preisliste (#offerlist) als auch für die per
           AJAX nachgeladene "kürzlich ausverkauft"-Liste (#soldOut). */
        @media screen and (min-width: 641px) {
            #offerlist div.medium-4.small-9.columns.pricerow,
            #soldOut div.medium-4.small-9.columns.pricerow {
                width: 91.6667% !important;
            }
        }
        #offerlist .pricerow > a > .price {
            width: 95% !important;
            border: none !important;
        }
        #offerlist .medium-4.small-9.columns.pricerow[data-mid] {
            background-image: none !important;
            background-size: 0 0 !important;
        }
        #offerlist .price > span[style*="position: absolute"] {
            display: none !important;
        }
        #offerlist .bm-marketplace-logo {
            display: inline-block;
            width: auto;
            height: auto;
            max-width: 66px;
            max-height: 23px;
            object-fit: contain;
            vertical-align: middle;
        }
        #offerlist .bm-marketplace-logo.bm-keepa-logo {
            max-width: 62px;
            max-height: 18px;
            padding: 2px 4px;
            background: #303944;
            border-radius: 2px;
            box-sizing: content-box;
        }
        #offerlist .bm-mbd-logo-stack {
            display: flex !important;
            height: 100%;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            line-height: 1 !important;
        }
        #offerlist .bm-mbd-source-label {
            display: block;
            margin-bottom: 1px;
            color: #666;
            font-size: 0.46rem;
            font-weight: 600;
            line-height: 0.52rem;
            white-space: nowrap;
        }
        #offerlist .bm-mbd-logo-stack .bm-marketplace-logo {
            max-height: 15px;
        }
        #offerlist .pricerow:hover .bm-mbd-source-label {
            color: #fff;
        }
        #offerlist .bm-shipping-info {
            display: inline !important;
            position: relative;
            z-index: 3;
            margin-left: 0.6rem;
            color: #666 !important;
            font-size: 0.75rem;
            font-weight: normal;
            line-height: inherit !important;
            vertical-align: baseline;
            white-space: nowrap;
        }
        #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only):not(.bm-effective-info) {
            font-size: 0.75rem;
        }
        #offerlist .bm-original-price {
            display: inline;
            color: #b00 !important;
            font-size: inherit;
            font-weight: inherit;
            white-space: nowrap;
        }
        #offerlist .bm-shipping-unknown {
            color: #888 !important;
            font-style: italic;
        }
        #offerlist .bm-effective-info {
            display: inline !important;
            position: relative;
            z-index: 3;
            margin-left: 0.45rem;
            color: #b00 !important;
            font-size: 0.8rem;
            font-weight: normal;
            line-height: inherit;
            white-space: nowrap;
        }
        #offerlist .bm-offer-discount-bubble {
            position: absolute;
            top: 4px;
            right: 0.4rem;
            z-index: 4;
            min-width: 25px;
            min-height: 25px;
            padding: 1px;
            border-radius: 1000px;
            background: #b00;
            color: #fff;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: 1.5rem;
            text-align: center;
            white-space: nowrap;
        }
        #offerlist .bm-total-discount-bubble {
            position: absolute;
            top: 4px;
            right: 2.45rem;
            z-index: 4;
            min-width: 25px;
            min-height: 25px;
            padding: 1px;
            border: 1px solid #c9c9c9;
            border-radius: 1000px;
            background: #e7e7e7;
            color: #555;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: calc(1.5rem - 2px);
            text-align: center;
            white-space: nowrap;
            box-sizing: border-box;
        }
        @media screen and (max-width: 640px) {
            #offerlist .bm-effective-row span.price {
                display: inline-flex;
                flex-wrap: wrap;
                align-content: center;
                align-items: baseline;
                line-height: 1.2;
                padding-top: 0.25rem;
                padding-bottom: 0.25rem;
            }
            #offerlist .bm-effective-row span.price > .merchant {
                flex: 0 0 100%;
            }
            #offerlist .bm-shipping-info {
                margin-left: 0.35rem;
                font-size: 0.68rem;
            }
            #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only):not(.bm-effective-info) {
                font-size: 0.68rem;
            }
            #offerlist .bm-effective-info {
                display: inline !important;
                margin-left: 0.35rem;
                margin-top: 0;
                font-size: 0.72rem;
                line-height: 1.2;
                white-space: normal;
            }
            #offerlist .bm-offer-discount-bubble {
                top: 5px;
                right: 0.25rem;
            }
            #offerlist .bm-total-discount-bubble {
                top: 5px;
                right: 2.3rem;
            }
            #offerlist .price > .show-for-small-only.small {
                display: none !important;
            }
            #offerlist .row.collapse.bm-effective-row {
                min-height: 86px;
            }
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 86px !important;
                min-height: 86px !important;
            }
            #offerlist .row.collapse.bm-mbd-offer,
            #offerlist .row.collapse.bm-mbd-offer > .goto.small-3.columns,
            #offerlist .row.collapse.bm-mbd-offer > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-mbd-offer > .medium-4.small-9.columns.pricerow {
                height: 70px !important;
                min-height: 70px !important;
            }
            #offerlist .row.collapse.bm-mbd-offer.bm-effective-row,
            #offerlist .row.collapse.bm-mbd-offer.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-mbd-offer.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-mbd-offer.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 86px !important;
                min-height: 86px !important;
            }
            #offerlist .bm-marketplace-logo {
                max-width: 72px;
                max-height: 31px;
            }
        }
        .bm-offer-toolbar {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            margin: 0.25rem 0 0.75rem;
        }
        .bm-discount-toolbar-control {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            width: 100%;
            min-height: 21px;
        }
        .bm-discount-toolbar-control .switch {
            flex: 0 0 auto;
            margin: 0;
        }
        .bm-discount-toolbar-control .switch input {
            position: absolute;
            inset: 0;
            z-index: 2;
            display: block !important;
            width: 100%;
            height: 100%;
            margin: 0;
            opacity: 0;
            cursor: pointer;
        }
        .bm-discount-toolbar-label {
            color: #555;
            font-size: 0.8rem;
            font-weight: normal;
            line-height: 1.1;
        }
        .bm-discount-settings-trigger {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 30px;
            margin: 0 0 0 auto !important;
            padding: 0 !important;
            background: transparent !important;
            border: 0 !important;
            border-radius: 0 !important;
            color: #666 !important;
            font-size: 1.4rem !important;
            line-height: 1 !important;
        }
        .bm-discount-settings-trigger:hover,
        .bm-discount-settings-trigger:focus {
            background: transparent !important;
            color: #b00000 !important;
        }
        .bm-settings-overlay {
            position: fixed;
            inset: 0;
            z-index: 100050;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.58);
        }
        .bm-settings-overlay.is-open {
            display: flex;
        }
        .bm-settings-dialog {
            width: min(40rem, 100%);
            max-height: calc(100vh - 2rem);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #fff;
            border: 2px solid #a80000;
            border-radius: 2px;
            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
            color: #333;
        }
        .bm-settings-header,
        .bm-settings-actions {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.85rem 1rem;
        }
        .bm-settings-header {
            justify-content: space-between;
            background: #a80000;
            border-bottom: 1px solid #7c0000;
        }
        .bm-settings-header h3 {
            margin: 0 !important;
            color: #fff !important;
            font-size: 1.1rem !important;
        }
        .bm-settings-close {
            width: 2rem;
            height: 2rem;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            color: #fff !important;
            font-size: 1.5rem !important;
            line-height: 2rem !important;
        }
        .bm-settings-body {
            flex: 1 1 auto;
            min-height: 0;
            overflow: auto;
            padding: 0 1rem;
        }
        .bm-settings-row {
            display: grid;
            grid-template-columns: minmax(7rem, 1fr) auto 6.5rem;
            align-items: center;
            gap: 0.75rem;
            min-height: 2.8rem;
            border-bottom: 1px solid #e5e5e5;
        }
        .bm-settings-row:last-child {
            border-bottom: 0;
        }
        .bm-settings-row label {
            margin: 0;
            color: #1f5fa8;
            font-size: 0.82rem;
            font-weight: normal;
        }
        .bm-settings-row input[type="number"] {
            width: 4.8rem;
            height: 2.15rem;
            margin: 0;
            padding: 0.3rem 0.4rem;
        }
        .bm-settings-percent {
            display: flex;
            align-items: center;
            gap: 0.3rem;
            white-space: nowrap;
        }
        .bm-settings-actions {
            justify-content: flex-end;
            background: #f3f3f3;
            border-top: 1px solid #ddd;
        }
        .bm-settings-actions .button {
            margin: 0 !important;
            border-radius: 1px !important;
        }
        .bm-settings-save {
            background: #b00000 !important;
            color: #fff !important;
        }
        @media screen and (max-width: 480px) {
            .bm-settings-dialog {
                max-height: calc(100vh - 1rem);
            }
            .bm-settings-row {
                grid-template-columns: minmax(6rem, 1fr) auto 5.4rem;
                gap: 0.45rem;
            }
            .bm-settings-row input[type="number"] {
                width: 4rem;
            }
        }
    `;
    const globalStyle = document.createElement("style");
    globalStyle.textContent = globalCss;
    document.head.appendChild(globalStyle);

    function getSetNum() {
        let pathMatch = window.location.pathname.match(/\/(\d{4,7})(?:-\d+)?(?:[^\d]|$)/);
        if (pathMatch) return pathMatch[1];
        try {
            const params = new URLSearchParams(window.location.search);
            const find = params.get('find');
            if (find) {
                const findMatch = find.match(/^(\d{4,7})/);
                if (findMatch) return findMatch[1];
            }
            for (const value of params.values()) {
                const match = value.match(/^(\d{4,7})(?:-\d+)?$/);
                if (match) return match[1];
            }
        } catch (e) { }
        return null;
    }
    const setNum = getSetNum();

    function createMetaGptTransferId() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function createMetaGptSearchPrompt(setNumber) {
        const heading = document.querySelector('h1')?.textContent || '';
        const title = heading
            .replace(/[\u00AE\u2122]/g, '')
            .replace(/\s+/g, ' ')
            .trim() || `LEGO ${setNumber}`;
        return [
            `Suche aktuelle Angebote für ${title}.`,
            'nur relevante Angebote, nur NEU und OVP.'
        ].join(' ');
    }

    function setupMetaGptLink(container) {
        const link = container.querySelector('a[data-bmid="btn-meta-gpt"]');
        if (!link || link.dataset.bmMetaGptReady === 'true') return;
        link.dataset.bmMetaGptReady = 'true';
        link.dataset.bmMetaGptLink = 'true';
        link.title = 'Set im Meta-Preisvergleich-GPT suchen';

        link.addEventListener('click', event => {
            event.preventDefault();
            if (!setNum) return;

            const prompt = createMetaGptSearchPrompt(setNum);
            const transfer = {
                id: createMetaGptTransferId(),
                prompt,
                createdAt: Date.now()
            };

            try {
                GM_setClipboard(prompt, 'text');
            } catch (error) {
                navigator.clipboard?.writeText(prompt).catch(() => {});
            }
            void setMetaGptValue(META_GPT_PENDING_KEY, transfer);

            const label = link.querySelector('span');
            if (label) label.textContent = 'Wird geöffnet';
            window.open(META_GPT_URL, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => {
                if (label) label.textContent = 'Meta-GPT';
            }, 1400);
        });
    }

    const initialSetUvp = (() => {
        const candidates = document.querySelectorAll(
            '.stroke[title*="unverbindliche Preisempfehlung"], [title="unverbindliche Preisempfehlung"]'
        );
        for (const candidate of candidates) {
            const match = candidate.textContent.match(/(\d+[\d\s.,]*)\s*€/);
            if (!match) continue;
            const value = parseFloat(
                match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
            );
            if (Number.isFinite(value) && value > 0) return value;
        }
        return null;
    })();

    function createDiscountSettingsUI() {
        if (!setNum || document.getElementById('bm-discount-settings')) return;

        const offerlist = document.getElementById('offerlist');
        const firstOffer = offerlist
            ?.querySelector('.medium-4.small-9.columns.pricerow[data-mid]')
            ?.closest('.row.collapse');
        if (!offerlist || !firstOffer?.parentElement) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'bm-offer-toolbar';
        toolbar.innerHTML = `
            <div class="bm-discount-toolbar-control">
                <label class="switch" title="Persönlichen Rabatt ein- oder ausschalten">
                    <input id="bm-personal-enabled" type="checkbox"
                           aria-label="Persönlichen Rabatt verwenden">
                    <div class="slider round"></div>
                </label>
                <span class="bm-discount-toolbar-label">Persönlicher Rabatt</span>
                <button type="button" class="bm-discount-settings-trigger"
                        aria-haspopup="dialog" aria-controls="bm-discount-settings"
                        title="Persönlichen Rabatt einstellen"
                        aria-label="Persönlichen Rabatt einstellen">
                    ⚙
                </button>
            </div>
        `;
        firstOffer.parentElement.insertBefore(toolbar, firstOffer);

        const overlay = document.createElement('div');
        overlay.id = 'bm-discount-settings';
        overlay.className = 'bm-settings-overlay';
        overlay.innerHTML = `
            <div class="bm-settings-dialog" role="dialog" aria-modal="true"
                 aria-labelledby="bm-settings-title">
                <div class="bm-settings-header">
                    <h3 id="bm-settings-title">Persönlicher Rabatt</h3>
                    <button type="button" class="bm-settings-close"
                            title="Schließen" aria-label="Schließen">×</button>
                </div>
                <div class="bm-settings-body"></div>
                <div class="bm-settings-actions">
                    <button type="button" class="button secondary bm-settings-reset">
                        Standardwerte
                    </button>
                    <button type="button" class="button bm-settings-save">
                        Speichern
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const body = overlay.querySelector('.bm-settings-body');
        const escapeHtml = value => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const populate = settings => {
            body.innerHTML = '';
            getRetailerCatalog().forEach(([key, discount], index) => {
                const row = document.createElement('div');
                const checkboxId = `bm-retailer-enabled-${index}`;
                const percentId = `bm-retailer-percent-${index}`;
                const label = discount.label || key;
                row.className = 'bm-settings-row';
                row.dataset.key = key;
                row.innerHTML = `
                    <label for="${checkboxId}">${escapeHtml(label)}</label>
                    <input id="${checkboxId}" class="bm-settings-enabled"
                           type="checkbox" aria-label="${escapeHtml(label)} aktivieren">
                    <div class="bm-settings-percent">
                        <input id="${percentId}" class="bm-settings-rate" type="number"
                               min="0" max="100" step="0.01"
                               aria-label="Rabatt für ${escapeHtml(label)}">
                        <span>%</span>
                    </div>
                `;
                body.appendChild(row);

                const setting = settings.retailers[key];
                const enabledInput = row.querySelector('.bm-settings-enabled');
                const rateInput = row.querySelector('.bm-settings-rate');
                enabledInput.checked = setting?.enabled === true;
                rateInput.value = String(setting?.percent ?? 0);
                rateInput.disabled = !enabledInput.checked;
                enabledInput.addEventListener('change', () => {
                    rateInput.disabled = !enabledInput.checked;
                });
            });

            body.scrollTop = 0;
        };

        const close = () => {
            overlay.classList.remove('is-open');
            document.body.style.removeProperty('overflow');
            toolbar.querySelector('.bm-discount-settings-trigger')?.focus();
        };

        const open = () => {
            populate(loadPersonalDiscountSettings());
            overlay.classList.add('is-open');
            document.body.style.setProperty('overflow', 'hidden');
            overlay.querySelector('.bm-settings-close')?.focus();
        };

        const personalEnabledInput = toolbar.querySelector('#bm-personal-enabled');
        personalEnabledInput.checked = loadPersonalDiscountSettings().enabled !== false;
        personalEnabledInput.addEventListener('change', () => {
            const settings = loadPersonalDiscountSettings();
            settings.enabled = personalEnabledInput.checked;
            savePersonalDiscountSettings(settings);
            document.querySelectorAll('#offerlist .pricerow[data-bm-discount-applied]')
                .forEach(row => {
                    delete row.dataset.bmDiscountApplied;
                });
            applyOfferPresentation();
        });

        toolbar.querySelector('.bm-discount-settings-trigger').addEventListener('click', open);
        overlay.querySelector('.bm-settings-close').addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
        overlay.querySelector('.bm-settings-reset').addEventListener('click', () => {
            populate(getDefaultPersonalDiscountSettings());
        });
        overlay.querySelector('.bm-settings-save').addEventListener('click', () => {
            const previousSettings = loadPersonalDiscountSettings();
            const settings = {
                enabled: personalEnabledInput.checked,
                retailers: { ...previousSettings.retailers }
            };
            overlay.querySelectorAll('.bm-settings-row').forEach(row => {
                const rawPercent = Number(row.querySelector('.bm-settings-rate').value);
                settings.retailers[row.dataset.key] = {
                    enabled: row.querySelector('.bm-settings-enabled').checked,
                    percent: Number.isFinite(rawPercent)
                        ? Math.min(100, Math.max(0, rawPercent))
                        : 0
                };
            });
            savePersonalDiscountSettings(settings);
            document.querySelectorAll('#offerlist .pricerow[data-bm-discount-applied]')
                .forEach(row => {
                    delete row.dataset.bmDiscountApplied;
                });
            applyOfferPresentation();
            close();
        });
    }

    // ==========================================
    // 1. CLEANER MODUL
    // ==========================================

    // 1a. Deal-Score und „Ist … ein guter Deal?“ entfernen (läuft auf ALLEN Seiten)
    document.querySelectorAll('.dealheat').forEach(el => {
        let next = el.nextElementSibling;
        el.remove();
        if (next && next.tagName === 'H2' && next.textContent.includes('ein guter Deal')) {
            let afterH2 = next.nextElementSibling;
            next.remove();
            if (afterH2 && afterH2.tagName === 'P') {
                let afterP = afterH2.nextElementSibling;
                afterH2.remove();
                if (afterP && afterP.tagName === 'UL') afterP.remove();
            }
        }
    });

    // 1b. Cleaner (nur auf Detailseiten)
    function cleaner() {
        const short = document.getElementById('short'); if (short) short.remove();
        document.querySelectorAll('section').forEach(section => {
            const p = section.querySelector('p');
            if (p && p.textContent.trim() === 'Inhaltsverzeichnis') {
                let next = section.nextElementSibling;
                section.remove();
                if (next && next.tagName === 'SECTION' && next.querySelector('span[itemprop="description"]')) next.remove();
            }
        });
        // Die Bauanleitungsüberschrift ausblenden, den Inhalt und die Links aber
        // beibehalten.
        document.querySelectorAll('h3').forEach(h3 => {
            if (h3.id === 'Bauanleitung' || /\bBauanleitungen?\b/i.test(h3.textContent)) {
                h3.remove();
            }
        });

        // Verwaiste Anker-IDs entfernen: Diese id-Attribute dienten ausschließlich
        // als Sprungziel für die oben entfernte Inhaltsverzeichnis-Box und werden
        // sonst nirgends verlinkt. #moreimages und #offerlist bewusst NICHT
        // anfassen - die werden noch von den "mehr Bilder"-Links bzw. den
        // Bestpreis-Verweisen im Fließtext gebraucht.
        ['Bauanleitung', 'Einzelteileliste', 'Beschreibung'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.removeAttribute('id');
        });
        document.querySelectorAll('div.row.collapse').forEach(div => {
            const h3 = div.querySelector('h3');
            if (h3 && h3.textContent.trim() === 'Bei ebay kaufen:') {
                let prev = div.previousElementSibling;
                if (prev && prev.tagName === 'P' && prev.textContent.includes('Als Mitglieder vom Amazon Partnerprogramm')) prev.remove();
                div.remove();
            }
        });
        document.querySelectorAll('div.small-12.columns.small').forEach(div => {
            if (div.innerHTML.includes('/img/bm_tg_deals.png') && div.textContent.includes('Telegram')) div.remove();
        });
        const alarm = document.getElementById('alarm'); if (alarm) alarm.remove();
        document.querySelectorAll('div.offerbox').forEach(box => box.remove());
        const feedback = document.getElementById('feedback'); if (feedback) feedback.remove();
        document.querySelectorAll('p').forEach(p => {
            if (p.textContent.includes('Als Mitglieder vom Amazon Partnerprogramm')) p.remove();
        });
        document.querySelectorAll('h3').forEach(h3 => {
            if (h3.textContent.trim().startsWith('Wo kann man') || h3.textContent.includes('aktuell verfügbar')) {
                let p = h3.nextElementSibling;
                h3.remove();
                if (p && p.tagName === 'P') p.remove();
            }
        });
        const productrow = document.getElementById('productrowcontainer');
        if (productrow) productrow.remove();
        let firstH2 = null;
        document.querySelectorAll('h2').forEach(h2 => {
            if (!firstH2 && h2.textContent.toLowerCase().includes('preisvergleich')) firstH2 = h2;
        });
        if (firstH2) firstH2.remove();

        // "> zum Shop!" Link/Button im Top-Angebot entfernen
        document.querySelectorAll('a, button, span').forEach(el => {
            if (el.textContent.trim() === '> zum Shop!' || el.textContent.trim() === '» zum Shop!' || el.textContent.trim() === 'zum Shop!') {
                el.remove();
            }
        });
        document.querySelectorAll('.topprice').forEach(topPrice => {
            const label = topPrice.previousElementSibling;
            if (label?.tagName === 'P' && /^Top-Angebot:\s*$/i.test(label.textContent.trim())) {
                label.textContent = 'Brickmerge-Bestpreis:';
            }
        });

        const offerlist = document.getElementById('offerlist');
        if (offerlist) {
            offerlist.querySelectorAll('img').forEach(img => {
                if (img.src.includes('/img/info_') || img.src.includes('info_shopfilter') || img.src.includes('info_shoplink') || img.src.includes('info_bricklink_history') || img.alt?.toLowerCase().includes('hier klicken')) {
                    let container = img.closest('.columns') || img.closest('.row') || img.closest('div') || img.parentElement;
                    if (container && container !== offerlist) container.remove();
                    else img.remove();
                }
            });
            offerlist.querySelectorAll('*').forEach(el => {
                if (el.textContent?.toLowerCase().includes('hier klicken')) {
                    if (el.querySelector('img[src*="/img/info_"]') || el.innerHTML.includes('info_') || el.textContent.includes('Preisübersicht') || el.textContent.includes('scrollen')) el.remove();
                }
            });
            offerlist.querySelectorAll('a.button').forEach(a => {
                if (a.textContent.includes('Verfügbarkeit bei LEGO') || a.textContent.includes('Hier die Verfügbarkeit bei LEGO prüfen')) a.remove();
            });

            // "> Hier zu X!"-Spalte entfernen (reiner Duplikat-Link, der Preis selbst
            // ist ja bereits verlinkt). Nur die .goto.medium-7-Textspalte betrifft das,
            // NICHT die .goto.medium-1-Logospalte, die bleibt erhalten.
            offerlist.querySelectorAll('.goto.medium-7').forEach(el => el.remove());
        }
        document.querySelectorAll("div[style*='padding-bottom']").forEach(div => {
            if (div.textContent?.includes("Zur LEGO Seite") && div.textContent.includes("Zur ebay History") && div.innerHTML.includes("bricklink.com")) div.remove();
        });
        // Hinweis: der frühere Selektor für einen einzelnen <span> im Breadcrumb-Bereich
        // (body > section > div:nth-child(2) > ...) wurde entfernt, da er auf der
        // aktuellen Seitenstruktur nicht mehr matcht (totes Selektor-Ziel).
        document.querySelectorAll('img').forEach(img => {
            if (img.src.includes('/img/info_') || img.alt?.toLowerCase().includes('hier klicken') || img.title?.toLowerCase().includes('hier klicken')) {
                let parent = img.parentElement;
                while (parent && parent !== document.body) {
                    if (parent.classList.contains('columns') || parent.classList.contains('row') || (parent.tagName === 'DIV' && parent.children.length <= 2)) {
                        parent.remove(); break;
                    }
                    parent = parent.parentElement;
                }
                if (parent === document.body) img.remove();
            }
        });
        const showmoreSpan = document.querySelector('#ol1st > section:nth-child(1) > p > span.showmore');
        if (showmoreSpan) showmoreSpan.remove();
        document.querySelectorAll('span.showmore').forEach(span => span.remove());

        // Toggle-Schalter ("Versandkosten berücksichtigen"-Checkbox) entfernen
        const toggleForm = document.querySelector('form[name="sctoggle"]');
        const toggleFormWrapper = toggleForm ? toggleForm.closest('div') : null;
        if (toggleFormWrapper) toggleFormWrapper.remove();

        // Zeile mit dem Link "Versandkosten (soweit bekannt) berücksichtigen" und
        // dem "Preisfehler melden"-Button entfernen
        document.querySelectorAll('p').forEach(p => {
            if (p.textContent.includes('Versandkosten') && p.textContent.includes('berücksichtigen') && p.querySelector('a[href*="shippingcosts="]')) {
                const wrapperDiv = p.closest('div');
                if (wrapperDiv) wrapperDiv.remove();
                else p.remove();
            }
        });
    }

    if (setNum) cleaner();

    // "Kürzlich ausverkauft" direkt nach den verfügbaren Angeboten platzieren.
    // Die IDs bleiben erhalten, daher funktioniert Brickmerges AJAX-Load weiter.
    function moveSoldOutAfterAvailableOffers() {
        const soldOutContainer = document.getElementById('SoldOutContainer');
        const offerlist = document.getElementById('offerlist');
        const availablePriceRows = Array.from(offerlist?.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid]'
        ) || []).filter(priceRow => !priceRow.closest('#soldOut'));
        const lastAvailableRow = availablePriceRows
            .map(priceRow => priceRow.closest('.row.collapse'))
            .filter(Boolean)
            .pop();

        if (!soldOutContainer || !lastAvailableRow) return;
        if (lastAvailableRow.nextElementSibling !== soldOutContainer) {
            lastAvailableRow.insertAdjacentElement('afterend', soldOutContainer);
        }
    }
    if (setNum) {
        moveSoldOutAfterAvailableOffers();
        window.addEventListener('load', moveSoldOutAfterAvailableOffers, { once: true });
    }

    // Historische Preisangaben öffnen dieselbe Preisverlaufsansicht wie
    // Brickmerges eigener Chart-Schalter.
    function isPriceHistoryLink(link) {
        const text = link?.textContent || '';
        return /bisheriger\s+bestpreis|180\s*tage\s+bestpreis|preis\s+im\s+vergleich\s+zum\s+atb|differenz\s+zum\s+atb/i.test(text);
    }

    function decoratePriceHistoryLinks() {
        const chartTrigger = document.getElementById('chartTrigger');
        const bigChart = document.getElementById('bigChart');
        if (!chartTrigger || !bigChart) return;

        Array.from(document.querySelectorAll('a')).filter(isPriceHistoryLink).forEach(link => {
            link.classList.add('bm-price-history-link');
            link.setAttribute('href', '#chartContainer');
            link.setAttribute('aria-controls', 'bigChart');
        });

        if (document.documentElement.dataset.bmPriceHistoryBound === 'true') return;
        document.documentElement.dataset.bmPriceHistoryBound = 'true';

        document.addEventListener('click', event => {
            const link = event.target.closest?.('a');
            if (!isPriceHistoryLink(link)) return;
            event.preventDefault();

            const chartIsClosed = bigChart.classList.contains('hide') ||
                window.getComputedStyle(bigChart).display === 'none';

            if (chartIsClosed) {
                chartTrigger.click();
            } else {
                document.getElementById('chartContainer')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    }
    if (setNum) {
        decoratePriceHistoryLinks();
        window.addEventListener('load', decoratePriceHistoryLinks, { once: true });
    }

    // Die "kürzlich ausverkauft"-Liste wird von der Seite selbst per AJAX in
    // #soldOut nachgeladen ($("#soldOut").load(...)), und zwar NACH unserem
    // obigen cleaner()-Durchlauf. Die einmalige .goto.medium-7-Entfernung dort
    // greift also nicht - stattdessen per MutationObserver reagieren, sobald
    // der Inhalt tatsächlich eintrifft.
    if (setNum) {
        const soldOutContainer = document.getElementById('soldOut');
        if (soldOutContainer) {
            const stripSoldOutGoto = () => {
                soldOutContainer.querySelectorAll('.goto.medium-7').forEach(el => el.remove());
            };
            stripSoldOutGoto(); // falls beim Skriptstart schon gefüllt
            const soldOutObserver = new MutationObserver(() => stripSoldOutGoto());
            soldOutObserver.observe(soldOutContainer, { childList: true, subtree: true });
        }
    }

    // ==========================================
    // 2. LINKLISTE & UI MODUL
    // ==========================================
    if (setNum) {
        const icon = domain => `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(domain)}`;
        const amazonIcon = icon("amazon.de");

        const groups = [
            {
                title: "Shops",
                links: [
                    { name: "LEGO", url: `https://www.lego.com/de-de/product/${setNum}`, icon: icon("lego.com") },
                    { name: "Müller", url: `https://u6.at/d/mueller/${setNum}/`, icon: icon("mueller.de") },
                    { name: "Smyths", url: `https://www.google.com/search?q=site%3Asmythstoys.com/de+lego+${setNum}&btnI=1`, icon: icon("smythstoys.com") },
                    { id: "btn-meta-gpt", name: "Meta-GPT", url: META_GPT_URL, icon: icon("chatgpt.com") }
                ]
            },
            {
                title: "Marktplätze",
                links: [
                    { id: "btn-ebay", name: "eBay", url: `https://www.ebay.de/sch/i.html?_dcat=19006&_fsrp=1&_from=R40&_nkw=lego+${setNum}&_sacat=0&LH_BIN=1&LH_PrefLoc=1&LH_ItemCondition=1000&_sop=15`, icon: icon("ebay.de") },
                    { name: "Kleinanzeigen", url: `https://www.kleinanzeigen.de/s-spielzeug/sortierung:preis/lego-${setNum}/k0c23+spielzeug.condition_s:new`, icon: icon("kleinanzeigen.de") },
                    { name: "Vinted", url: `https://www.vinted.de/catalog?search_text=lego+${setNum}`, icon: icon("vinted.de") },
                    { name: "StockX", url: `https://www.google.com/search?q=site%3Astockx.com/de+lego+${setNum}&btnI=1`, icon: icon("stockx.com") },
                    { name: "BrickOwl", url: `https://www.brickowl.com/search/catalog?query=+${setNum}`, icon: icon("brickowl.com") },
                    { id: "btn-bl", name: "Bricklink", url: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNum}-1#T=S&O={%22ss%22:%22DE%22,%22cond%22:%22N%22,%22ii%22:0,%22reg%22:%22-1%22,%22iconly%22:0}`, icon: icon("bricklink.com") }
                ]
            },
            {
                title: "Frankreich 🇫🇷",
                links: [
                    { name: "LEGO.fr", url: `https://www.lego.com/fr-fr/product/${setNum}`, icon: icon("lego.com") },
                    { name: "leboncoin", url: `https://www.leboncoin.fr/recherche?text=lego%20${setNum}&shippable=1&transaction_status=search__no_value&sort=price&order=asc&item_condition=1`, icon: icon("leboncoin.fr") },
                    { name: "eBay FR", url: `https://www.ebay.fr/sch/i.html?_nkw=lego+${setNum}&_sacat=0&_from=R40&LH_BIN=1&LH_ItemCondition=1000&_sop=15`, icon: icon("ebay.fr") },
                    { name: "idealo FR", url: `https://www.google.com/search?q=site%3Aidealo.fr+lego+${setNum}&btnI=1`, icon: icon("idealo.fr") },
                    { name: "Cdiscount", url: `https://www.google.com/search?q=site%3Acdiscount.com+lego+${setNum}&btnI=1`, icon: icon("cdiscount.com") }
                ]
            },
            {
                title: "Ressourcen",
                links: [
                    { name: "Rebrickable", url: `https://rebrickable.com/sets/${setNum}-1/#alt_builds`, icon: icon("rebrickable.com") },
                    { name: "Meta", url: `https://meta-preisvergleich.de/index.cgi?q=lego+${setNum}&c=kategorie&id=lego_${setNum}__kategorie&offset=&qq=`, icon: icon("meta-preisvergleich.de") },
                    { name: "Geizhals", url: `https://www.google.com/search?q=site%3Ageizhals.de+lego+${setNum}&btnI=1`, icon: icon("geizhals.at") },
                    { name: "idealo DE", url: `https://www.google.com/search?q=site%3Aidealo.de+lego+${setNum}&btnI=1`, icon: icon("idealo.de") },
                    { id: "btn-mbd", name: "MyBrickDepot", url: `https://mybrickdepot.de/product/${setNum}`, icon: icon("mybrickdepot.de") },
                    { name: "Brickset", url: `https://brickset.com/sets/${setNum}-1`, icon: icon("brickset.com") }
                ]
            },
            {
                title: "Verkaufshistorie",
                links: [
                    { name: "eBay Historie", url: `https://www.ebay.de/sch/i.html?LEGO%2520Set%2520Nummer=${setNum}&LH_ItemCondition=1000&LH_Complete=1&LH_Sold=1&_nkw=lego+${setNum}&Marke=LEGO&rt=nc&_dcat=19006&_ipg=240&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=5337950435&customid=&toolid=10001&mkevt=1`, icon: icon("ebay.de") },
                    { name: "Bricklink Historie", url: `https://www.bricklink.com/catalogPG.asp?S=${setNum}-1&colorID=0&v=D&viewExclude=Y&cID=Y`, icon: icon("bricklink.com") },
                    { id: "btn-amz", name: "Keepa", url: `https://keepa.com/#!search/3-lego%20${setNum}`, icon: amazonIcon }
                ]
            }
        ];

        const css = `
        .bm-info-group {margin: 1.3em 0 1.4em 0;}
        .bm-info-group:first-child { margin-top: 1em; }
        .bm-info-group:last-child { margin-bottom: 1.8em; }
        .bm-info-title { font-size: 1.05em; font-weight: bold; margin: 0 0 0.45em 0; color: #333; }
        .bm-link-slider { position: relative; min-width: 0; }
        .bm-link-viewport { overflow: hidden; min-width: 0; scroll-behavior: smooth; }
        .bm-info-links { display: flex; flex-wrap: nowrap; width: max-content; gap: 7px 11px; }
        .bm-link { display: inline-flex; flex: 0 0 auto; align-items: center; text-decoration: none; font-size: 0.93em; color: #222; font-weight: 500; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px 4px 6px; line-height: 1.2;}
        .bm-link img { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; margin-right: 6px; }
        .bm-link:hover span { text-decoration: underline; }
        .bm-link-scroll {
            position: absolute;
            top: 50%;
            z-index: 5;
            display: none;
            align-items: center;
            justify-content: center;
            width: 1.65rem;
            height: 1.65rem;
            margin: 0 !important;
            padding: 0 !important;
            transform: translateY(-50%);
            background: #fff !important;
            border: 1px solid #aaa !important;
            border-radius: 50% !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
            color: #a80000 !important;
            font-size: 1.25rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
        }
        .bm-link-scroll.is-visible { display: flex; }
        .bm-link-scroll-prev { left: 0.15rem; }
        .bm-link-scroll-next { right: 0.15rem; }
        .bm-link-scroll:hover,
        .bm-link-scroll:focus {
            background: #a80000 !important;
            color: #fff !important;
        }
        `;
        if (!document.getElementById('bm-linklist-style')) {
            const style = document.createElement("style");
            style.id = "bm-linklist-style";
            style.textContent = css;
            document.head.appendChild(style);
        }

        function buildBox() {
            const container = document.createElement("div");
            for (const group of groups) {
                const section = document.createElement("section");
                section.className = "bm-info-group";
                const title = document.createElement("div");
                title.className = "bm-info-title";
                title.textContent = group.title;
                const slider = document.createElement("div");
                slider.className = "bm-link-slider";
                const viewport = document.createElement("div");
                viewport.className = "bm-link-viewport";
                const row = document.createElement("div");
                row.className = "bm-info-links";
                const previous = document.createElement("button");
                previous.type = "button";
                previous.className = "bm-link-scroll bm-link-scroll-prev";
                previous.title = "Nach links";
                previous.setAttribute("aria-label", `${group.title}: nach links`);
                previous.textContent = "‹";
                const next = document.createElement("button");
                next.type = "button";
                next.className = "bm-link-scroll bm-link-scroll-next";
                next.title = "Nach rechts";
                next.setAttribute("aria-label", `${group.title}: nach rechts`);
                next.textContent = "›";
                for (const { id, name, url, icon } of group.links) {
                    const a = document.createElement("a");
                    a.href = url; a.target = "_blank"; a.className = "bm-link";
                    if (id) a.dataset.bmid = id;
                    const img = document.createElement("img"); img.src = icon; img.alt = "";
                    const span = document.createElement("span"); span.textContent = name;
                    a.appendChild(img); a.appendChild(span);
                    row.appendChild(a);
                }
                viewport.appendChild(row);
                slider.appendChild(viewport);
                slider.appendChild(previous);
                slider.appendChild(next);
                section.appendChild(title);
                section.appendChild(slider);
                container.appendChild(section);
            }
            return container;
        }

        function setupLinkSliders(container) {
            container.querySelectorAll('.bm-link-slider').forEach(slider => {
                const viewport = slider.querySelector('.bm-link-viewport');
                const previous = slider.querySelector('.bm-link-scroll-prev');
                const next = slider.querySelector('.bm-link-scroll-next');

                const update = () => {
                    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
                    previous.classList.toggle('is-visible', viewport.scrollLeft > 2);
                    next.classList.toggle('is-visible', viewport.scrollLeft < maxScroll - 2);
                };
                const scroll = direction => {
                    viewport.scrollBy({
                        left: direction * Math.max(160, viewport.clientWidth * 0.75),
                        behavior: 'smooth'
                    });
                };

                previous.addEventListener('click', () => scroll(-1));
                next.addEventListener('click', () => scroll(1));
                viewport.addEventListener('scroll', update, { passive: true });
                window.addEventListener('resize', update);
                if (typeof ResizeObserver === 'function') {
                    const resizeObserver = new ResizeObserver(update);
                    resizeObserver.observe(viewport);
                    resizeObserver.observe(viewport.querySelector('.bm-info-links'));
                }
                requestAnimationFrame(update);
            });
        }

        function injectBox() {
            let container = document.querySelector('div[id^="chartdiv"]')?.closest('.large-9.columns');
            if (!container) {
                container = document.querySelector('#offerlist')?.closest('.large-9.columns') || document.querySelector('.large-9.columns');
            }
            if (!container) return;
            const box = buildBox();
            const insertTarget = document.querySelector('div[id^="chartdiv"]') || document.querySelector('#offerlist');
            if (insertTarget) {
                insertTarget.parentNode.insertBefore(box, insertTarget);
            } else {
                container.appendChild(box);
            }
            setupLinkSliders(box);
            setupMetaGptLink(box);
            fetchAndInjectPrices(setNum);
        }

        if (document.readyState !== "loading") injectBox();
        else window.addEventListener("DOMContentLoaded", injectBox);

        // --- PREIS-ABFRAGE & INTEGRATION ---
        function fetchAndInjectPrices(setNumber) {
            function extractPrice(html, regex) {
                const match = html.match(regex);
                return match ? match[1] + ' €' : '';
            }
            function parseMyBrickHtml(html) {
                return {
                    ebay: extractPrice(html, /eBay Preis(?:[^0-9]+)?(\d+(?:,\d+)?)/i),
                    amazon: extractPrice(html, /Amazon Preis(?:[^0-9]+)?(\d+(?:,\d+)?)/i),
                    bricklink: extractPrice(html, /Bricklink Preis(?:[^0-9]+)?(\d+(?:,\d+)?)/i)
                };
            }
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://mybrickdepot.de/product/" + setNumber,
                headers: { "User-Agent": "Mozilla/5.0" },
                onload: function(response) {
                    if (response.status === 200) {
                        const html = response.responseText;
                        const prices = parseMyBrickHtml(html);
                        const findMerchantLogo = (aliases, fallbackPath) => {
                            const normalizedAliases = aliases.map(alias =>
                                alias.trim().toLocaleLowerCase('de')
                            );
                            const image = Array.from(
                                document.querySelectorAll('#offerlist .goto img[alt]')
                            ).find(candidate =>
                                normalizedAliases.includes(
                                    candidate.alt.trim().toLocaleLowerCase('de')
                                )
                            );
                            return image?.src || new URL(fallbackPath, window.location.origin).href;
                        };
                        const logos = {
                            ebay: findMerchantLogo(
                                ['eBay.de', 'eBay'],
                                '/img/merchants/ebay.de_ico.gif'
                            ),
                            keepa: 'https://upload.wikimedia.org/wikipedia/commons/7/79/Keepa-logo.svg',
                            bricklink: 'https://static2.bricklink.com/img/bricklink_2026.svg'
                        };
                        const createOffer = (buttonId, label, priceText, logoUrl) => {
                            const button = document.querySelector(`a[data-bmid="${buttonId}"]`);
                            if (!button || !priceText) return null;
                            return {
                                key: buttonId.replace(/^btn-/, ''),
                                label,
                                priceText,
                                url: button.href,
                                logoUrl
                            };
                        };
                        const offers = [
                            createOffer('btn-ebay', 'eBay', prices.ebay, logos.ebay),
                            createOffer('btn-amz', 'Keepa', prices.amazon, logos.keepa),
                            createOffer('btn-bl', 'Bricklink', prices.bricklink, logos.bricklink)
                        ].filter(Boolean);
                        injectMyBrickDepotOffers(offers);
                    }
                },
                onerror: function() {
                    console.warn("Brickmerge Toolkit: Preisabfrage bei MyBrickDepot fehlgeschlagen.");
                },
                ontimeout: function() {
                    console.warn("Brickmerge Toolkit: Preisabfrage bei MyBrickDepot - Timeout.");
                }
            });
        }
    }

    // ==========================================
    // 3. COPY-ICON & MINIFIGUREN-OVERLAY
    // ==========================================
    if (setNum) {
        (function titleCopyButton() {
            const h1 = document.querySelector('h1');
            if (!h1 || h1.querySelector('.bm-copy-btn')) return;
            const copyBtn = document.createElement('span');
            copyBtn.className = 'bm-copy-btn';
            copyBtn.title = 'Titel kopieren';
            copyBtn.style.cssText = 'cursor:pointer;margin-left:0.5em;user-select:none;display:inline-flex;vertical-align:middle;';
            copyBtn.innerHTML = `
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="#333" fill="none" stroke-width="1"/>
            <rect x="6.5" y="0.5" width="6" height="9" rx="2" stroke="#d1d5da" fill="none" stroke-width="1"/>
            </svg>`;
            copyBtn.addEventListener('click', () => {
                const cleaned = h1.textContent.replace(/[\u00AE\u2122]/g, '').replace(/\s+/g, ' ').trim();
                if (typeof GM_setClipboard !== "undefined") {
                    GM_setClipboard(cleaned);
                } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(cleaned);
                }
                copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18" fill="#2eb866" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="#2eb866" fill="none" stroke-width="2"/><path d="M5 10 l2 2 4-4" stroke="#2eb866" stroke-width="2" fill="none"/></svg>`;
                setTimeout(() => {
                    copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="9" height="10" rx="2" stroke="#333" fill="none" stroke-width="1"/><rect x="6.5" y="0.5" width="6" height="9" rx="2" stroke="#d1d5da" fill="none" stroke-width="1"/></svg>`;
                }, 900);
            });
            h1.appendChild(copyBtn);
        })();

        function replaceMinifigurenWithLink(setNum) {
            function walk(node) {
                if (node.nodeType === 3 && /minifiguren/i.test(node.textContent)) {
                    const span = document.createElement('span');
                    span.innerHTML = node.textContent.replace(/(minifiguren)/i, '<a href="#" class="bm-minifig-link">$1</a>');
                    node.parentNode.replaceChild(span, node);
                } else if (node.nodeType === 1 && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.tagName)) {
                    Array.from(node.childNodes).forEach(walk);
                }
            }
            walk(document.body);
            document.body.addEventListener('click', function (e) {
                if (e.target && e.target.classList.contains('bm-minifig-link')) {
                    e.preventDefault();
                    showMinifigOverlay(e.target, setNum);
                }
            });
        }

        function showMinifigOverlay(link, setNum) {
            document.querySelector('.bm-minifig-overlay .bm-minifig-close')?.click();

            const overlay = document.createElement('div');
            overlay.className = 'bm-minifig-overlay';
            overlay.innerHTML = `
                <div class="bm-minifig-backdrop"></div>
                <div class="bm-minifig-modal" role="dialog" aria-modal="true" aria-labelledby="bm-minifig-title">
                    <header class="bm-minifig-header">
                        <div>
                            <h2 id="bm-minifig-title">Minifiguren</h2>
                            <div class="bm-minifig-subtitle">LEGO Set ${setNum}</div>
                        </div>
                        <button type="button" class="bm-minifig-close" title="Schließen" aria-label="Schließen">×</button>
                    </header>
                    <div class="bm-minifig-content" aria-live="polite">
                        <div class="bm-minifig-status">Minifiguren werden von Bricklink geladen …</div>
                    </div>
                </div>
            `;
            if (!document.getElementById('bm-minifig-style')) {
                const style = document.createElement('style');
                style.id = 'bm-minifig-style';
                style.textContent = `
                .bm-minifig-overlay {
                    position:fixed;
                    z-index:99999;
                    inset:0;
                    width:100vw;
                    height:100vh;
                    font-family:inherit;
                }
                .bm-minifig-backdrop {
                    position:absolute;
                    inset:0;
                    background:rgba(20,20,20,0.58);
                    z-index:0;
                    animation:bmfadein 0.16s ease-out;
                }
                .bm-minifig-modal {
                    position:absolute;
                    left:50%;
                    top:50%;
                    transform:translate(-50%,-50%);
                    display:flex;
                    flex-direction:column;
                    width:min(900px,calc(100vw - 32px));
                    max-height:min(84vh,760px);
                    overflow:hidden;
                    background:#fff;
                    border-top:4px solid #b00;
                    border-radius:6px;
                    box-shadow:0 18px 55px rgba(0,0,0,0.38);
                    z-index:1;
                    animation:bmzoom 0.16s ease-out;
                }
                .bm-minifig-header {
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    flex:0 0 auto;
                    min-height:72px;
                    padding:14px 18px 13px 22px;
                    border-bottom:0;
                    background:#fff;
                    box-shadow:none;
                }
                .bm-minifig-header h2 {
                    margin:0;
                    padding:0;
                    color:#333;
                    font-size:1.25rem;
                    font-weight:700;
                    line-height:1.25;
                }
                .bm-minifig-subtitle {
                    margin-top:3px;
                    color:#777;
                    font-size:0.75rem;
                    line-height:1.2;
                }
                .bm-minifig-close {
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    flex:0 0 36px;
                    width:36px;
                    height:36px;
                    margin:0;
                    padding:0 0 3px;
                    border:0;
                    border-radius:4px;
                    background:transparent;
                    color:#777;
                    cursor:pointer;
                    font:400 1.8rem/1 Arial,sans-serif;
                }
                .bm-minifig-close:hover,
                .bm-minifig-close:focus {
                    background:#f7eaea;
                    color:#600;
                    outline:none;
                }
                .bm-minifig-content {
                    min-height:130px;
                    overflow:auto;
                    color:#333;
                    background:#fff;
                }
                .bm-minifig-status {
                    margin:28px 24px;
                    padding:14px 16px;
                    border-left:3px solid #b00;
                    background:#f5f5f5;
                    color:#555;
                    font-size:0.88rem;
                }
                .bm-minifig-content table {
                    width:100%;
                    margin:0;
                    border:0;
                    border-collapse:collapse;
                    table-layout:fixed;
                    color:#333 !important;
                    font-size:0.9rem;
                }
                .bm-minifig-content tr {
                    border-bottom:1px solid #e3e3e3;
                    background:#fff;
                }
                .bm-minifig-content tr:last-child {
                    border-bottom:0;
                }
                .bm-minifig-content tr:hover td {
                    background:#fff8f6 !important;
                }
                .bm-minifig-content th,
                .bm-minifig-content td {
                    height:auto !important;
                    padding:16px 12px;
                    border:0 !important;
                    background:#fff !important;
                    color:#333 !important;
                    vertical-align:middle !important;
                    line-height:1.45;
                    overflow-wrap:anywhere;
                }
                .bm-minifig-content td:first-child {
                    width:136px;
                    padding-left:20px;
                    text-align:center;
                }
                .bm-minifig-content td:nth-child(2) {
                    width:44px;
                    color:#777 !important;
                    text-align:center;
                }
                .bm-minifig-content td:nth-child(3) {
                    width:150px;
                }
                .bm-minifig-content td:last-child {
                    padding-right:22px;
                    font-size:0.92rem;
                }
                .bm-minifig-content img {
                    display:block;
                    width:auto !important;
                    height:auto !important;
                    max-width:108px;
                    max-height:132px;
                    margin:0 auto;
                    object-fit:contain;
                }
                .bm-minifig-content a,
                .bm-minifig-content a font,
                .bm-minifig-content a span {
                    color:#b00 !important;
                    text-decoration:none;
                }
                .bm-minifig-content a:hover,
                .bm-minifig-content a:focus,
                .bm-minifig-content a:hover font,
                .bm-minifig-content a:hover span {
                    color:#600 !important;
                    text-decoration:underline;
                }
                .bm-minifig-content font {
                    color:#333 !important;
                }
                @media screen and (max-width:640px) {
                    .bm-minifig-modal {
                        width:calc(100vw - 16px);
                        max-height:90vh;
                    }
                    .bm-minifig-header {
                        min-height:64px;
                        padding:11px 10px 10px 15px;
                    }
                    .bm-minifig-header h2 {
                        font-size:1.08rem;
                    }
                    .bm-minifig-content table,
                    .bm-minifig-content tbody {
                        display:block;
                    }
                    .bm-minifig-content tr {
                        display:grid;
                        grid-template-columns:92px 38px minmax(0,1fr);
                        width:100%;
                        min-height:132px;
                    }
                    .bm-minifig-content td {
                        display:block;
                        width:auto !important;
                        padding:10px 8px;
                    }
                    .bm-minifig-content td:first-child {
                        grid-column:1;
                        grid-row:1 / span 2;
                        padding:14px 6px;
                    }
                    .bm-minifig-content td:nth-child(2) {
                        grid-column:2;
                        grid-row:1;
                        align-self:end;
                        padding:12px 2px 4px;
                    }
                    .bm-minifig-content td:nth-child(3) {
                        grid-column:3;
                        grid-row:1;
                        align-self:end;
                        padding:12px 10px 4px 4px;
                    }
                    .bm-minifig-content td:last-child {
                        grid-column:2 / 4;
                        grid-row:2;
                        align-self:start;
                        padding:4px 10px 12px 4px;
                    }
                    .bm-minifig-content img {
                        max-width:78px;
                        max-height:96px;
                    }
                }
                @keyframes bmfadein {
                    from { opacity:0; }
                    to { opacity:1; }
                }
                @keyframes bmzoom {
                    from { transform:translate(-50%,-48%); opacity:0; }
                    to { transform:translate(-50%,-50%); opacity:1; }
                }
                `;
                document.head.appendChild(style);
            }

            const previousBodyOverflow = document.body.style.overflow;
            document.body.appendChild(overlay);

            const closeButton = overlay.querySelector('.bm-minifig-close');
            const close = () => {
                document.removeEventListener('keydown', handleKeydown);
                document.body.style.overflow = previousBodyOverflow;
                overlay.remove();
                link?.focus();
            };
            const handleKeydown = event => {
                if (event.key === 'Escape') close();
            };

            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', handleKeydown);
            overlay.querySelector('.bm-minifig-backdrop').onclick = close;
            closeButton.onclick = close;
            closeButton.focus();

            const url = `https://www.bricklink.com/catalogItemInv.asp?S=${setNum}-1&viewItemType=M`;
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function (response) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, "text/html");
                    const table = doc.querySelector("#id-main-legacy-table > tbody > tr > td > table:nth-child(4) > tbody > tr > td > center > form > table");
                    if (table) {
                        const rows = table.querySelectorAll('tr');
                        if (rows.length > 2) { rows[0].remove(); rows[1].remove(); }

                        const headingRow = table.rows[0];
                        if (headingRow && /minifigures/i.test(headingRow.textContent)) {
                            headingRow.remove();
                        }

                        table.removeAttribute('border');
                        table.removeAttribute('cellpadding');
                        table.removeAttribute('cellspacing');
                        table.removeAttribute('width');
                        table.removeAttribute('style');

                        Array.from(table.rows).forEach(row => {
                            if (row.cells.length > 1) row.deleteCell(-1);
                            row.removeAttribute('style');
                            row.removeAttribute('height');
                            Array.from(row.cells).forEach(cell => {
                                ['align', 'bgcolor', 'height', 'nowrap', 'style', 'valign', 'width']
                                    .forEach(attribute => cell.removeAttribute(attribute));
                            });

                            const imageCell = row.cells[0];
                            if (!imageCell?.querySelector('img')) return;
                            Array.from(imageCell.childNodes).forEach(node => {
                                if (node.nodeType === 3 && node.textContent.trim() === '*') {
                                    node.remove();
                                }
                            });
                            Array.from(imageCell.querySelectorAll('br')).forEach(br => {
                                const trailingContent = Array.from(imageCell.childNodes)
                                    .slice(Array.from(imageCell.childNodes).indexOf(br) + 1)
                                    .some(node => node.textContent.trim());
                                if (!trailingContent) br.remove();
                            });
                        });

                        Array.from(table.querySelectorAll('a')).forEach(a => {
                            if (a.getAttribute('href')?.startsWith('/')) {
                                a.href = 'https://www.bricklink.com' + a.getAttribute('href');
                            }
                            a.target = '_blank';
                            a.rel = 'noopener noreferrer';
                        });

                        const figureCount = table.rows.length;
                        const subtitle = overlay.querySelector('.bm-minifig-subtitle');
                        subtitle.textContent = `${figureCount} ${figureCount === 1 ? 'Figur' : 'Figuren'} · LEGO Set ${setNum}`;

                        overlay.querySelector('.bm-minifig-content').innerHTML = "";
                        overlay.querySelector('.bm-minifig-content').appendChild(table);
                    } else {
                        overlay.querySelector('.bm-minifig-content').innerHTML =
                            '<div class="bm-minifig-status">Keine Minifiguren gefunden.</div>';
                    }
                },
                onerror: function () {
                    overlay.querySelector('.bm-minifig-content').innerHTML =
                        '<div class="bm-minifig-status">Fehler beim Laden von Bricklink.</div>';
                },
                ontimeout: function () {
                    overlay.querySelector('.bm-minifig-content').innerHTML =
                        '<div class="bm-minifig-status">Zeitüberschreitung beim Laden von Bricklink.</div>';
                }
            });
        }
        replaceMinifigurenWithLink(setNum);
    }

    // ==========================================
    // 5. GUTSCHEIN-RABATTRECHNER (effektive Preise)
    // ==========================================
    function getCurrentSetUvp() {
        if (initialSetUvp !== null) return initialSetUvp;

        const candidates = document.querySelectorAll(
            '.stroke[title*="unverbindliche Preisempfehlung"], [title="unverbindliche Preisempfehlung"]'
        );
        for (const candidate of candidates) {
            const value = parseEuroValue(candidate.textContent);
            if (value !== null && value > 0) return value;
        }
        return null;
    }

    function getOriginalOfferTitle(anchor) {
        if (!anchor) return '';

        if (!anchor.dataset.bmOriginalTooltip && !anchor.getAttribute('title')) {
            anchor.dispatchEvent(new CustomEvent('bm-tooltip-capture-request', { bubbles: true }));
        }

        return anchor.dataset.bmOriginalTooltip || anchor.getAttribute('title') || '';
    }

    function ensureTooltipBridge() {
        if (document.getElementById('bm-tooltip-bridge')) return;

        const bridge = document.createElement('script');
        bridge.id = 'bm-tooltip-bridge';
        bridge.textContent = `
            (() => {
                const tooltipText = (content) => {
                    if (typeof content === 'string') return content.trim();
                    if (content?.jquery && typeof content.text === 'function') return content.text().trim();
                    if (typeof content?.textContent === 'string') return content.textContent.trim();
                    return '';
                };

                const captureTooltip = (anchor) => {
                    if (!anchor || anchor.dataset.bmOriginalTooltip) return;

                    let content = anchor.getAttribute('title') || '';
                    if (!content && window.jQuery && typeof window.jQuery.fn?.tooltipster === 'function') {
                        try {
                            const target = window.jQuery(anchor);
                            if (target.hasClass('tooltipstered')) {
                                content = tooltipText(target.tooltipster('content'));
                            }
                        } catch (e) {}
                    }

                    if (content) anchor.dataset.bmOriginalTooltip = content;
                };

                const syncTooltip = (anchor) => {
                    const content = anchor?.dataset?.bmTooltip;
                    if (!content || !window.jQuery || typeof window.jQuery.fn?.tooltipster !== 'function') return;
                    try {
                        const target = window.jQuery(anchor);
                        if (target.hasClass('tooltipstered')) {
                            target.tooltipster('content', content);
                        }
                    } catch (e) {}
                };

                document.addEventListener('bm-tooltip-capture-request', event => {
                    captureTooltip(event.target);
                }, true);

                document.addEventListener('bm-tooltip-updated', event => {
                    captureTooltip(event.target);
                    syncTooltip(event.target);
                }, true);

                document.addEventListener('mouseover', event => {
                    const anchor = event.target.closest?.('a.tooltipster');
                    if (!anchor) return;
                    captureTooltip(anchor);
                    if (anchor.dataset.bmTooltip) syncTooltip(anchor);
                }, true);

                document.querySelectorAll('#offerlist a.tooltipster').forEach(captureTooltip);
            })();
        `;
        document.documentElement.appendChild(bridge);
    }

    // Bewusst auf oberster Ebene deklariert (nicht in einem if-Block), da
    // Funktionsdeklarationen in Strict Mode block-scoped sind. So bleibt die
    // Funktion aus Modul 4 (Observer/Load-Handler) sicher aufrufbar.
    function applyRetailerDiscounts() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();
        const entries = getConfiguredRetailerDiscounts();

        // Normalisiert Umlaute/ß, damit "Müller" == "mueller" gematcht wird.
        function normalizeRetailerString(str) {
            return str
                .toLowerCase()
                .replace(/ä/g, 'ae')
                .replace(/ö/g, 'oe')
                .replace(/ü/g, 'ue')
                .replace(/ß/g, 'ss')
                .trim();
        }

        // Die Händler-ID ist eindeutig. Nur wenn sie fehlt, werden Händlernamen
        // exakt mit den konfigurierten Aliasen verglichen.
        function matchRetailerDiscount(priceSpan, candidates) {
            const row = priceSpan.closest('[data-mid]');
            const mid = row ? row.getAttribute('data-mid') : null;

            if (mid) {
                for (const [domain, discount] of entries) {
                    if (!discount || typeof discount.rate !== 'number') continue;
                    if (String(discount.mid) === String(mid)) {
                        return { domain, rate: discount.rate };
                    }
                }
            }

            const normalizedCandidates = candidates.map(normalizeRetailerString);
            for (const [domain, discount] of entries) {
                if (!discount || typeof discount.rate !== 'number') continue;
                const aliases = Array.isArray(discount.aliases) ? discount.aliases : [];
                const normalizedAliases = aliases.map(normalizeRetailerString);
                if (normalizedAliases.some(alias => normalizedCandidates.includes(alias))) {
                    return { domain, rate: discount.rate };
                }
            }

            return null;
        }

        // Sammelt den Händlernamen aus mehreren unabhängigen Quellen, statt sich auf
        // eine einzige zu verlassen (auf der Live-Seite war z.B. mal das title-Attribut
        // nicht eindeutig genug, mal der .merchant-Span leer - je nach Händler/Zeile).
        // Quelle 1: title-Attribut des Links ("Link zu eBay.de - Preisangabe vom...")
        // Quelle 2: (auf Mobile sichtbarer) .merchant-Span direkt im Preis-Element
        // Quelle 3: alt-Attribut des Händler-Logos, verknüpft über die gemeinsame
        //           data-mid-Kennung von Preiszeile und Icon-Zeile
        function extractMerchantCandidates(priceSpan) {
            const candidates = [];

            const anchor = priceSpan.closest('a');
            const originalTitle = getOriginalOfferTitle(anchor);
            if (originalTitle) {
                const titleMatch = originalTitle.match(/Link zu (.+?)(?:\s+-\s+|$)/i);
                if (titleMatch && titleMatch[1]) candidates.push(titleMatch[1].trim());
            }

            const merchantSpan = priceSpan.querySelector('.merchant');
            if (merchantSpan) {
                const text = merchantSpan.textContent.trim();
                if (text) candidates.push(text);
            }

            const rowWithMid = priceSpan.closest('[data-mid]');
            if (rowWithMid) {
                const mid = rowWithMid.getAttribute('data-mid');
                if (mid) {
                    const iconImg = document.querySelector(`#mid${mid} img[alt]`);
                    if (iconImg && iconImg.alt) candidates.push(iconImg.alt.trim());
                }
            }

            return candidates.filter(Boolean);
        }

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const discountRow = priceSpan.closest('.pricerow');
            const candidates = extractMerchantCandidates(priceSpan);
            const match = matchRetailerDiscount(priceSpan, candidates);
            if (!match) {
                if (discountRow) {
                    delete discountRow.dataset.bmDiscountApplied;
                    delete discountRow.dataset.bmRetailerRate;
                    delete discountRow.dataset.bmRetailerDomain;
                    delete discountRow.dataset.bmEffectivePrice;
                    delete discountRow.dataset.bmEffectiveDiscount;
                    discountRow.classList.remove('bm-has-retailer-discount');
                }
                return;
            }

            const originalPrice = getBaseOfferPrice(priceSpan);
            if (originalPrice === null || originalPrice <= 0) return;

            // Der Prozentwert muss zum angezeigten Cent-Preis passen. Andernfalls
            // können sich bei LEGO/Müller Abweichungen in der letzten Zehntelstelle ergeben.
            const effectivePrice = Math.round(
                (originalPrice * (1 - match.rate) + Number.EPSILON) * 100
            ) / 100;
            const uvp = getCurrentSetUvp();
            let effectiveDiscountPercent = null;

            if (uvp !== null && uvp > 0) {
                effectiveDiscountPercent = (1 - (effectivePrice / uvp)) * 100;
            } else {
                // Fallback: vorhandenen Brickmerge-Rabatt mit dem Händlerrabatt
                // kombinieren, falls auf der Seite keine UVP-Zeile vorhanden ist.
                const title = getOriginalOfferTitle(priceSpan.closest('a'));
                const baseDiscountMatch = title.match(/\((\d+(?:[.,]\d+)?)%\)\s*gespart/i);
                if (baseDiscountMatch) {
                    const baseDiscount = parseFloat(baseDiscountMatch[1].replace(',', '.')) / 100;
                    effectiveDiscountPercent = (1 - ((1 - baseDiscount) * (1 - match.rate))) * 100;
                }
            }

            const effectivePriceLabel = effectivePrice.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            const effectiveDiscountLabel = effectiveDiscountPercent === null
                ? null
                : Math.abs(effectiveDiscountPercent).toLocaleString('de-DE', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1
                });
            const voucherDiscountLabel = (match.rate * 100).toLocaleString('de-DE', {
                maximumFractionDigits: 2
            });

            if (discountRow) {
                const offerLink = priceSpan.closest('a');
                if (offerLink) {
                    const originalTooltip = getOriginalOfferTitle(offerLink);
                    if (originalTooltip) {
                        offerLink.dataset.bmOriginalTooltip = originalTooltip;
                    }

                    const effectiveTooltip = effectiveDiscountLabel === null
                        ? `Gutscheinrabatt: ${voucherDiscountLabel}%. Effektivpreis nach Händlerrabatt: ${effectivePriceLabel} €.`
                        : `Gutscheinrabatt: ${voucherDiscountLabel}%. Effektivpreis nach Händlerrabatt: ${effectivePriceLabel} € (${effectiveDiscountLabel}% Rabatt zur UVP von ${formatEuroValue(uvp)} €).`;
                    const combinedTooltip = [originalTooltip, effectiveTooltip].filter(Boolean).join(' ');

                    offerLink.dataset.bmTooltip = combinedTooltip;
                    offerLink.setAttribute('title', combinedTooltip);
                    offerLink.dispatchEvent(new CustomEvent('bm-tooltip-updated', { bubbles: true }));
                }

                discountRow.dataset.bmDiscountApplied = 'true';
                discountRow.dataset.bmRetailerRate = String(match.rate);
                discountRow.dataset.bmRetailerDomain = match.domain;
                discountRow.dataset.bmEffectivePrice = String(effectivePrice);
                if (effectiveDiscountPercent !== null) {
                    discountRow.dataset.bmEffectiveDiscount = String(effectiveDiscountPercent);
                } else {
                    delete discountRow.dataset.bmEffectiveDiscount;
                }
                discountRow.classList.add('bm-has-retailer-discount');
            }
        });
    }

    // ==========================================
    // 4. RABATT-RECHNER PRO MODUL
    // ==========================================
    if (setNum) {
        let isModifying = false;

        function calculateDiscount() {
            if (isModifying) return;
            isModifying = true;

            try {
                // Alte Elemente entfernen (falls Seite dynamisch neu lädt)
                document.querySelectorAll('.black-discount-bubble').forEach(el => el.remove());
                const existingRow = document.getElementById('all-time-bestpreis-discount');
                if (existingRow) existingRow.remove();

                const prices = [];

                // Aktuelle Preise sammeln
                const priceElements = document.querySelectorAll('.theprice, .price, .offer-price, td.price, span.price, .topprice');
                priceElements.forEach(el => {
                    if (el.closest('del') || el.closest('.strike') || el.closest('.uvp') || window.getComputedStyle(el).textDecoration.includes('line-through')) {
                        return;
                    }
                    if (el.classList.contains('shipping') || el.closest('.shipping-costs')) {
                        return;
                    }

                    const text = el.textContent.trim();
                    const priceMatch = text.match(/(\d+[\d\s.,]*)\s*€/);
                    if (priceMatch) {
                        let priceStr = priceMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
                        let price = parseFloat(priceStr);
                        if (!isNaN(price) && price > 0) {
                            prices.push(price);
                        }
                    }
                });

                const uniqueSortedPrices = [...new Set(prices)].sort((a, b) => a - b);

                if (uniqueSortedPrices.length >= 2) {
                    const price1 = uniqueSortedPrices[0]; // Günstigster Shop
                    // uniqueSortedPrices entsteht aus einem Set numerischer Werte, d.h. exakt
                    // identische Preise sind hier bereits herausgefiltert. price2 ist also immer
                    // schon der nächst-*unterschiedliche* (höhere) Preis - "wenn zweitbestes
                    // identisch, dann drittbestes nehmen" ist dadurch automatisch erfüllt.
                    const price2 = uniqueSortedPrices[1]; // nächstteureres, abweichendes Angebot

                    // Rabatt als ganze Zahl runden
                    const discount = ((1 - (price1 / price2)) * 100).toFixed(0);

                    if (discount > 0) {
                        const redBubbles = document.querySelectorAll('.off');
                        if (redBubbles.length > 0) {
                            createBlackBubble(discount, redBubbles);
                        } else {
                            // Kein rotes UVP-Rabatt-Badge vorhanden (Preis liegt aktuell auf/über
                            // UVP) - trotzdem eine eigene schwarze Bubble mit dem Abstand zum
                            // zweitbesten (bzw. nächst-unterschiedlichen) Angebot anzeigen.
                            createStandaloneBlackBubble(discount);
                        }
                    }
                }

                // All-Time-Bestpreis suchen und einfügen
                if (uniqueSortedPrices.length >= 1) {
                    const currentBestPrice = uniqueSortedPrices[0];
                    const historicalData = findAllTimeBestPrice();
                    if (historicalData) {
                        insertAllTimeDiscountRow(currentBestPrice, historicalData.price, historicalData.element);
                    }
                }

            } catch (e) {
                console.error("Fehler im Brickmerge-Script:", e);
            } finally {
                isModifying = false;
            }
        }

        // Funktion für die schwarze Bubble (klont vorhandene rote .off-Badges)
        function createBlackBubble(discountText, redBubbles) {
            redBubbles.forEach(redBubble => {
                const blackBubble = redBubble.cloneNode(true);
                blackBubble.classList.add('black-discount-bubble');

                // Text auf ganze Prozent setzen
                blackBubble.textContent = `${discountText}%`;

                // Styling: Schwarz statt rot/orange
                blackBubble.style.setProperty('background-color', '#222222', 'important');
                blackBubble.style.setProperty('background', '#222222', 'important');
                blackBubble.style.setProperty('border-color', '#000000', 'important');
                blackBubble.style.setProperty('color', '#ffffff', 'important');
                blackBubble.style.setProperty('z-index', '99', 'important');

                // Behebt die Überlappung: Schiebt die Bubble exakt um ihre eigene Höhe + 8px Abstand nach unten
                blackBubble.style.setProperty('transform', 'translateY(calc(100% + 8px))', 'important');

                redBubble.parentNode.insertBefore(blackBubble, redBubble.nextSibling);
            });
        }

        // Fallback-Bubble, wenn keine rote .off-Bubble existiert (z.B. weil der
        // aktuelle Preis auf/über der UVP liegt und die Seite deshalb kein
        // UVP-Rabatt-Badge rendert). Wird direkt neben den Preis im
        // "Top-Angebot"-Kasten (.topprice) gehängt, da dieser Container auch nach
        // dem Cleaner-Modul zuverlässig erhalten bleibt.
        function createStandaloneBlackBubble(discountText) {
            const topprice = document.querySelector('.topprice');
            if (!topprice) return;

            // Die Preis-Spalte robust anhand des €-Zeichens finden, statt uns auf eine
            // feste nth-child-Position zu verlassen (die je nach Cleaner-Lauf variieren kann).
            const priceCells = topprice.querySelectorAll('a > div');
            const priceCell = Array.from(priceCells).find(d => d.textContent.includes('€')) || topprice;

            const badge = document.createElement('span');
            badge.className = 'black-discount-bubble';
            badge.textContent = `${discountText}%`;
            badge.title = `${discountText}% günstiger als das nächstteurere Angebot`;
            badge.style.setProperty('display', 'inline-block', 'important');
            badge.style.setProperty('background-color', '#222222', 'important');
            badge.style.setProperty('color', '#ffffff', 'important');
            badge.style.setProperty('border-radius', '999px', 'important');
            badge.style.setProperty('padding', '0.1rem 0.6rem', 'important');
            badge.style.setProperty('font-size', '0.8rem', 'important');
            badge.style.setProperty('font-weight', 'bold', 'important');
            badge.style.setProperty('margin-left', '0.6em', 'important');
            badge.style.setProperty('vertical-align', 'middle', 'important');

            priceCell.appendChild(badge);
        }

        // Suche nach dem "bisherigen Bestpreis"
        function findAllTimeBestPrice() {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;

            while (node = walker.nextNode()) {
                if (node.nodeValue.toLowerCase().includes('bisheriger bestpreis')) {
                    let container = node.parentElement;
                    const text = container.textContent;

                    const match = text.match(/(\d+[\d\s.,]*)\s*€/);
                    if (match) {
                        let price = parseFloat(match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
                        if (price > 0) {
                            // Hinweis: bewusst KEIN Hochklettern mehr zu LI/DIV/P/TR.
                            // Auf Detailseiten steckt "bisheriger Bestpreis" in einem
                            // einzigen großen <p> zusammen mit vielen anderen Infozeilen;
                            // das alte Hochklettern hängte die Vergleichszeile dadurch
                            // ans Ende des kompletten Absatzes statt direkt dahinter.
                            return { element: container, price: price };
                        }
                    }
                }
            }
            return null;
        }

        // Fügt die Rabatt-Zeile ein
        function insertAllTimeDiscountRow(currentPrice, allTimeBest, matchedElement) {
            // Differenz: Negativ = günstiger, Positiv = teurer
            const diffPercent = ((currentPrice - allTimeBest) / allTimeBest) * 100;

            // Farbe: Grün, wenn günstiger oder gleich (negativ/0), Rot wenn teurer (positiv)
            const color = diffPercent <= 0 ? '#1b5e20' : '#b71c1c';
            const signPrefix = diffPercent > 0 ? '+' : '';
            const percentStr = `${signPrefix}${diffPercent.toFixed(1).replace('.', ',')}%`;

            // Als eigene Zeile einfügen: die umliegenden Infozeilen (UVP, 180-Tage-
            // Bestpreis, etc.) sind alle durch "<br />&nbsp;|" voneinander getrennt,
            // hier wird exakt demselben Muster gefolgt, statt inline anzuhängen
            // (sonst rutscht der Text ohne Umbruch direkt hinter "vor X Tagen").
            const newEl = document.createElement('span');
            newEl.id = 'all-time-bestpreis-discount';
            newEl.innerHTML = `<br />&nbsp;<span class="contentcolor" style="color: #b00;">|</span> <a class="bm-price-history-link" href="#chartContainer" aria-controls="bigChart">Differenz zum ATB: <strong style="color: ${color};">${percentStr}</strong></a>`;

            matchedElement.parentNode.insertBefore(newEl, matchedElement.nextSibling);
            decoratePriceHistoryLinks();
        }

        // MutationObserver für den Rabatt-Rechner (überwacht asynchrones Nachladen)
        // Bewusst auf #offerlist statt document.body beschränkt: sonst feuert der
        // Observer bei jedem AmCharts-Redraw (#chartdiv2) und beim asynchronen
        // "#soldOut"-Nachladen unnötig oft.
        let checkTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(checkTimer);
            checkTimer = setTimeout(() => {
                calculateDiscount();
            }, 300);
        });
        const observeTarget = document.getElementById('offerlist') || document.body;
        observer.observe(observeTarget, { childList: true, subtree: true });

        // Erstmaliger Start des Rabatt-Rechners
        window.addEventListener('load', () => {
            setTimeout(() => {
                calculateDiscount();
            }, 500);
        });

        // #offerlist ist serverseitig bereits vorhanden. Dieser Start deckt auch
        // den seltenen Fall ab, dass das Userscript erst nach dem load-Event läuft.
        setTimeout(() => {
            calculateDiscount();
        }, 100);
    }

    // ==========================================
    // 6. VERSANDKOSTEN + SORTIERUNG
    // ==========================================
    function removeOfferListPriceDecorations() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        offerlist.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid]'
        ).forEach(priceRow => {
            priceRow.style.removeProperty('background-image');
            priceRow.style.removeProperty('background-size');
            priceRow.closest('.row.collapse')?.querySelectorAll('.lowest')
                .forEach(element => element.classList.remove('lowest'));
        });

        offerlist.querySelectorAll('.price > span[style]').forEach(span => {
            const isAbsoluteBadge = span.style.position === 'absolute';
            const isPercentage = /^\s*\d+(?:[.,]\d+)?\s*%\s*$/.test(span.textContent);
            if (isAbsoluteBadge && isPercentage) span.remove();
        });
    }

    function injectMyBrickDepotOffers(offers) {
        const offerlist = document.getElementById('offerlist');
        const firstPriceRow = offerlist?.querySelector(
            '.medium-4.small-9.columns.pricerow[data-mid]:not([data-bm-source="mybrickdepot"])'
        );
        const parent = firstPriceRow?.closest('.row.collapse')?.parentElement;
        if (!offerlist || !parent) return;

        parent.querySelectorAll('.bm-mbd-offer').forEach(row => row.remove());

        offers.forEach(offer => {
            const price = parseEuroValue(offer.priceText);
            if (price === null || !offer.url) return;

            const mid = `mbd-${offer.key}`;
            const wrapper = document.createElement('div');
            wrapper.className = 'row collapse bm-mbd-offer';
            wrapper.dataset.bmSource = 'mybrickdepot';

            const iconColumn = document.createElement('div');
            iconColumn.className = 'goto medium-1 small-3 columns';
            const iconRow = document.createElement('div');
            iconRow.id = `mid${mid}`;
            iconRow.className = `pricerow ${mid} row-a text-center`;
            iconRow.dataset.mid = mid;
            const iconLink = document.createElement('a');
            iconLink.href = offer.url;
            iconLink.target = '_blank';
            iconLink.rel = 'noopener noreferrer';
            iconLink.title = `${offer.label} öffnen`;
            if (offer.key === 'ebay') {
                iconLink.classList.add('bm-mbd-logo-stack');
                const sourceLabel = document.createElement('span');
                sourceLabel.className = 'bm-mbd-source-label';
                sourceLabel.textContent = 'MyBrickDepot';
                iconLink.appendChild(sourceLabel);
            }
            if (offer.logoUrl) {
                const image = document.createElement('img');
                image.src = offer.logoUrl;
                image.alt = offer.label;
                image.className = 'bm-marketplace-logo';
                if (offer.key === 'amz') image.classList.add('bm-keepa-logo');
                image.loading = 'lazy';
                image.decoding = 'async';
                image.referrerPolicy = 'no-referrer';
                iconLink.appendChild(image);
            } else {
                iconLink.textContent = offer.label.slice(0, 1);
            }
            iconRow.appendChild(iconLink);
            iconColumn.appendChild(iconRow);

            const priceRow = document.createElement('div');
            priceRow.className = `medium-4 small-9 columns pricerow ${mid} row-a`;
            priceRow.dataset.mid = mid;
            priceRow.dataset.bmSource = 'mybrickdepot';
            priceRow.dataset.bmShippingUnknown = 'true';

            const offerLink = document.createElement('a');
            offerLink.href = offer.url;
            offerLink.target = '_blank';
            offerLink.rel = 'noopener noreferrer';
            offerLink.className = 'tooltipster';
            offerLink.title =
                `Link zu ${offer.label} - Preis: ${formatEuroValue(price)} €. ` +
                `Versandkosten unbekannt.`;

            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            const merchant = document.createElement('span');
            merchant.className = 'show-for-small-only merchant';
            merchant.append(`${offer.label}`);
            merchant.appendChild(document.createElement('br'));
            priceSpan.appendChild(merchant);
            priceSpan.append(`${formatEuroValue(price)} €`);
            offerLink.appendChild(priceSpan);
            priceRow.appendChild(offerLink);

            wrapper.appendChild(iconColumn);
            wrapper.appendChild(priceRow);
            parent.appendChild(wrapper);
        });

        scheduleOfferPresentation();
    }

    // Fehlt bei Brickmerge eine Versandangabe, gilt das Angebot als versandkostenfrei.
    // Die zusätzlich abgefragten Marktplatzpreise sind die einzige Ausnahme.
    function parseEuroValue(text) {
        if (!text) return null;
        const match = text.match(/(\d+[\d\s.,]*)\s*€/);
        if (!match) return null;
        const value = parseFloat(match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(value) ? value : null;
    }

    function formatEuroValue(value) {
        return value.toLocaleString('de-DE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function normalizeMerchantClickOuts() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist || !setNum) return;

        offerlist.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid] > a'
        ).forEach(link => {
            const mid = link.closest('[data-mid]')?.dataset.mid;
            if (!mid) return;

            let currentUrl;
            try {
                currentUrl = new URL(link.href, window.location.origin);
            } catch (e) {
                return;
            }

            const isBrickmergeRedirect = currentUrl.origin === window.location.origin &&
                (
                    currentUrl.pathname === '/go2/' ||
                    currentUrl.searchParams.has('go2i') ||
                    currentUrl.searchParams.has('go2m') ||
                    /\/go2\/\?/i.test(link.getAttribute('onclick') || '')
                );
            if (!isBrickmergeRedirect) return;

            const itemNumber = currentUrl.searchParams.get('i') ||
                currentUrl.searchParams.get('go2i') ||
                `${setNum}-1`;
            const directRedirect = new URL('/go2/', window.location.origin);
            directRedirect.searchParams.set('m', mid);
            directRedirect.searchParams.set('i', itemNumber);

            link.href = `${directRedirect.pathname}${directRedirect.search}`;
            link.removeAttribute('onclick');
        });
    }

    function getBaseOfferPrice(priceSpan) {
        const originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
        if (originalPrice) {
            const value = parseEuroValue(originalPrice.textContent);
            if (value !== null) {
                priceSpan.dataset.bmBasePrice = String(value);
                return value;
            }
        }

        const storedPrice = Number(priceSpan.dataset.bmBasePrice);
        if (Number.isFinite(storedPrice) && storedPrice > 0) return storedPrice;

        const clone = priceSpan.cloneNode(true);
        clone.querySelectorAll('span').forEach(span => span.remove());
        const value = parseEuroValue(clone.textContent);
        if (value !== null) priceSpan.dataset.bmBasePrice = String(value);
        return value;
    }

    function ensureOriginalPriceElement(priceSpan) {
        let originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
        if (originalPrice) return originalPrice;

        const basePrice = getBaseOfferPrice(priceSpan);
        if (basePrice === null) return null;

        const priceTextNode = Array.from(priceSpan.childNodes).find(node => {
            return node.nodeType === 3 && parseEuroValue(node.textContent) !== null;
        });
        if (!priceTextNode) return null;

        originalPrice = document.createElement('span');
        originalPrice.className = 'bm-original-price';
        originalPrice.textContent = `${formatEuroValue(basePrice)} €`;
        priceTextNode.replaceWith(originalPrice);
        return originalPrice;
    }

    function placeNodeAfter(referenceNode, node) {
        if (referenceNode.nextSibling !== node) referenceNode.after(node);
    }

    function getNativeShippingSpan(priceSpan) {
        return Array.from(priceSpan.querySelectorAll(':scope > span.small'))
            .find(span => {
                if (span.classList.contains('merchant') ||
                    span.classList.contains('code') ||
                    span.classList.contains('show-for-small-only') ||
                    span.classList.contains('bm-effective-info')) return false;
                return /VK|Versand|^\+\s*[\d.,]+\s*€\s*=/i.test(span.textContent.trim());
            }) || null;
    }

    function readShippingDetails(priceSpan) {
        if (priceSpan.closest('[data-bm-shipping-unknown="true"]')) {
            return { status: 'unknown', cost: null };
        }

        const title = getOriginalOfferTitle(priceSpan.closest('a'));
        const titleCostMatch = title.match(
            /\+\s*(?:Versand(?:skosten)?)\s*(\d+[\d\s.,]*)\s*€/i
        );
        if (titleCostMatch) {
            const cost = parseEuroValue(`${titleCostMatch[1]} €`);
            if (cost !== null) return { status: 'paid', cost };
        }
        if (/Versandkostenfrei|kostenloser Versand|VK frei/i.test(title)) {
            return { status: 'free', cost: 0 };
        }

        const nativeShipping = getNativeShippingSpan(priceSpan);
        if (nativeShipping) {
            const nativeText = nativeShipping.textContent.trim();
            if (/VK frei|Versandkostenfrei|kostenloser Versand/i.test(nativeText)) {
                return { status: 'free', cost: 0 };
            }
            const nativeCost = parseEuroValue(nativeText);
            if (nativeCost !== null) return { status: 'paid', cost: nativeCost };
        }

        return { status: 'free', cost: 0 };
    }

    function injectShippingCostsFromOfferTitles() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const basePrice = getBaseOfferPrice(priceSpan);
            if (basePrice === null) return;

            const shipping = readShippingDetails(priceSpan);
            const shippingStatus = shipping.status === 'paid'
                ? 'paid'
                : shipping.status === 'unknown'
                    ? 'unknown'
                    : 'free';
            let small = priceSpan.querySelector(':scope > .bm-shipping-info') ||
                getNativeShippingSpan(priceSpan);
            if (!small) {
                small = document.createElement('span');
                priceSpan.appendChild(small);
            }

            small.className = 'small bm-shipping-info';
            small.classList.add(`bm-shipping-${shippingStatus}`);
            small.dataset.shippingStatus = shippingStatus;
            const setShippingText = text => {
                if (small.textContent !== text) small.textContent = text;
            };

            if (shippingStatus === 'paid') {
                small.dataset.shippingCost = String(shipping.cost);
                setShippingText(`VK ${formatEuroValue(shipping.cost)} €`);
                small.title = `Versandkosten: ${formatEuroValue(shipping.cost)} €; Gesamtpreis: ${formatEuroValue(basePrice + shipping.cost)} €`;
            } else if (shippingStatus === 'free') {
                small.dataset.shippingCost = '0';
                setShippingText('VK frei');
                small.title = `Versandkostenfrei; Gesamtpreis: ${formatEuroValue(basePrice)} €`;
            } else {
                delete small.dataset.shippingCost;
                setShippingText('VK unbekannt');
                small.title = 'Versandkosten und Gesamtpreis unbekannt';
            }
        });
    }

    function getOfferMerchantName(priceSpan) {
        const merchantSpan = priceSpan.querySelector('.merchant');
        const merchantText = merchantSpan?.textContent?.trim();
        if (merchantText) return merchantText;

        const row = priceSpan.closest('[data-mid]');
        const mid = row?.getAttribute('data-mid');
        const icon = mid ? document.querySelector(`#mid${mid} img[alt]`) : null;
        if (icon?.alt) return icon.alt.trim();

        const title = getOriginalOfferTitle(priceSpan.closest('a'));
        return title.match(/Link zu (.+?)(?:\s+-\s+|$)/i)?.[1]?.trim() || '';
    }

    function formatPercentValue(value, maximumFractionDigits = 1, minimumFractionDigits = 1) {
        return value.toLocaleString('de-DE', {
            minimumFractionDigits,
            maximumFractionDigits
        });
    }

    function updateOfferTooltips() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const offerLink = priceSpan.closest('a');
            const priceRow = priceSpan.closest('.pricerow');
            const offerPrice = getBaseOfferPrice(priceSpan);
            const shippingSpan = priceSpan.querySelector(':scope > .bm-shipping-info');
            if (!offerLink || !priceRow || offerPrice === null || !shippingSpan) return;

            const originalTooltip = getOriginalOfferTitle(offerLink);
            const merchantName = getOfferMerchantName(priceSpan);
            const shippingStatus = shippingSpan.dataset.shippingStatus === 'paid'
                ? 'paid'
                : shippingSpan.dataset.shippingStatus === 'unknown'
                    ? 'unknown'
                    : 'free';
            const shippingCost = shippingStatus === 'paid'
                ? Number(shippingSpan.dataset.shippingCost || 0)
                : shippingStatus === 'free'
                    ? 0
                    : null;
            const totalPrice = shippingCost === null ? null : offerPrice + shippingCost;
            const retailerRate = Number(priceRow.dataset.bmRetailerRate || 0);
            const effectivePrice = Math.round(
                (offerPrice * (1 - retailerRate) + Number.EPSILON) * 100
            ) / 100;
            const uvp = getCurrentSetUvp();
            const parts = [];

            if (merchantName) parts.push(`Händler: ${merchantName}.`);
            parts.push(`Angebotspreis: ${formatEuroValue(offerPrice)} €.`);

            if (shippingStatus === 'paid') {
                parts.push(`Versandkosten: ${formatEuroValue(shippingCost)} €.`);
            } else if (shippingStatus === 'free') {
                parts.push('Versandkosten: frei.');
            } else {
                parts.push('Versandkosten: unbekannt.');
            }

            if (totalPrice === null) {
                parts.push('Gesamtpreis: wegen unbekannter Versandkosten nicht berechenbar.');
            } else {
                parts.push(`Gesamtpreis: ${formatEuroValue(totalPrice)} €.`);
            }

            if (retailerRate > 0) {
                parts.push(`Gutscheinrabatt: ${formatPercentValue(retailerRate * 100, 2, 0)}%.`);
                let effectiveText = `Effektiv: ${formatEuroValue(effectivePrice)} €`;
                if (uvp !== null && uvp > 0) {
                    const effectiveDiscount = Math.max(0, (1 - (effectivePrice / uvp)) * 100);
                    effectiveText += ` (${formatPercentValue(effectiveDiscount)}% zur UVP)`;
                }
                parts.push(`${effectiveText}.`);
                if (shippingCost === null) {
                    parts.push('Effektiver Gesamtpreis: wegen unbekannter Versandkosten nicht berechenbar.');
                } else {
                    parts.push(`Effektiver Gesamtpreis: ${formatEuroValue(effectivePrice + shippingCost)} €.`);
                }
            } else if (uvp !== null && uvp > 0) {
                const uvpDiscount = Math.max(0, (1 - (offerPrice / uvp)) * 100);
                parts.push(`Rabatt zur UVP: ${formatPercentValue(uvpDiscount)}%.`);
            }

            const timestamp = originalTooltip.match(/Preisangabe vom\s+(.+?):\s*[\d.,]+\s*€/i)?.[1];
            if (timestamp) parts.push(`Stand: ${timestamp}.`);

            const tooltip = parts.join(' ');
            offerLink.dataset.bmTooltip = tooltip;
            offerLink.setAttribute('title', tooltip);
            offerLink.dispatchEvent(new CustomEvent('bm-tooltip-updated', { bubbles: true }));
        });
    }

    function syncEffectivePriceLabels() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        offerlist.querySelectorAll('.bm-best-price-label').forEach(label => label.remove());
        offerlist.querySelectorAll('.bm-effective-row').forEach(row => {
            row.classList.remove('bm-effective-row');
        });
        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const priceRow = priceSpan.closest('.pricerow');
            const retailerRate = Number(priceRow?.dataset.bmRetailerRate || 0);
            let info = priceSpan.querySelector(':scope > .bm-effective-info');
            const originalPrice = priceSpan.querySelector(':scope > .bm-original-price');
            const shipping = priceSpan.querySelector(':scope > .bm-shipping-info');
            const merchant = priceSpan.querySelector(':scope > .merchant');

            if (!priceRow || retailerRate <= 0) {
                info?.remove();
                if (originalPrice) {
                    originalPrice.classList.remove('bm-original-secondary');
                    originalPrice.removeAttribute('title');
                    originalPrice.removeAttribute('aria-label');
                    if (merchant) {
                        placeNodeAfter(merchant, originalPrice);
                    } else if (priceSpan.firstChild !== originalPrice) {
                        priceSpan.prepend(originalPrice);
                    }
                    if (shipping) placeNodeAfter(originalPrice, shipping);
                }
                return;
            }

            const offerPrice = getBaseOfferPrice(priceSpan);
            if (offerPrice === null) {
                info?.remove();
                return;
            }

            const effectivePrice = Math.round(
                (offerPrice * (1 - retailerRate) + Number.EPSILON) * 100
            ) / 100;
            const label = `(effektiv ${formatEuroValue(effectivePrice)} €)`;

            if (!info) {
                info = document.createElement('span');
                info.className = 'bm-effective-info';
            }
            const stableOriginalPrice = originalPrice || ensureOriginalPriceElement(priceSpan);
            if (!stableOriginalPrice) {
                info.remove();
                return;
            }

            stableOriginalPrice.classList.remove('bm-original-secondary');
            stableOriginalPrice.title = `Angebotspreis: ${formatEuroValue(offerPrice)} €`;
            stableOriginalPrice.setAttribute(
                'aria-label',
                `Angebotspreis ${formatEuroValue(offerPrice)} Euro`
            );

            if (merchant) {
                placeNodeAfter(merchant, stableOriginalPrice);
            } else if (priceSpan.firstChild !== stableOriginalPrice) {
                priceSpan.prepend(stableOriginalPrice);
            }
            placeNodeAfter(stableOriginalPrice, info);
            if (shipping) {
                placeNodeAfter(info, shipping);
            }

            priceRow.closest('.row.collapse')?.classList.add('bm-effective-row');
            if (info.textContent !== label) info.textContent = label;
            info.title = `Persönlicher Rabatt: ${formatPercentValue(retailerRate * 100, 2, 0)}%`;
        });
    }

    function syncOfferDiscountBubbles() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        const uvp = getCurrentSetUvp();
        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            const priceRow = priceSpan.closest('.pricerow');
            const basePrice = getBaseOfferPrice(priceSpan);
            const retailerRate = Number(priceRow?.dataset.bmRetailerRate || 0);
            const comparedPrice = basePrice === null
                ? null
                : Math.round(
                    (basePrice * (1 - retailerRate) + Number.EPSILON) * 100
                ) / 100;
            const shippingSpan = priceSpan.querySelector(
                ':scope > .bm-shipping-info'
            );
            const shippingStatus = shippingSpan?.dataset.shippingStatus;
            const shippingCost =
                shippingStatus === 'paid'
                    ? Number(shippingSpan.dataset.shippingCost || 0)
                    : null;
            let discountPercent = null;
            let totalDiscountPercent = null;

            if (comparedPrice !== null && uvp !== null && uvp > 0) {
                discountPercent = (1 - (comparedPrice / uvp)) * 100;
                if (shippingCost !== null && Number.isFinite(shippingCost)) {
                    totalDiscountPercent =
                        (1 - ((comparedPrice + shippingCost) / uvp)) * 100;
                }
            } else {
                const title = getOriginalOfferTitle(priceSpan.closest('a'));
                const originalDiscount = title.match(
                    /(\d+(?:[.,]\d+)?)%\)\s*gespart/i
                );
                if (originalDiscount) {
                    const baseDiscount = Number(
                        originalDiscount[1].replace(',', '.')
                    ) / 100;
                    discountPercent = retailerRate > 0
                        ? (1 - ((1 - baseDiscount) * (1 - retailerRate))) * 100
                        : baseDiscount * 100;
                }
            }

            let bubble = priceSpan.querySelector(':scope > .bm-offer-discount-bubble');
            priceSpan.querySelectorAll(':scope > .bm-offer-discount-bubble')
                .forEach((candidate, index) => {
                    if (index > 0) candidate.remove();
                });

            if (discountPercent === null || discountPercent <= 0) {
                bubble?.remove();
            } else {
                if (!bubble) {
                    bubble = document.createElement('span');
                    bubble.className = 'bm-offer-discount-bubble';
                    priceSpan.appendChild(bubble);
                }
                const label = `${Math.round(discountPercent)}%`;
                if (bubble.textContent !== label) bubble.textContent = label;
                bubble.title =
                    `Rabatt zur UVP: ${formatPercentValue(discountPercent)}%`;
                bubble.setAttribute(
                    'aria-label',
                    `Rabatt zur UVP ${formatPercentValue(discountPercent)} Prozent`
                );
            }

            let totalBubble = priceSpan.querySelector(
                ':scope > .bm-total-discount-bubble'
            );
            priceSpan.querySelectorAll(':scope > .bm-total-discount-bubble')
                .forEach((candidate, index) => {
                    if (index > 0) candidate.remove();
                });

            if (totalDiscountPercent === null || totalDiscountPercent <= 0) {
                totalBubble?.remove();
                return;
            }

            if (!totalBubble) {
                totalBubble = document.createElement('span');
                totalBubble.className = 'bm-total-discount-bubble';
                priceSpan.appendChild(totalBubble);
            }
            const totalLabel = `${Math.round(totalDiscountPercent)}%`;
            if (totalBubble.textContent !== totalLabel) {
                totalBubble.textContent = totalLabel;
            }
            totalBubble.title =
                `Rabatt zur UVP inklusive Versand: ${formatPercentValue(totalDiscountPercent)}%`;
            totalBubble.setAttribute(
                'aria-label',
                `Rabatt zur UVP inklusive Versand ${formatPercentValue(totalDiscountPercent)} Prozent`
            );
        });
    }

    function sortOffersByConfiguredPrice() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        const personalSettings = loadPersonalDiscountSettings();
        const sortMode = personalSettings.enabled ? 'effective' : 'offer';

        const offers = Array.from(
            offerlist.querySelectorAll('.medium-4.small-9.columns.pricerow[data-mid]')
        ).filter(priceRow => !priceRow.closest('#soldOut')).map((priceRow, originalIndex) => {
            const priceSpan = priceRow.querySelector('span.price');
            const basePrice = priceSpan ? getBaseOfferPrice(priceSpan) : null;
            const retailerRate = Number(priceRow.dataset.bmRetailerRate || 0);
            const effectivePrice = basePrice === null
                ? null
                : Math.round((basePrice * (1 - retailerRate) + Number.EPSILON) * 100) / 100;
            return {
                wrapper: priceRow.closest('.row.collapse'),
                priceRow,
                priceSpan,
                price: sortMode === 'effective' ? effectivePrice : basePrice,
                originalIndex
            };
        }).filter(offer => offer.wrapper && offer.wrapper.parentElement);

        const groups = new Map();
        offers.forEach(offer => {
            const parent = offer.wrapper.parentElement;
            if (!groups.has(parent)) groups.set(parent, []);
            groups.get(parent).push(offer);
        });

        groups.forEach((group, parent) => {
            const originalOrder = group.map(offer => offer.wrapper);
            const insertionAnchor = originalOrder[originalOrder.length - 1]?.nextSibling || null;
            group.sort((a, b) => {
                if (a.price === null && b.price === null) return a.originalIndex - b.originalIndex;
                if (a.price === null) return 1;
                if (b.price === null) return -1;
                return (a.price - b.price) || (a.originalIndex - b.originalIndex);
            });

            group.forEach((offer, index) => {
                const stripeClass = index % 2 === 0 ? 'row-b' : 'row-a';
                offer.wrapper.querySelectorAll('.row-a, .row-b').forEach(element => {
                    element.classList.remove('row-a', 'row-b');
                    element.classList.add(stripeClass);
                });

                offer.wrapper.querySelectorAll('.lowest').forEach(element => element.classList.remove('lowest'));
            });

            const orderChanged = group.some(
                (offer, index) => offer.wrapper !== originalOrder[index]
            );
            if (orderChanged) {
                const fragment = document.createDocumentFragment();
                group.forEach(offer => fragment.appendChild(offer.wrapper));
                parent.insertBefore(fragment, insertionAnchor);
            }
        });
    }

    let offerPresentationRunning = false;
    function applyOfferPresentation() {
        if (offerPresentationRunning) return;
        offerPresentationRunning = true;
        try {
            removeOfferListPriceDecorations();
            normalizeMerchantClickOuts();
            injectShippingCostsFromOfferTitles();
            applyRetailerDiscounts();
            sortOffersByConfiguredPrice();
            moveSoldOutAfterAvailableOffers();
            updateOfferTooltips();
            syncEffectivePriceLabels();
            syncOfferDiscountBubbles();
            decoratePriceHistoryLinks();
            createDiscountSettingsUI();
        } finally {
            offerPresentationRunning = false;
        }
    }

    let offerPresentationTimer;
    const scheduleOfferPresentation = () => {
        clearTimeout(offerPresentationTimer);
        offerPresentationTimer = setTimeout(applyOfferPresentation, 80);
    };

    const offerPresentationTarget = document.getElementById('offerlist');
    if (offerPresentationTarget) {
        const offerPresentationObserver = new MutationObserver(scheduleOfferPresentation);
        offerPresentationObserver.observe(offerPresentationTarget, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    if (document.readyState === 'complete') {
        scheduleOfferPresentation();
    } else {
        window.addEventListener('load', scheduleOfferPresentation, { once: true });
    }

})();
