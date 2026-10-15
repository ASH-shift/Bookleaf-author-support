// Deterministic keyword triage. Used when the AI is unavailable (no key, outage, rate limit)
// so every ticket still lands in the queue with a sensible category and priority.

const CATEGORY_RULES = [
  { category: 'ISBN & Metadata Issues', pattern: /\bisbn\b|metadata|description|author bio|\bbio\b|imprint|wrong (book|title)|duplicate/i },
  { category: 'Royalty & Payments', pattern: /royalt|payout|payment|paid|bank|money|earning|₹|\brs\.?\b|inr/i },
  { category: 'Printing & Quality', pattern: /print|misprint|binding|blurry|quality|pages?|defect|colou?r|reprint|author cop/i },
  { category: 'Distribution & Availability', pattern: /amazon|flipkart|unavailable|out of stock|listing|not showing|available|store/i },
  { category: 'Book Status & Production Updates', pattern: /typesetting|cover design|proof|editing|production|status|stage|when will|delay/i },
];

const CRITICAL = /legal|lawyer|fraud|scam|stolen|plagiar|copyright|consumer court|never (been )?paid|(six|6|seven|7|eight|8|nine|9|1[0-2]) months/i;
const HIGH = /isbn|wrong|duplicate|not received|haven'?t received|no royalty|overdue|unavailable|urgent|asap|misprint|defect|blurry/i;
const LOW = /can i|how do i|is it possible|update (my )?(bio|description)|question|curious|just wanted/i;

export function triageWithRules({ subject = '', description = '' }) {
  const text = `${subject}\n${description}`;
  const category = CATEGORY_RULES.find((r) => r.pattern.test(text))?.category ?? 'General Inquiry';

  let priority = 'Medium';
  if (CRITICAL.test(text)) priority = 'Critical';
  else if (HIGH.test(text)) priority = 'High';
  else if (LOW.test(text)) priority = 'Low';
  // Policy: ISBN errors are always at least High.
  if (category === 'ISBN & Metadata Issues' && /isbn/i.test(text) && priority !== 'Critical') priority = 'High';

  const summary = subject.trim().slice(0, 140) || description.trim().slice(0, 140);
  return { category, priority, summary, reasoning: 'Keyword rules (AI unavailable)' };
}
