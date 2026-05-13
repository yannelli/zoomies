import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE_NAME } from './session-cookie';

export async function requireSession(redirectTo = '/login'): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const expected = process.env.ZOOMIES_API_TOKEN;
  if (!token || !expected) {
    redirect(redirectTo);
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const max = Math.max(a.length, b.length);
  const aPad = Buffer.alloc(max);
  const bPad = Buffer.alloc(max);
  a.copy(aPad);
  b.copy(bPad);
  if (a.length !== b.length || !timingSafeEqual(aPad, bPad)) {
    redirect(redirectTo);
  }
}
