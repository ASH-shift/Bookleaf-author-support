import { dateTime } from '../format.js';

/** The author-visible conversation: original query followed by replies and follow-ups. */
export default function MessageThread({ ticket, authorLabel = 'You', showAiFlag = false }) {
  return (
    <div className="thread">
      <article className="msg from-author">
        <header><strong>{authorLabel}</strong><time>{dateTime(ticket.createdAt)}</time></header>
        <p>{ticket.description}</p>
        {ticket.attachments?.length > 0 && (
          <div className="attachments">📎 {ticket.attachments.join(', ')} <em>(file names only)</em></div>
        )}
      </article>
      {ticket.messages.map((m) => (
        <article key={m.id} className={`msg from-${m.from}`}>
          <header>
            <strong>{m.from === 'author' ? authorLabel : m.senderName}</strong>
            {showAiFlag && m.usedAiDraft && <span className="source source-ai">from AI draft</span>}
            <time>{dateTime(m.createdAt)}</time>
          </header>
          <p>{m.body}</p>
        </article>
      ))}
    </div>
  );
}
