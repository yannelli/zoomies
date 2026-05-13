import { NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { buildSessionCookieHeader } from '@/lib/session-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginBody = { token?: unknown };

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'invalid token', code: 'unauthorized' }, { status: 401 });
}

function timingSafeStringEqual(a: string, b: string): boolean {
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

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.ZOOMIES_API_TOKEN;
  if (!expected) {
    return unauthorized();
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return unauthorized();
  }

  const submitted = body?.token;
  if (typeof submitted !== 'string' || submitted.length === 0) {
    return unauthorized();
  }

  if (!timingSafeStringEqual(submitted, expected)) {
    return unauthorized();
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', buildSessionCookieHeader(submitted));
  return response;
}
