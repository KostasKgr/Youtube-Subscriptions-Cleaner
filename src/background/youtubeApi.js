/**
 * YouTube Data API v3 helpers.
 *
 * Quota strategy:
 *   - channels.list   → 1 unit/call, batched up to 50 IDs per request
 *   - playlistItems.list → 1 unit/call, one per channel (cannot batch)
 *   - Total for 270 channels: ~6 + 270 = ~276 units per full scan
 *   - search.list (100 units each) is intentionally avoided
 */

import { createLimiter } from "./limiter.js";

const DEFAULTS = {
  thresholdDays: 365,
  cacheTtlHours: 24,
  concurrency: 6,
};

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

export async function getSettings() {
  const stored = await chrome.storage.local.get([
    "apiKey",
    "thresholdDays",
    "cacheTtlHours",
    "concurrency",
  ]);
  return { ...DEFAULTS, ...stored };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function ytUrl(path, params) {
  const u = new URL(`${YT_API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

/**
 * Fetch with exponential backoff on 403/429.
 */
async function fetchJsonWithRetry(url, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url);
    if (r.ok) return r.json();

    if ((r.status === 403 || r.status === 429) && attempt < maxRetries) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    const body = await r.json().catch(() => ({}));
    const apiMsg = body?.error?.message;
    const err = new Error(apiMsg || `HTTP_${r.status}`);
    err.status = r.status;
    err.isQuota = r.status === 403 && apiMsg?.toLowerCase().includes("quota");
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFresh(cached, cacheTtlHours) {
  if (!cached?.lastCheckedAt) return false;
  const ttlMs = cacheTtlHours * 60 * 60 * 1000;
  return Date.now() - cached.lastCheckedAt < ttlMs;
}

function daysAgo(isoDate) {
  if (!isoDate) return null;
  return Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// --------------------------------------------------------------------------
// Main fetch logic
// --------------------------------------------------------------------------

/**
 * Fetches last upload dates for an array of channelIds.
 *
 * Returns a map: channelId → { lastUploadAt, daysAgo, status, thresholdDays }
 * status values: "ok" | "no_uploads" | "api_error" | "quota_exceeded"
 *
 * @param {string[]} channelIds
 * @param {object}   settings
 * @param {boolean}  bypassCache
 */
export async function fetchLastUploadDates(
  channelIds,
  settings,
  bypassCache = false
) {
  const { apiKey, cacheTtlHours, concurrency, thresholdDays } = settings;

  // ── 1. Load cache ──────────────────────────────────────────────────────
  const cacheKeys = channelIds.map((id) => `cache.${id}`);
  const cached = await chrome.storage.local.get(cacheKeys);

  const results = {};
  const toFetch = []; // { channelId, cachedPlaylistId? }

  for (const channelId of channelIds) {
    const entry = cached[`cache.${channelId}`];
    if (!bypassCache && isFresh(entry, cacheTtlHours)) {
      const days = daysAgo(entry.lastUploadAt);
      results[channelId] = {
        lastUploadAt: entry.lastUploadAt,
        daysAgo: days,
        thresholdDays,
        status: entry.lastUploadAt ? "ok" : "no_uploads",
      };
    } else {
      toFetch.push({
        channelId,
        cachedPlaylistId: entry?.uploadsPlaylistId ?? null,
      });
    }
  }

  if (toFetch.length === 0) return results;

  // ── 2. Batch channels.list to resolve uploads playlist IDs ─────────────
  //    Only needed for channels where we don't have a cached playlist ID.
  const needPlaylistId = toFetch
    .filter((c) => !c.cachedPlaylistId)
    .map((c) => c.channelId);

  const playlistIdMap = {}; // channelId → uploadsPlaylistId

  for (let i = 0; i < needPlaylistId.length; i += 50) {
    const batch = needPlaylistId.slice(i, i + 50);
    const url = ytUrl("channels", {
      part: "contentDetails",
      id: batch.join(","),
      key: apiKey,
    });
    try {
      const data = await fetchJsonWithRetry(url);
      for (const item of data.items ?? []) {
        playlistIdMap[item.id] =
          item.contentDetails?.relatedPlaylists?.uploads ?? null;
      }
      // Channels with no entry in response are private/deleted → mark no_uploads
      for (const cid of batch) {
        if (!(cid in playlistIdMap)) playlistIdMap[cid] = null;
      }
    } catch (e) {
      const status = e.isQuota ? "quota_exceeded" : "api_error";
      for (const cid of batch) {
        results[cid] = { status, error: e.message, thresholdDays };
      }
    }
  }

  // ── 3. Fetch most recent playlistItems for each channel ────────────────
  const limit = createLimiter(concurrency);

  const promises = toFetch.map(({ channelId, cachedPlaylistId }) => {
    // Skip channels already marked as error from step 2
    if (channelId in results) return Promise.resolve();

    const uploadsPlaylistId = cachedPlaylistId ?? playlistIdMap[channelId];

    if (!uploadsPlaylistId) {
      results[channelId] = {
        status: "no_uploads",
        daysAgo: null,
        thresholdDays,
      };
      return Promise.resolve();
    }

    return limit(async () => {
      try {
        const url = ytUrl("playlistItems", {
          part: "contentDetails",
          playlistId: uploadsPlaylistId,
          maxResults: 1,
          key: apiKey,
        });
        const data = await fetchJsonWithRetry(url);
        const item = data.items?.[0];
        // Prefer videoPublishedAt (actual publish date); fall back to publishedAt
        const lastUploadAt =
          item?.contentDetails?.videoPublishedAt ?? null;
        const days = daysAgo(lastUploadAt);

        results[channelId] = {
          lastUploadAt,
          daysAgo: days,
          thresholdDays,
          status: lastUploadAt ? "ok" : "no_uploads",
        };

        // Update cache
        await chrome.storage.local.set({
          [`cache.${channelId}`]: {
            uploadsPlaylistId,
            lastUploadAt,
            lastCheckedAt: Date.now(),
          },
        });
      } catch (e) {
        const status = e.isQuota ? "quota_exceeded" : "api_error";
        results[channelId] = { status, error: e.message, thresholdDays };
      }
    });
  });

  await Promise.all(promises);
  return results;
}

// --------------------------------------------------------------------------
// API key test
// --------------------------------------------------------------------------

/**
 * Validates an API key by making a minimal channels.list request
 * against YouTube's own public channel.
 */
export async function testApiKey(apiKey) {
  const url = ytUrl("channels", {
    part: "id",
    id: "UCBR8-60-B28hp2BmDPdntcQ", // YouTube's official channel
    key: apiKey,
  });
  try {
    const r = await fetch(url);
    if (r.ok) return { ok: true };
    const body = await r.json().catch(() => ({}));
    const msg = body?.error?.message || `HTTP ${r.status}`;
    return { ok: false, error: msg };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
