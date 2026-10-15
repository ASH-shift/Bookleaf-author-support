import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { age } from '../../format.js';
import { StatusBadge, ErrorBanner, Loading, Empty, LiveDot } from '../../components/ui.jsx';

export default function MyTickets() {
  const { data, error, loading, reload } = useAsync(() => api.tickets(), []);
  const connected = useTicketEvents(() => reload());

  if (loading && !data) return <Loading />;
  const tickets = data?.items ?? [];

  return (
    <section>
      <div className="page-head">
        <h1>My Tickets</h1>
        <LiveDot connected={connected} />
        <Link className="button primary" to="/tickets/new">New ticket</Link>
      </div>
      <ErrorBanner error={error} onRetry={reload} />
      {tickets.length === 0 ? (
        <Empty title="No tickets yet">Have a question about royalties, your book's status or printing? <Link to="/tickets/new">Ask us.</Link></Empty>
      ) : (
        <ul className="ticket-list">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="card ticket-row">
                <div>
                  <strong>{t.subject}</strong>
                  <div className="muted small">
                    #{t.id} · {t.book?.title ?? 'General / Account'} · opened {age(t.createdAt)}
                  </div>
                </div>
                <div className="row-end">
                  {t.lastReplyAt && <span className="reply-flag">{t.messageCount} message{t.messageCount === 1 ? '' : 's'}</span>}
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
