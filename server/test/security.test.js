import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmastock-sec-'));
process.env.PHARMASTOCK_DB = path.join(dir, 'sec.db');
process.env.PHARMASTOCK_BACKUP_DIR = path.join(dir, 'backups');
process.env.PHARMASTOCK_DATA_DIR = path.join(dir, 'data');
delete process.env.SESSION_SECRET;

const { createApp } = await import('../app.js');
const { getDb, closeDb } = await import('../db/connection.js');
const { ensureSeedUsers, generateTemporaryPassword } = await import('../db/seed.js');
const { createUser, resetPassword } = await import('../services/users.js');

const db = getDb();
const app = createApp({ serveStatic: false });
const seeded = ensureSeedUsers(db);

process.on('exit', () => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const login = async (username, password) => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  return { agent, res };
};

test('starter accounts do not ship with a password baked into the source', () => {
  // The exact strings that used to be hardcoded, and were published in the repo.
  const leaked = ['pharma123', 'doctor123', 'assist123'];
  for (const account of seeded.accounts) {
    assert.ok(!leaked.includes(account.password), 'starter password must not be a source literal');
    assert.ok(account.password.length >= 10);
  }

  // Distinct per account and per install.
  const passwords = seeded.accounts.map((a) => a.password);
  assert.equal(new Set(passwords).size, passwords.length, 'each account gets its own password');
  assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword());
});

test('the old published default credentials are rejected', async () => {
  for (const [username, password] of [
    ['pharmacist', 'pharma123'],
    ['doctor', 'doctor123'],
    ['assistant1', 'assist123'],
  ]) {
    const { res } = await login(username, password);
    assert.equal(res.status, 401, `${username}/${password} must not authenticate`);
  }
});

test('a temporary password grants a session but no access to anything else', async () => {
  const account = seeded.accounts.find((a) => a.role === 'PHARMACIST');
  const { agent, res } = await login(account.username, account.password);

  assert.equal(res.status, 200);
  assert.equal(res.body.user.mustChangePassword, true);

  // This is the bypass being closed: a raw HTTP client never sees the UI's
  // change-password screen, so the server has to refuse the work itself.
  const blocked = [
    ['get', '/api/drugs'],
    ['get', '/api/dashboard'],
    ['get', '/api/backups'],
    ['get', '/api/users'],
    ['get', '/api/reports/inventory'],
    ['post', '/api/stock/dispenses'],
    ['post', '/api/stock/receipts'],
  ];

  for (const [method, url] of blocked) {
    const response = await agent[method](url).send({});
    assert.equal(response.status, 403, `${method.toUpperCase()} ${url} must be refused`);
    assert.match(response.body.error, /choose your own password/i);
  }
});

test('backups cannot be downloaded with a temporary password', async () => {
  const account = seeded.accounts.find((a) => a.role === 'PHARMACIST');
  const { agent } = await login(account.username, account.password);

  const res = await agent.get('/api/backups/anything.db/download');
  assert.equal(res.status, 403);
});

test('changing the password is allowed, and lifts the restriction immediately', async () => {
  const account = seeded.accounts.find((a) => a.role === 'DOCTOR');
  const { agent } = await login(account.username, account.password);

  assert.equal((await agent.get('/api/drugs')).status, 403);

  const changed = await agent.post('/api/auth/change-password').send({
    currentPassword: account.password,
    newPassword: 'a-properly-chosen-password',
  });
  assert.equal(changed.status, 200);

  // Same session, no re-login needed.
  assert.equal((await agent.get('/api/drugs')).status, 200);
});

test('a pharmacist-issued reset re-locks the account until the user sets a password', async () => {
  const user = createUser(
    { username: 'temp.user', fullName: 'Temp User', password: 'initial-password', role: 'ASSISTANT' },
    db
  );

  const first = await login('temp.user', 'initial-password');
  assert.equal((await first.agent.get('/api/drugs')).status, 200, 'normal account works');

  resetPassword(user.id, 'reset-by-pharmacist', db);

  const second = await login('temp.user', 'reset-by-pharmacist');
  assert.equal(second.res.status, 200);
  assert.equal(
    (await second.agent.get('/api/drugs')).status,
    403,
    'a reset account must be locked down again'
  );

  // The already-open session from before the reset is re-checked per request too.
  assert.equal((await first.agent.get('/api/drugs')).status, 403);
});

test('the session secret is generated per install, not a source literal', async () => {
  const { SESSION_SECRET } = await import('../config.js');

  assert.notEqual(SESSION_SECRET, 'pharmastock-local-session-secret-change-me');
  assert.ok(SESSION_SECRET.length >= 32, 'secret should be long enough to be unguessable');
  assert.match(SESSION_SECRET, /^[0-9a-f]+$/, 'expected random hex');

  // Persisted, so restarting does not sign everyone out.
  const stored = fs.readFileSync(path.join(dir, 'data', 'session-secret'), 'utf8').trim();
  assert.equal(stored, SESSION_SECRET);
});

test('backup filenames that try to escape the folder are rejected', async () => {
  const account = seeded.accounts.find((a) => a.role === 'PHARMACIST');
  const { agent } = await login(account.username, account.password);
  await agent.post('/api/auth/change-password').send({
    currentPassword: account.password,
    newPassword: 'another-properly-chosen-password',
  });

  for (const attempt of [
    '..%2F..%2Fpharmastock.db',
    '..%5C..%5Cpharmastock.db',
    '%2Fetc%2Fpasswd',
    'notadatabase.txt',
  ]) {
    const res = await agent.get(`/api/backups/${attempt}/download`);
    assert.ok(res.status >= 400, `${attempt} must not be served`);
    assert.ok(res.status !== 200);
  }
});
