// Deterministic facts computed in code and handed to the model, so it never has to do
// date arithmetic or invent numbers. Only data needed for the reply is included
// (no email/phone/other PII is sent to the LLM).

const PAYOUT_THRESHOLD = 1000;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** Quarter end + 45 days for the most recently completed quarter that hasn't been paid yet. */
export function nextPayoutWindow(today = new Date()) {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3); // 0..3 (current quarter)
  // End of the previous (completed) quarter.
  const prevQuarterEnd = new Date(Date.UTC(y, q * 3, 0));
  const due = new Date(prevQuarterEnd.getTime() + 45 * 86_400_000);
  if (due >= today) return { quarterEnd: prevQuarterEnd, payBy: due };
  // Already past this window: the next one is end of current quarter + 45 days.
  const currentQuarterEnd = new Date(Date.UTC(y, q * 3 + 3, 0));
  return { quarterEnd: currentQuarterEnd, payBy: new Date(currentQuarterEnd.getTime() + 45 * 86_400_000) };
}

// A full quarter (~92 days) plus the 45-day payout window.
const OVERDUE_AFTER_DAYS = 137;

/** True when royalty above the threshold has waited longer than one full payout cycle. */
export function isPayoutOverdue(book, today = new Date()) {
  if (!book || book.royalty_pending < PAYOUT_THRESHOLD) return false;
  const since = book.last_royalty_payout_date ?? book.publication_date;
  if (!since) return false;
  return (today - new Date(since)) / 86_400_000 > OVERDUE_AFTER_DAYS;
}

/** The most recent payout deadline (quarter end + 45 days) that is already in the past. */
export function lastPassedPayoutDeadline(today = new Date()) {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3);
  for (let back = 0; back < 3; back++) {
    const quarterEnd = new Date(Date.UTC(y, (q - back) * 3, 0));
    const due = new Date(quarterEnd.getTime() + 45 * 86_400_000);
    if (due < today) return due;
  }
  return null; // unreachable: a deadline always passed within the last 3 quarters
}

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Plain-text facts about a book for the drafting prompt.
 * `includeRoyalty: false` leaves out royalty details for non-royalty questions,
 * so the model doesn't bring up topics the author didn't ask about.
 */
export function describeBook(book, today = new Date(), { includeRoyalty = true } = {}) {
  if (!book) return 'The query is about the author account in general, not a specific book.';
  const lines = [
    `Title: ${book.title}`,
    `ISBN on record: ${book.isbn ?? 'not yet assigned'}`,
    `Current status: ${book.status}`,
  ];
  const inProduction = !book.publication_date;
  if (inProduction) {
    lines.push('The book is not yet published, so it has no sales or royalties yet.');
    return lines.join('\n');
  }
  const available = JSON.parse(book.available_on || '[]');
  lines.push(
    `Published on: ${book.publication_date}`,
    `MRP: ${inr(book.mrp)}`,
    `Copies sold to date: ${book.total_copies_sold}`,
    `Printed by: ${book.print_partner ?? 'n/a'}`,
    `Listed on: ${available.length ? available.join(', ') : 'no platforms yet'}`
  );
  if (!includeRoyalty) return lines.join('\n');

  lines.push(
    `Author royalty per copy: ${inr(book.author_royalty_per_copy)}`,
    `Royalty earned: ${inr(book.total_royalty_earned)}; paid: ${inr(book.royalty_paid)}; pending: ${inr(book.royalty_pending)}`,
    `Last royalty payout: ${book.last_royalty_payout_date ?? 'no payout made yet'}`
  );
  if (book.royalty_pending > 0) {
    const { quarterEnd, payBy } = nextPayoutWindow(today);
    if (book.royalty_pending < PAYOUT_THRESHOLD) {
      lines.push('Pending royalty is below the ₹1,000 minimum payout, so it rolls over to the next quarter.');
    } else if (isPayoutOverdue(book, today)) {
      const deadline = lastPassedPayoutDeadline(today);
      lines.push(
        `OVERDUE: royalty from earlier quarters should have been paid by ${fmtDate(deadline)} at the latest, but ${book.last_royalty_payout_date ? `the last payout was on ${book.last_royalty_payout_date}` : 'no payout has ever been made'}. This is BookLeaf's responsibility: own it and escalate with a 48-hour timeline.`,
        `(For reference, the next regular payout run is due by ${fmtDate(payBy)}. Do not describe that future date as missed.)`
      );
    } else {
      lines.push(`Not overdue. The pending amount is due in the next payout run, by ${fmtDate(payBy)} (for the quarter ending ${fmtDate(quarterEnd)}).`);
    }
  }
  return lines.join('\n');
}
