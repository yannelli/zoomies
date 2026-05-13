import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type Database from 'better-sqlite3';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { CertRepository } from './cert-repository.js';

function createDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const baseInput = {
  domain: 'example.com',
  provider: 'acme' as const,
  pemPath: '/etc/zoomies/certs/example.com.pem',
  keyPath: '/etc/zoomies/certs/example.com.key',
  notBefore: '2026-01-01T00:00:00.000Z',
  notAfter: '2026-04-01T00:00:00.000Z',
};

describe('CertRepository', () => {
  let db: Database.Database;
  let repo: CertRepository;

  beforeEach(() => {
    db = createDb();
    repo = new CertRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a cert and returns the parsed entity', () => {
    const created = repo.create(baseInput);

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.domain).toBe(baseInput.domain);
    expect(created.provider).toBe(baseInput.provider);
    expect(created.pemPath).toBe(baseInput.pemPath);
    expect(created.keyPath).toBe(baseInput.keyPath);
    expect(created.notBefore).toBe(baseInput.notBefore);
    expect(created.notAfter).toBe(baseInput.notAfter);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('rejects a duplicate domain with ConflictError', () => {
    repo.create(baseInput);
    expect(() => repo.create(baseInput)).toThrow(ConflictError);
  });

  it('findById and findByDomain round-trip the same record', () => {
    const created = repo.create(baseInput);

    const byId = repo.findById(created.id);
    const byDomain = repo.findByDomain(created.domain);

    expect(byId).toEqual(created);
    expect(byDomain).toEqual(created);
  });

  it('returns null for missing ids and domains', () => {
    expect(repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(repo.findByDomain('nope.example.test')).toBeNull();
  });

  it('list returns certs ordered by domain ASC', () => {
    repo.create({ ...baseInput, domain: 'charlie.example.com' });
    repo.create({ ...baseInput, domain: 'alpha.example.com' });
    repo.create({ ...baseInput, domain: 'bravo.example.com' });

    expect(repo.list().map((c) => c.domain)).toEqual([
      'alpha.example.com',
      'bravo.example.com',
      'charlie.example.com',
    ]);
  });

  it('update modifies provider/paths/expiry and bumps updatedAt', async () => {
    const created = repo.create(baseInput);

    // Sleep briefly so the updatedAt ISO string is strictly later than the
    // createdAt string. ISO timestamps have millisecond resolution, so 5ms
    // is plenty.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = repo.update(created.id, {
      provider: 'manual',
      pemPath: '/var/lib/zoomies/manual/example.com.pem',
      keyPath: '/var/lib/zoomies/manual/example.com.key',
      notAfter: '2027-01-01T00:00:00.000Z',
    });

    expect(updated.provider).toBe('manual');
    expect(updated.pemPath).toBe('/var/lib/zoomies/manual/example.com.pem');
    expect(updated.keyPath).toBe('/var/lib/zoomies/manual/example.com.key');
    expect(updated.notAfter).toBe('2027-01-01T00:00:00.000Z');
    expect(updated.domain).toBe(created.domain);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('update on a missing id throws NotFoundError', () => {
    expect(() =>
      repo.update('00000000-0000-4000-8000-000000000000', { provider: 'manual' }),
    ).toThrow(NotFoundError);
  });

  it('delete returns true the first time and false on a second call', () => {
    const created = repo.create(baseInput);

    expect(repo.delete(created.id)).toBe(true);
    expect(repo.delete(created.id)).toBe(false);
    expect(repo.findById(created.id)).toBeNull();
  });
});
