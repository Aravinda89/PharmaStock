import { getDb } from '../db/connection.js';
import { applyStockMovement, allocateFefo, nextDocumentNumber } from '../lib/stock.js';
import { badRequest, notFound } from '../lib/errors.js';
import { now } from '../lib/dates.js';

/**
 * Plan a dispense without writing anything.
 *
 * The Dispense screen calls this as the user types so it can show
 * "Current 100 -> New 90" and which batches will be used, and so an impossible
 * quantity is refused before the user commits to it rather than after.
 */
export function previewDispense(lines, db = getDb()) {
  const preview = [];

  // Two lines for the same drug draw from one pool, so they must be considered
  // together - otherwise each line would separately "see" the full stock.
  const totals = new Map();
  for (const line of lines) {
    totals.set(line.drugId, (totals.get(line.drugId) || 0) + Number(line.quantity));
  }

  for (const [drugId, quantity] of totals) {
    const drug = db
      .prepare('SELECT d.name, d.strength, d.unit, s.available_qty FROM drugs d JOIN v_drug_stock s ON s.drug_id = d.id WHERE d.id = ?')
      .get(drugId);

    if (!drug) throw notFound('One of the selected drugs no longer exists.');

    if (drug.available_qty < quantity) {
      preview.push({
        drugId,
        drugName: drug.name,
        strength: drug.strength,
        unit: drug.unit,
        requested: quantity,
        available: drug.available_qty,
        ok: false,
        message: `Only ${drug.available_qty} available, ${quantity} requested.`,
        allocation: [],
      });
      continue;
    }

    const allocation = allocateFefo(db, drugId, quantity);
    preview.push({
      drugId,
      drugName: drug.name,
      strength: drug.strength,
      unit: drug.unit,
      requested: quantity,
      available: drug.available_qty,
      availableAfter: drug.available_qty - quantity,
      ok: true,
      allocation,
    });
  }

  return { lines: preview, ok: preview.every((l) => l.ok) };
}

/**
 * Record a dispense and decrease stock.
 *
 * Each line either carries an explicit batch allocation (the pharmacist used
 * "Change batches") or is auto-allocated FEFO. The whole dispense is one
 * transaction, so a failure on the third drug leaves the first two untouched.
 */
