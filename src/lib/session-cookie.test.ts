import { describe, expect, it } from 'vitest';

import {
  buildClearCookieHeader,
  buildSessionCookieHeader,
  readSessionTokenFromRequest,
  SESSION_COOKIE_NAME,
} from './session-cookie';

describe('buildSessionCookieHeader', () => {
  it('includes the token, HttpOnly, SameSite=Lax, Path=/ and 7-day Max-Age by default', () => {
    const header = buildSessionCookieHeader('abc');
    expect(header).toContain(`${SESSION_COOKIE_NAME}=abc`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=604800');
  });

  it('appends Secure when opts.secure is true', () => {
    const header = buildSessionCookieHeader('abc', { secure: true });
    expect(header).toContain('Secure');
  });

  it('URI-encodes characters that are unsafe in cookie values', () => {
    const header = buildSessionCookieHeader('a b/c');
    expect(header).toContain(`${SESSION_COOKIE_NAME}=a%20b%2Fc`);
  });

  it('omits Secure by default when NODE_ENV is not production', () => {
    const header = buildSessionCookieHeader('abc');
    expect(header).not.toContain('Secure');
  });

  it('honors a custom maxAgeSeconds', () => {
    const header = buildSessionCookieHeader('abc', { maxAgeSeconds: 60 });
    expect(header).toContain('Max-Age=60');
  });
});

describe('buildClearCookieHeader', () => {
  it('expires the cookie immediately', () => {
    const header = buildClearCookieHeader();
    expect(header).toContain('Max-Age=0');
    const expiresMatch = header.match(/Expires=([^;]+)/);
    expect(expiresMatch).not.toBeNull();
    const expiresDate = new Date(expiresMatch![1]!);
    expect(expiresDate.getTime()).toBeLessThan(Date.now());
  });
});

describe('readSessionTokenFromRequest', () => {
  it('returns the session token when present', () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=foo; other=bar` },
    });
    expect(readSessionTokenFromRequest(request)).toBe('foo');
  });

  it('returns null when no cookie header is set', () => {
    const request = new Request('http://localhost/');
    expect(readSessionTokenFromRequest(request)).toBeNull();
  });

  it('returns null when the session cookie is absent', () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: 'other=bar' },
    });
    expect(readSessionTokenFromRequest(request)).toBeNull();
  });

  it('URI-decodes the value', () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=a%20b%2Fc` },
    });
    expect(readSessionTokenFromRequest(request)).toBe('a b/c');
  });
});
