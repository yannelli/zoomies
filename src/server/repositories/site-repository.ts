import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { ConflictError, NotFoundError } from '../domain/errors.js';
import { SiteSchema, type Site } from '../domain/site.js';

/**
 * Persistence layer for {@link Site} aggregates.
 *
 * The repository owns SQL <-> entity translation, prepared-statement caching,
 * and the mapping from raw SQLite constraint failures to domain errors. All
 * public methods are synchronous because `better-sqlite3` is synchronous —
 * faking `async` would only add overhead and obscure the call site.
 */

interface SiteRow {
  id: string;
  hostname: string;
  upstream_id: string;
  tls_mode: string;
  created_at: string;
  updated_at: string;
}

const SITE_COLUMNS = 'id, hostname, upstream_id, tls_mode, created_at, updated_at';

/**
 * `code` value SQLite reports for the per-column UNIQUE violation we care
 * about (the `sites.hostname` unique index).
 */
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * `code` value SQLite reports when the `sites.upstream_id` foreign key points
 * at an upstream that does not exist.
 */
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

type SiteInsert = Omit<Site, 'id' | 'createdAt' | 'updatedAt'>;
type SiteUpdate = Partial<Omit<Site, 'id' | 'createdAt' | 'updatedAt'>>;

interface SqliteLikeError {
  code?: unknown;
}

function isSqliteError(err: unknown): err is SqliteLikeError & Error {
  return err instanceof Error && typeof (err as SqliteLikeError).code === 'string';
}

export class SiteRepository {
  readonly #insertStmt: Database.Statement<[string, string, string, string, string, string]>;
  readonly #findByIdStmt: Database.Statement<[string]>;
  readonly #findByHostnameStmt: Database.Statement<[string]>;
  readonly #listStmt: Database.Statement<[]>;
  readonly #updateStmt: Database.Statement<[string, string, string, string, string]>;
  readonly #deleteStmt: Database.Statement<[string]>;

  constructor(private readonly db: Database.Database) {
    this.#insertStmt = db.prepare(`INSERT INTO sites (${SITE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`);
    this.#findByIdStmt = db.prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE id = ?`);
    this.#findByHostnameStmt = db.prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE hostname = ?`);
    this.#listStmt = db.prepare(`SELECT ${SITE_COLUMNS} FROM sites ORDER BY hostname ASC`);
    this.#updateStmt = db.prepare(
      'UPDATE sites SET hostname = ?, upstream_id = ?, tls_mode = ?, updated_at = ? WHERE id = ?',
    );
    this.#deleteStmt = db.prepare('DELETE FROM sites WHERE id = ?');
  }

  create(input: SiteInsert): Site {
    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      this.#insertStmt.run(id, input.hostname, input.upstreamId, input.tlsMode, now, now);
    } catch (err: unknown) {
      this.#translateConstraintError(err, input);
      throw err;
    }

    return SiteSchema.parse({
      id,
      hostname: input.hostname,
      upstreamId: input.upstreamId,
      tlsMode: input.tlsMode,
      createdAt: now,
      updatedAt: now,
    });
  }

  findById(id: string): Site | null {
    const row = this.#findByIdStmt.get(id) as SiteRow | undefined;
    return row ? this.#rowToEntity(row) : null;
  }

  findByHostname(hostname: string): Site | null {
    const row = this.#findByHostnameStmt.get(hostname) as SiteRow | undefined;
    return row ? this.#rowToEntity(row) : null;
  }

  list(): Site[] {
    const rows = this.#listStmt.all() as SiteRow[];
    return rows.map((row) => this.#rowToEntity(row));
  }

  update(id: string, patch: SiteUpdate): Site {
    const existing = this.#findByIdStmt.get(id) as SiteRow | undefined;
    if (!existing) {
      throw new NotFoundError(`Site with id "${id}" was not found`);
    }

    const now = new Date().toISOString();
    const next: SiteRow = {
      id: existing.id,
      hostname: patch.hostname ?? existing.hostname,
      upstream_id: patch.upstreamId ?? existing.upstream_id,
      tls_mode: patch.tlsMode ?? existing.tls_mode,
      created_at: existing.created_at,
      updated_at: now,
    };

    try {
      this.#updateStmt.run(next.hostname, next.upstream_id, next.tls_mode, next.updated_at, id);
    } catch (err: unknown) {
      this.#translateConstraintError(err, {
        hostname: next.hostname,
        upstreamId: next.upstream_id,
        tlsMode: next.tls_mode as Site['tlsMode'],
      });
      throw err;
    }

    return this.#rowToEntity(next);
  }

  delete(id: string): boolean {
    const result = this.#deleteStmt.run(id);
    return result.changes > 0;
  }

  #rowToEntity(row: SiteRow): Site {
    return SiteSchema.parse({
      id: row.id,
      hostname: row.hostname,
      upstreamId: row.upstream_id,
      tlsMode: row.tls_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  #translateConstraintError(err: unknown, input: SiteInsert): never | void {
    if (!isSqliteError(err)) return;

    if (err.code === SQLITE_CONSTRAINT_UNIQUE) {
      throw new ConflictError(`A site with hostname "${input.hostname}" already exists`, {
        cause: err,
      });
    }
    if (err.code === SQLITE_CONSTRAINT_FOREIGNKEY) {
      throw new NotFoundError(`Referenced upstream "${input.upstreamId}" does not exist`, {
        cause: err,
      });
    }
  }
}
