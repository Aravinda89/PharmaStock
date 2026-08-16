import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, reopenDb } from '../db/connection.js';
import { BACKUP_DIR, DB_PATH } from '../config.js';
import { backupStamp } from '../lib/dates.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSetting, setSettings } from './settings.js';

// Tables that must exist for a file to be a plausible PharmaStock database.
const REQUIRED_TABLES = ['drugs', 'batches', 'stock_ledger', 'users'];

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * SQLite's online backup API - safe to run while the app is in use, unlike
 * copying the file, which can catch a half-written WAL.
 */
export async function createBackup({ label = 'manual', userId = null } = {}) {
  ensureBackupDir();
  const filename = `pharmastock-${backupStamp()}-${label}.db`;
  const target = path.join(BACKUP_DIR, filename);

  await getDb().backup(target);
  setSettings({ last_backup_at: new Date().toISOString() }, userId);
  pruneOldBackups();

  const { size } = fs.statSync(target);
  return { filename, path: target, size, createdAt: new Date().toISOString() };
}

export function listBackups() {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return {
        filename,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keep the newest N backups; older ones are removed so the disk cannot fill. */
export function pruneOldBackups() {
  const keep = Number(getSetting('backup_retention_count')) || 30;
  const backups = listBackups();
  const removed = [];

  for (const backup of backups.slice(keep)) {
    // Never prune the safety copy taken immediately before a restore.
    if (backup.filename.includes('before-restore')) continue;
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, backup.filename));
      removed.push(backup.filename);
    } catch {
      // A locked file will simply be pruned on the next run.
    }
  }
  return removed;
}

export function getBackupPath(filename) {
  // Reject anything that tries to escape the backup folder.
  const safe = path.basename(filename);
  if (safe !== filename || !safe.endsWith('.db')) {
    throw badRequest('Invalid backup file name.');
  }
  const full = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(full)) throw notFound('That backup file no longer exists.');
  return full;
}

/** Refuse to restore anything that is not actually a PharmaStock database. */
export function validateBackupFile(filePath) {
  let probe;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const names = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);

    const missing = REQUIRED_TABLES.filter((t) => !names.includes(t));
    if (missing.length) {
      throw badRequest(
        `That file is not a PharmaStock backup (missing: ${missing.join(', ')}).`
      );
    }

    const counts = {
      drugs: probe.prepare('SELECT COUNT(*) AS n FROM drugs').get().n,
      batches: probe.prepare('SELECT COUNT(*) AS n FROM batches').get().n,
      movements: probe.prepare('SELECT COUNT(*) AS n FROM stock_ledger').get().n,
      users: probe.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    };
    return { valid: true, counts };
  } catch (err) {
    if (err?.status) throw err;
    throw badRequest('That file could not be opened as a database.');
  } finally {
    probe?.close();
  }
}

/**
 * Replace the live database with a backup.
 *
 * The current database is always copied aside first, so an accidental restore
 * is itself recoverable. The server must be restarted afterwards - the app
 * says so plainly rather than pretending the swap is seamless.
 */
export async function restoreBackup(sourcePath, { userId = null } = {}) {
  const summary = validateBackupFile(sourcePath);

  ensureBackupDir();
  const safetyCopy = path.join(BACKUP_DIR, `pharmastock-${backupStamp()}-before-restore.db`);
  await getDb().backup(safetyCopy);

  const db = getDb();
  // Fold the WAL back into the main file, then close, so nothing on disk is
  // left referring to the database we are about to overwrite.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${DB_PATH}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  fs.copyFileSync(sourcePath, DB_PATH);
  reopenDb();

  setSettings({ last_backup_at: getSetting('last_backup_at') }, userId);

  return {
    restored: true,
    safetyCopy: path.basename(safetyCopy),
    contents: summary.counts,
    restartRequired: true,
  };
}

/**
 * Automatic backups: one at startup, then daily. Errors are logged and
 * swallowed - a failed backup must never stop the pharmacy from working.
 */
export function startAutoBackup({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  const run = async (label) => {
    try {
      if (getSetting('auto_backup_enabled') !== '1') return;
      const result = await createBackup({ label });
      console.log(`[backup] ${result.filename} (${Math.round(result.size / 1024)} KB)`);
    } catch (err) {
      console.error('[backup] automatic backup failed:', err.message);
    }
  };

  run('startup');
  const timer = setInterval(() => run('daily'), intervalMs);
  timer.unref?.();
  return timer;
}
