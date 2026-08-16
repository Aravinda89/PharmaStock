import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, makeUser, makeDrug, inDays, availableOf, onHandOf } from './helpers.js';
import { receiveStock } from '../services/receiving.js';
import { dispenseStock } from '../services/dispensing.js';
import { adjustStock, writeOffAllExpired } from '../services/adjustments.js';
import { findStockDiscrepancies } from '../lib/stock.js';

test('receive 100 then dispense 10 leaves 90 - the requirement worked example', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Paracetamol' });

  receiveStock({
    lines: [{ drugId, batchNumber: 'B001', expiryDate: inDays(365), quantity: 100 }],
  }, userId, db);

  assert.equal(availableOf(db, drugId), 100);

  const result = dispenseStock({
    patientRef: 'OP-1',
    lines: [{ drugId, quantity: 10 }],
  }, userId, db);

  assert.equal(availableOf(db, drugId), 90);
  assert.equal(result.lines[0].stockBefore, 100);
  assert.equal(result.lines[0].stockAfter, 90);
});

test('dispensing more than is available is refused and changes nothing', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Amoxicillin' });

  receiveStock({
    lines: [{ drugId, batchNumber: 'B1', expiryDate: inDays(200), quantity: 90 }],
  }, userId, db);

  assert.throws(
    () => dispenseStock({ lines: [{ drugId, quantity: 200 }] }, userId, db),
    /Only 90 available/
  );

  // The whole transaction rolled back: stock intact, no ledger row, no header.
  assert.equal(availableOf(db, drugId), 90);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM stock_ledger WHERE change_type = 'DISPENSE'").get().n,
    0
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dispenses').get().n, 0);
});

test('a multi-line dispense is all-or-nothing', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const ok = makeDrug(db, { name: 'Ibuprofen' });
  const short = makeDrug(db, { name: 'Cetirizine' });

  receiveStock({
    lines: [
      { drugId: ok, batchNumber: 'X1', expiryDate: inDays(300), quantity: 100 },
      { drugId: short, batchNumber: 'Y1', expiryDate: inDays(300), quantity: 5 },
    ],
  }, userId, db);

  assert.throws(
    () => dispenseStock({
      lines: [{ drugId: ok, quantity: 10 }, { drugId: short, quantity: 50 }],
    }, userId, db),
    /Only 5 available/
  );

  // The first line must not have been left applied.
  assert.equal(availableOf(db, ok), 100);
  assert.equal(availableOf(db, short), 5);
});

test('two lines of the same drug are checked against one shared pool', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Metformin' });

  receiveStock({
    lines: [{ drugId, batchNumber: 'M1', expiryDate: inDays(300), quantity: 30 }],
  }, userId, db);

  // 20 + 20 = 40 against 30 in stock: the second line must fail.
  assert.throws(
    () => dispenseStock({
      lines: [{ drugId, quantity: 20 }, { drugId, quantity: 20 }],
    }, userId, db),
    /Not enough stock|Only/
  );

  assert.equal(availableOf(db, drugId), 30);
});

test('stock adjustments move stock and are recorded with a reason', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Omeprazole' });

  const receipt = receiveStock({
    lines: [{ drugId, batchNumber: 'O1', expiryDate: inDays(300), quantity: 50 }],
  }, userId, db);

  const batchId = db.prepare('SELECT batch_id FROM goods_receipt_lines WHERE goods_receipt_id = ?')
    .get(receipt.id).batch_id;

  adjustStock({ batchId, quantityDelta: -8, reason: 'DAMAGE', notes: 'Crushed in transit' }, userId, db);
  assert.equal(availableOf(db, drugId), 42);

  adjustStock({ batchId, quantityDelta: 3, reason: 'COUNT_CORRECTION', notes: 'Recount' }, userId, db);
  assert.equal(availableOf(db, drugId), 45);

  const types = db.prepare('SELECT change_type FROM stock_ledger ORDER BY id').all().map((r) => r.change_type);
  assert.deepEqual(types, ['RECEIVE', 'ADJUST_OUT', 'ADJUST_IN']);
});

test('an adjustment cannot push a batch below zero', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db);

  const receipt = receiveStock({
    lines: [{ drugId, batchNumber: 'Z1', expiryDate: inDays(100), quantity: 10 }],
  }, userId, db);
  const batchId = db.prepare('SELECT batch_id FROM goods_receipt_lines WHERE goods_receipt_id = ?')
    .get(receipt.id).batch_id;

  assert.throws(
    () => adjustStock({ batchId, quantityDelta: -25, reason: 'LOST' }, userId, db),
    /Not enough stock/
  );
  assert.equal(onHandOf(db, batchId), 10);
});

test('the ledger always reconciles to the batch quantities', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugs = [
    makeDrug(db, { name: 'Drug A' }),
    makeDrug(db, { name: 'Drug B' }),
    makeDrug(db, { name: 'Drug C' }),
  ];

  // A deliberately messy sequence of receipts, dispenses and adjustments.
  for (let round = 0; round < 6; round += 1) {
    receiveStock({
      lines: drugs.map((drugId, i) => ({
        drugId,
        batchNumber: `R${round}-${i}`,
        expiryDate: inDays(120 + round * 30 + i),
        quantity: 40 + round * 5,
      })),
    }, userId, db);

    dispenseStock({
      patientRef: `OP-${round}`,
      lines: drugs.map((drugId) => ({ drugId, quantity: 7 + round })),
    }, userId, db);
  }

  const batches = db.prepare('SELECT id FROM batches WHERE quantity_on_hand > 3').all();
  for (const batch of batches.slice(0, 5)) {
    adjustStock({ batchId: batch.id, quantityDelta: -3, reason: 'DAMAGE' }, userId, db);
  }

  assert.deepEqual(findStockDiscrepancies(db), []);

  // And the headline invariant, stated directly.
  for (const drugId of drugs) {
    const ledgerTotal = db
      .prepare('SELECT COALESCE(SUM(quantity_delta), 0) AS n FROM stock_ledger WHERE drug_id = ?')
      .get(drugId).n;
    const actual = db
      .prepare('SELECT COALESCE(SUM(quantity_on_hand), 0) AS n FROM batches WHERE drug_id = ?')
      .get(drugId).n;
    assert.equal(actual, ledgerTotal, 'received - dispensed - adjusted must equal current stock');
  }
});

test('writing off all expired stock clears it and records every batch', (t) => {
  const db = makeTestDb();
  t.after(() => db.cleanup());

  const userId = makeUser(db);
  const drugId = makeDrug(db, { name: 'Ceftriaxone' });

  receiveStock({
    lines: [
      { drugId, batchNumber: 'OLD1', expiryDate: inDays(-30), quantity: 20 },
      { drugId, batchNumber: 'OLD2', expiryDate: inDays(-5), quantity: 6 },
      { drugId, batchNumber: 'GOOD', expiryDate: inDays(200), quantity: 50 },
    ],
  }, userId, db);

  assert.equal(availableOf(db, drugId), 50); // expired never counted as available

  const result = writeOffAllExpired({ notes: 'Quarterly disposal' }, userId, db);

  assert.equal(result.count, 2);
  assert.equal(result.totalQuantity, 26);
  assert.equal(availableOf(db, drugId), 50);
  assert.equal(
    db.prepare('SELECT COALESCE(SUM(quantity_on_hand),0) AS n FROM batches WHERE drug_id = ?').get(drugId).n,
    50
  );
  assert.deepEqual(findStockDiscrepancies(db), []);
});
