// ==UserScript==
// @name         Brickmerge Toolkit
// @namespace    https://brickmerge.de/
// @version      1.7.4
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
    // 0. GLOBALE STYLES
    // ==========================================
    const globalCss = `
        #CookiebotWidget, .CookiebotWidget, #cybotCookiebotDialog {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
    `;
    const globalStyle = document.createElement("style");
    globalStyle.textContent = globalCss;
    document.head.appendChild(globalStyle);


    function getSetNum() {
        let pathMatch = window.location.pathname.match(/\/(\d{5,6})(?:-\d+)?(?:[^\d]|$)/);
        if (pathMatch) return pathMatch[1];
        try {
            const params = new URLSearchParams(window.location.search);
            const find = params.get('find');
            if (find) {
                const findMatch = find.match(/^(\d{5,6})/);
                if (findMatch) return findMatch[1];
            }
            for (const value of params.values()) {
                const match = value.match(/^(\d{5,6})(?:-\d+)?$/);
                if (match) return match[1];
            }
        } catch (e) { }
        return null;
    }
    const setNum = getSetNum();

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
        }
        document.querySelectorAll("div[style*='padding-bottom']").forEach(div => {
            if (div.textContent?.includes("Zur LEGO Seite") && div.textContent.includes("Zur ebay History") && div.innerHTML.includes("bricklink.com")) div.remove();
        });
        const spanToRemove = document.querySelector('body > section > div:nth-child(2) > div:nth-child(3) > div:nth-child(1) > section:nth-child(1) > p > span');
        if (spanToRemove) spanToRemove.remove();
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
    }

    if (setNum) cleaner();

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
                    { name: "idealo DE", url: `https://www.google.com/search?q=site%3Aidealo.de+lego+${setNum}&btnI=1`, icon: icon("idealo.fr") }
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
            if (document.querySelector('.bm-minifig-overlay')) {
                document.querySelector('.bm-minifig-overlay').remove();
            }
            const overlay = document.createElement('div');
            overlay.className = 'bm-minifig-overlay';
            overlay.innerHTML = `
                <div class="bm-minifig-backdrop"></div>
                <div class="bm-minifig-modal">
                    <button class="bm-minifig-close" title="Schließen" tabindex="0">
                      <span class="bm-minifig-x" aria-label="Schließen">×</span>
                    </button>
                    <div class="bm-minifig-content">Lade Minifiguren von Bricklink...</div>
                </div>
            `;
            if (!document.getElementById('bm-minifig-style')) {
                const style = document.createElement('style');
                style.id = 'bm-minifig-style';
                style.textContent = `
                .bm-minifig-overlay { position:fixed; z-index:99999; top:0; left:0; width:100vw; height:100vh; }
                .bm-minifig-backdrop { position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:99998; animation:bmfadein 0.2s; }
                .bm-minifig-modal { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%) scale(1); background:#fff; border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,0.5); padding:32px 24px 24px 24px; min-width:320px; max-width:95vw; max-height:85vh; overflow:auto; z-index:99999; animation:bmzoom 0.2s; }
                .bm-minifig-close { position:absolute; top:12px; right:18px; background:none; border:none; cursor:pointer; padding:0; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; transition:background 0.15s; }
                .bm-minifig-x { font-size:1.7em; color:#888; line-height:1; font-weight:400; pointer-events:none; }
                .bm-minifig-close:hover { background: #e0e0e0; }
                .bm-minifig-content table { width:100%; border-collapse:collapse; font-size:0.95em; color: #333 !important; }
                .bm-minifig-content th, .bm-minifig-content td { border:1px solid #ddd; padding:8px 10px; background:#fff !important; color:#333 !important; }
                .bm-minifig-content th { background:#f5f5f5 !important; font-weight:bold; }
                .bm-minifig-content tr:nth-child(even) td { background:#fafafa !important; }
                .bm-minifig-content a, .bm-minifig-content a font, .bm-minifig-content a span { color:#0056b3 !important; text-decoration:none; }
                .bm-minifig-content a:hover { text-decoration:underline; }
                .bm-minifig-content font { color: #333 !important; }
                @keyframes bmfadein { from { opacity:0; } to { opacity:1; } }
                @keyframes bmzoom { from { transform:translate(-50%,-50%) scale(0.8); opacity:0; } to { transform:translate(-50%,-50%) scale(1); opacity:1; } }
                `;
                document.head.appendChild(style);
            }
            document.body.appendChild(overlay);
            const close = () => overlay.remove();
            overlay.querySelector('.bm-minifig-backdrop').onclick = close;
            overlay.querySelector('.bm-minifig-close').onclick = close;

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
                        Array.from(table.rows).forEach(row => { if (row.cells.length > 1) row.deleteCell(-1); });
                        Array.from(table.querySelectorAll('a')).forEach(a => { if (a.getAttribute('href')?.startsWith('/')) { a.href = 'https://www.bricklink.com' + a.getAttribute('href'); a.target = '_blank'; } });
                        overlay.querySelector('.bm-minifig-content').innerHTML = "";
                        overlay.querySelector('.bm-minifig-content').appendChild(table);
                    } else {
                        overlay.querySelector('.bm-minifig-content').textContent = "Keine Minifiguren gefunden.";
                    }
                }
            });
        }
        replaceMinifigurenWithLink(setNum);
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
                    const price2 = uniqueSortedPrices[1]; // Zweitgünstigster Shop

                    // Rabatt als ganze Zahl runden
                    const discount = ((1 - (price1 / price2)) * 100).toFixed(0);

                    if (discount > 0) {
                        createBlackBubble(discount);
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

        // Funktion für die schwarze Bubble
        function createBlackBubble(discountText) {
            const redBubbles = document.querySelectorAll('.off');

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
                            while (container && !['LI', 'DIV', 'P', 'TR'].includes(container.tagName)) {
                                container = container.parentElement;
                            }
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

            const newEl = document.createElement(matchedElement.tagName.toLowerCase());
            newEl.id = 'all-time-bestpreis-discount';
            newEl.className = matchedElement.className;

            // Abstände harmonisieren
            newEl.style.setProperty('margin', '0', 'important');
            newEl.style.setProperty('padding', '0', 'important');
            newEl.style.setProperty('display', 'block', 'important');

            // Leerzeichen (&nbsp;) am Anfang für die korrekte Einrückung des Strichs
            newEl.innerHTML = `&nbsp;<span class="contentcolor" style="color: #b00;">|</span> Preis im Vergleich zum ATB: <strong style="color: ${color};">${percentStr}</strong>`;

            matchedElement.parentNode.insertBefore(newEl, matchedElement.nextSibling);

            // Entfernt den Abstand des ursprünglichen Elements
            if (matchedElement) {
                matchedElement.style.setProperty('margin-bottom', '0', 'important');
                matchedElement.style.setProperty('padding-bottom', '0', 'important');
            }
        }

        // MutationObserver für den Rabatt-Rechner (überwacht asynchrones Nachladen)
        let checkTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(checkTimer);
            checkTimer = setTimeout(calculateDiscount, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Erstmaliger Start des Rabatt-Rechners
        window.addEventListener('load', () => {
            setTimeout(calculateDiscount, 500);
        });
    }

})();
