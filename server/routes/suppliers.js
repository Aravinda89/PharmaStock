import { Router } from 'express';
import { z } from 'zod';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requirePermission, recordAudit } from '../middleware/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { boolish, optionalText } from '../lib/zod.js';
import { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier } from '../services/suppliers.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name.').max(120),
  contact_person: optionalText(120),
  phone: optionalText(40),
  email: optionalText(120),
  address: optionalText(300),
  notes: optionalText(1000),
  is_active: boolish(true),
});

router.get('/', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json({
    items: listSuppliers({
      includeInactive: req.query.includeInactive === 'true',
      search: req.query.search || '',
    }),
  });
}));

router.get('/:id', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(getSupplier(Number(req.params.id)));
}));

router.post('/', requirePermission(PERMISSIONS.INVENTORY_MANAGE), validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const supplier = createSupplier(req.body);
    recordAudit(req.user.id, 'CREATE_SUPPLIER', 'suppliers', supplier.id, { name: supplier.name });
    res.status(201).json(supplier);
  }));

router.put('/:id', requirePermission(PERMISSIONS.INVENTORY_MANAGE), validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const supplier = updateSupplier(Number(req.params.id), req.body);
    recordAudit(req.user.id, 'UPDATE_SUPPLIER', 'suppliers', supplier.id, { name: supplier.name });
    res.json(supplier);
  }));

router.delete('/:id', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => {
  res.json(deleteSupplier(Number(req.params.id)));
}));

export default router;
