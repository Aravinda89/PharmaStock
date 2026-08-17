import { getDb } from '../db/connection.js';
import { can } from '../lib/permissions.js';
import { unauthorized, forbidden } from '../lib/errors.js';

/**
 * Loads the current user fresh from the database on every request, so a
 * deactivated account or a changed role takes effect immediately rather than
 * lingering until the session expires.
 */
export function loadUser(req, _res, next) {
  req.user = null;
  const userId = req.session?.userId;
  if (userId) {
    const user = getDb()
      .prepare(
        `SELECT id, username, full_name, role, can_receive_stock, is_active,
                must_change_password, last_login_at
         FROM users WHERE id = ?`
      )
      .get(userId);

    if (user && user.is_active) {
      req.user = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * A user carrying a temporary password (a fresh install, or a pharmacist-issued
 * reset) may do nothing but set a real one.
 *
 * This has to live on the server. The client also redirects to the change-password
 * screen, but a client-side check is decoration: anything that can send an HTTP
 * request bypasses it entirely, which would leave the seeded starter accounts
 * usable over the network by anyone who has read the setup instructions.
 */
const PASSWORD_CHANGE_ALLOWED = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/change-password',
]);

export function requirePasswordChange(req, _res, next) {
  if (!req.user?.must_change_password) return next();
  if (PASSWORD_CHANGE_ALLOWED.has(req.path)) return next();

  return next(
    forbidden('Please choose your own password before using the system.')
  );
}

/**
 * Route guard. The UI hides buttons the user cannot use, but this is what
 * actually enforces it.
 */
export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, permission)) {
      return next(
        forbidden(
          `Your role (${req.user.role.toLowerCase()}) is not allowed to perform this action.`
        )
      );
    }
    next();
  };
}

export function recordAudit(userId, action, entity = null, entityId = null, details = null) {
  try {
    getDb()
      .prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
      )
      .run(userId ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null);
  } catch {
    // Audit logging must never break the operation it is recording.
  }
}
