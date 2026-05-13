import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import { SiteRepository } from '../../repositories/site-repository.js';
import { UpstreamRepository } from '../../repositories/upstream-repository.js';
import {
  createUpstream,
  deleteUpstream,
  getUpstream,
  listUpstreams,
  updateUpstream,
  type UpstreamHandlerDeps,
} from './upstreams.js';

interface TestContext {
  db: Database.Database;
  upstreamRepo: UpstreamRepository;
  siteRepo: SiteRepository;
  deps: UpstreamHandlerDeps;
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const upstreamRepo = new UpstreamRepository(db);
  const siteRepo = new SiteRepository(db);
  return { db, upstreamRepo, siteRepo, deps: { upstreamRepo } };
}

describe('upstream handlers', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  describe('listUpstreams', () => {
    it('returns an empty array when none exist', () => {
      expect(listUpstreams(ctx.deps)).toEqual([]);
    });

    it('returns every persisted upstream', () => {
      createUpstream(
        {
          name: 'alpha',
          loadBalancer: 'round_robin',
          targets: [{ host: 'a.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );
      createUpstream(
        {
          name: 'bravo',
          loadBalancer: 'least_conn',
          targets: [{ host: 'b.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );

      const all = listUpstreams(ctx.deps);

      expect(all.map((u) => u.name)).toEqual(['alpha', 'bravo']);
    });
  });

  describe('createUpstream', () => {
    it('persists an upstream with two targets and returns it', () => {
      const created = createUpstream(
        {
          name: 'web-pool',
          loadBalancer: 'round_robin',
          targets: [
            { host: '10.0.0.1', port: 8080, weight: 5 },
            { host: '10.0.0.2', port: 8080, weight: 1 },
          ],
        },
        ctx.deps,
      );

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.name).toBe('web-pool');
      expect(created.loadBalancer).toBe('round_robin');
      expect(created.targets).toEqual([
        { host: '10.0.0.1', port: 8080, weight: 5 },
        { host: '10.0.0.2', port: 8080, weight: 1 },
      ]);
    });

    it('throws ZodError when targets array is empty', () => {
      expect(() =>
        createUpstream({ name: 'empty-pool', loadBalancer: 'round_robin', targets: [] }, ctx.deps),
      ).toThrow(ZodError);
    });
  });

  describe('getUpstream', () => {
    it('returns the persisted upstream by id', () => {
      const created = createUpstream(
        {
          name: 'svc',
          loadBalancer: 'round_robin',
          targets: [{ host: 'a.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );

      expect(getUpstream(created.id, ctx.deps)).toEqual(created);
    });

    it('throws NotFoundError when the id is unknown', () => {
      expect(() => getUpstream(randomUUID(), ctx.deps)).toThrow(NotFoundError);
    });
  });

  describe('updateUpstream', () => {
    it('replaces the target list atomically and returns the fresh upstream', () => {
      const created = createUpstream(
        {
          name: 'svc',
          loadBalancer: 'round_robin',
          targets: [
            { host: 'old-a.internal', port: 8001, weight: 1 },
            { host: 'old-b.internal', port: 8002, weight: 1 },
          ],
        },
        ctx.deps,
      );

      const newTargets = [
        { host: 'new-a.internal', port: 9001, weight: 5 },
        { host: 'new-b.internal', port: 9002, weight: 6 },
        { host: 'new-c.internal', port: 9003, weight: 7 },
      ];

      const updated = updateUpstream(created.id, { targets: newTargets }, ctx.deps);

      expect(updated.id).toBe(created.id);
      expect(updated.targets).toEqual(newTargets);
      expect(updated.name).toBe(created.name);
      expect(updated.loadBalancer).toBe(created.loadBalancer);
    });

    it('throws NotFoundError when the id is unknown', () => {
      expect(() => updateUpstream(randomUUID(), { name: 'x' }, ctx.deps)).toThrow(NotFoundError);
    });
  });

  describe('deleteUpstream', () => {
    it('removes an unreferenced upstream', () => {
      const created = createUpstream(
        {
          name: 'svc',
          loadBalancer: 'round_robin',
          targets: [{ host: 'a.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );

      expect(() => deleteUpstream(created.id, ctx.deps)).not.toThrow();
      expect(() => getUpstream(created.id, ctx.deps)).toThrow(NotFoundError);
    });

    it('throws NotFoundError on a second delete of the same id', () => {
      const created = createUpstream(
        {
          name: 'svc',
          loadBalancer: 'round_robin',
          targets: [{ host: 'a.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );

      deleteUpstream(created.id, ctx.deps);
      expect(() => deleteUpstream(created.id, ctx.deps)).toThrow(NotFoundError);
    });

    it('throws ConflictError when a site still references the upstream', () => {
      const upstream = createUpstream(
        {
          name: 'svc',
          loadBalancer: 'round_robin',
          targets: [{ host: 'a.internal', port: 80, weight: 1 }],
        },
        ctx.deps,
      );
      ctx.siteRepo.create({
        hostname: 'pinned.test',
        upstreamId: upstream.id,
        tlsMode: 'off',
      });

      expect(() => deleteUpstream(upstream.id, ctx.deps)).toThrow(ConflictError);
    });
  });
});
