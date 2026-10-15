import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { requireAuth, signSession, sessionCookieOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema } from './schemas.js';
import { unauthorized } from '../utils/errors.js';
import { getAuthorProfile } from '../services/bookService.js';

const router = Router();

// Brute-force protection: 10 attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Please try again in 15 minutes.' } },
});

// Compared against when the email doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  ...(u.author_id ? { author: getAuthorProfile(u.author_id) } : {}),
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Incorrect email or password');

  res.cookie(config.cookieName, signSession(user), sessionCookieOptions());
  res.json({ user: publicUser(user) });
});

router.post('/logout', (_req, res) => {
  const { maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(config.cookieName, opts);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
