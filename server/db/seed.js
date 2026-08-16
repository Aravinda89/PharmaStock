import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from './connection.js';
import { getSetting, setSettings } from '../services/settings.js';
import { hashPassword } from '../services/users.js';
import { receiveStock } from '../services/receiving.js';
import { dispenseStock } from '../services/dispensing.js';
import { today, addDays } from '../lib/dates.js';

/**
 * The four staff accounts from the requirements. Passwords are placeholders -
 * every account is flagged must_change_password, so each person is forced to
 * set their own the first time they sign in.
 */
const SEED_USERS = [
  { username: 'doctor', fullName: 'Dr. Ramesh Kumar', role: 'DOCTOR', password: 'doctor123' },
  { username: 'pharmacist', fullName: 'Anita Pharmacist', role: 'PHARMACIST', password: 'pharma123' },
  { username: 'assistant1', fullName: 'Suresh Assistant', role: 'ASSISTANT', password: 'assist123' },
  { username: 'assistant2', fullName: 'Priya Assistant', role: 'ASSISTANT', password: 'assist123' },
];

export function ensureSeedUsers(db = getDb()) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (existing > 0) return { created: 0 };

  const insert = db.prepare(
    `INSERT INTO users (username, full_name, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, 1)`
  );

  db.transaction(() => {
    for (const user of SEED_USERS) {
      insert.run(user.username, user.fullName, hashPassword(user.password), user.role);
    }
  })();

  console.log('  Created the four starter accounts (each must set a new password at first sign-in):');
  for (const u of SEED_USERS) {
    console.log(`    ${u.username.padEnd(12)} / ${u.password.padEnd(10)}  ${u.role}`);
  }

  return { created: SEED_USERS.length };
}

const SUPPLIERS = [
  { name: 'MedSupply Distributors', contact_person: 'Ravi Nair', phone: '+91 98400 11223', email: 'orders@medsupply.example' },
  { name: 'HealthLine Pharma', contact_person: 'Fatima Sheikh', phone: '+91 98400 44556', email: 'sales@healthline.example' },
  { name: 'CarePlus Wholesale', contact_person: 'John Mathew', phone: '+91 98400 77889', email: 'info@careplus.example' },
];

const DRUGS = [
  { code: 'PAR500', name: 'Paracetamol', generic_name: 'Acetaminophen', strength: '500mg', form: 'TABLET', unit: 'tablet', min_stock_level: 200, storage_location: 'Shelf A1' },
  { code: 'AMX500', name: 'Amoxicillin', generic_name: 'Amoxicillin', strength: '500mg', form: 'CAPSULE', unit: 'capsule', min_stock_level: 100, storage_location: 'Shelf A2' },
  { code: 'IBU400', name: 'Ibuprofen', generic_name: 'Ibuprofen', strength: '400mg', form: 'TABLET', unit: 'tablet', min_stock_level: 150, storage_location: 'Shelf A1' },
  { code: 'CET10', name: 'Cetirizine', generic_name: 'Cetirizine HCl', strength: '10mg', form: 'TABLET', unit: 'tablet', min_stock_level: 80, storage_location: 'Shelf B1' },
  { code: 'AMOXSYR', name: 'Amoxicillin Syrup', generic_name: 'Amoxicillin', strength: '125mg/5ml', form: 'SYRUP', unit: 'bottle', min_stock_level: 20, storage_location: 'Shelf C1' },
  { code: 'MET500', name: 'Metformin', generic_name: 'Metformin HCl', strength: '500mg', form: 'TABLET', unit: 'tablet', min_stock_level: 120, storage_location: 'Shelf B2' },
  { code: 'AML5', name: 'Amlodipine', generic_name: 'Amlodipine Besylate', strength: '5mg', form: 'TABLET', unit: 'tablet', min_stock_level: 100, storage_location: 'Shelf B2' },
  { code: 'OME20', name: 'Omeprazole', generic_name: 'Omeprazole', strength: '20mg', form: 'CAPSULE', unit: 'capsule', min_stock_level: 90, storage_location: 'Shelf B1' },
  { code: 'SALINH', name: 'Salbutamol Inhaler', generic_name: 'Salbutamol', strength: '100mcg', form: 'INHALER', unit: 'inhaler', min_stock_level: 10, storage_location: 'Shelf C2' },
  { code: 'CEFINJ', name: 'Ceftriaxone Injection', generic_name: 'Ceftriaxone', strength: '1g', form: 'INJECTION', unit: 'vial', min_stock_level: 15, storage_location: 'Fridge 1' },
  { code: 'ORS', name: 'ORS Sachets', generic_name: 'Oral Rehydration Salts', strength: '20.5g', form: 'OTHER', unit: 'sachet', min_stock_level: 50, storage_location: 'Shelf D1' },
  { code: 'HYDCRM', name: 'Hydrocortisone Cream', generic_name: 'Hydrocortisone', strength: '1%', form: 'CREAM', unit: 'tube', min_stock_level: 12, storage_location: 'Shelf C3' },
];

