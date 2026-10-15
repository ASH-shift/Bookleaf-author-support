# BookLeaf Author Support & Communication Portal

A web app with two interfaces, an **Author Portal** and an **Admin Support Desk**, for handling author support tickets. AI helps with classification, prioritisation and drafting replies.

- **Author Portal:** view books and royalties, raise tickets, follow replies in real time.
- **Admin Support Desk:** a prioritised ticket queue. AI classifies each ticket, scores its priority and drafts a reply from the BookLeaf knowledge base. Admins can override the AI, edit drafts, add internal notes and assign tickets.
- **Graceful degradation:** with no AI key, or if the AI is down, tickets are still created, keyword rules classify them, and admins write replies manually.

---

## Quick start

Requirements: **Node.js 22.13+** (the app uses the built-in `node:sqlite`, so no database server is needed).

```bash
npm install
cp server/.env.example server/.env   # then set GROQ_API_KEY (optional, free at console.groq.com) and JWT_SECRET
npm run dev                          # API on :4000, React dev server on http://localhost:5173
```

The database is created and seeded from `server/data/bookleaf_sample_data.json` on first start. Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + Vite dev server with hot reload |
| `npm run build && npm start` | Production build; Express serves the API and the React app from one origin on :4000 |
| `npm run seed` | Wipe and re-seed the database |
| `npm test` | API and AI-pipeline tests (in-memory DB, no API key needed) |

### Test credentials

| Role | Email | Password |
|---|---|---|
| Author | any author email from the sample data, e.g. `priya.sharma@email.com`, `sneha.kulkarni@email.com` (has a book in production), `kavita.deshmukh@email.com` (royalty below threshold) | `Author@123` |
| Admin | `admin@bookleaf.example` or `ops@bookleaf.example` | `Admin@123` |

These are demo-only passwords, set by `SEED_AUTHOR_PASSWORD` / `SEED_ADMIN_PASSWORD`.

### Deployment (Render / Railway)

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: `NODE_ENV=production`, `JWT_SECRET` (32+ random characters; the server refuses to start without it), `GROQ_API_KEY`.
- SQLite lives on the instance disk. On free tiers without a persistent disk, the demo resets (and re-seeds) on each redeploy.

---

## Architecture

```
client/  React 19 + Vite + React Router         server/  Node 22 + Express 5 + SQLite
  pages/author/*   books, new ticket, tickets      routes/      HTTP layer: validation (zod), auth, RBAC
  pages/admin/*    queue, ticket workspace         services/    business logic: tickets, books, event bus
  hooks/useTicketEvents  SSE subscription          ai/          triage, drafting, knowledge base, fallbacks
  api.js           fetch wrapper                   db/          schema.sql, connection, seed
```

**Request flow:** route → `requireAuth` (JWT from httpOnly cookie, user re-loaded from DB) → `requireRole` → `validate` (zod) → service → SQL with bound parameters → role-shaped JSON.

Key decisions:

- **Express + SQLite.** Small, conventional, and nothing to provision: reviewers can run it with `npm install`. The schema (`server/src/db/schema.sql`) uses CHECK constraints for enums, foreign keys and indexes for the queue's sort order. Moving to PostgreSQL only means changing the connection layer, because services contain plain SQL.
- **Separate `ticket_notes` table.** Internal notes are never in any table an author query touches, so a forgotten `WHERE` clause can't leak them. Author responses are built from an allow-list (`toAuthorTicket`); admin-only fields (priority, AI reasoning, draft, notes, assignee) are added only for admins.
- **Real-time via Server-Sent Events.** Updates only flow server → client, so SSE is enough and simpler than WebSockets. Events carry only `{type, ticketId}`, and clients refetch through the normal authorised endpoints, so an event can never leak data. Authors only receive events for their own tickets.
- **Triage runs after the response.** `POST /tickets` returns immediately; classification runs in the background and pushes an SSE update when done. A slow AI never blocks an author.
- **One origin.** In production Express serves the built React app, and in development Vite proxies `/api`. That lets the session cookie be `SameSite=Strict` with no CORS configuration.

---

## AI integration

### Model choice

The app uses **Groq** (open-weight models on fast inference hardware, with a free tier), and picks a model per task. Both models can be changed in `.env`.

| Task | Model | Why |
|---|---|---|
| Triage (category + priority) | `openai/gpt-oss-20b` | Small and very fast. Supports **strict JSON schema** output, so categories and priorities always come back valid. $0.075 / $0.30 per million tokens |
| Draft replies | `openai/gpt-oss-120b` | Larger model for better tone and instruction-following on author-facing text. $0.15 / $0.60 per million tokens |

