import { NextResponse } from 'next/server';
import { validateLaunchConfig } from '@/scripts/launch-config.mjs';
import { databaseReadiness } from '@/lib/server/readiness';
import { APP_VERSION } from '@/lib/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const configuration = validateLaunchConfig(process.env, { production: true }).ok ? 'ok' : 'error';
  const database = await databaseReadiness();
  const checks = { configuration, ...database };
  const ok = Object.values(checks).every((value) => value === 'ok');
  // Detailed deployment diagnostics belong in `npm run doctor`, not a public API.
  return NextResponse.json({ ok, service: 'colony', version: APP_VERSION, checks }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
