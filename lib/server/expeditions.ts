import crypto from 'node:crypto';
import { sql, type Transaction } from './db';
import { ARTIFACTS, EXPEDITION_EVENTS, EXPEDITIONS, expeditionByKey, expeditionSlots } from '@/lib/game/expeditions';
import { productionMultipliers } from '@/lib/game/research';
import { storageCaps } from '@/lib/game/economy';
import { analyticsEvent, recordProgressEvent } from './progression';
import { completedResearchKeys } from './research';
import { enqueueNotification } from './notifications';

function chance(probability: number) {
  return crypto.randomInt(0, 1_000_000) < Math.floor(probability * 1_000_000);
}

function between(range?: [number, number]) {
  if (!range) return 0;
  return crypto.randomInt(range[0], range[1] + 1);
}

function choose<T>(items: readonly T[]) {
  return items[crypto.randomInt(0, items.length)];
}

function chooseArtifact(expeditionKey: string) {
  const roll = crypto.randomInt(0, 1000);
  if (expeditionKey === 'deep_signal') {
    if (roll < 80) return 'quantum_lens';
    if (roll < 330) return 'stellar_map';
    if (roll < 650) return 'alloy_core';
    return 'signal_fragment';
  }
  if (expeditionKey === 'orbital_ruins') {
    if (roll < 80) return 'stellar_map';
    if (roll < 380) return 'alloy_core';
    return 'signal_fragment';
  }
  return roll < 180 ? 'alloy_core' : 'signal_fragment';
}

export async function reconcileExpeditions(tx: Transaction, userId: string) {
  await tx`
    UPDATE expeditions
    SET status=CASE WHEN event_key IS NULL THEN 'ready' ELSE 'event' END, updated_at=now()
    WHERE user_id=${userId} AND status='active' AND completes_at <= now()
  `;
}

async function inventoryCapacity(tx: Transaction, userId: string, completed: Set<string>) {
  const buildings = await tx<any[]>`SELECT type,level,status FROM buildings WHERE user_id=${userId}`;
  const warehouseLevels = buildings.filter((b) => b.type === 'warehouse' && b.status === 'active').map((b) => Number(b.level));
  const baseCaps = storageCaps(warehouseLevels);
  const mult = productionMultipliers(completed).storage;
  const caps = {
    ore: Math.floor(baseCaps.ore * mult),
    energy: Math.floor(baseCaps.energy * mult),
    parts: Math.floor(baseCaps.parts * mult),
  };
  const escrowRows = await tx<any[]>`
    SELECT resource,COALESCE(sum(amount_remaining),0)::bigint AS amount FROM market_orders
    WHERE user_id=${userId} AND status='open' AND expires_at>now() GROUP BY resource
  `;
  const escrow: Record<string, number> = { ore: 0, energy: 0, parts: 0 };
  for (const row of escrowRows) escrow[String(row.resource)] = Number(row.amount ?? 0);
  return {
    ore: Math.max(0, caps.ore - (escrow.ore ?? 0)),
    energy: Math.max(0, caps.energy - (escrow.energy ?? 0)),
    parts: Math.max(0, caps.parts - (escrow.parts ?? 0)),
  };
}

async function grantArtifact(tx: Transaction, userId: string, artifactId: string) {
  const exists = ARTIFACTS.some((x) => x.id === artifactId);
  if (!exists) return;
  const inserted = await tx<any[]>`
    INSERT INTO user_artifacts(user_id,artifact_id,count,first_found_at,last_found_at)
    VALUES(${userId},${artifactId},1,now(),now())
    ON CONFLICT(user_id,artifact_id) DO NOTHING
    RETURNING artifact_id
  `;
  if (!inserted.length) {
    await tx`UPDATE user_artifacts SET count=count+1,last_found_at=now() WHERE user_id=${userId} AND artifact_id=${artifactId}`;
  }
  await recordProgressEvent(tx, userId, 'artifact_found', 1, { artifact_id: artifactId });
  if (inserted.length) await recordProgressEvent(tx, userId, 'unique_artifact_found', 1, { artifact_id: artifactId });
}

