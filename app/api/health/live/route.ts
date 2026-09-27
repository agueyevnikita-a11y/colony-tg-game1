import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, service: 'colony', version: APP_VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
