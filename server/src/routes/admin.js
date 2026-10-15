import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { ROLES, TICKET_STATUSES, TICKET_CATEGORIES, TICKET_PRIORITIES } from '../constants.js';
import { listAdmins, getStats } from '../services/ticketService.js';

const router = Router();
router.use(requireRole(ROLES.ADMIN));

router.get('/team', (_req, res) => res.json({ items: listAdmins() }));
router.get('/stats', (_req, res) => res.json(getStats()));
router.get('/meta', (_req, res) => res.json({
  statuses: TICKET_STATUSES,
  categories: TICKET_CATEGORIES,
  priorities: TICKET_PRIORITIES,
}));

export default router;
