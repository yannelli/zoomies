import { NextResponse } from 'next/server';

import { bootstrapConfig } from '@/lib/bootstrap-config';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(bootstrapConfig);
}
