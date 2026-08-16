import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH, DATA_DIR, BACKUP_DIR } from '../config.js';
import { migrate } from './migrate.js';

// All database access funnels through this module. If better-sqlite3 ever stops
// building on a future Node, swapping to the built-in `node:sqlite` is a change
// to this one file - the SQL and transaction semantics are the same.

let db = null;

export function openDatabase(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const connection = new Database(dbPath);

  // WAL lets reads continue during writes, which matters once more than one
  // browser tab (or later, more than one machine) is using the system.
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('busy_timeout = 5000');

  migrate(connection);
  return connection;
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    db = openDatabase();
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** Replace the live connection - used by restore-from-backup. */
export function reopenDb() {
  closeDb();
  return getDb();
}
