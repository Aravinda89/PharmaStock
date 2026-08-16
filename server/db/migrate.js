import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Versioned migrations tracked by SQLite's own `user_version` pragma - no
// migration table, no tooling. Append a new entry to add a migration; never
// edit an entry that has already shipped.
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
      db.exec(sql);
    },
  },
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  const pending = MIGRATIONS.filter((m) => m.version > current);

  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    run();
  }

  ensureDefaultSettings(db);
  return { from: current, to: db.pragma('user_version', { simple: true }) };
}

/**
 * Settings rows are created if missing but never overwritten, so an upgrade
 * cannot silently reset the pharmacy's configured expiry threshold.
 */
function ensureDefaultSettings(db) {
  const insert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, value);
    }
  });
  run();
}
