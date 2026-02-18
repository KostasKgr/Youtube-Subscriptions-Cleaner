/**
 * render.js – Pure formatting helpers for YT Subscriptions Cleaner.
 *
 * Plain script (no ES modules). Functions are available globally to
 * subsequently-loaded content scripts (dom.js, content_script.js).
 */

/**
 * Converts a number of days into a human-readable "last upload" string.
 * @param {number} days
 * @returns {string}
 */
function ytscFormatDaysAgo(days) {
  if (days === 0) return "Last upload: today";
  if (days === 1) return "Last upload: yesterday";
  if (days < 30) return `Last upload: ${days} days ago`;

  if (days < 365) {
    const months = Math.floor(days / 30);
    return `Last upload: ${months} month${months !== 1 ? "s" : ""} ago`;
  }

  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  if (remMonths > 0) {
    return `Last upload: ${years}y ${remMonths}mo ago`;
  }
  return `Last upload: ${years} year${years !== 1 ? "s" : ""} ago`;
}

/**
 * Formats a timestamp (ms since epoch) as a locale date/time string.
 * @param {number} ms
 * @returns {string}
 */
function ytscFormatTimestamp(ms) {
  if (!ms) return "never";
  return new Date(ms).toLocaleString();
}
