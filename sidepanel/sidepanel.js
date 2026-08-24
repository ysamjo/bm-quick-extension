(() => {
    'use strict';

    const pageHost = document.getElementById('page-host');
    const statusCard = document.getElementById('status-card');
    const statusText = document.getElementById('status-text');
    const browserView = document.getElementById('browser-view');
    const brickmergeFrame = document.getElementById('brickmerge-frame');
    const rescan = document.getElementById('rescan');

    let activeTabId = null;
    let loadSequence = 0;
    let rescanTimer = null;

    const setStatus = (text, state = 'loading') => {
        statusText.textContent = text;
        statusCard.classList.toggle('is-error', state === 'error');
        statusCard.classList.toggle('is-done', state === 'done');
        statusCard.hidden = !text;
    };

    const buildBrickmergeUrl = product => {
        const query = product?.setNumber || product?.ean || '';
        const url = new URL('https://www.brickmerge.de/');
        url.searchParams.set('find', query);
        return url.href;
    };

    const showProduct = product => {
        if (!product?.setNumber && !product?.ean) return false;
        browserView.hidden = false;
        setStatus('Mobile Brickmerge-Seite wird geladen …');
        brickmergeFrame.src = buildBrickmergeUrl(product);
        return true;
    };

    const detectInTab = async tabId => {
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                type: 'bm-detect-page-now'
            });
            if (response?.product) return response.product;
        } catch {}
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'bm-get-detected-set',
                tabId
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

    const loadActiveTab = async () => {
        const sequence = ++loadSequence;
        browserView.hidden = true;
        setStatus('Aktive Seite wird geprüft …');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (sequence !== loadSequence) return;
        activeTabId = tab?.id || null;
        let hostname = 'Keine normale Webseite';
        try { hostname = new URL(tab?.url || '').hostname || hostname; } catch {}
        pageHost.textContent = hostname;
        const product = activeTabId ? await detectInTab(activeTabId) : null;
        if (sequence !== loadSequence) return;
        if (!showProduct(product)) {
            showNoProduct('Auf dieser Seite wurde kein LEGO-Set erkannt.');
        }
    };
    rescan.addEventListener('click', () => void loadActiveTab());
    brickmergeFrame.addEventListener('load', () => setStatus('', 'done'));
    chrome.tabs.onActivated.addListener(() => {
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => void loadActiveTab(), 120);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (tabId !== activeTabId || changeInfo.status !== 'complete') return;
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => void loadActiveTab(), 180);
    });

    void loadActiveTab();
})();
