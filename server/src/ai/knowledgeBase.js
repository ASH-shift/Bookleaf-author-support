// BookLeaf Knowledge Base, split into sections so each AI call only carries what it needs.
// (Cost control: a royalty question never pays for the printing policy, and vice versa.)

export const KB = {
  company: `BookLeaf Publishing is a self-publishing company operating in India and the US.
- Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management.
- In-house printing facility and warehouse in Delhi. Print partners: Repro India and Epitome Books.`,

  royalty: `Royalty policy:
- 80/20 split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Below that, royalties roll over to the next quarter.
- Payouts are made by bank transfer to the account linked in the author's dashboard.
- Authors can see a detailed royalty breakdown (sales per platform) in their dashboard.`,

  isbn: `ISBN policy:
- Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint.
- An author who wants an ISBN under their own imprint must obtain it independently.
- ISBN errors (duplicate, wrong book linked, mismatch between platform and print) are HIGH PRIORITY and escalated to the production team; commit to a 48-hour resolution timeline.
- Metadata updates (e.g. book description) can be submitted through the dashboard or by emailing the BookLeaf team; changes reflect on platforms within 3–5 business days.`,

  printing: `Printing & quality:
- In-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a FREE reprint after verification. Ask the author to share photos of the defective copy. Reprint timeline: 5–7 business days.`,

  distribution: `Distribution & availability:
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- "Currently unavailable" on a platform usually means a stock sync issue; BookLeaf's team can trigger a re-sync, which takes 24–48 hours.`,

  production: `Production stages, in order:
Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are updated by email at each stage.
- Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).
- Never blame the author for a delay, even if it is on their side; frame it collaboratively and give a specific updated timeline.`,

  tone: `How BookLeaf writes to authors:
- Empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern before moving to solutions.
- Be specific: use the actual numbers, dates and statuses from the facts provided, not vague reassurance.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If escalation or investigation is needed, give a clear timeline (e.g. "within 48 hours"), never an open-ended promise.
- Always end with a clear next step for the author and/or the BookLeaf team.`,
};

// Calibration notes from BookLeaf's sample responses, per category.
export const RESPONSE_GUIDANCE = {
  'Royalty & Payments': `- "Haven't received any royalty": acknowledge the frustration, explain the quarterly cycle and 45-day payout window, ask them to confirm bank details are linked, give the specific next payout date. If genuinely overdue, escalate with a 48-hour resolution timeline.
- "Royalty seems too low": explain net profit (MRP minus printing, platform commission, shipping) and the 80/20 split, offer a detailed line-by-line breakdown. Be transparent, never defensive.`,
  'ISBN & Metadata Issues': `- ISBN mismatch/duplicate: treat as high priority, acknowledge it is a serious data issue, confirm escalation to the production team immediately, give a 48-hour resolution timeline.
- Metadata/description changes after going live: yes, submit via the dashboard or email; reflects in 3–5 business days.`,
  'Printing & Quality': `- Poor print quality: apologise sincerely, ask for photos of the defective copies, confirm a free reprint once verified, reprint timeline 5–7 business days.`,
  'Distribution & Availability': `- "Currently Unavailable" on a platform: explain it is typically a stock sync issue, confirm you are triggering a re-sync, set the expectation of 24–48 hours.`,
  'Book Status & Production Updates': `- "Still in typesetting/cover design after weeks": state the actual current stage, be honest about why (e.g. awaiting proof approval) without blaming the author, give a specific updated timeline.`,
  'General Inquiry': `- Answer directly and briefly using the policies provided. If the request needs an action from the team, say who will do it and by when.`,
};

// Which KB sections each category needs, beyond company + tone (always included).
const SECTIONS_BY_CATEGORY = {
  'Royalty & Payments': ['royalty'],
  'ISBN & Metadata Issues': ['isbn'],
  'Printing & Quality': ['printing'],
  'Distribution & Availability': ['distribution'],
  'Book Status & Production Updates': ['production', 'distribution'],
  'General Inquiry': ['royalty', 'isbn', 'printing', 'distribution', 'production'],
};

/** Returns the KB text relevant to a category (the full KB when the category is unknown). */
export function knowledgeFor(category) {
  const keys = SECTIONS_BY_CATEGORY[category] ?? SECTIONS_BY_CATEGORY['General Inquiry'];
  return [KB.company, ...keys.map((k) => KB[k])].join('\n\n');
}
