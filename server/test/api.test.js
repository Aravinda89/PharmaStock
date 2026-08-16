import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// The database path is read from the environment when config.js first loads,
// so it must be set before anything imports it - hence the dynamic imports.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmastock-api-'));
process.env.PHARMASTOCK_DB = path.join(dir, 'api-test.db');
process.env.PHARMASTOCK_BACKUP_DIR = path.join(dir, 'backups');
process.env.SESSION_SECRET = 'test-secret';

const { createApp } = await import('../app.js');
const { getDb, closeDb } = await import('../db/connection.js');
const { createUser } = await import('../services/users.js');
const { receiveStock } = await import('../services/receiving.js');
const { addDays, today } = await import('../lib/dates.js');

const db = getDb();
const app = createApp({ serveStatic: false });

const pharmacist = createUser({ username: 'pharm', fullName: 'P', password: 'password123', role: 'PHARMACIST' }, db);
const doctor = createUser({ username: 'doc', fullName: 'D', password: 'password123', role: 'DOCTOR' }, db);
createUser({ username: 'asst', fullName: 'A', password: 'password123', role: 'ASSISTANT' }, db);
createUser({ username: 'asstnorecv', fullName: 'A2', password: 'password123', role: 'ASSISTANT', canReceiveStock: false }, db);

const drugId = db
  .prepare("INSERT INTO drugs (name, strength, form, unit, min_stock_level) VALUES ('Paracetamol','500mg','TABLET','tablet',50)")
  .run().lastInsertRowid;

receiveStock({
  lines: [{ drugId, batchNumber: 'T1', expiryDate: addDays(today(), 300), quantity: 100 }],
}, pharmacist.id, db);

process.on('exit', () => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Signs in and returns an agent that keeps the session cookie. */
async function signIn(username) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password: 'password123' });
  assert.equal(res.status, 200, `login failed for ${username}: ${res.text}`);
  return agent;
}

test('unauthenticated requests are rejected', async () => {
  const res = await request(app).get('/api/drugs');
  assert.equal(res.status, 401);
});

test('login rejects a bad password without revealing whether the user exists', async () => {
  const wrongPassword = await request(app).post('/api/auth/login').send({ username: 'doc', password: 'nope' });
  const noSuchUser = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'nope' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPassword.body.error, noSuchUser.body.error);
});

test('a signed-in user can read the inventory', async () => {
  const agent = await signIn('pharm');
  const res = await agent.get('/api/drugs');

  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].available_qty, 100);
});

test('the doctor can view but cannot dispense, receive or edit', async () => {
  const agent = await signIn('doc');

  assert.equal((await agent.get('/api/drugs')).status, 200);
  assert.equal((await agent.get('/api/dashboard')).status, 200);
  assert.equal((await agent.get('/api/reports/inventory')).status, 200);

  const dispense = await agent.post('/api/stock/dispenses')
    .send({ lines: [{ drugId, quantity: 1 }] });
  assert.equal(dispense.status, 403);

  const receive = await agent.post('/api/stock/receipts')
    .send({ lines: [{ drugId, expiryDate: addDays(today(), 100), quantity: 5 }] });
  assert.equal(receive.status, 403);

  const edit = await agent.post('/api/drugs').send({ name: 'New Drug' });
  assert.equal(edit.status, 403);

  assert.equal((await agent.get('/api/users')).status, 403);
});

test('an assistant can dispense but cannot adjust stock or manage users', async () => {
  const agent = await signIn('asst');

  const dispense = await agent.post('/api/stock/dispenses')
    .send({ patientRef: 'OP-1', lines: [{ drugId, quantity: 10 }] });
  assert.equal(dispense.status, 201);
  assert.equal(dispense.body.lines[0].stockBefore, 100);
  assert.equal(dispense.body.lines[0].stockAfter, 90);

  const batchId = db.prepare('SELECT id FROM batches WHERE batch_number = ?').get('T1').id;
  const adjust = await agent.post('/api/stock/adjustments')
    .send({ batchId, quantityDelta: -5, reason: 'DAMAGE' });
  assert.equal(adjust.status, 403);

  assert.equal((await agent.get('/api/users')).status, 403);
});

test('an assistant with receiving turned off is refused, and can be turned back on', async () => {
  const blocked = await signIn('asstnorecv');

  const attempt = await blocked.post('/api/stock/receipts')
    .send({ lines: [{ drugId, expiryDate: addDays(today(), 200), quantity: 10 }] });
  assert.equal(attempt.status, 403);

  // The pharmacist grants the permission...
  const pharm = await signIn('pharm');
  const target = db.prepare("SELECT id FROM users WHERE username = 'asstnorecv'").get().id;
  const update = await pharm.put(`/api/users/${target}`).send({ canReceiveStock: true });
  assert.equal(update.status, 200);

  // ...and it takes effect immediately, without signing out and back in.
  const retry = await blocked.post('/api/stock/receipts')
    .send({ lines: [{ drugId, expiryDate: addDays(today(), 200), quantity: 10 }] });
  assert.equal(retry.status, 201);
});

test('the API refuses to dispense more than is in stock', async () => {
  const agent = await signIn('pharm');

  const before = (await agent.get(`/api/drugs/${drugId}`)).body.drug.available_qty;

  const res = await agent.post('/api/stock/dispenses')
    .send({ lines: [{ drugId, quantity: before + 500 }] });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /Only \d+ available/);

  const after = (await agent.get(`/api/drugs/${drugId}`)).body.drug.available_qty;
  assert.equal(after, before, 'a refused dispense must not change stock');
});

test('validation errors come back as a plain sentence', async () => {
  const agent = await signIn('pharm');

  const res = await agent.post('/api/stock/receipts')
    .send({ lines: [{ drugId, expiryDate: 'not-a-date', quantity: 5 }] });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /expiry date/i);
});

test('reports export as real xlsx and pdf files', async () => {
  const agent = await signIn('pharm');

  // responseType('blob') makes supertest hand back a Buffer rather than trying
  // to JSON-parse the binary payload.
  const xlsx = await agent.get('/api/reports/inventory/export/xlsx').responseType('blob');
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers['content-type'], /spreadsheetml/);
  // xlsx files are zip archives - check the magic bytes.
  assert.equal(xlsx.body.subarray(0, 2).toString('binary'), 'PK');

  const pdf = await agent
    .get('/api/reports/movement/export/pdf?from=2000-01-01&to=2100-01-01')
    .responseType('blob');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString('binary'), '%PDF');
});

test('a date-range report insists on a date range', async () => {
  const agent = await signIn('pharm');
  const res = await agent.get('/api/reports/dispensed');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /start and end date/i);
});

test('the integrity check reports a clean ledger', async () => {
  const agent = await signIn('pharm');
  const res = await agent.get('/api/stock/integrity');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.discrepancies, []);
});

test('signing out ends the session', async () => {
  const agent = await signIn('pharm');
  assert.equal((await agent.get('/api/drugs')).status, 200);

  await agent.post('/api/auth/logout');
  assert.equal((await agent.get('/api/drugs')).status, 401);
});
