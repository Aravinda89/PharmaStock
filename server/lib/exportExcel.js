import ExcelJS from 'exceljs';

const HEADER_FILL = 'FF1F5F4E';
const STATUS_COLOURS = {
  EXPIRED: 'FFFFC7CE',
  OUT_OF_STOCK: 'FFFFC7CE',
  EXPIRING_SOON: 'FFFFEB9C',
  LOW: 'FFFFEB9C',
  GOOD: 'FFC6EFCE',
  OK: 'FFC6EFCE',
};

/**
 * One exporter for all seven reports - it works off the generic
 * { columns, rows, totals } shape that services/reports.js produces.
 */
export async function reportToExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PharmaStock';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = report.columns.length;

  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${report.pharmacyName} - ${report.title}`;
  titleCell.font = { size: 14, bold: true };

  sheet.mergeCells(2, 1, 2, lastCol);
  sheet.getCell(2, 1).value = report.subtitle || '';
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF666666' } };

  sheet.mergeCells(3, 1, 3, lastCol);
  sheet.getCell(3, 1).value = `Generated ${report.generatedAt}`;
  sheet.getCell(3, 1).font = { size: 9, italic: true, color: { argb: 'FF888888' } };

  const headerRow = sheet.getRow(4);
  report.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: col.align === 'right' ? 'right' : 'left', vertical: 'middle' };
    sheet.getColumn(i + 1).width = col.width || 18;
  });
  headerRow.height = 20;

  report.rows.forEach((row) => {
    const values = report.columns.map((col) => {
      const value = row[col.key];
      if (value === null || value === undefined) return '';
      return col.type === 'number' ? Number(value) : String(value);
    });
    const added = sheet.addRow(values);

    report.columns.forEach((col, i) => {
      const cell = added.getCell(i + 1);
      if (col.type === 'number') cell.numFmt = '#,##0.##';
      cell.alignment = { horizontal: col.align === 'right' ? 'right' : 'left' };

      // Colour the status columns so the printed sheet carries the same
      // red/amber/green meaning as the screen.
      const colour = STATUS_COLOURS[row[col.key]];
      if (colour && (col.key === 'stock_status' || col.key === 'expiry_status')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
      }
    });
  });

  if (report.totals && Object.keys(report.totals).length) {
    const totalValues = report.columns.map((col, i) =>
      i === 0 ? 'TOTAL' : (report.totals[col.key] ?? '')
    );
    const totalRow = sheet.addRow(totalValues);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'double' } };
    });
  }

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: lastCol },
  };

  return workbook.xlsx.writeBuffer();
}

/**
 * The "export everything" safety net: a human-readable workbook that still
 * makes sense even if the software is gone entirely.
 */
export async function fullDataToExcel(db) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PharmaStock';
  workbook.created = new Date();

  const sheets = [
    ['Drugs', `SELECT d.id, d.code, d.name, d.generic_name, d.strength, d.form, d.unit,
                      d.min_stock_level, s.name AS supplier, d.storage_location,
                      d.is_active, d.notes
               FROM drugs d LEFT JOIN suppliers s ON s.id = d.default_supplier_id
               ORDER BY d.name`],
    ['Batches', `SELECT b.id, d.name AS drug, d.strength, b.batch_number, b.expiry_date,
                        b.quantity_on_hand, b.quantity_received, b.unit_cost,
                        s.name AS supplier, b.storage_location
                 FROM batches b JOIN drugs d ON d.id = b.drug_id
                 LEFT JOIN suppliers s ON s.id = b.supplier_id
                 ORDER BY d.name, b.expiry_date`],
    ['Stock Movements', `SELECT l.id, l.occurred_at, d.name AS drug, b.batch_number,
                                l.change_type, l.quantity_delta, l.balance_after,
                                l.reason, u.full_name AS user
                         FROM stock_ledger l
                         JOIN drugs d ON d.id = l.drug_id
                         JOIN batches b ON b.id = l.batch_id
                         LEFT JOIN users u ON u.id = l.user_id
                         ORDER BY l.id`],
    ['Receipts', `SELECT r.receipt_no, r.received_date, s.name AS supplier, r.invoice_no,
                         d.name AS drug, l.batch_number, l.expiry_date, l.quantity, l.unit_cost
                  FROM goods_receipt_lines l
                  JOIN goods_receipts r ON r.id = l.goods_receipt_id
                  JOIN drugs d ON d.id = l.drug_id
                  LEFT JOIN suppliers s ON s.id = r.supplier_id
                  ORDER BY r.received_date DESC`],
    ['Dispensing', `SELECT dp.dispense_no, dp.dispensed_at, dp.patient_ref, dp.patient_name,
                           d.name AS drug, b.batch_number, l.quantity, u.full_name AS dispensed_by
                    FROM dispense_lines l
                    JOIN dispenses dp ON dp.id = l.dispense_id
                    JOIN drugs d ON d.id = l.drug_id
                    JOIN batches b ON b.id = l.batch_id
                    LEFT JOIN users u ON u.id = dp.dispensed_by_user_id
                    ORDER BY dp.dispensed_at DESC`],
    ['Adjustments', `SELECT a.adjustment_no, a.created_at, d.name AS drug, b.batch_number,
                            a.quantity_delta, a.reason, a.notes, u.full_name AS user
                     FROM stock_adjustments a
                     JOIN drugs d ON d.id = a.drug_id
                     JOIN batches b ON b.id = a.batch_id
                     LEFT JOIN users u ON u.id = a.user_id
                     ORDER BY a.created_at DESC`],
    ['Suppliers', 'SELECT name, contact_person, phone, email, address, is_active FROM suppliers ORDER BY name'],
  ];

  for (const [name, sql] of sheets) {
    const rows = db.prepare(sql).all();
    const sheet = workbook.addWorksheet(name);
    if (rows.length === 0) {
      sheet.addRow(['(no records)']);
      continue;
    }
    const headers = Object.keys(rows[0]);
    const headerRow = sheet.addRow(headers.map(toTitle));
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
    for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? ''));
    headers.forEach((h, i) => {
      sheet.getColumn(i + 1).width = Math.min(Math.max(h.length + 6, 14), 34);
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return workbook.xlsx.writeBuffer();
}

const toTitle = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
