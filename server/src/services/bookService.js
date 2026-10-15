import { getDb } from '../db/connection.js';

export function toBook(row) {
  return {
    id: row.id,
    title: row.title,
    isbn: row.isbn,
    genre: row.genre,
    publicationDate: row.publication_date,
    status: row.status,
    isPublished: Boolean(row.publication_date),
    mrp: row.mrp,
    royaltyPerCopy: row.author_royalty_per_copy,
    copiesSold: row.total_copies_sold,
    royaltyEarned: row.total_royalty_earned,
    royaltyPaid: row.royalty_paid,
    royaltyPending: row.royalty_pending,
    lastPayoutDate: row.last_royalty_payout_date,
    printPartner: row.print_partner,
    availableOn: JSON.parse(row.available_on),
  };
}

export function listBooksForAuthor(authorId) {
  return getDb()
    .prepare('SELECT * FROM books WHERE author_id = ? ORDER BY publication_date IS NULL, publication_date DESC')
    .all(authorId)
    .map(toBook);
}

export function getAuthorProfile(authorId) {
  return getDb()
    .prepare('SELECT id, name, email, city, joined_date AS joinedDate FROM authors WHERE id = ?')
    .get(authorId);
}