Groq is fast enough that a draft is ready while the admin is still reading the ticket. A free key is enough to evaluate the app. All provider-specific code is in one file (`llmClient.js`), so switching to OpenAI or Anthropic means changing only that file.

### 1. Auto-classification and priority (`server/src/ai/triage.js`)

- Uses **strict structured outputs** (`response_format: json_schema`, `strict: true`), so the model can only return one of the six categories and four priorities. The JSON is validated again with zod before use.
- The prompt contains category and priority definitions with BookLeaf-specific examples ("no royalty for 6+ months" → Critical, "update my bio" → Low). It does **not** include the knowledge base, because triage doesn't need it.
- Input is the subject, description and a single line of book context (status, pending royalty, last payout, and an `overdue` flag computed in code).
- **Policy guardrail in code:** ISBN errors are never below High, whatever the model says (KB policy).
- Returns a one-line summary for the queue and a one-sentence reason admins can check.
- **Admin overrides win.** Overridden fields are marked `source = admin`, and re-running triage never overwrites them.

### 2. Drafted replies (`server/src/ai/drafter.js`)

- The system prompt holds the tone guidelines, the **category-relevant KB sections only** (`knowledgeBase.js`) and that category's calibration notes from BookLeaf's sample responses.
- **Facts are computed in code, not by the model** (`bookFacts.js`): next payout date (quarter end + 45 days), whether pending royalty is below the ₹1,000 threshold, whether a payout is overdue, and whether the book is still in production. The model is told to use only these facts, so it can't invent amounts or dates.
- **Prompt-injection hardening:** author text is wrapped in `<author_message>` tags and declared to be data. The model is told not to promise payments, refunds or policy exceptions. Internal notes are never sent to the model, so they can't leak into an author-facing draft.
- **Privacy:** only the author's first name and the relevant book's data are sent. Email, phone and city are not.
- The draft is cached on the ticket. It is generated once when an admin first opens the ticket, reused on later opens, and invalidated when the author sends a new message or the category changes. Concurrent requests for the same ticket share a single API call. Admins can regenerate on demand.
- Every sent reply records whether it started from the AI draft (`used_ai_draft`), so draft acceptance can be measured.

### 3. Error handling and graceful degradation (`server/src/ai/llmClient.js`)

- `callLLM` **never throws**. It returns `{ ok, text | error }` and callers decide how to degrade.
- SDK retries (2, with backoff) handle transient 429/5xx errors, with a 20s timeout per request.
- **Circuit breaker:** after 3 consecutive infrastructure failures, AI calls are skipped for 60 seconds, so an outage doesn't add a 20-second wait to every ticket.
- Typed SDK errors are mapped to codes (`rate_limited`, `timeout`, `auth_error`…). Truncated or empty outputs are treated as failures. On the free tier, hitting the rate limit (429) falls back the same way.
- **Fallbacks:** triage falls back to keyword rules (`ruleTriage.js`, marked "keyword rules" in the UI with a "Re-run AI classification" button). The reply composer switches to manual mode with a clear message. Ticket creation never depends on the AI.

### 4. Cost awareness

| Technique | Effect |
|---|---|
| Category-scoped KB | A royalty draft carries the royalty policy, not printing/ISBN/distribution |
| Triage without KB, small model, `reasoning_effort: low` | Classification is the cheapest call |
| History window | Only the last 4 messages, each capped at 1,200 characters |
| Draft caching + in-flight dedupe | Opening a ticket twice, or two admins opening it at once, costs one call |
| Stable system prompt prefix | Byte-identical per category (no dates or ticket data come first), so providers with prompt-prefix caching can reuse it. Cached tokens are recorded in `ai_usage` |
| `include_reasoning: false` | The model's internal reasoning isn't sent back, keeping responses small |
| Input caps | Subject ≤150 and description ≤5,000 characters are validated before any AI call |
| Per-user rate limits | Max 30 AI requests per admin per 10 minutes, and 10 new tickets per author per hour |
| Usage log | Every call is stored in `ai_usage` (tokens, cache reads, latency, success); totals are returned by `GET /api/admin/stats` |

---

## Security

