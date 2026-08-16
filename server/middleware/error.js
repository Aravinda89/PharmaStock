import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
  }
  next();
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Translate the database's own guardrails into something a pharmacist can act on.
  const message = String(err?.message || '');

  if (message.includes('CHECK constraint failed: quantity_on_hand')) {
    return res.status(400).json({
      error: 'That change would take stock below zero. Please re-check the quantity.',
    });
  }
  if (message.includes('UNIQUE constraint failed: drugs.code')) {
    return res.status(409).json({ error: 'Another drug already uses that drug code.' });
  }
  if (message.includes('UNIQUE constraint failed: users.username')) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  if (message.includes('UNIQUE constraint failed: suppliers.name')) {
    return res.status(409).json({ error: 'A supplier with that name already exists.' });
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({
      error: 'That record is still referenced by stock history and cannot be removed.',
    });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong. The action was not saved.' });
}
