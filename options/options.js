const form = document.getElementById('settings-form');
const status = document.getElementById('status');
const SETTING_GROUPS = Object.freeze({
    pricesAndSorting: ['priceCalculations', 'shippingAndSorting']
});

let storedSettings = null;

function populate(settingsValue) {
    storedSettings = BM_mergeSettings(settingsValue);
    const settings = storedSettings;
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
    updateOverview();
}

function updateShopControls() {
    const marketplacesEnabled = document.querySelector('[data-setting="marketplacesInOfferlist"]')?.checked !== false;
    const franceEnabled = document.querySelector('[data-link-row="france"]')?.checked === true;
    const enabled = shop => ['ebayFr', 'leboncoin', 'idealo'].includes(shop)
        ? marketplacesEnabled && franceEnabled
        : marketplacesEnabled;
    document.querySelectorAll('[data-shop]').forEach(input => {
        setControlEnabled(input, enabled(input.dataset.shop));
    });
}

function updateLinkRowControls() {
    const enabled = document.querySelector('[data-setting="linkPanel"]')?.checked !== false;
    document.querySelectorAll('[data-link-row]').forEach(input => {
        setControlEnabled(input, enabled);
    });
}

function setControlEnabled(input, enabled) {
    input.disabled = !enabled;
    input.closest('label')?.classList.toggle('is-disabled', !enabled);
}

function updateCounters() {
    const count = (selector, target) => {
        const inputs = [...document.querySelectorAll(selector)];
        const active = inputs.filter(input => input.checked && !input.disabled).length;
        document.querySelectorAll(target).forEach(el => {
            el.textContent = `${active} von ${inputs.length}`;
        });
    };
    count('[data-shop]', '[data-count-shops]');
    count('[data-link-row]', '[data-count-rows]');
}

function updateOverview() {
    updateShopControls();
    updateLinkRowControls();
    updateCounters();
}

function readForm() {
    // Startpunkt sind die gespeicherten Werte: Keys ohne Formularfeld
    // (cleaner, detailLayout, listView) wandern unveraendert durch.
    const settings = BM_mergeSettings(storedSettings);
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

async function saveSettings() {
    await chrome.storage.local.set({ settings: readForm() });
    await reloadBrickmergeTabs();
    status.textContent = 'Gespeichert';
    window.setTimeout(() => { status.textContent = ''; }, 1800);
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    await saveSettings();
});

form.addEventListener('change', async () => {
    updateOverview();
    await saveSettings();
});

document.getElementById('reset').addEventListener('click', async () => {
    populate(BM_EXTENSION_DEFAULTS);
    await saveSettings();
    status.textContent = 'Standardwerte wiederhergestellt';
    window.setTimeout(() => { status.textContent = ''; }, 1800);
});
