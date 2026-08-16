import bcrypt from 'bcryptjs';
import { getDb } from '../db/connection.js';
import { notFound, badRequest, unauthorized } from '../lib/errors.js';
import { permissionsFor } from '../lib/permissions.js';

const SALT_ROUNDS = 10;
const PUBLIC_FIELDS = `id, username, full_name, role, can_receive_stock, is_active,
                       must_change_password, last_login_at, created_at`;

export function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function authenticate(username, password, db = getDb()) {
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim());

  // Same message either way - never reveal which usernames exist.
  const failure = unauthorized('Incorrect username or password.');

  if (!user) {
    // Constant-ish work even for unknown users, so response time does not leak.
    bcrypt.compareSync(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw failure;
  }
  if (!user.is_active) {
    throw unauthorized('This account has been deactivated. Ask the pharmacist to re-enable it.');
  }
  if (!bcrypt.compareSync(password, user.password_hash)) throw failure;

  db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(user.id);

  return toPublic(user);
}

export function listUsers(db = getDb()) {
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY role, full_name`).all();
}

export function getUser(id, db = getDb()) {
  const user = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(id);
  if (!user) throw notFound('That user was not found.');
  return user;
}

export function createUser({ username, fullName, password, role, canReceiveStock = true }, db = getDb()) {
  assertPasswordStrength(password);

  const result = db
    .prepare(
      `INSERT INTO users (username, full_name, password_hash, role, can_receive_stock)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username.trim(), fullName.trim(), hashPassword(password), role, canReceiveStock ? 1 : 0);

  return getUser(result.lastInsertRowid, db);
}

export function updateUser(id, { fullName, role, canReceiveStock, isActive }, actingUserId, db = getDb()) {
  const user = getUser(id, db);

  // Guard rails so the pharmacy cannot lock itself out of its own system.
  if (user.role === 'PHARMACIST' && (role !== undefined && role !== 'PHARMACIST' || isActive === false)) {
    const others = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'PHARMACIST' AND is_active = 1 AND id <> ?")
      .get(id).n;
    if (others === 0) {
      throw badRequest(
        'This is the only active pharmacist. Create or activate another pharmacist first, ' +
          'otherwise nobody could manage the system.'
      );
    }
  }
  if (Number(id) === Number(actingUserId) && isActive === false) {
    throw badRequest('You cannot deactivate your own account while signed in.');
  }

  db.prepare(
    `UPDATE users
     SET full_name = COALESCE(?, full_name),
         role = COALESCE(?, role),
         can_receive_stock = COALESCE(?, can_receive_stock),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    fullName ?? null,
    role ?? null,
    canReceiveStock === undefined ? null : Number(Boolean(canReceiveStock)),
    isActive === undefined ? null : Number(Boolean(isActive)),
    id
  );

  return getUser(id, db);
}

/** Pharmacist resets someone else's password; they must change it on next login. */
export function resetPassword(id, newPassword, db = getDb()) {
  assertPasswordStrength(newPassword);
  getUser(id, db);
  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 1,
                      updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(hashPassword(newPassword), id);
  return { reset: true };
}

/** A user changing their own password must prove they know the current one. */
export function changeOwnPassword(id, currentPassword, newPassword, db = getDb()) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('User not found.');
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    throw badRequest('Your current password is not correct.');
  }
  assertPasswordStrength(newPassword);

  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0,
                      updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(hashPassword(newPassword), id);

  return { changed: true };
}

export function deleteUser(id, actingUserId, db = getDb()) {
  if (Number(id) === Number(actingUserId)) {
    throw badRequest('You cannot delete your own account.');
  }
  const user = getUser(id, db);

  const hasHistory = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM stock_ledger WHERE user_id = ?) +
              (SELECT COUNT(*) FROM dispenses WHERE dispensed_by_user_id = ?) +
              (SELECT COUNT(*) FROM goods_receipts WHERE received_by_user_id = ?) AS n`
    )
    .get(id, id, id).n;

  if (hasHistory > 0) {
    throw badRequest(
      `${user.full_name} appears in stock history and cannot be deleted. ` +
        'Deactivate the account instead - that blocks sign-in but keeps the audit trail.'
    );
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { deleted: true };
}

export function toPublic(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    canReceiveStock: Boolean(user.can_receive_stock),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    permissions: permissionsFor(user),
  };
}

function assertPasswordStrength(password) {
  if (!password || password.length < 6) {
    throw badRequest('Password must be at least 6 characters.');
  }
}
