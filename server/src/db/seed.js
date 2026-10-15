import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { getDb, transaction, closeDb } from './connection.js';
import { triageWithRules } from '../ai/ruleTriage.js';

const BCRYPT_ROUNDS = 12;

const ADMINS = [
  { email: 'admin@bookleaf.example', name: 'Neha (Support Lead)' },
  { email: 'ops@bookleaf.example', name: 'Karan (Operations)' },
];

// A few realistic tickets so the admin queue is not empty on first load.
// They are triaged with the keyword rules (no AI call at seed time).
const DEMO_TICKETS = [
  {
    authorId: 'AUTH003', bookId: 'BK005', daysAgo: 6,
    subject: 'No royalty received yet',
    description: "My book Between Two Temples has been live since July 2024 and I haven't received any royalty payment at all. The dashboard shows ₹2,546 pending. Can you tell me when I will be paid?",
  },
  {
    authorId: 'AUTH001', bookId: 'BK001', daysAgo: 2,
    subject: 'Different ISBN showing on Amazon',
    description: 'Amazon India is showing a different ISBN for Whispers of the Ganges than what is printed on my physical copy. Readers are getting confused.',
  },
  {
    authorId: 'AUTH007', bookId: 'BK013', daysAgo: 1,
    subject: 'When will Midnight in Mysore be ready?',
    description: "It's been 3 weeks and my book is still in cover design. When will it move forward?",
  },
  {
    authorId: 'AUTH004', bookId: null, daysAgo: 0,
    subject: 'Update my author bio',
    description: 'Can I update the author bio that appears on my book listings?',
  },
];

function loadSampleData() {
  const raw = JSON.parse(fs.readFileSync(config.sampleDataPath, 'utf8'));
  if (!Array.isArray(raw?.authors)) throw new Error('Sample data must contain an "authors" array');
  return raw.authors;
}

export function resetDatabase(db = getDb()) {
  db.exec(`
    DELETE FROM ai_usage; DELETE FROM ticket_notes; DELETE FROM ticket_messages;
    DELETE FROM tickets; DELETE FROM users; DELETE FROM books; DELETE FROM authors;
    DELETE FROM sqlite_sequence;
  `);
}

/** Seeds authors, books, users and demo tickets. No-op if authors already exist. */
export function seedIfEmpty({ withDemoTickets = true } = {}) {
  const db = getDb();
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM authors').get();
  if (count > 0) return false;

  const authors = loadSampleData();
  const authorHash = bcrypt.hashSync(config.seed.authorPassword, BCRYPT_ROUNDS);
  const adminHash = bcrypt.hashSync(config.seed.adminPassword, BCRYPT_ROUNDS);

  transaction((conn) => {
    const insertAuthor = conn.prepare(
      'INSERT INTO authors (id, name, email, phone, city, joined_date) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertUser = conn.prepare(
      'INSERT INTO users (email, password_hash, role, name, author_id) VALUES (?, ?, ?, ?, ?)'
    );
    const insertBook = conn.prepare(`
      INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp,
        author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid,
        royalty_pending, last_royalty_payout_date, print_partner, available_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const a of authors) {
      insertAuthor.run(a.author_id, a.name, a.email, a.phone ?? null, a.city ?? null, a.joined_date ?? null);
      insertUser.run(a.email, authorHash, 'author', a.name, a.author_id);
      for (const b of a.books ?? []) {
        insertBook.run(
          b.book_id, a.author_id, b.title, b.isbn ?? null, b.genre ?? null, b.publication_date ?? null,
          b.status, b.mrp ?? null, b.author_royalty_per_copy ?? null, b.total_copies_sold ?? 0,
          b.total_royalty_earned ?? 0, b.royalty_paid ?? 0, b.royalty_pending ?? 0,
          b.last_royalty_payout_date ?? null, b.print_partner ?? null, JSON.stringify(b.available_on ?? [])
        );
      }
    }
    for (const admin of ADMINS) insertUser.run(admin.email, adminHash, 'admin', admin.name, null);

    if (withDemoTickets) {
      const insertTicket = conn.prepare(`
        INSERT INTO tickets (author_id, book_id, subject, description, category, category_source,
          priority, priority_source, ai_summary, triage_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'rules', ?, 'rules', ?, 'fallback', ?, ?)`);
      for (const t of DEMO_TICKETS) {
        const triage = triageWithRules({ subject: t.subject, description: t.description });
        const created = new Date(Date.now() - t.daysAgo * 86_400_000).toISOString();
        insertTicket.run(t.authorId, t.bookId, t.subject, t.description, triage.category,
          triage.priority, triage.summary, created, created);
      }
    }
  });
  return true;
}

// CLI: `npm run seed` wipes and re-seeds.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--reset')) resetDatabase();
  seedIfEmpty();
  console.log(`Seeded database at ${config.databasePath}`);
  closeDb();
}
