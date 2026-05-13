import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface AppliedRow {
  version: string;
}

/**
 * Apply pending SQL migrations from the sibling `migrations/` directory.
 *
 * Each `.sql` file is one migration; the version is the filename without
 * its extension. Migrations are applied in filename-sorted order. Each
 * application is wrapped in a transaction together with the
 * `schema_migrations` bookkeeping insert, so a failure rolls back cleanly
 * and a second call is a no-op.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
  );

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as AppliedRow).version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const insertVersion = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    const version = file.slice(0, -'.sql'.length);
    if (applied.has(version)) continue;

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    db.transaction(() => {
      db.exec(sql);
      insertVersion.run(version, new Date().toISOString());
    })();
  }
}
