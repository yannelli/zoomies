import { describe, expect, it } from 'vitest';

import { openDatabase } from './connection.js';
import { runMigrations } from './migrate.js';

interface NameRow {
  name: string;
}

interface CountRow {
  c: number;
}

describe('runMigrations', () => {
  it('creates the expected tables on a fresh database', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => (row as NameRow).name);

      expect(tables).toEqual([
        'certs',
        'schema_migrations',
        'sites',
        'upstream_targets',
        'upstreams',
      ]);
    } finally {
      db.close();
    }
  });

  it('records the 0001_init migration in schema_migrations', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);

      const versions = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => (row as { version: string }).version);

      expect(versions).toContain('0001_init');
    } finally {
      db.close();
    }
  });

  it('is idempotent across repeated invocations', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);
      expect(() => {
        runMigrations(db);
      }).not.toThrow();

      const { c } = db
        .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '0001_init'")
        .get() as CountRow;
      expect(c).toBe(1);
    } finally {
      db.close();
    }
  });

  it('enforces the sites.tls_mode CHECK constraint', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);

      db.prepare(
        "INSERT INTO upstreams (id, name, load_balancer, created_at, updated_at) VALUES ('u1', 'pool', 'round_robin', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      ).run();

      expect(() => {
        db.prepare(
          "INSERT INTO sites (id, hostname, upstream_id, tls_mode, created_at, updated_at) VALUES ('s1', 'example.test', 'u1', 'bogus', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).run();
      }).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces the certs not_before < not_after CHECK constraint', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);

      expect(() => {
        db.prepare(
          "INSERT INTO certs (id, domain, provider, pem_path, key_path, not_before, not_after, created_at, updated_at) VALUES ('c1', 'example.test', 'manual', '/p.pem', '/k.pem', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).run();
      }).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces the sites.upstream_id foreign key', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);

      expect(() => {
        db.prepare(
          "INSERT INTO sites (id, hostname, upstream_id, tls_mode, created_at, updated_at) VALUES ('s1', 'example.test', 'missing', 'off', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).run();
      }).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });
});
