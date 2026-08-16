import PDFDocument from 'pdfkit';

const BRAND = '#1f5f4e';
const MUTED = '#6b7280';
const RULE = '#d7dde3';

const STATUS_COLOURS = {
  EXPIRED: '#b42318',
  OUT_OF_STOCK: '#b42318',
  EXPIRING_SOON: '#b54708',
  LOW: '#b54708',
  GOOD: '#15803d',
  OK: '#15803d',
};

/**
 * Renders the same generic report shape as the Excel exporter into a
 * printable landscape A4 table, paginating and repeating the header row.
 * Returns a Buffer so the route can set Content-Length and stream it once.
 */
export function reportToPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 44, left: 32, right: 32 },
      // Required so the page-number pass below can revisit finished pages.
      bufferPages: true,
      info: { Title: `${report.pharmacyName} - ${report.title}`, Author: 'PharmaStock' },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Share the page proportionally to each column's declared width.
    const totalWeight = report.columns.reduce((s, c) => s + (c.width || 18), 0);
    const widths = report.columns.map((c) => ((c.width || 18) / totalWeight) * pageWidth);

    const drawHeader = () => {
      doc.fillColor(BRAND).fontSize(15).font('Helvetica-Bold')
        .text(report.pharmacyName, { continued: false });
      doc.fillColor('#111827').fontSize(12).font('Helvetica-Bold')
        .text(report.title);
      if (report.subtitle) {
        doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(report.subtitle);
      }
      doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Oblique')
        .text(`Generated ${report.generatedAt}`);
      doc.moveDown(0.5);
    };

    const drawColumnHeadings = () => {
      const y = doc.y;
      doc.rect(doc.page.margins.left, y - 2, pageWidth, 16).fill(BRAND);
      doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');

      let x = doc.page.margins.left;
      report.columns.forEach((col, i) => {
        doc.text(col.label, x + 3, y + 2, {
          width: widths[i] - 6,
          align: col.align === 'right' ? 'right' : 'left',
          lineBreak: false,
        });
        x += widths[i];
      });

      doc.y = y + 18;
    };

    const rowHeight = 13;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - rowHeight;

    drawHeader();
    drawColumnHeadings();

    doc.font('Helvetica').fontSize(7.5);

    report.rows.forEach((row, index) => {
      if (doc.y > bottomLimit) {
        doc.addPage();
        drawColumnHeadings();
        doc.font('Helvetica').fontSize(7.5);
      }

      const y = doc.y;

      // Zebra striping - long inventory lists are much easier to read across.
      if (index % 2 === 1) {
        doc.rect(doc.page.margins.left, y - 2, pageWidth, rowHeight).fill('#f6f8f9');
      }

      let x = doc.page.margins.left;
      report.columns.forEach((col, i) => {
        const raw = row[col.key];
        const value = raw === null || raw === undefined ? '' : String(raw);
        doc.fillColor(STATUS_COLOURS[raw] || '#111827');
        doc.text(value, x + 3, y, {
          width: widths[i] - 6,
          align: col.align === 'right' ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });

      doc.y = y + rowHeight;
    });

    if (report.rows.length === 0) {
      doc.fillColor(MUTED).fontSize(10).font('Helvetica-Oblique')
        .text('No records match this report.', doc.page.margins.left, doc.y + 10);
    }

    if (report.totals && Object.keys(report.totals).length) {
      if (doc.y > bottomLimit - 10) doc.addPage();
      const y = doc.y + 2;
      doc.moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.margins.left + pageWidth, y)
        .strokeColor(RULE).lineWidth(1).stroke();

      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
      let x = doc.page.margins.left;
      report.columns.forEach((col, i) => {
        const value = i === 0 ? 'TOTAL' : (report.totals[col.key] ?? '');
        doc.text(String(value), x + 3, y + 4, {
          width: widths[i] - 6,
          align: col.align === 'right' ? 'right' : 'left',
          lineBreak: false,
        });
        x += widths[i];
      });
    }

    // Page numbers, added once the total page count is known.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(
        `Page ${i - range.start + 1} of ${range.count}   -   PharmaStock`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom + 12,
        { width: pageWidth, align: 'center', lineBreak: false }
      );
    }

    doc.end();
  });
}
