/**
 * ACME account key lifecycle.
 *
 * Every ACME interaction is signed with a long-lived account key. The CA
 * binds issued certificates to the public half of this key, so it must
 * persist across renewals — generating a new account key per run would
 * leak per-host state to the CA and re-trigger ToS prompts.
 *
 * This module owns reading the account key from disk on warm start, and
 * generating + persisting a fresh one on cold start. The key material is
 * an RSA 2048 PEM produced by `acme-client`'s own crypto helper so we
 * don't have to reimplement key encoding.
 */

import { readFile } from 'node:fs/promises';

import acme from 'acme-client';

import { writeAtomic } from '../reload/atomic-write.js';

export interface AcmeAccount {
  /** PEM-encoded RSA or ECDSA private key, as required by acme.Client. */
  accountKeyPem: string;
  /** Contact email surfaced to the CA on account creation/update. */
  contactEmail: string;
  /** ACME directory URL — Let's Encrypt staging vs. production lives here. */
  directoryUrl: string;
}

export interface LoadOrCreateAccountOptions {
  /** Absolute path where the account key PEM is persisted across restarts. */
  accountKeyPath: string;
  contactEmail: string;
  directoryUrl: string;
}

/**
 * Return an {@link AcmeAccount}, creating + persisting a fresh account key
 * on cold start. Subsequent calls with the same `accountKeyPath` round-trip
 * the same key material byte-exact.
 *
 * The key file is written atomically — a crash mid-generation never leaves
 * a truncated PEM that would deadlock the next start.
 */
export async function loadOrCreateAccount(opts: LoadOrCreateAccountOptions): Promise<AcmeAccount> {
  const accountKeyPem = await loadOrGenerate(opts.accountKeyPath);

  return {
    accountKeyPem,
    contactEmail: opts.contactEmail,
    directoryUrl: opts.directoryUrl,
  };
}

async function loadOrGenerate(accountKeyPath: string): Promise<string> {
  try {
    return await readFile(accountKeyPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // No key on disk yet — generate one and persist it atomically so a crash
  // during generation never leaves a half-written PEM.
  const generated = await acme.crypto.createPrivateKey();
  const pem = generated.toString('utf8');
  await writeAtomic(accountKeyPath, pem);
  return pem;
}
