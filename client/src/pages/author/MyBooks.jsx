import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAsync } from '../../hooks/useAsync.js';
import { inr, date } from '../../format.js';
import { ErrorBanner, Loading, Empty } from '../../components/ui.jsx';

export default function MyBooks() {
  const { data, error, loading, reload } = useAsync(() => api.books(), []);
  if (loading && !data) return <Loading />;
  const books = data?.items ?? [];
  const published = books.filter((b) => b.isPublished);
  const totals = published.reduce(
    (t, b) => ({ sold: t.sold + b.copiesSold, earned: t.earned + b.royaltyEarned, paid: t.paid + b.royaltyPaid, pending: t.pending + b.royaltyPending }),
    { sold: 0, earned: 0, paid: 0, pending: 0 }
  );

  return (
    <section>
      <h1>My Books</h1>
      <ErrorBanner error={error} onRetry={reload} />
      {books.length === 0 ? (
        <Empty title="No books yet">Once your first manuscript is with us, it will appear here.</Empty>
      ) : (
        <>
          <div className="stats">
            <Stat label="Copies sold" value={totals.sold.toLocaleString('en-IN')} />
            <Stat label="Royalty earned" value={inr(totals.earned)} />
            <Stat label="Royalty paid" value={inr(totals.paid)} />
            <Stat label="Royalty pending" value={inr(totals.pending)} highlight={totals.pending > 0} />
          </div>
          <p className="hint">Royalties are calculated quarterly and paid within 45 days of the quarter ending (minimum payout ₹1,000).</p>
          <div className="book-grid">
            {books.map((b) => <BookCard key={b.id} book={b} />)}
          </div>
        </>
      )}
    </section>
  );
}

const PAYOUT_THRESHOLD = 1000;

const Stat =({ label, value, highlight }) => (
  <div className={`stat ${highlight ? 'highlight' : ''}`}><span>{label}</span><strong>{value}</strong></div>
);

function BookCard({ book: b }) {
  return (
    <article className="card book">
      <header>
        <h2>{b.title}</h2>
        <span className={`badge ${b.isPublished ? 'status-resolved' : 'status-in-progress'}`}>{b.status}</span>
      </header>
      <dl>
        <dt>ISBN</dt><dd>{b.isbn ?? '—'}</dd>
        <dt>Genre</dt><dd>{b.genre}</dd>
        <dt>Published</dt><dd>{b.isPublished ? date(b.publicationDate) : 'In production'}</dd>
        <dt>MRP</dt><dd>{inr(b.mrp)}</dd>
      </dl>
      {b.isPublished ? (
        <dl className="royalty">
          <dt>Copies sold</dt><dd>{b.copiesSold.toLocaleString('en-IN')}</dd>
          <dt>Royalty earned</dt><dd>{inr(b.royaltyEarned)}</dd>
          <dt>Royalty paid</dt><dd>{inr(b.royaltyPaid)}</dd>
          <dt>Royalty pending</dt><dd className={b.royaltyPending > 0 ? 'pending' : ''}>{inr(b.royaltyPending)}</dd>
          <dt>Last payout</dt><dd>{b.lastPayoutDate ? date(b.lastPayoutDate) : 'No payout yet'}</dd>
        </dl>
      ) : (
        <p className="muted">Sales and royalties will appear once your book is live.</p>
      )}
      {b.royaltyPending > 0 && b.royaltyPending < PAYOUT_THRESHOLD && (
        <p className="hint">This is below the ₹1,000 minimum payout, so it rolls over to the next quarter.</p>
      )}
      {b.availableOn.length > 0 && <p className="platforms">{b.availableOn.join(' · ')}</p>}
      <Link className="link" to={`/tickets/new?book=${b.id}`}>Ask about this book →</Link>
    </article>
  );
}
