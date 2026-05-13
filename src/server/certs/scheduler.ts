/**
 * Periodic renewal scheduler for ACME-issued certificates.
 *
 * The scheduler walks the cert repository, filters to `provider === 'acme'`
 * certificates whose `notAfter` falls within a configurable lead window, and
 * delegates each to a pre-bound {@link RenewalSchedulerDeps.renew} closure.
 * Renewals are awaited **sequentially** — Let's Encrypt rate limits favour
 * one-order-at-a-time over parallel bursts, and a serial loop also keeps
 * accounting simple if any one renewal fails partway through.
 *
 * This module is intentionally pure-ish: no `setTimeout`, no infinite loop,
 * no signal handling. The {@link main} worker in `src/server/worker/main.ts`
 * drives the cadence and owns the process lifecycle.
 *
 * Failure handling: a thrown renewal is logged, recorded in
 * {@link RenewalRunResult.failed}, and the loop continues with the next cert.
 * A single bad cert (e.g. a dropped DNS record) must not block renewals for
 * every other domain on the host.
 */

import type { Cert } from '../domain/cert.js';
import type { CertRepository } from '../repositories/cert-repository.js';

export interface RenewalSchedulerDeps {
  certRepo: CertRepository;
  /**
   * Per-cert renewal closure. Production code pre-binds the ACME account,
   * challenge store, cert directory, and repository so the scheduler only
   * needs to pass the cert row.
   */
  renew: (cert: Cert) => Promise<Cert>;
  /** Time source. Defaults to `() => new Date()`; injected for determinism. */
  now?: () => Date;
  /**
   * Structured-ish logger. Defaults to `console.info`. The first arg is a
   * human-readable message; the optional second arg is a metadata bag so
   * production logs can be parsed by a journal collector without regex.
   */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface RenewalSchedulerOptions {
  /**
   * Renew certificates whose `notAfter` lies within this many days of `now`.
   * Defaults to 30, matching Let's Encrypt's recommended renewal threshold
   * (90-day lifetime, renew at T-30).
   */
  renewWithinDays?: number;
  deps: RenewalSchedulerDeps;
}

export interface RenewalRunResult {
  /** Number of `acme` certs that were inspected for renewal eligibility. */
  checked: number;
  /** Number of certs successfully renewed in this run. */
  renewed: number;
  /** One entry per failed renewal, in iteration order. */
  failed: Array<{ domain: string; error: string }>;
}

const DEFAULT_RENEW_WITHIN_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function defaultLog(message: string, meta?: Record<string, unknown>): void {
  if (meta === undefined) {
    console.info(message);
  } else {
    console.info(message, meta);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Execute a single renewal pass.
 *
 * Lists every cert, filters to ACME-managed rows whose validity window ends
 * within the configured lead time, and awaits each renewal in turn. Returns
 * a summary describing what happened — the worker logs it and decides when
 * to run again.
 */
export async function runRenewalCheck(opts: RenewalSchedulerOptions): Promise<RenewalRunResult> {
  const renewWithinDays = opts.renewWithinDays ?? DEFAULT_RENEW_WITHIN_DAYS;
  const { certRepo, renew } = opts.deps;
  const now = opts.deps.now ?? (() => new Date());
  const log = opts.deps.log ?? defaultLog;

  const threshold = new Date(now().getTime() + renewWithinDays * MS_PER_DAY);

  // Filter to ACME-managed certs whose validity window ends before the
  // threshold. Manual certs are owned by the operator — the scheduler
  // never touches them.
  const candidates = certRepo
    .list()
    .filter((cert) => cert.provider === 'acme')
    .filter((cert) => Date.parse(cert.notAfter) <= threshold.getTime());

  const result: RenewalRunResult = {
    checked: candidates.length,
    renewed: 0,
    failed: [],
  };

  for (const cert of candidates) {
    try {
      await renew(cert);
      result.renewed += 1;
      log('zoomies: renewed cert', { domain: cert.domain });
    } catch (err) {
      const message = formatError(err);
      result.failed.push({ domain: cert.domain, error: message });
      log('zoomies: renewal failed', { domain: cert.domain, error: message });
    }
  }

  return result;
}
