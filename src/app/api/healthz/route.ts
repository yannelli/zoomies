import { NextResponse } from 'next/server';

import { VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    version: VERSION,
    uptime: Math.floor(process.uptime()),
  });
}
