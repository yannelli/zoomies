import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { SiteRepository } from './site-repository.js';

interface TestContext {
  db: Database.Database;
  repo: SiteRepository;
  seedUpstreamId: string;
  extraUpstreamId: string;
}

const NOW_ISO = '2026-05-13T12:00:00.000Z';

function seedUpstream(db: Database.Database, id: string, name: string): void {
  db.prepare(
    'INSERT INTO upstreams (id, name, load_balancer, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, name, 'round_robin', NOW_ISO, NOW_ISO);
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);

  const seedUpstreamId = randomUUID();
  const extraUpstreamId = randomUUID();
  seedUpstream(db, seedUpstreamId, 'primary-pool');
  seedUpstream(db, extraUpstreamId, 'secondary-pool');

  return {
    db,
    repo: new SiteRepository(db),
    seedUpstreamId,
    extraUpstreamId,
  };
}

describe('SiteRepository', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  describe('create', () => {
    it('persists a site and returns it with a UUID id and ISO timestamps', () => {
      const site = ctx.repo.create({
        hostname: 'example.com',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'acme',
      });

      expect(site.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(site.hostname).toBe('example.com');
      expect(site.upstreamId).toBe(ctx.seedUpstreamId);
      expect(site.tlsMode).toBe('acme');
      expect(site.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(site.updatedAt).toBe(site.createdAt);
    });

    it('rejects a duplicate hostname with ConflictError', () => {
      ctx.repo.create({
        hostname: 'duplicate.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(() =>
        ctx.repo.create({
          hostname: 'duplicate.test',
          upstreamId: ctx.extraUpstreamId,
          tlsMode: 'manual',
        }),
      ).toThrow(ConflictError);
    });

    it('rejects an unknown upstreamId with NotFoundError', () => {
      const missingUpstreamId = randomUUID();

      expect(() =>
        ctx.repo.create({
          hostname: 'orphan.test',
          upstreamId: missingUpstreamId,
          tlsMode: 'off',
        }),
      ).toThrow(NotFoundError);
    });
  });

  describe('findById', () => {
    it('returns the persisted site', () => {
      const created = ctx.repo.create({
        hostname: 'lookup.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'manual',
      });

      const found = ctx.repo.findById(created.id);

      expect(found).toEqual(created);
    });

    it('returns null when the id is unknown', () => {
      expect(ctx.repo.findById(randomUUID())).toBeNull();
    });
  });

  describe('findByHostname', () => {
    it('returns the persisted site for a lowercase hostname', () => {
      const created = ctx.repo.create({
        hostname: 'api.example.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'acme',
      });

      const found = ctx.repo.findByHostname('api.example.test');

      expect(found).toEqual(created);
    });

    it('returns null when no row matches', () => {
      expect(ctx.repo.findByHostname('absent.test')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all sites ordered by hostname ascending', () => {
      ctx.repo.create({
        hostname: 'charlie.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });
      ctx.repo.create({
        hostname: 'alpha.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'acme',
      });
      ctx.repo.create({
        hostname: 'bravo.test',
        upstreamId: ctx.extraUpstreamId,
        tlsMode: 'manual',
      });

      const sites = ctx.repo.list();

      expect(sites.map((s) => s.hostname)).toEqual(['alpha.test', 'bravo.test', 'charlie.test']);
    });

    it('returns an empty array when no sites exist', () => {
      expect(ctx.repo.list()).toEqual([]);
    });
  });

  describe('update', () => {
    it('modifies tlsMode, bumps updatedAt, leaves id and createdAt intact', async () => {
      const created = ctx.repo.create({
        hostname: 'patch.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      // Sleep at least 2ms to guarantee a strictly different millisecond
      // boundary on systems with coarse clock granularity.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = ctx.repo.update(created.id, { tlsMode: 'manual' });

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.tlsMode).toBe('manual');
      expect(updated.hostname).toBe(created.hostname);
      expect(updated.upstreamId).toBe(created.upstreamId);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it('throws NotFoundError when the id does not exist', () => {
      expect(() => ctx.repo.update(randomUUID(), { tlsMode: 'acme' })).toThrow(NotFoundError);
    });

    it('translates duplicate-hostname collisions to ConflictError', () => {
      ctx.repo.create({
        hostname: 'taken.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });
      const movable = ctx.repo.create({
        hostname: 'movable.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(() => ctx.repo.update(movable.id, { hostname: 'taken.test' })).toThrow(ConflictError);
    });

    it('translates unknown upstreamId on update to NotFoundError', () => {
      const site = ctx.repo.create({
        hostname: 'rebind.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(() => ctx.repo.update(site.id, { upstreamId: randomUUID() })).toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('removes the row and returns true', () => {
      const created = ctx.repo.create({
        hostname: 'remove.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(ctx.repo.delete(created.id)).toBe(true);
      expect(ctx.repo.findById(created.id)).toBeNull();
    });

    it('returns false when deleting an unknown id', () => {
      const created = ctx.repo.create({
        hostname: 'gone.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(ctx.repo.delete(created.id)).toBe(true);
      expect(ctx.repo.delete(created.id)).toBe(false);
    });
  });

  describe('referential integrity', () => {
    it('refuses to delete an upstream that a site still references (ON DELETE RESTRICT)', () => {
      ctx.repo.create({
        hostname: 'pinned.test',
        upstreamId: ctx.seedUpstreamId,
        tlsMode: 'off',
      });

      expect(() =>
        ctx.db.prepare('DELETE FROM upstreams WHERE id = ?').run(ctx.seedUpstreamId),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });
  });
});
