import { getDb, transaction, nowIso } from '../db/connection.js';
import { TICKET_PRIORITIES, ROLES } from '../constants.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { publishTicketEvent } from './eventBus.js';
import { triageTicket } from '../ai/triage.js';
import { draftReply } from '../ai/drafter.js';
import { aiStatus } from '../ai/llmClient.js';
import { toBook } from './bookService.js';

const db = () => getDb();

// ---------------------------------------------------------------------------
// Row → API shapes. Authors and admins get different views of the same ticket;
// author views are built from an allow-list so admin-only fields can't slip through.
// ---------------------------------------------------------------------------

const TICKET_SELECT = `
  SELECT t.*, b.title AS book_title, a.name AS author_name, u.name AS assignee_name,
    (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
    (SELECT MAX(created_at) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role = 'admin') AS last_reply_at
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.assigned_to`;

function toMessage(m, viewerRole) {
  return {
    id: m.id,
    from: m.sender_role === 'admin' ? 'support' : 'author',
    senderName: m.sender_role === 'admin' ? `${(m.sender_name ?? 'BookLeaf').split(' ')[0]} · BookLeaf Support` : m.sender_name,
    body: m.body,
    createdAt: m.created_at,
    ...(viewerRole === ROLES.ADMIN ? { usedAiDraft: Boolean(m.used_ai_draft) } : {}),
  };
}

function toAuthorTicket(row, messages) {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    book: row.book_id ? { id: row.book_id, title: row.book_title } : null,
    status: row.status,
    category: row.category,
    attachments: JSON.parse(row.attachment_names),
    messageCount: row.message_count,
    lastReplyAt: row.last_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    ...(messages ? { messages: messages.map((m) => toMessage(m, ROLES.AUTHOR)) } : {}),
  };
}

