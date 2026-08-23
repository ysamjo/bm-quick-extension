(() => {
    'use strict';

    const META_GPT_PATH = '/g/g-LZvgtoTB9-meta-preisvergleich-gpt';
    const PENDING_KEY = 'brickmerge-meta-gpt-pending-v1';
    const LAST_SUBMITTED_KEY = 'brickmerge-meta-gpt-last-submitted-v1';
    const MAX_PENDING_AGE = 10 * 60 * 1000;

    if (!location.pathname.startsWith(META_GPT_PATH)) return;

    const waitForElement = (getElement, timeout = 60000) => new Promise(resolve => {
        const immediate = getElement();
        if (immediate) {
            resolve(immediate);
            return;
        }
        const observer = new MutationObserver(() => {
            const element = getElement();
            if (!element) return;
            observer.disconnect();
            window.clearTimeout(timer);
            resolve(element);
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true
        });
        const timer = window.setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });

    const waitForTransfer = (timeout = 10000) => new Promise(resolve => {
        const startedAt = Date.now();
        const check = async () => {
            const transfer = await GM_getValue(PENDING_KEY, null);
            if (transfer?.id && transfer.prompt && transfer.createdAt) {
                resolve(transfer);
                return;
            }
            if (Date.now() - startedAt >= timeout) {
                resolve(null);
                return;
            }
            window.setTimeout(check, 100);
        };
        void check();
    });

    const findEditor = () => document.querySelector(
        '#prompt-textarea[contenteditable="true"], ' +
        'textarea#prompt-textarea, form textarea, ' +
        '[contenteditable="true"][data-lexical-editor="true"]'
    );

    const fillEditor = (editor, prompt) => {
        editor.focus();
        if (editor instanceof HTMLTextAreaElement) {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            setter?.call(editor, prompt);
        } else {
            document.execCommand('selectAll', false, null);
            const inserted = document.execCommand('insertText', false, prompt);
            if (!inserted || editor.textContent.trim() !== prompt) {
                const paragraph = document.createElement('p');
                paragraph.textContent = prompt;
                editor.replaceChildren(paragraph);
            }
        }
        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: prompt
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const findSendButton = () => document.querySelector(
        'button[data-testid="send-button"], ' +
        'button[data-testid="fruitjuice-send-button"]'
    ) || Array.from(document.querySelectorAll('form button')).find(button => {
        const label = [
            button.getAttribute('aria-label'),
            button.getAttribute('title')
        ].filter(Boolean).join(' ');
        return /send|senden|absenden/i.test(label);
    }) || null;

    const run = async () => {
        const { settings } = await chrome.storage.local.get('settings');
        if (!BM_mergeSettings(settings).metaGptBridge) return;
        const transfer = await waitForTransfer();
        if (!transfer) return;
        if (Date.now() - Number(transfer.createdAt) > MAX_PENDING_AGE) {
            await GM_deleteValue(PENDING_KEY);
            return;
        }
        if (await GM_getValue(LAST_SUBMITTED_KEY, '') === transfer.id) {
            await GM_deleteValue(PENDING_KEY);
            return;
        }
        const editor = await waitForElement(findEditor);
        if (!editor) return;
        fillEditor(editor, transfer.prompt);
        const sendButton = await waitForElement(() => {
            const button = findSendButton();
            return button && !button.disabled ? button : null;
        }, 15000);
        if (!sendButton) return;
        await GM_setValue(LAST_SUBMITTED_KEY, transfer.id);
        await GM_deleteValue(PENDING_KEY);
        sendButton.click();
    };

    void run();
})();
