import { sql } from './db';
import { BUILDINGS, HQ_UPGRADES, cityGridSize, type BuildingType } from '@/lib/game/config';
import { ACHIEVEMENTS, DAILY_QUESTS, WEEKLY_QUESTS } from '@/lib/game/progression';
import { buildTimeSec, calculatePassiveGain, passiveRate, storageCaps, upgradeCost } from '@/lib/game/economy';
import { ensureProgressionRows, recordProgressEvent } from '@/lib/server/progression';
import { getMarketState, reconcileExpiredMarketOrders } from '@/lib/server/market';
import { getSeasonState } from '@/lib/server/season';
import { getAllianceState } from '@/lib/server/alliance';
import { cityScore } from '@/lib/game/city-score';
import { DECOR_CATALOG } from '@/lib/game/decor';
import { completedResearchKeys, getResearchState, reconcileResearch } from '@/lib/server/research';
import { getExpeditionState, reconcileExpeditions } from '@/lib/server/expeditions';
import { offlineCapHours, productionMultipliers, sciencePerHour } from '@/lib/game/research';
import { getTutorialStateFromRows } from '@/lib/server/tutorial';
import { getNotificationPreferences } from '@/lib/server/notifications';
import { ensureDailyLogin, getDailyLoginState } from '@/lib/server/daily-login';
import { ensureWelcomeInbox, getInbox } from '@/lib/server/inbox';
import { getFeatureFlags } from '@/lib/server/feature-flags';
import { assertRateLimitTx } from '@/lib/server/rate-limit';
import { getAccessState } from '@/lib/server/access';
import { accrueIncome } from '@/lib/server/passive-income';

export async function ensurePlayer(tg: {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}, startParam?: string, options: { skipAccessGate?: boolean } = {}) {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; created_at: Date }[]>`
      INSERT INTO users (telegram_id, username, first_name, language_code)
      VALUES (${tg.id}, ${tg.username ?? null}, ${tg.first_name ?? ''}, ${tg.language_code ?? null})
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        language_code = EXCLUDED.language_code,
        last_seen_at = now()
      RETURNING id, created_at
    `;
    const user = rows[0];
    if (!user) throw new Error('Could not create player');

    // Global per-player protection for all authenticated game API calls.
    await assertRateLimitTx(tx, `global:${user.id}`, 120, 60);

    if (!options.skipAccessGate) {
      const access = await getAccessState(tx, user.id, Number(tg.id));
      if (!access.allowed) {
        if (access.blockReason === 'maintenance') throw new Error(access.maintenance.message);
        if (access.blockReason === 'beta_required') throw new Error('Нужен доступ к закрытой бете');
        throw new Error('Доступ временно ограничен');
      }
    }

    await tx`
      INSERT INTO game_states (user_id) VALUES (${user.id})
      ON CONFLICT (user_id) DO NOTHING
    `;
    await ensureProgressionRows(tx, user.id);

    const existingBuildings = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM buildings WHERE user_id = ${user.id}
    `;
    if (Number(existingBuildings[0]?.count ?? 0) === 0) {
      await tx`
        INSERT INTO buildings (user_id, type, level, x, y, status)
        VALUES
          (${user.id}, 'hq', 1, 2, 2, 'active'),
          (${user.id}, 'mine', 1, 0, 2, 'active'),
          (${user.id}, 'solar', 1, 4, 2, 'active'),
          (${user.id}, 'warehouse', 1, 2, 4, 'active')
      `;
    }

    if (startParam?.startsWith('ref_')) {
      const refTelegramId = Number(startParam.slice(4));
      if (Number.isFinite(refTelegramId) && refTelegramId !== tg.id) {
        await tx`
          UPDATE users target
          SET referred_by = ref.id
          FROM users ref
          WHERE target.id = ${user.id}
            AND target.referred_by IS NULL
            AND ref.telegram_id = ${refTelegramId}
            AND target.created_at > now() - interval '15 minutes'
        `;
      }
    }
    return user.id;
  });
}

async function ensureNpcContracts(tx: any, userId: string, hqLevel: number, buildings: any[]) {
  const hasTradeHub = buildings.some((b) => b.type === 'trade_hub' && b.status === 'active');
  if (!hasTradeHub) return [];

  const active = await tx<any[]>`
    SELECT * FROM npc_contracts
    WHERE user_id=${userId} AND completed_at IS NULL AND expires_at > now()
    ORDER BY expires_at ASC
  `;
  const recentBatch = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM npc_contracts
    WHERE user_id=${userId} AND created_at > now()-interval '6 hours'
  `;

  // Не выдаём бесконечные контракты после каждого выполнения: максимум 3 новых за 6 часов.
  const missing = Math.max(0, 3 - Number(recentBatch[0]?.count ?? 0));
  for (let i = 0; i < missing; i++) {
    const partsContract = (Number(recentBatch[0]?.count ?? 0) + i) % 3 === 2;
    if (partsContract) {
      const amount = 35 + hqLevel * 15 + Math.floor(Math.random() * 20);
      const reward = Math.round(amount * (18 + hqLevel * 1.5));
      await tx`
        INSERT INTO npc_contracts (user_id, resource, amount, credit_reward, expires_at)
        VALUES (${userId}, 'parts', ${amount}, ${reward}, now()+interval '6 hours')
      `;
    } else {
      const amount = 220 + hqLevel * 80 + Math.floor(Math.random() * 100);
      const reward = Math.round(amount * (2.7 + hqLevel * 0.12));
      await tx`
        INSERT INTO npc_contracts (user_id, resource, amount, credit_reward, expires_at)
        VALUES (${userId}, 'ore', ${amount}, ${reward}, now()+interval '6 hours')
      `;
    }
  }

  return tx<any[]>`
    SELECT * FROM npc_contracts
    WHERE user_id=${userId} AND completed_at IS NULL AND expires_at > now()
    ORDER BY expires_at ASC
  `;
}

