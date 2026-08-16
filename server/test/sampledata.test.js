import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, makeUser, makeDrug, inDays } from './helpers.js';
import { ensureSeedUsers, seedDemoData, ensureFirstRunExample, sampleDataSummary, removeSampleData } from '../db/seed.js';
import { receiveStock } from '../services/receiving.js';
import { dispenseStock } from '../services/dispensing.js';
import { findStockDiscrepancies } from '../lib/stock.js';
import { getSetting } from '../services/settings.js';

test('a first start fills an empty system with a worked example', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  ensureSeedUsers(db);
  const result = ensureFirstRunExample(db);

  assert.equal(result.seeded, true);

  const summary = sampleDataSummary(db);
  assert.equal(summary.present, true);
  assert.equal(summary.drugs, 12);
  assert.ok(summary.receipts > 0 && summary.dispenses > 0 && summary.movements > 0);

  // The point of the example is that every alert has something to show.
  const alerts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM v_batch_status WHERE expiry_status = 'EXPIRED' AND quantity_on_hand > 0) AS expired,
         (SELECT COUNT(*) FROM v_batch_status WHERE expiry_status = 'EXPIRING_SOON' AND quantity_on_hand > 0) AS soon,
         (SELECT COUNT(*) FROM v_drug_stock WHERE stock_status IN ('LOW','OUT_OF_STOCK')) AS low`
    )
    .get();

  assert.ok(alerts.expired > 0, 'should demonstrate expired stock');
  assert.ok(alerts.soon > 0, 'should demonstrate stock expiring soon');
  assert.ok(alerts.low > 0, 'should demonstrate low stock');

  assert.deepEqual(findStockDiscrepancies(db), [], 'the example must itself be internally consistent');
});

test('the example is created once and never re-injected on later starts', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  ensureSeedUsers(db);
  assert.equal(ensureFirstRunExample(db).seeded, true);
  const first = sampleDataSummary(db).drugs;

  // Restart, restart, restart.
  assert.equal(ensureFirstRunExample(db).seeded, false);
  assert.equal(ensureFirstRunExample(db).seeded, false);
  assert.equal(sampleDataSummary(db).drugs, first);

  // And crucially, not after the pharmacy has deliberately removed it.
  removeSampleData(db);
  assert.equal(ensureFirstRunExample(db).seeded, false);
  assert.equal(sampleDataSummary(db).present, false);
});

test('a system that already has real drugs never gets sample data', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  ensureSeedUsers(db);
  makeDrug(db, { name: 'A real drug the pharmacy entered' });

  assert.equal(ensureFirstRunExample(db).seeded, false);
  assert.equal(sampleDataSummary(db).present, false);
  assert.equal(getSetting('sample_data_seeded', db), '1', 'flag is set so it is never reconsidered');
});

test('removing sample data leaves real records completely untouched', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  ensureSeedUsers(db);
  seedDemoData(db);

  // The pharmacy starts entering its own stock alongside the example.
  const userId = makeUser(db, { username: 'real-pharmacist' });
  const realDrug = makeDrug(db, { name: 'Real Drug', code: 'REAL1', min_stock_level: 10 });
  const realSupplier = db
    .prepare("INSERT INTO suppliers (name) VALUES ('Real Supplier')")
    .run().lastInsertRowid;

  receiveStock({
    supplierId: realSupplier,
    lines: [{ drugId: realDrug, batchNumber: 'REAL-B1', expiryDate: inDays(300), quantity: 200 }],
  }, userId, db);

  dispenseStock({ patientRef: 'REAL-OP-1', lines: [{ drugId: realDrug, quantity: 30 }] }, userId, db);

  const before = sampleDataSummary(db);
  assert.equal(before.present, true);

  const result = removeSampleData(db);
  assert.equal(result.removed, true);
  assert.equal(result.drugs, 12);

  // Sample records are gone...
  assert.equal(sampleDataSummary(db).present, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM drugs').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n, 1);

  // ...and the real ones survive exactly as they were.
  const real = db.prepare('SELECT * FROM v_drug_stock WHERE drug_id = ?').get(realDrug);
  assert.equal(real.name, 'Real Drug');
  assert.equal(real.available_qty, 170);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dispenses WHERE patient_ref = 'REAL-OP-1'").get().n, 1);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM stock_ledger WHERE drug_id = ?').get(realDrug).n,
    2,
    'the real drug keeps its receive and dispense history'
  );

  assert.deepEqual(findStockDiscrepancies(db), [], 'the ledger still reconciles after the purge');
});

test('a delivery mixing sample and real drugs keeps its real lines', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  ensureSeedUsers(db);
  seedDemoData(db);

  const userId = makeUser(db, { username: 'mixer' });
  const realDrug = makeDrug(db, { name: 'Real Drug', code: 'REAL2' });
  const sampleDrug = db.prepare("SELECT id FROM drugs WHERE code = 'PAR500'").get().id;

  // One delivery containing both a sample drug and a real one.
  const receipt = receiveStock({
    lines: [
      { drugId: sampleDrug, batchNumber: 'MIX-S', expiryDate: inDays(200), quantity: 50 },
      { drugId: realDrug, batchNumber: 'MIX-R', expiryDate: inDays(200), quantity: 60 },
    ],
  }, userId, db);

  removeSampleData(db);

  // The delivery survives because it still has a real line.
  const kept = db.prepare('SELECT * FROM goods_receipts WHERE id = ?').get(receipt.id);
  assert.ok(kept, 'a mixed delivery must not be deleted wholesale');

  const lines = db.prepare('SELECT * FROM goods_receipt_lines WHERE goods_receipt_id = ?').all(receipt.id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].drug_id, realDrug);

  assert.equal(db.prepare('SELECT available_qty FROM v_drug_stock WHERE drug_id = ?').get(realDrug).available_qty, 60);
  assert.deepEqual(findStockDiscrepancies(db), []);
});
