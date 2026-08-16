import path from 'node:path';
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

export const SESSION_SECRET =
  process.env.SESSION_SECRET || 'pharmastock-local-session-secret-change-me';

// 12 hours - comfortably longer than a pharmacy shift.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export const BACKUP_RETENTION = Number(process.env.BACKUP_RETENTION || 30);

export const DEFAULT_SETTINGS = {
  pharmacy_name: 'PharmaStock Pharmacy',
  expiry_alert_days: '90',
  backup_retention_count: String(BACKUP_RETENTION),
  auto_backup_enabled: '1',
  last_backup_at: '',
};
