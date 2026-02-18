/**
 * dom.js – DOM query helpers for YT Subscriptions Cleaner.
 *
 * Plain script (no ES modules) so it can be loaded as a content script
 * alongside render.js and content_script.js.
 *
 * All functions are defined at the top level and are available to
 * subsequently-loaded content scripts in the same isolated world.
 */

/* global ytscFormatDaysAgo */

// ---------------------------------------------------------------------------
// Finding channel cards
// ---------------------------------------------------------------------------

/**
 * Returns all ytd-channel-renderer elements currently in the DOM.
 * @returns {Element[]}
 */
function ytscFindChannelCards() {
  return Array.from(document.querySelectorAll("ytd-channel-renderer"));
}

// ---------------------------------------------------------------------------
// Extracting channel IDs from cards
// ---------------------------------------------------------------------------

/**
 * Extracts the UC... channel ID from a card element.
 *
 * Strategy (in order):
 *  1. data-ytsc-channel-id attribute – stamped by channel_id_injector.js, which
 *     runs in the page's MAIN world and can access Polymer component data.
 *     Content scripts (isolated world) cannot see prototype getters defined by
 *     the page's JS, so card.data is always undefined here even though it looks
 *     accessible from the DevTools console (which runs in the main world).
 *  2. Fallback: any href containing /channel/UC... (older YouTube page renders)
 *
 * @param {Element} card
 * @returns {string|null}
 */
function ytscExtractChannelId(card) {
  // 1. Attribute written by the MAIN-world injector
  const id = card.getAttribute("data-ytsc-channel-id");
  if (id?.startsWith("UC")) return id;

  // 2. Href fallback
  for (const link of card.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    const m = href.match(/\/channel\/(UC[\w-]+)/);
    if (m) return m[1];
  }

  return null;
}

/**
 * Extracts a @handle from a card element if no /channel/UC... link exists.
 * @param {Element} card
 * @returns {string|null}  e.g. "@mkbhd"
 */
function ytscExtractHandle(card) {
  const links = card.querySelectorAll("a[href]");
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const m = href.match(/^\/@([\w.-]+)/);
    if (m) return `@${m[1]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding a good insertion point inside a card
// ---------------------------------------------------------------------------

/**
 * Returns the best element inside a card to append a badge/button into.
 * @param {Element} card
 * @returns {Element}
 */
function ytscGetInfoEl(card) {
  return (
    card.querySelector("#info") ||
    card.querySelector("#channel-info") ||
    card.querySelector("#details") ||
    card.querySelector("#metadata") ||
    card.querySelector("#dismissible") ||
    card
  );
}

// ---------------------------------------------------------------------------
// Attaching badge
// ---------------------------------------------------------------------------

/**
 * Attaches (or replaces) a status badge on a channel card.
 *
 * @param {Element} card
 * @param {object}  info  – { status, daysAgo, thresholdDays, error? }
 */
function ytscAttachBadge(card, info) {
  // Remove any existing badge first
  card.querySelector(".ytsc-badge")?.remove();

  const badge = document.createElement("div");
  badge.className = "ytsc-badge";

  if (info.status === "loading") {
    badge.classList.add("ytsc-badge--loading");
    badge.textContent = "Checking…";
  } else if (info.status === "api_error") {
    badge.classList.add("ytsc-badge--error");
    badge.textContent = "API error – click to retry";
    badge.title = info.error || "";
    badge.style.cursor = "pointer";
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Trigger a re-scan (bypass cache) for this card
      document.dispatchEvent(
        new CustomEvent("ytsc:retry", {
          detail: { channelId: ytscExtractChannelId(card) },
        })
      );
    });
  } else if (info.status === "quota_exceeded") {
    badge.classList.add("ytsc-badge--error");
    badge.textContent = "Quota exceeded – try tomorrow";
  } else if (info.status === "no_uploads") {
    badge.classList.add("ytsc-badge--warning");
    badge.textContent = "No uploads found";
  } else if (info.status === "unsupported") {
    badge.classList.add("ytsc-badge--unsupported");
    badge.textContent = "Handle-only (V2)";
    badge.title = "Channel ID resolution for @handle URLs coming in V2";
  } else if (info.status === "ok" && info.daysAgo != null) {
    const inactive = info.daysAgo > info.thresholdDays;
    badge.classList.add(inactive ? "ytsc-badge--inactive" : "ytsc-badge--active");
    badge.textContent = ytscFormatDaysAgo(info.daysAgo);
    if (inactive) badge.title = "Inactive beyond threshold";
  } else {
    badge.classList.add("ytsc-badge--warning");
    badge.textContent = "Unknown";
  }

  ytscGetInfoEl(card).appendChild(badge);
}

// ---------------------------------------------------------------------------
// Attaching the "Consider Unsubscribing" action button
// ---------------------------------------------------------------------------

/**
 * Attaches (or replaces) the unsubscribe-prompt button on an inactive card.
 * V1: opens the channel page in a new tab so the user can manually unsubscribe.
 *
 * @param {Element} card
 * @param {object}  info
 */
function ytscAttachActionButton(card, info) {
  card.querySelector(".ytsc-unsubscribe-btn")?.remove();

  const btn = document.createElement("button");
  btn.className = "ytsc-unsubscribe-btn";
  btn.textContent = "Consider Unsubscribing";
  btn.title = `Last upload ${info.daysAgo} days ago – inactive beyond ${info.thresholdDays}-day threshold`;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const link = card.querySelector(
      "a#main-link, a#avatar-link, a[href*='/channel/'], a[href*='/@']"
    );
    if (link) window.open(link.href, "_blank");
  });

  ytscGetInfoEl(card).appendChild(btn);
}

// ---------------------------------------------------------------------------
// Page-level notice (e.g. "configure API key")
// ---------------------------------------------------------------------------

/**
 * Shows (or replaces) a page-level notice banner.
 *
 * Uses position:fixed (see styles.css) so the insertion point in the DOM
 * doesn't matter – appending to body keeps it out of YouTube's layout tree
 * entirely and avoids accidentally landing inside the nav sidebar.
 *
 * @param {string} html
 * @param {'info'|'error'} type
 */
function ytscShowNotice(html, type = "info") {
  document.querySelector(".ytsc-notice")?.remove();

  const notice = document.createElement("div");
  notice.className = `ytsc-notice ytsc-notice--${type}`;
  notice.innerHTML = html;

  document.body.appendChild(notice);
}
