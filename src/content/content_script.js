/**
 * content_script.js – Main orchestration for YT Subscriptions Cleaner.
 *
 * Plain IIFE (no ES modules). Relies on globals defined in dom.js and render.js
 * which are loaded before this file via the manifest content_scripts array.
 *
 * Responsibilities:
 *   1. Scan channel cards on load and attach upload-age badges
 *   2. Watch for new cards (lazy loading / SPA navigation) via MutationObserver
 *   3. Listen for SCAN_NOW messages from the popup
 */

/* global
  ytscFindChannelCards,
  ytscExtractChannelId,
  ytscExtractHandle,
  ytscAttachBadge,
  ytscAttachActionButton,
  ytscShowNotice
*/

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────
  const STATE = {
    scanning: false,
    lastScanAt: null,
    summary: { total: 0, inactive: 0 },
  };

  // ── Core scan ──────────────────────────────────────────────────────────
  async function scan(bypassCache = false) {
    if (STATE.scanning) return;
    STATE.scanning = true;

    const cards = ytscFindChannelCards();
    if (cards.length === 0) {
      STATE.scanning = false;
      return;
    }

    // Separate cards by whether the MAIN-world injector has stamped an ID yet
    const channelIds = [];
    const cardById = {}; // channelId → card
    const unstampedCards = []; // cards without an ID yet

    for (const card of cards) {
      const channelId = ytscExtractChannelId(card);
      if (channelId) {
        channelIds.push(channelId);
        cardById[channelId] = card;
      } else {
        unstampedCards.push(card);
      }
    }

    // Show "Checking…" on cards with IDs (replace any previous badge incl. "unsupported")
    for (const card of Object.values(cardById)) {
      ytscAttachBadge(card, { status: "loading" });
    }

    // For cards without an ID: show "unsupported" only if they have no real badge yet.
    // On re-scan they might still be unstamped for a moment – don't overwrite good data.
    for (const card of unstampedCards) {
      if (!card.querySelector(".ytsc-badge--active, .ytsc-badge--inactive, .ytsc-badge--warning")) {
        ytscAttachBadge(card, { status: "unsupported" });
      }
    }

    if (channelIds.length === 0) {
      STATE.scanning = false;
      return;
    }

    const uniqueIds = [...new Set(channelIds)];

    // ── Ask background to fetch data ──────────────────────────────────────
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "SCAN_CHANNELS",
        channelIds: uniqueIds,
        bypassCache,
      });
    } catch (e) {
      // Extension reloaded or background unavailable
      for (const card of Object.values(cardById)) {
        ytscAttachBadge(card, { status: "api_error", error: "Extension error – reload the page" });
      }
      STATE.scanning = false;
      return;
    }

    if (!resp?.ok) {
      if (resp?.error === "MISSING_API_KEY") {
        ytscShowNotice(
          "⚠️ <strong>YT Subscriptions Cleaner:</strong> " +
            '<a href="#" id="ytsc-open-options">Configure your API key in Options</a> to see upload ages.',
          "error"
        );
        document
          .getElementById("ytsc-open-options")
          ?.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
          });
        // Remove loading badges
        for (const card of Object.values(cardById)) {
          card.querySelector(".ytsc-badge")?.remove();
        }
      }
      STATE.scanning = false;
      return;
    }

    // ── Render results ────────────────────────────────────────────────────
    let inactive = 0;
    for (const [channelId, card] of Object.entries(cardById)) {
      const info = resp.result?.[channelId];
      if (!info) continue;

      ytscAttachBadge(card, info);

      if (info.daysAgo != null && info.daysAgo > info.thresholdDays) {
        ytscAttachActionButton(card, info);
        inactive++;
      }
    }

    STATE.lastScanAt = Date.now();
    STATE.summary = { total: uniqueIds.length, inactive };
    STATE.scanning = false;
  }

  // ── Debounced re-scan (for MutationObserver) ───────────────────────────
  let debounceTimer = null;
  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => scan(false), 1500);
  }

  // ── Watch for new channel cards (lazy loading) ─────────────────────────
  function startObservers() {
    const mo = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          const tag = node.tagName?.toLowerCase();
          if (
            tag === "ytd-channel-renderer" ||
            node.querySelector?.("ytd-channel-renderer")
          ) {
            scheduleScan();
            return;
          }
        }
      }
    });

    mo.observe(document.body, { childList: true, subtree: true });

    // YouTube SPA navigation fires this custom event on every route change
    window.addEventListener("yt-navigate-finish", () => {
      if (window.location.pathname === "/feed/channels") {
        scheduleScan();
      }
    });
  }

  // ── Listen for messages from the popup ────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "SCAN_NOW") {
      scan(true).then(() => {
        sendResponse({
          ok: true,
          summary: STATE.summary,
          lastScanAt: STATE.lastScanAt,
        });
      });
      return true; // async response
    }

    if (msg?.type === "GET_STATE") {
      sendResponse({
        ok: true,
        scanning: STATE.scanning,
        summary: STATE.summary,
        lastScanAt: STATE.lastScanAt,
      });
    }
  });

  // ── Retry a single channel (from badge click) ─────────────────────────
  document.addEventListener("ytsc:retry", (e) => {
    const { channelId } = e.detail;
    if (!channelId) return;
    const card = ytscFindChannelCards().find(
      (c) => ytscExtractChannelId(c) === channelId
    );
    if (card) {
      ytscAttachBadge(card, { status: "loading" });
      chrome.runtime
        .sendMessage({
          type: "SCAN_CHANNELS",
          channelIds: [channelId],
          bypassCache: true,
        })
        .then((resp) => {
          if (!resp?.ok) return;
          const info = resp.result?.[channelId];
          if (!info) return;
          ytscAttachBadge(card, info);
          if (info.daysAgo != null && info.daysAgo > info.thresholdDays) {
            ytscAttachActionButton(card, info);
          }
        });
    }
  });

  // ── Listen for MAIN-world injector signalling IDs are ready ──────────
  // channel_id_injector.js (main world) stamps data-ytsc-channel-id on each
  // card and then dispatches this event. Custom events cross the world boundary
  // through the shared DOM, so we receive it here in the isolated world.
  document.addEventListener("ytsc:ids-ready", () => scheduleScan());

  // ── Boot ───────────────────────────────────────────────────────────────
  // Also do an immediate scan in case the injector already ran and stamped
  // IDs before our listener was registered (race on document_idle).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scan());
  } else {
    scan();
  }
  startObservers();
})();
