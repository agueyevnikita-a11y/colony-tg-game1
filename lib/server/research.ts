import { sql, type Transaction } from './db';
import { RESEARCH_TREE, researchByKey } from '@/lib/game/research';
import { analyticsEvent, recordProgressEvent } from './progression';
import { enqueueNotification } from './notifications';

export async function reconcileResearch(tx: Transaction, userId: string) {
  const finished = await tx<any[]>`
    UPDATE user_research
    SET status='completed', completed_at=now()
    WHERE user_id=${userId} AND status='researching' AND completes_at <= now()
    RETURNING research_key
  `;
  for (const row of finished) {
    await recordProgressEvent(tx, userId, 'research_completed', 1, { research_key: row.research_key });
  }
  return finished.map((x) => x.research_key as string);
}

export async function completedResearchKeys(tx: Transaction, userId: string): Promise<Set<string>> {
  const rows = await tx<any[]>`SELECT research_key FROM user_research WHERE user_id=${userId} AND status='completed'`;
  return new Set<string>(rows.map((x: any) => String(x.research_key)));
}

export async function getResearchState(tx: Transaction, userId: string, hqLevel: number, buildings: any[]) {
  const lab = buildings.filter((b) => b.type === 'research_lab' && b.status === 'active').sort((a,b)=>Number(b.level)-Number(a.level))[0] ?? null;
  const rows = await tx<any[]>`
    SELECT research_key,status,started_at,completes_at,completed_at
    FROM user_research WHERE user_id=${userId}
    ORDER BY started_at NULLS LAST, research_key
  `;
  const completed = new Set<string>(rows.filter((x: any) => x.status === 'completed').map((x: any) => String(x.research_key)));
  const active = rows.find((x) => x.status === 'researching') ?? null;
  const catalog = RESEARCH_TREE.map((cfg) => ({
    ...cfg,
    unlockedByHq: hqLevel >= cfg.unlockHq,
    unlockedByLab: !!lab && Number(lab.level) >= cfg.labLevel,
    prereqsMet: cfg.prereqs.every((key) => completed.has(key)),
    status: rows.find((x) => x.research_key === cfg.key)?.status ?? 'locked',
  }));
  return { enabled: !!lab, labLevel: Number(lab?.level ?? 0), active, completed: [...completed], catalog };
}

export async function startResearch(userId: string, researchKey: string) {
  const cfg = researchByKey(researchKey);
  if (!cfg) throw new Error('Исследование не найдено');
  return sql.begin(async (tx) => {
    await reconcileResearch(tx, userId);
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const lab = (await tx<any[]>`
      SELECT * FROM buildings WHERE user_id=${userId} AND type='research_lab' AND status='active'
      ORDER BY level DESC LIMIT 1
    `)[0];
    if (!lab) throw new Error('Сначала построй исследовательский центр');
    if (Number(state.hq_level) < cfg.unlockHq) throw new Error(`Требуется HQ${cfg.unlockHq}`);
    if (Number(lab.level) < cfg.labLevel) throw new Error(`Требуется исследовательский центр уровня ${cfg.labLevel}`);
    const existing = (await tx<any[]>`SELECT * FROM user_research WHERE user_id=${userId} AND research_key=${cfg.key} FOR UPDATE`)[0];
    if (existing?.status === 'completed') throw new Error('Исследование уже завершено');
    if (existing?.status === 'researching') throw new Error('Это исследование уже выполняется');
    const active = (await tx<any[]>`SELECT research_key FROM user_research WHERE user_id=${userId} AND status='researching' LIMIT 1 FOR UPDATE`)[0];
    if (active) throw new Error('Сначала дождись завершения текущего исследования');
    const completed = await completedResearchKeys(tx, userId);
    if (!cfg.prereqs.every((key) => completed.has(key))) throw new Error('Сначала заверши предыдущие исследования ветки');
    if (Number(state.science ?? 0) < cfg.science) throw new Error(`Нужно 🧠 ${cfg.science} науки`);
    if (Number(state.credits) < Number(cfg.cost.credits ?? 0)) throw new Error('Недостаточно кредитов');
    if (Number(state.parts) < Number(cfg.cost.parts ?? 0)) throw new Error('Недостаточно деталей');

    await tx`
      UPDATE game_states SET science=science-${cfg.science}, credits=credits-${Number(cfg.cost.credits ?? 0)},
        parts=parts-${Number(cfg.cost.parts ?? 0)}, updated_at=now()
      WHERE user_id=${userId}
    `;
    await tx`
      INSERT INTO user_research(user_id,research_key,status,started_at,completes_at)
      VALUES(${userId},${cfg.key},'researching',now(),now()+make_interval(secs => ${cfg.timeSec}))
      ON CONFLICT(user_id,research_key) DO UPDATE SET status='researching',started_at=now(),completes_at=now()+make_interval(secs => ${cfg.timeSec}),completed_at=NULL
    `;
    await analyticsEvent(tx, userId, 'research_started', { research_key: cfg.key, science: cfg.science, time_sec: cfg.timeSec });
    await enqueueNotification(tx, userId, 'research_ready', `research:${cfg.key}`, new Date(Date.now()+cfg.timeSec*1000), { name: cfg.name, researchKey: cfg.key });
    return cfg;
  });
}
