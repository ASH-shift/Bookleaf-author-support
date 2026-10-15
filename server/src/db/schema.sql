-- BookLeaf support portal schema (SQLite).
-- Amounts are whole rupees (INTEGER). Timestamps are ISO-8601 UTC strings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS authors (
  id           TEXT PRIMARY KEY,              -- e.g. AUTH001 (from source data)
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  phone        TEXT,
  city         TEXT,
  joined_date  TEXT
);

-- Login identities. Authors link to their author profile; admins have none.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('author', 'admin')),
  name          TEXT NOT NULL,
  author_id     TEXT REFERENCES authors(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((role = 'author' AND author_id IS NOT NULL) OR (role = 'admin' AND author_id IS NULL))
);

CREATE TABLE IF NOT EXISTS books (
  id                        TEXT PRIMARY KEY,   -- e.g. BK001
  author_id                 TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  isbn                      TEXT,
  genre                     TEXT,
  publication_date          TEXT,               -- NULL while in production
  status                    TEXT NOT NULL,
  mrp                       INTEGER,            -- NULL while in production
  author_royalty_per_copy   INTEGER,
  total_copies_sold         INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned      INTEGER NOT NULL DEFAULT 0,
  royalty_paid              INTEGER NOT NULL DEFAULT 0,
  royalty_pending           INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date  TEXT,
  print_partner             TEXT,
  available_on              TEXT NOT NULL DEFAULT '[]'  -- JSON array of platform names
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS tickets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id          TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  book_id            TEXT REFERENCES books(id) ON DELETE SET NULL,  -- NULL = General / Account level
  subject            TEXT NOT NULL,
  description        TEXT NOT NULL,
  attachment_names   TEXT NOT NULL DEFAULT '[]',  -- JSON array; files themselves are not stored (UI only)
  status             TEXT NOT NULL DEFAULT 'Open'
                       CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),
  category           TEXT CHECK (category IN ('Royalty & Payments', 'ISBN & Metadata Issues',
                       'Printing & Quality', 'Distribution & Availability',
                       'Book Status & Production Updates', 'General Inquiry')),
  category_source    TEXT CHECK (category_source IN ('ai', 'rules', 'admin')),
  priority           TEXT CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  priority_source    TEXT CHECK (priority_source IN ('ai', 'rules', 'admin')),
  ai_summary         TEXT,                        -- one-line triage summary for the queue
  ai_reasoning       TEXT,                        -- why the AI chose the priority (admin-only)
  triage_state       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (triage_state IN ('pending', 'done', 'fallback')),
  assigned_to        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ai_draft           TEXT,                        -- cached AI draft reply (admin-only)
  ai_draft_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, priority, created_at);

-- Conversation visible to the author: the original query lives on the ticket,
-- follow-ups from the author and replies from admins live here.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_role  TEXT NOT NULL CHECK (sender_role IN ('author', 'admin')),
  body         TEXT NOT NULL,
  used_ai_draft INTEGER NOT NULL DEFAULT 0,       -- 1 if the admin started from the AI draft
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, created_at);

-- Internal notes are a separate table on purpose: author-facing queries never touch it,
-- so a missing WHERE clause cannot leak them.
CREATE TABLE IF NOT EXISTS ticket_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- the admin who wrote it
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id, created_at);

-- Every LLM call is logged for cost tracking and debugging.
CREATE TABLE IF NOT EXISTS ai_usage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id      INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  operation      TEXT NOT NULL CHECK (operation IN ('triage', 'draft')),
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER NOT NULL DEFAULT 0,
  success        INTEGER NOT NULL,
  error_code     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
