import { getDb } from '../db/connection.js';
import { notFound, badRequest } from '../lib/errors.js';

export function listSuppliers({ includeInactive = false, search = '' } = {}, db = getDb()) {
  const where = [];
  const params = {};

  if (!includeInactive) where.push('s.is_active = 1');
  if (search.trim()) {
    params.search = `%${search.trim()}%`;
    where.push('(s.name LIKE :search OR s.contact_person LIKE :search OR s.phone LIKE :search)');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT s.*,
            (SELECT COUNT(*) FROM drugs d WHERE d.default_supplier_id = s.id AND d.is_active = 1) AS drug_count,
            (SELECT COUNT(*) FROM goods_receipts r WHERE r.supplier_id = s.id) AS receipt_count
     FROM suppliers s ${whereSql}
     ORDER BY s.name ASC`
  );

  return Object.keys(params).length ? stmt.all(params) : stmt.all();
}

export function getSupplier(id, db = getDb()) {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!supplier) throw notFound('That supplier was not found.');
  return supplier;
}

export function createSupplier(data, db = getDb()) {
  const result = db
    .prepare(
      `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active)
       VALUES (@name, @contact_person, @phone, @email, @address, @notes, @is_active)`
    )
    .run(normalise(data));
  return getSupplier(result.lastInsertRowid, db);
}

export function updateSupplier(id, data, db = getDb()) {
  getSupplier(id, db);
  db.prepare(
    `UPDATE suppliers SET name = @name, contact_person = @contact_person, phone = @phone,
                          email = @email, address = @address, notes = @notes,
                          is_active = @is_active, updated_at = datetime('now','localtime')
     WHERE id = @id`
  ).run({ ...normalise(data), id });
  return getSupplier(id, db);
}

/** Suppliers referenced by past deliveries are deactivated, never deleted. */
export function deleteSupplier(id, db = getDb()) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM goods_receipts WHERE supplier_id = ?').get(id).n;
  if (used > 0) {
    throw badRequest(
      'This supplier appears in past deliveries and cannot be deleted. Mark it inactive instead.'
    );
  }
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  return { deleted: true };
}

function normalise(data) {
  return {
    name: data.name?.trim(),
    contact_person: data.contact_person?.trim() || null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    address: data.address?.trim() || null,
    notes: data.notes?.trim() || null,
    is_active: data.is_active === undefined ? 1 : Number(Boolean(data.is_active)),
  };
}
