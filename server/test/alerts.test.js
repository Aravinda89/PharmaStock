import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, makeUser, makeDrug, inDays } from './helpers.js';
import { receiveStock } from '../services/receiving.js';
import { dispenseStock } from '../services/dispensing.js';
import { getAlertSummary, getExpiredBatches, getExpiringSoonBatches, getLowStockDrugs } from '../services/alerts.js';
import { setSettings } from '../services/settings.js';
import { expiryStatus, daysUntil } from '../lib/dates.js';

const statusOf = (db, batchNumber) =>
  db.prepare('SELECT expiry_status FROM v_batch_status WHERE batch_number = ?').get(batchNumber).expiry_status;

test('expiry buckets are correct at the boundaries', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db);

  setSettings({ expiry_alert_days: '30' }, userId, db);

  receiveStock({
    lines: [
      { drugId, batchNumber: 'YESTERDAY', expiryDate: inDays(-1), quantity: 5 },
      { drugId, batchNumber: 'TODAY', expiryDate: inDays(0), quantity: 5 },
      { drugId, batchNumber: 'ON_THRESHOLD', expiryDate: inDays(30), quantity: 5 },
      { drugId, batchNumber: 'JUST_PAST', expiryDate: inDays(31), quantity: 5 },
    ],
  }, userId, db);

  assert.equal(statusOf(db, 'YESTERDAY'), 'EXPIRED');
  // Expiring today is not yet expired - the drug is still usable today.
  assert.equal(statusOf(db, 'TODAY'), 'EXPIRING_SOON');
  assert.equal(statusOf(db, 'ON_THRESHOLD'), 'EXPIRING_SOON');
  assert.equal(statusOf(db, 'JUST_PAST'), 'GOOD');
});

test('the JavaScript expiry helper agrees with the SQL view', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db);

  setSettings({ expiry_alert_days: '60' }, userId, db);

  const cases = [-40, -1, 0, 1, 59, 60, 61, 400];
  receiveStock({
    lines: cases.map((d, i) => ({
      drugId, batchNumber: `C${i}`, expiryDate: inDays(d), quantity: 3,
    })),
  }, userId, db);

  cases.forEach((offset, i) => {
    assert.equal(
      statusOf(db, `C${i}`),
      expiryStatus(inDays(offset), 60),
      `mismatch at ${offset} days (${daysUntil(inDays(offset))} computed)`
    );
  });
});

test('changing the threshold re-buckets everything at once', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db);

  receiveStock({
    lines: [{ drugId, batchNumber: 'D45', expiryDate: inDays(45), quantity: 10 }],
  }, userId, db);

  setSettings({ expiry_alert_days: '30' }, userId, db);
  assert.equal(statusOf(db, 'D45'), 'GOOD');
  assert.equal(getAlertSummary(db).expiring_soon, 0);

  setSettings({ expiry_alert_days: '60' }, userId, db);
  assert.equal(statusOf(db, 'D45'), 'EXPIRING_SOON');
  assert.equal(getAlertSummary(db).expiring_soon, 1);

  setSettings({ expiry_alert_days: '90' }, userId, db);
  assert.equal(getAlertSummary(db).expiring_soon, 1);
});

test('empty batches never raise alerts', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db, { min_stock_level: 0 });

  receiveStock({
    lines: [{ drugId, batchNumber: 'SOON', expiryDate: inDays(10), quantity: 12 }],
  }, userId, db);

  assert.equal(getExpiringSoonBatches({}, db).length, 1);

  dispenseStock({ lines: [{ drugId, quantity: 12 }] }, userId, db);

  assert.equal(getExpiringSoonBatches({}, db).length, 0, 'a used-up batch is not an alert');
  assert.equal(getExpiredBatches({}, db).length, 0);
});

test('low stock triggers exactly at the minimum level', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Cetirizine', min_stock_level: 50 });

  receiveStock({
    lines: [{ drugId, batchNumber: 'C1', expiryDate: inDays(300), quantity: 60 }],
  }, userId, db);

  const status = () =>
    db.prepare('SELECT stock_status FROM v_drug_stock WHERE drug_id = ?').get(drugId).stock_status;

  assert.equal(status(), 'OK');            // 60 > 50

  dispenseStock({ lines: [{ drugId, quantity: 9 }] }, userId, db);
  assert.equal(status(), 'OK');            // 51 > 50

  dispenseStock({ lines: [{ drugId, quantity: 1 }] }, userId, db);
  assert.equal(status(), 'LOW');           // 50 <= 50, the boundary

  dispenseStock({ lines: [{ drugId, quantity: 50 }] }, userId, db);
  assert.equal(status(), 'OUT_OF_STOCK');  // 0
});

test('a minimum level of zero never raises a low-stock alert while stock remains', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Untracked', min_stock_level: 0 });

  receiveStock({
    lines: [{ drugId, batchNumber: 'U1', expiryDate: inDays(300), quantity: 1 }],
  }, userId, db);

  assert.equal(getLowStockDrugs({}, db).length, 0);
});

test('a drug whose only stock is expired reads as out of stock and needs reordering', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Ceftriaxone', min_stock_level: 15 });

  receiveStock({
    lines: [{ drugId, batchNumber: 'OLD', expiryDate: inDays(-10), quantity: 20 }],
  }, userId, db);

  const row = db.prepare('SELECT * FROM v_drug_stock WHERE drug_id = ?').get(drugId);
  assert.equal(row.available_qty, 0, 'expired stock is not available stock');
  assert.equal(row.expired_qty, 20, 'but it is still reported, not hidden');
  assert.equal(row.total_qty, 20);
  assert.equal(row.stock_status, 'OUT_OF_STOCK');

  const lowStock = getLowStockDrugs({}, db);
  assert.equal(lowStock.length, 1);
  assert.equal(lowStock[0].suggested_order_qty, 30);
});

test('the alert summary counts match the detail lists', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);

  const a = makeDrug(db, { name: 'A', min_stock_level: 100 });
  const b = makeDrug(db, { name: 'B', min_stock_level: 0 });
  const c = makeDrug(db, { name: 'C', min_stock_level: 5 });

  setSettings({ expiry_alert_days: '90' }, userId, db);

  receiveStock({
    lines: [
      { drugId: a, batchNumber: 'A1', expiryDate: inDays(-5), quantity: 10 },
      { drugId: a, batchNumber: 'A2', expiryDate: inDays(20), quantity: 30 },
      { drugId: b, batchNumber: 'B1', expiryDate: inDays(500), quantity: 200 },
      { drugId: c, batchNumber: 'C1', expiryDate: inDays(60), quantity: 4 },
    ],
  }, userId, db);

  const summary = getAlertSummary(db);

  assert.equal(summary.total_drugs, 3);
  assert.equal(summary.expired, getExpiredBatches({}, db).length);
  assert.equal(summary.expiring_soon, getExpiringSoonBatches({}, db).length);
  assert.equal(summary.low_stock, getLowStockDrugs({}, db).length);
  assert.equal(summary.expired, 1);
  assert.equal(summary.expiring_soon, 2);   // A2 at 20 days, C1 at 60 days
  assert.equal(summary.low_stock, 2);       // A (30 <= 100) and C (4 <= 5)
  assert.equal(summary.expired_units, 10);
});
