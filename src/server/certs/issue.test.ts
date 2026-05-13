import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import acme from 'acme-client';

import { ValidationError } from '../domain/errors.js';
import { loadOrCreateAccount, type AcmeAccount } from './acme-account.js';
import { createChallengeStore, type ChallengeStore } from './challenge-store.js';
import { issueCertificate, type AcmeClientLike, type CertificateValidity } from './issue.js';

/**
 * Build a fake acme client. The flow asserts that the issuance code:
 *   - calls challengeCreateFn before resolving (so the store gets the token)
 *   - calls challengeRemoveFn afterwards (success-path cleanup)
 * Optional `throwAfterChallenge` injects a mid-flow failure to drive the
 * rollback path.
 */
function makeFakeClient(opts: {
  pem: string;
  token?: string;
  keyAuthorization?: string;
  throwAfterChallenge?: Error;
}): AcmeClientLike {
  const token = opts.token ?? 'token-abc';
  const keyAuthorization = opts.keyAuthorization ?? 'ka-xyz';

  return {
    async auto(autoOpts) {
      const authz = { identifier: { value: 'example.com' } };
      const challenge = { token, type: 'http-01' };

      await autoOpts.challengeCreateFn(authz, challenge, keyAuthorization);
      try {
        if (opts.throwAfterChallenge) {
          throw opts.throwAfterChallenge;
        }
        return opts.pem;
      } finally {
        await autoOpts.challengeRemoveFn(authz, challenge, keyAuthorization);
      }
    },
  };
}

/**
 * Build a canned validity-window reader. Keeps the cert PEM opaque to
 * the test (we never need a real x509 PEM because the parsing seam is
 * dependency-injected).
 */
function makeValidityReader(notBefore: Date, notAfter: Date): (pem: string) => CertificateValidity {
  return () => ({ notBefore, notAfter });
}

describe('issueCertificate', () => {
  let dir: string;
  let stateDir: string;
  let certDir: string;
  let challengeStore: ChallengeStore;
  let account: AcmeAccount;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-issue-'));
    stateDir = join(dir, 'state');
    certDir = join(dir, 'certs');
    await mkdir(certDir, { recursive: true });

    challengeStore = createChallengeStore({ stateDir });
    account = {
      accountKeyPem: (await acme.crypto.createPrivateKey()).toString('utf8'),
      contactEmail: 'admin@example.com',
      directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('happy path: writes a challenge file mid-call, removes it, lands cert + key on disk with key chmod 0o600', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
    const notBefore = new Date('2026-05-01T00:00:00.000Z');
    const notAfter = new Date('2026-07-30T00:00:00.000Z');
    const fakeClient = makeFakeClient({ pem, token: 'happy-token' });

    const result = await issueCertificate({
      domain: 'example.com',
      account,
      challengeStore,
      certDir,
      deps: {
        createClient: () => fakeClient,
        readCertificateValidity: makeValidityReader(notBefore, notAfter),
      },
    });

    // Cert + key on disk in expected locations.
    expect(result.pemPath).toBe(join(certDir, 'example.com.pem'));
    expect(result.keyPath).toBe(join(certDir, 'example.com.key'));
    expect(await readFile(result.pemPath, 'utf8')).toBe(pem);
    expect((await readFile(result.keyPath, 'utf8')).startsWith('-----BEGIN')).toBe(true);

    // Key is 0600 — sniff the low 9 bits since `mode` carries the file type too.
    const keyMode = (await stat(result.keyPath)).mode & 0o777;
    expect(keyMode).toBe(0o600);

    // Validity window serialised to ISO-8601 matches what the cert advertises.
    expect(result.notBefore).toBe(notBefore.toISOString());
    expect(result.notAfter).toBe(notAfter.toISOString());

    // The fake client called challengeRemoveFn, which deletes the file.
    await expect(readdir(challengeStore.basePath)).resolves.toEqual([]);
  });

  it('challengeCreateFn invoked with an invalid token surfaces ValidationError from the store', async () => {
    // Inject a malicious token via the fake client.
    const fakeClient = makeFakeClient({
      pem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
      token: '../../etc/passwd',
    });

    await expect(
      issueCertificate({
        domain: 'example.com',
        account,
        challengeStore,
        certDir,
        deps: {
          createClient: () => fakeClient,
          readCertificateValidity: makeValidityReader(new Date(), new Date()),
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // No cert/key files materialized because auto() threw before the writes.
    await expect(readdir(certDir)).resolves.toEqual([]);
  });

  it('auto() throws → cert and key files do not exist on disk afterwards', async () => {
    const fakeClient = makeFakeClient({
      pem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
      token: 'rollback-token',
      throwAfterChallenge: new Error('CA refused order'),
    });

    await expect(
      issueCertificate({
        domain: 'example.com',
        account,
        challengeStore,
        certDir,
        deps: {
          createClient: () => fakeClient,
          readCertificateValidity: makeValidityReader(new Date(), new Date()),
        },
      }),
    ).rejects.toThrow('CA refused order');

    // No files made it onto disk — auto() failed before we got to the writes,
    // and the challenge file was cleaned up by challengeRemoveFn.
    await expect(readdir(certDir)).resolves.toEqual([]);
    await expect(readdir(challengeStore.basePath)).resolves.toEqual([]);
  });

  it('rolls back the cert file when the key write fails mid-flow', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
    const fakeClient = makeFakeClient({ pem, token: 'rollback-pair' });

    // Real writeAtomic for the pem; throwing one for the key. This forces
    // the cert write to be rolled back via its handle.
    const { writeAtomic: realWriteAtomic } = await import('../reload/atomic-write.js');
    const writeFile = vi
      .fn<typeof realWriteAtomic>()
      .mockImplementationOnce(async (path: string, contents: string) =>
        realWriteAtomic(path, contents),
      )
      .mockImplementationOnce(async () => {
        throw new Error('disk full');
      });

    await expect(
      issueCertificate({
        domain: 'example.com',
        account,
        challengeStore,
        certDir,
        deps: {
          createClient: () => fakeClient,
          writeFile,
          readCertificateValidity: makeValidityReader(new Date(), new Date()),
        },
      }),
    ).rejects.toThrow('disk full');

    // Cert file was rolled back; the dir is empty.
    await expect(readdir(certDir)).resolves.toEqual([]);
  });
});

describe('loadOrCreateAccount', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-account-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('generates and persists a new account key when the path is absent', async () => {
    const accountKeyPath = join(dir, 'account.key');

    // Confirm the path is genuinely absent before the call.
    await expect(access(accountKeyPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const account = await loadOrCreateAccount({
      accountKeyPath,
      contactEmail: 'admin@example.com',
      directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    });

    expect(account.accountKeyPem.startsWith('-----BEGIN')).toBe(true);
    expect(await readFile(accountKeyPath, 'utf8')).toBe(account.accountKeyPem);
  });

  it('round-trips the same key across two calls (warm start does not regenerate)', async () => {
    const accountKeyPath = join(dir, 'account.key');

    const first = await loadOrCreateAccount({
      accountKeyPath,
      contactEmail: 'admin@example.com',
      directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    });
    const second = await loadOrCreateAccount({
      accountKeyPath,
      contactEmail: 'admin@example.com',
      directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    });

    expect(second.accountKeyPem).toBe(first.accountKeyPem);
  });
});
