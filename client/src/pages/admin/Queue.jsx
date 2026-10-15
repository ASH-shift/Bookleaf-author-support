import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { age, ageInDays } from '../../format.js';
import { StatusBadge, PriorityBadge, SourceTag, ErrorBanner, Loading, Empty, LiveDot } from '../../components/ui.jsx';

const DEFAULT_FILTERS = { status: 'active', category: '', priority: '', assigned: '', from: '', to: '', q: '', sort: 'urgent' };
const STALE_DAYS = 2; // unresolved tickets older than this are highlighted

export default function Queue() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const meta = useAsync(() => api.meta(), []);
  const stats = useAsync(() => api.stats(), []);
  const list = useAsync(() => api.tickets(filters), [JSON.stringify(filters)]);
  const connected = useTicketEvents(() => { list.reload(); stats.reload(); });

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const s = stats.data;

  return (
    <section>
      <div className="page-head">
        <h1>Ticket Queue</h1>
        <LiveDot connected={connected} />
      </div>

      {s && (
        <div className="stats">
          <div className="stat"><span>Open</span><strong>{s.tickets.Open ?? 0}</strong></div>
          <div className="stat"><span>In progress</span><strong>{s.tickets['In Progress'] ?? 0}</strong></div>
          <div className={`stat ${s.activeByPriority.Critical ? 'danger' : ''}`}><span>Critical (active)</span><strong>{s.activeByPriority.Critical ?? 0}</strong></div>
          <div className="stat"><span>High (active)</span><strong>{s.activeByPriority.High ?? 0}</strong></div>
          <div className="stat"><span>AI</span><strong className="small">{s.ai.status.enabled ? 'Online' : aiReason(s.ai.status.reason)}</strong></div>
        </div>
      )}

      <div className="filters card">
        <input placeholder="Search subject, author, book" value={filters.q} onChange={set('q')} />
        <select value={filters.status} onChange={set('status')}>
          <option value="active">Unresolved</option>
          <option value="">All statuses</option>
          {meta.data?.statuses.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={filters.category} onChange={set('category')}>
          <option value="">All categories</option>
          {meta.data?.categories.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={filters.priority} onChange={set('priority')}>
          <option value="">All priorities</option>
          {meta.data?.priorities.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={filters.assigned} onChange={set('assigned')}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <label className="inline">From <input type="date" value={filters.from} onChange={set('from')} /></label>
        <label className="inline">To <input type="date" value={filters.to} onChange={set('to')} /></label>
        <select value={filters.sort} onChange={set('sort')}>
          <option value="urgent">Most urgent first</option>
          <option value="newest">Newest first</option>
        </select>
        <button className="link" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset</button>
      </div>

      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? (
        <Empty title="Nothing here">No tickets match these filters.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="queue">
            <thead>
              <tr><th>Priority</th><th>Ticket</th><th>Author / Book</th><th>Category</th><th>Status</th><th>Assignee</th><th>Age</th></tr>
            </thead>
            <tbody>
              {list.data?.items.map((t) => {
                const stale = ['Open', 'In Progress'].includes(t.status) && ageInDays(t.createdAt) > STALE_DAYS;
                return (
                  <tr key={t.id} onClick={() => navigate(`/admin/tickets/${t.id}`)} className={stale ? 'stale' : ''}>
                    <td><PriorityBadge priority={t.priority} source={t.prioritySource} /></td>
                    <td>
                      <strong>#{t.id} {t.subject}</strong>
                      {t.aiSummary && t.aiSummary !== t.subject && <div className="muted small">{t.aiSummary}</div>}
                    </td>
                    <td>{t.author.name}<div className="muted small">{t.book?.title ?? 'General / Account'}</div></td>
                    <td>{t.category ?? '—'} <SourceTag source={t.categorySource} /></td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{t.assignedTo?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td className={stale ? 'stale-age' : ''} title={t.createdAt}>{age(t.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">{list.data?.total} ticket(s)</p>
        </div>
      )}
    </section>
  );
}

const aiReason = (r) => ({ not_configured: 'Not configured', temporarily_unavailable: 'Unavailable' }[r] ?? 'Offline');
