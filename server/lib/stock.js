import { AppError, badRequest, notFound } from './errors.js';
import { now } from './dates.js';

/**
 * The single choke point for every stock change in the system.
 *
 * Nothing anywhere else is allowed to UPDATE batches.quantity_on_hand. Because
 * every movement goes through here, the ledger is guaranteed to explain the
 * current quantity of every batch:
 *
 *   Current = Opening + Received - Dispensed - Adjustments
 *
 * Callers must already be inside a transaction (see withTransaction) so that a
 * multi-line receipt or dispense either lands completely or not at all.
 */
export function applyStockMovement(db, {
  batchId,
  delta,
  changeType,
  referenceTable = null,
  referenceId = null,
  reason = null,
  userId = null,
  occurredAt = null,
  allowExpired = false,
}) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw badRequest('Stock movement quantity must be a whole number other than zero.');
  }

  const batch = db
    .prepare(
      `SELECT b.id, b.drug_id, b.batch_number, b.expiry_date, b.quantity_on_hand,
              d.name AS drug_name, d.unit,
              CAST(julianday(b.expiry_date) - julianday(date('now','localtime')) AS INTEGER)
                AS days_to_expiry
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       WHERE b.id = ?`
    )
    .get(batchId);

  if (!batch) throw notFound('That batch no longer exists.');

  // Taking stock out of an expired batch is blocked unless it is an explicit
  // write-off, which is the only legitimate way expired stock should leave.
  if (delta < 0 && batch.days_to_expiry < 0 && !allowExpired) {
    throw badRequest(
      `${batch.drug_name} batch ${batch.batch_number || '(no batch no.)'} expired on ` +
        `${batch.expiry_date} and cannot be dispensed. Use a stock adjustment to write it off.`
    );
  }

  const balanceAfter = batch.quantity_on_hand + delta;

  if (balanceAfter < 0) {
    throw badRequest(
      `Not enough stock. ${batch.drug_name} batch ` +
        `${batch.batch_number || '(no batch no.)'} has ${batch.quantity_on_hand} ` +
        `${batch.unit}${batch.quantity_on_hand === 1 ? '' : 's'} available, ` +
        `but ${Math.abs(delta)} were requested.`,
      { available: batch.quantity_on_hand, requested: Math.abs(delta) }
    );
  }

  db.prepare(
    `UPDATE batches
     SET quantity_on_hand = ?,
         quantity_received = quantity_received + ?,
         updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(balanceAfter, delta > 0 ? delta : 0, batchId);

  db.prepare(
    `INSERT INTO stock_ledger
       (occurred_at, drug_id, batch_id, change_type, quantity_delta, balance_after,
        reference_table, reference_id, reason, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    occurredAt || now(),
    batch.drug_id,
    batchId,
    changeType,
    delta,
    balanceAfter,
    referenceTable,
    referenceId,
    reason,
    userId
  );

  return { batchId, drugId: batch.drug_id, previous: batch.quantity_on_hand, balanceAfter };
}

/**
 * First-Expiry-First-Out allocation.
 *
 * Returns the batches to draw from, earliest usable expiry first, splitting
 * across batches when one cannot cover the request. Expired batches are never
 * selected. This only plans the allocation - nothing is written.
 */
export function allocateFefo(db, drugId, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest('Quantity to dispense must be a whole number greater than zero.');
  }

  const batches = db
    .prepare(
      `SELECT id, batch_number, expiry_date, quantity_on_hand
       FROM v_batch_status
       WHERE drug_id = ? AND quantity_on_hand > 0 AND expiry_status <> 'EXPIRED'
       ORDER BY expiry_date ASC, id ASC`
    )
    .all(drugId);

  const totalAvailable = batches.reduce((sum, b) => sum + b.quantity_on_hand, 0);

  if (totalAvailable < quantity) {
    const drug = db.prepare('SELECT name, unit FROM drugs WHERE id = ?').get(drugId);
    const label = drug ? drug.name : 'This drug';
    throw new AppError(
      `Not enough stock of ${label}. Only ${totalAvailable} available (${quantity} requested).`,
      400,
      { available: totalAvailable, requested: quantity }
    );
  }

  const allocation = [];
  let remaining = quantity;

  for (const batch of batches) {
    if (remaining === 0) break;
    const take = Math.min(remaining, batch.quantity_on_hand);
    allocation.push({
      batchId: batch.id,
      batchNumber: batch.batch_number,
      expiryDate: batch.expiry_date,
      quantity: take,
      availableBefore: batch.quantity_on_hand,
    });
    remaining -= take;
  }

  return allocation;
}

/**
 * Find the batch for a delivery, or create it.
 *
 * Same drug + same batch number + same expiry is the same physical stock, so a
 * repeat delivery tops up the existing row. A different expiry date always
 * creates a separate batch, which is what keeps expiry tracking accurate.
 */
export function findOrCreateBatch(db, { drugId, batchNumber, expiryDate, supplierId, unitCost, storageLocation }) {
  const normalisedBatch = (batchNumber || '').trim();

  const existing = db
    .prepare('SELECT * FROM batches WHERE drug_id = ? AND batch_number = ? AND expiry_date = ?')
    .get(drugId, normalisedBatch, expiryDate);

  if (existing) {
    // Refresh the commercial details from the latest delivery; quantity is
    // never touched here - only applyStockMovement may change it.
    db.prepare(
      `UPDATE batches
       SET supplier_id      = COALESCE(?, supplier_id),
           unit_cost        = COALESCE(?, unit_cost),
           storage_location = COALESCE(?, storage_location),
           updated_at       = datetime('now','localtime')
       WHERE id = ?`
    ).run(supplierId ?? null, unitCost ?? null, storageLocation ?? null, existing.id);
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO batches
         (drug_id, batch_number, expiry_date, supplier_id, quantity_received,
          quantity_on_hand, unit_cost, storage_location, first_received_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, datetime('now','localtime'))`
    )
    .run(drugId, normalisedBatch, expiryDate, supplierId ?? null, unitCost ?? null, storageLocation ?? null);

  return result.lastInsertRowid;
}

/**
 * Reconciliation: does every batch quantity match the sum of its ledger?
 * Zero rows means the books are healthy. Surfaced in Settings and asserted in
 * the test suite.
 */
export function findStockDiscrepancies(db) {
  return db
    .prepare(
      `SELECT b.id AS batch_id, d.name AS drug_name, b.batch_number, b.expiry_date,
              b.quantity_on_hand,
              COALESCE((SELECT SUM(quantity_delta) FROM stock_ledger WHERE batch_id = b.id), 0)
                AS ledger_balance
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       WHERE b.quantity_on_hand <>
             COALESCE((SELECT SUM(quantity_delta) FROM stock_ledger WHERE batch_id = b.id), 0)`
    )
    .all();
}

/** Run `fn` in a transaction; any throw rolls the whole thing back. */
export function withTransaction(db, fn) {
  return db.transaction(fn)();
}

/** Sequential document numbers: GRN-2026-0001, DSP-2026-0007, ADJ-2026-0002. */
export function nextDocumentNumber(db, table, column, prefix) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db
    .prepare(
      `SELECT MAX(CAST(substr(${column}, ?) AS INTEGER)) AS max_seq
       FROM ${table} WHERE ${column} LIKE ?`
    )
    .get(`${prefix}-${year}-`.length + 1, like);

  const next = (row?.max_seq || 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
