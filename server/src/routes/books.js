import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listBooksForAuthor } from '../services/bookService.js';
import { ROLES } from '../constants.js';
import { badRequest } from '../utils/errors.js';

const router = Router();

const querySchema = z.object({ authorId: z.string().regex(/^AUTH\d{3,}$/).optional() });

// Authors always get their own books (any authorId param is ignored).
// Admins must say which author they want.
router.get('/', requireRole(ROLES.AUTHOR, ROLES.ADMIN), validate(querySchema, 'query'), (req, res) => {
  if (req.user.role === ROLES.AUTHOR) return res.json({ items: listBooksForAuthor(req.user.author_id) });
  const { authorId } = req.valid.query;
  if (!authorId) throw badRequest('authorId query parameter is required for admins');
  res.json({ items: listBooksForAuthor(authorId) });
});

export default router;
