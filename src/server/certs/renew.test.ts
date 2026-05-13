import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import acme from 'acme-client';

import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { CertRepository } from '../repositories/cert-repository.js';
import type { AcmeAccount } from './acme-account.js';
import { createChallengeStore, type ChallengeStore } from './challenge-store.js';
import type { AcmeClientLike, CertificateValidity } from './issue.js';
import { renewCertificate } from './renew.js';

function makeFakeClient(pem: string): AcmeClientLike {
  return {
    async auto(opts) {
      const authz = { identifier: { value: 'example.com' } };
      const challenge = { token: 'renew-token', type: 'http-01' };
      await opts.challengeCreateFn(authz, challenge, 'ka');
      try {
        return pem;
      } finally {
        await opts.challengeRemoveFn(authz, challenge, 'ka');
      }
    },
  };
}

function makeFakeClientThatThrows(): AcmeClientLike {
  return {
    async auto(opts) {
      const authz = { identifier: { value: 'example.com' } };
      const challenge = { token: 'fail-token', type: 'http-01' };
      await opts.challengeCreateFn(authz, challenge, 'ka');
      try {
        throw new Error('renew CA refused order');
      } finally {
        await opts.challengeRemoveFn(authz, challenge, 'ka');
      }
    },
  };
}

function makeValidityReader(notBefore: Date, notAfter: Date): (pem: string) => CertificateValidity {
  return () => ({ notBefore, notAfter });
}

describe('renewCertificate', () => {
  let dir: string;
  let stateDir: string;
  let certDir: string;
  let db: Database.Database;
  let certRepo: CertRepository;
  let challengeStore: ChallengeStore;
  let account: AcmeAccount;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-renew-'));
    stateDir = join(dir, 'state');
    certDir = join(dir, 'certs');
    await mkdir(certDir, { recursive: true });

    db = openDatabase(':memory:');
    runMigrations(db);
    certRepo = new CertRepository(db);
    challengeStore = createChallengeStore({ stateDir });
    account = {
      accountKeyPem: (await acme.crypto.createPrivateKey()).toString('utf8'),
      contactEmail: 'admin@example.com',
      directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    };
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('updates the existing row with the renewed validity window and bumps updatedAt', async () => {
    // Seed an existing cert row whose validity window is well in the past
    // so the renewed window is unambiguously different.
    const seeded = certRepo.create({
      domain: 'example.com',
      provider: 'acme',
      pemPath: join(certDir, 'example.com.pem'),
      keyPath: join(certDir, 'example.com.key'),
      notBefore: '2020-01-01T00:00:00.000Z',
      notAfter: '2020-04-01T00:00:00.000Z',
    });

    // Small wait so updatedAt (post-renew) is strictly later than the
    // seeded createdAt — ISO comparison needs at least 1ms.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const renewedNotBefore = new Date('2026-05-01T00:00:00.000Z');
    const renewedNotAfter = new Date('2026-07-30T00:00:00.000Z');
    const pem = '-----BEGIN CERTIFICATE-----\nFAKE-RENEWED\n-----END CERTIFICATE-----\n';

    const renewed = await renewCertificate({
      cert: seeded,
      certRepo,
      domain: 'example.com',
      account,
      challengeStore,
      certDir,
      deps: {
        createClient: () => makeFakeClient(pem),
        readCertificateValidity: makeValidityReader(renewedNotBefore, renewedNotAfter),
      },
    });

    expect(renewed.id).toBe(seeded.id);
    expect(renewed.domain).toBe('example.com');
    expect(renewed.notBefore).toBe(renewedNotBefore.toISOString());
    expect(renewed.notAfter).toBe(renewedNotAfter.toISOString());
    expect(Date.parse(renewed.notAfter)).toBeGreaterThan(Date.parse(seeded.notAfter));
    // updatedAt advanced; createdAt did not.
    expect(Date.parse(renewed.updatedAt)).toBeGreaterThan(Date.parse(seeded.updatedAt));
    expect(renewed.createdAt).toBe(seeded.createdAt);
  });

  it('leaves the DB row unchanged when issuance fails', async () => {
    const seeded = certRepo.create({
      domain: 'example.com',
      provider: 'acme',
      pemPath: join(certDir, 'example.com.pem'),
      keyPath: join(certDir, 'example.com.key'),
      notBefore: '2020-01-01T00:00:00.000Z',
      notAfter: '2020-04-01T00:00:00.000Z',
    });

    await expect(
      renewCertificate({
        cert: seeded,
        certRepo,
        domain: 'example.com',
        account,
        challengeStore,
        certDir,
        deps: {
          createClient: () => makeFakeClientThatThrows(),
          readCertificateValidity: makeValidityReader(new Date(), new Date()),
        },
      }),
    ).rejects.toThrow('renew CA refused order');

    // DB row untouched: same notAfter, same updatedAt.
    const after = certRepo.findById(seeded.id);
    expect(after).not.toBeNull();
    expect(after!.notAfter).toBe(seeded.notAfter);
    expect(after!.updatedAt).toBe(seeded.updatedAt);
  });
});
