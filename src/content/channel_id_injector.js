/**
 * channel_id_injector.js – runs in the PAGE's main JavaScript world.
 *
 * Content scripts run in an isolated world and cannot access prototype
 * getters defined by the page's JavaScript (like ytd-channel-renderer.data).
 * This script bridges that gap: it reads the Polymer component data (which
 * IS accessible here) and writes the channel ID as a plain DOM attribute
 * (data-ytsc-channel-id), which the isolated-world content script can read.
 *
 * It then dispatches the custom event "ytsc:ids-ready" on document so the
 * content script knows to (re-)scan.
 */

(function () {
  "use strict";

  function stampChannelIds() {
    let stamped = 0;

    document.querySelectorAll("ytd-channel-renderer").forEach((card) => {
      try {
        const data = card.data;
        if (!data) return;

        const id =
          data.channelId ||
          data.navigationEndpoint?.browseEndpoint?.browseId;

        if (id && id.startsWith("UC")) {
          card.setAttribute("data-ytsc-channel-id", id);
          stamped++;
        }
      } catch (_) {}
    });

    if (stamped > 0) {
      document.dispatchEvent(new CustomEvent("ytsc:ids-ready", { detail: { stamped } }));
    }
  }

  // YouTube fires this after Polymer has finished binding component data.
  // This is the most reliable trigger – by this point card.data is populated.
  window.addEventListener("yt-page-data-updated", stampChannelIds);

  // On SPA navigation: clear old stamps then re-stamp after Polymer updates.
  window.addEventListener("yt-navigate-finish", () => {
    document
      .querySelectorAll("[data-ytsc-channel-id]")
      .forEach((el) => el.removeAttribute("data-ytsc-channel-id"));
    setTimeout(stampChannelIds, 200);
  });

  // Attempt immediately in case data is already set (e.g. initial page load
  // where document_idle fires after Polymer has hydrated).
  stampChannelIds();
})();
