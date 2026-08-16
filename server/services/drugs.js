import { getDb } from '../db/connection.js';
import { notFound, badRequest } from '../lib/errors.js';

/**
 * Inventory search - the query behind "Do we have this drug? How many? When
 * does it expire? Do we need to order more?".
 *
 * Free-text `search` deliberately covers batch numbers too, so a pharmacist
 * holding a box can type what is printed on it and find the drug.
 */
export function listDrugs({
  search = '',
  form = '',
  supplierId = null,
  stockStatus = '',
  expiryStatus = '',
  includeInactive = false,
  expiringWithinDays = null,
  sort = 'name',
  limit = 500,
  offset = 0,
} = {}, db = getDb()) {
  const where = [];
  const params = {};

  if (!includeInactive) where.push('s.is_active = 1');

  if (search.trim()) {
    params.search = `%${search.trim()}%`;
    where.push(`(
      s.name LIKE :search
      OR s.generic_name LIKE :search
      OR s.code LIKE :search
      OR EXISTS (SELECT 1 FROM batches b
                 WHERE b.drug_id = s.drug_id AND b.batch_number LIKE :search)
    )`);
  }

  if (form) {
    params.form = form;
    where.push('s.form = :form');
  }

  if (supplierId) {
    params.supplierId = supplierId;
    where.push(`(s.default_supplier_id = :supplierId
                 OR EXISTS (SELECT 1 FROM batches b
                            WHERE b.drug_id = s.drug_id
                              AND b.supplier_id = :supplierId
                              AND b.quantity_on_hand > 0))`);
  }

  if (stockStatus) {
    params.stockStatus = stockStatus;
    where.push('s.stock_status = :stockStatus');
  }

  if (expiryStatus) {
    params.expiryStatus = expiryStatus;
    where.push('s.expiry_status = :expiryStatus');
  }

  if (expiringWithinDays != null) {
    params.expiringWithinDays = expiringWithinDays;
    where.push(`EXISTS (SELECT 1 FROM v_batch_status vb
                        WHERE vb.drug_id = s.drug_id
                          AND vb.quantity_on_hand > 0
                          AND vb.days_to_expiry >= 0
                          AND vb.days_to_expiry <= :expiringWithinDays)`);
  }

  const sortSql = {
    name: 's.name ASC',
    stock_asc: 's.available_qty ASC, s.name ASC',
    stock_desc: 's.available_qty DESC, s.name ASC',
    expiry: "COALESCE(s.earliest_expiry, '9999-12-31') ASC, s.name ASC",
    // Most urgent first: expired, then expiring soon, then low stock.
    urgency: `CASE s.expiry_status WHEN 'EXPIRED' THEN 0 WHEN 'EXPIRING_SOON' THEN 1 ELSE 2 END,
              CASE s.stock_status WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'LOW' THEN 1 ELSE 2 END,
              s.name ASC`,
  }[sort] || 's.name ASC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT s.*, sup.name AS supplier_name
       FROM v_drug_stock s
       LEFT JOIN suppliers sup ON sup.id = s.default_supplier_id
       ${whereSql}
       ORDER BY ${sortSql}
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM v_drug_stock s ${whereSql}`);
  const total = (Object.keys(params).length ? countStmt.get(params) : countStmt.get()).n;

  return { items: rows, total, limit, offset };
}

export function getDrug(id, db = getDb()) {
  const drug = db
    .prepare(
      `SELECT s.*, sup.name AS supplier_name, d.notes, d.created_at, d.updated_at
       FROM v_drug_stock s
       JOIN drugs d ON d.id = s.drug_id
       LEFT JOIN suppliers sup ON sup.id = s.default_supplier_id
       WHERE s.drug_id = ?`
    )
    .get(id);

  if (!drug) throw notFound('That drug was not found.');
  return drug;
}

/** Batches for a drug, earliest expiry first - the order they should be used. */
export function getDrugBatches(drugId, { includeEmpty = false } = {}, db = getDb()) {
  return db
    .prepare(
      `SELECT vb.*, sup.name AS supplier_name
       FROM v_batch_status vb
       LEFT JOIN suppliers sup ON sup.id = vb.supplier_id
       WHERE vb.drug_id = ? ${includeEmpty ? '' : 'AND vb.quantity_on_hand > 0'}
       ORDER BY vb.expiry_date ASC, vb.id ASC`
    )
    .all(drugId);
}

/** The "why is the quantity what it is" history for a drug. */
export function getDrugLedger(drugId, { limit = 200 } = {}, db = getDb()) {
  return db
    .prepare(
      `SELECT l.*, b.batch_number, b.expiry_date, u.full_name AS user_name
       FROM stock_ledger l
       JOIN batches b ON b.id = l.batch_id
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.drug_id = ?
       ORDER BY l.occurred_at DESC, l.id DESC
       LIMIT ?`
    )
    .all(drugId, limit);
}

const DRUG_FIELDS = [
  'code', 'name', 'generic_name', 'strength', 'form', 'unit',
  'min_stock_level', 'default_supplier_id', 'storage_location', 'notes', 'is_active',
];

export function createDrug(data, db = getDb()) {
  const values = pickDrugFields(data);
  const result = db
    .prepare(
      `INSERT INTO drugs (code, name, generic_name, strength, form, unit, min_stock_level,
                          default_supplier_id, storage_location, notes, is_active)
       VALUES (@code, @name, @generic_name, @strength, @form, @unit, @min_stock_level,
               @default_supplier_id, @storage_location, @notes, @is_active)`
    )
    .run(values);
  return getDrug(result.lastInsertRowid, db);
}

export function updateDrug(id, data, db = getDb()) {
  const existing = db.prepare('SELECT id FROM drugs WHERE id = ?').get(id);
  if (!existing) throw notFound('That drug was not found.');

  const values = pickDrugFields(data);
  db.prepare(
    `UPDATE drugs SET code = @code, name = @name, generic_name = @generic_name,
                      strength = @strength, form = @form, unit = @unit,
                      min_stock_level = @min_stock_level,
                      default_supplier_id = @default_supplier_id,
                      storage_location = @storage_location, notes = @notes,
                      is_active = @is_active,
                      updated_at = datetime('now','localtime')
     WHERE id = @id`
  ).run({ ...values, id });

  return getDrug(id, db);
}

/**
 * Drugs are deactivated, never deleted, so their stock history stays readable.
 * Deletion is only offered when a drug has never had any movement at all.
 */
export function deleteDrug(id, db = getDb()) {
  const movements = db
    .prepare('SELECT COUNT(*) AS n FROM stock_ledger WHERE drug_id = ?')
    .get(id).n;

  if (movements > 0) {
    throw badRequest(
      'This drug has stock history and cannot be deleted. Mark it inactive instead ' +
        'so it disappears from the inventory list but its records are kept.'
    );
  }

  db.transaction(() => {
    db.prepare('DELETE FROM batches WHERE drug_id = ?').run(id);
    db.prepare('DELETE FROM drugs WHERE id = ?').run(id);
  })();

  return { deleted: true };
}

function pickDrugFields(data) {
  const values = {};
  for (const field of DRUG_FIELDS) values[field] = data[field] ?? null;
  values.code = data.code?.trim() || null; // '' would collide on the UNIQUE index
  values.form = data.form || 'TABLET';
  values.unit = data.unit?.trim() || 'unit';
  values.min_stock_level = data.min_stock_level ?? 0;
  values.is_active = data.is_active === undefined ? 1 : Number(Boolean(data.is_active));
  return values;
}
