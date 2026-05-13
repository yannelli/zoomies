/**
 * Process-wide database singleton + repository factory used by every Route
 * Handler.
 *
 * Route Handlers run inside the long-lived Next.js Node process, so we open
 * the SQLite database once on first use and reuse the connection. Each call
 * to {@link getRepositories} hands back fresh repository instances — the
 * prepared statements they cache live on the repo itself (a few ms of
 * preparation cost per request is negligible compared to JSON
 * serialisation), and re-instantiating per call keeps the API surface flat.
 *
 * Tests inject their own in-memory DB via {@link resetDbForTesting}; the
 * same hook is used by `pnpm dev` to drop and re-open the connection when
 * Next.js hot-reloads a module that imports this file.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type Database from 'better-sqlite3';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { CertRepository } from '../repositories/cert-repository.js';
import { SiteRepository } from '../repositories/site-repository.js';
import { UpstreamRepository } from '../repositories/upstream-repository.js';

let dbInstance: Database.Database | null = null;

/**
 * Return the process-wide database connection, opening it on first use.
 *
 * The state directory is `$ZOOMIES_STATE_DIR` if set, otherwise
 * `<cwd>/.zoomies`. The directory is created recursively if missing. The
 * database file lives at `<stateDir>/zoomies.db` and is migrated on open.
 */
export function getDb(): Database.Database {
  if (dbInstance !== null) {
    return dbInstance;
  }

  const stateDir = process.env.ZOOMIES_STATE_DIR ?? join(process.cwd(), '.zoomies');
  mkdirSync(stateDir, { recursive: true });

  dbInstance = openDatabase(join(stateDir, 'zoomies.db'));
  runMigrations(dbInstance);
  return dbInstance;
}

export interface Repositories {
  sites: SiteRepository;
  upstreams: UpstreamRepository;
  certs: CertRepository;
}

/**
 * Construct a fresh set of repositories backed by the shared connection.
 *
 * Cheap to call per-request; repository constructors only prepare a handful
 * of statements against an already-open database handle.
 */
export function getRepositories(): Repositories {
  const db = getDb();
  return {
    sites: new SiteRepository(db),
    upstreams: new UpstreamRepository(db),
    certs: new CertRepository(db),
  };
}

/**
 * Replace (or clear) the cached database singleton.
 *
 * - Tests pass in their own in-memory connection so handlers operate on
 *   the same DB the test seeded.
 * - Passing `null` or no argument closes any existing connection and
 *   forces the next {@link getDb} call to re-open from disk; used by the
 *   `pnpm dev` watcher when modules reload.
 */
export function resetDbForTesting(db?: Database.Database | null): void {
  if (dbInstance !== null && dbInstance !== db) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close failures — the handle may already be closed by the
      // caller (tests often own the lifecycle of their own in-memory DB).
    }
  }
  dbInstance = db ?? null;
}
