import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

let db;

/** Returns the process-wide database handle, creating the schema on first use. */
export function getDb() {
  if (db) return db;
  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  try {
    // WAL gives better read concurrency; some sandboxed/virtualized filesystems don't support it.
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    console.warn('[db] WAL mode unavailable on this filesystem, using default journal mode');
  }
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}

/** Runs fn inside a transaction; rolls back on any error. */
export function transaction(fn) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  db?.close();
  db = undefined;
}

export const nowIso = () => new Date().toISOString();
