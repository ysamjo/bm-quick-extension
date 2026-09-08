(() => {
    'use strict';

    const HOST_ID = 'brickmerge-extension-floating-sidebar';
    const BASE_URL = 'https://www.brickmerge.de/';
    const COLLAPSE_TRANSITION_MS = 240;
    let host = null;
    let escapeHandler = null;
    let outsideHandler = null;

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
        if (outsideHandler) {
            document.removeEventListener('pointerdown', outsideHandler, true);
            outsideHandler = null;
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
                    width: min(400px, calc(100vw - 24px));
                    display: flex;
                    pointer-events: none;
                    animation: bm-panel-in .2s ease-out;
                    transition: transform ${COLLAPSE_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1);
                    will-change: transform;
                    z-index: 2147483647;
                }
                .panel.is-collapsed {
                    transform: translateX(calc(100% + 12px));
                }
                .panel-card {
                    position: relative;
                    flex: 1 1 auto;
                    width: 100%;
                    height: 100%;
                    min-width: 0;
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
                }
                .panel.is-collapsed .panel-card {
                    pointer-events: none;
                }
                .toggle-tab {
                    position: absolute;
                    top: 50%;
                    right: 100%;
                    transform: translateY(-50%);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    width: 36px;
                    padding: 10px 0;
                    margin-right: -1px;
                    border: 1px solid rgba(0, 0, 0, .22);
                    border-right: none;
                    border-radius: 9px 0 0 9px;
                    background: #c40000;
                    color: #fff;
                    box-shadow: -4px 4px 14px rgba(0, 0, 0, .22);
                    cursor: pointer;
                    pointer-events: auto;
                    user-select: none;
                    -webkit-user-select: none;
                    transition: background .15s ease, transform .15s ease;
                }
                .toggle-tab:hover, .toggle-tab:focus {
                    background: #970000;
                    outline: none;
                }
                .panel:not(.is-collapsed) .toggle-tab:hover {
                    transform: translateY(-50%) translateX(-3px);
                }
                .panel.is-collapsed .toggle-tab:hover {
                    transform: translateY(-50%) translateX(-4px);
                }
                .toggle-tab:active {
                    background: #7a0000;
                }
                .toggle-tab:focus-visible {
                    outline: 3px solid rgba(8, 105, 201, .45);
                    outline-offset: 2px;
                }
                .tab-logo {
                    width: 20px;
                    height: 20px;
                    flex: 0 0 20px;
                    border-radius: 4px;
                    pointer-events: none;
                }
                .tab-arrow {
                    width: 18px;
                    height: 18px;
                    flex: 0 0 18px;
                    fill: none;
                    stroke: #fff;
                    stroke-width: 2.6;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    transition: transform ${COLLAPSE_TRANSITION_MS}ms ease;
                    pointer-events: none;
                }
                .panel.is-collapsed .tab-arrow {
                    transform: rotate(180deg);
                }
                .toolbar {
                    display: grid;
                    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
                    gap: 6px;
                    align-items: center;
                    min-height: 52px;
                    padding: 7px 8px;
                    border-bottom: 1px solid #ddd;
                    background: #f7f7f8;
                }
                .brand {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px;
                    height: 36px;
                    margin: 0;
                    border-radius: 6px;
                    text-decoration: none;
                    cursor: pointer;
                }
                .brand:hover, .brand:focus { background: #e8e8ea; }
                .brand-logo {
                    width: 28px;
                    height: 28px;
                    flex: 0 0 28px;
                    border-radius: 6px;
                }
                .search { display: contents; }
                .query {
                    min-width: 0;
                    width: 100%;
                    height: 36px;
                    padding: 0 10px;
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
                    width: 36px;
                    height: 36px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0;
                    padding: 0;
                    border: 0;
                    border-radius: 6px;
                    text-decoration: none;
                    cursor: pointer;
                }
                button svg, .external svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
                .submit { background: #c40000; color: #fff; }
                .submit:hover, .submit:focus { background: #970000; }
                .external { background: #e8e8ea; color: #333; white-space: nowrap; }
                .external:hover, .external:focus { background: #d9d9dc; }
                .close {
                    background: #eee;
                    color: #333;
                }
                .close:hover, .close:focus { background: #c40000; color: #fff; }
                button:focus-visible, .external:focus-visible, .brand:focus-visible {
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
                    .panel { inset: 0; width: 100vw; }
                    .panel.is-collapsed { transform: translateX(100%); }
                    .panel-card { border-left: 0; border-right: 0; border-radius: 0; }
                    .toolbar { padding-top: max(9px, env(safe-area-inset-top)); }
                    .toggle-tab { display: none; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .panel { animation: none; transition: none; }
                    .tab-arrow { transition: none; }
                }
            </style>
            <aside class="panel" aria-label="Schwebende Brickmerge-Seitenleiste">
                <button class="toggle-tab" type="button" title="Seitenleiste ausblenden" aria-label="Seitenleiste ausblenden" aria-expanded="true">
                    <img class="tab-logo" src="${chrome.runtime.getURL('icons/icon128.png')}" alt="">
                    <svg class="tab-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
                </button>
                <div class="panel-card">
                    <div class="toolbar">
                        <a class="brand" href="${BASE_URL}" title="Brickmerge-Startseite" aria-label="Brickmerge-Startseite"><img class="brand-logo" src="${chrome.runtime.getURL('icons/icon128.png')}" alt=""></a>
                        <form class="search">
                            <input class="query" type="search" aria-label="Setnummer oder Suchbegriff" maxlength="100">
                            <button class="submit" type="submit" title="Suchen" aria-label="Brickmerge-Suche starten">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"></circle><path d="m16 16 5 5"></path></svg>
                            </button>
                        </form>
                        <a class="external" target="_blank" rel="noopener noreferrer" title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"></path><path d="m20 4-9 9"></path><path d="M19 14v5H5V5h5"></path></svg>
                        </a>
                        <button class="close" type="button" title="Seitenleiste schließen" aria-label="Seitenleiste schließen">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>
                        </button>
                    </div>
                    <div class="frame-wrap">
                        <div class="loading" aria-live="polite">Brickmerge wird geladen …</div>
                        <iframe title="Brickmerge Setdetails"></iframe>
                    </div>
                </div>
            </aside>
        `;

        const form = shadow.querySelector('.search');
        const homeButton = shadow.querySelector('.brand');
        const input = shadow.querySelector('.query');
        const external = shadow.querySelector('.external');
        const closeButton = shadow.querySelector('.close');
        const toggleTab = shadow.querySelector('.toggle-tab');
        const loading = shadow.querySelector('.loading');
        const frame = shadow.querySelector('iframe');
        const panel = shadow.querySelector('.panel');

        const setCollapsed = collapsed => {
            panel.classList.toggle('is-collapsed', collapsed);
            toggleTab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            toggleTab.setAttribute(
                'title',
                collapsed ? 'Brickmerge-Seitenleiste einblenden' : 'Seitenleiste ausblenden'
            );
            toggleTab.setAttribute(
                'aria-label',
                collapsed ? 'Brickmerge-Seitenleiste einblenden' : 'Seitenleiste ausblenden'
            );
        };

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

        const navigateHome = () => {
            input.value = '';
            external.href = BASE_URL;
            loading.hidden = false;
            frame.src = BASE_URL;
        };

        form.addEventListener('submit', event => {
            event.preventDefault();
            navigate(input.value);
        });
        homeButton.addEventListener('click', event => {
            event.preventDefault();
            navigateHome();
        });
        frame.addEventListener('load', () => {
            loading.hidden = true;
        });
        closeButton.addEventListener('click', closePanel);
        toggleTab.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            const isCurrentlyCollapsed = panel.classList.contains('is-collapsed');
            setCollapsed(!isCurrentlyCollapsed);
            if (isCurrentlyCollapsed) {
                window.setTimeout(() => input.focus(), 0);
            }
        });
        escapeHandler = event => {
            if (event.key !== 'Escape') return;
            if (window.matchMedia('(max-width: 520px)').matches) {
                closePanel();
                return;
            }
            if (panel.classList.contains('is-collapsed')) return;
            event.preventDefault();
            setCollapsed(true);
            toggleTab.focus();
        };
        document.addEventListener('keydown', escapeHandler, true);

        const openedAt = Date.now();
        outsideHandler = event => {
            if (Date.now() - openedAt < 100) return;
            if (panel.classList.contains('is-collapsed')) return;
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            if (path.includes(host) || event.target === host) return;
            setCollapsed(true);
        };
        document.addEventListener('pointerdown', outsideHandler, true);

        setCollapsed(false);
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
