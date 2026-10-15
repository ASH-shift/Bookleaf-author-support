# Approach: BookLeaf Author Support Portal

**What I prioritised.** The core loop first: an author raises a ticket, it is classified and prioritised, an admin replies with help from an AI draft, and the author sees the reply live. I treated AI as an assistant to the support team, not an autopilot. Every AI output (category, priority, draft) is visible as AI-generated, can be overridden, and is never sent to an author without a human pressing "Send". Security came second: the brief stresses API-key safety and role-based access, and a support portal holds authors' financial data.

**How the AI is designed.** There are two calls with different needs. *Triage* is a cheap structured-output classification, with no knowledge base and low effort, plus a code-level guardrail for BookLeaf's ISBN policy. *Drafting* gets only the knowledge-base sections for the ticket's category, the tone guide, and facts **computed in code** (next payout date, ₹1,000 threshold rollover, overdue flag, production status). Models are good at tone and bad at date arithmetic, so the code does the arithmetic and the model does the writing. Author text is fenced as data to resist prompt injection, and internal notes and PII never reach the model.

**Trade-offs.**
- *SQLite over PostgreSQL:* zero setup for reviewers, at the cost of horizontal scaling. The SQL is portable.
- *SSE over WebSockets:* updates are one-way, so SSE is simpler and proxy-friendly. Events carry IDs only, so authorisation stays in one place (the REST API).
- *Background triage:* tickets are created instantly and a classification update arrives a moment later over SSE. Slightly more moving parts, but an AI outage can never block an author.
- *Draft caching:* drafts are generated on first open and cached, rather than on ticket creation. This saves money on tickets that get closed without a reply, at the cost of a short wait the first time an admin opens a ticket.
- *Attachments UI-only*, as permitted. Real uploads add a security surface (storage, scanning) I'd rather do properly than quickly.

**Degradation.** Without an API key, or during an outage, the app keeps working. Keyword rules classify tickets (clearly labelled), a circuit breaker stops repeated slow failures, and the reply box switches to manual mode. The test suite runs entirely in this mode.

**Evolving to production.**
1. PostgreSQL, Redis for pub/sub and rate limiting, multiple app instances behind a load balancer.
2. An evaluation set built from historical tickets to measure classification accuracy and draft acceptance (the `used_ai_draft` flag and `ai_usage` table are already in place), then tune prompts against it.
3. Email notifications, SLA timers and auto-escalation, canned responses, and per-platform royalty breakdowns synced from sales data.
4. SSO for staff, audit logging of admin actions, and secure attachment upload with scanning.
