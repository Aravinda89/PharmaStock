import { Router } from 'express';
import { z } from 'zod';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requireAuth, recordAudit } from '../middleware/auth.js';
import { authenticate, toPublic, changeOwnPassword } from '../services/users.js';
import { getDb } from '../db/connection.js';
import { getAllSettings } from '../services/settings.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.'),
});

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const user = authenticate(req.body.username, req.body.password);

  // Fresh session id on login so a pre-existing cookie cannot be reused.
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  req.session.userId = user.id;
  await new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

  recordAudit(user.id, 'LOGIN', 'users', user.id);
  res.json({ user, settings: getAllSettings() });
}));

router.post('/logout', (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy(() => {
    if (userId) recordAudit(userId, 'LOGOUT', 'users', userId);
    res.clearCookie('pharmastock.sid');
    res.json({ ok: true });
  });
});

/** Called on every page load - tells the UI who is signed in and what they may do. */
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, settings: getAllSettings() });

  const full = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: toPublic(full), settings: getAllSettings() });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters.'),
});

router.post('/change-password', requireAuth, validate(passwordSchema), asyncHandler(async (req, res) => {
  changeOwnPassword(req.user.id, req.body.currentPassword, req.body.newPassword);
  recordAudit(req.user.id, 'CHANGE_PASSWORD', 'users', req.user.id);
  res.json({ ok: true, message: 'Your password has been changed.' });
}));

export default router;
