/**
 * Single-shot ACME certificate issuance with HTTP-01.
 *
 * Drives the full happy-path: generate a per-domain key + CSR, ask
 * `acme-client.auto()` to negotiate the order, hand off the resulting PEM
 * chain + private key onto disk atomically, and extract the validity
 * window from the leaf certificate so the caller (issue endpoint or renew
 * loop) can persist a `Cert` row.
 *
 * Side effects are bracketed by rollback:
 *   - Challenge files are cleaned up by `challengeRemoveFn` (acme-client
 *     calls it in both success and failure paths in current versions).
 *   - PEM + key writes use {@link writeAtomic} and are rolled back if any
 *     later step throws — never leave a half-issued cert on disk that a
 *     reload could pick up.
 *
 * The acme-client surface is wrapped behind {@link AcmeClientLike} so
 * tests can substitute a fake without depending on the library's full
 * type surface, which has historically shifted between minor versions.
 */

import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

import acme from 'acme-client';

import type { AtomicRollback } from '../reload/atomic-write.js';
import { writeAtomic } from '../reload/atomic-write.js';
import type { AcmeAccount } from './acme-account.js';
import type { ChallengeStore } from './challenge-store.js';

/**
 * Minimal slice of `acme-client.Client` that the issuance flow actually
 * touches. Keep this narrow so tests can implement it without pulling in
 * the real client's surface.
 */
export interface AcmeClientLike {
  /**
   * Drive the ACME order to completion using HTTP-01. Returns the PEM
   * chain of the issued certificate (leaf first).
   */
  auto(opts: {
    csr: Buffer;
    email: string;
    termsOfServiceAgreed: boolean;
    challengeCreateFn: (
      authz: { identifier: { value: string } },
      challenge: { token: string; type: string },
      keyAuthorization: string,
    ) => Promise<void>;
    challengeRemoveFn: (
      authz: { identifier: { value: string } },
      challenge: { token: string; type: string },
      keyAuthorization: string,
    ) => Promise<void>;
  }): Promise<string>;
}

/**
 * Validity window extracted from a PEM-encoded leaf certificate. Both
 * fields must be `Date` instances; the caller serialises to ISO-8601.
 */
export interface CertificateValidity {
  notBefore: Date;
  notAfter: Date;
}

export interface IssueDeps {
  /**
   * Factory for the ACME client. Default wraps `acme.Client` from
   * `acme-client`; tests substitute a fake that returns a canned PEM.
   */
  createClient: (account: AcmeAccount) => AcmeClientLike;
  /**
   * Atomic file writer. Defaults to the production {@link writeAtomic};
   * tests rarely override but the seam is here for parity with the rest
   * of the codebase.
   */
  writeFile: typeof writeAtomic;
  /**
   * Parse the validity window out of a leaf certificate PEM. Defaults to
   * `acme.crypto.readCertificateInfo`. Injected so tests can avoid having
   * to construct a fully-valid x509 PEM with non-degenerate dates.
   */
  readCertificateValidity: (pemChain: string) => CertificateValidity;
}

export interface IssueOptions {
  domain: string;
  account: AcmeAccount;
  challengeStore: ChallengeStore;
  /** Directory to write `<domain>.pem` and `<domain>.key` into. */
  certDir: string;
  deps?: Partial<IssueDeps>;
}

export interface IssueResult {
  domain: string;
  pemPath: string;
  keyPath: string;
  /** ISO-8601 — directly insertable into the `certs` table. */
  notBefore: string;
  /** ISO-8601 — directly insertable into the `certs` table. */
  notAfter: string;
}

/**
 * Default factory wrapping `acme.Client`. The narrow {@link AcmeClientLike}
 * type means we cast at the boundary; the cast is safe because the real
 * `auto` signature is a superset of our minimal interface.
 */
function defaultCreateClient(account: AcmeAccount): AcmeClientLike {
  const client = new acme.Client({
    directoryUrl: account.directoryUrl,
    accountKey: account.accountKeyPem,
  });
  return client as unknown as AcmeClientLike;
}

function defaultReadCertificateValidity(pemChain: string): CertificateValidity {
  const info = acme.crypto.readCertificateInfo(pemChain);
  return { notBefore: info.notBefore, notAfter: info.notAfter };
}

const defaultDeps: IssueDeps = {
  createClient: defaultCreateClient,
  writeFile: writeAtomic,
  readCertificateValidity: defaultReadCertificateValidity,
};

/**
 * Issue a single certificate via HTTP-01. Returns the data needed to
 * insert (or update) a `Cert` row — the caller is responsible for that
 * persistence step.
 */
export async function issueCertificate(opts: IssueOptions): Promise<IssueResult> {
  const deps: IssueDeps = { ...defaultDeps, ...opts.deps };
  const { domain, account, challengeStore, certDir } = opts;

  // 1. Per-domain key + CSR. acme-client returns a tuple of [keyPem, csrPem]
  //    and we hand the CSR (as a Buffer) into `auto`.
  const [keyPem, csrBuffer] = await acme.crypto.createCsr({
    commonName: domain,
    altNames: [domain],
  });

  // 2. Drive the order. challengeCreateFn / challengeRemoveFn mediate the
  //    HTTP-01 dance via the store. acme-client invokes Remove on success
  //    AND failure paths, so we don't need to track tokens ourselves.
  const client = deps.createClient(account);
  const pemChain = await client.auto({
    csr: csrBuffer,
    email: account.contactEmail,
    termsOfServiceAgreed: true,
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      await challengeStore.write(challenge.token, keyAuthorization);
    },
    challengeRemoveFn: async (_authz, challenge) => {
      await challengeStore.remove(challenge.token);
    },
  });

  // 3. Validity window from the leaf cert. The dep returns `Date` instances;
  //    we serialise to ISO-8601 to match the rest of the schema.
  const validity = deps.readCertificateValidity(pemChain);
  const notBefore = validity.notBefore.toISOString();
  const notAfter = validity.notAfter.toISOString();

  // 4. Atomically write the cert + key. If either step throws, roll the
  //    other back so an issuance failure never leaves a half-installed
  //    pair on disk.
  const pemPath = join(certDir, `${domain}.pem`);
  const keyPath = join(certDir, `${domain}.key`);

  const rollbacks: AtomicRollback[] = [];
  try {
    rollbacks.push(await deps.writeFile(pemPath, pemChain));
    rollbacks.push(await deps.writeFile(keyPath, keyPem.toString('utf8')));
    // Private key must not be world-readable. The atomic write applies its
    // default mode; tighten via chmod after the rename so the tightening
    // is atomic relative to the file's final identity.
    await chmod(keyPath, 0o600);
  } catch (err) {
    for (const handle of rollbacks.reverse()) {
      try {
        await handle.restore();
      } catch {
        // Best-effort rollback — don't mask the original error.
      }
    }
    throw err;
  }

  return { domain, pemPath, keyPath, notBefore, notAfter };
}
