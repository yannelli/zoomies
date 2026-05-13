import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { ConflictError, NotFoundError } from '../domain/errors.js';
import { UpstreamSchema, type Upstream, type UpstreamTarget } from '../domain/upstream.js';

interface UpstreamRow {
  id: string;
  name: string;
  load_balancer: string;
  created_at: string;
  updated_at: string;
}

interface UpstreamTargetRow {
  upstream_id: string;
  host: string;
  port: number;
  weight: number;
  position: number;
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

function rowToUpstream(row: UpstreamRow, targets: UpstreamTarget[]): Upstream {
  return UpstreamSchema.parse({
    id: row.id,
    name: row.name,
    targets,
    loadBalancer: row.load_balancer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function targetRowToTarget(row: UpstreamTargetRow): UpstreamTarget {
  return {
    host: row.host,
    port: row.port,
    weight: row.weight,
  };
}

export class UpstreamRepository {
  private readonly insertUpstreamStmt;
  private readonly insertTargetStmt;
  private readonly selectUpstreamByIdStmt;
  private readonly selectTargetsForUpstreamStmt;
  private readonly selectAllUpstreamsStmt;
  private readonly selectAllTargetsStmt;
  private readonly updateUpstreamStmt;
  private readonly deleteTargetsForUpstreamStmt;
  private readonly deleteUpstreamStmt;
  private readonly touchUpstreamStmt;

  constructor(private readonly db: Database.Database) {
    this.insertUpstreamStmt = db.prepare<[string, string, string, string, string]>(
      'INSERT INTO upstreams (id, name, load_balancer, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.insertTargetStmt = db.prepare<[string, string, number, number, number]>(
      'INSERT INTO upstream_targets (upstream_id, host, port, weight, position) VALUES (?, ?, ?, ?, ?)',
    );
    this.selectUpstreamByIdStmt = db.prepare<[string], UpstreamRow>(
      'SELECT id, name, load_balancer, created_at, updated_at FROM upstreams WHERE id = ?',
    );
    this.selectTargetsForUpstreamStmt = db.prepare<[string], UpstreamTargetRow>(
      'SELECT upstream_id, host, port, weight, position FROM upstream_targets WHERE upstream_id = ? ORDER BY position ASC',
    );
    this.selectAllUpstreamsStmt = db.prepare<[], UpstreamRow>(
      'SELECT id, name, load_balancer, created_at, updated_at FROM upstreams ORDER BY name ASC',
    );
    this.selectAllTargetsStmt = db.prepare<[], UpstreamTargetRow>(
      'SELECT upstream_id, host, port, weight, position FROM upstream_targets ORDER BY upstream_id ASC, position ASC',
    );
    this.updateUpstreamStmt = db.prepare<[string, string, string, string]>(
      'UPDATE upstreams SET name = ?, load_balancer = ?, updated_at = ? WHERE id = ?',
    );
    this.deleteTargetsForUpstreamStmt = db.prepare<[string]>(
      'DELETE FROM upstream_targets WHERE upstream_id = ?',
    );
    this.deleteUpstreamStmt = db.prepare<[string]>('DELETE FROM upstreams WHERE id = ?');
    this.touchUpstreamStmt = db.prepare<[string, string]>(
      'UPDATE upstreams SET updated_at = ? WHERE id = ?',
    );
  }

  create(input: Omit<Upstream, 'id' | 'createdAt' | 'updatedAt'>): Upstream {
    const id = randomUUID();
    const now = new Date().toISOString();

    const insert = this.db.transaction(() => {
      this.insertUpstreamStmt.run(id, input.name, input.loadBalancer, now, now);
      input.targets.forEach((target, position) => {
        this.insertTargetStmt.run(id, target.host, target.port, target.weight, position);
      });
    });

    try {
      insert();
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError('upstream violates a unique constraint', { cause: err });
      }
      throw err;
    }

    return rowToUpstream(
      {
        id,
        name: input.name,
        load_balancer: input.loadBalancer,
        created_at: now,
        updated_at: now,
      },
      input.targets.map((t) => ({ host: t.host, port: t.port, weight: t.weight })),
    );
  }

  findById(id: string): Upstream | null {
    const row = this.selectUpstreamByIdStmt.get(id);
    if (!row) return null;

    const targets = this.selectTargetsForUpstreamStmt.all(id).map(targetRowToTarget);
    return rowToUpstream(row, targets);
  }

  list(): Upstream[] {
    const rows = this.selectAllUpstreamsStmt.all();
    if (rows.length === 0) return [];

    const targetsByUpstream = new Map<string, UpstreamTarget[]>();
    for (const row of this.selectAllTargetsStmt.all()) {
      const bucket = targetsByUpstream.get(row.upstream_id) ?? [];
      bucket.push(targetRowToTarget(row));
      targetsByUpstream.set(row.upstream_id, bucket);
    }

    return rows.map((row) => rowToUpstream(row, targetsByUpstream.get(row.id) ?? []));
  }

  update(id: string, patch: Partial<Omit<Upstream, 'id' | 'createdAt' | 'updatedAt'>>): Upstream {
    const now = new Date().toISOString();

    const apply = this.db.transaction(() => {
      const existing = this.selectUpstreamByIdStmt.get(id);
      if (!existing) {
        throw new NotFoundError(`upstream not found: ${id}`);
      }

      const nextName = patch.name ?? existing.name;
      const nextLoadBalancer = patch.loadBalancer ?? existing.load_balancer;

      if (patch.name !== undefined || patch.loadBalancer !== undefined) {
        this.updateUpstreamStmt.run(nextName, nextLoadBalancer, now, id);
      } else {
        this.touchUpstreamStmt.run(now, id);
      }

      if (patch.targets !== undefined) {
        this.deleteTargetsForUpstreamStmt.run(id);
        patch.targets.forEach((target, position) => {
          this.insertTargetStmt.run(id, target.host, target.port, target.weight, position);
        });
      }
    });

    try {
      apply();
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw err;
      }
      if (isUniqueConstraintError(err)) {
        throw new ConflictError('upstream violates a unique constraint', { cause: err });
      }
      throw err;
    }

    const fresh = this.findById(id);
    if (!fresh) {
      throw new NotFoundError(`upstream not found after update: ${id}`);
    }
    return fresh;
  }

  delete(id: string): boolean {
    const result = this.deleteUpstreamStmt.run(id);
    return result.changes > 0;
  }
}
