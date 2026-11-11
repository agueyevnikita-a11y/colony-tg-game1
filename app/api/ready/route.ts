import { NextResponse } from 'next/server';
import { validateLaunchConfig } from '@/scripts/launch-config.mjs';
import { databaseReadiness } from '@/lib/server/readiness';
import { APP_VERSION } from '@/lib/version';
import { listAccountCases, PRIVACY_CAPABILITY } from '@/scripts/privacy/lib/case-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const configuration = validateLaunchConfig(process.env, { production: true }).ok ? 'ok' : 'error';
  const database = await databaseReadiness();
  const checks = { configuration, ...database };
  let privacyStorage='ok';
  try { await listAccountCases(); } catch { privacyStorage='error'; }
  const ok = Object.values(checks).every((value) => value === 'ok') && privacyStorage==='ok';
  // Detailed deployment diagnostics belong in `npm run doctor`, not a public API.
  return NextResponse.json({ ok, service: 'colony', version: APP_VERSION, checks, privacyStorage, privacyCapability:PRIVACY_CAPABILITY }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
