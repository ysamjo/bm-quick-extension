(() => {
  "use strict";

  // Nicht auf brickmerge selbst laufen lassen
  if (location.hostname.includes("brickmerge.de")) return;

  const BASE_URL = "https://www.brickmerge.de";
  const cache = new Map();

  let bmTimeout = null;
  let lastSetNum = null;

  function selectionInEditable() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    let node = sel.getRangeAt(0).startContainer;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !node.closest) return false;

    // Gmail/YouTube & andere Rich-Text-Editoren
    return !!node.closest(
      'input, textarea, [contenteditable="true"], [role="textbox"], #contenteditable-root'
    );
  }

  function normalizeSelectionText(raw) {
    if (!raw) return "";
    // Zero-width chars + NBSP entfernen
    return raw
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  function getSelectedSetNum() {
    const sel = window.getSelection();
    if (!sel) return null;

    const text = normalizeSelectionText(sel.toString());
    if (!text) return null;

    // 5-stellige Nummer finden (auch wenn versehentlich mehr Text markiert wurde)
    const m = text.match(/\b(\d{5})\b/);
    return m ? m[1] : null;
  }

  function ensurePopup() {
    let popup = document.getElementById("brickmerge-popup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "brickmerge-popup";
    popup.innerHTML = `
      <div id="bm-header">
        <a id="bm-link" target="_blank" rel="noreferrer noopener"></a>
        <button id="bm-close" type="button" aria-label="Close">×</button>
      </div>
      <div id="bm-content-container"></div>
    `;

    document.documentElement.appendChild(popup);

    popup.querySelector("#bm-close").addEventListener("click", () => popup.remove());

    // Klick außerhalb schließt
    const onDocMouseDown = (e) => {
      const p = document.getElementById("brickmerge-popup");
      if (!p) {
        document.removeEventListener("mousedown", onDocMouseDown, true);
        return;
      }
      if (!p.contains(e.target)) p.remove();
    };
    document.addEventListener("mousedown", onDocMouseDown, true);

    // Drag
    makeDraggable(popup, popup.querySelector("#bm-header"));

    return popup;
  }

  function showPopup(setNum, htmlContent) {
    const popup = ensurePopup();

    const link = popup.querySelector("#bm-link");
    link.href = `${BASE_URL}/${setNum}`;
    link.textContent = `brickmerge: Set #${setNum} ↗`;

    popup.querySelector("#bm-content-container").innerHTML = htmlContent;
  }

  function showLoading(setNum) {
    showPopup(setNum, `<div style="text-align:center; padding:10px;">Lade Daten...</div>`);
  }

  function showError(setNum, msg) {
    showPopup(setNum, `<div style="color:#e74c3c; padding:4px 0;">${escapeHtml(msg)}</div>`);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function makeDraggable(el, handle) {
    let startX = 0,
      startY = 0,
      startLeft = 0,
      startTop = 0;
    let dragging = false;

    handle.addEventListener("mousedown", (e) => {
      // Link/Close nicht draggen
      if (e.target.closest("#bm-close") || e.target.closest("#bm-link") || e.button !== 0) return;

      dragging = true;
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // beim ersten Drag von center-position auf feste Pixel wechseln
      el.style.left = `${startLeft}px`;
      el.style.top = `${startTop}px`;
      el.style.transform = "none";

      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${startLeft + dx}px`;
      el.style.top = `${startTop + dy}px`;
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  async function fetchBrickmergePage(setNum) {
    const res = await fetch(`${BASE_URL}/${setNum}`, {
      method: "GET",
      credentials: "omit"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  function extractContentFromHtml(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");

    // wie in deinem Userscript
    const candidates = doc.querySelectorAll("div.productprice > div");
    let found = null;

    for (const div of candidates) {
      if (div.querySelector("p") && div.querySelectorAll("strong").length >= 4) {
        found = div;
        break;
      }
    }
    if (!found) return null;

    // Links entfernen/entlinken
    found.querySelectorAll("a").forEach((a) => {
      const text = (a.textContent || "").trim();
      const isButton =
        a.classList.contains("button") ||
        text.toLowerCase().includes("shop") ||
        text.toLowerCase().includes("korrektur");

      if (text.length > 0 && !isButton) a.replaceWith(text);
      else a.remove();
    });

    return found.innerHTML;
  }

  async function fetchAndShow(setNum) {
    if (cache.has(setNum)) {
      showPopup(setNum, cache.get(setNum));
      return;
    }

    showLoading(setNum);

    try {
      const html = await fetchBrickmergePage(setNum);
      const content = extractContentFromHtml(html);

      if (!content) {
        showError(setNum, "Keine Details zu diesem Set gefunden.");
        return;
      }

      cache.set(setNum, content);
      showPopup(setNum, content);
    } catch {
      showError(setNum, "Fehler beim Laden.");
    }
  }

  function scheduleCheck() {
    if (bmTimeout) clearTimeout(bmTimeout);
    bmTimeout = setTimeout(() => {
      const setNum = getSelectedSetNum();
      if (!setNum) return;

      // wie im Userscript: nicht im Editor auslösen
      if (selectionInEditable()) return;

      // nicht dauernd neu öffnen, wenn gleiche Nummer selektiert bleibt
      if (setNum === lastSetNum && document.getElementById("brickmerge-popup")) return;

      lastSetNum = setNum;
      fetchAndShow(setNum);
    }, 250);
  }

  // Gmail/YouTube: zusätzlich zu selectionchange auch mouseup/keyup
  document.addEventListener("selectionchange", scheduleCheck, true);
  document.addEventListener("mouseup", scheduleCheck, true);
  document.addEventListener("keyup", scheduleCheck, true);
})();
