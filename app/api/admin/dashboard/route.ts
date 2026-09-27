import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { assertAdminTelegramId } from '@/lib/server/admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    await ensurePlayer(auth.user, auth.startParam);
    assertAdminTelegramId(auth.user.id);

    const [users, monetization, market, economy, tutorial, suspicious, errors, featureFlags, settings, feedback, beta] = await Promise.all([
      sql<any[]>`SELECT count(*)::int total,count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int new_24h,count(*) FILTER(WHERE last_seen_at>now()-interval '24 hours')::int active_24h,count(*) FILTER(WHERE referral_qualified_at IS NOT NULL)::int qualified_referrals FROM users`,
      sql<any[]>`SELECT count(*)::int purchases_7d,COALESCE(sum(stars_paid),0)::int stars_7d FROM purchases WHERE status='paid' AND paid_at>now()-interval '7 days'`,
      sql<any[]>`SELECT count(*)::int trades_24h,COALESCE(sum(fee_credits),0)::bigint fee_sink_24h FROM market_trades WHERE created_at>now()-interval '24 hours'`,
      sql<any[]>`SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY credits)::bigint median_credits,percentile_cont(0.5) WITHIN GROUP(ORDER BY crystals)::bigint median_crystals,percentile_cont(0.5) WITHIN GROUP(ORDER BY city_score)::bigint median_city_score FROM game_states`,
      sql<any[]>`SELECT tutorial_step,count(*)::int users FROM game_states GROUP BY tutorial_step ORDER BY tutorial_step`,
      sql<any[]>`
        WITH hourly AS (
          SELECT user_id,count(*)::int value,'event_velocity'::text AS signal
          FROM analytics_events WHERE created_at>now()-interval '1 hour'
          GROUP BY user_id HAVING count(*)>120
        ), referrals AS (
          SELECT user_id,count(*)::int value,'referral_velocity'::text AS signal
          FROM analytics_events WHERE event_name='qualified_referral' AND created_at>now()-interval '24 hours'
          GROUP BY user_id HAVING count(*)>15
        ), trades AS (
          SELECT user_id,count(*)::int value,'market_velocity'::text AS signal
          FROM analytics_events WHERE event_name='market_trade_bought' AND created_at>now()-interval '1 hour'
          GROUP BY user_id HAVING count(*)>80
        ), flags AS (
          SELECT * FROM hourly UNION ALL SELECT * FROM referrals UNION ALL SELECT * FROM trades
        )
        SELECT u.telegram_id,u.username,u.first_name,f.signal,f.value
        FROM flags f JOIN users u ON u.id=f.user_id
        ORDER BY f.value DESC LIMIT 30
      `,
      sql<any[]>`SELECT count(*)::int errors_24h,count(*) FILTER(WHERE source='client')::int client_errors_24h FROM error_events WHERE created_at>now()-interval '24 hours'`,
      sql<any[]>`SELECT flag_key,enabled,rollout_percent,description,updated_at FROM feature_flags ORDER BY flag_key`,
      sql<any[]>`SELECT setting_key,value,updated_at FROM system_settings ORDER BY setting_key`,
      sql<any[]>`SELECT f.id,f.category,f.message,f.status,f.created_at,u.telegram_id,u.username,u.first_name,u.colony_name FROM player_feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 30`,
      sql<any[]>`SELECT (SELECT count(*) FROM beta_access)::int access_count,(SELECT count(*) FROM beta_invite_codes WHERE active=true AND (expires_at IS NULL OR expires_at>now()) AND uses<max_uses)::int active_codes`,
    ]);
    const cohort = await sql<any[]>`
      SELECT count(*)::int cohort,
        count(*) FILTER(WHERE last_seen_at>=CURRENT_DATE)::int returned_next_day
      FROM users WHERE created_at>=CURRENT_DATE-interval '1 day' AND created_at<CURRENT_DATE
    `;
    return NextResponse.json({ ok: true, users: users[0], monetization: monetization[0], market: market[0], economy: economy[0], tutorial, suspicious, errors: errors[0], featureFlags, systemSettings:settings, feedback, beta:beta[0], d1: cohort[0] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
