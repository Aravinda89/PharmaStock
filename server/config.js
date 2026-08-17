import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = process.env.PHARMASTOCK_DATA_DIR || path.join(ROOT_DIR, 'data');
export const BACKUP_DIR = process.env.PHARMASTOCK_BACKUP_DIR || path.join(ROOT_DIR, 'backups');
export const DB_PATH = process.env.PHARMASTOCK_DB || path.join(DATA_DIR, 'pharmastock.db');
export const WEB_DIST = path.join(ROOT_DIR, 'web', 'dist');

export const PORT = Number(process.env.PORT || 4000);

// Binds to every interface so the pharmacy can later put the laptop on the LAN
// and let other machines browse to http://<laptop-ip>:4000 with no code change.
export const HOST = process.env.HOST || '0.0.0.0';

/**
 * The cookie-signing key, generated once per install and kept in the data
 * folder (which is gitignored and covered by backups).
 *
 * A literal committed to source would be the same key on every machine that
 * runs this, and published in the repository - so it would not be a secret at
 * all. Generating it here means each pharmacy gets its own, with no setup step
 * for them to forget.
 */
function loadOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const secretFile = path.join(DATA_DIR, 'session-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Not created yet - fall through and make one.
  }

  const secret = randomBytes(32).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Owner-only where the platform honours it; harmless on Windows.
  fs.writeFileSync(secretFile, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

export const SESSION_SECRET = loadOrCreateSessionSecret();

// 12 hours - comfortably longer than a pharmacy shift.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export const BACKUP_RETENTION = Number(process.env.BACKUP_RETENTION || 30);

export const DEFAULT_SETTINGS = {
  pharmacy_name: 'PharmaStock Pharmacy',
  expiry_alert_days: '90',
  backup_retention_count: String(BACKUP_RETENTION),
  auto_backup_enabled: '1',
  last_backup_at: '',
  // Set once, the first time the demo inventory is created. Checked on every
  // startup so that a pharmacy which deliberately removed the sample data does
  // not get it put back on the next restart.
  sample_data_seeded: '0',
};
