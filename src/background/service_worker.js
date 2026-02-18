/**
 * Service worker (background script) for YT Subscriptions Cleaner.
 *
 * Handles messages from the content script and popup:
 *   SCAN_CHANNELS  – fetch last upload dates for a list of channel IDs
 *   TEST_API_KEY   – validate an API key
 *   GET_SETTINGS   – return current settings
 *   CLEAR_CACHE    – wipe per-channel cache entries
 *   OPEN_OPTIONS   – open the options page
 */

import { getSettings, fetchLastUploadDates, testApiKey } from "./youtubeApi.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      // ── SCAN_CHANNELS ──────────────────────────────────────────────────
      case "SCAN_CHANNELS": {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: "MISSING_API_KEY" });
          return;
        }
        try {
          const result = await fetchLastUploadDates(
            msg.channelIds,
            settings,
            msg.bypassCache ?? false
          );

          // Persist a scan summary for the popup
          const total = Object.keys(result).length;
          const inactive = Object.values(result).filter(
            (r) => r.daysAgo != null && r.daysAgo > r.thresholdDays
          ).length;
          await chrome.storage.local.set({
            lastScanSummary: { time: Date.now(), total, inactive },
          });

          sendResponse({ ok: true, result });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }

      // ── TEST_API_KEY ───────────────────────────────────────────────────
      case "TEST_API_KEY": {
        const result = await testApiKey(msg.apiKey);
        sendResponse(result);
        break;
      }

      // ── GET_SETTINGS ───────────────────────────────────────────────────
      case "GET_SETTINGS": {
        const settings = await getSettings();
        sendResponse({ ok: true, settings });
        break;
      }

      // ── CLEAR_CACHE ────────────────────────────────────────────────────
      case "CLEAR_CACHE": {
        const all = await chrome.storage.local.get(null);
        const cacheKeys = Object.keys(all).filter((k) =>
          k.startsWith("cache.")
        );
        await chrome.storage.local.remove(cacheKeys);
        await chrome.storage.local.remove("lastScanSummary");
        sendResponse({ ok: true, cleared: cacheKeys.length });
        break;
      }

      // ── OPEN_OPTIONS ───────────────────────────────────────────────────
      case "OPEN_OPTIONS": {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
    }
  })();

  return true; // keep message channel open for async response
});
