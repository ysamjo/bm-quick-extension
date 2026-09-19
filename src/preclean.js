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
        html.bm-extension-cleaner-enabled #offerlist form[name="sctoggle"],
        html.bm-extension-cleaner-enabled .content.setdetails form[name="sctoggle"],
        html.bm-extension-cleaner-enabled .small-12.medium-4.large-3.right,
        html.bm-extension-cleaner-enabled .content.noPadBottom > .row:first-child .small-12.column > .small-12:not(.setdetails),
        html.bm-extension-cleaner-enabled .bm-usernav,
        .bm-usernav,
        span.tap,
        .tap {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
            background-image: none !important;
        }
        #productrowcontainer,
        #productrow,
        .productrow,
        .bm-view-switcher {
            background: #FFFFFF !important;
        }
        #SoldOutContainer:empty,
        #SoldOutContainer:not(:has(.pricerow)),
        #soldOut:empty,
        #soldOut:not(:has(.pricerow)) {
            display: none !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 0 !important;
        }
        #productrow .wrapper div.slide .productimg,
        .productrow .wrapper div.slide .productimg {
            background: #FFFFFF !important;
            border: none !important;
        }
        @media screen and (min-width: 769px) {
            .bm-view-switcher {
                display: none !important;
            }
        }
        @media screen and (max-width: 768px) {
            .dropdown.button::before,
            .dropdown.button::after,
            button.dropdown::before,
            button.dropdown::after,
            a.button.dropdown::before,
            a.button.dropdown::after,
            #contenttoprow .dropdown.button::before,
            #contenttoprow .dropdown.button::after,
            #contenttoprow a.button.dropdown::before,
            #contenttoprow a.button.dropdown::after,
            #contenttoprow button.dropdown::before,
            #contenttoprow button.dropdown::after,
            #contenttoprow .viewDropDown::before,
            #contenttoprow .viewDropDown::after,
            a.button.dropdown.viewDropDown::before,
            a.button.dropdown.viewDropDown::after,
            .viewDropDown::before,
            .viewDropDown::after {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                background-image: none !important;
                content: none !important;
                border: none !important;
                width: 0 !important;
                height: 0 !important;
            }
        }
        html.bm-sidepanel-frame #filterrow,
        html.bm-sidepanel-frame .top-tab,
        html.bm-sidepanel-frame .content.setdetails [itemscope][itemtype$="BreadcrumbList"],
        html.bm-android-app [itemscope][itemtype*="BreadcrumbList"],
        html.bm-android-app .breadcrumb,
        html.bm-android-app nav[aria-label="breadcrumb"],
        html.bm-android-app .breadcrumbs,
        html.bm-android-app nav.breadcrumbs,
        html.bm-android-app .content.setdetails [itemscope][itemtype*="BreadcrumbList"],
        html.bm-android-app #headlinerow,
        html.bm-android-app #headlinerow h1,
        html.bm-android-app .content.setdetails h1,
        html.bm-android-app .setdetails h1 {
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
            background: #FFFFFF !important;
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
        @media screen and (max-width: 768px) {
            .wrapper.merchants#wrappernormal,
            .wrapper.merchants,
            .wrapper.themen#wrappernormal,
            .wrapper.themen {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 10px !important;
                padding: 0.5rem 0.75rem 2rem !important;
                box-sizing: border-box !important;
                width: 100% !important;
                margin-left: auto !important;
                margin-right: auto !important;
                justify-content: center !important;
            }
            .wrapper.brickstores#wrappernormal,
            .wrapper.brickstores {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 10px !important;
                padding: 0.5rem 0.75rem 2rem !important;
                box-sizing: border-box !important;
                width: 100% !important;
                margin-left: auto !important;
                margin-right: auto !important;
                justify-content: center !important;
            }
            .wrapper.merchants::before,
            .wrapper.merchants::after,
            .wrapper.themen::before,
            .wrapper.themen::after {
                display: none !important;
            }
            .wrapper.merchants .slide,
            .wrapper.themen .slide {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                float: none !important;
                display: flex !important;
                box-sizing: border-box !important;
                border: none !important;
            }
            .wrapper.merchants .slide a.themeimg,
            .wrapper.merchants .slide a,
            .wrapper.themen .slide a.themeimg,
            .wrapper.themen .slide a {
                width: 100% !important;
                min-height: 96px !important;
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 10px 8px 8px !important;
                border: 1px solid #E2E8F0 !important;
                border-radius: 12px !important;
                background: #FFFFFF !important;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04) !important;
                box-sizing: border-box !important;
                text-align: center !important;
                text-decoration: none !important;
            }
            .wrapper.merchants .slide .img,
            .wrapper.themen .slide .img {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                height: 44px !important;
                width: 100% !important;
                margin-bottom: 6px !important;
            }
            .wrapper.merchants .slide img,
            .wrapper.themen .slide img {
                max-height: 40px !important;
                max-width: 100% !important;
                width: auto !important;
                height: auto !important;
                object-fit: contain !important;
                margin: 0 auto 6px !important;
                display: block !important;
            }
            .wrapper.merchants .slide .img img,
            .wrapper.themen .slide .img img {
                margin-bottom: 0 !important;
            }
            .wrapper.merchants .slide a span:last-child,
            .wrapper.themen .slide a span:last-child {
                display: block !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                color: #1E293B !important;
                line-height: 1.25 !important;
                margin-top: auto !important;
                padding: 0 !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                max-width: 100% !important;
            }
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
