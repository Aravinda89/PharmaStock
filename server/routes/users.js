import { Router } from 'express';
import { z } from 'zod';
import { validate, asyncHandler } from '../middleware/validate.js';
import { requirePermission, recordAudit } from '../middleware/auth.js';
import { PERMISSIONS, ROLES } from '../lib/permissions.js';
import { boolish } from '../lib/zod.js';
import { listUsers, createUser, updateUser, resetPassword, deleteUser } from '../services/users.js';

const router = Router();

router.use(requirePermission(PERMISSIONS.USERS_MANAGE));

const createSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters.').max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dot, dash and underscore.'),
  fullName: z.string().trim().min(1, 'Enter the person\'s full name.').max(120),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose a role.' }) }),
  canReceiveStock: boolish(true),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  canReceiveStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ items: listUsers(), roles: ROLES });
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const user = createUser(req.body);
  recordAudit(req.user.id, 'CREATE_USER', 'users', user.id, { username: user.username, role: user.role });
  res.status(201).json(user);
}));

router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  const user = updateUser(Number(req.params.id), req.body, req.user.id);
  recordAudit(req.user.id, 'UPDATE_USER', 'users', user.id, req.body);
  res.json(user);
}));

router.post('/:id/reset-password', validate(z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters.'),
})), asyncHandler(async (req, res) => {
  resetPassword(Number(req.params.id), req.body.newPassword);
  recordAudit(req.user.id, 'RESET_PASSWORD', 'users', Number(req.params.id));
  res.json({ ok: true, message: 'Password reset. The user must change it at next sign-in.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(deleteUser(Number(req.params.id), req.user.id));
}));

export default router;
