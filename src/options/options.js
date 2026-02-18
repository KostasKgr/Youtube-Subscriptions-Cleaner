"use strict";

const DEFAULTS = { thresholdDays: 365, cacheTtlHours: 24, concurrency: 6 };

// ── DOM refs ────────────────────────────────────────────────────────────────
const $apiKey       = document.getElementById("apiKey");
const $toggleKey    = document.getElementById("toggleKey");
const $testKey      = document.getElementById("testKey");
const $testStatus   = document.getElementById("testStatus");
const $thresholdDays = document.getElementById("thresholdDays");
const $cacheTtlHours = document.getElementById("cacheTtlHours");
const $concurrency  = document.getElementById("concurrency");
const $save         = document.getElementById("save");
const $clearCache   = document.getElementById("clearCache");
const $saveStatus   = document.getElementById("saveStatus");

// ── Helpers ─────────────────────────────────────────────────────────────────
function setStatus(el, msg, type = "info") {
  el.textContent = msg;
  el.className = `status-msg status-msg--${type}`;
  if (msg) setTimeout(() => { el.textContent = ""; el.className = "status-msg"; }, 3500);
}

// ── Load saved settings ──────────────────────────────────────────────────────
async function load() {
  const v = await chrome.storage.local.get([
    "apiKey", "thresholdDays", "cacheTtlHours", "concurrency",
  ]);
  $apiKey.value        = v.apiKey         ?? "";
  $thresholdDays.value = v.thresholdDays  ?? DEFAULTS.thresholdDays;
  $cacheTtlHours.value = v.cacheTtlHours  ?? DEFAULTS.cacheTtlHours;
  $concurrency.value   = v.concurrency    ?? DEFAULTS.concurrency;
}

// ── Save ─────────────────────────────────────────────────────────────────────
$save.addEventListener("click", async () => {
  const key = $apiKey.value.trim();

  await chrome.storage.local.set({
    apiKey:        key,
    thresholdDays: Math.max(1, Number($thresholdDays.value) || DEFAULTS.thresholdDays),
    cacheTtlHours: Math.max(1, Number($cacheTtlHours.value) || DEFAULTS.cacheTtlHours),
    concurrency:   Math.max(1, Math.min(20, Number($concurrency.value) || DEFAULTS.concurrency)),
  });

  setStatus($saveStatus, "Settings saved.", "ok");
});

// ── Toggle API key visibility ─────────────────────────────────────────────────
$toggleKey.addEventListener("click", () => {
  const hidden = $apiKey.type === "password";
  $apiKey.type = hidden ? "text" : "password";
  $toggleKey.textContent = hidden ? "Hide" : "Show";
});

// ── Test API key ─────────────────────────────────────────────────────────────
$testKey.addEventListener("click", async () => {
  const apiKey = $apiKey.value.trim();
  if (!apiKey) {
    setStatus($testStatus, "Enter an API key first.", "error");
    return;
  }

  $testKey.disabled = true;
  setStatus($testStatus, "Testing…", "info");

  const resp = await chrome.runtime.sendMessage({ type: "TEST_API_KEY", apiKey });

  $testKey.disabled = false;
  if (resp?.ok) {
    setStatus($testStatus, "API key is valid ✓", "ok");
  } else {
    setStatus($testStatus, `Invalid: ${resp?.error ?? "unknown error"}`, "error");
  }
});

// ── Clear cache ───────────────────────────────────────────────────────────────
$clearCache.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
  if (resp?.ok) {
    setStatus($saveStatus, `Cache cleared (${resp.cleared} entries).`, "ok");
  } else {
    setStatus($saveStatus, "Failed to clear cache.", "error");
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
load();
