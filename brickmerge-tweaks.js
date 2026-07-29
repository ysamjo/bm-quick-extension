// ==UserScript==
// @name         Brickmerge Tweaker
// @namespace    https://brickmerge.de/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=brickmerge.de
// @version      3.70
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
// @connect      www.brickowl.com
// @connect      brickowl.com
// @connect      *.brickowl.com
// @connect      mybrickdepot.de
// @connect      brickbank.app
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
// @downloadURL  https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
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

    // Die originalen Brickmerge-Angebotslinks bleiben unverändert. Auf einer
    // zwischengeschalteten Weiterleitungsseite wird der Shop-Link sofort
    // betätigt, auch wenn er erst nachträglich gerendert wird.
    function autoContinueBrickmergeRedirect() {
        const pageText = () => (document.body?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        const pathLooksLikeRedirect =
            /\/(?:go2|redirect|weiterleitung)\/?$/i.test(location.pathname);
        const pageLooksLikeRedirect = () => {
            const text = pageText();
            return /\bweiterleitung\b/i.test(text) &&
                /du verlässt nun die webseite brickmerge\.de|gewünschten shopseite/i.test(text);
        };
        if (!pathLooksLikeRedirect && !pageLooksLikeRedirect()) return false;

        let completed = false;
        const continueRedirect = () => {
            if (completed) return true;
            const target = Array.from(
                document.querySelectorAll('a, button, input[type="submit"], input[type="button"]')
            ).find(element => {
                const label = [
                    element.textContent,
                    element.value,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title')
                ].filter(Boolean).join(' ');
                const isBackLink = /zurück|homepage/i.test(label);
                const isContinueLink =
                    /jetzt\s+weiterleiten/i.test(label) ||
                    (/\bzur\b/i.test(label) &&
                        /\b(?:shop|shops|shopseite)\b/i.test(label));
                return !isBackLink && isContinueLink;
            });
            if (!target) return false;

            completed = true;
            if (target instanceof HTMLAnchorElement) {
                target.target = '_self';
            }
            target.click();
            return true;
        };

        if (continueRedirect()) return true;

        const observer = new MutationObserver(() => {
            if (!continueRedirect()) return;
            observer.disconnect();
            window.clearTimeout(timeout);
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        const timeout = window.setTimeout(() => observer.disconnect(), 10000);
        return true;
    }

    if (autoContinueBrickmergeRedirect()) return;

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
            const isMyBrickDepotEbay =
                priceRow.dataset.bmSource === 'mybrickdepot' &&
                String(mid) === 'mbd-ebay';
            const label = isMyBrickDepotEbay
                ? 'eBay (MyBrickDepot)'
                : getOfferMerchantName(priceSpan) ||
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
           die (davon ohnehin unabhängige) Mobile-Ansicht unverändert bleibt. */
        @media screen and (min-width: 641px) {
            #offerlist div.medium-4.small-9.columns.pricerow {
                width: 91.6667% !important;
            }
        }
        #offerlist .pricerow > a > .price {
            width: 95% !important;
            border: none !important;
        }
        #offerlist span.price,
        #offerlist span.price > .merchant,
        #offerlist span.price > .merchant * {
            color: #b00 !important;
        }
        #offerlist .row.collapse.bm-marketplace-offer {
            box-shadow: inset 3px 0 0 #d4ad32;
        }
        #offerlist .row.collapse.bm-marketplace-offer > .goto.small-3.columns,
        #offerlist .row.collapse.bm-marketplace-offer
            > .goto.small-3.columns > .pricerow,
        #offerlist .row.collapse.bm-marketplace-offer
            > .medium-4.small-9.columns.pricerow {
            background-color: #fff3bf !important;
        }
        #offerlist .row.collapse.bm-sold-out-offer {
            position: relative;
            box-shadow: inset 3px 0 0 #777;
        }
        #offerlist .row.collapse.bm-sold-out-offer > .goto.small-3.columns,
        #offerlist .row.collapse.bm-sold-out-offer
            > .goto.small-3.columns > .pricerow,
        #offerlist .row.collapse.bm-sold-out-offer
            > .medium-4.small-9.columns.pricerow {
            background-color: #dedede !important;
        }
        #offerlist .bm-sold-out-overlay {
            position: absolute;
            inset: 0;
            z-index: 5;
            background: rgba(95, 95, 95, 0.24);
            pointer-events: none;
        }
        #offerlist .bm-sold-out-badge {
            position: relative;
            z-index: 6;
            display: inline-flex;
            align-items: center;
            margin-left: 0.45rem;
            padding: 0.12rem 0.38rem;
            border-radius: 2px;
            background: #b00000;
            color: #fff !important;
            font-size: 0.58rem;
            font-weight: 700;
            line-height: 1.15;
            vertical-align: middle;
            white-space: nowrap;
        }
        #offerlist .pricerow:hover span.price,
        #offerlist .pricerow:hover span.price > .merchant,
        #offerlist .pricerow:hover span.price > .merchant * {
            color: #fff !important;
        }
        .content.setdetails .productprice > p,
        .content.setdetails .productprice > .topprice {
            padding-left: 0 !important;
            padding-right: 0 !important;
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
        #offerlist .bm-marketplace-logo.bm-brickowl-logo {
            max-width: 54px;
            max-height: 16px;
            padding: 1px 3px;
            background: #4a3527;
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
        #offerlist .medium-4.small-9.columns.pricerow:hover > a,
        #offerlist .medium-4.small-9.columns.pricerow:hover span.price,
        #offerlist .medium-4.small-9.columns.pricerow:hover span.price
            > :not(.bm-total-discount-bubble),
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-original-price,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-effective-info,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-shipping-info,
        #offerlist .medium-4.small-9.columns.pricerow:hover .bm-shipping-unknown,
        #offerlist .medium-4.small-9.columns.pricerow:hover
            .price > span.small:not(.bm-total-discount-bubble) {
            color: #fff !important;
        }
        #offerlist .bm-offer-discount-bubble {
            position: absolute;
            top: 4px;
            right: 0.4rem;
            z-index: 4;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            min-width: 26px;
            min-height: 26px;
            padding: 0;
            border-radius: 1000px;
            background: #b00;
            color: #fff;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            box-sizing: border-box;
        }
        #offerlist .bm-total-discount-bubble {
            position: absolute;
            top: 4px;
            right: 2.45rem;
            z-index: 4;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            min-width: 26px;
            min-height: 26px;
            padding: 0;
            border: 1px solid #c9c9c9;
            border-radius: 1000px;
            background: #e7e7e7;
            color: #555;
            font-size: 0.7rem;
            font-weight: bolder;
            line-height: 1;
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
                top: 50%;
                right: 0.25rem;
                width: 32px;
                height: 32px;
                min-width: 32px;
                min-height: 32px;
                font-size: 0.78rem;
                transform: translateY(-50%);
            }
            #offerlist .bm-total-discount-bubble {
                top: 50%;
                right: 2.55rem;
                width: 32px;
                height: 32px;
                min-width: 32px;
                min-height: 32px;
                font-size: 0.78rem;
                transform: translateY(-50%);
            }
            #offerlist .price > .show-for-small-only.small {
                display: none !important;
            }
            #offerlist .row.collapse.bm-effective-row {
                min-height: 72px;
            }
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 72px !important;
                min-height: 72px !important;
            }
            #offerlist .row.collapse.bm-marketplace-offer,
            #offerlist .row.collapse.bm-marketplace-offer > .goto.small-3.columns,
            #offerlist .row.collapse.bm-marketplace-offer > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-marketplace-offer > .medium-4.small-9.columns.pricerow {
                height: 64px !important;
                min-height: 64px !important;
            }
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .goto.small-3.columns,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .goto.small-3.columns > .pricerow,
            #offerlist .row.collapse.bm-marketplace-offer.bm-effective-row > .medium-4.small-9.columns.pricerow {
                height: 72px !important;
                min-height: 72px !important;
            }
            #offerlist .bm-marketplace-logo {
                max-width: 72px;
                max-height: 31px;
            }
        }
        .bm-offer-gallery {
            display: none;
        }
        .bm-sidebar-instructions {
            display: none;
        }
        .bm-sidebar-parts {
            display: none;
        }
        .content.setdetails .topprice {
            position: relative !important;
        }
        .content.setdetails .large-3.medium-4.columns.hide-for-small,
        .content.setdetails .show-for-small-only.text-center {
            position: relative;
        }
        .content.setdetails .topprice span[style*="position: absolute"],
        .bm-bestprice-black-bubble {
            position: absolute !important;
            top: calc(50% + 4px) !important;
            left: auto !important;
            z-index: 100 !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 28px !important;
            height: 28px !important;
            min-width: 28px !important;
            min-height: 28px !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 999px;
            color: #fff !important;
            font-size: 0.7rem;
            font-weight: bold;
            line-height: 1 !important;
            text-align: center;
            transform: translateY(-50%) !important;
            box-sizing: border-box;
        }
        .content.setdetails .topprice span[style*="position: absolute"] {
            right: 0.65rem !important;
        }
        .bm-bestprice-black-bubble {
            right: 2.85rem !important;
            border: 1px solid #000 !important;
            background: #222 !important;
        }
        .bm-bestprice-black-bubble.bm-bestprice-black-bubble-single {
            right: 0.65rem !important;
        }
        .content.setdetails .large-3.medium-4.columns.hide-for-small
            > .off:not(.bm-bestprice-black-bubble),
        .content.setdetails .show-for-small-only.text-center
            > .off:not(.bm-bestprice-black-bubble) {
            top: 0.45rem !important;
            left: 0.75rem !important;
        }
        .bm-featured-black-bubble {
            position: absolute !important;
            top: 0.45rem !important;
            left: 0.75rem !important;
            z-index: 99 !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 54px !important;
            height: 54px !important;
            min-width: 54px !important;
            min-height: 54px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 1px solid #000 !important;
            border-radius: 999px !important;
            background: #222 !important;
            color: #fff !important;
            font-size: 1rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
            text-align: center;
            box-sizing: border-box;
        }
        .bm-full-product-description {
            float: none !important;
            clear: both;
            width: 100% !important;
            margin: 1.5rem 0 0 !important;
            padding-left: 0.9375rem !important;
            padding-right: 0.9375rem !important;
            padding-bottom: 0 !important;
            box-sizing: border-box;
        }
        .bm-full-product-description p,
        .bm-full-product-description li,
        .bm-full-product-description .padDoubleBottom {
            line-height: 1.5 !important;
        }
        .bm-full-product-description p {
            margin-bottom: 1rem;
        }
        .bm-full-product-description li {
            margin-bottom: 0.2rem;
        }
        .bm-lego-article-link {
            color: inherit;
            text-decoration: underline;
            text-decoration-color: rgba(176, 0, 0, 0.45);
            text-underline-offset: 2px;
        }
        .bm-lego-article-link:hover,
        .bm-lego-article-link:focus {
            color: #700;
            text-decoration-color: currentColor;
        }
        #wrap.bm-set-wrap {
            margin-bottom: -58px !important;
        }
        #wrap.bm-set-wrap > *:last-child {
            padding-bottom: 10px !important;
        }
        #footer.bm-compact-footer {
            height: 58px !important;
            min-height: 58px;
        }
        body.bm-chart-overlay-open {
            overflow: hidden !important;
        }
        .bm-chart-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1.25rem;
            background: rgba(0, 0, 0, 0.64);
            box-sizing: border-box;
        }
        .bm-chart-overlay.bm-open {
            display: flex;
        }
        .bm-chart-overlay.bm-preloading {
            display: flex;
            top: -200vh;
            left: -200vw;
            right: auto;
            bottom: auto;
            width: 1px;
            height: 1px;
            padding: 0;
            overflow: hidden;
            background: transparent;
            opacity: 0;
            pointer-events: none;
        }
        .bm-chart-dialog {
            position: relative;
            display: flex;
            width: min(1200px, calc(100vw - 2.5rem));
            height: min(92vh, 900px);
            flex-direction: column;
            overflow: hidden;
            border-top: 5px solid #b00;
            border-radius: 4px;
            background: #fff;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
        }
        .bm-chart-dialog-header {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 1rem;
            min-height: 64px;
            padding: 0.8rem 4.25rem 0.8rem 1.25rem;
            border-bottom: 1px solid #ddd;
            background: #fff;
            box-shadow: none !important;
            text-shadow: none !important;
        }
        .bm-chart-dialog-title {
            flex: 0 0 auto;
            margin: 0;
            color: #333;
            font-size: 1.25rem;
            font-weight: 700;
            line-height: 1.2;
            text-shadow: none !important;
        }
        .bm-chart-periods {
            display: flex;
            min-width: 0;
            flex: 1 1 auto;
            align-items: center;
            gap: 0.25rem;
            overflow-x: auto;
            scrollbar-width: thin;
        }
        .bm-chart-periods .buttonPeriod {
            flex: 0 0 auto;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0.3rem 0.55rem !important;
            border: 1px solid #ccc !important;
            background: #f4f4f4 !important;
            color: #444 !important;
            font-size: 0.72rem !important;
            line-height: 1.1 !important;
            text-shadow: none !important;
        }
        .bm-chart-periods .buttonPeriod.hasOrangeBg {
            border-color: #ff771a !important;
            background: #ff771a !important;
            color: #222 !important;
        }
        .bm-chart-dialog-close {
            position: absolute;
            top: 0.65rem;
            right: 0.8rem;
            display: inline-flex;
            width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 0;
            border: 0;
            background: #f7eaea;
            color: #800;
            border-radius: 4px;
            font-size: 1.8rem;
            font-weight: bold;
            line-height: 1;
            text-shadow: none !important;
            cursor: pointer;
        }
        .bm-chart-dialog-close:hover,
        .bm-chart-dialog-close:focus {
            background: #b00;
            color: #fff;
        }
        .bm-chart-dialog-content {
            min-height: 0;
            flex: 1 1 auto;
            overflow: auto;
            padding: 1rem 1.25rem 1.25rem;
        }
        .bm-chart-dialog #chartContainer {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
        }
        .bm-chart-dialog #chartWrapper,
        .bm-chart-dialog #chartWrapper * {
            text-shadow: none !important;
        }
        .bm-chart-dialog .bm-native-chart-title {
            display: none !important;
        }
        .bm-chart-dialog .bm-chart-help {
            margin: 0 0 0.5rem !important;
            color: #666;
            font-size: 0.75rem;
            line-height: 1.3;
        }
        .bm-chart-dialog .bm-chart-history-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.25rem;
            margin: 0 0 0.6rem !important;
            line-height: 1.35rem !important;
        }
        .bm-chart-dialog .bm-chart-history-row strong {
            color: #333 !important;
        }
        .bm-chart-dialog .bm-chart-history-row br {
            display: none !important;
        }
        .bm-chart-dialog .bm-chart-history-row .button {
            margin: 0.2rem 0.2rem 0.2rem 0 !important;
            padding: 0.3rem 0.5rem !important;
            font-size: 0.75rem !important;
            line-height: 1.1 !important;
            text-shadow: none !important;
        }
        .bm-chart-dialog #bigChart {
            display: block;
            width: 100% !important;
            min-height: 60px;
            padding: 0 !important;
        }
        .bm-chart-dialog #bigChart > * {
            max-width: 100%;
        }
        #chartdiv2 {
            margin-bottom: 0.75rem !important;
        }
        .bm-chart-controls {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            column-gap: 0.65rem;
            margin-bottom: 0 !important;
        }
        .bm-chart-best-price {
            margin-bottom: 0.5rem;
            color: #555;
            font-size: 0.75rem;
            font-weight: 600;
            line-height: 1.25;
        }
        .bm-chart-label-mobile {
            display: none;
        }
        @media screen and (min-width: 1025px) {
            .content.setdetails .bm-detail-layout {
                display: grid;
                grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
                align-items: start;
                column-gap: 1.875rem;
                width: 100%;
            }
            .content.setdetails .bm-detail-left,
            .content.setdetails .bm-detail-right {
                min-width: 0;
            }
            .content.setdetails .bm-detail-left > .medium-8.medium-pull-4.columns,
            .content.setdetails .bm-detail-right > .productprice,
            .content.setdetails .bm-detail-right > #ol2nd,
            .content.setdetails .bm-detail-left > #offerlist,
            .content.setdetails .bm-detail-left > #offerlist > #ol1st {
                position: static !important;
                right: auto !important;
                left: auto !important;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0 !important;
                padding-left: 0 !important;
            }
            .content.setdetails .bm-detail-left > #offerlist {
                display: block;
                margin-top: 0.85rem !important;
            }
            .content.setdetails .bm-chart-content-column > #offerlist {
                display: block;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                margin: 0.35rem 0 0 !important;
                padding: 0 !important;
            }
            .content.setdetails .bm-chart-content-column > #offerlist > #ol1st {
                position: static !important;
                right: auto !important;
                left: auto !important;
                display: block;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0 !important;
                padding-left: 0 !important;
            }
            .content.setdetails .bm-detail-right > #ol2nd {
                margin-top: 1.25rem;
            }
            #offerlist::before,
            #offerlist::after {
                display: none !important;
                content: none !important;
            }
            .content.setdetails .bm-detail-layout > .bm-full-product-description {
                grid-column: 1 / -1;
                width: 100% !important;
                float: none !important;
                max-width: none !important;
                padding-right: 0.9375rem !important;
                padding-left: 0.9375rem !important;
            }
            #ol1st.bm-offer-layout {
                display: block;
            }
            #ol1st.bm-offer-layout > .bm-offer-section {
                min-width: 0;
                margin-top: 0;
            }
            #ol1st.bm-offer-layout > .bm-offer-section > p:empty {
                display: none !important;
            }
            #ol1st.bm-offer-layout > :not(.bm-offer-section) {
                grid-column: 1 / -1;
            }
            #ol1st.bm-offer-layout > .bm-offer-section
                .row.collapse > .goto.medium-1.small-3.columns,
            #offerlist.bm-offer-under-chart
                .row.collapse > .goto.medium-1.small-3.columns {
                width: 11.9048% !important;
            }
            #ol1st.bm-offer-layout > .bm-offer-section
                .row.collapse > .medium-4.small-9.columns.pricerow,
            #offerlist.bm-offer-under-chart
                .row.collapse > .medium-4.small-9.columns.pricerow {
                width: 88.0952% !important;
            }
            .bm-product-gallery-host {
                position: relative;
                width: 30% !important;
            }
            .bm-product-gallery-host + .large-9.medium-8.columns {
                width: 70% !important;
            }
            .bm-product-gallery-host > .bm-offer-gallery {
                position: relative;
                top: auto;
                left: auto;
                z-index: 2;
                display: block;
                width: 100%;
                margin-top: 0.45rem;
                padding-right: 0.9375rem;
                text-align: left;
                box-sizing: border-box;
            }
            .bm-product-gallery-host > .bm-offer-videos {
                position: relative;
                clear: both;
                z-index: 2;
                display: block;
                width: 100%;
                margin-top: 0.65rem;
                padding-right: 0.9375rem;
                box-sizing: border-box;
            }
            .bm-offer-gallery-list {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.55rem;
            }
            .bm-offer-gallery-link {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 0;
                aspect-ratio: 4 / 3;
                padding: 0.2rem;
                border: 1px solid transparent;
                border-radius: 2px;
                background: #fff;
                cursor: zoom-in;
                text-decoration: none;
                box-shadow: none;
                overflow: hidden;
                transition: border-color 150ms ease, box-shadow 150ms ease;
            }
            .bm-product-gallery-host > .bm-unified-gallery-link {
                display: flex !important;
                width: 100%;
                align-items: center;
                justify-content: center;
                padding: 0.2rem;
                border: 1px solid transparent;
                border-radius: 2px;
                background: #fff;
                cursor: zoom-in;
                text-decoration: none;
                box-shadow: none;
                overflow: hidden;
                transition: border-color 150ms ease, box-shadow 150ms ease;
                box-sizing: border-box;
            }
            .bm-offer-gallery-link img {
                display: block !important;
                width: 100% !important;
                height: 100% !important;
                max-width: none !important;
                margin: 0 !important;
                object-fit: contain;
                box-shadow: none !important;
                opacity: 1 !important;
            }
            .bm-unified-gallery-link > .bm-unified-gallery-image {
                transform: scale(0.9) !important;
                transform-origin: center;
                box-shadow: none !important;
                opacity: 1 !important;
                transition: transform 150ms ease;
            }
            .bm-unified-gallery-link:hover,
            .bm-unified-gallery-link:focus {
                border-color: #d7d7d7;
                box-shadow: 1px 1px 4px 0 rgba(0, 0, 0, 0.2);
            }
            .bm-unified-gallery-link:hover > .bm-unified-gallery-image,
            .bm-unified-gallery-link:focus > .bm-unified-gallery-image {
                transform: scale(1) !important;
                box-shadow: none !important;
            }
            .bm-offer-videos .flex-video,
            .bm-offer-videos iframe,
            .bm-offer-videos video {
                display: block;
                width: 100%;
                max-width: 100%;
                margin: 0 0 0.6rem;
            }
            .bm-offer-video-link {
                display: block;
                margin: 0 0 0.55rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: underline;
            }
            #ol1st .bm-instruction-source {
                display: none !important;
            }
            #ol1st .bm-parts-source {
                display: none !important;
            }
            #ol2nd .bm-sidebar-instructions {
                display: block;
                margin: 0 0 1.25rem;
                text-align: left;
            }
            .bm-sidebar-instructions h3 {
                margin: 0 0 0.65rem;
                color: #333;
                font-size: 1.15rem;
                line-height: 1.2;
            }
            .bm-sidebar-instruction-list {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.65rem;
            }
            .bm-sidebar-instruction-link {
                display: block;
                min-width: 0;
                color: #b00;
                font-size: 0.66rem;
                line-height: 1.2;
                text-align: center;
                text-decoration: none;
                overflow-wrap: anywhere;
            }
            .bm-sidebar-instruction-link img {
                display: block;
                width: 100%;
                height: auto;
                max-height: 105px;
                margin: 0 auto 0.25rem;
                border: 1px solid #ddd;
                object-fit: contain;
                background: #fff;
            }
            .bm-sidebar-instructions-more {
                display: inline-block;
                margin-top: 0.75rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: underline;
            }
            #ol2nd .bm-sidebar-parts {
                display: block;
                margin: 0 0 1.25rem;
                text-align: left;
            }
            #ol2nd .bm-sidebar-barcode {
                margin-bottom: 0 !important;
                padding-bottom: 1.25rem !important;
                text-align: left !important;
            }
            #ol2nd .bm-sidebar-barcode h3 {
                margin-left: 0 !important;
                text-align: left !important;
            }
            #ol2nd .bm-sidebar-barcode #barcode {
                display: block;
                margin-right: auto !important;
                margin-left: 0 !important;
            }
            .bm-sidebar-parts h3 {
                margin: 0 0 0.65rem;
                color: #333;
                font-size: 1.15rem;
                line-height: 1.2;
            }
            .bm-sidebar-parts-list {
                display: grid;
                gap: 0.45rem;
            }
            .bm-sidebar-parts-link {
                display: flex;
                align-items: center;
                gap: 0.4rem;
                min-width: 0;
                padding: 0.35rem 0.45rem;
                color: #b00;
                font-size: 0.72rem;
                line-height: 1.25;
                text-decoration: none;
                background: #f2f2f2;
            }
            .bm-sidebar-parts-link:hover {
                color: #fff;
                background: #b00;
            }
            .bm-sidebar-parts-link img {
                flex: 0 0 auto;
                width: 18px;
                height: 18px;
                margin: 0;
                object-fit: contain;
            }
            #ol2nd .bm-gallery-source,
            #ol2nd .bm-video-source,
            #showmoreimages {
                display: none !important;
            }
        }
        .bm-offer-toolbar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 0.75rem;
            margin: 0 0 0.15rem;
        }
        .bm-offer-processing {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            margin-right: auto;
            color: #777;
            font-size: 0.72rem;
            line-height: 1;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.12s ease;
        }
        .bm-offer-processing.is-visible {
            opacity: 1;
        }
        .bm-offer-processing svg {
            display: block;
            width: 18px;
            height: 18px;
            fill: none;
            stroke: #b00000;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            animation: bm-spin 0.9s linear infinite;
        }
        @keyframes bm-spin {
            to { transform: rotate(360deg); }
        }
        @media screen and (min-width: 1025px) {
            .bm-chart-controls {
                margin-bottom: 0.15rem !important;
            }
            .bm-offer-toolbar {
                min-height: 24px;
                margin: 0 0 0.15rem !important;
            }
        }
        #ol1st .bm-offer-toolbar + .row.collapse {
            margin-top: 0 !important;
        }
        @media screen and (max-width: 640px) {
            #chartdiv2 {
                margin-bottom: 0.4rem !important;
            }
            #chartTrigger {
                min-width: 0;
                flex: 0 0 auto;
                margin-bottom: 0.35rem !important;
                padding-right: 0.65rem !important;
                padding-left: 0.65rem !important;
                font-size: 0.7rem !important;
                white-space: nowrap;
            }
            .bm-chart-controls {
                flex-wrap: nowrap;
                column-gap: 0.4rem;
            }
            .bm-chart-label-full {
                display: none;
            }
            .bm-chart-label-mobile {
                display: inline;
            }
            .bm-chart-best-price {
                min-width: 0;
                flex: 1 1 auto;
                margin-bottom: 0.35rem;
                font-size: 0.65rem;
            }
            .bm-offer-toolbar {
                margin: 0.1rem 0 0.25rem !important;
            }
            .bm-offer-processing {
                font-size: 0.68rem;
            }
            #wrap.bm-set-wrap {
                margin-bottom: -104px !important;
            }
            #wrap.bm-set-wrap > *:last-child {
                padding-bottom: 56px !important;
            }
            #footer.bm-compact-footer {
                height: 104px !important;
                min-height: 104px;
            }
            .bm-chart-overlay {
                padding: 0;
            }
            .bm-chart-dialog {
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                border-top-width: 4px;
            }
            .bm-chart-dialog-header {
                min-height: 0;
                flex-wrap: wrap;
                gap: 0.4rem;
                padding: calc(1.35rem + env(safe-area-inset-top, 0px)) 3.75rem 0.55rem 1rem;
            }
            .bm-chart-dialog-close {
                top: calc(0.85rem + env(safe-area-inset-top, 0px));
            }
            .bm-chart-dialog-title {
                width: 100%;
                font-size: 1rem;
            }
            .bm-chart-periods {
                width: 100%;
                flex-basis: 100%;
            }
            .bm-chart-dialog-content {
                padding: 0.75rem;
            }
        }
        .bm-discount-toolbar-control {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            justify-content: flex-end;
            width: auto;
            margin-top: 0;
            margin-left: auto;
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
            margin: 0 0 0 0.15rem !important;
            padding: 0 !important;
            background: transparent !important;
            border: 0 !important;
            border-radius: 0 !important;
            color: #666 !important;
            line-height: 1 !important;
        }
        .bm-discount-settings-trigger svg {
            display: block;
            width: 23px;
            height: 23px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
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
            background: rgba(0, 0, 0, 0.64);
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
            border: 0;
            border-top: 5px solid #b00;
            border-radius: 4px;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
            color: #333;
        }
        .bm-settings-header,
        .bm-settings-actions {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.8rem 1.25rem;
        }
        .bm-settings-header {
            justify-content: space-between;
            min-height: 64px;
            background: #fff;
            border-bottom: 1px solid #ddd;
            box-shadow: none !important;
            box-sizing: border-box;
        }
        .bm-settings-header h3 {
            margin: 0 !important;
            color: #333 !important;
            font-size: 1.25rem !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
            text-shadow: none !important;
        }
        .bm-settings-close {
            display: inline-flex !important;
            width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 4px !important;
            background: #f7eaea !important;
            color: #800 !important;
            font-size: 1.8rem !important;
            font-weight: bold !important;
            line-height: 1 !important;
            text-shadow: none !important;
        }
        .bm-settings-close:hover,
        .bm-settings-close:focus {
            background: #b00 !important;
            color: #fff !important;
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
            `Suche aktuelle Verkaufsangebote für ${title}.`,
            'Berücksichtige relevante Angebote für Neuware in OVP von gewerblichen Händlern und privaten Verkäufern; Angebote von Privatverkäufern sind ausdrücklich erlaubt.',
            'Gib ausschließlich eine Markdown-Tabelle mit den Spalten Plattform, Angebot, Artikelpreis, Versandkosten, Gesamtpreis und Link aus.',
            'Nenne bei jedem Angebot die Plattform und die Versandkosten einzeln; falls Versandkosten nicht angegeben sind, schreibe "unbekannt".',
            'Keine Einleitung, Erklärungen, Zusammenfassung oder sonstigen Texte außerhalb der Tabelle.'
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

            const label = link.closest('.bm-meta-dual-link')
                ?.querySelector('.bm-link-label');
            const defaultLabel = link.dataset.bmDefaultLabel ||
                label?.textContent ||
                'Meta';
            if (label) label.textContent = 'Wird geöffnet';
            window.open(META_GPT_URL, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => {
                if (label) label.textContent = defaultLabel;
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

    function parseHistoricalBestPriceText(rawText) {
        const text = String(rawText || '').replace(/\s+/g, ' ').trim();
        if (!/bisheriger bestpreis/i.test(text)) return null;

        const priceMatch = text.match(/(\d+[\d\s.,]*)\s*€/i);
        if (!priceMatch) return null;

        const priceLabel = `${priceMatch[1].trim()} €`;
        const price = parseFloat(
            priceMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
        );
        if (!Number.isFinite(price) || price <= 0) return null;

        const afterPriceText = text.slice(
            text.indexOf(priceMatch[0]) + priceMatch[0].length
        ).replace(/\s+/g, ' ').trim();
        const detailSuffix = afterPriceText
            .replace(/^[:|,-]?\s*/, '')
            .trim();

        return {
            text,
            price,
            priceLabel,
            detailSuffix
        };
    }

    let nativeChartHistoricalBestPriceInfo = null;

    function removeRelativeDayLabelsFromBestPriceLines(root = null) {
        const scanRoot = root ||
            document.querySelector('.content.setdetails .productprice') ||
            document.querySelector('.content.setdetails');
        if (!scanRoot) return;

        const walker = document.createTreeWalker(
            scanRoot,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('#bm-price-chart-overlay, #chartWrapper, #bigChart, #chartContainer, #offerlist')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (!/vor\s+\d+\s+Tagen\b/i.test(node.nodeValue || '')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        const nodes = [];
        let node;
        while (node = walker.nextNode()) nodes.push(node);
        nodes.forEach(textNode => {
            textNode.nodeValue = textNode.nodeValue
                .replace(/\s+vor\s+\d+\s+Tagen\b/gi, '');
        });
    }

    function findHistoricalBestPriceSidebarTextNode(seedElement = null) {
        const roots = [];
        const seedRoot = seedElement?.closest?.('p, div, li');
        if (seedRoot) roots.push(seedRoot);

        const detailsRoot = document.querySelector('.content.setdetails');
        if (detailsRoot && !roots.includes(detailsRoot)) roots.push(detailsRoot);
        roots.push(document.body);

        for (const root of roots.filter(Boolean)) {
            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        const parent = node.parentElement;
                        if (!parent) return NodeFilter.FILTER_REJECT;
                        if (!/bisheriger bestpreis/i.test(node.nodeValue || '')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (parent.closest('#bm-price-chart-overlay, #chartWrapper, #bigChart, #chartContainer')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (parent.closest('#all-time-bestpreis-discount')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            const match = walker.nextNode();
            if (match) return match;
        }

        return null;
    }

    function writeHistoricalBestPriceDetailToSidebar(detailSuffix, seedElement = null) {
        const suffix = String(detailSuffix || '').replace(/\s+/g, ' ').trim();
        document.querySelectorAll('.bm-historical-bestprice-detail')
            .forEach(element => element.remove());
        if (!suffix) return;

        const textNode = findHistoricalBestPriceSidebarTextNode(seedElement);
        const parent = textNode?.parentElement;
        if (!textNode || !parent) return;
        removeRelativeDayLabelsFromBestPriceLines(parent);

        const lineNodes = Array.from(parent.childNodes);
        const startIndex = lineNodes.indexOf(textNode);
        let lineText = '';
        for (let index = Math.max(0, startIndex); index < lineNodes.length; index += 1) {
            const node = lineNodes[index];
            if (index > startIndex && node.nodeName === 'BR') break;
            lineText += node.textContent || '';
        }
        lineText = lineText.replace(/\s+/g, ' ').trim();
        if (lineText.includes(suffix)) return;

        const detail = document.createElement('span');
        detail.className = 'bm-historical-bestprice-detail';
        detail.textContent = ` ${suffix}`;

        const insertBefore = lineNodes
            .slice(startIndex + 1)
            .find(node => node.nodeName === 'BR') || null;
        parent.insertBefore(detail, insertBefore);
    }

    function createDiscountSettingsUI() {
        if (!setNum || document.getElementById('bm-discount-settings')) return;

        const offerlist = document.getElementById('offerlist');
        const firstOffer = offerlist
            ?.querySelector(
                '.medium-4.small-9.columns.pricerow:not([data-bm-marketplace="true"])'
            )
            ?.closest('.row.collapse');
        if (!offerlist || !firstOffer?.parentElement) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'bm-offer-toolbar';
        toolbar.innerHTML = `
            <div class="bm-offer-processing" role="status" aria-live="polite">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 2v3"></path>
                    <path d="M12 19v3"></path>
                    <path d="M4.93 4.93l2.12 2.12"></path>
                    <path d="M16.95 16.95l2.12 2.12"></path>
                    <path d="M2 12h3"></path>
                    <path d="M19 12h3"></path>
                    <path d="M4.93 19.07l2.12-2.12"></path>
                    <path d="M16.95 7.05l2.12-2.12"></path>
                </svg>
                <span>rechnet</span>
            </div>
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
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="21" x2="14" y1="4" y2="4"></line>
                        <line x1="10" x2="3" y1="4" y2="4"></line>
                        <line x1="21" x2="12" y1="12" y2="12"></line>
                        <line x1="8" x2="3" y1="12" y2="12"></line>
                        <line x1="21" x2="16" y1="20" y2="20"></line>
                        <line x1="12" x2="3" y1="20" y2="20"></line>
                        <line x1="14" x2="14" y1="2" y2="6"></line>
                        <line x1="8" x2="8" y1="10" y2="14"></line>
                        <line x1="16" x2="16" y1="18" y2="22"></line>
                    </svg>
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
        document.querySelectorAll('a, button').forEach(element => {
            if (!/^\s*Zur\s+LEGO\s+Seite\s*$/i.test(element.textContent || '')) {
                return;
            }
            const parent = element.parentElement;
            element.remove();
            if (
                parent &&
                parent !== document.body &&
                parent.children.length === 0 &&
                !parent.textContent.replace(/\|/g, '').trim()
            ) {
                parent.remove();
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
        removeSidebarHistoryLinks();
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

    function removeSidebarHistoryLinks() {
        const historyLinkPattern = /^\s*Zur\s+(?:ebay|bricklink)\s+History\s*$/i;
        const roots = [
            document.querySelector('.content.setdetails .productprice'),
            document.getElementById('ol2nd'),
            document.querySelector('.content.setdetails .bm-detail-right')
        ].filter(Boolean);

        roots.forEach(root => {
            Array.from(root.querySelectorAll('a'))
                .filter(link => historyLinkPattern.test(link.textContent || ''))
                .forEach(link => {
                    const parent = link.parentElement;
                    [link.previousSibling, link.nextSibling].forEach(node => {
                        if (
                            node?.nodeType === Node.TEXT_NODE &&
                            /^\s*\|?\s*$/.test(node.nodeValue || '')
                        ) {
                            node.remove();
                        }
                    });
                    link.remove();

                    if (
                        parent &&
                        parent !== root &&
                        parent.children.length === 0 &&
                        !parent.textContent.replace(/\|/g, '').trim()
                    ) {
                        parent.remove();
                    }
                });
        });
    }

    // Auf Desktop werden die Brickmerge-Push/Pull-Spalten in ein echtes Grid
    // überführt: links Bild/Chart und direkt darunter die Offerlist, rechts
    // Produktdaten, EAN, Bauanleitungen und Einzelteilelisten.
    function setupDesktopDetailGrid() {
        if (!window.matchMedia('(min-width: 1025px)').matches) return;

        const container = document.querySelector('.content.setdetails');
        const offerList = document.getElementById('offerlist');
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const productPriceColumn = container?.querySelector('.productprice');
        const chartColumn = container?.querySelector('.medium-8.medium-pull-4.columns');
        if (
            !container ||
            !offerList ||
            !offerColumn ||
            !sideColumn ||
            !productPriceColumn ||
            !chartColumn
        ) {
            return;
        }

        let layout = container.querySelector(':scope > .bm-detail-layout');
        let leftColumn = layout?.querySelector(':scope > .bm-detail-left');
        let rightColumn = layout?.querySelector(':scope > .bm-detail-right');

        const originalProductRow = productPriceColumn.closest('.row') ||
            chartColumn.closest('.row');

        if (!layout || !leftColumn || !rightColumn) {
            layout = document.createElement('div');
            layout.className = 'bm-detail-layout';
            leftColumn = document.createElement('div');
            leftColumn.className = 'bm-detail-left';
            rightColumn = document.createElement('div');
            rightColumn.className = 'bm-detail-right';
            layout.append(leftColumn, rightColumn);
            const directChildReference = [originalProductRow, offerList]
                .map(element => {
                    let candidate = element;
                    while (candidate && candidate.parentElement !== container) {
                        candidate = candidate.parentElement;
                    }
                    return candidate?.parentElement === container ? candidate : null;
                })
                .find(Boolean);
            container.insertBefore(layout, directChildReference || null);
        }

        chartColumn.classList.add('bm-detail-chart-column');
        productPriceColumn.classList.add('bm-detail-price-column');
        sideColumn.classList.add('bm-detail-side-column');

        if (chartColumn.parentElement !== leftColumn) {
            leftColumn.appendChild(chartColumn);
        }
        if (offerList.parentElement !== leftColumn) {
            leftColumn.appendChild(offerList);
        }
        if (productPriceColumn.parentElement !== rightColumn) {
            rightColumn.appendChild(productPriceColumn);
        }
        if (sideColumn.parentElement !== rightColumn) {
            rightColumn.appendChild(sideColumn);
        }

        if (
            originalProductRow &&
            originalProductRow !== layout &&
            originalProductRow.parentElement &&
            originalProductRow.childElementCount === 0
        ) {
            originalProductRow.remove();
        }
    }

    // Auf Desktop liegt die Angebotsliste in derselben Unterspalte wie das
    // Preisdiagramm. Die zusätzlichen Bilder beginnen links direkt unter dem
    // großen Produktbild und beeinflussen die Offerlist-Höhe nicht.
    function setupDesktopOfferGallery() {
        if (!window.matchMedia('(min-width: 1025px)').matches) return;

        const offerList = document.getElementById('offerlist');
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const imageColumn = document.querySelector(
            '.content.setdetails .medium-8.medium-pull-4.columns ' +
            '> .row.collapse > .large-3.medium-4.columns.hide-for-small'
        );
        const chartContentColumn = imageColumn
            ?.parentElement
            ?.querySelector(':scope > .large-9.medium-8.columns') ||
            imageColumn?.nextElementSibling;
        if (!offerList || !offerColumn || !sideColumn || !imageColumn ||
            !chartContentColumn) return;

        const firstPriceRow = offerColumn.querySelector('.pricerow');
        const firstOfferRow = firstPriceRow?.closest('.row.collapse');
        const offerSection = firstPriceRow?.closest('section') ||
            (
                firstOfferRow?.parentElement &&
                firstOfferRow.parentElement !== offerColumn
                    ? firstOfferRow.parentElement
                    : null
            );
        const sourceLinks = Array.from(
            sideColumn.querySelectorAll('a.fancybox')
        ).filter(link => link.querySelector('img.gallerieIco'));

        chartContentColumn.classList.add('bm-chart-content-column');
        if (offerList.parentElement !== chartContentColumn) {
            chartContentColumn.appendChild(offerList);
        }
        offerList.classList.add('bm-offer-under-chart');
        offerColumn.classList.add('bm-offer-layout');
        offerSection?.classList.add('bm-offer-section');
        offerSection?.querySelectorAll(':scope > p').forEach(paragraph => {
            const hasEmbeddedContent = paragraph.querySelector(
                'a, button, input, select, textarea, img, svg, iframe, video'
            );
            if (!hasEmbeddedContent && !paragraph.textContent.trim()) {
                paragraph.remove();
            }
        });
        imageColumn.classList.add('bm-product-gallery-host');

        const mainImageLink = imageColumn.querySelector(':scope > a.fancybox');
        const mainImage = mainImageLink?.querySelector('img');
        mainImageLink?.classList.add('bm-unified-gallery-link');
        mainImage?.classList.add('bm-unified-gallery-image');

        const sourceTitle = sideColumn.querySelector('h3.more_images');
        sourceTitle?.classList.add('bm-gallery-source');
        sourceLinks.forEach(link => link.classList.add('bm-gallery-source'));

        let gallery = imageColumn.querySelector(':scope > .bm-offer-gallery');
        if (sourceLinks.length > 0 && !gallery) {
            gallery = document.createElement('aside');
            gallery.className = 'bm-offer-gallery';
            gallery.setAttribute('aria-label', 'Weitere Produktbilder');

            const list = document.createElement('div');
            list.className = 'bm-offer-gallery-list';
            sourceLinks.forEach((sourceLink, index) => {
                const sourceImage = sourceLink.querySelector('img.gallerieIco');
                const link = document.createElement('a');
                link.className =
                    'bm-offer-gallery-link bm-unified-gallery-link';
                link.href = sourceLink.href;
                link.rel = sourceLink.rel || 'group1';
                link.title = sourceLink.title || `Produktbild ${index + 1} öffnen`;
                link.dataset.index = sourceLink.dataset.index || String(index + 1);
                if (sourceLink.dataset.size) link.dataset.size = sourceLink.dataset.size;
                link.addEventListener('click', event => {
                    event.preventDefault();
                    sourceLink.click();
                });

                const image = sourceImage.cloneNode(true);
                image.removeAttribute('width');
                image.removeAttribute('height');
                image.removeAttribute('style');
                image.loading = 'lazy';
                image.alt = sourceImage.alt || `Produktbild ${index + 1}`;
                image.classList.add('bm-unified-gallery-image');
                link.appendChild(image);
                list.appendChild(link);
            });

            gallery.appendChild(list);
            imageColumn.appendChild(gallery);
        }

        const videoBlocks = Array.from(sideColumn.querySelectorAll(
            '.flex-video, iframe[src*="youtube"], iframe[src*="youtu"], ' +
            'iframe[src*="vimeo"], video, a[href*="youtube.com"], ' +
            'a[href*="youtu.be"], a[href*="vimeo.com"]'
        )).map(element => {
            if (element.dataset.bmVideoMoved === 'true') return null;
            return element.closest('.flex-video') ||
                element.closest('p') ||
                element.closest('li') ||
                element.closest('div') ||
                element;
        }).filter((element, index, elements) =>
            element &&
            element !== sideColumn &&
            !element.closest('.bm-offer-videos') &&
            elements.indexOf(element) === index
        );
        if (videoBlocks.length === 0) return;

        let videos = imageColumn.querySelector(':scope > .bm-offer-videos');
        if (!videos) {
            videos = document.createElement('aside');
            videos.className = 'bm-offer-videos';
            videos.setAttribute('aria-label', 'Videos');
        }
        if (gallery && videos.previousElementSibling !== gallery) {
            gallery.after(videos);
        } else if (!gallery && videos.parentElement !== imageColumn) {
            imageColumn.appendChild(videos);
        }
        Array.from(sideColumn.querySelectorAll('h3, h4'))
            .filter(heading => /video/i.test(heading.textContent || ''))
            .forEach(heading => heading.classList.add('bm-video-source'));

        videoBlocks.forEach(block => {
            block.dataset.bmVideoMoved = 'true';
            const links = block.matches('a[href]')
                ? [block]
                : Array.from(block.querySelectorAll('a[href]'));
            links.forEach(link => {
                if (/youtu|youtube|vimeo/i.test(link.href)) {
                    link.classList.add('bm-offer-video-link');
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                }
            });
            videos.appendChild(block);
        });
    }

    function setupDesktopSidebarBarcode() {
        const sideColumn = document.getElementById('ol2nd');
        const barcodeBlock = sideColumn?.querySelector('#barcode')?.closest('div');
        barcodeBlock?.classList.add('bm-sidebar-barcode');
    }

    // Die Anleitungen stehen auf Desktop zwischen Barcode und Einzelteilelisten.
    // Die Originale bleiben für die Mobilansicht erhalten.
    function setupDesktopSidebarInstructions() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        if (!offerColumn || !sideColumn || sideColumn.querySelector('.bm-sidebar-instructions')) {
            return;
        }

        const sourceHeading = Array.from(offerColumn.querySelectorAll('h3'))
            .find(heading => heading.id === 'Bauanleitung' ||
                /Bauanleitung/i.test(heading.textContent || ''));
        const instructionImage = offerColumn.querySelector(
            'img[src*="/img/instructions/"]'
        );
        const moreAnchor = offerColumn.querySelector(
            'a[href*="/service/buildinginstructions/"]'
        );
        const moreParagraph = moreAnchor?.closest('p');
        const sourceSection = sourceHeading?.closest('section') ||
            instructionImage?.closest('section') ||
            (moreParagraph?.previousElementSibling?.tagName === 'SECTION'
                ? moreParagraph.previousElementSibling
                : null);
        if (!sourceSection) return;

        const sourceAnchors = Array.from(sourceSection.querySelectorAll('a'))
            .filter(anchor => anchor.querySelector('img[src*="/img/instructions/"]'));
        if (sourceAnchors.length === 0 && !moreAnchor) return;

        sourceSection.classList.add('bm-instruction-source');
        if (moreAnchor) moreParagraph.classList.add('bm-instruction-source');

        const panel = document.createElement('section');
        panel.className = 'bm-sidebar-instructions';

        const heading = document.createElement('h3');
        heading.textContent = 'Bauanleitungen';

        const list = document.createElement('div');
        list.className = 'bm-sidebar-instruction-list';

        sourceAnchors.forEach((sourceAnchor, index) => {
            const sourceImage = sourceAnchor.querySelector('img');
            const link = document.createElement('a');
            link.className = 'bm-sidebar-instruction-link';
            link.href = sourceAnchor.href;
            link.target = '_blank';
            link.rel = 'nofollow noopener';
            link.title = sourceAnchor.title || `Bauanleitung ${index + 1} öffnen`;

            const image = sourceImage.cloneNode(true);
            image.removeAttribute('width');
            image.removeAttribute('height');
            image.removeAttribute('style');
            image.loading = 'lazy';

            const label = document.createElement('span');
            label.textContent = sourceAnchor.textContent.trim() ||
                sourceImage.alt ||
                `Bauanleitung ${index + 1}`;

            link.append(image, label);
            list.appendChild(link);
        });

        panel.append(heading, list);

        if (moreAnchor) {
            const moreLink = document.createElement('a');
            moreLink.className = 'bm-sidebar-instructions-more';
            moreLink.href = moreAnchor.href;
            moreLink.target = '_blank';
            moreLink.rel = 'nofollow noopener';
            moreLink.textContent = 'Weitere Bauanleitungen bei LEGO';
            panel.appendChild(moreLink);
        }

        const barcodeBlock = sideColumn.querySelector('#barcode')?.closest('div');
        barcodeBlock?.classList.add('bm-sidebar-barcode');
        if (barcodeBlock) barcodeBlock.insertAdjacentElement('afterend', panel);
        else sideColumn.prepend(panel);
    }

    // Die Einzelteilelinks werden auf Desktop ebenfalls in der rechten Spalte
    // angezeigt. Auf kleinen Bildschirmen bleibt der Originalblock erhalten.
    function setupDesktopSidebarParts() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        if (!offerColumn || !sideColumn || sideColumn.querySelector('.bm-sidebar-parts')) {
            return;
        }

        const sourceHeading = Array.from(offerColumn.querySelectorAll('h3'))
            .find(heading => /Einzelteilelisten/i.test(heading.textContent));
        const sourceSection = sourceHeading?.closest('section');
        if (!sourceSection) return;

        const sourceAnchors = Array.from(sourceSection.querySelectorAll('a'))
            .filter(anchor => /Einzelteile/i.test(anchor.textContent));
        if (sourceAnchors.length === 0) return;

        sourceSection.classList.add('bm-parts-source');

        const panel = document.createElement('section');
        panel.className = 'bm-sidebar-parts';

        const heading = document.createElement('h3');
        heading.textContent = sourceHeading.textContent.trim();

        const list = document.createElement('div');
        list.className = 'bm-sidebar-parts-list';

        sourceAnchors.forEach(sourceAnchor => {
            const link = document.createElement('a');
            link.className = 'bm-sidebar-parts-link';
            link.href = sourceAnchor.href;
            link.target = '_blank';
            link.rel = sourceAnchor.rel || 'nofollow noopener';
            link.title = sourceAnchor.title;

            const sourceImage = sourceAnchor.querySelector('img');
            if (sourceImage) {
                const image = sourceImage.cloneNode(true);
                image.removeAttribute('width');
                image.removeAttribute('height');
                image.removeAttribute('style');
                link.appendChild(image);
            }

            const label = document.createElement('span');
            label.textContent = sourceAnchor.textContent.trim();
            link.appendChild(label);
            list.appendChild(link);
        });

        panel.append(heading, list);

        const instructionPanel = sideColumn.querySelector('.bm-sidebar-instructions');
        if (instructionPanel) instructionPanel.insertAdjacentElement('afterend', panel);
        else {
            const barcodeBlock = sideColumn.querySelector('#barcode')?.closest('div');
            if (barcodeBlock) barcodeBlock.insertAdjacentElement('afterend', panel);
            else sideColumn.prepend(panel);
        }
    }

    // Die offizielle Beschreibung gehört unter die komplette Dreispaltenzeile.
    function expandProductDescription() {
        const offerColumn = document.getElementById('ol1st');
        const sideColumn = document.getElementById('ol2nd');
        const heading = document.querySelector('h2.long_description');
        const descriptionSection = heading?.closest('section');
        const columnsRow = document.querySelector('.content.setdetails .bm-detail-layout') ||
            offerColumn?.parentElement;
        if (
            !offerColumn ||
            !sideColumn ||
            !descriptionSection ||
            !columnsRow ||
            descriptionSection.classList.contains('bm-full-product-description')
        ) {
            return;
        }

        const spacer = descriptionSection.nextElementSibling;
        if (
            spacer?.tagName === 'DIV' &&
            spacer.children.length === 0 &&
            /height\s*:\s*2rem/i.test(spacer.getAttribute('style') || '')
        ) {
            spacer.remove();
        }

        descriptionSection.classList.add(
            'bm-full-product-description',
            'small-12',
            'columns'
        );
        columnsRow.appendChild(descriptionSection);
    }

    function linkLegoArticleNumber() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph => /Artikel-Nr\s*:/i.test(paragraph.textContent || ''));
        if (!details || details.querySelector('.bm-lego-article-link')) return;

        const articleNumber = Array.from(details.querySelectorAll('strong'))
            .find(strong => strong.textContent.trim() === setNum);
        if (!articleNumber || articleNumber.closest('a')) return;

        const link = document.createElement('a');
        link.className = 'bm-lego-article-link';
        link.href = `https://www.lego.com/de-de/product/${setNum}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `LEGO ${setNum} bei LEGO öffnen`;
        articleNumber.replaceWith(link);
        link.appendChild(articleNumber);
    }

    function linkDesignerName() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph => /Designer\s*:/i.test(paragraph.textContent || ''));
        if (!details || details.querySelector('.bm-designer-link')) return;

        const designerStrong = Array.from(details.querySelectorAll('strong'))
            .find(strong => {
                const previousText = [];
                let node = strong.previousSibling;
                while (node) {
                    previousText.unshift(node.textContent || '');
                    if (/Designer\s*:/i.test(previousText.join(' '))) return true;
                    node = node.previousSibling;
                }
                return false;
            });
        const designer = designerStrong?.textContent?.replace(/\s+/g, ' ').trim();
        if (!designer || designerStrong.closest('a')) return;

        const query = `site:brickmerge.de Designer: ${designer}`;
        const link = document.createElement('a');
        link.className = 'bm-lego-article-link bm-designer-link';
        link.href =
            `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `Brickmerge-Sets von ${designer} in Google Bilder suchen`;
        designerStrong.replaceWith(link);
        link.appendChild(designerStrong);
    }

    function linkPackageDimensionsCalculator() {
        const details = Array.from(
            document.querySelectorAll('.content.setdetails p')
        ).find(paragraph =>
            /OVP-Maße\s*:/i.test(paragraph.textContent || '') &&
            /Setgewicht\s*:/i.test(paragraph.textContent || '')
        );
        if (!details || details.querySelector('.bm-package-dimensions-link')) return;

        const text = (details.textContent || '').replace(/\s+/g, ' ');
        const dimensionsMatch = text.match(
            /OVP-Maße\s*:\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*cm/i
        );
        const weightMatch = text.match(
            /Setgewicht\s*:\s*[≈~]?\s*([\d.,]+)\s*(kg|g)\b/i
        );
        if (!dimensionsMatch || !weightMatch) return;

        const parseDecimalValue = value => {
            const raw = String(value || '').replace(/\s/g, '');
            if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) {
                return Number(raw.replace(/\./g, '').replace(',', '.'));
            }
            return Number(raw.replace(',', '.'));
        };
        const parseWeightKg = (value, unit) => {
            const parsed = parseDecimalValue(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return unit.toLowerCase() === 'g' ? parsed / 1000 : parsed;
        };
        const formatParam = (value, decimals = 2) =>
            Number(value).toFixed(decimals).replace(/\.?0+$/, '');
        const formatDimensionCm = value => String(Math.ceil(value));

        const width = parseDecimalValue(dimensionsMatch[1]);
        const length = parseDecimalValue(dimensionsMatch[2]);
        const height = parseDecimalValue(dimensionsMatch[3]);
        const weightKg = parseWeightKg(weightMatch[1], weightMatch[2]);
        if (![width, length, height, weightKg].every(value =>
            Number.isFinite(value) && value > 0
        )) {
            return;
        }

        const url = new URL('https://www.paketda.de/paket-preis-rechner.php');
        url.searchParams.set('action', 'submit');
        url.searchParams.set('breite', formatDimensionCm(width * 1.1));
        url.searchParams.set('laenge', formatDimensionCm(length * 1.1));
        url.searchParams.set('hoehe', formatDimensionCm(height * 1.1));
        url.searchParams.set('gewicht', formatParam(weightKg * 1.1));
        url.hash = 'ergebnis';

        const dimensionTextPattern = new RegExp(
            `${dimensionsMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[x×]\\s*` +
            `${dimensionsMatch[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[x×]\\s*` +
            `${dimensionsMatch[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*cm`,
            'i'
        );

        const dimensionStrong = Array.from(details.querySelectorAll('strong'))
            .find(strong => dimensionTextPattern.test(strong.textContent || ''));
        const createLink = () => {
            const link = document.createElement('a');
            link.className = 'bm-lego-article-link bm-package-dimensions-link';
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = 'Paketpreis mit 10% Aufschlag auf Maße und Gewicht berechnen';
            return link;
        };

        if (dimensionStrong && !dimensionStrong.closest('a')) {
            const link = createLink();
            dimensionStrong.replaceWith(link);
            link.appendChild(dimensionStrong);
            return;
        }

        const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement?.closest('a')) continue;
            const match = node.nodeValue.match(dimensionTextPattern);
            if (!match) continue;

            const before = node.nodeValue.slice(0, match.index);
            const after = node.nodeValue.slice(match.index + match[0].length);
            const fragment = document.createDocumentFragment();
            fragment.appendChild(document.createTextNode(before));
            const link = createLink();
            link.textContent = match[0];
            fragment.appendChild(link);
            fragment.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(fragment, node);
            return;
        }
    }

    function compactSetFooter() {
        const footer = document.getElementById('footer');
        const wrap = document.getElementById('wrap');
        if (!footer || !wrap) return;

        const socialButton = footer.querySelector('.footerButton');
        const socialRow = socialButton?.closest('.small-12.columns');
        socialRow?.remove();

        footer.classList.add('bm-compact-footer');
        wrap.classList.add('bm-set-wrap');
    }

    function runSetDetailInitializers() {
        [
            setupDesktopDetailGrid,
            removeSidebarHistoryLinks,
            removeRelativeDayLabelsFromBestPriceLines,
            setupDesktopOfferGallery,
            setupDesktopSidebarBarcode,
            setupDesktopSidebarInstructions,
            setupDesktopSidebarParts,
            expandProductDescription,
            linkLegoArticleNumber,
            linkDesignerName,
            linkPackageDimensionsCalculator,
            createDiscountSettingsUI,
            compactSetFooter
        ].forEach(initializer => {
            try {
                initializer();
            } catch (error) {
                console.error(
                    `Brickmerge Tweaker: ${initializer.name} konnte nicht ausgeführt werden.`,
                    error
                );
            }
        });
    }

    if (setNum) {
        runSetDetailInitializers();
        window.addEventListener('load', runSetDetailInitializers, { once: true });

        // Brickmerge ergänzt die Angebotszeilen teilweise erst nach dem load-Event.
        // Die Rabattsteuerung wird deshalb unabhängig von den übrigen Layout-
        // Funktionen nachgereicht, sobald eine native Angebotszeile vorhanden ist.
        const offerFeatureObserver = new MutationObserver(() => {
            if (document.getElementById('bm-discount-settings')) {
                offerFeatureObserver.disconnect();
                return;
            }
            try {
                createDiscountSettingsUI();
            } catch (error) {
                console.error(
                    'Brickmerge Tweaker: Rabattsteuerung konnte nicht nachgeladen werden.',
                    error
                );
            }
        });
        offerFeatureObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        [100, 500, 1500, 3000].forEach(delay => {
            window.setTimeout(() => {
                if (!document.getElementById('bm-discount-settings')) {
                    try {
                        createDiscountSettingsUI();
                    } catch (error) {
                        console.error(
                            'Brickmerge Tweaker: Rabattsteuerung konnte nicht nachgeladen werden.',
                            error
                        );
                    }
                }
            }, delay);
        });
        window.setTimeout(() => offerFeatureObserver.disconnect(), 10000);
    }

    // Brickmerge lädt die zuletzt ausverkauften Angebote verzögert nach. Sobald
    // sie vorhanden sind, werden nur deren Angebotszeilen in die normale Liste
    // übernommen; der Link zum Händler bleibt dabei unverändert erhalten.
    function mergeSoldOutOffersIntoOfferList() {
        const soldOutContainer = document.getElementById('SoldOutContainer');
        const soldOut = document.getElementById('soldOut');
        const offerlist = document.getElementById('offerlist');
        if (!soldOutContainer || !soldOut || !offerlist) return false;

        const soldOutRows = Array.from(soldOut.querySelectorAll('.row.collapse'))
            .filter(wrapper => wrapper.querySelector(
                '.medium-4.small-9.columns.pricerow[data-mid]'
            ));
        if (soldOutRows.length === 0) return false;

        const firstMainPriceRow = Array.from(offerlist.querySelectorAll(
            '.medium-4.small-9.columns.pricerow[data-mid]'
        )).find(priceRow => !priceRow.closest('#soldOut'));
        const target = firstMainPriceRow?.closest('.row.collapse')?.parentElement;
        if (!target) return false;

        soldOutRows.forEach(wrapper => {
            wrapper.querySelectorAll('.goto.medium-7').forEach(element => element.remove());
            wrapper.classList.add('bm-sold-out-offer');
            wrapper.dataset.bmSoldOut = 'true';

            const priceRow = wrapper.querySelector(
                '.medium-4.small-9.columns.pricerow[data-mid]'
            );
            if (priceRow) priceRow.dataset.bmSoldOut = 'true';

            const priceSpan = priceRow?.querySelector('span.price');
            if (priceSpan && !priceSpan.querySelector('.bm-sold-out-badge')) {
                const badge = document.createElement('span');
                badge.className = 'bm-sold-out-badge';
                badge.textContent = 'SOLD OUT';
                badge.title = 'Kürzlich ausverkauft';
                priceSpan.appendChild(badge);
            }

            if (!wrapper.querySelector(':scope > .bm-sold-out-overlay')) {
                const overlay = document.createElement('span');
                overlay.className = 'bm-sold-out-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                wrapper.appendChild(overlay);
            }

            target.appendChild(wrapper);
        });

        soldOutContainer.remove();
        return true;
    }

    function placeSoldOutBadgesAfterShipping() {
        document.querySelectorAll(
            '#offerlist .bm-sold-out-offer ' +
            '.medium-4.small-9.columns.pricerow span.price'
        ).forEach(priceSpan => {
            const badge = priceSpan.querySelector(':scope > .bm-sold-out-badge');
            if (badge) priceSpan.appendChild(badge);
        });
    }
    if (setNum) {
        mergeSoldOutOffersIntoOfferList();
        window.addEventListener('load', mergeSoldOutOffersIntoOfferList, { once: true });
    }

    // Der native Brickmerge-Detailchart wird im Hintergrund vorgeladen und
    // anschließend im eigenen Overlay angezeigt. Dadurch ist der historische
    // Bestpreis bereits neben dem Schalter verfügbar.
    let openPriceChartOverlay = null;

    function setupPriceChartOverlay() {
        const chartTrigger = document.getElementById('chartTrigger');
        const chartContainer = document.getElementById('chartContainer');
        const bigChart = document.getElementById('bigChart');
        if (!chartTrigger || !chartContainer || !bigChart) return;
        if (document.getElementById('bm-price-chart-overlay')) return;

        chartTrigger.parentElement?.classList.add('bm-chart-controls');
        chartTrigger.setAttribute('aria-haspopup', 'dialog');
        chartTrigger.setAttribute('aria-controls', 'bm-price-chart-overlay');

        const normalizeChartTriggerLabel = () => {
            const buttonLabel = chartTrigger.querySelector('.chartbutton');
            if (!buttonLabel || buttonLabel.querySelector('.bm-chart-label-full')) {
                return;
            }
            buttonLabel.textContent = '';
            const fullLabel = document.createElement('span');
            fullLabel.className = 'bm-chart-label-full';
            fullLabel.textContent = 'Preisentwicklung Details anzeigen';
            const mobileLabel = document.createElement('span');
            mobileLabel.className = 'bm-chart-label-mobile';
            mobileLabel.textContent = 'Details anzeigen';
            buttonLabel.append(fullLabel, mobileLabel);
        };
        normalizeChartTriggerLabel();

        const overlay = document.createElement('div');
        overlay.id = 'bm-price-chart-overlay';
        overlay.className = 'bm-chart-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-labelledby', 'bm-price-chart-title');

        const dialog = document.createElement('div');
        dialog.className = 'bm-chart-dialog';

        const header = document.createElement('div');
        header.className = 'bm-chart-dialog-header';

        const title = document.createElement('h2');
        title.id = 'bm-price-chart-title';
        title.className = 'bm-chart-dialog-title';
        title.textContent = 'Preisentwicklung';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'bm-chart-dialog-close';
        closeButton.setAttribute('aria-label', 'Preisentwicklung schließen');
        closeButton.title = 'Schließen';
        closeButton.textContent = '\u00d7';

        const content = document.createElement('div');
        content.className = 'bm-chart-dialog-content';

        const amazonNote = Array.from(
            chartTrigger.parentElement?.querySelectorAll('span') || []
        ).find(element => /amazon-preise werden nicht im preisverlauf berücksichtigt/i.test(
            element.textContent || ''
        ));
        amazonNote?.remove();

        header.append(title, closeButton);
        content.appendChild(chartContainer);
        dialog.append(header, content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let storedScrollY = 0;
        let backgroundPreload = false;
        let preloadReadyTimer = null;
        let preloadTimeoutTimer = null;
        let defaultChartPeriodApplied = false;

        const finishBackgroundPreload = () => {
            window.clearTimeout(preloadReadyTimer);
            window.clearTimeout(preloadTimeoutTimer);
            preloadReadyTimer = null;
            preloadTimeoutTimer = null;
            overlay.classList.remove('bm-preloading');
        };

        const customizeNativeChart = () => {
            const chartWrapper = bigChart.querySelector('#chartWrapper');
            if (!chartWrapper) return;

            const nativeTitle = Array.from(chartWrapper.querySelectorAll('h3'))
                .find(heading => /preis-?chart/i.test(heading.textContent || ''));
            const nativeTitleRow = nativeTitle?.parentElement;
            nativeTitleRow?.classList.add('bm-native-chart-title');
            const helpRow = nativeTitleRow?.nextElementSibling;
            helpRow?.classList.add('bm-chart-help');

            const periodButtons = Array.from(
                chartWrapper.querySelectorAll('a.buttonPeriod')
            );
            if (periodButtons.length) {
                let periodBar = header.querySelector('.bm-chart-periods');
                if (!periodBar) {
                    periodBar = document.createElement('div');
                    periodBar.className = 'bm-chart-periods';
                    periodBar.setAttribute('aria-label', 'Zeitraum auswählen');
                    header.insertBefore(periodBar, closeButton);
                }
                periodButtons.forEach(button => periodBar.appendChild(button));

                if (!defaultChartPeriodApplied) {
                    const defaultPeriodButton = periodButtons.find(button =>
                        /letzte\s+30\s+tage/i.test(button.textContent || '')
                    );
                    if (defaultPeriodButton) {
                        defaultChartPeriodApplied = true;
                        if (!defaultPeriodButton.classList.contains('hasOrangeBg')) {
                            window.setTimeout(() => defaultPeriodButton.click(), 0);
                        }
                    }
                }
            }

            const saleLink = Array.from(chartWrapper.querySelectorAll('a'))
                .find(link => /im verkauf bei lego ab/i.test(link.textContent || ''));
            if (saleLink) {
                const match = (saleLink.textContent || '').match(
                    /ab\s+(.+?)\s+bis heute/i
                );
                if (match?.[1]) {
                    title.textContent = `Preisentwicklung seit ${match[1].trim()}`;
                }

                const separator = saleLink.nextSibling;
                if (separator?.nodeType === Node.TEXT_NODE) {
                    separator.textContent = separator.textContent.replace(
                        /^\s*\|\s*/,
                        ''
                    );
                }
                saleLink.remove();
            }

            Array.from(chartWrapper.querySelectorAll('a'))
                .filter(link => /zur (?:ebay|bricklink) history/i.test(
                    link.textContent || ''
                ))
                .forEach(link => {
                    const separator = link.nextSibling?.nodeType === Node.TEXT_NODE
                        ? link.nextSibling
                        : link.previousSibling?.nodeType === Node.TEXT_NODE
                            ? link.previousSibling
                            : null;
                    if (separator) {
                        separator.textContent = separator.textContent.replace(
                            /\s*\|\s*/,
                            ''
                        );
                    }
                    link.remove();
                });

            const historyRow = Array.from(chartWrapper.children)
                .find(element => element.querySelector?.('strong') &&
                    /bisheriger bestpreis/i.test(element.textContent || ''));
            if (historyRow) {
                const bestPrice = Array.from(historyRow.querySelectorAll('strong'))
                    .find(element => /bisheriger bestpreis/i.test(
                        element.textContent || ''
                    ));
                const historicalInfo = parseHistoricalBestPriceText(
                    historyRow.textContent || bestPrice?.textContent || ''
                );
                if (historicalInfo?.detailSuffix) {
                    nativeChartHistoricalBestPriceInfo = historicalInfo;
                    writeHistoricalBestPriceDetailToSidebar(
                        historicalInfo.detailSuffix
                    );
                }
                chartTrigger.parentElement?.querySelector('.bm-chart-best-price')
                    ?.remove();
                historyRow.remove();
            }

            if (
                overlay.classList.contains('bm-preloading') &&
                preloadReadyTimer === null
            ) {
                preloadReadyTimer = window.setTimeout(
                    finishBackgroundPreload,
                    500
                );
            }
        };

        const chartObserver = new MutationObserver(customizeNativeChart);
        chartObserver.observe(bigChart, { childList: true, subtree: true });

        const normalizeNativeChartState = () => {
            bigChart.classList.remove('hide');
            bigChart.style.display = 'block';
            customizeNativeChart();

            normalizeChartTriggerLabel();

            const offerColumn = document.getElementById('ol1st');
            offerColumn?.classList.remove('large-12');
            offerColumn?.classList.add('large-8');
        };

        const showOverlay = () => {
            finishBackgroundPreload();
            if (!overlay.classList.contains('bm-open')) {
                storedScrollY = window.scrollY;
            }
            overlay.classList.add('bm-open');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('bm-chart-overlay-open');
            closeButton.focus({ preventScroll: true });
        };

        const closeOverlay = () => {
            if (!overlay.classList.contains('bm-open')) return;
            overlay.classList.remove('bm-open');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('bm-chart-overlay-open');
            window.scrollTo(0, storedScrollY);
            chartTrigger.focus({ preventScroll: true });
        };

        openPriceChartOverlay = () => {
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') {
                normalizeNativeChartState();
                showOverlay();
                return;
            }
            chartTrigger.click();
        };

        // Capture-Phase: Nach dem ersten nativen Laden werden weitere Klicks
        // abgefangen, damit Brickmerge den Chart nicht wieder zuklappt.
        document.addEventListener('click', event => {
            const trigger = event.target.closest?.('#chartTrigger');
            if (!trigger) return;

            if (!backgroundPreload) showOverlay();
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') {
                event.preventDefault();
                event.stopImmediatePropagation();
                normalizeNativeChartState();
                return;
            }

            chartTrigger.dataset.bmNativeChartActivated = 'true';
            window.setTimeout(normalizeNativeChartState, 900);
            window.setTimeout(normalizeNativeChartState, 1800);
        }, true);

        const preloadNativeChart = () => {
            if (chartTrigger.dataset.bmNativeChartActivated === 'true') return;

            overlay.classList.add('bm-preloading');
            backgroundPreload = true;
            try {
                chartTrigger.click();
            } finally {
                backgroundPreload = false;
            }
            preloadTimeoutTimer = window.setTimeout(() => {
                normalizeNativeChartState();
                finishBackgroundPreload();
            }, 8000);
        };

        if (document.readyState === 'complete') {
            window.setTimeout(preloadNativeChart, 100);
        } else {
            window.addEventListener('load', () => {
                window.setTimeout(preloadNativeChart, 100);
            }, { once: true });
        }

        closeButton.addEventListener('click', closeOverlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && overlay.classList.contains('bm-open')) {
                closeOverlay();
            }
        });
    }

    if (setNum) setupPriceChartOverlay();

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
            link.setAttribute('href', '#bm-price-chart-overlay');
            link.setAttribute('aria-controls', 'bm-price-chart-overlay');
        });

        if (document.documentElement.dataset.bmPriceHistoryBound === 'true') return;
        document.documentElement.dataset.bmPriceHistoryBound = 'true';

        document.addEventListener('click', event => {
            const link = event.target.closest?.('a');
            if (!isPriceHistoryLink(link)) return;
            event.preventDefault();
            openPriceChartOverlay?.();
        });
    }
    if (setNum) {
        decoratePriceHistoryLinks();
        window.addEventListener('load', decoratePriceHistoryLinks, { once: true });
    }

    // Die "kürzlich ausverkauft"-Liste wird von der Seite selbst per AJAX in
    // #soldOut nachgeladen. Der Observer führt die Zusammenführung aus, sobald
    // die Angebotszeilen tatsächlich vorhanden sind.
    if (setNum) {
        const soldOutContainer = document.getElementById('soldOut');
        if (soldOutContainer) {
            const mergeLoadedSoldOutOffers = () => {
                if (!mergeSoldOutOffersIntoOfferList()) return;
                soldOutObserver.disconnect();
                window.setTimeout(runOfferPresentationSteps, 0);
            };
            const soldOutObserver = new MutationObserver(mergeLoadedSoldOutOffers);
            soldOutObserver.observe(soldOutContainer, { childList: true, subtree: true });
            mergeLoadedSoldOutOffers();
        }
    }

    // ==========================================
    // 2. LINKLISTE & UI MODUL
    // ==========================================
    if (setNum) {
        const icon = domain => `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(domain)}`;
        const amazonIcon = icon("amazon.de");
        const brickOwlCatalogSearchUrl = value =>
            `https://www.brickowl.com/search/catalog?cat=3&query=${encodeURIComponent(`${value}-1`)}`;
        const brickOwlSearchUrl = value =>
            `https://www.brickowl.com/search/catalog?cat=3&query=${encodeURIComponent(`${value}-1`)}`;

        const groups = [
            {
                title: "Marktplätze",
                links: [
                    { id: "btn-ebay", name: "eBay", url: `https://www.ebay.de/sch/i.html?_dcat=19006&_fsrp=1&_from=R40&_nkw=lego+${setNum}&_sacat=0&LH_BIN=1&LH_PrefLoc=1&LH_ItemCondition=1000&_sop=15`, icon: icon("ebay.de") },
                    { name: "Kleinanzeigen", url: `https://www.kleinanzeigen.de/s-spielzeug/sortierung:preis/lego-${setNum}/k0c23+spielzeug.condition_s:new`, icon: icon("kleinanzeigen.de") },
                    { name: "Vinted", url: `https://www.vinted.de/catalog?search_text=lego+${setNum}`, icon: icon("vinted.de") },
                    { name: "StockX", url: `https://www.google.com/search?q=site%3Astockx.com/de+lego+${setNum}&btnI=1`, icon: icon("stockx.com") },
                    { id: "btn-bo", name: "BrickOwl", url: brickOwlSearchUrl(setNum), icon: icon("brickowl.com") },
                    { id: "btn-bl", name: "Bricklink", url: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNum}-1#T=S&O={%22ss%22:%22DE%22,%22cond%22:%22N%22,%22ii%22:0,%22loc%22:%22DE%22,%22iconly%22:0}`, icon: icon("bricklink.com") }
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
                    {
                        id: "btn-meta-gpt",
                        name: "Meta",
                        url: `https://meta-preisvergleich.de/index.cgi?q=lego+${setNum}&c=kategorie&id=lego_${setNum}__kategorie&offset=&qq=`,
                        icon: icon("meta-preisvergleich.de"),
                        secondaryUrl: META_GPT_URL,
                        secondaryIcon: icon("chatgpt.com")
                    },
                    { name: "Geizhals", url: `https://www.google.com/search?q=site%3Ageizhals.de+lego+${setNum}&btnI=1`, icon: icon("geizhals.at") },
                    { name: "idealo DE", url: `https://www.google.com/search?q=site%3Aidealo.de+lego+${setNum}&btnI=1`, icon: icon("idealo.de") }
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
        .bm-link-viewport {
            overflow-x: auto;
            overflow-y: hidden;
            min-width: 0;
            scroll-behavior: smooth;
            scrollbar-width: none;
            -ms-overflow-style: none;
            touch-action: auto;
            overscroll-behavior-inline: auto;
            -webkit-overflow-scrolling: touch;
        }
        .bm-link-viewport::-webkit-scrollbar { display: none; }
        .bm-info-links { display: flex; flex-wrap: nowrap; width: max-content; gap: 7px 11px; }
        .bm-link { display: inline-flex; flex: 0 0 auto; align-items: center; text-decoration: none; font-size: 0.93em; color: #222; font-weight: 500; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px 4px 6px; line-height: 1.2;}
        .bm-link:hover,
        .bm-link:focus {
            background: #fff !important;
            border-color: #ccc !important;
            color: #222 !important;
        }
        .bm-link[hidden] { display: none !important; }
        .bm-link > img { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; margin-right: 6px; }
        .bm-link-icons {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 2px;
            margin-right: 6px;
        }
        .bm-link-icons img {
            width: 20px;
            height: 20px;
            margin: 0;
            border-radius: 3px;
            object-fit: contain;
        }
        .bm-link:hover span { text-decoration: underline; }
        .bm-meta-dual-link {
            overflow: hidden;
            padding: 0;
        }
        .bm-meta-dual-link > a {
            display: inline-flex;
            min-height: 28px;
            align-items: center;
            padding: 4px 6px;
            color: #222 !important;
            text-decoration: none;
            box-sizing: border-box;
        }
        .bm-meta-dual-link > a:hover,
        .bm-meta-dual-link > a:focus {
            background: transparent !important;
            color: #222 !important;
        }
        .bm-meta-dual-link img {
            width: 20px;
            height: 20px;
            margin: 0;
            border-radius: 3px;
            object-fit: contain;
        }
        .bm-meta-site-link {
            gap: 6px;
        }
        .bm-meta-gpt-trigger {
            border-left: 1px solid #d5d5d5;
        }
        .bm-meta-dual-link:hover span {
            text-decoration: none;
        }
        .bm-meta-site-link:hover .bm-link-label,
        .bm-meta-site-link:focus .bm-link-label {
            color: #222 !important;
            text-decoration: underline;
        }
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
        .bm-link-scroll > span {
            display: block;
            width: 0.46rem;
            height: 0.46rem;
            border-top: 2px solid currentColor;
            border-right: 2px solid currentColor;
            box-sizing: border-box;
        }
        .bm-link-scroll-prev > span { transform: rotate(-135deg); }
        .bm-link-scroll-next > span { transform: rotate(45deg); }
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

        function syncMarketplaceShortcutLinks() {
            const hasOffer = pattern => Array.from(document.querySelectorAll(
                '#offerlist .medium-4.small-9.columns.pricerow[data-mid]'
            )).some(priceRow => {
                const offerRow = priceRow.closest('.row.collapse');
                const merchant = priceRow.querySelector('.merchant')?.textContent || '';
                const logo = offerRow?.querySelector('.goto img[alt]')?.alt || '';
                const tooltip = priceRow.querySelector(':scope > a')?.getAttribute('title') || '';
                const source = [
                    priceRow.dataset.bmSource,
                    priceRow.dataset.mid,
                    offerRow?.dataset.bmSource,
                    merchant,
                    logo,
                    tooltip
                ].filter(Boolean).join(' ');
                return pattern.test(source);
            });

            const rules = [
                { id: 'btn-bl', pattern: /\bbricklink\b/i },
                { id: 'btn-bo', pattern: /\bbrickowl\b|brickowl-de/i }
            ];
            rules.forEach(({ id, pattern }) => {
                const shortcut = document.querySelector(`a[data-bmid="${id}"]`);
                if (shortcut) shortcut.hidden = hasOffer(pattern);
            });
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
                previous.appendChild(document.createElement("span"));
                const next = document.createElement("button");
                next.type = "button";
                next.className = "bm-link-scroll bm-link-scroll-next";
                next.title = "Nach rechts";
                next.setAttribute("aria-label", `${group.title}: nach rechts`);
                next.appendChild(document.createElement("span"));
                for (const {
                    id,
                    name,
                    url,
                    icon,
                    icons,
                    secondaryUrl,
                    secondaryIcon
                } of group.links) {
                    if (secondaryUrl && secondaryIcon) {
                        const dualLink = document.createElement('span');
                        dualLink.className = 'bm-link bm-meta-dual-link';

                        const siteLink = document.createElement('a');
                        siteLink.className = 'bm-meta-site-link';
                        siteLink.href = url;
                        siteLink.target = '_blank';
                        siteLink.rel = 'noopener noreferrer';
                        siteLink.title = 'Set im Meta-Preisvergleich suchen';
                        const siteIcon = document.createElement('img');
                        siteIcon.src = icon;
                        siteIcon.alt = '';
                        const siteLabel = document.createElement('span');
                        siteLabel.className = 'bm-link-label';
                        siteLabel.textContent = name;
                        siteLink.append(siteIcon, siteLabel);

                        const secondaryLink = document.createElement('a');
                        secondaryLink.className = 'bm-meta-gpt-trigger';
                        secondaryLink.href = secondaryUrl;
                        secondaryLink.target = '_blank';
                        secondaryLink.rel = 'noopener noreferrer';
                        secondaryLink.title = 'Set mit vorbereitetem Prompt im Meta-GPT suchen';
                        if (id) secondaryLink.dataset.bmid = id;
                        secondaryLink.dataset.bmDefaultLabel = name;
                        const gptIcon = document.createElement('img');
                        gptIcon.src = secondaryIcon;
                        gptIcon.alt = 'Meta-GPT';
                        secondaryLink.appendChild(gptIcon);

                        dualLink.append(siteLink, secondaryLink);
                        row.appendChild(dualLink);
                        continue;
                    }

                    const a = document.createElement("a");
                    a.href = url; a.target = "_blank"; a.className = "bm-link";
                    if (id) a.dataset.bmid = id;
                    if (Array.isArray(icons) && icons.length) {
                        const iconGroup = document.createElement('span');
                        iconGroup.className = 'bm-link-icons';
                        icons.forEach(source => {
                            const image = document.createElement('img');
                            image.src = source;
                            image.alt = '';
                            iconGroup.appendChild(image);
                        });
                        a.appendChild(iconGroup);
                    } else {
                        const img = document.createElement("img");
                        img.src = icon;
                        img.alt = "";
                        a.appendChild(img);
                    }
                    const span = document.createElement("span");
                    span.className = 'bm-link-label';
                    span.textContent = name;
                    a.dataset.bmDefaultLabel = name;
                    a.appendChild(span);
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
            syncMarketplaceShortcutLinks();
            const offerlist = document.getElementById('offerlist');
            if (offerlist) {
                const marketplaceOfferObserver = new MutationObserver(
                    syncMarketplaceShortcutLinks
                );
                marketplaceOfferObserver.observe(offerlist, {
                    childList: true,
                    subtree: true
                });
            }
            fetchAndInjectPrices(setNum);
        }

        if (document.readyState !== "loading") injectBox();
        else window.addEventListener("DOMContentLoaded", injectBox);

        // --- PREIS-ABFRAGE & INTEGRATION ---
        function fetchAndInjectPrices(setNumber) {
            const offersByKey = new Map();
            const normalizeMerchantText = value => String(value || '')
                .toLocaleLowerCase('de')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/ü/g, 'u')
                .replace(/\s+/g, ' ')
                .trim();
            const hasNativeMerchant = aliases => {
                const normalizedAliases = aliases.map(normalizeMerchantText);
                return Array.from(document.querySelectorAll(
                    '#offerlist .medium-4.small-9.columns.pricerow[data-mid]' +
                    ':not([data-bm-marketplace="true"])'
                )).filter(priceRow =>
                    !priceRow.closest('#soldOut') &&
                    priceRow.dataset.bmSoldOut !== 'true'
                ).some(priceRow => {
                    const mid = priceRow.dataset.mid;
                    const merchant = priceRow.querySelector('.merchant')?.textContent || '';
                    const logo = mid
                        ? document.getElementById(`mid${mid}`)?.querySelector('img[alt]')?.alt || ''
                        : '';
                    const link = priceRow.querySelector(':scope > a');
                    const tooltip = link?.dataset.bmOriginalTooltip ||
                        link?.getAttribute('title') ||
                        '';
                    const haystack = normalizeMerchantText(
                        `${merchant} ${logo} ${tooltip}`
                    );
                    return normalizedAliases.some(alias =>
                        haystack === alias ||
                        haystack.startsWith(`${alias} `) ||
                        haystack.includes(`link zu ${alias} `)
                    );
                });
            };
            const syncOffers = () => {
                const offers = Array.from(offersByKey.values()).filter(offer => {
                    if (offer.key === 'amz') {
                        return !hasNativeMerchant(['amazon']);
                    }
                    if (offer.key === 'ebay' && offer.source === 'mybrickdepot') {
                        return !hasNativeMerchant(['ebay', 'ebay.de']);
                    }
                    if (offer.key === 'mueller-search') {
                        return !hasNativeMerchant(['müller', 'mueller']);
                    }
                    return true;
                });
                injectMarketplaceOffers(offers);
                syncMarketplaceShortcutLinks();
            };
            const storeOffers = offers => {
                offers.filter(Boolean).forEach(offer => {
                    offersByKey.set(offer.key, offer);
                });
                syncOffers();
            };
            const directSearchOffers = [
                {
                    key: 'amz',
                    label: 'Keepa',
                    priceText: '',
                    url: `https://keepa.com/#!search/3-lego%20${setNumber}`,
                    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/79/Keepa-logo.svg',
                    source: 'direct-search',
                    allowUnknownPrice: true,
                    shippingStatus: 'unknown',
                    shippingCost: null
                },
            ];
            storeOffers(directSearchOffers);
            function extractPrice(html, regex) {
                const match = html.match(regex);
                return match ? match[1] + ' €' : '';
            }
            function parseMyBrickHtml(html) {
                return {
                    ebay: extractPrice(html, /eBay Preis(?:[^0-9]+)?(\d+(?:,\d+)?)/i),
                    amazon: extractPrice(html, /Amazon Preis(?:[^0-9]+)?(\d+(?:,\d+)?)/i)
                };
            }
            function parseBrickbankVendorOffer(jsonText, vendorPattern) {
                let payload;
                try {
                    payload = JSON.parse(jsonText);
                } catch (error) {
                    return null;
                }

                const entries = payload?.pvg && typeof payload.pvg === 'object'
                    ? Object.values(payload.pvg)
                    : [];
                const vendorOffer = entries.find(entry => {
                    const haystack = [
                        entry?.vendor,
                        entry?.name,
                        entry?.shop,
                        entry?.link
                    ].filter(Boolean).join(' ');
                    return vendorPattern.test(haystack);
                });
                const price = Number(String(vendorOffer?.preis ?? '').replace(',', '.'));
                if (!vendorOffer || !Number.isFinite(price) || price <= 0) return null;

                return {
                    price,
                    url: String(vendorOffer.link || '').trim(),
                    availability: String(vendorOffer.availability || '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                };
            }
            function parseBrickLinkItemId(html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const scriptText = Array.from(doc.scripts)
                    .map(script => script.textContent || '')
                    .join('\n');
                const scriptMatch = scriptText.match(/\bidItem\s*:\s*(\d+)/);
                const dataItemId = doc.querySelector('[data-itemid]')?.dataset.itemid;
                const itemId = Number(scriptMatch?.[1] || dataItemId);
                return Number.isInteger(itemId) && itemId > 0 ? itemId : null;
            }
            function parseBrickLinkPrice(priceText) {
                const match = String(priceText || '').match(
                    /(?:EUR|€)\s*([\d.,]+)|([\d.,]+)\s*(?:EUR|€)/i
                );
                if (!match) return null;

                const raw = match[1] || match[2];
                const comma = raw.lastIndexOf(',');
                const dot = raw.lastIndexOf('.');
                let normalized = raw;
                if (comma >= 0 && dot >= 0) {
                    normalized = comma > dot
                        ? raw.replace(/\./g, '').replace(',', '.')
                        : raw.replace(/,/g, '');
                } else if (comma >= 0) {
                    normalized = raw.replace(',', '.');
                }

                const price = Number(normalized);
                return Number.isFinite(price) && price > 0 ? price : null;
            }
            function parseBrickLinkGermanOffers(jsonText) {
                let payload;
                try {
                    payload = JSON.parse(jsonText);
                } catch (error) {
                    return null;
                }

                const offers = Array.isArray(payload?.list)
                    ? payload.list.filter(offer =>
                        offer?.strSellerCountryCode === 'DE' &&
                        offer?.codeNew === 'N' &&
                        offer?.codeComplete !== 'I'
                    ).map(offer => ({
                        price: parseBrickLinkPrice(
                            offer.mDisplaySalePrice || offer.mInvSalePrice
                        ),
                        storeName: String(offer.strStorename || '').trim()
                    })).filter(offer => offer.price !== null)
                    : [];
                if (offers.length === 0) return null;

                offers.sort((a, b) => a.price - b.price);
                return {
                    ...offers[0],
                    totalLots: offers.length
                };
            }
            function parseBrickOwlGermanOffers(html, fallbackUrl) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const rows = Array.from(doc.querySelectorAll(
                    '#buy table.buy-table tbody tr, table.buy-table tbody tr, ' +
                    '#buy tr, .buy-table tr'
                ));
                const offers = rows.map(row => {
                    const cells = Array.from(row.children);
                    if (cells.length < 7) return null;

                    const rowText = (row.textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const condition = (cells[1].textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (!/New\s*\(Sealed\)|Neu\s*\((?:Sealed|Versiegelt|Verschlossen|Ungeöffnet|Originalverpackt)\)|\bNeu\b/i.test(condition || rowText)) {
                        return null;
                    }

                    const flag = cells[6].querySelector('img.flag');
                    const country = `${flag?.alt || ''} ${flag?.title || ''} ${cells[6].textContent || ''}`;
                    if (!/\bGermany\b|Deutschland/i.test(country)) return null;

                    const price = parseBrickLinkPrice(cells[4].textContent || '');
                    if (price === null) return null;

                    const total = parseBrickLinkPrice(cells[5].textContent || '');
                    const shippingFromStore = parseBrickLinkPrice(
                        (cells[6].textContent || '').match(/(?:Shipping|Versand)\s*(?:~\s*)?(€?\s*[\d.,]+|[\d.,]+\s*€)/i)?.[1] || ''
                    );
                    const shippingCost = total !== null
                        ? Math.max(0, Math.round(((total - price) + Number.EPSILON) * 100) / 100)
                        : shippingFromStore;
                    const shippingStatus = shippingCost === null
                        ? 'unknown'
                        : shippingCost <= 0.004
                            ? 'free'
                            : 'paid';
                    const storeLink = cells[6].querySelector('.after-flag a[href]') ||
                        cells[6].querySelector('a[href]');
                    const itemLink = cells[2].querySelector('a[href]') ||
                        cells[0].querySelector('a[href]');
                    const href = itemLink?.getAttribute('href') ||
                        storeLink?.getAttribute('href') ||
                        fallbackUrl;
                    const storeName = (storeLink?.textContent || '').trim();

                    return {
                        price,
                        total: total !== null ? total : null,
                        sortPrice: total !== null ? total : price,
                        shippingCost,
                        shippingStatus,
                        storeName,
                        url: new URL(href, 'https://www.brickowl.com').href
                    };
                }).filter(Boolean);

                if (offers.length === 0) return null;
                offers.sort((a, b) =>
                    (a.sortPrice - b.sortPrice) || (a.price - b.price)
                );
                return {
                    ...offers[0],
                    totalLots: offers.length
                };
            }
            function findBrickOwlCatalogUrl(html, setNumber, baseUrl) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const canonical = doc.querySelector(
                    'link[rel="canonical"][href*="/catalog/"]'
                )?.getAttribute('href');
                if (canonical && !/\/search\//i.test(canonical)) {
                    return new URL(canonical, baseUrl).href;
                }

                const escapedSetNumber = String(setNumber)
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const setPattern = new RegExp(
                    `(?:^|[^0-9])${escapedSetNumber}(?:[^0-9]|$)`
                );
                const link = Array.from(
                    doc.querySelectorAll('a[href*="/catalog/"]')
                ).find(anchor => {
                    const href = anchor.getAttribute('href') || '';
                    const label = anchor.textContent || '';
                    return setPattern.test(`${href} ${label}`);
                });
                return link ? new URL(link.getAttribute('href'), baseUrl).href : '';
            }
            function getResponseHeader(headers, name) {
                const target = name.toLowerCase();
                for (const line of String(headers || '').split(/\r?\n/)) {
                    const separatorIndex = line.indexOf(':');
                    if (separatorIndex < 0) continue;
                    const key = line.slice(0, separatorIndex).trim().toLowerCase();
                    if (key === target) {
                        return line.slice(separatorIndex + 1).trim();
                    }
                }
                return '';
            }
            const createOffer = (
                buttonId,
                label,
                priceText,
                logoUrl,
                source,
                priceSource = '',
                extra = {}
            ) => {
                const button = document.querySelector(`a[data-bmid="${buttonId}"]`);
                if (!button || !priceText) return null;
                return {
                    key: buttonId.replace(/^btn-/, ''),
                    label,
                    priceText,
                    url: button.href,
                    logoUrl,
                    source,
                    priceSource,
                    ...extra
                };
            };

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
                            keepa: 'https://upload.wikimedia.org/wikipedia/commons/7/79/Keepa-logo.svg'
                        };
                        const offers = [
                            createOffer(
                                'btn-ebay',
                                'eBay',
                                prices.ebay,
                                logos.ebay,
                                'mybrickdepot'
                            ),
                            createOffer(
                                'btn-amz',
                                'Keepa',
                                prices.amazon,
                                logos.keepa,
                                'mybrickdepot'
                            )
                        ].filter(Boolean);
                        storeOffers(offers);
                    }
                },
                onerror: function() {
                    console.warn("Brickmerge Toolkit: Preisabfrage bei MyBrickDepot fehlgeschlagen.");
                },
                ontimeout: function() {
                    console.warn("Brickmerge Toolkit: Preisabfrage bei MyBrickDepot - Timeout.");
                }
            });

            GM_xmlhttpRequest({
                method: 'GET',
                url:
                    `https://brickbank.app/public/ajax/search/?db=pvg&s=` +
                    encodeURIComponent(`${setNumber}-1`),
                headers: {
                    'Accept': 'application/json,text/plain,*/*',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout: 15000,
                onload: response => {
                    if (response.status !== 200) {
                        console.warn(
                            `Brickmerge Tweaker: Brickbank antwortete mit Status ${response.status}.`
                        );
                        return;
                    }

                    const brickbankVendors = [
                        {
                            key: 'smyths-search',
                            label: 'Smyths',
                            pattern: /smyth/i,
                            searchDomain: 'smythstoys.com/de',
                            logoUrl:
                                'https://commons.wikimedia.org/wiki/' +
                                'Special:Redirect/file/Smyths_Logo.svg',
                            logoFallbackUrl:
                                'https://www.google.com/s2/favicons?sz=128&domain_url=smythstoys.com'
                        },
                        {
                            key: 'mueller-search',
                            label: 'Müller',
                            pattern: /m[uü]eller|müller/i,
                            searchDomain: 'mueller.de',
                            logoUrl: new URL(
                                '/img/merchants/m_ller_ico.gif',
                                window.location.origin
                            ).href,
                            logoFallbackUrl:
                                'https://www.google.com/s2/favicons?sz=128&domain_url=mueller.de'
                        }
                    ];
                    const offers = brickbankVendors.map(vendor => {
                        const brickbankOffer = parseBrickbankVendorOffer(
                            response.responseText,
                            vendor.pattern
                        );
                        if (!brickbankOffer) return null;

                        const isSmyths = vendor.key === 'smyths-search';
                        const shippingStatus = isSmyths
                            ? brickbankOffer.price >= 20
                                ? 'free'
                                : 'paid'
                            : 'unknown';
                        const shippingCost = isSmyths
                            ? brickbankOffer.price >= 20
                                ? 0
                                : 3.95
                            : null;
                        const clickoutUrl = isSmyths
                            ? (
                                `https://www.google.com/search?btnI=1&q=` +
                                encodeURIComponent(
                                    `site:${vendor.searchDomain} LEGO ${setNumber}`
                                )
                            )
                            : (
                                `https://duckduckgo.com/?q=` +
                                encodeURIComponent(
                                    `!ducky site:${vendor.searchDomain} LEGO ${setNumber}`
                                )
                            );
                        return {
                            key: vendor.key,
                            label: vendor.label,
                            priceText: `${formatEuroValue(brickbankOffer.price)} €`,
                            url: clickoutUrl,
                            logoUrl: vendor.logoUrl,
                            logoFallbackUrl: vendor.logoFallbackUrl,
                            source: `brickbank-${vendor.key.replace(/-search$/, '')}`,
                            priceSource:
                                `Brickbank: aktueller ${vendor.label}-Preis` +
                                `${brickbankOffer.availability ? `; ${brickbankOffer.availability}` : ''}`,
                            shippingStatus,
                            shippingCost
                        };
                    }).filter(Boolean);
                    if (offers.length > 0) storeOffers(offers);
                },
                onerror: () => {
                    console.warn(
                        'Brickmerge Tweaker: Brickbank-Preisabfrage fehlgeschlagen.'
                    );
                },
                ontimeout: () => {
                    console.warn(
                        'Brickmerge Tweaker: Brickbank-Preisabfrage - Timeout.'
                    );
                }
            });

            GM_xmlhttpRequest({
                method: 'GET',
                url:
                    `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNumber}-1`,
                headers: {
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
                },
                timeout: 15000,
                onload: response => {
                    if (response.status !== 200) return;
                    const itemId = parseBrickLinkItemId(response.responseText);
                    if (!itemId) {
                        console.warn(
                            'Brickmerge Tweaker: BrickLink-Artikelkennung konnte nicht gelesen werden.'
                        );
                        return;
                    }

                    GM_xmlhttpRequest({
                        method: 'GET',
                        url:
                            'https://www.bricklink.com/ajax/clone/catalogifs.ajax' +
                            `?itemid=${encodeURIComponent(itemId)}` +
                            '&ss=DE&cond=N&ii=0&loc=DE&iconly=0&rpp=100&pi=1&st=1',
                        headers: {
                            'Accept': 'application/json',
                            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
                        },
                        timeout: 15000,
                        onload: offerResponse => {
                            if (offerResponse.status !== 200) return;
                            const germanOffers = parseBrickLinkGermanOffers(
                                offerResponse.responseText
                            );
                            if (!germanOffers) {
                                console.warn(
                                    'Brickmerge Tweaker: Keine passenden deutschen BrickLink-Angebote gefunden.'
                                );
                                return;
                            }

                            const sellerDescription = germanOffers.storeName
                                ? `; günstigstes Angebot von ${germanOffers.storeName}`
                                : '';
                            const offer = createOffer(
                                'btn-bl',
                                'BrickLink',
                                `${formatEuroValue(germanOffers.price)} €`,
                                'https://static2.bricklink.com/img/bricklink_2026.svg',
                                'bricklink-de',
                                `BrickLink: niedrigster aktueller Neupreis bei deutschen Händlern aus ${germanOffers.totalLots} Angeboten${sellerDescription}`
                            );
                            if (offer) storeOffers([offer]);
                        },
                        onerror: () => {
                            console.warn(
                                'Brickmerge Tweaker: Deutsche BrickLink-Angebote konnten nicht geladen werden.'
                            );
                        },
                        ontimeout: () => {
                            console.warn(
                                'Brickmerge Tweaker: Deutsche BrickLink-Angebote - Timeout.'
                            );
                        }
                    });
                },
                onerror: () => {
                    console.warn(
                        'Brickmerge Tweaker: BrickLink-Artikelseite konnte nicht geladen werden.'
                    );
                },
                ontimeout: () => {
                    console.warn(
                        'Brickmerge Tweaker: BrickLink-Artikelseite - Timeout.'
                    );
                }
            });

            function fetchBrickOwlOffers(url, redirectCount = 0) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                        'User-Agent': 'Mozilla/5.0'
                    },
                    timeout: 15000,
                    onload: response => {
                        if ([301, 302, 303, 307, 308].includes(response.status) &&
                            redirectCount < 5) {
                            const location = getResponseHeader(
                                response.responseHeaders,
                                'location'
                            );
                            if (location) {
                                fetchBrickOwlOffers(
                                    new URL(location, url).href,
                                    redirectCount + 1
                                );
                                return;
                            }
                        }

                        if (response.status !== 200) {
                            console.warn(
                                `Brickmerge Tweaker: BrickOwl antwortete mit Status ${response.status} für ${url}.`
                            );
                            return;
                        }

                        const pageUrl = response.finalUrl || url;
                        const brickOwlOffer = parseBrickOwlGermanOffers(
                            response.responseText,
                            pageUrl
                        );
                        if (!brickOwlOffer) {
                            const catalogUrl = redirectCount < 5
                                ? findBrickOwlCatalogUrl(
                                    response.responseText,
                                    setNumber,
                                    pageUrl
                                )
                                : '';
                            if (
                                catalogUrl &&
                                catalogUrl !== pageUrl &&
                                !/\/search\//i.test(catalogUrl)
                            ) {
                                fetchBrickOwlOffers(catalogUrl, redirectCount + 1);
                                return;
                            }
                            console.warn(
                                `Brickmerge Tweaker: Keine passenden deutschen BrickOwl-Angebote gefunden (${pageUrl}).`
                            );
                            return;
                        }

                        const sellerDescription = brickOwlOffer.storeName
                            ? `; günstigstes Angebot von ${brickOwlOffer.storeName}`
                            : '';
                        const shippingDescription = brickOwlOffer.shippingStatus === 'paid'
                            ? `; Versand ${formatEuroValue(brickOwlOffer.shippingCost)} €`
                            : brickOwlOffer.shippingStatus === 'free'
                                ? '; Versand frei'
                                : '; Versand unbekannt';
                        const offer = createOffer(
                            'btn-bo',
                            'BrickOwl',
                            `${formatEuroValue(brickOwlOffer.price)} €`,
                            'https://img.brickowl.com/sites/default/themes/bs_ss/images/logo-svg-v3-shifted.svg',
                            'brickowl-de',
                            `BrickOwl: günstigstes aktuelles Neupreis-Angebot bei deutschen Händlern aus ${brickOwlOffer.totalLots} Angeboten${sellerDescription}${shippingDescription}`,
                            {
                                url: brickOwlOffer.url,
                                shippingStatus: brickOwlOffer.shippingStatus,
                                shippingCost: brickOwlOffer.shippingCost
                            }
                        );
                        if (offer) storeOffers([offer]);
                    },
                    onerror: () => {
                        console.warn(
                            'Brickmerge Tweaker: BrickOwl-Angebote konnten nicht geladen werden.'
                        );
                    },
                    ontimeout: () => {
                        console.warn(
                            'Brickmerge Tweaker: BrickOwl-Angebote - Timeout.'
                        );
                    }
                });
            }
            fetchBrickOwlOffers(brickOwlCatalogSearchUrl(setNumber));
        }
    }

    // ==========================================
    // 3. COPY-ICON & MINIFIGUREN-OVERLAY
    // ==========================================
    function runOfferPresentationSteps() {
        [
            removeOfferListPriceDecorations,
            injectShippingCostsFromOfferTitles,
            applyRetailerDiscounts,
            sortOffersByConfiguredPrice,
            mergeSoldOutOffersIntoOfferList,
            updateOfferTooltips,
            syncEffectivePriceLabels,
            syncOfferDiscountBubbles,
            placeSoldOutBadgesAfterShipping,
            calculateDiscount,
            decoratePriceHistoryLinks,
            createDiscountSettingsUI,
            disableOfferListTooltips
        ].forEach(step => {
            try {
                step();
            } catch (error) {
                console.error(
                    `Brickmerge Tweaker: ${step.name} konnte nicht ausgeführt werden.`,
                    error
                );
            }
        });
    }

    if (setNum) {
        // Unabhängiger Startpfad: funktioniert auch dann, wenn ein späteres,
        // nicht zur Offerlist gehörendes Modul auf einer Sonderseite fehlschlägt.
        [150, 600, 1600, 3500].forEach(delay => {
            window.setTimeout(runOfferPresentationSteps, delay);
        });
    }

    if (setNum) {
        try {
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
        } catch (error) {
            console.error(
                'Brickmerge Tweaker: Titel-Kopierfunktion konnte nicht initialisiert werden.',
                error
            );
        }

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
                const link = e.target?.closest?.('.bm-minifig-link, .bm-minifig-count-link');
                if (link) {
                    e.preventDefault();
                    showMinifigOverlay(link, setNum);
                }
            });
        }

        function linkMinifigureCount(setNum) {
            const details = Array.from(
                document.querySelectorAll('.content.setdetails p, #ol2nd p, p')
            ).find(paragraph => /Minifiguren\s*:/i.test(paragraph.textContent || ''));
            if (!details || details.querySelector('.bm-minifig-count-link')) return;

            const createCountLink = countText => {
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'bm-lego-article-link bm-minifig-count-link';
                link.title = 'Minifiguren anzeigen';
                link.setAttribute('aria-label', `${countText.trim()} Minifiguren anzeigen`);
                return link;
            };

            const range = document.createRange();
            const strongMatch = Array.from(details.querySelectorAll('strong'))
                .find(strong => {
                    if (!/^\s*\d+\s*$/.test(strong.textContent || '')) return false;
                    range.selectNodeContents(details);
                    try {
                        range.setEndBefore(strong);
                    } catch (error) {
                        return false;
                    }
                    return /Minifiguren\s*:\s*$/i.test(
                        range.toString().replace(/\s+/g, ' ')
                    );
                });
            range.detach?.();

            if (strongMatch && !strongMatch.closest('a')) {
                const link = createCountLink(strongMatch.textContent);
                strongMatch.replaceWith(link);
                link.appendChild(strongMatch);
                return;
            }

            const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT);
            let labelSeen = false;
            let textNode;
            while (textNode = walker.nextNode()) {
                if (textNode.parentElement?.closest('a')) continue;
                const text = textNode.nodeValue || '';
                const sameNodeMatch = text.match(/Minifiguren\s*:\s*(\d+)/i);
                const numberMatch = sameNodeMatch || (labelSeen ? text.match(/\d+/) : null);
                if (numberMatch) {
                    const countText = sameNodeMatch ? sameNodeMatch[1] : numberMatch[0];
                    const numberStart = sameNodeMatch
                        ? sameNodeMatch.index + sameNodeMatch[0].lastIndexOf(countText)
                        : numberMatch.index;
                    const numberEnd = numberStart + countText.length;
                    const fragment = document.createDocumentFragment();
                    fragment.appendChild(document.createTextNode(text.slice(0, numberStart)));
                    const link = createCountLink(countText);
                    link.textContent = countText;
                    fragment.appendChild(link);
                    fragment.appendChild(document.createTextNode(text.slice(numberEnd)));
                    textNode.parentNode.replaceChild(fragment, textNode);
                    return;
                }
                if (/Minifiguren\s*:\s*$/i.test(text.replace(/\s+/g, ' '))) {
                    labelSeen = true;
                }
            }
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
                    background:rgba(0,0,0,0.64);
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
                    border-top:5px solid #b00;
                    border-radius:4px;
                    box-shadow:0 18px 48px rgba(0,0,0,0.32);
                    z-index:1;
                    animation:bmzoom 0.16s ease-out;
                }
                .bm-minifig-header {
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    flex:0 0 auto;
                    min-height:64px;
                    padding:0.8rem 0.8rem 0.8rem 1.25rem;
                    border-bottom:1px solid #ddd;
                    background:#fff;
                    box-shadow:none !important;
                }
                .bm-minifig-header h2 {
                    margin:0;
                    padding:0;
                    color:#333;
                    font-size:1.25rem;
                    font-weight:700;
                    line-height:1.25;
                    text-shadow:none !important;
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
                    flex:0 0 40px;
                    width:40px;
                    height:40px;
                    margin:0;
                    padding:0;
                    border:0;
                    border-radius:4px;
                    background:#f7eaea;
                    color:#800;
                    cursor:pointer;
                    font:bold 1.8rem/1 Arial,sans-serif;
                    text-shadow:none !important;
                }
                .bm-minifig-close:hover,
                .bm-minifig-close:focus {
                    background:#b00;
                    color:#fff;
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
        try {
            replaceMinifigurenWithLink(setNum);
            linkMinifigureCount(setNum);
            window.addEventListener('load', () => {
                try {
                    linkMinifigureCount(setNum);
                } catch (error) {
                    console.error(
                        'Brickmerge Tweaker: Minifiguren-Anzahl konnte nicht verlinkt werden.',
                        error
                    );
                }
            }, { once: true });
        } catch (error) {
            console.error(
                'Brickmerge Tweaker: Minifiguren-Links konnten nicht initialisiert werden.',
                error
            );
        }
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

                document.addEventListener('bm-tooltip-disable-request', event => {
                    const anchor = event.target;
                    captureTooltip(anchor);

                    if (window.jQuery && typeof window.jQuery.fn?.tooltipster === 'function') {
                        try {
                            const target = window.jQuery(anchor);
                            if (target.hasClass('tooltipstered')) {
                                target.tooltipster('hide');
                                target.tooltipster('destroy');
                            }
                        } catch (e) {}
                    }

                    anchor.removeAttribute('title');
                    anchor.classList.remove('tooltipster', 'tooltipstered');
                    anchor.dataset.bmTooltipDisabled = 'true';
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

    function disableOfferListTooltips() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

        offerlist.querySelectorAll('a').forEach(anchor => {
            const hasTooltip = anchor.classList.contains('tooltipster') ||
                anchor.classList.contains('tooltipstered') ||
                anchor.hasAttribute('title') ||
                anchor.dataset.bmOriginalTooltip ||
                anchor.dataset.bmTooltip;
            if (!hasTooltip) return;

            // Erst jetzt deaktivieren: Versandkosten, Gutscheine und Zeitstempel
            // wurden in den vorherigen Verarbeitungsschritten bereits gelesen.
            getOriginalOfferTitle(anchor);
            anchor.dispatchEvent(new CustomEvent('bm-tooltip-disable-request', {
                bubbles: true
            }));
            anchor.removeAttribute('title');
            anchor.classList.remove('tooltipster', 'tooltipstered');
        });
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
                const brickmergeOfferPrices = [];

                // Aktuelle Preise sammeln
                const priceElements = document.querySelectorAll('.theprice, .price, .offer-price, td.price, span.price, .topprice');
                priceElements.forEach(el => {
                    if (el.closest('[data-bm-sold-out="true"]')) {
                        return;
                    }
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

                document.querySelectorAll(
                    '#offerlist .medium-4.small-9.columns.pricerow' +
                    ':not([data-bm-marketplace="true"])'
                ).forEach(priceRow => {
                    if (priceRow.dataset.bmSoldOut === 'true') return;
                    const priceSpan = priceRow.querySelector('span.price');
                    const price = priceSpan ? getBaseOfferPrice(priceSpan) : null;
                    if (price !== null && price > 0) {
                        brickmergeOfferPrices.push(price);
                    }
                });

                const uniqueSortedPrices = [...new Set(prices)].sort((a, b) => a - b);
                const uniqueSortedBrickmergeOfferPrices = [
                    ...new Set(brickmergeOfferPrices)
                ].sort((a, b) => a - b);

                if (uniqueSortedBrickmergeOfferPrices.length >= 2) {
                    const price1 = uniqueSortedBrickmergeOfferPrices[0]; // Günstigstes Brickmerge-Angebot
                    // uniqueSortedBrickmergeOfferPrices entsteht aus einem Set numerischer Werte, d.h. exakt
                    // identische Preise sind hier bereits herausgefiltert. price2 ist also immer
                    // schon der nächst-*unterschiedliche* (höhere) Preis - "wenn zweitbestes
                    // identisch, dann drittbestes nehmen" ist dadurch automatisch erfüllt.
                    const price2 = uniqueSortedBrickmergeOfferPrices[1]; // nächstteureres, abweichendes Brickmerge-Angebot

                    // Rabatt als ganze Zahl runden
                    const discount = ((1 - (price1 / price2)) * 100).toFixed(0);

                    if (Number(discount) >= 0) {
                        const redBubbles = Array.from(document.querySelectorAll('.off'))
                            .filter(bubble => !bubble.classList.contains('black-discount-bubble'));
                        if (redBubbles.length > 0) {
                            createBlackBubble(discount, redBubbles);
                        }
                        ensureFeaturedBlackBubble(discount);
                        createBestPriceBlackBubble(discount);
                    }
                }

                // All-Time-Bestpreis suchen und einfügen
                if (uniqueSortedPrices.length >= 1) {
                    const currentBestPrice = uniqueSortedPrices[0];
                    const historicalData = findAllTimeBestPrice();
                    if (historicalData) {
                        insertAllTimeDiscountRow(
                            currentBestPrice,
                            historicalData.price,
                            historicalData.element,
                            historicalData.detailSuffix
                        );
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
                blackBubble.title =
                    `${discountText}% günstiger als das nächstteurere Brickmerge-Angebot`;

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

        // Wenn es auf dem Produktbild keine rote UVP-Bubble gibt, fehlt sonst die
        // Vorlage zum Klonen. In dem Fall zeigen wir die schwarze Bubble einzeln.
    function ensureFeaturedBlackBubble(discountText) {
            const featuredContainers = [
                document.querySelector(
                    '.content.setdetails .large-3.medium-4.columns.hide-for-small'
                ),
                document.querySelector(
                    '.content.setdetails .show-for-small-only.text-center'
                )
            ].filter(Boolean);

            featuredContainers.forEach(container => {
                if (container.querySelector(':scope > .off:not(.black-discount-bubble)')) {
                    return;
                }

                let bubble = container.querySelector(':scope > .bm-featured-black-bubble');
                if (!bubble) {
                    bubble = document.createElement('div');
                    bubble.className = 'black-discount-bubble bm-featured-black-bubble';
                    container.prepend(bubble);
                }
                bubble.textContent = `${discountText}%`;
                bubble.title = `${discountText}% günstiger als das nächstteurere Brickmerge-Angebot`;
            });
    }

        // Der Abstand zum nächstteureren Angebot gehört auch immer an den
        // Brickmerge-Bestpreis, unabhängig davon, ob dort ein UVP-Badge existiert.
    function createBestPriceBlackBubble(discountText) {
            document.querySelectorAll('.topprice').forEach(topprice => {
                const badge = document.createElement('span');
                badge.className = 'black-discount-bubble bm-bestprice-black-bubble';
                badge.textContent = `${discountText}%`;
                badge.title = `${discountText}% günstiger als das nächstteurere Brickmerge-Angebot`;
                const hasNativeDiscountBubble = Array.from(
                    topprice.querySelectorAll('span[style*="position: absolute"]')
                ).some(element =>
                    !element.classList.contains('black-discount-bubble') &&
                    /%/.test(element.textContent || '')
                );
                if (!hasNativeDiscountBubble) {
                    badge.classList.add('bm-bestprice-black-bubble-single');
                }
                topprice.style.setProperty('position', 'relative');
                topprice.appendChild(badge);
            });
    }

        // Suche nach dem "bisherigen Bestpreis"
    function findAllTimeBestPrice() {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;

            while (node = walker.nextNode()) {
                if (node.nodeValue.toLowerCase().includes('bisheriger bestpreis')) {
                    let container = node.parentElement;
                    const historicalInfo = parseHistoricalBestPriceText(
                        container.textContent
                    );
                    if (historicalInfo) {
                        // Hinweis: bewusst KEIN Hochklettern mehr zu LI/DIV/P/TR.
                        // Auf Detailseiten steckt "bisheriger Bestpreis" in einem
                        // einzigen großen <p> zusammen mit vielen anderen Infozeilen;
                        // das alte Hochklettern hängte die Vergleichszeile dadurch
                        // ans Ende des kompletten Absatzes statt direkt dahinter.
                        return { element: container, ...historicalInfo };
                    }
                }
            }
            return null;
    }

    function findSidebarHistoricalBestPriceRow(seedElement) {
            if (!seedElement) return null;

            const directMatch = seedElement.closest?.('p, div, li, span');
            if (
                directMatch &&
                /bisheriger bestpreis/i.test(directMatch.textContent || '')
            ) {
                return directMatch;
            }

            return Array.from(document.querySelectorAll('p, div, li, span')).find(
                element =>
                    /bisheriger bestpreis/i.test(element.textContent || '') &&
                    /€/.test(element.textContent || '')
            ) || null;
    }

    function updateSidebarHistoricalBestPriceDetail(matchedElement, detailSuffix) {
            writeHistoricalBestPriceDetailToSidebar(
                nativeChartHistoricalBestPriceInfo?.detailSuffix || detailSuffix,
                matchedElement
            );
    }

        // Fügt die Rabatt-Zeile ein
    function insertAllTimeDiscountRow(currentPrice, allTimeBest, matchedElement, detailSuffix = '') {
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
            newEl.innerHTML = `<br />&nbsp;<span class="contentcolor" style="color: #b00;">|</span> <a class="bm-price-history-link" href="#bm-price-chart-overlay" aria-controls="bm-price-chart-overlay">Differenz zum ATB: <strong style="color: ${color};">${percentStr}</strong></a>`;

            updateSidebarHistoricalBestPriceDetail(matchedElement, detailSuffix);
            matchedElement.parentNode.insertBefore(newEl, matchedElement.nextSibling);
            decoratePriceHistoryLinks();
    }

    if (setNum) {
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

    function injectMarketplaceOffers(offers) {
        const offerlist = document.getElementById('offerlist');
        const firstPriceRow = offerlist?.querySelector(
            '.medium-4.small-9.columns.pricerow:not([data-bm-marketplace="true"])'
        );
        const parent = firstPriceRow?.closest('.row.collapse')?.parentElement;
        if (!offerlist || !parent) {
            if (offerlist && !offerlist.dataset.bmMarketplaceRetryScheduled) {
                offerlist.dataset.bmMarketplaceRetryScheduled = 'true';
                window.setTimeout(() => {
                    delete offerlist.dataset.bmMarketplaceRetryScheduled;
                    injectMarketplaceOffers(offers);
                }, 250);
            }
            return;
        }

        parent.querySelectorAll('.bm-marketplace-offer').forEach(row => row.remove());

        offers.forEach(offer => {
            const price = parseEuroValue(offer.priceText);
            const hasUnknownPrice = price === null && offer.allowUnknownPrice === true;
            if ((!hasUnknownPrice && price === null) || !offer.url) return;

            const mid = offer.source === 'mybrickdepot'
                ? `mbd-${offer.key}`
                : `market-${offer.key}`;
            const wrapper = document.createElement('div');
            wrapper.className = 'row collapse bm-marketplace-offer';
            wrapper.dataset.bmSource = offer.source || 'marketplace';
            wrapper.dataset.bmMarketplace = 'true';

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
            if (offer.key === 'ebay' && offer.source === 'mybrickdepot') {
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
                if (offer.key === 'bo') image.classList.add('bm-brickowl-logo');
                image.loading = 'lazy';
                image.decoding = 'async';
                image.referrerPolicy = 'no-referrer';
                if (offer.logoFallbackUrl) {
                    image.addEventListener('error', () => {
                        if (image.src !== offer.logoFallbackUrl) {
                            image.src = offer.logoFallbackUrl;
                        }
                    }, { once: true });
                }
                iconLink.appendChild(image);
            } else {
                iconLink.textContent = offer.label.slice(0, 1);
            }
            iconRow.appendChild(iconLink);
            iconColumn.appendChild(iconRow);

            const priceRow = document.createElement('div');
            priceRow.className = `medium-4 small-9 columns pricerow ${mid} row-a`;
            priceRow.dataset.mid = mid;
            priceRow.dataset.bmSource = offer.source || 'marketplace';
            priceRow.dataset.bmMarketplace = 'true';
            if (offer.shippingStatus === 'paid' &&
                Number.isFinite(Number(offer.shippingCost))) {
                priceRow.dataset.bmShippingCost = String(Number(offer.shippingCost));
            } else if (offer.shippingStatus === 'free') {
                priceRow.dataset.bmShippingFree = 'true';
            } else {
                priceRow.dataset.bmShippingUnknown = 'true';
            }
            if (hasUnknownPrice) priceRow.dataset.bmPriceUnknown = 'true';
            if (offer.priceSource) {
                priceRow.dataset.bmPriceSource = offer.priceSource;
            }

            const offerLink = document.createElement('a');
            offerLink.href = offer.url;
            offerLink.target = '_blank';
            offerLink.rel = 'noopener noreferrer';
            offerLink.className = 'tooltipster';
            const shippingTitle = offer.shippingStatus === 'paid' &&
                Number.isFinite(Number(offer.shippingCost))
                ? `Versandkosten: ${formatEuroValue(Number(offer.shippingCost))} €.`
                : offer.shippingStatus === 'free'
                    ? 'Versandkostenfrei.'
                    : 'Versandkosten unbekannt.';
            offerLink.title = hasUnknownPrice
                ? `Link zu ${offer.label}. Preis unbekannt.`
                : (
                    `Link zu ${offer.label} - ` +
                    `${offer.priceSource ? `${offer.priceSource}. ` : ''}` +
                    `Preis: ${formatEuroValue(price)} €. ` +
                    shippingTitle
                );

            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            const merchant = document.createElement('span');
            merchant.className = 'show-for-small-only merchant';
            merchant.append(`${offer.label}`);
            merchant.appendChild(document.createElement('br'));
            priceSpan.appendChild(merchant);
            priceSpan.append(
                hasUnknownPrice ? 'Preis unbekannt' : `${formatEuroValue(price)} €`
            );
            offerLink.appendChild(priceSpan);
            priceRow.appendChild(offerLink);

            wrapper.appendChild(iconColumn);
            wrapper.appendChild(priceRow);
            parent.appendChild(wrapper);
        });

        mergeSoldOutOffersIntoOfferList();
        window.setTimeout(runOfferPresentationSteps, 0);
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
        const explicitShippingRow = priceSpan.closest(
            '[data-bm-shipping-cost], [data-bm-shipping-free], [data-bm-shipping-unknown]'
        );
        if (explicitShippingRow?.dataset.bmShippingCost) {
            const cost = Number(explicitShippingRow.dataset.bmShippingCost);
            if (Number.isFinite(cost) && cost >= 0) {
                return cost <= 0.004
                    ? { status: 'free', cost: 0 }
                    : { status: 'paid', cost };
            }
        }
        if (explicitShippingRow?.dataset.bmShippingFree === 'true') {
            return { status: 'free', cost: 0 };
        }
        if (explicitShippingRow?.dataset.bmShippingUnknown === 'true') {
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

        const merchantName = getOfferMerchantName(priceSpan);
        if (/\bsmyths\b/i.test(merchantName)) {
            const offerPrice = getBaseOfferPrice(priceSpan);
            if (offerPrice !== null) {
                return offerPrice >= 20
                    ? { status: 'free', cost: 0 }
                    : { status: 'paid', cost: 3.95 };
            }
            return { status: 'unknown', cost: null };
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
            if (priceRow.dataset.bmPriceSource) {
                parts.push(`${priceRow.dataset.bmPriceSource}.`);
            }
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

    let offerProcessingHideTimer;
    function showOfferProcessingIndicator() {
        clearTimeout(offerProcessingHideTimer);
        createDiscountSettingsUI();
        const indicator = document.querySelector('.bm-offer-processing');
        if (!indicator) return;
        indicator.classList.add('is-visible');
        indicator.setAttribute('aria-hidden', 'false');
    }

    function hideOfferProcessingIndicator() {
        clearTimeout(offerProcessingHideTimer);
        offerProcessingHideTimer = setTimeout(() => {
            const indicator = document.querySelector('.bm-offer-processing');
            if (!indicator) return;
            indicator.classList.remove('is-visible');
            indicator.setAttribute('aria-hidden', 'true');
        }, 180);
    }

    let offerPresentationRunning = false;
    function applyOfferPresentation() {
        if (offerPresentationRunning) return;
        offerPresentationRunning = true;
        try {
            runOfferPresentationSteps();
        } finally {
            offerPresentationRunning = false;
            hideOfferProcessingIndicator();
        }
    }

    let offerPresentationTimer;
    const scheduleOfferPresentation = () => {
        showOfferProcessingIndicator();
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
