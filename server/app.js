import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import { getDb } from './db/connection.js';
import { createSessionStore } from './lib/sessionStore.js';
import { loadUser, requireAuth, requirePasswordChange } from './middleware/auth.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { SESSION_SECRET, SESSION_MAX_AGE_MS, WEB_DIST } from './config.js';

import authRoutes from './routes/auth.js';
import drugRoutes from './routes/drugs.js';
import stockRoutes from './routes/stock.js';
import supplierRoutes from './routes/suppliers.js';
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

export function createApp({ serveStatic = true } = {}) {
  const app = express();
  getDb(); // open (and migrate) the database up front so startup fails loudly

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(session({
    name: 'pharmastock.sid',
    secret: SESSION_SECRET,
    // Passed as a function so the store follows the connection across a restore.
    store: createSessionStore(getDb),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      // The app runs over plain HTTP on a local network, so `secure` would
      // stop the cookie being set at all.
      secure: false,
    },
  }));

  app.use(loadUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);

  // Everything past this point requires a signed-in user who has replaced any
  // temporary password. Both guards are server-side on purpose - the client
  // enforces the same rules for usability, never for security.
  app.use('/api', requireAuth);
  app.use('/api', requirePasswordChange);
  app.use('/api/drugs', drugRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api', adminRoutes);

  app.use(notFoundHandler);

  if (serveStatic && fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    // Client-side routing: any non-API path returns the app shell.
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  } else if (serveStatic) {
    app.get('*', (_req, res) =>
      res.status(503).send(
        '<h1>PharmaStock</h1><p>The user interface has not been built yet.</p>' +
        '<p>Run <code>npm run build</code> and restart, or run <code>npm run dev</code> ' +
        'and open the Vite address instead.</p>'
      )
    );
  }

  app.use(errorHandler);

  return app;
}