async function qualifyReferralIfNeeded(tx: any, userId: string, hqLevel: number) {
  if (hqLevel < 3) return;
  const rows = await tx<any[]>`
    UPDATE users
    SET referral_qualified_at=now()
    WHERE id=${userId} AND referred_by IS NOT NULL AND referral_qualified_at IS NULL
    RETURNING referred_by
  `;
  const inviterId = rows[0]?.referred_by as string | undefined;
  if (inviterId) {
    await recordProgressEvent(tx, inviterId, 'qualified_referral', 1, { referral_user_id: userId });
  }
}

export async function reconcilePlayer(userId: string) {
  return sql.begin(async (tx) => {
    await ensureProgressionRows(tx, userId);
    await ensureDailyLogin(tx, userId);
    await ensureWelcomeInbox(tx, userId);
    await reconcileExpiredMarketOrders(tx, userId);
    await reconcileResearch(tx, userId);
    await reconcileExpeditions(tx, userId);

    await tx`
      UPDATE buildings
      SET level = COALESCE(target_level, level), status = 'active', target_level = NULL,
          completes_at = NULL, updated_at = now()
      WHERE user_id = ${userId}
        AND status IN ('building','upgrading')
        AND completes_at <= now()
    `;

    const stateRows = await tx<any[]>`
      SELECT * FROM game_states WHERE user_id = ${userId} FOR UPDATE
    `;
    const state = stateRows[0];
    if (!state) throw new Error('Missing game state');

    const buildings = await tx<any[]>`
      SELECT * FROM buildings WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    const premium = !!state.premium_until && new Date(state.premium_until) > new Date();
    const elapsedHours = (Date.now() - new Date(state.last_tick_at).getTime()) / 3_600_000;
    const researchKeys = await completedResearchKeys(tx, userId);
    const researchEffects = productionMultipliers(researchKeys);
    const capHours = offlineCapHours(premium, researchKeys);
    const gain = calculatePassiveGain({
      buildings: buildings.map((b) => ({ type: b.type as BuildingType, level: b.level, status: b.status })),
      hoursElapsed: elapsedHours,
      premium,
      offlineCapBonusHours: researchKeys.has('archive_network') ? 2 : 0,
      resourceMultipliers: { ore: researchEffects.ore, energy: researchEffects.energy },
    });
    const labLevels = buildings.filter((b) => b.type === 'research_lab' && b.status === 'active').map((b) => Number(b.level));
    const scienceRate = sciencePerHour(labLevels, researchKeys);
    const scienceGain = scienceRate * Math.max(0, Math.min(elapsedHours, capHours));
    const whLevels = buildings.filter((b) => b.type === 'warehouse' && b.status === 'active').map((b) => b.level);
    const baseCaps = storageCaps(whLevels);
    const caps = {
      ore: Math.floor(baseCaps.ore * researchEffects.storage),
      energy: Math.floor(baseCaps.energy * researchEffects.storage),
      parts: Math.floor(baseCaps.parts * researchEffects.storage),
    };
    const escrowRows = await tx<any[]>`
      SELECT resource, COALESCE(sum(amount_remaining),0)::bigint AS amount
      FROM market_orders
      WHERE user_id=${userId} AND status='open' AND expires_at > now()
      GROUP BY resource
    `;
    const escrow = { ore: 0, energy: 0, parts: 0 };
    for (const row of escrowRows) {
      const resource = String(row.resource);
      if (resource === 'ore' || resource === 'energy' || resource === 'parts') escrow[resource] = Number(row.amount);
    }
    const liquidCaps = {
      ore: Math.max(0, caps.ore - escrow.ore),
      energy: Math.max(0, caps.energy - escrow.energy),
      parts: Math.max(0, caps.parts - escrow.parts),
    };
    const finishedJobs = await tx<any[]>`
      SELECT * FROM foundry_jobs
      WHERE user_id=${userId} AND claimed_at IS NULL AND completes_at <= now()
      FOR UPDATE
    `;
    const partsFromJobs = finishedJobs.reduce((sum, j) => sum + Number(j.parts_reward), 0);
    if (finishedJobs.length) {
      await tx`UPDATE foundry_jobs SET claimed_at=now() WHERE id = ANY(${tx.array(finishedJobs.map((j) => j.id))}::uuid[])`;
    }

    const carry = state.passive_carry ?? {};
    const oreIncome = accrueIncome({ current: Number(state.ore), gain: gain.ore, carry: Number(carry.ore ?? 0), capacity: liquidCaps.ore });
    const energyIncome = accrueIncome({ current: Number(state.energy), gain: gain.energy, carry: Number(carry.energy ?? 0), capacity: liquidCaps.energy });
    const creditIncome = accrueIncome({ current: Number(state.credits), gain: gain.credits, carry: Number(carry.credits ?? 0) });
    const scienceIncome = accrueIncome({ current: Number(state.science ?? 0), gain: scienceGain, carry: Number(carry.science ?? 0) });
    const ore = oreIncome.amount;
    const energy = energyIncome.amount;
    const parts = Math.min(Number(state.parts) + partsFromJobs, liquidCaps.parts);
    const credits = creditIncome.amount;
    const science = scienceIncome.amount;
    const hq = buildings.find((b) => b.type === 'hq');
    const hqLevel = Number(hq?.level ?? state.hq_level);
    const score = cityScore(buildings.map((b) => ({ type: b.type, level: Number(b.level), status: b.status })), hqLevel);

    await tx`
      UPDATE game_states SET
        hq_level=${hqLevel}, city_score=${score}, ore=${ore}, energy=${energy}, parts=${parts}, credits=${credits}, science=${science},
        passive_carry=${tx.json({ ore: oreIncome.carry, energy: energyIncome.carry, credits: creditIncome.carry, science: scienceIncome.carry })},
        last_tick_at=now(), updated_at=now()
      WHERE user_id=${userId}
    `;

    await qualifyReferralIfNeeded(tx, userId, hqLevel);

    const activeJobs = await tx<any[]>`
      SELECT * FROM foundry_jobs WHERE user_id=${userId} AND claimed_at IS NULL ORDER BY completes_at ASC
    `;
    const contracts = await ensureNpcContracts(tx, userId, hqLevel, buildings);
    const dailyQuests = await tx<any[]>`
      SELECT * FROM daily_quests WHERE user_id=${userId} AND quest_date=CURRENT_DATE ORDER BY quest_key
    `;
    const weeklyQuests = await tx<any[]>`
      SELECT * FROM weekly_quests
      WHERE user_id=${userId} AND week_start=date_trunc('week', CURRENT_DATE)::date
      ORDER BY quest_key
    `;
    const achievements = await tx<any[]>`
      SELECT * FROM user_achievements WHERE user_id=${userId} ORDER BY unlocked_at DESC
    `;
    const stats = (await tx<any[]>`SELECT * FROM player_stats WHERE user_id=${userId}`)[0];
    const cosmetics = await tx<any[]>`
      SELECT uc.cosmetic_id, uc.source, uc.expires_at, uc.equipped, uc.acquired_at,
             c.name, c.category, c.star_price, c.metadata
      FROM user_cosmetics uc
      JOIN cosmetics c ON c.id=uc.cosmetic_id
      WHERE uc.user_id=${userId} AND (uc.expires_at IS NULL OR uc.expires_at > now())
      ORDER BY uc.acquired_at DESC
    `;
    const shopCosmetics = await tx<any[]>`
      SELECT id, name, category, star_price, achievement_key, temporary_days, metadata
      FROM cosmetics ORDER BY category, name
    `;
    const referrals = await tx<any[]>`
      SELECT u.telegram_id, u.first_name, u.username, u.colony_name, u.referral_qualified_at,
             COALESCE(gs.hq_level,1) AS hq_level, u.created_at
      FROM users u LEFT JOIN game_states gs ON gs.user_id=u.id
      WHERE u.referred_by=${userId}
      ORDER BY u.created_at DESC LIMIT 100
    `;
    const decor = await tx<any[]>`SELECT * FROM city_decor WHERE user_id=${userId} ORDER BY created_at ASC`;
    const market = await getMarketState(tx, userId);
    const season = await getSeasonState(tx, userId);
    const alliance = await getAllianceState(tx, userId);
    const research = await getResearchState(tx, userId, hqLevel, buildings);
    const expeditions = await getExpeditionState(tx, userId, hqLevel, buildings);

    const enrichedBuildings = buildings.map((b) => {
      const type = b.type as BuildingType;
      const cfg = BUILDINGS[type];
      const currentLevel = Number(b.level);
      const nextLevel = currentLevel + 1;
      const nextCost = type === 'hq' ? HQ_UPGRADES[nextLevel]?.cost ?? null : (cfg && nextLevel <= cfg.maxLevel ? upgradeCost(type, currentLevel) : null);
      const nextTimeSec = nextCost
        ? (type === 'hq' ? HQ_UPGRADES[nextLevel]?.timeSec ?? null : buildTimeSec(type, nextLevel, premium))
        : null;
      return {
        ...b,
        production: cfg?.passive ? (()=>{const rate=passiveRate(type,Math.max(1,currentLevel));if(!rate)return null;const mult=rate.resource==='ore'?researchEffects.ore:rate.resource==='energy'?researchEffects.energy:1;return {...rate,perHour:Math.floor(rate.perHour*mult)};})() : null,
        nextUpgrade: nextCost ? { level: nextLevel, cost: nextCost, timeSec: nextTimeSec } : null,
      };
    });

    const refreshedState = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId}`)[0];
    const freshState = { ...refreshedState, premium };
    const tutorial = getTutorialStateFromRows(freshState, buildings, stats);
    const notifications = await getNotificationPreferences(tx, userId);
    const dailyLogin = await getDailyLoginState(tx, userId);
    const inbox = await getInbox(tx, userId);
    const flags = await getFeatureFlags(tx, userId);
    const profile = (await tx<any[]>`SELECT colony_name,profile_bio,profile_completed_at FROM users WHERE id=${userId}`)[0];
    await tx`
      INSERT INTO economy_daily_snapshots
        (user_id,snapshot_date,hq_level,buildings_count,ore,energy,parts,credits,crystals,science,open_market_orders)
      VALUES (${userId},CURRENT_DATE,${hqLevel},${buildings.length},${Number(freshState.ore)},${Number(freshState.energy)},${Number(freshState.parts)},${Number(freshState.credits)},${Number(freshState.crystals)},${Number(freshState.science ?? 0)},${market.ownOrders.filter((o:any)=>o.status==='open').length})
      ON CONFLICT(user_id,snapshot_date) DO UPDATE SET hq_level=EXCLUDED.hq_level,buildings_count=EXCLUDED.buildings_count,ore=EXCLUDED.ore,energy=EXCLUDED.energy,parts=EXCLUDED.parts,credits=EXCLUDED.credits,crystals=EXCLUDED.crystals,science=EXCLUDED.science,open_market_orders=EXCLUDED.open_market_orders,updated_at=now()
    `;
    return {
      state: freshState,
      gridSize: cityGridSize(hqLevel),
      buildings: enrichedBuildings,
      decor,
      decorCatalog: Object.entries(DECOR_CATALOG).map(([type, cfg]) => ({ type, ...cfg })),
      activeJobs,
      caps,
      escrow,
      contracts,
      dailyQuests,
      weeklyQuests,
      achievements,
      achievementCatalog: ACHIEVEMENTS,
      dailyQuestCatalog: DAILY_QUESTS,
      weeklyQuestCatalog: WEEKLY_QUESTS,
      stats,
      cosmetics,
      shopCosmetics,
      referrals,
      market,
      season,
      alliance,
      research,
      expeditions,
      scienceRate,
      tutorial,
      notifications,
      dailyLogin,
      inbox,
      flags,
      profile,
      offlineCapHours: capHours,
      catalog: Object.entries(BUILDINGS).map(([type, cfg]) => ({ type, ...cfg })),
    };
  });
}
