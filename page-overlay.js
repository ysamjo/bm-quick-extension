(() => {
    'use strict';

    const HOST_ID = 'brickmerge-extension-floating-sidebar';
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

    function closePanel() {
        host?.remove();
        host = null;
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler, true);
            escapeHandler = null;
        }
    }

    function openPanel(product) {
        const query = normalizedQuery(product);
        if (!query) throw new Error('Kein LEGO-Set erkannt.');

        closePanel();
        host = document.createElement('div');
        host.id = HOST_ID;
        Object.assign(host.style, {
            all: 'initial',
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            pointerEvents: 'none'
        });
        document.documentElement.appendChild(host);

        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                *, *::before, *::after { box-sizing: border-box; }
                .panel {
                    position: fixed;
                    top: 12px;
                    right: 12px;
                    bottom: 12px;
                    width: min(460px, calc(100vw - 24px));
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    border: 1px solid rgba(0, 0, 0, .2);
                    border-top: 5px solid #c40000;
                    border-radius: 10px;
                    background: #fff;
                    box-shadow: 0 18px 55px rgba(0, 0, 0, .34);
                    color: #222;
                    font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    pointer-events: auto;
                    animation: bm-panel-in .2s ease-out;
                }
                .toolbar {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto auto;
                    gap: 8px;
                    align-items: center;
                    padding: 9px 10px 10px;
                    border-bottom: 1px solid #ddd;
                    background: #f7f7f8;
                }
                .brand {
                    min-width: 0;
                    margin: 0 4px;
                    overflow: hidden;
                    color: #a90000;
                    font-size: 16px;
                    font-weight: 750;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .search {
                    grid-column: 1 / -1;
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
                    height: 38px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0;
                    padding: 0 12px;
                    border: 0;
                    border-radius: 6px;
                    font: 650 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    text-decoration: none;
                    cursor: pointer;
                }
                .submit { height: 40px; background: #c40000; color: #fff; }
                .submit:hover, .submit:focus { background: #970000; }
                .external { background: #e8e8ea; color: #333; white-space: nowrap; }
                .external:hover, .external:focus { background: #d9d9dc; }
                .close {
                    width: 38px;
                    padding: 0;
                    background: #eee;
                    color: #333;
                    font-size: 24px;
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
                    padding: 20px;
                    background: #f4f4f4;
                    color: #666;
                    text-align: center;
                }
                .loading[hidden] { display: none; }
                iframe { width: 100%; height: 100%; display: block; border: 0; background: #fff; }
                @keyframes bm-panel-in {
                    from { opacity: 0; transform: translateX(18px); }
                    to { opacity: 1; transform: none; }
                }
                @media (max-width: 520px) {
                    .panel { inset: 0; width: 100vw; border-left: 0; border-right: 0; border-radius: 0; }
                    .toolbar { padding-top: max(9px, env(safe-area-inset-top)); }
                }
                @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
            </style>
            <aside class="panel" aria-label="Schwebende Brickmerge-Seitenleiste">
                <div class="toolbar">
                    <p class="brand">Brickmerge</p>
                    <a class="external" target="_blank" rel="noopener noreferrer">Im Tab öffnen</a>
                    <button class="close" type="button" aria-label="Seitenleiste schließen">&times;</button>
                    <form class="search">
                        <input class="query" type="search" aria-label="Setnummer oder Suchbegriff" maxlength="100">
                        <button class="submit" type="submit">Suchen</button>
                    </form>
                </div>
                <div class="frame-wrap">
                    <div class="loading" aria-live="polite">Brickmerge wird geladen …</div>
                    <iframe title="Brickmerge Setdetails"></iframe>
                </div>
            </aside>
        `;

        const form = shadow.querySelector('.search');
        const input = shadow.querySelector('.query');
        const external = shadow.querySelector('.external');
        const closeButton = shadow.querySelector('.close');
        const loading = shadow.querySelector('.loading');
        const frame = shadow.querySelector('iframe');

        const navigate = nextQuery => {
            const cleanQuery = String(nextQuery || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 100);
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
        closeButton.addEventListener('click', closePanel);
        escapeHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closePanel();
        };
        document.addEventListener('keydown', escapeHandler, true);
        navigate(query);
        window.setTimeout(() => closeButton.focus(), 0);
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (
            message?.type !== 'bm-show-floating-sidebar' &&
            message?.type !== 'bm-show-overlay'
        ) return false;
        try {
            openPanel(message.product);
            sendResponse({ ok: true });
        } catch (error) {
            sendResponse({
                ok: false,
                error: error?.message || 'Seitenleiste konnte nicht geöffnet werden.'
            });
        }
        return false;
    });
})();
