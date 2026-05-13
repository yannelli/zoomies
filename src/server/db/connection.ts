import Database from 'better-sqlite3';

/**
 * Open a SQLite database and apply the control-plane pragma defaults.
 *
 * - `journal_mode = WAL` — write-ahead logging for concurrent readers.
 * - `foreign_keys = ON` — enforce FK constraints (off by default in SQLite).
 * - `synchronous = NORMAL` — durable under WAL while staying fast.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}
