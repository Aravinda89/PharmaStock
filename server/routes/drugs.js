import { Router } from 'express';
import { z } from 'zod';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requirePermission, recordAudit } from '../middleware/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { boolish, optionalId, optionalInt, optionalText } from '../lib/zod.js';
import {
  listDrugs, getDrug, getDrugBatches, getDrugLedger,
  createDrug, updateDrug, deleteDrug,
} from '../services/drugs.js';

const router = Router();

const FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'OINTMENT',
  'DROPS', 'INHALER', 'SUPPOSITORY', 'PATCH', 'OTHER'];

const listQuerySchema = z.object({
  search: z.string().optional().default(''),
  form: z.string().optional().default(''),
  supplierId: optionalId().optional().default(null),
  stockStatus: z.enum(['', 'OK', 'LOW', 'OUT_OF_STOCK']).optional().default(''),
  expiryStatus: z.enum(['', 'GOOD', 'EXPIRING_SOON', 'EXPIRED', 'NONE']).optional().default(''),
  expiringWithinDays: optionalInt({ min: 0, max: 3650 }).optional().default(null),
  includeInactive: boolish(false),
  sort: z.enum(['name', 'stock_asc', 'stock_desc', 'expiry', 'urgency']).optional().default('name'),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(500),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const drugSchema = z.object({
  code: optionalText(60),
  name: z.string().trim().min(1, 'Enter the drug name.').max(160),
  generic_name: optionalText(160),
  strength: optionalText(60),
  form: z.enum(FORMS).default('TABLET'),
  unit: z.string().trim().max(30).default('unit'),
  min_stock_level: z.coerce.number().int().min(0, 'Minimum stock level cannot be negative.').default(0),
  default_supplier_id: optionalId().optional().default(null),
  storage_location: optionalText(80),
  notes: optionalText(2000),
  is_active: boolish(true),
});

router.get('/', requirePermission(PERMISSIONS.INVENTORY_VIEW), validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(listDrugs(req.validatedQuery));
  }));

router.get('/:id', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  res.json({
    drug: getDrug(id),
    batches: getDrugBatches(id, { includeEmpty: req.query.includeEmpty === 'true' }),
    ledger: getDrugLedger(id, { limit: Number(req.query.ledgerLimit) || 200 }),
  });
}));

router.post('/', requirePermission(PERMISSIONS.INVENTORY_MANAGE), validate(drugSchema),
  asyncHandler(async (req, res) => {
    const drug = createDrug(req.body);
    recordAudit(req.user.id, 'CREATE_DRUG', 'drugs', drug.drug_id, { name: drug.name });
    res.status(201).json(drug);
  }));

router.put('/:id', requirePermission(PERMISSIONS.INVENTORY_MANAGE), validate(drugSchema),
  asyncHandler(async (req, res) => {
    const drug = updateDrug(Number(req.params.id), req.body);
    recordAudit(req.user.id, 'UPDATE_DRUG', 'drugs', drug.drug_id, { name: drug.name });
    res.json(drug);
  }));

router.delete('/:id', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => {
  const result = deleteDrug(Number(req.params.id));
  recordAudit(req.user.id, 'DELETE_DRUG', 'drugs', Number(req.params.id));
  res.json(result);
}));

export default router;
