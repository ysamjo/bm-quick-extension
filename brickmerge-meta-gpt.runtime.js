(() => {
    'use strict';

    const META_GPT_PATH = '/g/g-LZvgtoTB9-meta-preisvergleich-gpt';
    const TRANSFER_HASH_KEY = 'bm-meta-transfer';
    const LAST_SUBMITTED_KEY = 'brickmerge-meta-gpt-last-submitted-v2';
    const MAX_PENDING_AGE = 10 * 60 * 1000;
    const MAX_CLOCK_SKEW = 60 * 1000;
    const MAX_PROMPT_LENGTH = 5000;

    const parseTransfer = (hash, now = Date.now()) => {
        const parameters = new URLSearchParams(
            String(hash || '').replace(/^#/, '')
        );
        const serialized = parameters.get(TRANSFER_HASH_KEY);
        if (!serialized) return null;

        try {
            const value = JSON.parse(serialized);
            const id = String(value?.id || '').trim();
            const prompt = String(value?.prompt || '').trim();
            const createdAt = Number(value?.createdAt);
            const age = Number(now) - createdAt;
            if (!id || id.length > 200 || !prompt ||
                prompt.length > MAX_PROMPT_LENGTH ||
                !Number.isFinite(createdAt) || !Number.isFinite(age) ||
                age > MAX_PENDING_AGE || age < -MAX_CLOCK_SKEW) {
                return null;
            }
            return { id, prompt, createdAt };
        } catch {
            return null;
        }
    };

    const bridgeCore = Object.freeze({
        parseTransfer,
        TRANSFER_HASH_KEY,
        MAX_PENDING_AGE,
        MAX_PROMPT_LENGTH
    });
    globalThis.BM_META_GPT_BRIDGE_CORE = bridgeCore;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = bridgeCore;
    }

    if (typeof document === 'undefined' || typeof location === 'undefined') {
        return;
    }
    if (!location.pathname.startsWith(META_GPT_PATH)) return;

    const parameters = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!parameters.has(TRANSFER_HASH_KEY)) return;
    const transfer = parseTransfer(location.hash);

    parameters.delete(TRANSFER_HASH_KEY);
    const remainingHash = parameters.toString();
    history.replaceState(
        history.state,
        '',
        `${location.pathname}${location.search}${
            remainingHash ? `#${remainingHash}` : ''
        }`
    );
    if (!transfer) return;

    try {
        if (sessionStorage.getItem(LAST_SUBMITTED_KEY) === transfer.id) return;
    } catch {
        // A blocked sessionStorage must not prevent a one-time transfer.
    }

    const waitForElement = (getElement, timeout = 60000) =>
        new Promise(resolve => {
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
            const inserted = document.execCommand(
                'insertText',
                false,
                prompt
            );
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
        const editor = await waitForElement(findEditor);
        if (!editor) return;
        fillEditor(editor, transfer.prompt);
        const sendButton = await waitForElement(() => {
            const button = findSendButton();
            return button && !button.disabled ? button : null;
        }, 15000);
        if (!sendButton) return;
        try {
            sessionStorage.setItem(LAST_SUBMITTED_KEY, transfer.id);
        } catch {
            // The fragment has already been removed, so reloads cannot resend it.
        }
        sendButton.click();
    };

    void run();
})();
