import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { CertSchema, type Cert } from '../domain/cert.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';

interface CertRow {
  id: string;
  domain: string;
  provider: string;
  pem_path: string;
  key_path: string;
  not_before: string;
  not_after: string;
  created_at: string;
  updated_at: string;
}

interface SqliteLikeError {
  code?: string;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as SqliteLikeError).code === 'string' &&
    (err as SqliteLikeError).code!.startsWith('SQLITE_CONSTRAINT_UNIQUE')
  );
}

function rowToCert(row: CertRow): Cert {
  return CertSchema.parse({
    id: row.id,
    domain: row.domain,
    provider: row.provider,
    pemPath: row.pem_path,
    keyPath: row.key_path,
    notBefore: row.not_before,
    notAfter: row.not_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class CertRepository {
  private readonly insertStmt;
  private readonly selectByIdStmt;
  private readonly selectByDomainStmt;
  private readonly selectAllStmt;
  private readonly updateStmt;
  private readonly deleteStmt;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare<
      [string, string, string, string, string, string, string, string, string]
    >(
      'INSERT INTO certs (id, domain, provider, pem_path, key_path, not_before, not_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.selectByIdStmt = db.prepare<[string], CertRow>(
      'SELECT id, domain, provider, pem_path, key_path, not_before, not_after, created_at, updated_at FROM certs WHERE id = ?',
    );
    this.selectByDomainStmt = db.prepare<[string], CertRow>(
      'SELECT id, domain, provider, pem_path, key_path, not_before, not_after, created_at, updated_at FROM certs WHERE domain = ?',
    );
    this.selectAllStmt = db.prepare<[], CertRow>(
      'SELECT id, domain, provider, pem_path, key_path, not_before, not_after, created_at, updated_at FROM certs ORDER BY domain ASC',
    );
    this.updateStmt = db.prepare<[string, string, string, string, string, string, string, string]>(
      'UPDATE certs SET domain = ?, provider = ?, pem_path = ?, key_path = ?, not_before = ?, not_after = ?, updated_at = ? WHERE id = ?',
    );
    this.deleteStmt = db.prepare<[string]>('DELETE FROM certs WHERE id = ?');
  }

  create(input: Omit<Cert, 'id' | 'createdAt' | 'updatedAt'>): Cert {
    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      this.insertStmt.run(
        id,
        input.domain,
        input.provider,
        input.pemPath,
        input.keyPath,
        input.notBefore,
        input.notAfter,
        now,
        now,
      );
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`domain already has a cert: ${input.domain}`, { cause: err });
      }
      throw err;
    }

    return rowToCert({
      id,
      domain: input.domain,
      provider: input.provider,
      pem_path: input.pemPath,
      key_path: input.keyPath,
      not_before: input.notBefore,
      not_after: input.notAfter,
      created_at: now,
      updated_at: now,
    });
  }

  findById(id: string): Cert | null {
    const row = this.selectByIdStmt.get(id);
    return row ? rowToCert(row) : null;
  }

  findByDomain(domain: string): Cert | null {
    const row = this.selectByDomainStmt.get(domain);
    return row ? rowToCert(row) : null;
  }

  list(): Cert[] {
    return this.selectAllStmt.all().map(rowToCert);
  }

  update(id: string, patch: Partial<Omit<Cert, 'id' | 'createdAt' | 'updatedAt'>>): Cert {
    const existing = this.selectByIdStmt.get(id);
    if (!existing) {
      throw new NotFoundError(`cert not found: ${id}`);
    }

    const now = new Date().toISOString();
    const nextDomain = patch.domain ?? existing.domain;
    const nextProvider = patch.provider ?? existing.provider;
    const nextPemPath = patch.pemPath ?? existing.pem_path;
    const nextKeyPath = patch.keyPath ?? existing.key_path;
    const nextNotBefore = patch.notBefore ?? existing.not_before;
    const nextNotAfter = patch.notAfter ?? existing.not_after;

    try {
      this.updateStmt.run(
        nextDomain,
        nextProvider,
        nextPemPath,
        nextKeyPath,
        nextNotBefore,
        nextNotAfter,
        now,
        id,
      );
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`domain already has a cert: ${nextDomain}`, { cause: err });
      }
      throw err;
    }

    return rowToCert({
      id,
      domain: nextDomain,
      provider: nextProvider,
      pem_path: nextPemPath,
      key_path: nextKeyPath,
      not_before: nextNotBefore,
      not_after: nextNotAfter,
      created_at: existing.created_at,
      updated_at: now,
    });
  }

  delete(id: string): boolean {
    return this.deleteStmt.run(id).changes > 0;
  }
}
