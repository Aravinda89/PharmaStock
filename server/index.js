import { createApp } from './app.js';
import { getDb, closeDb } from './db/connection.js';
import { startAutoBackup } from './services/backup.js';
import { ensureSeedUsers, ensureFirstRunExample } from './db/seed.js';
import { PORT, HOST, DB_PATH } from './config.js';

const db = getDb();

// A brand-new install needs someone who can sign in. This only ever runs when
// the users table is completely empty.
ensureSeedUsers(db);

// ...and something to look at, so the first screen teaches rather than sits
// empty. Removed permanently from Settings once real stock is being recorded.
const example = ensureFirstRunExample(db);

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  const drugs = db.prepare('SELECT COUNT(*) AS n FROM drugs WHERE is_active = 1').get().n;

  console.log('');
  console.log('  PharmaStock is running');
  console.log('  ----------------------');
  console.log(`  Open:      http://localhost:${PORT}`);
  console.log(`  Database:  ${DB_PATH}`);
  console.log(`  Inventory: ${drugs} active drugs`);
  if (example.seeded) {
    console.log('');
    console.log('  This is EXAMPLE data, to show you how the system works.');
    console.log('  Remove it from Settings -> Sample data when you are ready');
    console.log('  to record your real stock.');
  }
  console.log('');
  console.log('  Keep this window open while the pharmacy is using the system.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

startAutoBackup();

const shutdown = (signal) => {
  console.log(`\n  Stopping PharmaStock (${signal})...`);
  server.close(() => {
    closeDb();
    console.log('  Stopped. Your data is saved.');
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
