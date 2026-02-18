# YT Subscriptions Cleaner

A Manifest V3 Chrome extension that shows **how long ago each channel last uploaded** on `youtube.com/feed/channels` and highlights channels that have been inactive beyond a configurable threshold.

## Features

- Adds a "Last upload: X days ago" badge to every channel card on the subscriptions page
- Flags channels inactive beyond a threshold (default: 365 days) with an orange badge and a "Consider Unsubscribing" button
- Quota-efficient: uses `channels.list` (batched, 50 IDs/call) + `playlistItems.list` (1 call/channel) — a full scan of 200 channels costs ~204 units out of 10,000/day
- Per-channel result caching (default 24 h) so repeat visits are instant
- Configurable threshold, cache TTL, and concurrency
- Exponential backoff on 403/429 errors

## Installation (unpacked)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository root folder (the one containing `manifest.json`).
5. The extension icon appears in the toolbar.

## Setup

1. Click the extension icon → **Open Options** (or right-click → Options).
2. Paste your YouTube Data API key.
3. Click **Test API Key** to verify it works.
4. Click **Save Settings**.

### Getting a YouTube Data API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create/select a project.
2. Open **APIs & Services → Library**, search for *"YouTube Data API v3"*, and click **Enable**.
3. Open **APIs & Services → Credentials**, click **Create Credentials → API key**.
4. (Recommended) Restrict the key to the YouTube Data API v3.
5. Copy the key and paste it into the Options page.

## Usage

1. Navigate to `https://www.youtube.com/feed/channels`.
2. The extension automatically scans all visible channel cards and attaches upload-age badges.
3. Channels inactive beyond the threshold show an orange/red badge and a **Consider Unsubscribing** button that opens the channel page in a new tab.
4. Click the toolbar icon → **Scan Now** to force a fresh scan (bypasses cache).
5. New channels that appear as you scroll are picked up automatically via a MutationObserver.

## Project structure

```
yt-subscriptions-cleaner/
  manifest.json
  src/
    background/
      service_worker.js   – message router
      youtubeApi.js       – API calls, caching, batching, retry logic
      limiter.js          – concurrency limiter
    content/
      dom.js              – card finding, ID extraction, badge/button DOM ops
      render.js           – formatting helpers (daysAgo → human string)
      content_script.js   – main orchestration + MutationObserver
      styles.css          – badge & button styles (dark-mode aware)
    options/
      options.html/js/css – settings page
    popup/
      popup.html/js/css   – toolbar popup
  assets/
    icon16/48/128.png
```

## API quota usage

| Operation | Cost | Calls for 200 channels |
|---|---|---|
| `channels.list` (batch 50) | 1 unit | ~4 calls |
| `playlistItems.list` | 1 unit | ~200 calls |
| **Total per full scan** | | **~204 units** |

Default YouTube Data API quota per day: **10,000 units/day**

## Known limitations (V1)

- The "Consider Unsubscribing" button opens the channel page; it does not automate the unsubscribe click (fragile DOM automation is planned for V2).

## Security & privacy

- The API key is stored in `chrome.storage.local` (device-local, not synced).
- No data is sent anywhere except the official Google APIs (`googleapis.com`).
- The extension only injects on `youtube.com/feed/channels*`.
