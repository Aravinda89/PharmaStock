import { Router } from 'express';
import { asyncHandler } from '../middleware/validate.js';
import { requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { buildReport, REPORT_CATALOGUE } from '../services/reports.js';
import { reportToExcel, fullDataToExcel } from '../lib/exportExcel.js';
import { reportToPdf } from '../lib/exportPdf.js';
import { getDb } from '../db/connection.js';
import { today } from '../lib/dates.js';

const router = Router();

const paramsFrom = (query) => ({
  from: query.from || null,
  to: query.to || null,
  drugId: query.drugId ? Number(query.drugId) : null,
  changeType: query.changeType || null,
  withinDays: query.withinDays ? Number(query.withinDays) : null,
});

router.get('/', requirePermission(PERMISSIONS.REPORTS_VIEW), (_req, res) => {
  res.json({ reports: REPORT_CATALOGUE });
});

router.get('/:key', requirePermission(PERMISSIONS.REPORTS_VIEW), asyncHandler(async (req, res) => {
  res.json(buildReport(req.params.key, paramsFrom(req.query)));
}));

const filename = (report, ext) =>
  `${report.key}-${today()}.${ext}`.replace(/[^a-zA-Z0-9.\-]/g, '-');

router.get('/:key/export/xlsx', requirePermission(PERMISSIONS.REPORTS_EXPORT), asyncHandler(async (req, res) => {
  const report = buildReport(req.params.key, paramsFrom(req.query));
  const buffer = await reportToExcel(report);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename(report, 'xlsx')}"`);
  res.send(Buffer.from(buffer));
}));

router.get('/:key/export/pdf', requirePermission(PERMISSIONS.REPORTS_EXPORT), asyncHandler(async (req, res) => {
  const report = buildReport(req.params.key, paramsFrom(req.query));
  const buffer = await reportToPdf(report);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename(report, 'pdf')}"`);
  res.send(buffer);
}));

/** The "export everything" safety net described in the admin guide. */
router.get('/export/full-data', requirePermission(PERMISSIONS.REPORTS_EXPORT), asyncHandler(async (_req, res) => {
  const buffer = await fullDataToExcel(getDb());

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="pharmastock-all-data-${today()}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

export default router;
