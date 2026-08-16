import { getDb } from '../db/connection.js';
import { DEFAULT_SETTINGS } from '../config.js';

export function getAllSettings(db = getDb()) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export function getSetting(key, db = getDb()) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

/**
 * The expiry threshold every screen reads. Changing it re-colours the whole
 * system at once because the v_batch_status view reads the same row.
 */
export function getExpiryAlertDays(db = getDb()) {
  const value = Number(getSetting('expiry_alert_days', db));
  return Number.isFinite(value) && value > 0 ? value : 90;
}

export function setSettings(values, userId, db = getDb()) {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by)
     VALUES (?, ?, datetime('now','localtime'), ?)
     ON CONFLICT(key) DO UPDATE
       SET value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      stmt.run(key, String(value), userId ?? null);
    }
  })();
  return getAllSettings(db);
}
