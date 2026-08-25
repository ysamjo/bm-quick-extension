(() => {
    'use strict';

    const root = document.documentElement;
    if (!root) return;

    root.classList.add('bm-extension-preclean', 'bm-extension-cleaner-enabled');
    const isSidepanelFrame = window.top !== window;
    if (isSidepanelFrame) root.classList.add('bm-sidepanel-frame');

    const style = document.createElement('style');
    style.id = 'bm-extension-preclean-style';
    style.textContent = `
        html.bm-extension-preclean .content.setdetails {
            visibility: hidden !important;
        }
        html.bm-extension-preclean .small-12.medium-4.large-3.right {
            visibility: hidden !important;
        }
        html.bm-extension-cleaner-enabled .dealheat,
        html.bm-extension-cleaner-enabled .content.setdetails #short,
        html.bm-extension-cleaner-enabled .content.setdetails #alarm,
        html.bm-extension-cleaner-enabled .content.setdetails #feedback,
        html.bm-extension-cleaner-enabled .content.setdetails #productrowcontainer,
        html.bm-extension-cleaner-enabled .content.setdetails div.offerbox,
        html.bm-extension-cleaner-enabled #offerlist .goto.medium-7,
        html.bm-extension-cleaner-enabled #offerlist span.showmore,
        html.bm-extension-cleaner-enabled form[name="sctoggle"] {
            display: none !important;
        }
        html.bm-sidepanel-frame #filterrow,
        html.bm-sidepanel-frame .top-tab,
        html.bm-sidepanel-frame .content.setdetails [itemscope][itemtype$="BreadcrumbList"] {
            display: none !important;
        }
        html.bm-sidepanel-frame {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            overflow-x: hidden !important;
            font-size: 100% !important;
        }
        html.bm-sidepanel-frame body {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            min-height: 100% !important;
            overflow-x: hidden !important;
        }
        html.bm-sidepanel-frame #wrap,
        html.bm-sidepanel-frame .content.setdetails,
        html.bm-sidepanel-frame .content.setdetails > .row {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
        }
        html.bm-sidepanel-frame img,
        html.bm-sidepanel-frame canvas,
        html.bm-sidepanel-frame svg {
            max-width: 100% !important;
        }
        html.bm-sidepanel-frame .content.setdetails h1 {
            display: none !important;
        }
    `;
    root.appendChild(style);

    chrome.storage.local.get('settings').then(({ settings }) => {
        const current = BM_mergeSettings(settings);
        if (!current.cleaner) {
            root.classList.remove(
                'bm-extension-preclean',
                'bm-extension-cleaner-enabled'
            );
        }
    }).catch(() => {
        root.classList.remove('bm-extension-preclean');
    });

    window.setTimeout(() => {
        root.classList.remove('bm-extension-preclean');
    }, 8000);
})();
