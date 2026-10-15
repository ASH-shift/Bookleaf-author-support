import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAsync } from '../../hooks/useAsync.js';
import { ErrorBanner, FieldErrors } from '../../components/ui.jsx';

const MAX_FILES = 5;

export default function NewTicket() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data } = useAsync(() => api.books(), []);
  const [form, setForm] = useState({ bookId: params.get('book') ?? '', subject: '', description: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api.createTicket({
        bookId: form.bookId || null,
        subject: form.subject,
        description: form.description,
        attachmentNames: files.map((f) => f.name),
      });
      navigate(`/tickets/${ticket.id}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <h1>Get help</h1>
      <p className="muted">Tell us what's going on. Our team usually replies within one business day.</p>
      <form className="card form" onSubmit={submit}>
        <ErrorBanner error={error && !error.details ? error : null} />
        <label>
          Which book is this about?
          <select value={form.bookId} onChange={set('bookId')}>
            <option value="">General / Account level</option>
            {data?.items.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.status})</option>)}
          </select>
          <FieldErrors error={error} field="bookId" />
        </label>
        <label>
          Subject
          <input value={form.subject} onChange={set('subject')} maxLength={150} placeholder="e.g. Royalty for last quarter not received" required />
          <FieldErrors error={error} field="subject" />
        </label>
        <label>
          Details
          <textarea rows={7} value={form.description} onChange={set('description')} maxLength={5000}
            placeholder="Please include anything that helps us: dates, platforms, order numbers…" required />
          <span className="counter">{form.description.length}/5000</span>
          <FieldErrors error={error} field="description" />
        </label>
        <label>
          Attachments <span className="muted">(optional, up to {MAX_FILES})</span>
          <input type="file" multiple accept="image/*,.pdf"
            onChange={(e) => setFiles(Array.from(e.target.files).slice(0, MAX_FILES))} />
          <span className="hint">Upload isn't enabled in this demo: only the file names are sent with your ticket.</span>
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit ticket'}</button>
      </form>
    </section>
  );
}
