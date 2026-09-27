import { addSeasonPoints } from '@/lib/server/season';
import { grantCosmetic } from '@/lib/server/cosmetics';
import { ACHIEVEMENTS, DAILY_QUESTS, REFERRAL_MILESTONES, WEEKLY_QUESTS, type ProgressEvent } from '@/lib/game/progression';
import { recordAllianceDailyEvent } from '@/lib/server/alliance-daily';

export async function ensureProgressionRows(tx: any, userId: string) {
  await tx`
    INSERT INTO player_stats (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO NOTHING
  `;

  for (const q of DAILY_QUESTS) {
    await tx`
      INSERT INTO daily_quests (user_id, quest_key, target, crystal_reward, credit_reward)
      VALUES (${userId}, ${q.key}, ${q.target}, ${q.crystals}, ${q.credits})
      ON CONFLICT (user_id, quest_key, quest_date) DO NOTHING
    `;
  }

  for (const q of WEEKLY_QUESTS) {
    await tx`
      INSERT INTO weekly_quests (user_id, quest_key, target, crystal_reward, credit_reward, week_start)
      VALUES (${userId}, ${q.key}, ${q.target}, ${q.crystals}, ${q.credits}, date_trunc('week', CURRENT_DATE)::date)
      ON CONFLICT (user_id, quest_key, week_start) DO NOTHING
    `;
  }
}

export async function analyticsEvent(tx: any, userId: string, eventName: string, payload: Record<string, unknown> = {}) {
  await tx`
    INSERT INTO analytics_events (user_id, event_name, payload)
    VALUES (${userId}, ${eventName}, ${tx.json(payload)})
  `;
}

async function incrementStat(tx: any, userId: string, event: ProgressEvent, amount: number) {
  if (event === 'build_started') {
    await tx`UPDATE player_stats SET buildings_started=buildings_started+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'foundry_started') {
    await tx`UPDATE player_stats SET foundry_jobs_started=foundry_jobs_started+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'contract_completed') {
    await tx`UPDATE player_stats SET contracts_completed=contracts_completed+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'qualified_referral') {
    await tx`UPDATE player_stats SET qualified_referrals=qualified_referrals+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'market_order_created') {
    await tx`UPDATE player_stats SET market_orders_created=market_orders_created+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'market_trade_bought') {
    await tx`UPDATE player_stats SET market_trades_bought=market_trades_bought+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'market_trade_sold') {
    await tx`UPDATE player_stats SET market_trades_sold=market_trades_sold+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'research_completed') {
    await tx`UPDATE player_stats SET research_completed=research_completed+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'expedition_started') {
    await tx`UPDATE player_stats SET expeditions_started=expeditions_started+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'expedition_completed') {
    await tx`UPDATE player_stats SET expeditions_completed=expeditions_completed+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'artifact_found') {
    await tx`UPDATE player_stats SET artifacts_found=artifacts_found+${amount}, updated_at=now() WHERE user_id=${userId}`;
  } else if (event === 'unique_artifact_found') {
    await tx`UPDATE player_stats SET unique_artifacts_found=unique_artifacts_found+${amount}, updated_at=now() WHERE user_id=${userId}`;
  }
}

async function progressQuests(tx: any, userId: string, event: ProgressEvent, amount: number) {
  for (const q of DAILY_QUESTS.filter((x) => x.event === event)) {
    await tx`
      UPDATE daily_quests
      SET progress=LEAST(target, progress+${amount})
      WHERE user_id=${userId} AND quest_key=${q.key} AND quest_date=CURRENT_DATE AND claimed_at IS NULL
    `;
  }
  for (const q of WEEKLY_QUESTS.filter((x) => x.event === event)) {
    await tx`
      UPDATE weekly_quests
      SET progress=LEAST(target, progress+${amount})
      WHERE user_id=${userId} AND quest_key=${q.key}
        AND week_start=date_trunc('week', CURRENT_DATE)::date AND claimed_at IS NULL
    `;
  }
}

async function unlockAchievements(tx: any, userId: string) {
  const stats = (await tx<any[]>`SELECT * FROM player_stats WHERE user_id=${userId}`)[0];
  if (!stats) return;
  for (const a of ACHIEVEMENTS) {
    if (Number(stats[a.stat]) >= a.target) {
      await tx`
        INSERT INTO user_achievements (user_id, achievement_key)
        VALUES (${userId}, ${a.key})
        ON CONFLICT (user_id, achievement_key) DO NOTHING
      `;
    }
  }
}

async function applyReferralMilestones(tx: any, userId: string) {
  const stats = (await tx<any[]>`SELECT qualified_referrals FROM player_stats WHERE user_id=${userId}`)[0];
  const count = Number(stats?.qualified_referrals ?? 0);
  for (const m of REFERRAL_MILESTONES) {
    if (count < m.target) continue;
    const inserted = await tx<any[]>`
      INSERT INTO referral_rewards (user_id, milestone)
      VALUES (${userId}, ${m.target})
      ON CONFLICT (user_id, milestone) DO NOTHING
      RETURNING milestone
    `;
    if (!inserted.length) continue;
    if ('crystals' in m && m.crystals) {
      await tx`UPDATE game_states SET crystals=crystals+${m.crystals}, updated_at=now() WHERE user_id=${userId}`;
    }
    if ('cosmeticId' in m && m.cosmeticId) {
      await grantCosmetic(tx, userId, m.cosmeticId, `referral_${m.target}`, 'cosmeticDays' in m ? m.cosmeticDays : undefined);
    }
  }
}

export async function recordProgressEvent(
  tx: any,
  userId: string,
  event: ProgressEvent,
  amount = 1,
  payload: Record<string, unknown> = {},
) {
  await ensureProgressionRows(tx, userId);
  await incrementStat(tx, userId, event, amount);
  await progressQuests(tx, userId, event, amount);
  await analyticsEvent(tx, userId, event, { amount, ...payload });
  await addSeasonPoints(tx, userId, event, amount);
  if (event === 'build_started' || event === 'foundry_started' || event === 'contract_completed') {
    await recordAllianceDailyEvent(tx, userId, event, amount);
  }
  await unlockAchievements(tx, userId);
  if (event === 'qualified_referral') await applyReferralMilestones(tx, userId);
}

export async function recordDailySession(tx: any, userId: string) {
  await ensureProgressionRows(tx, userId);
  const rows = await tx<any[]>`
    UPDATE player_stats
    SET sessions=sessions+1, last_session_date=CURRENT_DATE, updated_at=now()
    WHERE user_id=${userId} AND (last_session_date IS NULL OR last_session_date < CURRENT_DATE)
    RETURNING sessions
  `;
  if (!rows.length) return false;
  await progressQuests(tx, userId, 'daily_session', 1);
  await analyticsEvent(tx, userId, 'daily_session');
  await addSeasonPoints(tx, userId, 'daily_session', 1);
  return true;
}
