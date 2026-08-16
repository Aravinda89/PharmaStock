import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../db/connection.js';
import { hashPassword } from '../services/users.js';
import { addDays, today } from '../lib/dates.js';

/**
 * A throwaway database per test file. Services accept an explicit `db`
 * argument precisely so tests never touch the real pharmacy data.
 */
export function makeTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmastock-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDatabase(dbPath);

  db.cleanup = () => {
    try {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows sometimes holds the file briefly; the temp dir is disposable.
    }
  };

  return db;
}

export function makeUser(db, { username = 'tester', role = 'PHARMACIST', canReceiveStock = 1 } = {}) {
  return db
    .prepare(
      `INSERT INTO users (username, full_name, password_hash, role, can_receive_stock)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username, `Test ${role}`, hashPassword('password123'), role, canReceiveStock)
    .lastInsertRowid;
}

export function makeDrug(db, overrides = {}) {
  const drug = {
    code: null,
    name: 'Test Drug',
    strength: '500mg',
    form: 'TABLET',
    unit: 'tablet',
    min_stock_level: 0,
    ...overrides,
  };

  return db
    .prepare(
      `INSERT INTO drugs (code, name, strength, form, unit, min_stock_level)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(drug.code, drug.name, drug.strength, drug.form, drug.unit, drug.min_stock_level)
    .lastInsertRowid;
}

/** Days from today as a YYYY-MM-DD string - `-5` means expired five days ago. */
export const inDays = (n) => addDays(today(), n);

export const availableOf = (db, drugId) =>
  db.prepare('SELECT available_qty FROM v_drug_stock WHERE drug_id = ?').get(drugId).available_qty;

export const onHandOf = (db, batchId) =>
  db.prepare('SELECT quantity_on_hand FROM batches WHERE id = ?').get(batchId).quantity_on_hand;
