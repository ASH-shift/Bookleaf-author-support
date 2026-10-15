import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { inr, date, dateTime } from '../../format.js';
import MessageThread from '../../components/MessageThread.jsx';
import { StatusBadge, PriorityBadge, SourceTag, ErrorBanner, Loading, LiveDot, FieldErrors } from '../../components/ui.jsx';

export default function AdminTicketDetail() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const ticket = useAsync(() => api.ticket(id), [id]);
  const meta = useAsync(() => api.meta(), []);
  const team = useAsync(() => api.team(), []);
  const connected = useTicketEvents((e) => { if (e.type === 'focus' || e.ticketId === id) ticket.reload(); });
  const [actionError, setActionError] = useState(null);

  if (ticket.loading && !ticket.data) return <Loading />;
  if (ticket.error && !ticket.data) return <ErrorBanner error={ticket.error} onRetry={ticket.reload} />;
  const t = ticket.data.ticket;

  async function update(patch) {
    setActionError(null);
    try { await api.updateTicket(id, patch); await ticket.reload(); } catch (err) { setActionError(err); }
  }

  return (
    <section>
      <Link to="/admin" className="link">← Queue</Link>
      <div className="page-head">
        <h1>#{t.id} {t.subject}</h1>
        <LiveDot connected={connected} />
      </div>
      <div className="meta-row">
        <PriorityBadge priority={t.priority} source={t.prioritySource} />
        <StatusBadge status={t.status} />
        <span>{t.author.name}</span>
        <span>Opened {dateTime(t.createdAt)}</span>
      </div>
      <ErrorBanner error={actionError} />

      <div className="detail-grid">
        <div>
          <MessageThread ticket={t} authorLabel={t.author.name} showAiFlag />
          <ReplyComposer ticket={t} onSent={ticket.reload} />
        </div>

        <aside>
          <div className="card panel">
            <h3>Triage</h3>
            {t.triageState === 'pending' && <p className="muted small">AI classification in progress…</p>}
            {t.aiSummary && <p className="small"><strong>Summary:</strong> {t.aiSummary}</p>}
            {t.aiReasoning && <p className="small muted">{t.aiReasoning}</p>}
            <label>
              Category <SourceTag source={t.categorySource} />
              <select value={t.category ?? ''} onChange={(e) => update({ category: e.target.value })}>
                {!t.category && <option value="">—</option>}
                {meta.data?.categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Priority <SourceTag source={t.prioritySource} />
              <select value={t.priority ?? ''} onChange={(e) => update({ priority: e.target.value })}>
                {!t.priority && <option value="">—</option>}
                {meta.data?.priorities.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            {t.triageState === 'fallback' && (
              <button className="link" onClick={() => api.retriage(id).then(ticket.reload).catch(setActionError)}>
                Re-run AI classification
              </button>
            )}
          </div>

          <div className="card panel">
            <h3>Handling</h3>
            <label>
              Status
              <select value={t.status} onChange={(e) => update({ status: e.target.value })}>
                {meta.data?.statuses.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Assignee
              <select value={t.assignedTo?.id ?? ''} onChange={(e) => update({ assignedTo: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {team.data?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {t.assignedTo?.id !== user.id && (
              <button className="secondary" onClick={() => update({ assignedTo: user.id })}>Assign to me</button>
            )}
          </div>

          <BookPanel book={t.book} author={t.author} />
          <NotesPanel ticketId={id} notes={t.notes} onAdded={ticket.reload} />
        </aside>
      </div>
    </section>
  );
}

function ReplyComposer({ ticket, onSent }) {
  const [body, setBodyState] = useState('');
  const bodyRef = useRef('');
  const setBody = (v) => { bodyRef.current = v; setBodyState(v); };
  const [fromDraft, setFromDraft] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState({ state: 'loading' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadDraft = useCallback(async (regenerate = false) => {
    setDraft({ state: 'loading' });
    try {
      const d = await api.aiDraft(ticket.id, regenerate);
      if (d.available && d.draft) {
        setDraft({ state: 'ready', text: d.draft, at: d.generatedAt });
        // Pre-fill only if the agent hasn't started typing their own reply.
        if (regenerate || bodyRef.current.trim() === '') {
          setBody(d.draft);
          setFromDraft(true);
        }
      } else {
        setDraft({ state: 'unavailable', reason: d.reason });
      }
    } catch (err) {
      setDraft({ state: 'unavailable', reason: err.message });
    }
  }, [ticket.id]);

  // Fetch (or reuse the cached) draft when the ticket is opened or a new author message arrives.
  const lastAuthorMessage = ticket.messages.filter((m) => m.from === 'author').at(-1)?.id ?? 0;
  useEffect(() => {
    if (ticket.status !== 'Closed') loadDraft();
  }, [loadDraft, lastAuthorMessage, ticket.status]);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(ticket.id, { body, usedAiDraft: fromDraft, ...(status ? { status } : {}) });
      setBody('');
      setFromDraft(false);
      setStatus('');
      setDraft({ state: 'sent' });
      await onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form composer" onSubmit={send}>
      <div className="composer-head">
        <h3>Reply to author</h3>
        <DraftStatus draft={draft} onRegenerate={() => loadDraft(true)} />
      </div>
      <textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000}
        placeholder={draft.state === 'loading' ? 'Generating AI draft…' : 'Write your reply…'} />
      <FieldErrors error={error} field="body" />
      <ErrorBanner error={error && !error.details ? error : null} />
      <div className="composer-actions">
        <label className="inline">
          After sending, set status:
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{ticket.status === 'Open' ? 'In Progress (default)' : `Keep ${ticket.status}`}</option>
            <option>In Progress</option>
            <option>Resolved</option>
            <option>Closed</option>
          </select>
        </label>
        <button className="primary" disabled={busy || body.trim().length < 2}>{busy ? 'Sending…' : 'Send reply'}</button>
      </div>
      <p className="hint">Replies are visible to the author immediately. Use internal notes for anything private.</p>
    </form>
  );
}

function DraftStatus({ draft, onRegenerate }) {
  if (draft.state === 'loading') return <span className="source source-ai">AI drafting…</span>;
  if (draft.state === 'ready') {
    return (
      <span className="small">
        <span className="source source-ai">AI draft</span> review before sending ·{' '}
        <button type="button" className="link" onClick={onRegenerate}>Regenerate</button>
      </span>
    );
  }
  if (draft.state === 'unavailable') {
    const msg = draft.reason === 'not_configured' ? 'AI drafting is not configured' : 'AI draft unavailable right now';
    return (
      <span className="small muted">
        {msg}: please write the reply manually ·{' '}
        <button type="button" className="link" onClick={onRegenerate}>Try again</button>
      </span>
    );
  }
  return null;
}

function BookPanel({ book, author }) {
  return (
    <div className="card panel">
      <h3>Author & book</h3>
      <p className="small"><strong>{author.name}</strong> · {author.city} · joined {date(author.joinedDate)}</p>
      {!book ? <p className="muted small">General / account-level query</p> : (
        <dl className="small">
          <dt>Book</dt><dd>{book.title}</dd>
          <dt>ISBN</dt><dd>{book.isbn}</dd>
          <dt>Status</dt><dd>{book.status}</dd>
          {book.isPublished && <>
            <dt>Published</dt><dd>{date(book.publicationDate)}</dd>
            <dt>Copies sold</dt><dd>{book.copiesSold}</dd>
            <dt>Earned / Paid</dt><dd>{inr(book.royaltyEarned)} / {inr(book.royaltyPaid)}</dd>
            <dt>Pending</dt><dd className={book.royaltyPending > 0 ? 'pending' : ''}>{inr(book.royaltyPending)}</dd>
            <dt>Last payout</dt><dd>{book.lastPayoutDate ? date(book.lastPayoutDate) : 'Never'}</dd>
            <dt>Printer</dt><dd>{book.printPartner}</dd>
            <dt>Listed on</dt><dd>{book.availableOn.join(', ')}</dd>
          </>}
        </dl>
      )}
    </div>
  );
}

function NotesPanel({ ticketId, notes, onAdded }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.addNote(ticketId, body);
      setBody('');
      await onAdded();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card panel notes">
      <h3>Internal notes <span className="muted small">(not visible to author)</span></h3>
      {notes.length === 0 && <p className="muted small">No notes yet.</p>}
      {notes.map((n) => (
        <div key={n.id} className="note">
          <div className="small muted">{n.authorName} · {dateTime(n.createdAt)}</div>
          <p>{n.body}</p>
        </div>
      ))}
      <form onSubmit={add}>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} placeholder="Add a private note…" />
        <FieldErrors error={error} field="body" />
        <button className="secondary" disabled={body.trim().length < 2}>Add note</button>
      </form>
    </div>
  );
}
