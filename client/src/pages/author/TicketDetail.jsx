import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { date } from '../../format.js';
import MessageThread from '../../components/MessageThread.jsx';
import { StatusBadge, ErrorBanner, Loading, LiveDot, FieldErrors } from '../../components/ui.jsx';

export default function AuthorTicketDetail() {
  const id = Number(useParams().id);
  const { state } = useLocation();
  const { data, error, loading, reload } = useAsync(() => api.ticket(id), [id]);
  const connected = useTicketEvents((e) => { if (e.type === 'focus' || e.ticketId === id) reload(); });
  const [reply, setReply] = useState('');
  const [sendError, setSendError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  const t = data.ticket;

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setSendError(null);
    try {
      await api.sendMessage(id, { body: reply });
      setReply('');
      await reload();
    } catch (err) {
      setSendError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <Link to="/tickets" className="link">← All tickets</Link>
      {state?.justCreated && (
        <div className="banner success">Ticket received. You'll see our reply here as soon as we respond, no need to refresh.</div>
      )}
      <div className="page-head">
        <h1>{t.subject}</h1>
        <LiveDot connected={connected} />
      </div>
      <div className="meta-row">
        <StatusBadge status={t.status} />
        <span>#{t.id}</span>
        <span>{t.book?.title ?? 'General / Account'}</span>
        {t.category && <span>{t.category}</span>}
        <span>Opened {date(t.createdAt)}</span>
      </div>

      <MessageThread ticket={t} />
      {t.messages.every((m) => m.from === 'author') && t.status !== 'Closed' && (
        <p className="muted">Our team has your message and will reply here.</p>
      )}

      {t.status === 'Closed' ? (
        <div className="banner">This ticket is closed. <Link to="/tickets/new">Open a new ticket</Link> if you need more help.</div>
      ) : (
        <form className="card form" onSubmit={send}>
          <label>
            Add a reply
            <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} required />
            <FieldErrors error={sendError} field="body" />
          </label>
          <ErrorBanner error={sendError && !sendError.details ? sendError : null} />
          <button className="primary" disabled={busy || reply.trim().length < 2}>{busy ? 'Sending…' : 'Send'}</button>
          {t.status === 'Resolved' && <span className="hint">Replying will reopen this ticket.</span>}
        </form>
      )}
    </section>
  );
}
