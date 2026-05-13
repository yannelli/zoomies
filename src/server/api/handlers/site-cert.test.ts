import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcmeAccount } from '../../certs/acme-account.js';
import type { ChallengeStore } from '../../certs/challenge-store.js';
import type { IssueResult } from '../../certs/issue.js';
import { openDatabase } from '../../db/connection.js';
import { runMigrations } from '../../db/migrate.js';
import { NotFoundError } from '../../domain/errors.js';
import { CertRepository } from '../../repositories/cert-repository.js';
import { SiteRepository } from '../../repositories/site-repository.js';
import { UpstreamRepository } from '../../repositories/upstream-repository.js';
import { issueCertForSite, type IssueCertForSiteDeps } from './site-cert.js';

interface TestContext {
  db: Database.Database;
  siteRepo: SiteRepository;
  certRepo: CertRepository;
  upstreamRepo: UpstreamRepository;
}

function setup(): TestContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return {
    db,
    siteRepo: new SiteRepository(db),
    certRepo: new CertRepository(db),
    upstreamRepo: new UpstreamRepository(db),
  };
}

function seedSite(ctx: TestContext, hostname: string): string {
  const upstream = ctx.upstreamRepo.create({
    name: `${hostname}-pool`,
    loadBalancer: 'round_robin',
    targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
  });
  const site = ctx.siteRepo.create({
    hostname,
    upstreamId: upstream.id,
    tlsMode: 'acme',
  });
  return site.id;
}

function fakeAccount(): AcmeAccount {
  return {
    accountKeyPem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    contactEmail: 'admin@example.com',
    directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  };
}

function fakeChallengeStore(): ChallengeStore {
  return {
    basePath: '/tmp/zoomies-test-challenge',
    write: async () => undefined,
    remove: async () => undefined,
  };
}

function makeDeps(ctx: TestContext, issue: IssueCertForSiteDeps['issue']): IssueCertForSiteDeps {
  return {
    siteRepo: ctx.siteRepo,
    certRepo: ctx.certRepo,
    account: fakeAccount(),
    challengeStore: fakeChallengeStore(),
    certDir: '/tmp/zoomies-test-certs',
    issue,
  };
}

function fakeIssueResult(domain: string): IssueResult {
  return {
    domain,
    pemPath: `/tmp/zoomies-test-certs/${domain}.pem`,
    keyPath: `/tmp/zoomies-test-certs/${domain}.key`,
    notBefore: '2026-05-01T00:00:00.000Z',
    notAfter: '2026-07-30T00:00:00.000Z',
  };
}

describe('issueCertForSite', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
  });

  it('creates a new cert row when none exists for the hostname', async () => {
    const siteId = seedSite(ctx, 'fresh.test');
    const issue = vi
      .fn<IssueCertForSiteDeps['issue']>()
      .mockResolvedValue(fakeIssueResult('fresh.test'));

    const result = await issueCertForSite(siteId, makeDeps(ctx, issue));

    expect(result.domain).toBe('fresh.test');
    expect(result.provider).toBe('acme');
    expect(result.notAfter).toBe('2026-07-30T00:00:00.000Z');

    const all = ctx.certRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(result.id);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'fresh.test', certDir: '/tmp/zoomies-test-certs' }),
    );
  });

  it('updates the existing cert row instead of creating a duplicate', async () => {
    const siteId = seedSite(ctx, 'renew.test');

    // Seed an existing cert row so the handler's branch falls into update.
    const seeded = ctx.certRepo.create({
      domain: 'renew.test',
      provider: 'acme',
      pemPath: '/old/renew.test.pem',
      keyPath: '/old/renew.test.key',
      notBefore: '2020-01-01T00:00:00.000Z',
      notAfter: '2020-04-01T00:00:00.000Z',
    });

    const issue = vi
      .fn<IssueCertForSiteDeps['issue']>()
      .mockResolvedValue(fakeIssueResult('renew.test'));

    const result = await issueCertForSite(siteId, makeDeps(ctx, issue));

    // Same row id — update, not insert.
    expect(result.id).toBe(seeded.id);
    expect(result.notAfter).toBe('2026-07-30T00:00:00.000Z');
    expect(result.pemPath).toBe('/tmp/zoomies-test-certs/renew.test.pem');

    // Still exactly one row in the table.
    expect(ctx.certRepo.list()).toHaveLength(1);
  });

  it('throws NotFoundError when the site does not exist', async () => {
    const issue = vi.fn<IssueCertForSiteDeps['issue']>();

    await expect(issueCertForSite(randomUUID(), makeDeps(ctx, issue))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(issue).not.toHaveBeenCalled();
  });

  it('leaves the cert table unchanged when issue() throws', async () => {
    const siteId = seedSite(ctx, 'fail.test');
    const issue = vi
      .fn<IssueCertForSiteDeps['issue']>()
      .mockRejectedValue(new Error('CA refused order'));

    await expect(issueCertForSite(siteId, makeDeps(ctx, issue))).rejects.toThrow(
      'CA refused order',
    );

    expect(ctx.certRepo.list()).toEqual([]);
  });
});
