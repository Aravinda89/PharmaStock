import { getDb } from '../db/connection.js';
import { applyStockMovement, nextDocumentNumber } from '../lib/stock.js';
import { badRequest, notFound } from '../lib/errors.js';

const LEDGER_TYPE = {
  EXPIRED_DISPOSAL: 'WRITE_OFF_EXPIRED',
  RETURN_TO_SUPPLIER: 'RETURN',
};

/**
 * A manual correction with a mandatory reason.
 *
 * This is how mistakes get fixed: a wrong receipt is never edited away, it is
 * offset by an adjustment, so the history still shows what actually happened.
 */
export function adjustStock({ batchId, quantityDelta, reason, notes }, userId, db = getDb()) {
  const delta = Number(quantityDelta);
  if (!Number.isInteger(delta) || delta === 0) {
    throw badRequest('Enter an adjustment quantity other than zero.');
  }

  const batch = db
    .prepare('SELECT id, drug_id, batch_number, expiry_date, quantity_on_hand FROM batches WHERE id = ?')
    .get(batchId);
  if (!batch) throw notFound('That batch was not found.');

  return db.transaction(() => {
    const adjustmentNo = nextDocumentNumber(db, 'stock_adjustments', 'adjustment_no', 'ADJ');

    const record = db
      .prepare(
        `INSERT INTO stock_adjustments
           (adjustment_no, drug_id, batch_id, quantity_delta, reason, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(adjustmentNo, batch.drug_id, batchId, delta, reason, notes ?? null, userId);

    const changeType = LEDGER_TYPE[reason] || (delta > 0 ? 'ADJUST_IN' : 'ADJUST_OUT');

    const movement = applyStockMovement(db, {
      batchId,
      delta,
      changeType,
      referenceTable: 'stock_adjustments',
      referenceId: record.lastInsertRowid,
      reason: notes ? `${reason}: ${notes}` : reason,
      userId,
      // Writing off expired stock is the one legitimate way it leaves the shelf.
      allowExpired: true,
    });

    return {
      id: record.lastInsertRowid,
      adjustmentNo,
      batchId,
      quantityDelta: delta,
      reason,
      previous: movement.previous,
      balanceAfter: movement.balanceAfter,
    };
  })();
}

/**
 * One-click disposal of everything already expired. Each batch still gets its
 * own adjustment record and ledger row, so the write-off is fully auditable.
 */
export function writeOffAllExpired({ notes }, userId, db = getDb()) {
  const expired = db
    .prepare(
      `SELECT vb.id, vb.quantity_on_hand, vb.batch_number, vb.expiry_date, d.name AS drug_name
       FROM v_batch_status vb
       JOIN drugs d ON d.id = vb.drug_id
       WHERE vb.expiry_status = 'EXPIRED' AND vb.quantity_on_hand > 0
       ORDER BY vb.expiry_date`
    )
    .all();

  if (expired.length === 0) {
    return { count: 0, totalQuantity: 0, items: [] };
  }

  return db.transaction(() => {
    const items = [];
    for (const batch of expired) {
      const result = adjustStock(
        {
          batchId: batch.id,
          quantityDelta: -batch.quantity_on_hand,
          reason: 'EXPIRED_DISPOSAL',
          notes: notes || `Expired on ${batch.expiry_date}`,
        },
        userId,
        db
      );
      items.push({
        drugName: batch.drug_name,
        batchNumber: batch.batch_number,
        expiryDate: batch.expiry_date,
        quantity: batch.quantity_on_hand,
        adjustmentNo: result.adjustmentNo,
      });
    }

    return {
      count: items.length,
      totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
      items,
    };
  })();
}

export function listAdjustments({ from = null, to = null, drugId = null, limit = 100, offset = 0 } = {}, db = getDb()) {
  const where = [];
  const params = {};

  if (from) { params.from = from; where.push('date(a.created_at) >= :from'); }
  if (to) { params.to = to; where.push('date(a.created_at) <= :to'); }
  if (drugId) { params.drugId = drugId; where.push('a.drug_id = :drugId'); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(
      `SELECT a.*, d.name AS drug_name, d.strength, d.unit,
              b.batch_number, b.expiry_date, u.full_name AS user_name
       FROM stock_adjustments a
       JOIN drugs d ON d.id = a.drug_id
       JOIN batches b ON b.id = a.batch_id
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });

  return { items, limit, offset };
}
