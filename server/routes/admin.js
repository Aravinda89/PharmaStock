import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requirePermission, recordAudit } from '../middleware/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { getAllSettings, setSettings } from '../services/settings.js';
import {
  createBackup, listBackups, getBackupPath, restoreBackup, validateBackupFile,
} from '../services/backup.js';
import { getDashboard } from '../services/dashboard.js';
import {
  getAlertSummary, getExpiredBatches, getExpiringSoonBatches, getLowStockDrugs,
} from '../services/alerts.js';
import { sampleDataSummary, removeSampleData } from '../db/seed.js';
import { PORT } from '../config.js';

const router = Router();

const upload = multer({
  dest: path.join(os.tmpdir(), 'pharmastock-uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Dashboard and alerts
// ---------------------------------------------------------------------------

router.get('/dashboard', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  res.json(getDashboard({ listLimit: Math.min(Number(req.query.limit) || 8, 50) }));
}));

router.get('/alerts', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json({
    summary: getAlertSummary(),
    expired: getExpiredBatches({ limit }),
    expiringSoon: getExpiringSoonBatches({
      limit,
      withinDays: req.query.withinDays ? Number(req.query.withinDays) : null,
    }),
    lowStock: getLowStockDrugs({ limit }),
  });
}));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

router.get('/settings', asyncHandler(async (_req, res) => {
  res.json(getAllSettings());
}));

const settingsSchema = z.object({
  pharmacy_name: z.string().trim().min(1, 'Enter a pharmacy name.').max(120).optional(),
  expiry_alert_days: z.coerce.number().int().min(1, 'The expiry warning must be at least 1 day.')
    .max(730, 'The expiry warning cannot be more than 730 days.').optional(),
  backup_retention_count: z.coerce.number().int().min(1).max(365).optional(),
  auto_backup_enabled: z.enum(['0', '1']).optional(),
});

router.put('/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const updated = setSettings(req.body, req.user.id);
    recordAudit(req.user.id, 'UPDATE_SETTINGS', 'settings', null, req.body);
    res.json(updated);
  }));

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

router.get('/backups', requirePermission(PERMISSIONS.BACKUP_MANAGE), asyncHandler(async (_req, res) => {
  res.json({ items: listBackups() });
}));

router.post('/backups', requirePermission(PERMISSIONS.BACKUP_MANAGE), asyncHandler(async (req, res) => {
  const result = await createBackup({ label: 'manual', userId: req.user.id });
  recordAudit(req.user.id, 'CREATE_BACKUP', null, null, { filename: result.filename });
  res.status(201).json(result);
}));

/** Download a backup so it can be put on a USB stick. */
router.get('/backups/:filename/download', requirePermission(PERMISSIONS.BACKUP_MANAGE),
  asyncHandler(async (req, res) => {
    const full = getBackupPath(req.params.filename);
    res.download(full, req.params.filename);
  }));

router.post('/backups/:filename/restore', requirePermission(PERMISSIONS.BACKUP_MANAGE),
  asyncHandler(async (req, res) => {
    const full = getBackupPath(req.params.filename);
    const result = await restoreBackup(full, { userId: req.user.id });
    recordAudit(req.user.id, 'RESTORE_BACKUP', null, null, { filename: req.params.filename });
    res.json({
      ...result,
      message: 'Database restored. Please close and restart PharmaStock, then sign in again.',
    });
  }));

/** Restore from a file the user picks off a USB stick. */
router.post('/backups/upload-restore', requirePermission(PERMISSIONS.BACKUP_MANAGE),
  upload.single('backup'), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a backup file (.db) to restore.' });

    try {
      validateBackupFile(req.file.path);
      const result = await restoreBackup(req.file.path, { userId: req.user.id });
      recordAudit(req.user.id, 'RESTORE_BACKUP_UPLOAD', null, null, {
        originalName: req.file.originalname,
      });
      res.json({
        ...result,
        message: 'Database restored. Please close and restart PharmaStock, then sign in again.',
      });
    } finally {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }));

router.delete('/backups/:filename', requirePermission(PERMISSIONS.BACKUP_MANAGE),
  asyncHandler(async (req, res) => {
    const full = getBackupPath(req.params.filename);
    fs.unlinkSync(full);
    recordAudit(req.user.id, 'DELETE_BACKUP', null, null, { filename: req.params.filename });
    res.json({ deleted: true });
  }));

// ---------------------------------------------------------------------------
// Sample data - the first-run showcase, and getting rid of it
// ---------------------------------------------------------------------------

router.get('/sample-data', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (_req, res) => {
  res.json(sampleDataSummary());
}));

router.delete('/sample-data', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => {
  const result = removeSampleData();
  recordAudit(req.user.id, 'REMOVE_SAMPLE_DATA', null, null, result);
  res.json({
    ...result,
    message: result.removed
      ? 'Sample data removed. The inventory is now empty and ready for your real stock.'
      : 'There was no sample data to remove.',
  });
}));

// ---------------------------------------------------------------------------
// System info - shown in Settings so the pharmacy knows the LAN address
// ---------------------------------------------------------------------------

router.get('/system', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (_req, res) => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);

  res.json({
    version: '1.0.0',
    hostname: os.hostname(),
    localUrl: `http://localhost:${PORT}`,
    networkUrls: addresses,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
  });
}));

export default router;
