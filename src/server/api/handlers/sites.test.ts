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
  createSite,
  deleteSite,
  getSite,
  listSites,
  updateSite,
  type SiteHandlerDeps,
} from './sites.js';

interface TestContext {
  db: Database.Database;
  siteRepo: SiteRepository;
  upstreamRepo: UpstreamRepository;
  deps: SiteHandlerDeps;
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const siteRepo = new SiteRepository(db);
  const upstreamRepo = new UpstreamRepository(db);
  return { db, siteRepo, upstreamRepo, deps: { siteRepo } };
}

function seedUpstream(repo: UpstreamRepository, name = 'pool'): string {
  return repo.create({
    name,
    loadBalancer: 'round_robin',
    targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
  }).id;
}

describe('site handlers', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  describe('listSites', () => {
    it('returns an empty array when no sites exist', () => {
      expect(listSites(ctx.deps)).toEqual([]);
    });

    it('returns every persisted site', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      ctx.siteRepo.create({ hostname: 'alpha.test', upstreamId, tlsMode: 'off' });
      ctx.siteRepo.create({ hostname: 'bravo.test', upstreamId, tlsMode: 'acme' });

      const sites = listSites(ctx.deps);

      expect(sites.map((s) => s.hostname)).toEqual(['alpha.test', 'bravo.test']);
    });
  });

  describe('createSite', () => {
    it('persists and returns a site for valid input with a seeded upstream', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);

      const created = createSite(
        { hostname: 'example.test', upstreamId, tlsMode: 'acme' },
        ctx.deps,
      );

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(created.hostname).toBe('example.test');
      expect(created.upstreamId).toBe(upstreamId);
      expect(created.tlsMode).toBe('acme');
      expect(created.createdAt).toBe(created.updatedAt);
    });

    it('throws ZodError when hostname is missing', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);

      expect(() => createSite({ upstreamId, tlsMode: 'off' }, ctx.deps)).toThrow(ZodError);
    });

    it('throws ConflictError when hostname is already taken', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      createSite({ hostname: 'duplicate.test', upstreamId, tlsMode: 'off' }, ctx.deps);

      expect(() =>
        createSite({ hostname: 'duplicate.test', upstreamId, tlsMode: 'acme' }, ctx.deps),
      ).toThrow(ConflictError);
    });

    it('throws NotFoundError when upstreamId does not point to an existing upstream', () => {
      const orphanUpstreamId = randomUUID();

      expect(() =>
        createSite(
          { hostname: 'orphan.test', upstreamId: orphanUpstreamId, tlsMode: 'off' },
          ctx.deps,
        ),
      ).toThrow(NotFoundError);
    });
  });

  describe('getSite', () => {
    it('returns the persisted site by id', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      const created = createSite({ hostname: 'lookup.test', upstreamId, tlsMode: 'off' }, ctx.deps);

      expect(getSite(created.id, ctx.deps)).toEqual(created);
    });

    it('throws NotFoundError when the id is unknown', () => {
      expect(() => getSite(randomUUID(), ctx.deps)).toThrow(NotFoundError);
    });
  });

  describe('updateSite', () => {
    it('applies a partial patch (just tlsMode) and bumps updatedAt', async () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      const created = createSite({ hostname: 'patch.test', upstreamId, tlsMode: 'off' }, ctx.deps);

      // Give SQLite a strictly different millisecond to compare against.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = updateSite(created.id, { tlsMode: 'manual' }, ctx.deps);

      expect(updated.id).toBe(created.id);
      expect(updated.hostname).toBe('patch.test');
      expect(updated.tlsMode).toBe('manual');
      expect(updated.createdAt).toBe(created.createdAt);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    /*
     * Repo semantics: an empty patch is accepted and still bumps updatedAt
     * (the UPDATE runs unconditionally with merged values). The handler
     * mirrors that — empty patches are valid no-op touches, NOT errors —
     * because Zod's `.partial()` permits {} and the repo's `update` does
     * not distinguish the case. This is the documented behaviour.
     */
    it('accepts an empty patch and still bumps updatedAt without changing fields', async () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      const created = createSite({ hostname: 'touch.test', upstreamId, tlsMode: 'off' }, ctx.deps);

      await new Promise((resolve) => setTimeout(resolve, 5));

      const touched = updateSite(created.id, {}, ctx.deps);

      expect(touched.id).toBe(created.id);
      expect(touched.hostname).toBe(created.hostname);
      expect(touched.upstreamId).toBe(created.upstreamId);
      expect(touched.tlsMode).toBe(created.tlsMode);
      expect(touched.createdAt).toBe(created.createdAt);
      expect(new Date(touched.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it('throws NotFoundError when the id does not exist', () => {
      expect(() => updateSite(randomUUID(), { tlsMode: 'acme' }, ctx.deps)).toThrow(NotFoundError);
    });
  });

  describe('deleteSite', () => {
    it('removes the site on first call and throws NotFoundError on the second', () => {
      const upstreamId = seedUpstream(ctx.upstreamRepo);
      const created = createSite({ hostname: 'gone.test', upstreamId, tlsMode: 'off' }, ctx.deps);

      expect(() => deleteSite(created.id, ctx.deps)).not.toThrow();
      expect(() => getSite(created.id, ctx.deps)).toThrow(NotFoundError);
      expect(() => deleteSite(created.id, ctx.deps)).toThrow(NotFoundError);
    });
  });
});
