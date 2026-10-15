// Unit tests for the deterministic parts of the AI pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { triageWithRules } = await import('../src/ai/ruleTriage.js');
const { nextPayoutWindow, describeBook, isPayoutOverdue, lastPassedPayoutDeadline } = await import('../src/ai/bookFacts.js');
const { knowledgeFor } = await import('../src/ai/knowledgeBase.js');
const { stripMarkdown } = await import('../src/ai/drafter.js');

test('rule triage: classic examples from the brief', () => {
  assert.deepEqual(
    pick(triageWithRules({ subject: 'No royalty', description: "I haven't received any royalty for 6 months" })),
    { category: 'Royalty & Payments', priority: 'Critical' }
  );
  assert.deepEqual(
    pick(triageWithRules({ subject: 'Bio', description: 'Can I update my author bio?' })),
    { category: 'ISBN & Metadata Issues', priority: 'Low' }
  );
  assert.equal(triageWithRules({ subject: 'ISBN', description: 'The ISBN on Amazon is different' }).priority, 'High');
  assert.equal(triageWithRules({ subject: 'Hello', description: 'Tell me about your packages' }).category, 'General Inquiry');
});

test('payout window: quarter end + 45 days', () => {
  const { payBy, quarterEnd } = nextPayoutWindow(new Date('2026-10-14T00:00:00Z'));
  assert.equal(quarterEnd.toISOString().slice(0, 10), '2026-09-30');
  assert.equal(payBy.toISOString().slice(0, 10), '2026-11-14');
  // After the window has passed, the next quarter applies.
  const late = nextPayoutWindow(new Date('2026-12-01T00:00:00Z'));
  assert.equal(late.payBy.toISOString().slice(0, 10), '2027-02-14');
});

test('book facts handle books in production and overdue payouts', () => {
  const inProduction = { title: 'Raising Roots', isbn: 'x', status: 'In Production - Typesetting', publication_date: null };
  assert.match(describeBook(inProduction), /not yet published/);

  const neverPaid = {
    title: 'Between Two Temples', isbn: 'x', status: 'Published & Live', publication_date: '2024-07-05', mrp: 425,
    author_royalty_per_copy: 38, total_copies_sold: 67, total_royalty_earned: 2546, royalty_paid: 0,
    royalty_pending: 2546, last_royalty_payout_date: null, print_partner: 'Epitome Books', available_on: '["Amazon India"]',
  };
  assert.equal(isPayoutOverdue(neverPaid, new Date('2026-10-14')), true);
  assert.match(describeBook(neverPaid, new Date('2026-10-14')), /OVERDUE/);

  // The overdue message must point at a deadline in the past, never the upcoming payout date.
  assert.equal(lastPassedPayoutDeadline(new Date('2026-10-14')).toISOString().slice(0, 10), '2026-08-14');
  assert.match(describeBook(neverPaid, new Date('2026-10-14')), /should have been paid by 14 August 2026/);
  // Non-royalty questions get no royalty figures at all.
  assert.doesNotMatch(describeBook(neverPaid, new Date('2026-10-14'), { includeRoyalty: false }), /royalty|OVERDUE/i);

  const belowThreshold = { ...neverPaid, royalty_pending: 850 };
  assert.equal(isPayoutOverdue(belowThreshold, new Date('2026-10-14')), false);
  assert.match(describeBook(belowThreshold, new Date('2026-10-14')), /rolls over/);
});

test('knowledge base context is scoped per category', () => {
  const royalty = knowledgeFor('Royalty & Payments');
  assert.match(royalty, /80\/20/);
  assert.doesNotMatch(royalty, /free reprint/i);
  assert.match(knowledgeFor('Printing & Quality'), /free reprint/i);
});

test('drafts are cleaned of markdown emphasis without touching normal text', () => {
  assert.equal(stripMarkdown('About *Whispers of the Ganges* and **this**.'), 'About Whispers of the Ganges and this.');
  assert.equal(stripMarkdown('snake_case_name and 5*3*2'), 'snake_case_name and 5*3*2');
});

function pick({ category, priority }) {
  return { category, priority };
}
