import { Router } from 'express';
import { z } from 'zod';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requirePermission, recordAudit } from '../middleware/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { optionalId, optionalText, isoDate } from '../lib/zod.js';
import { receiveStock, listReceipts, getReceipt } from '../services/receiving.js';
import { previewDispense, dispenseStock, listDispenses, getDispense } from '../services/dispensing.js';
import { adjustStock, writeOffAllExpired, listAdjustments } from '../services/adjustments.js';
import { findStockDiscrepancies } from '../lib/stock.js';
import { getDb } from '../db/connection.js';

const router = Router();

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

const receiveSchema = z.object({
  supplierId: optionalId().optional().default(null),
  invoiceNo: optionalText(60),
  orderRef: optionalText(60),
  receivedDate: isoDate().optional(),
  notes: optionalText(1000),
  lines: z.array(
    z.object({
      drugId: z.coerce.number().int().positive('Choose a drug for every line.'),
      batchNumber: z.string().trim().max(60).optional().default(''),
      expiryDate: isoDate('Enter an expiry date (YYYY-MM-DD) for every line.'),
      quantity: z.coerce.number().int().positive('Quantity received must be at least 1.'),
      unitCost: z.coerce.number().min(0).optional().nullable(),
      storageLocation: optionalText(80),
    })
  ).min(1, 'Add at least one drug to the delivery.'),
});

router.post('/receipts', requirePermission(PERMISSIONS.STOCK_RECEIVE), validate(receiveSchema),
  asyncHandler(async (req, res) => {
    const result = receiveStock(req.body, req.user.id);
    recordAudit(req.user.id, 'RECEIVE_STOCK', 'goods_receipts', result.id, {
      receiptNo: result.receiptNo,
      lines: result.lines.length,
    });
    res.status(201).json(result);
  }));

router.get('/receipts', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(listReceipts({
    from: req.query.from || null,
    to: req.query.to || null,
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : null,
    drugId: req.query.drugId ? Number(req.query.drugId) : null,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  }));
}));

router.get('/receipts/:id', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(getReceipt(Number(req.params.id)));
}));

// ---------------------------------------------------------------------------
// Dispensing
// ---------------------------------------------------------------------------

const dispenseLineSchema = z.object({
  drugId: z.coerce.number().int().positive('Choose a drug for every line.'),
  quantity: z.coerce.number().int().positive('Quantity to dispense must be at least 1.'),
  // Present only when the pharmacist used "Change batches".
  allocation: z.array(
    z.object({
      batchId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().positive(),
    })
  ).optional(),
});

const dispenseSchema = z.object({
  patientRef: optionalText(80),
  patientName: optionalText(120),
  prescriber: optionalText(120),
  notes: optionalText(1000),
  dispensedAt: z.string().optional(),
  lines: z.array(dispenseLineSchema).min(1, 'Add at least one drug to dispense.'),
});

/** Non-mutating: powers the live "Current -> New" preview on the Dispense screen. */
router.post('/dispenses/preview', requirePermission(PERMISSIONS.STOCK_DISPENSE),
  validate(z.object({ lines: z.array(dispenseLineSchema).min(1) })),
  asyncHandler(async (req, res) => {
    res.json(previewDispense(req.body.lines));
  }));

router.post('/dispenses', requirePermission(PERMISSIONS.STOCK_DISPENSE), validate(dispenseSchema),
  asyncHandler(async (req, res) => {
    const result = dispenseStock(req.body, req.user.id);
    recordAudit(req.user.id, 'DISPENSE_STOCK', 'dispenses', result.id, {
      dispenseNo: result.dispenseNo,
      lines: result.lines.length,
    });
    res.status(201).json(result);
  }));

router.get('/dispenses', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(listDispenses({
    from: req.query.from || null,
    to: req.query.to || null,
    drugId: req.query.drugId ? Number(req.query.drugId) : null,
    patientRef: req.query.patientRef || null,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  }));
}));

router.get('/dispenses/:id', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(getDispense(Number(req.params.id)));
}));

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  batchId: z.coerce.number().int().positive('Choose the batch to adjust.'),
  quantityDelta: z.coerce.number().int().refine((n) => n !== 0, 'Enter an adjustment other than zero.'),
  reason: z.enum(['DAMAGE', 'EXPIRED_DISPOSAL', 'COUNT_CORRECTION', 'RETURN_TO_SUPPLIER', 'LOST', 'OTHER'], {
    errorMap: () => ({ message: 'Choose a reason for the adjustment.' }),
  }),
  notes: optionalText(1000),
});

router.post('/adjustments', requirePermission(PERMISSIONS.STOCK_ADJUST), validate(adjustmentSchema),
  asyncHandler(async (req, res) => {
    const result = adjustStock(req.body, req.user.id);
    recordAudit(req.user.id, 'ADJUST_STOCK', 'stock_adjustments', result.id, {
      adjustmentNo: result.adjustmentNo,
      delta: result.quantityDelta,
      reason: result.reason,
    });
    res.status(201).json(result);
  }));

router.post('/adjustments/write-off-expired', requirePermission(PERMISSIONS.STOCK_ADJUST),
  validate(z.object({ notes: optionalText(1000) })),
  asyncHandler(async (req, res) => {
    const result = writeOffAllExpired(req.body, req.user.id);
    recordAudit(req.user.id, 'WRITE_OFF_EXPIRED', 'stock_adjustments', null, {
      batches: result.count,
      units: result.totalQuantity,
    });
    res.json(result);
  }));

router.get('/adjustments', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(listAdjustments({
    from: req.query.from || null,
    to: req.query.to || null,
    drugId: req.query.drugId ? Number(req.query.drugId) : null,
    limit: Math.min(Number(req.query.limit) || 100, 500),
  }));
}));

// ---------------------------------------------------------------------------
// Batches and integrity
// ---------------------------------------------------------------------------

/** Batch picker for the dispense screen's "Change batches" panel. */
router.get('/batches', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const drugId = Number(req.query.drugId);
  if (!drugId) return res.json({ items: [] });

  const items = getDb()
    .prepare(
      `SELECT vb.*, s.name AS supplier_name
       FROM v_batch_status vb
       LEFT JOIN suppliers s ON s.id = vb.supplier_id
       WHERE vb.drug_id = ? ${req.query.includeEmpty === 'true' ? '' : 'AND vb.quantity_on_hand > 0'}
       ORDER BY vb.expiry_date ASC, vb.id ASC`
    )
    .all(drugId);

  res.json({ items });
}));

/**
 * Reconciliation check surfaced in Settings: does every batch quantity still
 * equal the sum of its ledger entries?
 */
router.get('/integrity', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const discrepancies = findStockDiscrepancies(getDb());
  res.json({
    ok: discrepancies.length === 0,
    checked: getDb().prepare('SELECT COUNT(*) AS n FROM batches').get().n,
    discrepancies,
  });
}));

export default router;
