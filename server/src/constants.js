// Single source of truth for ticket enums. Shared by validation, AI output schemas and the DB.

export const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

export const TICKET_CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
];

// Ordered most → least urgent; the index is used as a sort rank.
export const TICKET_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Who decided a ticket's category/priority. Shown in the admin UI so humans know what to trust.
export const DECISION_SOURCES = ['ai', 'rules', 'admin'];

export const ROLES = { AUTHOR: 'author', ADMIN: 'admin' };
