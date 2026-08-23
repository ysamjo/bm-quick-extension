const form = document.getElementById('settings-form');
const status = document.getElementById('status');
const SETTING_GROUPS = Object.freeze({
    cleanupAndLayout: ['cleaner', 'networkBlocking', 'detailLayout'],
    pricesAndSorting: ['priceCalculations', 'shippingAndSorting']
});

function populate(settingsValue) {
    const settings = BM_mergeSettings(settingsValue);
    document.querySelectorAll('[data-setting]').forEach(input => {
        input.checked = settings[input.dataset.setting] !== false;
    });
    document.querySelectorAll('[data-setting-group]').forEach(input => {
        const keys = SETTING_GROUPS[input.dataset.settingGroup] || [];
        const values = keys.map(key => settings[key] !== false);
        input.checked = values.length > 0 && values.every(Boolean);
        input.indeterminate = values.some(Boolean) && !values.every(Boolean);
    });
    document.querySelectorAll('[data-shop]').forEach(input => {
        input.checked = settings.offerShops[input.dataset.shop] !== false;
    });
    document.querySelectorAll('[data-link-row]').forEach(input => {
        input.checked = settings.linkRows[input.dataset.linkRow] !== false;
    });
    updateFranceControls();
}

function updateFranceControls() {
    const franceEnabled = document.querySelector('[data-link-row="france"]')?.checked === true;
    ['ebayFr', 'leboncoin', 'idealo'].forEach(shop => {
        const input = document.querySelector(`[data-shop="${shop}"]`);
        if (!input) return;
        input.disabled = !franceEnabled;
        input.closest('.setting')?.classList.toggle('is-disabled', !franceEnabled);
    });
}

function readForm() {
    const settings = BM_mergeSettings();
    document.querySelectorAll('[data-setting]').forEach(input => {
        settings[input.dataset.setting] = input.checked;
    });
    document.querySelectorAll('[data-setting-group]').forEach(input => {
        const keys = SETTING_GROUPS[input.dataset.settingGroup] || [];
        keys.forEach(key => {
            settings[key] = input.checked;
        });
    });
    document.querySelectorAll('[data-shop]').forEach(input => {
        settings.offerShops[input.dataset.shop] = input.checked;
    });
    document.querySelectorAll('[data-link-row]').forEach(input => {
        settings.linkRows[input.dataset.linkRow] = input.checked;
    });
    return settings;
}

async function reloadBrickmergeTabs() {
    const tabs = await chrome.tabs.query({
        url: ['https://brickmerge.de/*', 'https://www.brickmerge.de/*']
    });
    await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id)));
}

chrome.storage.local.get('settings').then(({ settings }) => populate(settings));

document.querySelector('[data-link-row="france"]')?.addEventListener(
    'change',
    updateFranceControls
);

form.addEventListener('submit', async event => {
    event.preventDefault();
    await chrome.storage.local.set({ settings: readForm() });
    await reloadBrickmergeTabs();
    status.textContent = 'Gespeichert';
    window.setTimeout(() => { status.textContent = ''; }, 1800);
});

document.getElementById('reset').addEventListener('click', () => {
    populate(BM_EXTENSION_DEFAULTS);
    status.textContent = 'Standardwerte geladen – noch nicht gespeichert';
});
