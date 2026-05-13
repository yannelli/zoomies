export const SESSION_COOKIE_NAME = 'zoomies_session';

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type BuildSessionCookieOptions = {
  secure?: boolean;
  maxAgeSeconds?: number;
};

export function buildSessionCookieHeader(token: string, opts?: BuildSessionCookieOptions): string {
  const secure = opts?.secure ?? process.env.NODE_ENV === 'production';
  const maxAge = opts?.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const encoded = encodeURIComponent(token);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encoded}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

export function buildClearCookieHeader(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

export function readSessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
