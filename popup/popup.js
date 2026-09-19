const form = document.getElementById('search-form');
const input = document.getElementById('query');

form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.replace(/\s+/g, ' ').trim();
    if (!query) return;

    const url = new URL('https://www.brickmerge.de/');
    url.searchParams.set('find', query);

    let searchInSidebar = true;
    try {
        const { settings } = await chrome.storage.local.get('settings');
        const merged = typeof BM_mergeSettings === 'function'
            ? BM_mergeSettings(settings)
            : settings;
        if (merged && merged.searchInSidebar === false) {
            searchInSidebar = false;
        }
    } catch {}

    if (searchInSidebar) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const product = {
                    setNumber: query,
                    name: query,
                    query
                };
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'bm-show-floating-sidebar',
                    product
                });
                if (response?.ok) {
                    void chrome.runtime.sendMessage({
                        type: 'bm-page-product-detected',
                        tabId: tab.id,
                        product
                    }).catch(() => {});
                    window.close();
                    return;
                }
            }
        } catch {}
    }

    chrome.tabs.create({ url: url.href });
    window.close();
});

document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});
