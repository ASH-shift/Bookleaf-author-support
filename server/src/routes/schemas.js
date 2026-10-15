import { z } from 'zod';
import { TICKET_STATUSES, TICKET_CATEGORIES, TICKET_PRIORITIES } from '../constants.js';

// Trim, reject empty, cap length. Caps protect the DB and the AI token budget.
const text = (min, max, label) =>
  z.string({ error: `${label} is required` }).trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required').max(200),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createTicketSchema = z.object({
  bookId: z.string().regex(/^BK\d{3,}$/, 'Invalid book id').nullable().optional(),
  subject: text(5, 150, 'Subject'),
  description: text(20, 5000, 'Description'),
  // UI-only attachments: we store file names for context, never file contents.
  attachmentNames: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
});

export const messageSchema = z.object({
  body: text(2, 5000, 'Message'),
  status: z.enum(TICKET_STATUSES).optional(), // admin only; ignored for authors
  usedAiDraft: z.boolean().optional(),
});

export const noteSchema = z.object({
  body: text(2, 3000, 'Note'),
});

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export const ticketQuerySchema = z.object({
  status: z.enum([...TICKET_STATUSES, 'active']).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigned: z.enum(['me', 'unassigned']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['urgent', 'newest']).default('urgent'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const draftQuerySchema = z.object({
  regenerate: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
