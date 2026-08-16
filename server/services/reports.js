import { getDb } from '../db/connection.js';
import { badRequest } from '../lib/errors.js';
import { getExpiryAlertDays, getSetting } from './settings.js';
import { getExpiredBatches, getExpiringSoonBatches, getLowStockDrugs } from './alerts.js';
import { now } from '../lib/dates.js';

/**
 * Every report returns the same shape:
 *   { key, title, subtitle, columns, rows, totals, generatedAt }
 *
 * That is what lets one Excel exporter and one PDF exporter serve all seven
 * reports - add a report here and both export formats work for free.
 */

const num = (key, label, width = 12) => ({ key, label, width, align: 'right', type: 'number' });
const txt = (key, label, width = 20) => ({ key, label, width, align: 'left', type: 'text' });

const REPORTS = {
  inventory: {
    title: 'Current Inventory',
    build(params, db) {
      const rows = db
        .prepare(
          `SELECT s.code, s.name, s.strength, s.form, s.unit,
                  s.available_qty, s.expired_qty, s.total_qty, s.min_stock_level,
                  s.earliest_expiry, s.batch_count, s.stock_status, s.expiry_status,
                  sup.name AS supplier_name, s.storage_location
           FROM v_drug_stock s
           LEFT JOIN suppliers sup ON sup.id = s.default_supplier_id
           WHERE s.is_active = 1
           ORDER BY s.name`
        )
        .all();

      return {
        subtitle: `${rows.length} active drugs`,
        columns: [
          txt('code', 'Code', 14),
          txt('name', 'Drug', 28),
          txt('strength', 'Strength', 12),
          txt('form', 'Form', 12),
          num('available_qty', 'Available'),
          num('min_stock_level', 'Min level'),
          txt('earliest_expiry', 'Next expiry', 14),
          num('batch_count', 'Batches', 9),
          txt('stock_status', 'Stock', 14),
          txt('supplier_name', 'Supplier', 22),
          txt('storage_location', 'Location', 16),
        ],
        rows,
        totals: { available_qty: rows.reduce((s, r) => s + r.available_qty, 0) },
      };
    },
  },

  'low-stock': {
    title: 'Low Stock - Reorder List',
    build(params, db) {
      const rows = getLowStockDrugs({ limit: 5000 }, db);
      return {
        subtitle: `${rows.length} drugs at or below their minimum level`,
        columns: [
          txt('code', 'Code', 14),
          txt('drug_name', 'Drug', 28),
          txt('strength', 'Strength', 12),
          num('available_qty', 'Available'),
          num('min_stock_level', 'Min level'),
          num('suggested_order_qty', 'Suggested order'),
          txt('stock_status', 'Status', 14),
          txt('supplier_name', 'Supplier', 22),
        ],
        rows,
        totals: { suggested_order_qty: rows.reduce((s, r) => s + r.suggested_order_qty, 0) },
      };
    },
  },

  expired: {
    title: 'Expired Stock',
    build(params, db) {
      const rows = getExpiredBatches({ limit: 5000 }, db);
      return {
        subtitle: `${rows.length} expired batches still on the shelf`,
        columns: [
          txt('drug_name', 'Drug', 28),
          txt('strength', 'Strength', 12),
          txt('batch_number', 'Batch', 16),
          txt('expiry_date', 'Expired on', 14),
          num('days_to_expiry', 'Days ago'),
          num('quantity_on_hand', 'Quantity'),
          txt('supplier_name', 'Supplier', 22),
          txt('storage_location', 'Location', 16),
        ],
        rows: rows.map((r) => ({ ...r, days_to_expiry: Math.abs(r.days_to_expiry) })),
        totals: { quantity_on_hand: rows.reduce((s, r) => s + r.quantity_on_hand, 0) },
      };
    },
  },

  'expiring-soon': {
    title: 'Drugs Expiring Soon',
    build(params, db) {
      const days = params.withinDays ?? getExpiryAlertDays(db);
      const rows = getExpiringSoonBatches({ limit: 5000, withinDays: days }, db);
      return {
        subtitle: `${rows.length} batches expiring within ${days} days`,
        columns: [
          txt('drug_name', 'Drug', 28),
          txt('strength', 'Strength', 12),
          txt('batch_number', 'Batch', 16),
          txt('expiry_date', 'Expires on', 14),
          num('days_to_expiry', 'Days left'),
          num('quantity_on_hand', 'Quantity'),
          txt('supplier_name', 'Supplier', 22),
          txt('storage_location', 'Location', 16),
        ],
        rows,
        totals: { quantity_on_hand: rows.reduce((s, r) => s + r.quantity_on_hand, 0) },
      };
    },
  },

  received: {
    title: 'Stock Received',
    build(params, db) {
      const { from, to } = requireRange(params);
      const rows = db
        .prepare(
          `SELECT r.receipt_no, r.received_date, s.name AS supplier_name, r.invoice_no,
                  d.name AS drug_name, d.strength, l.batch_number, l.expiry_date,
                  l.quantity, l.unit_cost,
                  ROUND(COALESCE(l.unit_cost, 0) * l.quantity, 2) AS line_total,
                  u.full_name AS received_by
           FROM goods_receipt_lines l
           JOIN goods_receipts r ON r.id = l.goods_receipt_id
           JOIN drugs d ON d.id = l.drug_id
           LEFT JOIN suppliers s ON s.id = r.supplier_id
           LEFT JOIN users u ON u.id = r.received_by_user_id
           WHERE r.received_date BETWEEN ? AND ?
           ORDER BY r.received_date DESC, r.id DESC, l.id`
        )
        .all(from, to);

      return {
        subtitle: `${rows.length} delivery lines from ${from} to ${to}`,
        columns: [
          txt('receipt_no', 'Receipt', 16),
          txt('received_date', 'Date', 12),
          txt('drug_name', 'Drug', 26),
          txt('strength', 'Strength', 12),
          txt('batch_number', 'Batch', 16),
          txt('expiry_date', 'Expiry', 12),
          num('quantity', 'Quantity'),
          num('unit_cost', 'Unit cost'),
          num('line_total', 'Total'),
          txt('supplier_name', 'Supplier', 22),
          txt('received_by', 'Received by', 20),
        ],
        rows,
        totals: {
          quantity: rows.reduce((s, r) => s + r.quantity, 0),
          line_total: round2(rows.reduce((s, r) => s + (r.line_total || 0), 0)),
        },
      };
    },
  },

  dispensed: {
    title: 'Drugs Dispensed',
    build(params, db) {
      const { from, to } = requireRange(params);
      const rows = db
        .prepare(
          `SELECT dp.dispense_no, dp.dispensed_at, dp.patient_ref, dp.patient_name,
                  d.name AS drug_name, d.strength, d.unit,
                  b.batch_number, b.expiry_date, l.quantity,
                  u.full_name AS dispensed_by
           FROM dispense_lines l
           JOIN dispenses dp ON dp.id = l.dispense_id
           JOIN drugs d ON d.id = l.drug_id
           JOIN batches b ON b.id = l.batch_id
           LEFT JOIN users u ON u.id = dp.dispensed_by_user_id
           WHERE date(dp.dispensed_at) BETWEEN ? AND ?
           ORDER BY dp.dispensed_at DESC, l.id`
        )
        .all(from, to);

      return {
        subtitle: `${rows.length} dispensing lines from ${from} to ${to}`,
        columns: [
          txt('dispense_no', 'Reference', 16),
          txt('dispensed_at', 'Date / time', 18),
          txt('drug_name', 'Drug', 26),
          txt('strength', 'Strength', 12),
          txt('batch_number', 'Batch', 16),
          txt('expiry_date', 'Expiry', 12),
          num('quantity', 'Quantity'),
          txt('patient_ref', 'Patient ref', 18),
          txt('dispensed_by', 'Dispensed by', 20),
        ],
        rows,
        totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0) },
      };
    },
  },

  movement: {
    title: 'Stock Movement History',
    build(params, db) {
      const { from, to } = requireRange(params);
      const conditions = ['date(l.occurred_at) BETWEEN :from AND :to'];
      const args = { from, to };

      if (params.drugId) {
        conditions.push('l.drug_id = :drugId');
        args.drugId = Number(params.drugId);
      }
      if (params.changeType) {
        conditions.push('l.change_type = :changeType');
        args.changeType = params.changeType;
      }

      const rows = db
        .prepare(
          `SELECT l.occurred_at, d.name AS drug_name, d.strength,
                  b.batch_number, b.expiry_date, l.change_type,
                  l.quantity_delta, l.balance_after, l.reason,
                  u.full_name AS user_name
           FROM stock_ledger l
           JOIN drugs d ON d.id = l.drug_id
           JOIN batches b ON b.id = l.batch_id
           LEFT JOIN users u ON u.id = l.user_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY l.occurred_at DESC, l.id DESC`
        )
        .all(args);

      const received = rows.filter((r) => r.quantity_delta > 0).reduce((s, r) => s + r.quantity_delta, 0);
      const issued = rows.filter((r) => r.quantity_delta < 0).reduce((s, r) => s + r.quantity_delta, 0);

      return {
        subtitle:
          `${rows.length} movements from ${from} to ${to} - ` +
          `${received} in, ${Math.abs(issued)} out, net ${received + issued}`,
        columns: [
          txt('occurred_at', 'When', 18),
          txt('drug_name', 'Drug', 26),
          txt('strength', 'Strength', 12),
          txt('batch_number', 'Batch', 16),
          txt('change_type', 'Movement', 18),
          num('quantity_delta', 'Change'),
          num('balance_after', 'Batch balance'),
          txt('reason', 'Reason', 28),
          txt('user_name', 'User', 20),
        ],
        rows,
        totals: { quantity_delta: received + issued },
      };
    },
  },
};

