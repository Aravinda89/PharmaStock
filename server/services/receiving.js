import { getDb } from '../db/connection.js';
import { applyStockMovement, findOrCreateBatch, nextDocumentNumber } from '../lib/stock.js';
import { badRequest, notFound } from '../lib/errors.js';
import { today } from '../lib/dates.js';

/**
 * Record a delivery.
 *
 * The whole receipt is one transaction: either every line lands and stock goes
 * up, or nothing is written at all. There is no half-received shipment.
 */
export function receiveStock({ supplierId, invoiceNo, orderRef, receivedDate, notes, lines }, userId, db = getDb()) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('Add at least one drug to the delivery.');
  }

  return db.transaction(() => {
    const receiptNo = nextDocumentNumber(db, 'goods_receipts', 'receipt_no', 'GRN');
    const date = receivedDate || today();

    const totalCost = lines.reduce(
      (sum, l) => sum + (Number(l.unitCost) || 0) * Number(l.quantity),
      0
    );

    const receipt = db
      .prepare(
        `INSERT INTO goods_receipts
           (receipt_no, supplier_id, invoice_no, order_ref, received_date,
            received_by_user_id, notes, total_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(receiptNo, supplierId ?? null, invoiceNo ?? null, orderRef ?? null, date, userId, notes ?? null, totalCost);

    const receiptId = receipt.lastInsertRowid;
    const results = [];

    for (const line of lines) {
      const drug = db
        .prepare('SELECT id, name, unit, strength FROM drugs WHERE id = ? AND is_active = 1')
        .get(line.drugId);
      if (!drug) throw notFound(`Drug not found (or inactive) for one of the delivery lines.`);

      const batchId = findOrCreateBatch(db, {
        drugId: line.drugId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        supplierId: supplierId ?? null,
        unitCost: line.unitCost ?? null,
        storageLocation: line.storageLocation ?? null,
      });

      const movement = applyStockMovement(db, {
        batchId,
        delta: Number(line.quantity),
        changeType: 'RECEIVE',
        referenceTable: 'goods_receipts',
        referenceId: receiptId,
        reason: `Received on ${receiptNo}`,
        userId,
        occurredAt: `${date} 00:00:00`,
      });

      db.prepare(
        `INSERT INTO goods_receipt_lines
           (goods_receipt_id, drug_id, batch_id, batch_number, expiry_date, quantity, unit_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        receiptId,
        line.drugId,
        batchId,
        (line.batchNumber || '').trim(),
        line.expiryDate,
        Number(line.quantity),
        line.unitCost ?? null
      );

      // Fed back to the UI so the confirmation can say "80 -> 180", which is
      // the reassurance a non-technical user needs after saving.
      const drugTotal = db
        .prepare('SELECT available_qty FROM v_drug_stock WHERE drug_id = ?')
        .get(line.drugId);

      results.push({
        drugId: line.drugId,
        drugName: drug.name,
        strength: drug.strength,
        unit: drug.unit,
        batchNumber: (line.batchNumber || '').trim(),
        expiryDate: line.expiryDate,
        quantity: Number(line.quantity),
        batchPrevious: movement.previous,
        batchNow: movement.balanceAfter,
        drugAvailableNow: drugTotal?.available_qty ?? 0,
      });
    }

    return { id: receiptId, receiptNo, receivedDate: date, totalCost, lines: results };
  })();
}

export function listReceipts({ from = null, to = null, supplierId = null, drugId = null, limit = 100, offset = 0 } = {}, db = getDb()) {
  const where = [];
  const params = {};

  if (from) { params.from = from; where.push('r.received_date >= :from'); }
  if (to) { params.to = to; where.push('r.received_date <= :to'); }
  if (supplierId) { params.supplierId = supplierId; where.push('r.supplier_id = :supplierId'); }
  if (drugId) {
    params.drugId = drugId;
    where.push('EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.goods_receipt_id = r.id AND l.drug_id = :drugId)');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(
      `SELECT r.*, s.name AS supplier_name, u.full_name AS received_by,
              (SELECT COUNT(*) FROM goods_receipt_lines l WHERE l.goods_receipt_id = r.id) AS line_count,
              (SELECT SUM(l.quantity) FROM goods_receipt_lines l WHERE l.goods_receipt_id = r.id) AS total_quantity
       FROM goods_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN users u ON u.id = r.received_by_user_id
       ${whereSql}
       ORDER BY r.received_date DESC, r.id DESC
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });

  return { items, limit, offset };
}

export function getReceipt(id, db = getDb()) {
  const receipt = db
    .prepare(
      `SELECT r.*, s.name AS supplier_name, u.full_name AS received_by
       FROM goods_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN users u ON u.id = r.received_by_user_id
       WHERE r.id = ?`
    )
    .get(id);

  if (!receipt) throw notFound('That delivery record was not found.');

  receipt.lines = db
    .prepare(
      `SELECT l.*, d.name AS drug_name, d.strength, d.form, d.unit
       FROM goods_receipt_lines l
       JOIN drugs d ON d.id = l.drug_id
       WHERE l.goods_receipt_id = ?
       ORDER BY l.id`
    )
    .all(id);

  return receipt;
}