async function applyReward(tx: Transaction, userId: string, reward: any, artifactId?: string | null) {
  const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
  if (!state) throw new Error('Игровой профиль не найден');
  const completed = await completedResearchKeys(tx, userId);
  const cap = await inventoryCapacity(tx, userId, completed);
  const oreWanted = Math.max(0, Number(reward.ore ?? 0));
  const partsWanted = Math.max(0, Number(reward.parts ?? 0));
  const oreAdded = Math.max(0, Math.min(oreWanted, cap.ore - Number(state.ore)));
  const partsAdded = Math.max(0, Math.min(partsWanted, cap.parts - Number(state.parts)));
  const credits = Math.max(0, Number(reward.credits ?? 0));
  const science = Math.max(0, Number(reward.science ?? 0));
  const crystals = Math.max(0, Number(reward.crystals ?? 0));
  await tx`
    UPDATE game_states SET ore=ore+${oreAdded},parts=parts+${partsAdded},credits=credits+${credits},
      science=science+${science},crystals=crystals+${crystals},updated_at=now()
    WHERE user_id=${userId}
  `;
  if (artifactId) await grantArtifact(tx, userId, artifactId);
  return {
    ore: oreAdded, parts: partsAdded, credits, science, crystals,
    overflowOre: Math.max(0, oreWanted - oreAdded), overflowParts: Math.max(0, partsWanted - partsAdded), artifactId: artifactId ?? null,
  };
}

export async function getExpeditionState(tx: Transaction, userId: string, hqLevel: number, buildings: any[]) {
  await reconcileExpeditions(tx, userId);
  const completed = await completedResearchKeys(tx, userId);
  const center = buildings.filter((b) => b.type === 'expedition_center' && b.status === 'active').sort((a,b)=>Number(b.level)-Number(a.level))[0] ?? null;
  const slots = expeditionSlots(Number(center?.level ?? 0), completed);
  const runs = await tx<any[]>`
    SELECT * FROM expeditions WHERE user_id=${userId} AND status <> 'claimed'
    ORDER BY started_at DESC LIMIT 12
  `;
  const recent = await tx<any[]>`
    SELECT id,expedition_key,status,started_at,completed_at,reward_claimed,event_key,event_choice
    FROM expeditions WHERE user_id=${userId} AND status='claimed'
    ORDER BY completed_at DESC NULLS LAST LIMIT 8
  `;
  const artifacts = await tx<any[]>`
    SELECT a.id,a.name,a.emoji,a.rarity,a.description,COALESCE(ua.count,0)::int AS count,ua.first_found_at,ua.last_found_at
    FROM artifacts a LEFT JOIN user_artifacts ua ON ua.artifact_id=a.id AND ua.user_id=${userId}
    ORDER BY CASE a.rarity WHEN 'common' THEN 1 WHEN 'uncommon' THEN 2 WHEN 'rare' THEN 3 ELSE 4 END,a.name
  `;
  const catalog = EXPEDITIONS.map((cfg) => ({
    ...cfg,
    unlocked: !!center && hqLevel >= cfg.unlockHq && (!cfg.requiredResearch || completed.has(cfg.requiredResearch)),
    lockReason: !center ? 'Нужен центр экспедиций' : hqLevel < cfg.unlockHq ? `Нужен HQ${cfg.unlockHq}` : cfg.requiredResearch && !completed.has(cfg.requiredResearch) ? 'Нужно исследование' : null,
  }));
  return {
    enabled: !!center,
    centerLevel: Number(center?.level ?? 0),
    slots,
    activeCount: runs.filter((x) => x.status !== 'claimed').length,
    runs: runs.map((run: any) => {
      const { reward_json: _reward, artifact_id: _artifact, event_key: eventKey, ...safe } = run;
      return {
        ...safe,
        config: expeditionByKey(run.expedition_key),
        event: run.status === 'event' && eventKey ? (EXPEDITION_EVENTS as any)[eventKey] ?? null : null,
      };
    }),
    recent,
    catalog,
    artifacts,
    artifactCatalog: ARTIFACTS,
  };
}

