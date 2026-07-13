import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { CertRepository } from '../../repositories/cert-repository.js';
import { listCerts, type CertHandlerDeps } from './certs.js';

interface TestContext {
  db: Database.Database;
  certRepo: CertRepository;
  deps: CertHandlerDeps;
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const certRepo = new CertRepository(db);
  return { db, certRepo, deps: { certRepo } };
}

describe('cert handlers', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  describe('listCerts', () => {
    it('returns an empty array when no certs exist', () => {
      expect(listCerts(ctx.deps)).toEqual([]);
    });

    it('returns every persisted cert ordered by domain', () => {
      ctx.certRepo.create({
        domain: 'bravo.test',
        provider: 'acme',
        pemPath: '/certs/bravo.pem',
        keyPath: '/certs/bravo.key',
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2026-04-01T00:00:00.000Z',
      });
      ctx.certRepo.create({
        domain: 'alpha.test',
        provider: 'acme',
        pemPath: '/certs/alpha.pem',
        keyPath: '/certs/alpha.key',
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2026-04-01T00:00:00.000Z',
      });

      const certs = listCerts(ctx.deps);

      expect(certs.map((c) => c.domain)).toEqual(['alpha.test', 'bravo.test']);
    });
  });
});