/**
 * Demo data that exercises every alert state, so the dashboard is worth
 * looking at the moment the pharmacy opens the app for the first time.
 */
export function seedDemoData(db = getDb()) {
  const pharmacist = db.prepare("SELECT id FROM users WHERE role = 'PHARMACIST' LIMIT 1").get();
  const assistant = db.prepare("SELECT id FROM users WHERE role = 'ASSISTANT' LIMIT 1").get();
  if (!pharmacist) throw new Error('Seed the users first.');

  // Everything created below is tagged is_sample = 1 so the pharmacy can wipe
  // it in one action when it starts recording real stock.
  const supplierIds = SUPPLIERS.map((s) => {
    const existing = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(s.name);
    if (existing) return existing.id;
    return db
      .prepare('INSERT INTO suppliers (name, contact_person, phone, email, is_sample) VALUES (?, ?, ?, ?, 1)')
      .run(s.name, s.contact_person, s.phone, s.email).lastInsertRowid;
  });

  const drugIds = DRUGS.map((d, i) => {
    const existing = db.prepare('SELECT id FROM drugs WHERE code = ?').get(d.code);
    if (existing) return existing.id;
    return db
      .prepare(
        `INSERT INTO drugs (code, name, generic_name, strength, form, unit,
                            min_stock_level, default_supplier_id, storage_location, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(d.code, d.name, d.generic_name, d.strength, d.form, d.unit,
           d.min_stock_level, supplierIds[i % supplierIds.length], d.storage_location)
      .lastInsertRowid;
  });

  if (db.prepare('SELECT COUNT(*) AS n FROM goods_receipts').get().n > 0) {
    console.log('  Demo stock already present - skipping.');
    return;
  }

  // Anything the receive/dispense services create after this point belongs to
  // the demo, and is tagged at the end by comparing against these watermarks.
  const receiptWatermark = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM goods_receipts').get().n;
  const dispenseWatermark = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM dispenses').get().n;

  const d = (n) => addDays(today(), n);

  // A healthy bulk delivery 60 days ago.
  receiveStock({
    supplierId: supplierIds[0],
    invoiceNo: 'INV-8841',
    receivedDate: addDays(today(), -60),
    notes: 'Monthly bulk order',
    lines: [
      { drugId: drugIds[0], batchNumber: 'PAR-A231', expiryDate: d(540), quantity: 1000, unitCost: 0.8 },
      { drugId: drugIds[1], batchNumber: 'AMX-B117', expiryDate: d(400), quantity: 400, unitCost: 3.2 },
      { drugId: drugIds[2], batchNumber: 'IBU-C902', expiryDate: d(620), quantity: 600, unitCost: 1.1 },
      { drugId: drugIds[5], batchNumber: 'MET-D551', expiryDate: d(500), quantity: 500, unitCost: 0.9 },
      { drugId: drugIds[6], batchNumber: 'AML-E223', expiryDate: d(450), quantity: 300, unitCost: 1.4 },
    ],
  }, pharmacist.id, db);

  // A more recent delivery, including stock that is close to expiry.
  receiveStock({
    supplierId: supplierIds[1],
    invoiceNo: 'INV-9032',
    receivedDate: addDays(today(), -20),
    notes: 'Top-up order',
    lines: [
      { drugId: drugIds[3], batchNumber: 'CET-F310', expiryDate: d(45), quantity: 120, unitCost: 0.5 },
      { drugId: drugIds[4], batchNumber: 'SYR-G118', expiryDate: d(70), quantity: 30, unitCost: 22 },
      { drugId: drugIds[7], batchNumber: 'OME-H447', expiryDate: d(25), quantity: 150, unitCost: 2.1 },
      { drugId: drugIds[8], batchNumber: 'SAL-J009', expiryDate: d(300), quantity: 14, unitCost: 145 },
      { drugId: drugIds[10], batchNumber: 'ORS-K771', expiryDate: d(200), quantity: 200, unitCost: 4.5 },
    ],
  }, pharmacist.id, db);

  // An older delivery that has already expired - shows the red alerts working.
  receiveStock({
    supplierId: supplierIds[2],
    invoiceNo: 'INV-7710',
    receivedDate: addDays(today(), -400),
    notes: 'Older order - some stock now expired',
    lines: [
      { drugId: drugIds[9], batchNumber: 'CEF-L204', expiryDate: d(-30), quantity: 20, unitCost: 68 },
      { drugId: drugIds[11], batchNumber: 'HYD-M615', expiryDate: d(-8), quantity: 10, unitCost: 32 },
      { drugId: drugIds[0], batchNumber: 'PAR-Z001', expiryDate: d(-60), quantity: 100, unitCost: 0.75 },
    ],
  }, pharmacist.id, db);

  // A second Paracetamol batch expiring sooner than the big one, so FEFO has
  // something meaningful to choose between.
  receiveStock({
    supplierId: supplierIds[0],
    invoiceNo: 'INV-9110',
    receivedDate: addDays(today(), -5),
    lines: [
      { drugId: drugIds[0], batchNumber: 'PAR-B442', expiryDate: d(80), quantity: 300, unitCost: 0.82 },
    ],
  }, pharmacist.id, db);

  // Everyday dispensing across the last two weeks.
  const dispenseDays = [
    { day: -12, ref: 'OP-1041', name: 'Kavita R.', lines: [[0, 20], [2, 10]] },
    { day: -9, ref: 'OP-1058', name: 'Mohan S.', lines: [[1, 21], [0, 15]] },
    { day: -7, ref: 'OP-1063', name: 'Latha M.', lines: [[5, 60], [6, 30]] },
    { day: -5, ref: 'OP-1077', name: 'Arjun P.', lines: [[3, 30], [7, 28]] },
    { day: -3, ref: 'OP-1090', name: 'Devi K.', lines: [[0, 30], [10, 20]] },
    { day: -2, ref: 'OP-1104', name: 'Ganesh V.', lines: [[8, 2], [4, 4]] },
    { day: -1, ref: 'OP-1118', name: 'Meera J.', lines: [[2, 24], [5, 90]] },
    { day: 0, ref: 'OP-1125', name: 'Rahul T.', lines: [[0, 10], [1, 14]] },
  ];

  for (const entry of dispenseDays) {
    dispenseStock({
      patientRef: entry.ref,
      patientName: entry.name,
      dispensedAt: `${addDays(today(), entry.day)} 10:30:00`,
      lines: entry.lines.map(([drugIndex, qty]) => ({ drugId: drugIds[drugIndex], quantity: qty })),
    }, entry.day % 2 === 0 ? pharmacist.id : (assistant?.id ?? pharmacist.id), db);
  }

  // Push one drug below its minimum so the low-stock alert has a real example.
  dispenseStock({
    patientRef: 'OP-1130',
    patientName: 'Ward stock',
    notes: 'Ward top-up',
    lines: [{ drugId: drugIds[3], quantity: 55 }],
  }, pharmacist.id, db);

  db.prepare('UPDATE goods_receipts SET is_sample = 1 WHERE id > ?').run(receiptWatermark);
  db.prepare('UPDATE dispenses SET is_sample = 1 WHERE id > ?').run(dispenseWatermark);
  setSettings({ sample_data_seeded: '1' }, null, db);

  console.log('  Demo inventory created: 12 drugs, 4 deliveries, 9 dispensing records.');
  console.log('  It includes expired stock, stock expiring soon, and low stock,');
  console.log('  so every dashboard alert has something to show.');
  console.log('  Remove it any time from Settings -> Sample data.');
}

/** Counts behind the "this is sample data" banner and the removal dialog. */
export function sampleDataSummary(db = getDb()) {
  const drugs = db.prepare('SELECT COUNT(*) AS n FROM drugs WHERE is_sample = 1').get().n;
  if (drugs === 0) {
    return { present: false, drugs: 0, batches: 0, movements: 0, receipts: 0, dispenses: 0, suppliers: 0 };
  }

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM batches WHERE drug_id IN (SELECT id FROM drugs WHERE is_sample = 1)) AS batches,
         (SELECT COUNT(*) FROM stock_ledger WHERE drug_id IN (SELECT id FROM drugs WHERE is_sample = 1)) AS movements,
         (SELECT COUNT(*) FROM goods_receipts WHERE is_sample = 1) AS receipts,
         (SELECT COUNT(*) FROM dispenses WHERE is_sample = 1) AS dispenses,
         (SELECT COUNT(*) FROM suppliers WHERE is_sample = 1) AS suppliers`
    )
    .get();

  return { present: true, drugs, ...counts };
}

/**
 * Remove every sample record, leaving anything real untouched.
 *
 * Deletion runs child-first so foreign keys never block it. A delivery or
 * dispense that also contains real drugs keeps its real lines and survives -
 * only genuinely empty sample headers are removed.
 */
export function removeSampleData(db = getDb()) {
  const summary = sampleDataSummary(db);
  if (!summary.present) return { removed: false, ...summary };

  return db.transaction(() => {
    const sampleDrugs = 'SELECT id FROM drugs WHERE is_sample = 1';

    db.prepare(`DELETE FROM stock_ledger WHERE drug_id IN (${sampleDrugs})`).run();
    db.prepare(`DELETE FROM dispense_lines WHERE drug_id IN (${sampleDrugs})`).run();
    db.prepare(`DELETE FROM goods_receipt_lines WHERE drug_id IN (${sampleDrugs})`).run();
    db.prepare(`DELETE FROM stock_adjustments WHERE drug_id IN (${sampleDrugs})`).run();
    db.prepare(`DELETE FROM batches WHERE drug_id IN (${sampleDrugs})`).run();

    db.prepare(
      `DELETE FROM dispenses
       WHERE is_sample = 1 AND id NOT IN (SELECT DISTINCT dispense_id FROM dispense_lines)`
    ).run();
    db.prepare(
      `DELETE FROM goods_receipts
       WHERE is_sample = 1 AND id NOT IN (SELECT DISTINCT goods_receipt_id FROM goods_receipt_lines)`
    ).run();

    db.prepare('DELETE FROM drugs WHERE is_sample = 1').run();

    // A sample supplier is kept if real records now point at it.
    db.prepare(
      `DELETE FROM suppliers
       WHERE is_sample = 1
         AND id NOT IN (SELECT supplier_id FROM goods_receipts WHERE supplier_id IS NOT NULL)
         AND id NOT IN (SELECT default_supplier_id FROM drugs WHERE default_supplier_id IS NOT NULL)
         AND id NOT IN (SELECT supplier_id FROM batches WHERE supplier_id IS NOT NULL)`
    ).run();

    return { removed: true, ...summary };
  })();
}

/**
 * First-run showcase. A brand-new install opens on an empty dashboard with
 * nothing to click, which teaches nobody anything - so the first start fills
 * it with a worked example of a pharmacy in mid-flow.
 *
 * Runs only when the catalogue is genuinely empty AND the demo has never been
 * created before, so removing the sample data is permanent.
 */
export function ensureFirstRunExample(db = getDb()) {
  if (getSetting('sample_data_seeded', db) === '1') return { seeded: false };
  if (db.prepare('SELECT COUNT(*) AS n FROM drugs').get().n > 0) {
    // A real catalogue already exists - never inject sample data into it.
    setSettings({ sample_data_seeded: '1' }, null, db);
    return { seeded: false };
  }

  console.log('  Setting up an example inventory so you can see how the system works.');
  seedDemoData(db);
  return { seeded: true };
}

// Run directly: `npm run seed` or `npm run seed:demo`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = getDb();
  ensureSeedUsers(db);
  if (process.argv.includes('--demo')) seedDemoData(db);
  closeDb();
  console.log('\n  Done.\n');
}
