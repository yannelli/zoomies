import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type Database from 'better-sqlite3';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { NotFoundError } from '../domain/errors.js';
import { UpstreamRepository } from './upstream-repository.js';

interface CountRow {
  c: number;
}

function createDb(): Database.Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('UpstreamRepository', () => {
  let db: Database.Database;
  let repo: UpstreamRepository;

  beforeEach(() => {
    db = createDb();
    repo = new UpstreamRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates an upstream with one round-robin target and returns a clean entity', () => {
    const created = repo.create({
      name: 'web-pool',
      loadBalancer: 'round_robin',
      targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe('web-pool');
    expect(created.loadBalancer).toBe('round_robin');
    expect(created.targets).toEqual([{ host: 'backend.internal', port: 8080, weight: 1 }]);
    // The Phase 1 UpstreamTargetSchema does not surface `position` — it's a
    // storage detail and must not leak out.
    expect(created.targets[0]).not.toHaveProperty('position');
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('creates an upstream with three weighted targets preserving insertion order', () => {
    const targets = [
      { host: '10.0.0.1', port: 8080, weight: 5 },
      { host: '10.0.0.2', port: 8080, weight: 3 },
      { host: 'api-3.svc.cluster.local', port: 9090, weight: 2 },
    ];

    const created = repo.create({
      name: 'api-pool',
      loadBalancer: 'least_conn',
      targets,
    });

    expect(created.targets).toEqual(targets);
  });

  it('findById returns the upstream with targets sorted by stored position', () => {
    const created = repo.create({
      name: 'svc',
      loadBalancer: 'round_robin',
      targets: [
        { host: 'a.internal', port: 8001, weight: 1 },
        { host: 'b.internal', port: 8002, weight: 2 },
        { host: 'c.internal', port: 8003, weight: 3 },
      ],
    });

    const fetched = repo.findById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.targets.map((t) => t.host)).toEqual(['a.internal', 'b.internal', 'c.internal']);
  });

  it('findById returns null for a missing id', () => {
    expect(repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('list returns upstreams ordered by name with their own targets', () => {
    const charlie = repo.create({
      name: 'charlie',
      loadBalancer: 'round_robin',
      targets: [{ host: 'c.internal', port: 80, weight: 1 }],
    });
    const alpha = repo.create({
      name: 'alpha',
      loadBalancer: 'least_conn',
      targets: [
        { host: 'a1.internal', port: 81, weight: 2 },
        { host: 'a2.internal', port: 82, weight: 3 },
      ],
    });
    const bravo = repo.create({
      name: 'bravo',
      loadBalancer: 'ip_hash',
      targets: [{ host: 'b.internal', port: 83, weight: 4 }],
    });

    const all = repo.list();
    expect(all.map((u) => u.name)).toEqual(['alpha', 'bravo', 'charlie']);

    const alphaFetched = all.find((u) => u.id === alpha.id);
    const bravoFetched = all.find((u) => u.id === bravo.id);
    const charlieFetched = all.find((u) => u.id === charlie.id);

    expect(alphaFetched?.targets).toEqual([
      { host: 'a1.internal', port: 81, weight: 2 },
      { host: 'a2.internal', port: 82, weight: 3 },
    ]);
    expect(bravoFetched?.targets).toEqual([{ host: 'b.internal', port: 83, weight: 4 }]);
    expect(charlieFetched?.targets).toEqual([{ host: 'c.internal', port: 80, weight: 1 }]);
  });

  it('update replaces the target list atomically with fresh positions', () => {
    const created = repo.create({
      name: 'svc',
      loadBalancer: 'round_robin',
      targets: [
        { host: 'old-a.internal', port: 8001, weight: 1 },
        { host: 'old-b.internal', port: 8002, weight: 1 },
      ],
    });

    const newTargets = [
      { host: 'new-a.internal', port: 9001, weight: 5 },
      { host: 'new-b.internal', port: 9002, weight: 6 },
      { host: 'new-c.internal', port: 9003, weight: 7 },
    ];

    const updated = repo.update(created.id, { targets: newTargets });
    expect(updated.targets).toEqual(newTargets);

    interface PositionRow {
      host: string;
      position: number;
    }
    const positions = db
      .prepare(
        'SELECT host, position FROM upstream_targets WHERE upstream_id = ? ORDER BY position ASC',
      )
      .all(created.id) as PositionRow[];
    expect(positions).toEqual([
      { host: 'new-a.internal', position: 0 },
      { host: 'new-b.internal', position: 1 },
      { host: 'new-c.internal', position: 2 },
    ]);
  });

  it('update with only loadBalancer patch leaves targets untouched', () => {
    const created = repo.create({
      name: 'svc',
      loadBalancer: 'round_robin',
      targets: [
        { host: 'a.internal', port: 8001, weight: 1 },
        { host: 'b.internal', port: 8002, weight: 2 },
      ],
    });

    const updated = repo.update(created.id, { loadBalancer: 'least_conn' });
    expect(updated.loadBalancer).toBe('least_conn');
    expect(updated.targets).toEqual([
      { host: 'a.internal', port: 8001, weight: 1 },
      { host: 'b.internal', port: 8002, weight: 2 },
    ]);
  });

  it('update on a missing id throws NotFoundError', () => {
    expect(() => repo.update('00000000-0000-4000-8000-000000000000', { name: 'x' })).toThrow(
      NotFoundError,
    );
  });

  it('delete cascade-removes targets', () => {
    const created = repo.create({
      name: 'svc',
      loadBalancer: 'round_robin',
      targets: [
        { host: 'a.internal', port: 8001, weight: 1 },
        { host: 'b.internal', port: 8002, weight: 2 },
      ],
    });

    expect(repo.delete(created.id)).toBe(true);

    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM upstream_targets WHERE upstream_id = ?')
      .get(created.id) as CountRow;
    expect(c).toBe(0);

    expect(repo.findById(created.id)).toBeNull();
  });

  it('delete on a missing id returns false', () => {
    expect(repo.delete('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
