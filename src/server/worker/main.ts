#!/usr/bin/env node
/**
 * Long-running renewal worker entrypoint.
 *
 * `main()` runs an outer loop that calls {@link runRenewalCheck} every
 * {@link WorkerOptions.intervalMs} (default 6 hours), resolves the production
 * dependencies from the environment once on startup, and races the wait
 * between iterations against a SIGTERM/SIGINT-driven abort promise so the
 * worker shuts down promptly on signal.
 *
 * Shutdown semantics: we never interrupt a renewal mid-flight. The signal
 * handlers flip a flag and resolve the abort promise — the loop reads it
 * **after** the current `runRenewalCheck` returns, then exits cleanly. Let's
 * Encrypt orders are stateful and a half-completed order tends to consume
 * rate limit without producing a usable cert, so the cost of a clean wait
 * is worth more than a few seconds of shutdown latency.
 *
 * Importable + runnable: the bottom of this file uses the same
 * `import.meta.url === pathToFileURL(process.argv[1]).href` shim as
 * `src/index.ts`, so it works both as `node dist/server/worker/main.js` and
 * as an imported module from tests.
 *
 * The leading `#!/usr/bin/env node` shebang must stay on line 1 for the
 * `zoomies-worker` bin entry to be directly executable; TypeScript happily
 * carries the line through to the emitted JS as a comment-shaped no-op.
 */

import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getDb } from '../api/db-context.js';
import { CertRepository } from '../repositories/cert-repository.js';
import { loadOrCreateAccount, type AcmeAccount } from '../certs/acme-account.js';
import { createChallengeStore, type ChallengeStore } from '../certs/challenge-store.js';
import type { Cert } from '../domain/cert.js';
import { renewCertificate } from '../certs/renew.js';
import { runRenewalCheck } from '../certs/scheduler.js';

export interface WorkerOptions {
  /**
   * Polling cadence between renewal checks. Defaults to 6 hours — short
   * enough that a missed window heals on its own within a day, long enough
   * to keep journal noise low.
   */
  intervalMs?: number;
  /** If true, run one renewal check and return. Used by CI smoke tests. */
  once?: boolean;
}

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';

interface WorkerConfig {
  contactEmail: string;
  directoryUrl: string;
  stateDir: string;
  certDir: string;
}

function readConfigFromEnv(): WorkerConfig {
  const contactEmail = process.env.ZOOMIES_ACME_EMAIL;
  if (contactEmail === undefined || contactEmail === '') {
    throw new Error(
      'ZOOMIES_ACME_EMAIL is required — set it to a contact email registered with the ACME directory',
    );
  }
  const directoryUrl = process.env.ZOOMIES_ACME_DIRECTORY_URL ?? DEFAULT_DIRECTORY_URL;
  const stateDir = process.env.ZOOMIES_STATE_DIR ?? join(process.cwd(), '.zoomies');
  const certDir = process.env.ZOOMIES_CERT_DIR ?? join(stateDir, 'certs');
  return { contactEmail, directoryUrl, stateDir, certDir };
}

/**
 * Resolve a SIGTERM/SIGINT-driven abort promise. Returns an object the
 * caller can `await` and an `attach` that wires the handlers so signal
 * delivery resolves the promise.
 *
 * Calling `dispose()` removes the handlers; tests don't use this (smoke
 * test runs with `once: true`) but the production loop does after exit.
 */
function createAbortSignal(): {
  wait: Promise<void>;
  dispose: () => void;
} {
  let resolveWait!: () => void;
  const wait = new Promise<void>((r) => {
    resolveWait = r;
  });

  const onSignal = (signal: NodeJS.Signals): void => {
    console.info(`zoomies: received ${signal}, shutting down after current renewal check`);
    resolveWait();
  };
  const onTerm = (): void => onSignal('SIGTERM');
  const onInt = (): void => onSignal('SIGINT');
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);

  return {
    wait,
    dispose: (): void => {
      process.off('SIGTERM', onTerm);
      process.off('SIGINT', onInt);
    },
  };
}

/**
 * Wait for `ms` milliseconds OR for the abort promise to resolve, whichever
 * happens first. The `setTimeout` is `unref`'d so it never holds the event
 * loop open past a shutdown signal.
 */
async function waitOrAbort(ms: number, abort: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const sleep = new Promise<void>((resolveSleep) => {
    timer = setTimeout(resolveSleep, ms);
    timer.unref();
  });
  try {
    await Promise.race([sleep, abort]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Build a `renew(cert)` closure pre-bound to the production dependencies.
 *
 * The scheduler only knows about `Cert -> Promise<Cert>`, so the worker
 * owns the responsibility of capturing the ACME account, challenge store,
 * cert directory, and cert repository.
 */
function bindRenew(args: {
  account: AcmeAccount;
  challengeStore: ChallengeStore;
  certDir: string;
  certRepo: CertRepository;
}): (cert: Cert) => Promise<Cert> {
  return (cert) =>
    renewCertificate({
      cert,
      certRepo: args.certRepo,
      domain: cert.domain,
      account: args.account,
      challengeStore: args.challengeStore,
      certDir: args.certDir,
    });
}

/**
 * Worker entrypoint. Resolves the production deps from the environment,
 * then loops `runRenewalCheck` on the configured cadence until a shutdown
 * signal is received (or `opts.once` is true).
 */
export async function main(opts?: WorkerOptions): Promise<void> {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const once = opts?.once ?? false;

  const config = readConfigFromEnv();

  // Make sure the state, cert, and ACME challenge directories exist before
  // any code reaches for them. `recursive: true` makes this idempotent.
  await mkdir(config.certDir, { recursive: true });
  const challengeStore = createChallengeStore({ stateDir: config.stateDir });
  await mkdir(challengeStore.basePath, { recursive: true });

  const account = await loadOrCreateAccount({
    accountKeyPath: join(config.stateDir, 'acme-account.key'),
    contactEmail: config.contactEmail,
    directoryUrl: config.directoryUrl,
  });

  const certRepo = new CertRepository(getDb());
  const renew = bindRenew({
    account,
    challengeStore,
    certDir: config.certDir,
    certRepo,
  });

  // TODO: signal handling smoke test — currently exercised manually with
  // `kill -TERM <pid>`. Hard to automate without a child-process harness.
  const abort = once ? null : createAbortSignal();

  console.info('zoomies-worker: starting', {
    directoryUrl: config.directoryUrl,
    certDir: config.certDir,
    intervalMs,
    once,
  });

  try {
    while (true) {
      const result = await runRenewalCheck({ deps: { certRepo, renew } });
      console.info('zoomies-worker: renewal check complete', result);

      if (once || abort === null) {
        return;
      }

      // Race the sleep against the abort promise. If a signal was already
      // delivered while the renewal check was running, this resolves on the
      // next microtask and the loop exits.
      await waitOrAbort(intervalMs, abort.wait);
      const aborted = await Promise.race([abort.wait.then(() => true), Promise.resolve(false)]);
      if (aborted) {
        return;
      }
    }
  } finally {
    abort?.dispose();
  }
}

// Entrypoint shim — mirrors src/index.ts so the patterns stay consistent.
// `pathToFileURL` normalises the argv path so Windows + POSIX both match.
const entryArg = process.argv[1];
const entryUrl = entryArg ? pathToFileURL(resolve(entryArg)).href : undefined;
const isEntrypoint = entryUrl !== undefined && import.meta.url === entryUrl;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error('zoomies-worker: fatal error', err);
    process.exit(1);
  });
}
