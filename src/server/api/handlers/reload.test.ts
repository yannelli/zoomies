import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import type { ApplyResult } from '../../reload/reload.js';
import { CertRepository } from '../../repositories/cert-repository.js';
import { SiteRepository } from '../../repositories/site-repository.js';
import { UpstreamRepository } from '../../repositories/upstream-repository.js';
import { applyReload } from './reload.js';

interface TestContext {
  db: Database.Database;
  siteRepo: SiteRepository;
  upstreamRepo: UpstreamRepository;
  certRepo: CertRepository;
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return {
    db,
    siteRepo: new SiteRepository(db),
    upstreamRepo: new UpstreamRepository(db),
    certRepo: new CertRepository(db),
  };
}

describe('applyReload', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  it('returns config_missing when sitesDir is unset', async () => {
    const result = await applyReload({
      siteRepo: ctx.siteRepo,
      upstreamRepo: ctx.upstreamRepo,
      certRepo: ctx.certRepo,
      healthCheckUrl: 'http://127.0.0.1/healthz',
    });

    expect(result).toEqual({
      ok: false,
      step: 'config',
      message: 'ZOOMIES_NGINX_SITES_DIR is not set',
      code: 'config_missing',
    });
  });

  it('returns config_missing when healthCheckUrl is unset', async () => {
    const result = await applyReload({
      siteRepo: ctx.siteRepo,
      upstreamRepo: ctx.upstreamRepo,
      certRepo: ctx.certRepo,
      sitesDir: '/etc/nginx/sites-zoomies',
    });

    expect(result).toEqual({
      ok: false,
      step: 'config',
      message: 'ZOOMIES_HEALTH_CHECK_URL is not set',
      code: 'config_missing',
    });
  });

  it('renders current repos and calls apply on success path', async () => {
    const upstream = ctx.upstreamRepo.create({
      name: 'pool',
      loadBalancer: 'round_robin',
      targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
    });
    ctx.siteRepo.create({
      hostname: 'example.test',
      upstreamId: upstream.id,
      tlsMode: 'off',
    });

    const apply = vi.fn(
      async (
        _rendered: ReadonlyMap<string, string>,
        _opts: { sitesDir: string; healthCheckUrl: string },
      ): Promise<ApplyResult> => ({ ok: true, step: 'success' }),
    );

    const result = await applyReload({
      siteRepo: ctx.siteRepo,
      upstreamRepo: ctx.upstreamRepo,
      certRepo: ctx.certRepo,
      sitesDir: '/etc/nginx/sites-zoomies',
      healthCheckUrl: 'http://127.0.0.1/healthz',
      apply,
    });

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(expect.any(Map), {
      sitesDir: '/etc/nginx/sites-zoomies',
      healthCheckUrl: 'http://127.0.0.1/healthz',
    });
    const rendered = apply.mock.calls[0]![0];
    expect(rendered.size).toBe(1);
  });

  it('propagates apply failure results', async () => {
    const apply = vi.fn(
      async (): Promise<ApplyResult> => ({
        ok: false,
        step: 'validate',
        message: 'nginx -t failed',
      }),
    );

    const result = await applyReload({
      siteRepo: ctx.siteRepo,
      upstreamRepo: ctx.upstreamRepo,
      certRepo: ctx.certRepo,
      sitesDir: '/etc/nginx/sites-zoomies',
      healthCheckUrl: 'http://127.0.0.1/healthz',
      apply,
    });

    expect(result).toEqual({
      ok: false,
      step: 'validate',
      message: 'nginx -t failed',
    });
  });
});
