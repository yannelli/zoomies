import { NextResponse } from 'next/server';

import { buildClearCookieHeader } from '@/lib/session-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', buildClearCookieHeader());
  return response;
}