export function dispenseStock({ patientRef, patientName, prescriber, notes, dispensedAt, lines }, userId, db = getDb()) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('Add at least one drug to dispense.');
  }

  return db.transaction(() => {
    const dispenseNo = nextDocumentNumber(db, 'dispenses', 'dispense_no', 'DSP');
    const at = dispensedAt || now();

    const dispense = db
      .prepare(
        `INSERT INTO dispenses
           (dispense_no, dispensed_at, patient_ref, patient_name, prescriber, notes,
            dispensed_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(dispenseNo, at, patientRef ?? null, patientName ?? null, prescriber ?? null, notes ?? null, userId);

    const dispenseId = dispense.lastInsertRowid;
    const results = [];

    for (const line of lines) {
      const drug = db
        .prepare('SELECT id, name, strength, unit FROM drugs WHERE id = ?')
        .get(line.drugId);
      if (!drug) throw notFound('One of the selected drugs no longer exists.');

      const before = db
        .prepare('SELECT available_qty FROM v_drug_stock WHERE drug_id = ?')
        .get(line.drugId).available_qty;

      // Manual override from the UI, otherwise first-expiry-first-out.
      const allocation =
        Array.isArray(line.allocation) && line.allocation.length > 0
          ? line.allocation.map((a) => ({ batchId: a.batchId, quantity: Number(a.quantity) }))
          : allocateFefo(db, line.drugId, Number(line.quantity));

      const allocatedTotal = allocation.reduce((sum, a) => sum + a.quantity, 0);
      if (allocatedTotal !== Number(line.quantity)) {
        throw badRequest(
          `Batch selection for ${drug.name} adds up to ${allocatedTotal}, ` +
            `but ${line.quantity} was requested.`
        );
      }

      const usedBatches = [];
      for (const alloc of allocation) {
        // A manually chosen batch must still belong to this drug - otherwise a
        // stale screen could quietly take stock from the wrong product.
        const batch = db
          .prepare('SELECT id, drug_id, batch_number, expiry_date FROM batches WHERE id = ?')
          .get(alloc.batchId);
        if (!batch || batch.drug_id !== line.drugId) {
          throw badRequest(`Selected batch does not belong to ${drug.name}.`);
        }

        applyStockMovement(db, {
          batchId: alloc.batchId,
          delta: -alloc.quantity,
          changeType: 'DISPENSE',
          referenceTable: 'dispenses',
          referenceId: dispenseId,
          reason: patientRef ? `Dispensed to ${patientRef}` : `Dispensed on ${dispenseNo}`,
          userId,
          occurredAt: at,
        });

        db.prepare(
          'INSERT INTO dispense_lines (dispense_id, drug_id, batch_id, quantity) VALUES (?, ?, ?, ?)'
        ).run(dispenseId, line.drugId, alloc.batchId, alloc.quantity);

        usedBatches.push({
          batchId: batch.id,
          batchNumber: batch.batch_number,
          expiryDate: batch.expiry_date,
          quantity: alloc.quantity,
        });
      }

      const after = db
        .prepare('SELECT available_qty FROM v_drug_stock WHERE drug_id = ?')
        .get(line.drugId).available_qty;

      results.push({
        drugId: line.drugId,
        drugName: drug.name,
        strength: drug.strength,
        unit: drug.unit,
        quantity: Number(line.quantity),
        stockBefore: before,
        stockAfter: after,
        batches: usedBatches,
      });
    }

    return { id: dispenseId, dispenseNo, dispensedAt: at, lines: results };
  })();
}

export function listDispenses({ from = null, to = null, drugId = null, patientRef = null, userId = null, limit = 100, offset = 0 } = {}, db = getDb()) {
  const where = [];
  const params = {};

  if (from) { params.from = from; where.push("date(d.dispensed_at) >= :from"); }
  if (to) { params.to = to; where.push("date(d.dispensed_at) <= :to"); }
  if (patientRef) { params.patientRef = `%${patientRef}%`; where.push('d.patient_ref LIKE :patientRef'); }
  if (userId) { params.userId = userId; where.push('d.dispensed_by_user_id = :userId'); }
  if (drugId) {
    params.drugId = drugId;
    where.push('EXISTS (SELECT 1 FROM dispense_lines l WHERE l.dispense_id = d.id AND l.drug_id = :drugId)');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(
      `SELECT d.*, u.full_name AS dispensed_by,
              (SELECT SUM(l.quantity) FROM dispense_lines l WHERE l.dispense_id = d.id) AS total_quantity,
              (SELECT COUNT(DISTINCT l.drug_id) FROM dispense_lines l WHERE l.dispense_id = d.id) AS drug_count
       FROM dispenses d
       LEFT JOIN users u ON u.id = d.dispensed_by_user_id
       ${whereSql}
       ORDER BY d.dispensed_at DESC, d.id DESC
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });

  return { items, limit, offset };
}

export function getDispense(id, db = getDb()) {
  const dispense = db
    .prepare(
      `SELECT d.*, u.full_name AS dispensed_by
       FROM dispenses d
       LEFT JOIN users u ON u.id = d.dispensed_by_user_id
       WHERE d.id = ?`
    )
    .get(id);

  if (!dispense) throw notFound('That dispensing record was not found.');

  dispense.lines = db
    .prepare(
      `SELECT l.*, dr.name AS drug_name, dr.strength, dr.form, dr.unit,
              b.batch_number, b.expiry_date
       FROM dispense_lines l
       JOIN drugs dr ON dr.id = l.drug_id
       JOIN batches b ON b.id = l.batch_id
       WHERE l.dispense_id = ?
       ORDER BY l.id`
    )
    .all(id);

  return dispense;
}
