(() => {
    'use strict';

    const MAX_TERM_LENGTH = 120;
    const currentHostname = window.location.hostname.toLowerCase();
    if (
        currentHostname === 'brickmerge.de' ||
        currentHostname.endsWith('.brickmerge.de')
    ) return;

    let enabled = true;
    let lastReportedTerm = '';

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

    function currentSelectedTerm() {
        if (!enabled) return '';
        const selection = window.getSelection();
        if (!selection?.rangeCount || selectionInEditable(selection)) return '';
        return normalizedTerm(selection.toString());
    }

    function reportSelection(force = false) {
        const term = currentSelectedTerm();
        if (!force && term === lastReportedTerm) return;
        lastReportedTerm = term;
        void chrome.runtime.sendMessage({
            type: 'bm-page-selection-changed',
            term
        }).catch(() => {});
    }

    chrome.storage.local.get('settings').then(({ settings }) => {
        enabled = BM_mergeSettings(settings).selectionPopup;
        reportSelection(true);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        enabled = BM_mergeSettings(changes.settings.newValue).selectionPopup;
        reportSelection(true);
    });

    document.addEventListener('selectionchange', () => reportSelection());
    window.addEventListener('pagehide', () => {
        lastReportedTerm = '';
        void chrome.runtime.sendMessage({
            type: 'bm-page-selection-changed',
            term: ''
        }).catch(() => {});
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'bm-get-current-selection') return false;
        const term = currentSelectedTerm();
        lastReportedTerm = term;
        sendResponse({ term });
        return false;
    });
})();
