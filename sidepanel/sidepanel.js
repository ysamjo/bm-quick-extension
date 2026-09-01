(() => {
    'use strict';

    const statusCard = document.getElementById('status-card');
    const statusText = document.getElementById('status-text');
    const searchForm = document.getElementById('panel-search-form');
    const searchInput = document.getElementById('panel-query');
    const browserView = document.getElementById('browser-view');
    const brickmergeFrame = document.getElementById('brickmerge-frame');

    let loadSequence = 0;
    let rescanTimer = null;
    let lastCompletedTabUrl = '';

    const setStatus = (text, state = 'loading') => {
        statusText.textContent = text;
        statusCard.classList.toggle('is-error', state === 'error');
        statusCard.classList.toggle('is-done', state === 'done');
        statusCard.classList.toggle('is-loading', state === 'loading');
    };

    const buildBrickmergeUrl = product => {
        const query = product?.setNumber || product?.ean || '';
        const url = new URL('https://www.brickmerge.de/');
        url.searchParams.set('find', query);
        return url.href;
    };

    const showProduct = product => {
        if (!product?.setNumber && !product?.ean) return false;
        const nextUrl = buildBrickmergeUrl(product);
        const currentUrl = brickmergeFrame.getAttribute('src') || '';
        browserView.hidden = false;
        if (currentUrl !== nextUrl) {
            if (currentUrl) setStatus('', 'done');
            else setStatus('Mobile Brickmerge-Seite wird geladen …');
            brickmergeFrame.src = nextUrl;
        } else {
            setStatus('', 'done');
        }
        return true;
    };

    const detectInTab = async tabId => {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'bm-get-detected-set',
                tabId
            });
            if (response?.product) return response.product;
        } catch {}
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                type: 'bm-detect-page-now'
            });
            return response?.product || null;
        } catch {
            return null;
        }
    };

    const showNoProduct = message => {
        browserView.hidden = true;
        brickmergeFrame.removeAttribute('src');
        setStatus(message, 'done');
    };

    const loadActiveTab = async (expectedTabId = null) => {
        const sequence = ++loadSequence;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (sequence !== loadSequence) return;
        const tabId = tab?.id || null;
        if (expectedTabId !== null && tabId !== expectedTabId) return;
        const hadFrame = Boolean(brickmergeFrame.getAttribute('src'));
        if (!hadFrame) {
            browserView.hidden = true;
            setStatus('Aktive Seite wird geprüft …');
        }
        const product = tabId ? await detectInTab(tabId) : null;
        if (sequence !== loadSequence) return;
        if (!showProduct(product)) {
            if (hadFrame) {
                // Content scripts can report a short-lived empty result while a
                // newly navigated page is still wiring up. Keep the old frame
                // visible during one retry instead of flashing it away.
                await new Promise(resolve => setTimeout(resolve, 250));
                if (sequence !== loadSequence) return;
                const retry = tabId ? await detectInTab(tabId) : null;
                if (sequence !== loadSequence) return;
                if (showProduct(retry)) return;
            }
            showNoProduct('Auf dieser Seite wurde kein LEGO-Set erkannt.');
        }
    };
    searchForm.addEventListener('submit', event => {
        event.preventDefault();
        const query = searchInput.value.replace(/\s+/g, ' ').trim();
        if (!query) return;
        showProduct(/^\d{13}$/.test(query)
            ? { ean: query }
            : { setNumber: query });
    });
    brickmergeFrame.addEventListener('load', () => setStatus('', 'done'));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status !== 'complete' || !tab?.active) return;
        const completedUrl = String(tab.url || '').trim();
        if (completedUrl && completedUrl === lastCompletedTabUrl) return;
        if (completedUrl) lastCompletedTabUrl = completedUrl;
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => void loadActiveTab(tabId), 180);
    });

    void loadActiveTab();
})();
