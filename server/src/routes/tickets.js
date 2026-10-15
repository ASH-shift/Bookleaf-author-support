import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants.js';
import * as tickets from '../services/ticketService.js';
import {
  createTicketSchema, idParamSchema, messageSchema, noteSchema,
  updateTicketSchema, ticketQuerySchema, draftQuerySchema,
} from './schemas.js';

const router = Router();
const adminOnly = requireRole(ROLES.ADMIN);
const authorOnly = requireRole(ROLES.AUTHOR);
const byId = validate(idParamSchema, 'params');

// Per-user limits on endpoints that cost money (AI calls) or could be spammed.
const perUser = (limit, windowMs) => rateLimit({
  windowMs,
  limit: config.isTest ? 1000 : limit,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } },
});
const createLimiter = perUser(10, 60 * 60 * 1000);
const aiLimiter = perUser(30, 10 * 60 * 1000);

// Authors: their own tickets. Admins: the filterable queue.
router.get('/', validate(ticketQuerySchema, 'query'), (req, res) => {
  if (req.user.role === ROLES.AUTHOR) return res.json({ items: tickets.listTicketsForAuthor(req.user) });
  res.json(tickets.listTicketsForAdmin(req.valid.query, req.user));
});

router.post('/', authorOnly, createLimiter, validate(createTicketSchema), (req, res) => {
  const { ticket } = tickets.createTicket(req.user, req.valid.body);
  res.status(201).location(`/api/tickets/${ticket.id}`).json({ ticket });
});

router.get('/:id', byId, (req, res) => {
  res.json({ ticket: tickets.getTicket(req.valid.params.id, req.user) });
});

router.patch('/:id', adminOnly, byId, validate(updateTicketSchema), (req, res) => {
  res.json({ ticket: tickets.updateTicket(req.valid.params.id, req.user, req.valid.body) });
});

router.post('/:id/messages', byId, validate(messageSchema), (req, res) => {
  // Authors can only send a message body; status/draft flags are admin-only.
  const input = req.user.role === ROLES.ADMIN ? req.valid.body : { body: req.valid.body.body };
  res.status(201).json({ ticket: tickets.addMessage(req.valid.params.id, req.user, input) });
});

router.post('/:id/notes', adminOnly, byId, validate(noteSchema), (req, res) => {
  res.status(201).json({ notes: tickets.addNote(req.valid.params.id, req.user, req.valid.body.body) });
});

router.get('/:id/ai-draft', adminOnly, byId, validate(draftQuerySchema, 'query'), aiLimiter, async (req, res) => {
  res.json(await tickets.getOrCreateDraft(req.valid.params.id, req.user, { regenerate: req.valid.query.regenerate }));
});

router.post('/:id/triage', adminOnly, byId, aiLimiter, async (req, res) => {
  tickets.getTicket(req.valid.params.id, req.user); // 404 if missing
  await tickets.runTriage(req.valid.params.id);
  res.json({ ticket: tickets.getTicket(req.valid.params.id, req.user) });
});

export default router;