export const REPORT_KEYS = Object.keys(REPORTS);

export const REPORT_CATALOGUE = [
  { key: 'inventory', title: 'Current Inventory', needsRange: false, description: 'Every active drug with its available quantity, next expiry and supplier.' },
  { key: 'low-stock', title: 'Low Stock - Reorder List', needsRange: false, description: 'Drugs at or below their minimum level, with a suggested order quantity.' },
  { key: 'expiring-soon', title: 'Drugs Expiring Soon', needsRange: false, description: 'Batches inside the expiry warning window, soonest first.' },
  { key: 'expired', title: 'Expired Stock', needsRange: false, description: 'Expired batches still on the shelf that need writing off.' },
  { key: 'received', title: 'Stock Received', needsRange: true, description: 'Every delivery line received in a date range.' },
  { key: 'dispensed', title: 'Drugs Dispensed', needsRange: true, description: 'Every dispensing line in a date range.' },
  { key: 'movement', title: 'Stock Movement History', needsRange: true, description: 'The full ledger - why each quantity is what it is.' },
];

export function buildReport(key, params = {}, db = getDb()) {
  const report = REPORTS[key];
  if (!report) throw badRequest(`Unknown report: ${key}`);

  const built = report.build(params, db);
  return {
    key,
    title: report.title,
    pharmacyName: getSetting('pharmacy_name', db),
    generatedAt: now(),
    filters: params,
    ...built,
  };
}

function requireRange(params) {
  if (!params.from || !params.to) {
    throw badRequest('Choose a start and end date for this report.');
  }
  if (params.from > params.to) {
    throw badRequest('The start date must be on or before the end date.');
  }
  return { from: params.from, to: params.to };
}

const round2 = (n) => Math.round(n * 100) / 100;
