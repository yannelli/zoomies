/**
 * Bearer-token guard for Route Handlers and CLI-facing entry points.
 *
 * This is intentionally NOT a Next.js `middleware.ts` export — Next.js
 * middleware runs in the Edge runtime, which doesn't expose Node's `crypto`
 * primitives we need for a constant-time token comparison. Route Handlers
 * call this helper directly in the Node runtime.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

export class UnauthorizedError extends Error {
  readonly code = 'unauthorized';

  constructor(message: string = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface RequireTokenOptions {
  /** Override env var for testing. */
  expectedToken?: string;
}

/**
 * Duck-typed check for a Web `Headers`-like value. We accept either a real
 * `Headers` instance (Route Handlers) or a plain header bag (unit tests, CLI
 * callers) so the same helper covers both surfaces.
 */
function isHeadersLike(value: unknown): value is Headers {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { get?: unknown }).get === 'function'
  );
}

/**
 * Look up the `Authorization` header from either input shape. Plain bags may
 * use any casing and may store arrays (Node's `IncomingHttpHeaders` does for
 * a few headers); take the first array entry if so.
 */
function readAuthorizationHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
): string | null {
  if (isHeadersLike(headers)) {
    return headers.get('authorization');
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'authorization') {
      continue;
    }
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  }
  return null;
}

/**
 * Constant-time string compare. `timingSafeEqual` requires equal-length
 * buffers, so we pad the shorter side to the longer side's length before
 * comparing and then check lengths separately. The pad is on a constant-
 * length pair so the equality check itself doesn't reveal which side was
 * shorter via timing.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const len = Math.max(aBuf.length, bBuf.length, 1);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  const equal = timingSafeEqual(aPadded, bPadded);
  return equal && aBuf.length === bBuf.length;
}

/**
 * Reads the bearer token from the Authorization header and compares it to
 * `ZOOMIES_API_TOKEN` (or `opts.expectedToken`) using a constant-time
 * comparison. Throws {@link UnauthorizedError} on any failure, returns void
 * on success.
 */
export function requireToken(
  headers: Headers | Record<string, string | string[] | undefined>,
  opts?: RequireTokenOptions,
): void {
  // Re-read at each call: tests stub `process.env.ZOOMIES_API_TOKEN` via
  // `vi.stubEnv`, and the value can also legitimately change at runtime if
  // operators rotate the token.
  const expected = opts?.expectedToken ?? process.env.ZOOMIES_API_TOKEN;
  if (expected === undefined || expected === '') {
    throw new UnauthorizedError('api token not configured');
  }

  const raw = readAuthorizationHeader(headers);
  if (raw === null || raw === '') {
    throw new UnauthorizedError('missing authorization header');
  }

  // Split into exactly two non-empty tokens: scheme + credential. Anything
  // else (e.g. `Bearer` alone, `Bearer  token`, `Bearer a b`) is malformed.
  const parts = raw.split(' ');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new UnauthorizedError('malformed authorization header');
  }

  const [scheme, credential] = parts as [string, string];
  if (scheme.toLowerCase() !== 'bearer') {
    throw new UnauthorizedError('malformed authorization header');
  }

  if (!constantTimeEquals(credential, expected)) {
    throw new UnauthorizedError('invalid token');
  }
}
