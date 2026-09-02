(() => {
    'use strict';

    const MIN_TERM_LENGTH = 2;
    const MAX_TERM_LENGTH = 120;
    const currentHostname = window.location.hostname.toLowerCase();
    if (
        currentHostname === 'brickmerge.de' ||
        currentHostname.endsWith('.brickmerge.de')
    ) return;

    let enabled = true;
    let selectionTimer = 0;
    let host = null;
    let escapeHandler = null;
    let selectedTerm = '';

    chrome.storage.local.get('settings').then(({ settings }) => {
        enabled = BM_mergeSettings(settings).selectionPopup;
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        enabled = BM_mergeSettings(changes.settings.newValue).selectionPopup;
        if (!enabled) closePopup(true);
    });

    function selectionInEditable(selection) {
        if (!selection?.rangeCount) return false;
        let node = selection.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        return Boolean(node?.closest?.(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
            '#contenteditable-root, .yt-spec-touch-feedback-shape'
        ));
    }

    function normalizedTerm(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_TERM_LENGTH);
    }

    function buildLuckyUrl(term) {
        const url = new URL('https://www.google.com/search');
        url.searchParams.set('btnI', '1');
        url.searchParams.set('q', `site:brickmerge.de ${term}`);
        return url.href;
    }

    function closePopup(clearSelection = false) {
        host?.remove();
        host = null;
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler, true);
            escapeHandler = null;
        }
        if (clearSelection) selectedTerm = '';
    }

    function showPopup(term, selectionRect) {
        closePopup(false);
        selectedTerm = term;
        host = document.createElement('div');
        host.id = 'brickmerge-selection-lucky-host';
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
                .bubble {
                    position: fixed;
                    display: flex;
                    width: min(360px, calc(100vw - 24px));
                    overflow: hidden;
                    border: 1px solid rgba(0, 0, 0, .2);
                    border-left: 5px solid #c40000;
                    border-radius: 8px;
                    background: #fff;
                    box-shadow: 0 10px 32px rgba(0, 0, 0, .28);
                    color: #222;
                    font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    pointer-events: auto;
                    animation: bm-selection-in .15s ease-out;
                }
                .bubble-link {
                    min-width: 0;
                    flex: 1 1 auto;
                    padding: 12px 14px;
                    overflow: hidden;
                    color: #222;
                    font-weight: 650;
                    text-decoration: none;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .bubble-link:hover, .bubble-link:focus { background: #fff4f4; color: #970000; }
                .close {
                    width: 38px;
                    flex: 0 0 38px;
                    border: 0;
                    border-left: 1px solid #ddd;
                    background: #f1f1f2;
                    color: #555;
                    font: 700 20px/1 Arial, sans-serif;
                    cursor: pointer;
                }
                .close:hover, .close:focus { background: #c40000; color: #fff; }
                @keyframes bm-selection-in {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: none; }
                }
                @media (prefers-reduced-motion: reduce) { .bubble { animation: none; } }
            </style>
            <div class="bubble" role="dialog" aria-label="Markierten Begriff auf Brickmerge suchen">
                <a class="bubble-link" target="_blank" rel="noopener noreferrer"></a>
                <button class="close" type="button" aria-label="Schließen">&times;</button>
            </div>
        `;

        const bubble = shadow.querySelector('.bubble');
        const link = shadow.querySelector('.bubble-link');
        const closeButton = shadow.querySelector('.close');
        link.href = buildLuckyUrl(selectedTerm);
        link.title = `Google Lucky: site:brickmerge.de ${selectedTerm}`;
        link.textContent = `„${selectedTerm}“ auf Brickmerge suchen`;

        const bubbleRect = bubble.getBoundingClientRect();
        const maxLeft = Math.max(12, window.innerWidth - bubbleRect.width - 12);
        const left = Math.min(maxLeft, Math.max(12, selectionRect.left));
        const below = selectionRect.bottom + 9;
        const top = below + bubbleRect.height <= window.innerHeight - 12
            ? below
            : Math.max(12, selectionRect.top - bubbleRect.height - 9);
        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;

        link.addEventListener('click', () => {
            window.setTimeout(() => closePopup(true), 0);
        });
        closeButton.addEventListener('click', () => closePopup(true));
        escapeHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closePopup(true);
        };
        document.addEventListener('keydown', escapeHandler, true);
    }

    document.addEventListener('selectionchange', () => {
        window.clearTimeout(selectionTimer);
        selectionTimer = window.setTimeout(() => {
            if (!enabled) return;
            const selection = window.getSelection();
            const term = normalizedTerm(selection?.toString());
            if (!term || term.length < MIN_TERM_LENGTH || selectionInEditable(selection)) {
                return;
            }
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            if (!rect.width && !rect.height) return;
            showPopup(term, rect);
        }, 250);
    });
})();
