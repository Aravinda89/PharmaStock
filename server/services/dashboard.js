import { getDb } from '../db/connection.js';
import { getAlertSummary, getExpiredBatches, getExpiringSoonBatches, getLowStockDrugs } from './alerts.js';

/**
 * Everything on the dashboard in a single request - four KPI tiles and the
 * five lists. One round trip keeps the landing screen instant, which matters
 * because this is the page that stays open all day.
 */
export function getDashboard({ listLimit = 8 } = {}, db = getDb()) {
  const summary = getAlertSummary(db);

  const recentReceipts = db
    .prepare(
      `SELECT r.id, r.receipt_no, r.received_date, s.name AS supplier_name,
              u.full_name AS received_by,
              (SELECT SUM(l.quantity) FROM goods_receipt_lines l WHERE l.goods_receipt_id = r.id) AS total_quantity,
              (SELECT COUNT(*) FROM goods_receipt_lines l WHERE l.goods_receipt_id = r.id) AS line_count,
              (SELECT GROUP_CONCAT(d.name, ', ')
                 FROM goods_receipt_lines l JOIN drugs d ON d.id = l.drug_id
                WHERE l.goods_receipt_id = r.id) AS drug_names
       FROM goods_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN users u ON u.id = r.received_by_user_id
       ORDER BY r.id DESC
       LIMIT ?`
    )
    .all(listLimit);

  const recentDispenses = db
    .prepare(
      `SELECT d.id, d.dispense_no, d.dispensed_at, d.patient_ref, d.patient_name,
              u.full_name AS dispensed_by,
              (SELECT SUM(l.quantity) FROM dispense_lines l WHERE l.dispense_id = d.id) AS total_quantity,
              (SELECT GROUP_CONCAT(DISTINCT dr.name)
                 FROM dispense_lines l JOIN drugs dr ON dr.id = l.drug_id
                WHERE l.dispense_id = d.id) AS drug_names
       FROM dispenses d
       LEFT JOIN users u ON u.id = d.dispensed_by_user_id
       ORDER BY d.id DESC
       LIMIT ?`
    )
    .all(listLimit);

  const todayActivity = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM dispenses WHERE date(dispensed_at) = date('now','localtime')) AS dispenses_today,
         (SELECT COALESCE(SUM(l.quantity), 0) FROM dispense_lines l
            JOIN dispenses d ON d.id = l.dispense_id
           WHERE date(d.dispensed_at) = date('now','localtime')) AS units_dispensed_today,
         (SELECT COUNT(*) FROM goods_receipts WHERE received_date = date('now','localtime')) AS receipts_today`
    )
    .get();

  return {
    summary: { ...summary, ...todayActivity },
    expired: getExpiredBatches({ limit: listLimit }, db),
    expiringSoon: getExpiringSoonBatches({ limit: listLimit }, db),
    lowStock: getLowStockDrugs({ limit: listLimit }, db),
    recentReceipts,
    recentDispenses,
  };
}