- **API key** only in `server/.env` (git-ignored) and read by the server. It never reaches the browser.
- **Passwords** are hashed with bcrypt (cost 12). Login uses a constant-time path for unknown emails, generic error messages, and a rate limit of 10 attempts per 15 minutes per IP.
- **Sessions:** HS256 JWT (issuer, audience and algorithm pinned) in an `httpOnly`, `SameSite=Strict` cookie (`Secure` in production), with an 8-hour expiry. The user is reloaded from the DB on each request.
- **CSRF:** SameSite=Strict, plus every state-changing request must send `X-Requested-With: XMLHttpRequest`, which a cross-site form can't do.
- **Authorisation:** authors are scoped to their `author_id` in every query. Another author's ticket returns **404, not 403**, so ticket IDs can't be enumerated. Books in a new ticket must belong to the author.
- **Input:** every body, query and param is validated with zod. SQL uses bound parameters only (LIKE wildcards escaped), and JSON bodies are capped at 100 KB.
- **Headers:** Helmet with a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`). API responses use `Cache-Control: no-store`.
- **Errors:** consistent `{ error: { code, message, details? } }`. Unknown errors are logged server-side and return a generic 500 without stack traces. AI errors are logged as codes only, never as message content.
- **XSS:** React escapes all output, and there is no `dangerouslySetInnerHTML`.

---

## API reference

All endpoints are under `/api` and return JSON. Authentication is the `bl_session` httpOnly cookie set by `POST /auth/login`. Every `POST`/`PATCH` must include the header `X-Requested-With: XMLHttpRequest`.

Errors use one format: `{ "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": [{ "field": "subject", "message": "..." }] } }`. Status codes: `400` validation, `401` not logged in, `403` wrong role or missing CSRF header, `404` not found or not yours, `409` conflict, `413` body too large, `429` rate limited, `500` unexpected.

### Auth
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Body `{ email, password }`. Sets the session cookie; returns `{ user }` |
| POST | `/auth/logout` | public | Clears the cookie. `204` |
| GET | `/auth/me` | any | Current user (and author profile for authors) |

### Books
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/books` | author | The author's own books (published and in production) |
| GET | `/books?authorId=AUTH001` | admin | Books for a given author |

### Tickets
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/tickets` | author | Own tickets, most recently updated first |
| GET | `/tickets` | admin | Queue. Query: `status` (`Open`, `In Progress`, `Resolved`, `Closed` or `active`), `category`, `priority`, `assigned` (`me`/`unassigned`), `from`/`to` (`YYYY-MM-DD`), `q` (subject, author or book), `sort` (`urgent` default: unresolved → priority → oldest; or `newest`), `limit` (≤100), `offset`. Returns `{ total, items }` |
| POST | `/tickets` | author | Body `{ bookId?: "BK001" \| null, subject (5–150), description (20–5000), attachmentNames?: string[] (≤5) }`. `201`. Triage runs in the background |
| GET | `/tickets/:id` | author (own) / admin | Ticket with conversation. Admins also get notes, AI fields, cached draft, book and author details |
| PATCH | `/tickets/:id` | admin | Body: any of `{ status, category, priority, assignedTo: userId \| null }`. Category and priority changes are recorded as admin overrides |
| POST | `/tickets/:id/messages` | author (own) / admin | Body `{ body }`. Admins may add `status` and `usedAiDraft`. An admin reply to an Open ticket moves it to In Progress and assigns it if unassigned. An author reply reopens a Resolved ticket; Closed tickets return `409` |
| POST | `/tickets/:id/notes` | admin | Body `{ body }`. Internal note, never visible to authors |
| GET | `/tickets/:id/ai-draft[?regenerate=true]` | admin | Returns `{ draft, generatedAt, available, cached }`, or `{ draft: null, available: false, reason }` when AI is unavailable |
| POST | `/tickets/:id/triage` | admin | Re-runs classification (keeps admin overrides) |

### Admin & real-time
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/team` | admin | Admin users (for assignment) |
| GET | `/admin/stats` | admin | Ticket counts, active tickets by priority, AI status and token usage |
| GET | `/admin/meta` | admin | Allowed statuses, categories and priorities |
| GET | `/events` | any | Server-Sent Events stream. Event `ticket` with data `{ type, ticketId }`. Admins receive all events; authors only events for their own tickets |
| GET | `/health` | public | `{ status: "ok" }` |

---

## Assumptions

- Royalty figures come from the dataset and are read-only; there is no sales ingestion.
- "Today" is the server's current date, used to compute the next payout window and whether a payout is overdue.
- Attachments are UI-only, as the brief allows: only file names are stored, never file contents.
- Authors can reply on their own tickets (follow-ups), which felt necessary for a real support conversation.

## Known limitations and next steps

- **Single instance:** the SSE event bus and rate limits are in-memory. To scale horizontally, move them to Redis pub/sub and a Redis rate-limit store.
- **SQLite:** fine for a demo. Use PostgreSQL in production for concurrent writes and managed backups.
- **No password reset or email notifications**; production would add both, plus SSO for the ops team.
- **AI quality loop:** the next step is an evaluation set of real tickets with expected category and priority to measure classification accuracy, and tracking draft edit distance alongside `used_ai_draft`.
- **Attachments:** real upload would need object storage, file-type and size validation, and malware scanning.
- **SLA timers** and auto-escalation for tickets that stay Critical or High too long.
