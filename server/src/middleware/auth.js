import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { unauthorized, forbidden } from '../utils/errors.js';

const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'bookleaf-support', audience: 'bookleaf-portal' };

export function signSession(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    ...JWT_OPTIONS,
    expiresIn: config.sessionTtlSeconds,
  });
}

// The token lives in an httpOnly cookie, so page JavaScript (and any XSS) can't read it.
// SameSite=Strict blocks it from being sent on cross-site requests (CSRF).
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionTtlSeconds * 1000,
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** Verifies the session and loads the user fresh from the DB (so deleted users lose access). */
export function requireAuth(req, _res, next) {
  const token = readCookie(req, config.cookieName);
  if (!token) return next(unauthorized());
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { ...JWT_OPTIONS, algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Session expired or invalid. Please log in again.'));
  }
  const user = getDb()
    .prepare('SELECT id, email, role, name, author_id FROM users WHERE id = ?')
    .get(Number(payload.sub));
  if (!user) return next(unauthorized());
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());
