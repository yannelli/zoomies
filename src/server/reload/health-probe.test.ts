import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeHealth } from './health-probe.js';

// `fetch` is stubbed globally and reset per test. The probe uses native
// fetch (Node 22) so this lets us drive every scenario from pure JS without
// pulling in nock/MSW. Helpers build canonical Response-shaped objects
// because the probe only ever reads `.status`.
const fetchMock = vi.fn();

function ok(status: number): { status: number } {
  return { status };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('probeHealth — happy path', () => {
  it('resolves on the first attempt when fetch returns 2xx immediately', async () => {
    // No fake timers needed — there is no backoff sleep on a first-attempt
    // success, so the call resolves on a microtask tick.
    fetchMock.mockResolvedValueOnce(ok(200));

    const result = await probeHealth({ url: 'http://x' });

    expect(result).toEqual({ ok: true, attempts: 1, lastStatus: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://x',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('probeHealth — retry behaviour', () => {
  it('retries on non-acceptable status, with backoff doubling between attempts', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(200));

    const pending = probeHealth({ url: 'http://x' });

    // First attempt fires synchronously, then the probe awaits the 200ms
    // backoff. Drain microtasks first so the await on sleep() is actually
    // pending, then advance time precisely to the expected delay.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second backoff doubles to 400ms.
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result).toEqual({ ok: true, attempts: 3, lastStatus: 200 });
  });

  it('returns ok=false after exhausting maxAttempts on non-2xx responses', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(ok(500));

    const pending = probeHealth({ url: 'http://x' });

    // Drive 5 attempts with 4 inter-attempt backoffs (200, 400, 800, 1600).
    // The probe must NOT sleep after the 5th attempt — total elapsed time
    // covers only the four backoff windows.
    await vi.advanceTimersByTimeAsync(0); // attempt 1
    await vi.advanceTimersByTimeAsync(200); // attempt 2
    await vi.advanceTimersByTimeAsync(400); // attempt 3
    await vi.advanceTimersByTimeAsync(800); // attempt 4
    await vi.advanceTimersByTimeAsync(1600); // attempt 5

    const result = await pending;
    expect(result).toEqual({ ok: false, attempts: 5, lastStatus: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('returns ok=false with lastError when every attempt rejects', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const pending = probeHealth({ url: 'http://x' });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(1600);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(5);
    expect(result.lastError).toBe('ECONNREFUSED');
    // No response was ever observed, so lastStatus must be absent rather
    // than carrying a stale value.
    expect(result.lastStatus).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('probeHealth — per-attempt timeout', () => {
  it('aborts each attempt after timeoutMs and reports a timeout-shaped error', async () => {
    // `AbortSignal.timeout` schedules its abort on an *internal* timer that
    // sinon-fake-timers does not intercept, so this case must run on real
    // timers. We use tiny millisecond values to keep the wall-clock cost
    // negligible (well under typical CI jitter budgets).
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          // Bridge the abort to a rejection so probeHealth sees a thrown
          // error — this mirrors how the real fetch reacts to an aborted
          // signal.
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const result = await probeHealth({
      url: 'http://x',
      maxAttempts: 2,
      timeoutMs: 10,
      baseDelayMs: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeDefined();
    // Should mention timeout or abort so operators can distinguish hung
    // upstreams from connection refusals.
    expect(result.lastError!.toLowerCase()).toMatch(/timeout|abort/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('probeHealth — acceptStatus override', () => {
  it('uses the caller-supplied acceptStatus predicate', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(ok(200)).mockResolvedValueOnce(ok(204));

    const pending = probeHealth({
      url: 'http://x',
      acceptStatus: (s) => s === 204,
    });

    await vi.advanceTimersByTimeAsync(0); // attempt 1 (200, rejected)
    await vi.advanceTimersByTimeAsync(200); // attempt 2 (204, accepted)

    const result = await pending;
    expect(result).toEqual({ ok: true, attempts: 2, lastStatus: 204 });
  });
});

describe('probeHealth — backoff knobs', () => {
  it('honours a custom baseDelayMs for the inter-attempt sleep', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(ok(503)).mockResolvedValueOnce(ok(200));

    const pending = probeHealth({ url: 'http://x', baseDelayMs: 50 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance only 49ms — the second attempt MUST NOT have fired yet.
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One more ms tips us over the 50ms backoff boundary.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const result = await pending;
    expect(result).toEqual({ ok: true, attempts: 2, lastStatus: 200 });
  });

  it('with maxAttempts=1 makes a single fetch call and never sleeps', async () => {
    // Use fake timers so we can assert that no sleep was scheduled — if the
    // probe were buggy and slept after the only attempt, the test would
    // hang waiting on a pending fake timer (and the unawaited promise
    // would be obvious).
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(ok(500));

    const result = await probeHealth({ url: 'http://x', maxAttempts: 1 });

    expect(result).toEqual({ ok: false, attempts: 1, lastStatus: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No backoff sleep should be pending after a maxAttempts=1 run.
    expect(vi.getTimerCount()).toBe(0);
  });
});
