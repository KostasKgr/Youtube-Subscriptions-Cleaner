"use strict";

// ── DOM refs ────────────────────────────────────────────────────────────────
const $wrongPage       = document.getElementById("wrong-page");
const $onPage          = document.getElementById("on-page");
const $keyStatus       = document.getElementById("keyStatus");
const $summarySection  = document.getElementById("summary-section");
const $lastScan        = document.getElementById("lastScan");
const $totalChannels   = document.getElementById("totalChannels");
const $inactiveChannels = document.getElementById("inactiveChannels");
const $scanBtn         = document.getElementById("scanBtn");
const $scanStatus      = document.getElementById("scanStatus");
const $optionsBtn      = document.getElementById("optionsBtn");

// ── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(el, msg, type = "info") {
  el.textContent = msg;
  el.className = `status-msg status-msg--${type}`;
}

function formatTime(ms) {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ── Render summary from stored data ──────────────────────────────────────────
function renderSummary(summary) {
  if (!summary) return;
  show($summarySection);
  $lastScan.textContent      = formatTime(summary.time);
  $totalChannels.textContent = summary.total;
  $inactiveChannels.textContent = summary.inactive;
  $inactiveChannels.className =
    `value ${summary.inactive > 0 ? "value--warn" : "value--ok"}`;
}

// ── Check if currently on the right YouTube page ─────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isChannelsPage(url) {
  return url?.startsWith("https://www.youtube.com/feed/channels");
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const tab = await getActiveTab();

  if (!isChannelsPage(tab?.url)) {
    show($wrongPage);
    return;
  }

  show($onPage);

  // Check API key status
  const settings = await chrome.storage.local.get(["apiKey"]);
  if (settings.apiKey) {
    $keyStatus.textContent = "Configured ✓";
    $keyStatus.className = "value value--ok";
    $scanBtn.disabled = false;
  } else {
    $keyStatus.textContent = "Not configured";
    $keyStatus.className = "value value--error";
    setStatus($scanStatus, "Add an API key in Options first.", "error");
  }

  // Load last scan summary from storage
  const stored = await chrome.storage.local.get("lastScanSummary");
  renderSummary(stored.lastScanSummary);

  // Try to get live state from content script
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
    if (state?.ok && state.lastScanAt) {
      renderSummary({
        time: state.lastScanAt,
        total: state.summary.total,
        inactive: state.summary.inactive,
      });
    }
  } catch {
    // Content script not yet ready; stored summary is fine
  }
}

// ── Scan Now ──────────────────────────────────────────────────────────────────
$scanBtn.addEventListener("click", async () => {
  $scanBtn.disabled = true;
  setStatus($scanStatus, "Scanning…", "info");

  const tab = await getActiveTab();
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_NOW" });
    if (resp?.ok) {
      setStatus($scanStatus, "Done ✓", "ok");
      renderSummary({
        time: resp.lastScanAt || Date.now(),
        total: resp.summary?.total ?? 0,
        inactive: resp.summary?.inactive ?? 0,
      });
    } else {
      setStatus($scanStatus, "Scan failed.", "error");
    }
  } catch (e) {
    setStatus(
      $scanStatus,
      "Could not reach the page. Try refreshing it.",
      "error"
    );
  }

  $scanBtn.disabled = false;
});

// ── Open Options ──────────────────────────────────────────────────────────────
$optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
