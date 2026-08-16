import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, makeUser, makeDrug, inDays, availableOf, onHandOf } from './helpers.js';
import { receiveStock } from '../services/receiving.js';
import { dispenseStock, previewDispense } from '../services/dispensing.js';
import { allocateFefo } from '../lib/stock.js';

function seedThreeBatches(db, userId) {
  const drugId = makeDrug(db, { name: 'Amoxicillin' });
  receiveStock({
    lines: [
      // Deliberately received out of expiry order so FEFO cannot pass by luck.
      { drugId, batchNumber: 'LATE', expiryDate: inDays(400), quantity: 40 },
      { drugId, batchNumber: 'EARLY', expiryDate: inDays(30), quantity: 20 },
      { drugId, batchNumber: 'MID', expiryDate: inDays(180), quantity: 60 },
    ],
  }, userId, db);
  return drugId;
}

test('FEFO takes the earliest-expiring batch first', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);

  const allocation = allocateFefo(db, drugId, 15);

  assert.equal(allocation.length, 1);
  assert.equal(allocation[0].batchNumber, 'EARLY');
  assert.equal(allocation[0].quantity, 15);
});

test('FEFO splits across batches in expiry order when one cannot cover it', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);

  // 20 (EARLY) + 60 (MID) + 10 (LATE)
  const allocation = allocateFefo(db, drugId, 90);

  assert.deepEqual(
    allocation.map((a) => [a.batchNumber, a.quantity]),
    [['EARLY', 20], ['MID', 60], ['LATE', 10]]
  );
});

test('FEFO never selects an expired batch', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Ibuprofen' });

  receiveStock({
    lines: [
      { drugId, batchNumber: 'EXPIRED', expiryDate: inDays(-1), quantity: 500 },
      { drugId, batchNumber: 'USABLE', expiryDate: inDays(90), quantity: 25 },
    ],
  }, userId, db);

  const allocation = allocateFefo(db, drugId, 25);
  assert.equal(allocation.length, 1);
  assert.equal(allocation[0].batchNumber, 'USABLE');

  // The 500 expired units must not make the drug look available.
  assert.equal(availableOf(db, drugId), 25);
  assert.throws(() => allocateFefo(db, drugId, 26), /Only 25 available/);
});

test('dispensing writes one ledger row per batch used', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);

  const result = dispenseStock({
    patientRef: 'OP-77',
    lines: [{ drugId, quantity: 70 }],
  }, userId, db);

  assert.deepEqual(
    result.lines[0].batches.map((b) => [b.batchNumber, b.quantity]),
    [['EARLY', 20], ['MID', 50]]
  );

  const rows = db.prepare(
    "SELECT batch_id, quantity_delta FROM stock_ledger WHERE change_type = 'DISPENSE' ORDER BY id"
  ).all();
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, r) => s + r.quantity_delta, 0), -70);
  assert.equal(availableOf(db, drugId), 50);
});

test('a manual batch override is honoured instead of FEFO', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);

  const lateBatch = db.prepare("SELECT id FROM batches WHERE batch_number = 'LATE'").get().id;
  const earlyBatch = db.prepare("SELECT id FROM batches WHERE batch_number = 'EARLY'").get().id;

  dispenseStock({
    patientRef: 'OP-88',
    lines: [{ drugId, quantity: 10, allocation: [{ batchId: lateBatch, quantity: 10 }] }],
  }, userId, db);

  assert.equal(onHandOf(db, lateBatch), 30);
  assert.equal(onHandOf(db, earlyBatch), 20, 'the earliest batch must be untouched');
});

test('a manual allocation that does not add up to the line quantity is rejected', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);
  const midBatch = db.prepare("SELECT id FROM batches WHERE batch_number = 'MID'").get().id;

  assert.throws(
    () => dispenseStock({
      lines: [{ drugId, quantity: 30, allocation: [{ batchId: midBatch, quantity: 25 }] }],
    }, userId, db),
    /adds up to 25, but 30 was requested/
  );
});

test('a batch belonging to a different drug is rejected', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugA = seedThreeBatches(db, userId);
  const drugB = makeDrug(db, { name: 'Other Drug' });

  receiveStock({
    lines: [{ drugId: drugB, batchNumber: 'OTHER', expiryDate: inDays(300), quantity: 10 }],
  }, userId, db);

  const foreignBatch = db.prepare("SELECT id FROM batches WHERE batch_number = 'OTHER'").get().id;

  assert.throws(
    () => dispenseStock({
      lines: [{ drugId: drugA, quantity: 5, allocation: [{ batchId: foreignBatch, quantity: 5 }] }],
    }, userId, db),
    /does not belong to/
  );
});

test('preview reports the shortfall without writing anything', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = seedThreeBatches(db, userId);

  const good = previewDispense([{ drugId, quantity: 30 }], db);
  assert.equal(good.ok, true);
  assert.equal(good.lines[0].available, 120);
  assert.equal(good.lines[0].availableAfter, 90);

  const bad = previewDispense([{ drugId, quantity: 500 }], db);
  assert.equal(bad.ok, false);
  assert.match(bad.lines[0].message, /Only 120 available/);

  // Nothing was written by either preview.
  assert.equal(availableOf(db, drugId), 120);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_ledger').get().n, 3);
});

test('a repeat delivery of the same batch tops up rather than duplicating', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db);

  receiveStock({ lines: [{ drugId, batchNumber: 'SAME', expiryDate: inDays(200), quantity: 50 }] }, userId, db);
  receiveStock({ lines: [{ drugId, batchNumber: 'SAME', expiryDate: inDays(200), quantity: 30 }] }, userId, db);

  const batches = db.prepare('SELECT * FROM batches WHERE drug_id = ?').all(drugId);
  assert.equal(batches.length, 1, 'same drug + batch + expiry is one physical batch');
  assert.equal(batches[0].quantity_on_hand, 80);
  assert.equal(availableOf(db, drugId), 80);
});

test('the same batch number with a different expiry is kept separate', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());
  const userId = makeUser(db);
  const drugId = makeDrug(db);

  receiveStock({ lines: [{ drugId, batchNumber: 'B7', expiryDate: inDays(100), quantity: 10 }] }, userId, db);
  receiveStock({ lines: [{ drugId, batchNumber: 'B7', expiryDate: inDays(400), quantity: 10 }] }, userId, db);

  const batches = db.prepare('SELECT * FROM batches WHERE drug_id = ? ORDER BY expiry_date').all(drugId);
  assert.equal(batches.length, 2, 'a different expiry date must never be merged away');

  // And FEFO still uses the nearer expiry first.
  const allocation = allocateFefo(db, drugId, 10);
  assert.equal(allocation[0].batchId, batches[0].id);
});
