import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { CertRepository } from '../repositories/cert-repository.js';
import { SiteRepository } from '../repositories/site-repository.js';
import { UpstreamRepository } from '../repositories/upstream-repository.js';
import type * as ReloadModule from '../reload/reload.js';

import {
  ensureDemoSite,
  parseUpstreamUrl,
  readDemoConfigFromEnv,
  type DemoBootstrapDeps,
} from './demo-site.js';

import type { Database } from 'better-sqlite3';

// We never want the real reload orchestrator running during these unit
// tests — it would try to validate config with the real `nginx` binary
// and signal a nonexistent master. Replace it with a no-op success.
vi.mock('../reload/reload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReloadModule>();
  return {
    ...actual,
    applyDesiredState: vi.fn(async () => ({ ok: true, step: 'success' as const })),
  };
});

describe('parseUpstreamUrl', () => {
  it.each([
    ['http://app:3000', { host: 'app', port: 3000 }],
    ['http://127.0.0.1:8080', { host: '127.0.0.1', port: 8080 }],
    ['https://example.com', { host: 'example.com', port: 443 }],
    ['http://example.com', { host: 'example.com', port: 80 }],
  ])('parses %s', (raw, expected) => {
    expect(parseUpstreamUrl(raw)).toEqual(expected);
  });

  it.each([
    'not-a-url',
    'ftp://example.com',
    'http://',
    'http://example.com:0',
    'http://example.com:99999',
  ])('rejects %s', (raw) => {
    expect(parseUpstreamUrl(raw)).toBeNull();
  });
});

describe('readDemoConfigFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when ZOOMIES_DEMO_UPSTREAM is unset', () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', '');
    expect(readDemoConfigFromEnv()).toBeNull();
  });

  it('reads all overrides from env', () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', 'http://app:3000');
    vi.stubEnv('ZOOMIES_DEMO_HOSTNAME', 'demo.local');
    vi.stubEnv('ZOOMIES_DEFAULT_CERT_PEM', '/tmp/x.pem');
    vi.stubEnv('ZOOMIES_DEFAULT_CERT_KEY', '/tmp/x.key');
    vi.stubEnv('ZOOMIES_NGINX_SITES_DIR', '/tmp/sites');
    vi.stubEnv('ZOOMIES_HEALTH_CHECK_URL', 'http://nginx/api/healthz');

    expect(readDemoConfigFromEnv()).toEqual({
      hostname: 'demo.local',
      upstream: 'http://app:3000',
      certPemPath: '/tmp/x.pem',
      certKeyPath: '/tmp/x.key',
      sitesDir: '/tmp/sites',
      healthCheckUrl: 'http://nginx/api/healthz',
    });
  });
});

describe('ensureDemoSite', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  function makeDeps(overrides: Partial<DemoBootstrapDeps> = {}): DemoBootstrapDeps {
    return {
      db,
      ensureSnakeoilCert: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('returns disabled when ZOOMIES_DEMO_UPSTREAM is unset', async () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', '');
    const result = await ensureDemoSite(makeDeps());
    expect(result.status).toBe('disabled');
  });

  it('rejects an invalid upstream URL without touching the DB', async () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', 'not-a-url');
    const result = await ensureDemoSite(makeDeps());
    expect(result.status).toBe('skipped-invalid-config');
    expect(new SiteRepository(db).list()).toEqual([]);
  });

  it('seeds site + upstream + cert when none exist and ensures the snakeoil cert', async () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', 'http://app:3000');
    vi.stubEnv('ZOOMIES_DEMO_HOSTNAME', 'localhost');
    vi.stubEnv('ZOOMIES_DEFAULT_CERT_PEM', '/var/lib/zoomies/certs/_default/fullchain.pem');
    vi.stubEnv('ZOOMIES_DEFAULT_CERT_KEY', '/var/lib/zoomies/certs/_default/privkey.pem');

    const ensureSnakeoilCert = vi.fn(async () => {});
    const result = await ensureDemoSite(makeDeps({ ensureSnakeoilCert }));

    expect(result.status).toBe('created');
    expect(ensureSnakeoilCert).toHaveBeenCalledTimes(1);
    expect(ensureSnakeoilCert).toHaveBeenCalledWith(
      '/var/lib/zoomies/certs/_default/fullchain.pem',
      '/var/lib/zoomies/certs/_default/privkey.pem',
      'localhost',
    );

    const sites = new SiteRepository(db).list();
    expect(sites).toHaveLength(1);
    expect(sites[0]?.hostname).toBe('localhost');
    expect(sites[0]?.tlsMode).toBe('manual');

    const upstreams = new UpstreamRepository(db).list();
    expect(upstreams).toHaveLength(1);
    expect(upstreams[0]?.targets).toEqual([{ host: 'app', port: 3000, weight: 1 }]);

    const certs = new CertRepository(db).list();
    expect(certs).toHaveLength(1);
    expect(certs[0]?.domain).toBe('localhost');
    expect(certs[0]?.provider).toBe('manual');
  });

  it('is idempotent — a second call with a site already present does nothing', async () => {
    vi.stubEnv('ZOOMIES_DEMO_UPSTREAM', 'http://app:3000');
    vi.stubEnv('ZOOMIES_DEMO_HOSTNAME', 'localhost');

    const ensureSnakeoilCert = vi.fn(async () => {});
    const first = await ensureDemoSite(makeDeps({ ensureSnakeoilCert }));
    expect(first.status).toBe('created');

    const ensureSnakeoilCert2 = vi.fn(async () => {});
    const second = await ensureDemoSite(makeDeps({ ensureSnakeoilCert: ensureSnakeoilCert2 }));
    expect(second.status).toBe('already-present');
    expect(ensureSnakeoilCert2).not.toHaveBeenCalled();
    expect(new SiteRepository(db).list()).toHaveLength(1);
  });
});
