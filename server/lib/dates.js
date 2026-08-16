/**
 * Dates are stored as local-time text: 'YYYY-MM-DD' for dates and
 * 'YYYY-MM-DD HH:MM:SS' for timestamps. A single-laptop pharmacy has one
 * timezone, and local text sorts correctly and reads correctly in exports.
 */

const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function now() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Midnight UTC for a 'YYYY-MM-DD' string - avoids DST shifting day counts. */
function toUtcMillis(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `date`. Negative means already past. */
export function daysUntil(date, from = today()) {
  return Math.round((toUtcMillis(date) - toUtcMillis(from)) / 86400000);
}

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isExpired(expiryDate, from = today()) {
  return daysUntil(expiryDate, from) < 0;
}

/** 'EXPIRED' | 'EXPIRING_SOON' | 'GOOD' - mirrors the v_batch_status view. */
export function expiryStatus(expiryDate, alertDays, from = today()) {
  const days = daysUntil(expiryDate, from);
  if (days < 0) return 'EXPIRED';
  if (days <= alertDays) return 'EXPIRING_SOON';
  return 'GOOD';
}

/** File-safe timestamp for backup names: 2026-08-16-1432 */
export function backupStamp() {
  const d = new Date();
  return `${today()}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function timestampForFilename() {
  return backupStamp();
}
