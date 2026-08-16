import session from 'express-session';

/**
 * Sessions in the same SQLite file as everything else.
 *
 * Fifty lines beats another dependency and another file to back up: when the
 * pharmacy copies pharmastock.db, sessions come with it, and a restart does
 * not sign everyone out.
 */
/**
 * `resolveDb` is called on every operation rather than a connection being
 * captured once. Restoring a backup swaps the underlying connection, and
 * statements prepared against the old one would throw on every subsequent
 * request - which would leave the app unusable at exactly the moment the user
 * needs it most.
 */
export function createSessionStore(resolveDb, { cleanupIntervalMs = 60 * 60 * 1000 } = {}) {
  const db = () => (typeof resolveDb === 'function' ? resolveDb() : resolveDb);

  class SqliteSessionStore extends session.Store {
    constructor() {
      super();
      this.timer = setInterval(() => this.prune(), cleanupIntervalMs);
      this.timer.unref?.();
    }

    prune() {
      try {
        db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      } catch {
        // A failed prune is harmless - expired rows are ignored on read anyway.
      }
    }

    get(sid, cb) {
      try {
        const row = db().prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at < Date.now()) {
          db().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.data));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        const maxAge = sess.cookie?.maxAge ?? 12 * 60 * 60 * 1000;
        db()
          .prepare(
            `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
             ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
          )
          .run(sid, JSON.stringify(sess), Date.now() + maxAge);
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    touch(sid, sess, cb) {
      return this.set(sid, sess, cb);
    }

    destroy(sid, cb) {
      try {
        db().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }
  }

  return new SqliteSessionStore();
}