function toAdminTicket(row, extra = {}) {
  return {
    ...toAuthorTicket(row, extra.messages),
    ...(extra.messages ? { messages: extra.messages.map((m) => toMessage(m, ROLES.ADMIN)) } : {}),
    author: { id: row.author_id, name: row.author_name },
    priority: row.priority,
    categorySource: row.category_source,
    prioritySource: row.priority_source,
    triageState: row.triage_state,
    aiSummary: row.ai_summary,
    aiReasoning: row.ai_reasoning,
    assignedTo: row.assigned_to ? { id: row.assigned_to, name: row.assignee_name } : null,
    ...(extra.notes ? { notes: extra.notes } : {}),
    ...(extra.bookDetails !== undefined ? { book: extra.bookDetails } : {}),
    ...(extra.authorDetails ? { author: extra.authorDetails } : {}),
    ...(extra.includeDraft ? { aiDraft: row.ai_draft, aiDraftAt: row.ai_draft_at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Data access helpers
// ---------------------------------------------------------------------------

function loadTicketRow(id) {
  return db().prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id);
}

/** Loads a ticket the user may access. Authors get 404 (not 403) for others' tickets. */
function loadAccessibleTicket(id, user) {
  const row = loadTicketRow(id);
  if (!row || (user.role === ROLES.AUTHOR && row.author_id !== user.author_id)) {
    throw notFound('Ticket not found');
  }
  return row;
}

function loadMessages(ticketId) {
  return db().prepare(`
    SELECT m.*, u.name AS sender_name FROM ticket_messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`).all(ticketId);
}

function loadNotes(ticketId) {
  return db().prepare(`
    SELECT n.id, n.body, n.created_at AS createdAt, u.name AS authorName FROM ticket_notes n
    LEFT JOIN users u ON u.id = n.author_id
    WHERE n.ticket_id = ? ORDER BY n.created_at, n.id`).all(ticketId);
}

function loadBookRow(bookId) {
  return bookId ? db().prepare('SELECT * FROM books WHERE id = ?').get(bookId) : null;
}

function touch(ticketId, fields = {}) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`);
  sets.push('updated_at = ?');
  db().prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`)
    .run(...Object.values(fields), nowIso(), ticketId);
}

const emit = (type, row) => publishTicketEvent({ type, ticketId: row.id, authorId: row.author_id });

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listTicketsForAuthor(user) {
  const rows = db().prepare(`${TICKET_SELECT} WHERE t.author_id = ? ORDER BY t.updated_at DESC`).all(user.author_id);
  return rows.map((r) => toAuthorTicket(r));
}

const PRIORITY_RANK_SQL = `CASE t.priority ${TICKET_PRIORITIES.map((p, i) => `WHEN '${p}' THEN ${i}`).join(' ')} ELSE 9 END`;

/**
 * Admin queue. Default order surfaces the most urgent, oldest unresolved tickets first:
 * unresolved before resolved, then priority, then age.
 */
export function listTicketsForAdmin(filters, user) {
  const where = [];
  const params = [];
  if (filters.status === 'active') where.push(`t.status IN ('Open', 'In Progress')`);
  else if (filters.status) { where.push('t.status = ?'); params.push(filters.status); }
  if (filters.category) { where.push('t.category = ?'); params.push(filters.category); }
  if (filters.priority) { where.push('t.priority = ?'); params.push(filters.priority); }
  if (filters.from) { where.push('t.created_at >= ?'); params.push(`${filters.from}T00:00:00.000Z`); }
  if (filters.to) { where.push('t.created_at <= ?'); params.push(`${filters.to}T23:59:59.999Z`); }
  if (filters.assigned === 'me') { where.push('t.assigned_to = ?'); params.push(user.id); }
  else if (filters.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(t.subject LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR b.title LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = filters.sort === 'newest'
    ? 't.created_at DESC'
    : `CASE WHEN t.status IN ('Open', 'In Progress') THEN 0 ELSE 1 END, ${PRIORITY_RANK_SQL}, t.created_at ASC`;

  const total = db().prepare(`SELECT COUNT(*) AS n FROM tickets t JOIN authors a ON a.id = t.author_id
    LEFT JOIN books b ON b.id = t.book_id ${whereSql}`).get(...params).n;
  const rows = db().prepare(`${TICKET_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset);
  return { total, items: rows.map((r) => toAdminTicket(r)) };
}

export function getTicket(id, user) {
  const row = loadAccessibleTicket(id, user);
  const messages = loadMessages(id);
  if (user.role === ROLES.AUTHOR) return toAuthorTicket(row, messages);

  const author = db().prepare('SELECT id, name, city, joined_date AS joinedDate FROM authors WHERE id = ?').get(row.author_id);
  const book = loadBookRow(row.book_id);
  return toAdminTicket(row, {
    messages,
    notes: loadNotes(id),
    bookDetails: book ? toBook(book) : null,
    authorDetails: author,
    includeDraft: true,
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Creates a ticket and responds immediately; AI triage runs in the background so a slow
 * or failing AI never blocks ticket creation. Returns { ticket, triage } (triage is a
 * promise, awaited only by tests).
 */
export function createTicket(user, input) {
  if (input.bookId) {
    const owns = db().prepare('SELECT 1 FROM books WHERE id = ? AND author_id = ?').get(input.bookId, user.author_id);
    if (!owns) throw badRequest('Validation failed', [{ field: 'bookId', message: 'Book not found in your account' }]);
  }
  const { lastInsertRowid } = db().prepare(`
    INSERT INTO tickets (author_id, book_id, subject, description, attachment_names)
    VALUES (?, ?, ?, ?, ?)`).run(
    user.author_id, input.bookId ?? null, input.subject, input.description, JSON.stringify(input.attachmentNames ?? [])
  );
  const id = Number(lastInsertRowid);
  const row = loadTicketRow(id);
  emit('ticket.created', row);

  const triage = runTriage(id).catch((err) => console.error(`[triage] ticket ${id} failed`, err));
  return { ticket: toAuthorTicket(row, []), triage };
}

/** Classifies a ticket. Never overwrites a value an admin has set manually. */
export async function runTriage(ticketId) {
  const row = loadTicketRow(ticketId);
  if (!row) return;
  const result = await triageTicket({
    ticketId,
    subject: row.subject,
    description: row.description,
    book: loadBookRow(row.book_id),
  });

  const fields = { ai_summary: result.summary, ai_reasoning: result.reasoning, triage_state: result.source === 'ai' ? 'done' : 'fallback' };
  const current = loadTicketRow(ticketId); // re-read: an admin may have overridden meanwhile
  if (current.category_source !== 'admin') Object.assign(fields, { category: result.category, category_source: result.source });
  if (current.priority_source !== 'admin') Object.assign(fields, { priority: result.priority, priority_source: result.source });
  touch(ticketId, fields);
  emit('ticket.updated', current);
}

export function addMessage(ticketId, user, { body, status, usedAiDraft }) {
  const row = loadAccessibleTicket(ticketId, user);
  const isAdmin = user.role === ROLES.ADMIN;

  if (!isAdmin && row.status === 'Closed') {
    throw conflict('This ticket is closed. Please open a new ticket if you need more help.');
  }

  transaction((conn) => {
    conn.prepare(`INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, used_ai_draft)
      VALUES (?, ?, ?, ?, ?)`).run(ticketId, user.id, user.role, body, isAdmin && usedAiDraft ? 1 : 0);

    // Any new message makes a cached AI draft stale.
    const fields = { ai_draft: null, ai_draft_at: null };
    if (isAdmin) {
      const next = status ?? (row.status === 'Open' ? 'In Progress' : row.status);
      Object.assign(fields, statusFields(next));
      if (!row.assigned_to) fields.assigned_to = user.id; // replying claims an unassigned ticket
    } else if (row.status === 'Resolved') {
      Object.assign(fields, statusFields('Open')); // author follow-up reopens a resolved ticket
    }
    touch(ticketId, fields);
  });

  emit('ticket.updated', row);
  return getTicket(ticketId, user);
}

function statusFields(status) {
  return { status, resolved_at: status === 'Resolved' || status === 'Closed' ? nowIso() : null };
}

export function updateTicket(ticketId, admin, patch) {
  const row = loadAccessibleTicket(ticketId, admin);
  const fields = {};
  if (patch.status && patch.status !== row.status) Object.assign(fields, statusFields(patch.status));
  if (patch.category && patch.category !== row.category) {
    // Different category → different KB context, so drop the cached draft.
    Object.assign(fields, { category: patch.category, category_source: 'admin', ai_draft: null, ai_draft_at: null });
  }
  if (patch.priority && patch.priority !== row.priority) Object.assign(fields, { priority: patch.priority, priority_source: 'admin' });
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo !== null) {
      const assignee = db().prepare(`SELECT id FROM users WHERE id = ? AND role = 'admin'`).get(patch.assignedTo);
      if (!assignee) throw badRequest('Validation failed', [{ field: 'assignedTo', message: 'Assignee must be an admin user' }]);
    }
    fields.assigned_to = patch.assignedTo;
  }
  if (Object.keys(fields).length) {
    touch(ticketId, fields);
    emit('ticket.updated', row);
  }
  return getTicket(ticketId, admin);
}

export function addNote(ticketId, admin, body) {
  loadAccessibleTicket(ticketId, admin);
  db().prepare('INSERT INTO ticket_notes (ticket_id, author_id, body) VALUES (?, ?, ?)').run(ticketId, admin.id, body);
  // Notes are admin-only; touch updated_at but authors only receive an id-only event.
  touch(ticketId);
  return loadNotes(ticketId);
}

// Deduplicates concurrent draft requests for the same ticket (e.g. two admins open it at once).
const draftsInFlight = new Map();

/**
 * Returns the cached AI draft, or generates one. When AI is unavailable returns
 * { draft: null, available: false, reason } so the UI can switch to manual mode.
 */
export async function getOrCreateDraft(ticketId, admin, { regenerate = false } = {}) {
  const row = loadAccessibleTicket(ticketId, admin);
  if (row.ai_draft && !regenerate) {
    return { draft: row.ai_draft, generatedAt: row.ai_draft_at, available: true, cached: true };
  }
  const status = aiStatus();
  if (!status.enabled) return { draft: null, available: false, reason: status.reason };

  if (!draftsInFlight.has(ticketId)) {
    const job = (async () => {
      const author = db().prepare('SELECT name FROM authors WHERE id = ?').get(row.author_id);
      const result = await draftReply({
        ticket: row,
        book: loadBookRow(row.book_id),
        authorName: author?.name,
        messages: loadMessages(ticketId),
      });
      if (result.ok) touch(ticketId, { ai_draft: result.draft, ai_draft_at: nowIso() });
      return result;
    })().finally(() => draftsInFlight.delete(ticketId));
    draftsInFlight.set(ticketId, job);
  }
  const result = await draftsInFlight.get(ticketId);
  if (!result.ok) return { draft: null, available: false, reason: result.error };
  const fresh = loadTicketRow(ticketId);
  return { draft: fresh.ai_draft, generatedAt: fresh.ai_draft_at, available: true, cached: false };
}

export function listAdmins() {
  return db().prepare(`SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name`).all();
}

export function getStats() {
  const byStatus = db().prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all();
  const activeByPriority = db().prepare(`SELECT priority, COUNT(*) AS n FROM tickets
    WHERE status IN ('Open', 'In Progress') GROUP BY priority`).all();
  const ai = db().prepare(`SELECT operation, COUNT(*) AS calls, SUM(success) AS ok,
    SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
    ROUND(AVG(CASE WHEN success = 1 THEN latency_ms END)) AS avgLatencyMs
    FROM ai_usage GROUP BY operation`).all();
  const draftsUsed = db().prepare(`SELECT COUNT(*) AS total, SUM(used_ai_draft) AS fromAi
    FROM ticket_messages WHERE sender_role = 'admin'`).get();
  return {
    tickets: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    activeByPriority: Object.fromEntries(activeByPriority.map((r) => [r.priority ?? 'Untriaged', r.n])),
    ai: { status: aiStatus(), usage: ai, replies: { total: draftsUsed.total, startedFromAiDraft: draftsUsed.fromAi ?? 0 } },
  };
}
