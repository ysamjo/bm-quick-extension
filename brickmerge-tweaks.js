// ==UserScript==
// @name         Brickmerge Tweaker
// @namespace    https://brickmerge.de/
// @version      2.0
// @description  Cleaner, Linkliste, Minifiguren-Overlay, Copy-Icon, Rabatt-Rechner Pro & Cookie-Button Hider
// @match        https://www.brickmerge.de/*
// @match        https://brickmerge.de/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      www.bricklink.com
// @connect      mybrickdepot.de
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
// @downloadURL  https://raw.githubusercontent.com/ysamjo/bm-quick-extension/refs/heads/main/brickmerge-tweaks.js
// ==/UserScript==

(function () {
    'use strict';

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
                mid: "3",
                rate: 0.1405,
                aliases: ["LEGO"]
            },
            "mueller.de": {
                mid: "335",
                rate: 0.11,
                aliases: ["MÜLLER", "Mueller"]
            },
            "thalia.de": {
                mid: "331",
                rate: 0.10,
                aliases: ["Thalia"]
            },
            "amazon.de": {
                mid: "1",
                rate: 0.05,
                aliases: ["amazon"]
            }
        }
    };

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
        #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only) {
            font-size: 0.75rem;
        }
        #offerlist .pricerow.lowest .bm-shipping-info,
        #offerlist .price.lowest > span.small:not(.merchant):not(.code):not(.show-for-small-only) {
            color: #fff !important;
            opacity: 1 !important;
            visibility: visible !important;
        }
        @media screen and (max-width: 640px) {
            #offerlist .bm-shipping-info {
                margin-left: 0.35rem;
                font-size: 0.68rem;
            }
            #offerlist .price > span.small:not(.merchant):not(.code):not(.show-for-small-only) {
                font-size: 0.68rem;
            }
            #offerlist .price > .show-for-small-only.small {
                display: none !important;
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

    // "Kürzlich ausverkauft" direkt unter dem Preis-Chart platzieren. Die IDs
    // bleiben erhalten, daher funktioniert Brickmerges späterer AJAX-Load weiter.
    function moveSoldOutBelowChart() {
        const soldOutContainer = document.getElementById('SoldOutContainer');
        const chartContainer = document.getElementById('chartContainer');
        if (soldOutContainer && chartContainer && chartContainer.nextElementSibling !== soldOutContainer) {
            chartContainer.insertAdjacentElement('afterend', soldOutContainer);
        }
    }
    if (setNum) {
        moveSoldOutBelowChart();
        window.addEventListener('load', moveSoldOutBelowChart, { once: true });
    }

    // Der Bestpreis-Link in der rechten Infospalte öffnet dieselbe
    // Preisverlaufsansicht wie Brickmerges eigener Chart-Schalter.
    function bindBestPriceChartTrigger() {
        const chartTrigger = document.getElementById('chartTrigger');
        const bigChart = document.getElementById('bigChart');
        if (!chartTrigger || !bigChart) return;

        const bestPriceLinks = Array.from(document.querySelectorAll('a'))
            .filter(link => /bisheriger\s+bestpreis/i.test(link.textContent));

        bestPriceLinks.forEach(link => {
            if (link.dataset.bmChartTriggerBound === 'true') return;
            link.dataset.bmChartTriggerBound = 'true';
            link.setAttribute('href', '#chartContainer');
            link.setAttribute('aria-controls', 'bigChart');

            link.addEventListener('click', event => {
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
        });
    }
    if (setNum) {
        bindBestPriceChartTrigger();
        window.addEventListener('load', bindBestPriceChartTrigger, { once: true });
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

        const chatGptPrompt = `gib mir eine tabellarische zusammenstellung der drei günstigsten angebote von jeweils kleinanzeigen, ebay und vinted. der link zum original angebot soll da sein. es sollen nur relevante inserate mit neu udn vollständig angezeigt werden. suche ist "lego ${setNum}"`;

        const groups = [
            {
                title: "Shops",
                links: [
                    { name: "LEGO", url: `https://www.lego.com/de-de/product/${setNum}`, icon: icon("lego.com") },
                    { name: "Müller", url: `https://u6.at/d/mueller/${setNum}/`, icon: icon("mueller.de") },
                    { name: "Smyths", url: `https://www.google.com/search?q=site%3Asmythstoys.com/de+lego+${setNum}&btnI=1`, icon: icon("smythstoys.com") },
                    { name: "ChatGPT Suche", url: `https://chatgpt.com/?q=${encodeURIComponent(chatGptPrompt)}`, icon: icon("chatgpt.com") }
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
                    { id: "btn-bl", name: "Bricklink", url: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNum}-1#T=S&O={%22ss%22:%22DE%22,%22cond%22:%22N%22}`, icon: icon("bricklink.com") }
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
                    { id: "btn-mbd", name: "MyBrickDepot", url: `https://mybrickdepot.de/product/${setNum}`, icon: icon("mybrickdepot.de") },
                    { name: "Brickset", url: `https://brickset.com/sets/${setNum}-1`, icon: icon("brickset.com") },
                    { name: "Rebrickable", url: `https://rebrickable.com/sets/${setNum}-1/#alt_builds`, icon: icon("rebrickable.com") },
                    { name: "Meta", url: `https://meta-preisvergleich.de/index.cgi?q=lego+${setNum}&c=kategorie&id=lego_${setNum}__kategorie&offset=&qq=`, icon: icon("meta-preisvergleich.de") },
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
        .bm-info-links { display: flex; flex-wrap: wrap; gap: 7px 11px; }
        .bm-link { display: inline-flex; align-items: center; text-decoration: none; font-size: 0.93em; color: #222; font-weight: 500; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px 4px 6px; line-height: 1.2;}
        .bm-link img { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; margin-right: 6px; }
        .bm-link:hover span { text-decoration: underline; }
        .bm-price { font-size: 0.85em; color: #e30613; margin-left: 5px; font-weight: bold; }
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
                const row = document.createElement("div");
                row.className = "bm-info-links";
                for (const { id, name, url, icon } of group.links) {
                    const a = document.createElement("a");
                    a.href = url; a.target = "_blank"; a.className = "bm-link";
                    if (id) a.dataset.bmid = id;
                    const img = document.createElement("img"); img.src = icon; img.alt = "";
                    const span = document.createElement("span"); span.textContent = name;
                    a.appendChild(img); a.appendChild(span);
                    row.appendChild(a);
                }
                section.appendChild(title); section.appendChild(row); container.appendChild(section);
            }
            return container;
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
            fetchAndInjectPrices(setNum);
        }

        if (document.readyState !== "loading") injectBox();
        else window.addEventListener("DOMContentLoaded", injectBox);

        // --- PREIS-ABFRAGE & INTEGRATION ---
        function fetchAndInjectPrices(setNumber) {
            const updateBtn = (id, priceText) => {
                const btn = document.querySelector(`a[data-bmid="${id}"]`);
                if (btn && priceText) {
                    let priceSpan = btn.querySelector('.bm-price');
                    if (!priceSpan) {
                        priceSpan = document.createElement('span');
                        priceSpan.className = 'bm-price';
                        btn.appendChild(priceSpan);
                    }
                    priceSpan.textContent = `(${priceText})`;
                }
            };
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
                        if (prices.ebay) updateBtn('btn-ebay', prices.ebay);
                        if (prices.amazon) updateBtn('btn-amz', prices.amazon);
                        if (prices.bricklink) updateBtn('btn-bl', prices.bricklink);
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
                    border-bottom:1px solid #ddd;
                    background:#fff;
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
                    margin:0 auto 5px;
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
        if (!CONFIG.retailerDiscounts || !Object.keys(CONFIG.retailerDiscounts).length) return;

        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

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
            const entries = Object.entries(CONFIG.retailerDiscounts);

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

            const anchor = priceSpan.closest('a[title]');
            if (anchor) {
                const titleMatch = anchor.title.match(/Link zu (.+?)(?:\s+-\s+|$)/i);
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
            // Bereits verarbeitete Zeilen überspringen (idempotent bei MutationObserver-Reentry)
            const discountRow = priceSpan.closest('.pricerow');
            if (discountRow?.dataset.bmDiscountApplied === 'true') return;

            const candidates = extractMerchantCandidates(priceSpan);
            const match = matchRetailerDiscount(priceSpan, candidates);
            if (!match) return;

            // Preistext isoliert vom Merchant-Namen (falls vorhanden) und "hier klicken"-Text extrahieren
            const merchantSpan = priceSpan.querySelector('.merchant');
            const rawText = merchantSpan
                ? priceSpan.textContent.replace(merchantSpan.textContent, '')
                : priceSpan.textContent;
            const priceMatch = rawText.match(/(\d+[\d\s.,]*)\s*€/);
            if (!priceMatch) return;

            const originalPrice = parseFloat(
                priceMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
            );
            if (isNaN(originalPrice) || originalPrice <= 0) return;

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
                discountRow.classList.add('bm-has-retailer-discount');
            }
        });
    }

    if (CONFIG.retailerDiscounts && Object.keys(CONFIG.retailerDiscounts).length) {
        let retailerDiscountTimer;
        const scheduleRetailerDiscounts = () => {
            clearTimeout(retailerDiscountTimer);
            retailerDiscountTimer = setTimeout(applyRetailerDiscounts, 50);
        };

        const discountTarget = document.getElementById('offerlist');
        if (discountTarget) {
            applyRetailerDiscounts();
            const retailerDiscountObserver = new MutationObserver(scheduleRetailerDiscounts);
            retailerDiscountObserver.observe(discountTarget, { childList: true, subtree: true });
        }

        if (document.readyState === 'complete') {
            scheduleRetailerDiscounts();
        } else {
            window.addEventListener('load', scheduleRetailerDiscounts, { once: true });
        }
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
            newEl.innerHTML = `<br />&nbsp;<span class="contentcolor" style="color: #b00;">|</span> Preis im Vergleich zum ATB: <strong style="color: ${color};">${percentStr}</strong>`;

            matchedElement.parentNode.insertBefore(newEl, matchedElement.nextSibling);
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
    // 6. VERSANDKOSTEN + SORTIERUNG NACH ANGEBOTSPREIS
    // ==========================================
    // Nur ausdrücklich genannte Versandkosten übernehmen. Eine fehlende Angabe
    // darf nicht als "versandkostenfrei" interpretiert werden.
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
        const clone = priceSpan.cloneNode(true);
        clone.querySelectorAll('span').forEach(span => span.remove());
        return parseEuroValue(clone.textContent);
    }

    function injectShippingCostsFromOfferTitles() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;
        ensureTooltipBridge();

        offerlist.querySelectorAll('span.price').forEach(priceSpan => {
            if (priceSpan.querySelector('.bm-shipping-info')) return;

            // In der nativen Versandansicht ist die Angabe bereits vorhanden.
            const nativeShipping = Array.from(priceSpan.querySelectorAll(':scope > span.small'))
                .find(span => {
                    if (span.classList.contains('merchant') ||
                        span.classList.contains('code') ||
                        span.classList.contains('show-for-small-only')) return false;
                    return /VK frei|Versand|^\+\s*[\d.,]+\s*€\s*=/i.test(span.textContent.trim());
                });
            if (nativeShipping) return;

            const basePrice = getBaseOfferPrice(priceSpan);
            const title = getOriginalOfferTitle(priceSpan.closest('a'));
            const shippingMatch = title.match(/\+\s*Versand\s*(\d+[\d\s.,]*)\s*€/i);
            const explicitlyFree = /Versandkostenfrei|kostenloser Versand|VK frei/i.test(title);
            if (!shippingMatch && !explicitlyFree) return;

            const shippingCost = shippingMatch ? parseEuroValue(`${shippingMatch[1]} €`) : 0;
            if (basePrice === null || shippingCost === null) return;

            const shippingText = shippingCost > 0
                ? `VK ${formatEuroValue(shippingCost)} €`
                : 'VK frei';

            const small = document.createElement('span');
            small.className = 'small bm-shipping-info';
            small.textContent = shippingText;
            small.title = shippingCost > 0
                ? `Versand ${formatEuroValue(shippingCost)} €; Gesamtpreis ${formatEuroValue(basePrice + shippingCost)} €`
                : 'Versandkostenfrei';
            priceSpan.appendChild(small);
        });
    }

    function sortOffersByBasePrice() {
        const offerlist = document.getElementById('offerlist');
        if (!offerlist) return;

        const offers = Array.from(
            offerlist.querySelectorAll('.medium-4.small-9.columns.pricerow[data-mid]')
        ).map((priceRow, originalIndex) => {
            const priceSpan = priceRow.querySelector('span.price');
            return {
                wrapper: priceRow.closest('.row.collapse'),
                priceRow,
                priceSpan,
                price: priceSpan ? getBaseOfferPrice(priceSpan) : null,
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
            group.sort((a, b) => {
                if (a.price === null && b.price === null) return a.originalIndex - b.originalIndex;
                if (a.price === null) return 1;
                if (b.price === null) return -1;
                return (a.price - b.price) || (a.originalIndex - b.originalIndex);
            });

            const lowestPrice = group.find(offer => offer.price !== null)?.price ?? null;
            const fragment = document.createDocumentFragment();

            group.forEach((offer, index) => {
                const stripeClass = index % 2 === 0 ? 'row-b' : 'row-a';
                offer.wrapper.querySelectorAll('.row-a, .row-b').forEach(element => {
                    element.classList.remove('row-a', 'row-b');
                    element.classList.add(stripeClass);
                });

                offer.wrapper.querySelectorAll('.lowest').forEach(element => element.classList.remove('lowest'));
                if (lowestPrice !== null && offer.price === lowestPrice) {
                    offer.priceRow.classList.add('lowest');
                    if (offer.priceSpan) offer.priceSpan.classList.add('lowest');
                }

                fragment.appendChild(offer.wrapper);
            });

            parent.appendChild(fragment);
        });
    }

    function resetNativeShippingPreference() {
        const nativeShippingView = Boolean(
            document.querySelector('#offerlist span.price > span.small:not(.show-for-small-only):not(.code)')
        );
        if (!nativeShippingView || !setNum) return;

        const resetUrl = new URL('/', window.location.origin);
        resetUrl.searchParams.set('find', `${setNum}-1`);
        resetUrl.searchParams.set('shippingcosts', 'false');
        fetch(resetUrl.href, { credentials: 'same-origin', cache: 'no-store' }).catch(() => {
            console.warn('Brickmerge Toolkit: Versandkosten-Sitzung konnte nicht zurückgesetzt werden.');
        });
    }

    function applyOfferPresentation() {
        injectShippingCostsFromOfferTitles();
        sortOffersByBasePrice();
        applyRetailerDiscounts();
        resetNativeShippingPreference();
    }

    if (document.readyState === 'complete') {
        setTimeout(applyOfferPresentation, 100);
    } else {
        window.addEventListener('load', () => setTimeout(applyOfferPresentation, 100), { once: true });
    }

})();
