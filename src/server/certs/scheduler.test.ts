import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type Database from 'better-sqlite3';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import type { Cert } from '../domain/cert.js';
import { CertRepository } from '../repositories/cert-repository.js';
import { runRenewalCheck } from './scheduler.js';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');
const now = (): Date => FIXED_NOW;

function isoDaysFromNow(days: number): string {
  return new Date(FIXED_NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function seedCert(
  repo: CertRepository,
  overrides: Partial<Omit<Cert, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Cert {
  return repo.create({
    domain: overrides.domain ?? 'example.com',
    provider: overrides.provider ?? 'acme',
    pemPath: overrides.pemPath ?? `/certs/${overrides.domain ?? 'example.com'}.pem`,
    keyPath: overrides.keyPath ?? `/certs/${overrides.domain ?? 'example.com'}.key`,
    // Default to a window that is well outside the renewal threshold.
    notBefore: overrides.notBefore ?? isoDaysFromNow(-30),
    notAfter: overrides.notAfter ?? isoDaysFromNow(60),
  });
}

describe('runRenewalCheck', () => {
  let db: Database.Database;
  let certRepo: CertRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    certRepo = new CertRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns zero counts when the cert table is empty', async () => {
    const renew = vi.fn<(cert: Cert) => Promise<Cert>>();

    const result = await runRenewalCheck({ deps: { certRepo, renew, now } });

    expect(result).toEqual({ checked: 0, renewed: 0, failed: [] });
    expect(renew).not.toHaveBeenCalled();
  });

  it('skips certs whose notAfter is outside the renewal window', async () => {
    seedCert(certRepo, { domain: 'safe.test', notAfter: isoDaysFromNow(60) });
    const renew = vi.fn<(cert: Cert) => Promise<Cert>>();

    const result = await runRenewalCheck({ deps: { certRepo, renew, now } });

    expect(result).toEqual({ checked: 0, renewed: 0, failed: [] });
    expect(renew).not.toHaveBeenCalled();
  });

  it('renews a cert whose notAfter falls inside the window and passes the row to the renewer', async () => {
    const seeded = seedCert(certRepo, {
      domain: 'expiring.test',
      notAfter: isoDaysFromNow(10),
    });
    const renew = vi.fn<(cert: Cert) => Promise<Cert>>().mockResolvedValue(seeded);

    const result = await runRenewalCheck({ deps: { certRepo, renew, now } });

    expect(result.checked).toBe(1);
    expect(result.renewed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(seeded);
  });

  it('renews only certs whose provider is acme, leaving manual rows alone', async () => {
    const acmeCert = seedCert(certRepo, {
      domain: 'auto.test',
      provider: 'acme',
      notAfter: isoDaysFromNow(5),
    });
    seedCert(certRepo, {
      domain: 'manual.test',
      provider: 'manual',
      notAfter: isoDaysFromNow(5),
    });
    const renew = vi.fn<(cert: Cert) => Promise<Cert>>().mockResolvedValue(acmeCert);

    const result = await runRenewalCheck({ deps: { certRepo, renew, now } });

    expect(result.checked).toBe(1);
    expect(result.renewed).toBe(1);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(acmeCert);
  });

  it('continues past a failing renewal and records it in the failed list', async () => {
    const good = seedCert(certRepo, { domain: 'good.test', notAfter: isoDaysFromNow(7) });
    const bad = seedCert(certRepo, { domain: 'bad.test', notAfter: isoDaysFromNow(8) });

    const renew = vi.fn<(cert: Cert) => Promise<Cert>>().mockImplementation(async (cert) => {
      if (cert.domain === 'bad.test') {
        throw new Error('CA refused order');
      }
      return cert;
    });
    const log = vi.fn<(msg: string, meta?: Record<string, unknown>) => void>();

    const result = await runRenewalCheck({ deps: { certRepo, renew, now, log } });

    expect(result.checked).toBe(2);
    expect(result.renewed).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toEqual({ domain: 'bad.test', error: 'CA refused order' });
    expect(renew).toHaveBeenCalledTimes(2);
    expect(renew).toHaveBeenCalledWith(good);
    expect(renew).toHaveBeenCalledWith(bad);
    // The failed branch logged the failure with structured meta.
    expect(log).toHaveBeenCalledWith(
      'zoomies: renewal failed',
      expect.objectContaining({ domain: 'bad.test' }),
    );
  });

  it('honours a custom renewWithinDays — a 14-day-out cert is not touched when window is 7', async () => {
    seedCert(certRepo, { domain: 'fortnight.test', notAfter: isoDaysFromNow(14) });
    const renew = vi.fn<(cert: Cert) => Promise<Cert>>();

    const result = await runRenewalCheck({
      renewWithinDays: 7,
      deps: { certRepo, renew, now },
    });

    expect(result).toEqual({ checked: 0, renewed: 0, failed: [] });
    expect(renew).not.toHaveBeenCalled();
  });

  it('uses an injected now() so threshold math is deterministic', async () => {
    // Seed a cert that expires exactly 30 days after the fixed clock.
    // With the default 30-day window, it should be picked up.
    const cert = seedCert(certRepo, {
      domain: 'edge.test',
      notAfter: isoDaysFromNow(30),
    });
    const renew = vi.fn<(c: Cert) => Promise<Cert>>().mockResolvedValue(cert);

    const result = await runRenewalCheck({ deps: { certRepo, renew, now } });

    expect(result.checked).toBe(1);
    expect(result.renewed).toBe(1);
    expect(renew).toHaveBeenCalledWith(cert);
  });
});
