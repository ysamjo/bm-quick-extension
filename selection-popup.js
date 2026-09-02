(() => {
    'use strict';

    const BASE_URL = 'https://www.brickmerge.de';
    const CACHE_TTL_MS = 10 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 15000;
    const cache = new Map();
    const currentHostname = window.location.hostname.toLowerCase();
    if (
        currentHostname === 'brickmerge.de' ||
        currentHostname.endsWith('.brickmerge.de')
    ) return;

    let enabled = true;
    let selectionTimer = 0;
    let host = null;
    let popupShadow = null;
    let escapeHandler = null;
    let requestSequence = 0;
    let activeSetNumber = '';

    chrome.storage.local.get('settings').then(({ settings }) => {
        enabled = BM_mergeSettings(settings).selectionPopup;
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        enabled = BM_mergeSettings(changes.settings.newValue).selectionPopup;
        if (!enabled) closePopup();
    });

    function selectionInEditable() {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return false;
        let node = selection.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        return Boolean(node?.closest?.(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
            '#contenteditable-root, .yt-spec-touch-feedback-shape'
        ));
    }

    function closePopup(invalidateRequest = true) {
        host?.remove();
        host = null;
        popupShadow = null;
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler, true);
            escapeHandler = null;
        }
        if (invalidateRequest) {
            requestSequence += 1;
            activeSetNumber = '';
        }
    }

    function normalizedText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function makeDetailsContent(payload) {
        const fieldLabels = [
            'Teile', 'Minifiguren', 'Setgewicht', 'OVP-Maße', 'Release',
            'UVP', 'bisheriger Bestpreis', 'akt. brickmerge Preis', 'POV'
        ];
        const fields = (Array.isArray(payload?.fields) ? payload.fields : [])
            .map(field => [
                normalizedText(field?.label),
                normalizedText(field?.value)
            ])
            .filter(([label, value]) => fieldLabels.includes(label) && value);
        if (!fields.length) return '';

        const wrapper = document.createElement('div');
        wrapper.className = 'details';
        const list = document.createElement('dl');
        list.className = 'detail-list';
        for (const [label, value] of fields) {
            const row = document.createElement('div');
            row.className = 'detail-row';
            const term = document.createElement('dt');
            term.textContent = `${label}:`;
            const description = document.createElement('dd');
            description.textContent = value;
            row.append(term, description);
            list.appendChild(row);
        }
        wrapper.appendChild(list);
        return wrapper;
    }

    function parseBrickmergeDetailsHtml(html) {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const details = doc.querySelector('.content.setdetails');
        if (!details) return { fields: [] };
        const copy = details.cloneNode(true);
        copy.querySelectorAll('script, style, noscript').forEach(node => node.remove());
        copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        const lines = (copy.textContent || '').split(/\n+/);
        return { fields: BM_parseBrickmergeDetailLines(lines) };
    }

    function createHost() {
        closePopup(false);
        host = document.createElement('div');
        host.id = 'brickmerge-extension-popup-host';
        Object.assign(host.style, {
            all: 'initial',
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            pointerEvents: 'none'
        });
        document.documentElement.appendChild(host);

        const shadow = host.attachShadow({ mode: 'closed' });
        popupShadow = shadow;
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.64);
                    pointer-events: auto; animation: bm-fade-in .18s ease-out; }
                .popup { position: fixed; left: 50%; top: 50%; width: min(480px, 90vw);
                    max-height: 80vh; transform: translate(-50%, -50%); display: flex;
                    flex-direction: column; overflow: hidden; border: 0;
                    border-top: 5px solid #b00; border-radius: 4px; background: #fff;
                    color: #333; box-shadow: 0 18px 48px rgba(0,0,0,.32);
                    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    pointer-events: auto; animation: bm-popup-in .18s ease-out; }
                .header { display: flex; min-height: 40px; align-items: center;
                    padding: 12px 12px 12px 18px; border-bottom: 1px solid #ddd;
                    background: #fff; color: #333; cursor: move; user-select: none;
                    touch-action: none; }
                .header a { flex: 1; color: #b00; font-weight: 700;
                    font-size: 15px; text-decoration: none; }
                .header a:hover, .header a:focus { color: #700; text-decoration: underline; }
                .close { display: flex; width: 38px; height: 38px; align-items: center;
                    justify-content: center; margin: 0; padding: 0; border: 0;
                    border-radius: 4px; background: #f7eaea; color: #800;
                    font: bold 26px/1 Arial,sans-serif; cursor: pointer; }
                .close:hover, .close:focus { background: #b00; color: #fff; outline: none; }
                .content { overflow: auto; padding: 18px; background: #fff;
                    transition: opacity .18s ease, transform .18s ease; }
                .content.is-clickable { cursor: pointer; }
                .content.is-clickable:hover { background: #fffafa; }
                .product-name { margin: 0 0 12px; color: #222; font-size: 16px;
                    font-weight: 750; }
                .detail-list { display: grid; gap: 0; margin: 0; }
                .detail-row { display: grid; grid-template-columns: minmax(130px, 42%) 1fr;
                    gap: 10px; padding: 8px 0; border-top: 1px solid #e7e7e7; }
                .detail-row:first-child { border-top: 0; }
                .detail-row dt { margin: 0; color: #666; font-weight: 600; }
                .detail-row dd { min-width: 0; margin: 0; color: #222; overflow-wrap: anywhere; }
                .loading { margin: 8px 0; padding: 14px 16px; border-left: 3px solid #b00;
                    background: #f5f5f5; color: #555; text-align: left; }
                .error { color: #b00; }
                @keyframes bm-fade-in { from { opacity: 0; } to { opacity: 1; } }
                @keyframes bm-popup-in {
                    from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
                    to { opacity: 1; transform: translate(-50%, -50%); }
                }
                @media (max-width: 640px) {
                    .popup { inset: 0; left: 0; top: 0; width: 100vw; height: 100vh;
                        height: 100dvh; max-height: none; transform: none; border-radius: 0;
                        animation: bm-mobile-in .18s ease-out; }
                    .header { padding: max(12px, env(safe-area-inset-top))
                        max(10px, env(safe-area-inset-right)) 10px
                        max(16px, env(safe-area-inset-left)); cursor: default; }
                    .content { flex: 1 1 auto; min-height: 0;
                        padding: 16px max(14px, env(safe-area-inset-right))
                            max(16px, env(safe-area-inset-bottom))
                            max(14px, env(safe-area-inset-left)); }
                    .detail-row { grid-template-columns: minmax(110px, 40%) 1fr; }
                }
                @keyframes bm-mobile-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .backdrop, .popup { animation: none; }
                    .content { transition: none; }
                }
            </style>
            <div class="backdrop"></div>
            <section class="popup" role="dialog" aria-modal="true" aria-labelledby="bm-selection-title">
                <div class="header"><a id="bm-selection-title" target="_blank" rel="noopener noreferrer"></a><button class="close" type="button" aria-label="Schließen">&times;</button></div>
                <div class="content"></div>
            </section>
        `;

        const popup = shadow.querySelector('.popup');
        const header = shadow.querySelector('.header');
        const titleLink = shadow.querySelector('.header a');
        const content = shadow.querySelector('.content');
        const closeButton = shadow.querySelector('.close');
        const openSelectedSet = event => {
            event?.preventDefault();
            event?.stopPropagation();
            const setNumber = activeSetNumber;
            if (!/^\d{5}$/.test(setNumber)) return;
            void chrome.runtime.sendMessage({
                type: 'bm-open-overlay',
                product: {
                    setNumber,
                    name: `LEGO Set ${setNumber}`,
                    url: window.location.href,
                    hostname: window.location.hostname
                }
            }).then(response => {
                if (!response?.ok) throw new Error(response?.error || 'Overlay-Fehler');
                closePopup();
            }).catch(() => {
                showPopup(
                    'Overlay konnte nicht geöffnet werden. Bitte erneut versuchen.',
                    setNumber,
                    true
                );
            });
        };
        titleLink.addEventListener('click', openSelectedSet);
        content.addEventListener('click', openSelectedSet);
        content.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') openSelectedSet(event);
        });
        closeButton.addEventListener('click', () => closePopup());
        shadow.querySelector('.backdrop').addEventListener('pointerdown', () => closePopup());
        makeDraggable(popup, header);
        escapeHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closePopup();
        };
        document.addEventListener('keydown', escapeHandler, true);
        window.setTimeout(() => closeButton.focus(), 0);
        return shadow;
    }

    function showPopup(content, setNumber, isError = false, isLoading = false) {
        const shadow = popupShadow || createHost();
        const link = shadow.querySelector('.header a');
        link.href = `${BASE_URL}/${setNumber}`;
        link.textContent = `brickmerge: Set #${setNumber} im Overlay öffnen`;
        const container = shadow.querySelector('.content');
        container.classList.add('is-clickable');
        container.tabIndex = 0;
        container.setAttribute(
            'aria-label',
            `Brickmerge-Set ${setNumber} im Overlay öffnen`
        );
        container.classList.toggle('error', isError);
        container.classList.toggle('loading', isLoading);
        if (content instanceof Node) {
            container.replaceChildren(content.cloneNode(true));
        } else {
            container.textContent = String(content || '');
        }
        container.animate?.([
            { opacity: 0.35, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 180, easing: 'ease-out' });
    }

    function makeDraggable(element, handle) {
        handle.addEventListener('pointerdown', event => {
            if (window.matchMedia('(max-width: 640px)').matches) return;
            if (event.button !== 0 || event.target.closest('a, button')) return;
            event.preventDefault();
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startY = event.clientY;
            const startRect = element.getBoundingClientRect();
            element.style.transform = 'none';
            element.style.left = `${startRect.left}px`;
            element.style.top = `${startRect.top}px`;
            handle.style.cursor = 'grabbing';
            handle.setPointerCapture?.(pointerId);

            const move = moveEvent => {
                if (moveEvent.pointerId !== pointerId) return;
                const maxLeft = Math.max(0, window.innerWidth - startRect.width);
                const maxTop = Math.max(0, window.innerHeight - startRect.height);
                const nextLeft = startRect.left + moveEvent.clientX - startX;
                const nextTop = startRect.top + moveEvent.clientY - startY;
                element.style.left = `${Math.min(maxLeft, Math.max(0, nextLeft))}px`;
                element.style.top = `${Math.min(maxTop, Math.max(0, nextTop))}px`;
            };
            const end = endEvent => {
                if (endEvent.pointerId !== pointerId) return;
                handle.style.cursor = '';
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                if (handle.hasPointerCapture?.(pointerId)) {
                    handle.releasePointerCapture(pointerId);
                }
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    function sendMessageWithTimeout(message) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => {
                reject(new Error('Zeitüberschreitung'));
            }, REQUEST_TIMEOUT_MS);
        });
        return Promise.race([chrome.runtime.sendMessage(message), timeout])
            .finally(() => window.clearTimeout(timeoutId));
    }

    async function fetchAndShow(setNumber) {
        const currentRequest = ++requestSequence;
        activeSetNumber = setNumber;
        const cached = cache.get(setNumber);
        if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
            showPopup(cached.content, setNumber);
            return;
        }
        if (cached) cache.delete(setNumber);

        showPopup('Lade Daten …', setNumber, false, true);
        try {
            const brickmergeUrl = new URL(`/${setNumber}`, `${BASE_URL}/`);
            const response = await sendMessageWithTimeout({
                type: 'bm-fetch-text',
                request: {
                    method: 'GET',
                    url: brickmergeUrl.href,
                    headers: {
                        Accept: 'text/html,application/xhtml+xml',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7'
                    }
                }
            });
            if (currentRequest !== requestSequence || setNumber !== activeSetNumber) return;
            const responseText = String(response?.responseText || '');
            if (!response?.ok || response.status < 200 || response.status >= 400) {
                throw new Error(response?.error || `HTTP ${response?.status}`);
            }
            if (!responseText.trim()) throw new Error('Leere Antwort');

            const payload = parseBrickmergeDetailsHtml(responseText);
            const content = makeDetailsContent(payload);
            if (!content) {
                showPopup('Keine Details zu diesem Set gefunden.', setNumber, true);
                return;
            }
            cache.set(setNumber, { content, savedAt: Date.now() });
            showPopup(content, setNumber);
        } catch (error) {
            if (currentRequest !== requestSequence || setNumber !== activeSetNumber) return;
            const message = error?.message === 'Zeitüberschreitung'
                ? 'Der Abruf hat zu lange gedauert. Bitte erneut versuchen.'
                : 'Setdetails konnten nicht geladen werden. Bitte erneut versuchen.';
            showPopup(message, setNumber, true);
        }
    }

    document.addEventListener('selectionchange', () => {
        window.clearTimeout(selectionTimer);
        selectionTimer = window.setTimeout(() => {
            if (!enabled) return;
            const text = window.getSelection()?.toString().trim() || '';
            if (/^\d{5}$/.test(text) && !selectionInEditable()) {
                void fetchAndShow(text);
            }
        }, 400);
    });
})();
