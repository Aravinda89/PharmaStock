import { getDb } from '../db/connection.js';
import { getExpiryAlertDays } from './settings.js';

/**
 * Batches that have already passed their expiry date and still have stock.
 * Empty batches are excluded - there is nothing to act on.
 */
export function getExpiredBatches({ limit = 500 } = {}, db = getDb()) {
  return db
    .prepare(
      `SELECT vb.id AS batch_id, vb.drug_id, vb.batch_number, vb.expiry_date,
              vb.quantity_on_hand, vb.days_to_expiry, vb.storage_location,
              d.name AS drug_name, d.strength, d.form, d.unit, d.code,
              s.name AS supplier_name
       FROM v_batch_status vb
       JOIN drugs d ON d.id = vb.drug_id
       LEFT JOIN suppliers s ON s.id = vb.supplier_id
       WHERE vb.expiry_status = 'EXPIRED' AND vb.quantity_on_hand > 0 AND d.is_active = 1
       ORDER BY vb.expiry_date ASC
       LIMIT ?`
    )
    .all(limit);
}

/** Batches inside the configured warning window - the "order/return soon" list. */
export function getExpiringSoonBatches({ limit = 500, withinDays = null } = {}, db = getDb()) {
  const days = withinDays ?? getExpiryAlertDays(db);
  return db
    .prepare(
      `SELECT vb.id AS batch_id, vb.drug_id, vb.batch_number, vb.expiry_date,
              vb.quantity_on_hand, vb.days_to_expiry, vb.storage_location,
              d.name AS drug_name, d.strength, d.form, d.unit, d.code,
              s.name AS supplier_name
       FROM v_batch_status vb
       JOIN drugs d ON d.id = vb.drug_id
       LEFT JOIN suppliers s ON s.id = vb.supplier_id
       WHERE vb.quantity_on_hand > 0 AND d.is_active = 1
         AND vb.days_to_expiry >= 0 AND vb.days_to_expiry <= ?
       ORDER BY vb.days_to_expiry ASC
       LIMIT ?`
    )
    .all(days, limit);
}

/**
 * The reorder list. `suggested_order_qty` tops the drug back up to twice its
 * minimum level - a simple, predictable rule the pharmacist can override.
 */
export function getLowStockDrugs({ limit = 500 } = {}, db = getDb()) {
  return db
    .prepare(
      `SELECT s.drug_id, s.code, s.name AS drug_name, s.strength, s.form, s.unit,
              s.available_qty, s.min_stock_level, s.stock_status, s.earliest_expiry,
              sup.name AS supplier_name,
              MAX(s.min_stock_level * 2 - s.available_qty, 0) AS suggested_order_qty
       FROM v_drug_stock s
       LEFT JOIN suppliers sup ON sup.id = s.default_supplier_id
       WHERE s.is_active = 1 AND s.stock_status IN ('LOW', 'OUT_OF_STOCK')
       ORDER BY CASE s.stock_status WHEN 'OUT_OF_STOCK' THEN 0 ELSE 1 END,
                s.available_qty ASC, s.name ASC
       LIMIT ?`
    )
    .all(limit);
}

/** Everything the Alerts screen and the dashboard need, in one round trip. */
export function getAlertSummary(db = getDb()) {
  const alertDays = getExpiryAlertDays(db);

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM v_drug_stock WHERE is_active = 1) AS total_drugs,
         (SELECT COALESCE(SUM(total_qty), 0) FROM v_drug_stock WHERE is_active = 1) AS total_units,
         (SELECT COUNT(*) FROM v_drug_stock
           WHERE is_active = 1 AND stock_status IN ('LOW', 'OUT_OF_STOCK')) AS low_stock,
         (SELECT COUNT(*) FROM v_drug_stock
           WHERE is_active = 1 AND stock_status = 'OUT_OF_STOCK') AS out_of_stock,
         (SELECT COUNT(*) FROM v_batch_status vb JOIN drugs d ON d.id = vb.drug_id
           WHERE d.is_active = 1 AND vb.quantity_on_hand > 0
             AND vb.days_to_expiry >= 0 AND vb.days_to_expiry <= :alertDays) AS expiring_soon,
         (SELECT COUNT(*) FROM v_batch_status vb JOIN drugs d ON d.id = vb.drug_id
           WHERE d.is_active = 1 AND vb.quantity_on_hand > 0
             AND vb.expiry_status = 'EXPIRED') AS expired,
         (SELECT COALESCE(SUM(vb.quantity_on_hand), 0) FROM v_batch_status vb
           JOIN drugs d ON d.id = vb.drug_id
           WHERE d.is_active = 1 AND vb.expiry_status = 'EXPIRED') AS expired_units`
    )
    .get({ alertDays });

  return { ...counts, expiry_alert_days: alertDays };
}
