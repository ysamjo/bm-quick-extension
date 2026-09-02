(() => {
    'use strict';

    const HOST_ID = 'brickmerge-extension-page-overlay';
    const BASE_URL = 'https://www.brickmerge.de/';
    let host = null;
    let escapeHandler = null;

    function normalizedQuery(product) {
        return String(product?.setNumber || product?.ean || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
    }

    function buildBrickmergeUrl(query) {
        const url = new URL(BASE_URL);
        url.searchParams.set('find', query);
        return url.href;
    }

    function closeOverlay() {
        host?.remove();
        host = null;
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler, true);
            escapeHandler = null;
        }
    }

    function openOverlay(product) {
        const query = normalizedQuery(product);
        if (!query) throw new Error('Kein LEGO-Set erkannt.');

        closeOverlay();
        host = document.createElement('div');
        host.id = HOST_ID;
        Object.assign(host.style, {
            all: 'initial',
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647'
        });
        document.documentElement.appendChild(host);

        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                *, *::before, *::after { box-sizing: border-box; }
                .backdrop {
                    position: fixed;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    padding: 16px;
                    background: rgba(20, 20, 22, .66);
                    font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    animation: bm-overlay-fade .16s ease-out;
                }
                .dialog {
                    width: min(1180px, calc(100vw - 32px));
                    height: min(900px, calc(100dvh - 32px));
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    border: 1px solid rgba(0, 0, 0, .18);
                    border-top: 5px solid #c40000;
                    border-radius: 10px;
                    background: #fff;
                    box-shadow: 0 24px 80px rgba(0, 0, 0, .42);
                    animation: bm-overlay-in .18s ease-out;
                }
                .toolbar {
                    display: grid;
                    grid-template-columns: auto minmax(180px, 1fr) auto auto;
                    gap: 10px;
                    align-items: center;
                    padding: 10px 12px;
                    border-bottom: 1px solid #ddd;
                    background: #f7f7f8;
                    color: #222;
                }
                .brand {
                    margin: 0 6px 0 2px;
                    color: #a90000;
                    font-size: 16px;
                    font-weight: 750;
                    white-space: nowrap;
                }
                .search {
                    min-width: 0;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 7px;
                }
                .query {
                    min-width: 0;
                    height: 40px;
                    padding: 0 12px;
                    border: 1px solid #bbb;
                    border-radius: 6px;
                    background: #fff;
                    color: #222;
                    font: inherit;
                }
                .query:focus {
                    border-color: #0869c9;
                    outline: 2px solid rgba(8, 105, 201, .22);
                    outline-offset: 1px;
                }
                button, .external {
                    height: 40px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0;
                    padding: 0 14px;
                    border: 0;
                    border-radius: 6px;
                    font: 650 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    text-decoration: none;
                    cursor: pointer;
                }
                .submit { background: #c40000; color: #fff; }
                .submit:hover, .submit:focus { background: #970000; }
                .external { background: #e8e8ea; color: #333; white-space: nowrap; }
                .external:hover, .external:focus { background: #d9d9dc; }
                .close {
                    width: 40px;
                    padding: 0;
                    background: #eee;
                    color: #333;
                    font-size: 25px;
                }
                .close:hover, .close:focus { background: #c40000; color: #fff; }
                button:focus-visible, .external:focus-visible {
                    outline: 3px solid rgba(8, 105, 201, .35);
                    outline-offset: 2px;
                }
                .frame-wrap { position: relative; flex: 1 1 auto; min-height: 0; background: #fff; }
                .loading {
                    position: absolute;
                    inset: 0;
                    z-index: 1;
                    display: grid;
                    place-items: center;
                    background: #f4f4f4;
                    color: #666;
                }
                .loading[hidden] { display: none; }
                iframe { width: 100%; height: 100%; display: block; border: 0; background: #fff; }
                @keyframes bm-overlay-fade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes bm-overlay-in {
                    from { opacity: 0; transform: translateY(8px) scale(.995); }
                    to { opacity: 1; transform: none; }
                }
                @media (max-width: 720px) {
                    .backdrop { padding: 0; }
                    .dialog { width: 100vw; height: 100dvh; border-radius: 0; border-left: 0; border-right: 0; }
                    .toolbar {
                        grid-template-columns: minmax(0, 1fr) auto;
                        padding: max(8px, env(safe-area-inset-top)) 8px 8px;
                    }
                    .brand { display: none; }
                    .search { grid-column: 1; grid-row: 1; }
                    .external { display: none; }
                    .close { grid-column: 2; grid-row: 1; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .backdrop, .dialog { animation: none; }
                }
            </style>
            <div class="backdrop">
                <section class="dialog" role="dialog" aria-modal="true" aria-label="Brickmerge">
                    <div class="toolbar">
                        <p class="brand">Brickmerge</p>
                        <form class="search">
                            <input class="query" type="search" aria-label="Setnummer oder Suchbegriff" maxlength="100">
                            <button class="submit" type="submit">Suchen</button>
                        </form>
                        <a class="external" target="_blank" rel="noopener noreferrer">Im Tab öffnen</a>
                        <button class="close" type="button" aria-label="Overlay schließen">&times;</button>
                    </div>
                    <div class="frame-wrap">
                        <div class="loading">Brickmerge wird geladen …</div>
                        <iframe title="Brickmerge Setdetails"></iframe>
                    </div>
                </section>
            </div>
        `;

        const backdrop = shadow.querySelector('.backdrop');
        const dialog = shadow.querySelector('.dialog');
        const form = shadow.querySelector('.search');
        const input = shadow.querySelector('.query');
        const external = shadow.querySelector('.external');
        const closeButton = shadow.querySelector('.close');
        const loading = shadow.querySelector('.loading');
        const frame = shadow.querySelector('iframe');

        const navigate = nextQuery => {
            const cleanQuery = String(nextQuery || '').replace(/\s+/g, ' ').trim().slice(0, 100);
            if (!cleanQuery) return;
            const url = buildBrickmergeUrl(cleanQuery);
            input.value = cleanQuery;
            external.href = url;
            loading.hidden = false;
            frame.src = url;
        };

        form.addEventListener('submit', event => {
            event.preventDefault();
            navigate(input.value);
        });
        frame.addEventListener('load', () => {
            loading.hidden = true;
        });
        closeButton.addEventListener('click', closeOverlay);
        backdrop.addEventListener('pointerdown', event => {
            if (event.target === backdrop) closeOverlay();
        });
        dialog.addEventListener('pointerdown', event => event.stopPropagation());
        escapeHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeOverlay();
        };
        document.addEventListener('keydown', escapeHandler, true);
        navigate(query);
        window.setTimeout(() => closeButton.focus(), 0);
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'bm-show-overlay') return false;
        try {
            openOverlay(message.product);
            sendResponse({ ok: true });
        } catch (error) {
            sendResponse({
                ok: false,
                error: error?.message || 'Overlay konnte nicht geöffnet werden.'
            });
        }
        return false;
    });
})();