export async function startExpedition(userId: string, expeditionKey: string) {
  const cfg = expeditionByKey(expeditionKey);
  if (!cfg) throw new Error('Экспедиция не найдена');
  return sql.begin(async (tx) => {
    await reconcileExpeditions(tx, userId);
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const center = (await tx<any[]>`
      SELECT * FROM buildings WHERE user_id=${userId} AND type='expedition_center' AND status='active'
      ORDER BY level DESC LIMIT 1
    `)[0];
    if (!center) throw new Error('Сначала построй центр экспедиций');
    if (Number(state.hq_level) < cfg.unlockHq) throw new Error(`Требуется HQ${cfg.unlockHq}`);
    const completed = await completedResearchKeys(tx, userId);
    if (cfg.requiredResearch && !completed.has(cfg.requiredResearch)) throw new Error('Сначала заверши необходимое исследование');
    const slots = expeditionSlots(Number(center.level), completed);
    const active = Number((await tx<any[]>`SELECT count(*)::int AS count FROM expeditions WHERE user_id=${userId} AND status <> 'claimed'`)[0]?.count ?? 0);
    if (active >= slots) throw new Error('Все слоты экспедиций заняты');
    const energyCost = Number(cfg.cost.energy ?? 0);
    const partsCost = Number(cfg.cost.parts ?? 0);
    const creditsCost = Number(cfg.cost.credits ?? 0);
    if (Number(state.energy) < energyCost) throw new Error('Недостаточно энергии');
    if (Number(state.parts) < partsCost) throw new Error('Недостаточно деталей');
    if (Number(state.credits) < creditsCost) throw new Error('Недостаточно кредитов');

    const effects = productionMultipliers(completed);
    const reward: any = {
      ore: between(cfg.reward.ore), credits: between(cfg.reward.credits),
      science: Math.floor(between(cfg.reward.science) * effects.expeditionScience),
      crystals: cfg.reward.crystals && chance(cfg.reward.crystalsChance ?? 0) ? between(cfg.reward.crystals) : 0,
    };
    const eventKey = chance(cfg.eventChance) ? choose(Object.keys(EXPEDITION_EVENTS)) : null;
    const artifactId = chance(cfg.artifactChance) ? chooseArtifact(cfg.key) : null;

    await tx`
      UPDATE game_states SET energy=energy-${energyCost},parts=parts-${partsCost},credits=credits-${creditsCost},updated_at=now()
      WHERE user_id=${userId}
    `;
    const rows = await tx<any[]>`
      INSERT INTO expeditions(user_id,expedition_key,status,started_at,completes_at,reward_json,event_key,artifact_id)
      VALUES(${userId},${cfg.key},'active',now(),now()+make_interval(secs => ${cfg.durationSec}),${tx.json(reward)},${eventKey},${artifactId})
      RETURNING *
    `;
    await recordProgressEvent(tx, userId, 'expedition_started', 1, { expedition_key: cfg.key, duration_sec: cfg.durationSec });
    const run = rows[0];
    await enqueueNotification(tx, userId, 'expedition_ready', `expedition:${run.id}`, run.completes_at, { name: cfg.name, expeditionId: run.id });
    return { id: run.id, expedition_key: run.expedition_key, status: run.status, started_at: run.started_at, completes_at: run.completes_at };
  });
}

export async function resolveExpedition(userId: string, expeditionId: string, choiceId?: string) {
  return sql.begin(async (tx) => {
    await reconcileExpeditions(tx, userId);
    const run = (await tx<any[]>`SELECT * FROM expeditions WHERE id=${expeditionId} AND user_id=${userId} FOR UPDATE`)[0];
    if (!run) throw new Error('Экспедиция не найдена');
    if (run.status === 'active') throw new Error('Экспедиция ещё не вернулась');
    if (run.status === 'claimed') throw new Error('Награда уже получена');

    let extraReward: any = {};
    let choice: any = null;
    if (run.status === 'event') {
      const event = (EXPEDITION_EVENTS as any)[run.event_key];
      if (!event) throw new Error('Событие экспедиции повреждено');
      choice = event.choices.find((x: any) => x.id === choiceId);
      if (!choice) throw new Error('Выбери решение для события');
      const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
      const energy = Number(choice.cost?.energy ?? 0), parts = Number(choice.cost?.parts ?? 0), credits = Number(choice.cost?.credits ?? 0);
      if (Number(state.energy) < energy || Number(state.parts) < parts || Number(state.credits) < credits) throw new Error('Не хватает ресурсов для этого решения');
      await tx`UPDATE game_states SET energy=energy-${energy},parts=parts-${parts},credits=credits-${credits},updated_at=now() WHERE user_id=${userId}`;
      extraReward = choice.reward ?? {};
    }

    const base = typeof run.reward_json === 'string' ? JSON.parse(run.reward_json) : (run.reward_json ?? {});
    const merged: any = {
      ore: Number(base.ore ?? 0) + Number(extraReward.ore ?? 0),
      parts: Number(base.parts ?? 0) + Number(extraReward.parts ?? 0),
      credits: Number(base.credits ?? 0) + Number(extraReward.credits ?? 0),
      science: Number(base.science ?? 0) + Number(extraReward.science ?? 0),
      crystals: Number(base.crystals ?? 0) + Number(extraReward.crystals ?? 0),
    };
    const artifacts = [run.artifact_id, extraReward.artifactId].filter(Boolean) as string[];
    const applied = await applyReward(tx, userId, merged, artifacts[0] ?? null);
    if (artifacts.length > 1) await grantArtifact(tx, userId, artifacts[1]);

    await tx`
      UPDATE expeditions SET status='claimed',completed_at=now(),reward_claimed=true,event_choice=${choice?.id ?? null},updated_at=now()
      WHERE id=${run.id}
    `;
    await recordProgressEvent(tx, userId, 'expedition_completed', 1, { expedition_key: run.expedition_key, event_key: run.event_key, event_choice: choice?.id ?? null });
    await analyticsEvent(tx, userId, 'expedition_reward', { expedition_key: run.expedition_key, ...applied });
    return { ...applied, extraArtifactId: artifacts.length > 1 ? artifacts[1] : null };
  });
}
