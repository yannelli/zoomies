import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireToken, UnauthorizedError } from './require-token.js';

const TOKEN = 'correct-token';

beforeEach(() => {
  vi.stubEnv('ZOOMIES_API_TOKEN', TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireToken — success', () => {
  it('accepts a matching Bearer token via a Headers instance', () => {
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });

    expect(() => requireToken(headers)).not.toThrow();
  });

  it('accepts a case-insensitive `bearer` scheme', () => {
    const headers = new Headers({ authorization: `bearer ${TOKEN}` });

    expect(() => requireToken(headers)).not.toThrow();
  });

  it('accepts a plain header bag (Node IncomingHttpHeaders shape)', () => {
    const headers: Record<string, string | string[] | undefined> = {
      authorization: `Bearer ${TOKEN}`,
    };

    expect(() => requireToken(headers)).not.toThrow();
  });

  it('honors `opts.expectedToken` and ignores the env var when provided', () => {
    vi.stubEnv('ZOOMIES_API_TOKEN', 'env-token-that-should-be-ignored');

    const headers = new Headers({ authorization: 'Bearer override-token' });

    expect(() => requireToken(headers, { expectedToken: 'override-token' })).not.toThrow();
  });

  it('finds the header regardless of casing in a plain header bag', () => {
    const headers: Record<string, string | string[] | undefined> = {
      Authorization: `Bearer ${TOKEN}`,
    };

    expect(() => requireToken(headers)).not.toThrow();
  });
});

describe('requireToken — failure modes', () => {
  it('throws UnauthorizedError when the Authorization header is missing', () => {
    const headers = new Headers();

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
    expect(() => requireToken(headers)).toThrow(/missing authorization header/i);
  });

  it('throws UnauthorizedError when the scheme is not Bearer', () => {
    const headers = new Headers({ authorization: `Token ${TOKEN}` });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
    expect(() => requireToken(headers)).toThrow(/malformed/i);
  });

  it('throws UnauthorizedError for Basic auth', () => {
    const headers = new Headers({ authorization: 'Basic dXNlcjpwYXNz' });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
  });

  it('throws UnauthorizedError when the header is just "Bearer"', () => {
    const headers = new Headers({ authorization: 'Bearer' });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
  });

  it('throws UnauthorizedError when the credential is missing after Bearer', () => {
    const headers = new Headers({ authorization: 'Bearer ' });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
  });

  it('throws UnauthorizedError when the header has extra whitespace ("Bearer  ")', () => {
    const headers = new Headers({ authorization: 'Bearer  ' });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
  });

  it('throws UnauthorizedError on a token mismatch', () => {
    const headers = new Headers({ authorization: 'Bearer wrong-token' });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
    expect(() => requireToken(headers)).toThrow(/invalid token/i);
  });

  it('throws UnauthorizedError when ZOOMIES_API_TOKEN is unset', () => {
    vi.stubEnv('ZOOMIES_API_TOKEN', '');

    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });

    expect(() => requireToken(headers)).toThrowError(UnauthorizedError);
    expect(() => requireToken(headers)).toThrow(/api token not configured/i);
  });

  it('does not crash when expected and provided tokens have different lengths', () => {
    const headers = new Headers({ authorization: 'Bearer abcdefg' });

    // Constant-time compare must tolerate a length mismatch without throwing
    // (the underlying `timingSafeEqual` requires equal-length buffers).
    expect(() => requireToken(headers, { expectedToken: 'abc' })).toThrowError(UnauthorizedError);
    expect(() => requireToken(headers, { expectedToken: 'abc' })).toThrow(/invalid token/i);
  });
});
