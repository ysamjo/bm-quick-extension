const form = document.getElementById('search-form');
const input = document.getElementById('query');

form.addEventListener('submit', event => {
    event.preventDefault();
    const query = input.value.replace(/\s+/g, ' ').trim();
    if (!query) return;

    const url = new URL('https://www.brickmerge.de/');
    url.searchParams.set('find', query);
    chrome.tabs.create({ url: url.href });
    window.close();
});

document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});

document.getElementById('open-sidepanel').addEventListener('click', async () => {
    const currentWindow = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: currentWindow.id });
    window.close();
});
