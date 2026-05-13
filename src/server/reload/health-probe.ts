/**
 * HTTP health probe with exponential backoff.
 *
 * Used by the reload orchestrator to confirm NGINX is still serving traffic
 * after a config reload. Failures are returned as a result object rather than
 * thrown: the orchestrator decides whether a failed probe triggers a
 * rollback, and we don't want a thrown error to short-circuit cleanup paths.
 *
 * The implementation uses native `fetch` (Node 22+) and `AbortSignal.timeout`
 * so there is no runtime dependency to add.
 */

/** Default `acceptStatus` — any 2xx is treated as a healthy response. */
function isTwoXx(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Sleeps for the given number of milliseconds.
 *
 * Wraps `setTimeout` in a Promise so that callers can `await` it. We avoid
 * pulling in `timers/promises` so the implementation stays trivial and is
 * easy to control from tests via Vitest's fake timers.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Caller-supplied configuration for {@link probeHealth}.
 *
 * The defaults are tuned for a freshly-reloaded NGINX: five attempts with
 * exponential backoff starting at 200ms gives roughly 6.2 seconds of total
 * wall-clock budget, which comfortably exceeds the time NGINX needs to
 * finish reloading worker processes on a healthy host.
 */
export interface HealthProbeOptions {
  /** Target URL — typically `http://127.0.0.1/healthz` or similar. */
  url: string;
  /** Maximum number of HTTP attempts. Defaults to 5. */
  maxAttempts?: number;
  /**
   * Base delay (ms) for the exponential backoff between attempts. The actual
   * delay before attempt `n` (1-indexed) is `baseDelayMs * 2^(n - 1)`.
   * Defaults to 200ms (so: 200, 400, 800, 1600, 3200 with the default
   * `maxAttempts`).
   */
  baseDelayMs?: number;
  /** Per-attempt timeout (ms). Defaults to 2000. */
  timeoutMs?: number;
  /**
   * Predicate that decides whether a response is healthy. Defaults to "any
   * 2xx". The orchestrator can override this for endpoints that return e.g.
   * 204 on success.
   */
  acceptStatus?: (status: number) => boolean;
}

/**
 * Outcome of a probe run. `ok` is the only field the orchestrator needs to
 * branch on — the other fields exist so failures can be surfaced to
 * operators with enough context to debug.
 */
export interface HealthProbeResult {
  ok: boolean;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
}

/**
 * Extracts a string message from an unknown thrown value. `fetch` and
 * `AbortSignal` throw a mix of `DOMException`, `TypeError`, and `Error`
 * subclasses; we normalize so `lastError` is always a useful string.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    // `AbortError` / `TimeoutError` thrown by `AbortSignal.timeout` are
    // DOMException subclasses on some runtimes — their `name` is the
    // discriminator. Surface both name and message so timeouts are
    // distinguishable from generic network errors.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `${err.name}: ${err.message || 'request aborted'}`;
    }
    return err.message;
  }
  return String(err);
}

/**
 * Probes an HTTP endpoint until it returns an acceptable status or
 * `maxAttempts` is exhausted.
 *
 * The function never throws — transport errors, aborts, and non-acceptable
 * statuses are all reported via the returned {@link HealthProbeResult}.
 * Backoff uses the formula `baseDelayMs * 2^(attempt - 1)` and is skipped
 * after the final attempt (no point waiting if we're not retrying).
 */
export async function probeHealth(opts: HealthProbeOptions): Promise<HealthProbeResult> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const acceptStatus = opts.acceptStatus ?? isTwoXx;

  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // `AbortSignal.timeout` ties the per-attempt deadline to a fresh signal
    // each iteration so a slow attempt cannot bleed its abort into the next
    // one. On Node 22 the underlying timer is unref'd, which is the
    // behaviour we want — a hung probe must not keep the process alive.
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetch(opts.url, { signal });
      lastStatus = response.status;
      lastError = undefined;

      if (acceptStatus(response.status)) {
        const result: HealthProbeResult = {
          ok: true,
          attempts: attempt,
          lastStatus: response.status,
        };
        return result;
      }
      // Non-acceptable status falls through to the retry path.
    } catch (err) {
      lastError = describeError(err);
      // Network failures / aborts also fall through to retry.
    }

    // Skip backoff after the final attempt — we're about to return failure
    // either way, so the sleep would just delay the bad news.
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  const failure: HealthProbeResult = {
    ok: false,
    attempts: maxAttempts,
  };
  if (lastStatus !== undefined) {
    failure.lastStatus = lastStatus;
  }
  if (lastError !== undefined) {
    failure.lastError = lastError;
  }
  return failure;
}
