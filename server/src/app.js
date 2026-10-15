import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { forbidden } from './utils/errors.js';
import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import ticketRoutes from './routes/tickets.js';
import eventRoutes from './routes/events.js';
import adminRoutes from './routes/admin.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (on top of SameSite=Strict cookies): every state-changing request
 * must carry a custom header. Browsers can't add custom headers to cross-site form posts,
 * and cross-origin fetches with one require a CORS preflight, which this API never grants.
 */
function requireCsrfHeader(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.get('X-Requested-With') === 'XMLHttpRequest') return next();
  next(forbidden('Missing X-Requested-With header'));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1); // behind Render/Railway proxy: real client IP for rate limits

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use(requireCsrfHeader);
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.use('/auth', authRoutes);
  api.use('/books', requireAuth, bookRoutes);
  api.use('/tickets', requireAuth, ticketRoutes);
  api.use('/events', requireAuth, eventRoutes);
  api.use('/admin', requireAuth, adminRoutes);
  api.use(notFoundHandler);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, api);

  // In production the built React app is served from the same origin as the API.
  if (fs.existsSync(config.clientDistPath)) {
    app.use(express.static(config.clientDistPath, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(config.clientDistPath, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
