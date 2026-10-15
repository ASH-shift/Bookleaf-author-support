// Small presentational building blocks shared by both portals.

const slug = (s) => (s ?? 'none').toLowerCase().replace(/[^a-z]+/g, '-');

export const StatusBadge = ({ status }) => <span className={`badge status-${slug(status)}`}>{status}</span>;

export const PriorityBadge = ({ priority, source }) =>
  priority ? (
    <span className={`badge priority-${slug(priority)}`} title={source ? `Set by ${sourceLabel(source)}` : undefined}>
      {priority}
    </span>
  ) : <span className="badge muted">Triaging…</span>;

export const sourceLabel = (s) => ({ ai: 'AI', rules: 'keyword rules', admin: 'admin' }[s] ?? s);

export const SourceTag = ({ source }) =>
  source ? <span className={`source source-${source}`}>{sourceLabel(source)}</span> : null;

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      <span>{error.message ?? String(error)}</span>
      {onRetry && <button className="link" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function FieldErrors({ error, field }) {
  const msgs = error?.details?.filter((d) => d.field === field).map((d) => d.message);
  return msgs?.length ? <div className="field-error">{msgs.join(', ')}</div> : null;
}

export const Empty = ({ title, children }) => (
  <div className="empty">
    <strong>{title}</strong>
    {children && <div>{children}</div>}
  </div>
);

export const Loading = () => <div className="loading">Loading…</div>;

export function LiveDot({ connected }) {
  return (
    <span className={`live ${connected ? 'on' : 'off'}`} title={connected ? 'Live updates on' : 'Reconnecting…'}>
      ● {connected ? 'Live' : 'Offline'}
    </span>
  );
}
