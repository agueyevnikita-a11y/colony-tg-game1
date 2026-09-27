import { TUTORIAL_STEPS } from '@/lib/game/tutorial';
import { grantCosmetic } from './cosmetics';
import { analyticsEvent } from './progression';
import { pushInbox } from './inbox';

function conditionMet(stepIndex: number, state: any, buildings: any[], stats: any) {
  switch (stepIndex) {
    case 0: return true;
    case 1: return buildings.some((b) => b.type === 'foundry' && Number(b.level) >= 1 && b.status === 'active');
    case 2: return Number(stats?.foundry_jobs_started ?? 0) >= 1;
    case 3: return buildings.some((b) => b.type === 'trade_hub' && Number(b.level) >= 1 && b.status === 'active');
    case 4: return Number(stats?.contracts_completed ?? 0) >= 1;
    case 5: return Number(state?.hq_level ?? 1) >= 2;
    default: return false;
  }
}

export function getTutorialStateFromRows(state: any, buildings: any[], stats: any) {
  const step = Math.max(0, Math.min(TUTORIAL_STEPS.length, Number(state?.tutorial_step ?? 0)));
  const completed = step >= TUTORIAL_STEPS.length;
  const current = completed ? null : TUTORIAL_STEPS[step];
  return {
    step,
    total: TUTORIAL_STEPS.length,
    completed,
    completedAt: state?.tutorial_completed_at ?? null,
    current: current ? { ...current, conditionMet: conditionMet(step, state, buildings, stats) } : null,
    catalog: TUTORIAL_STEPS,
  };
}

export async function claimTutorialStep(tx: any, userId: string) {
  const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
  if (!state) throw new Error('Игровой профиль не найден');
  const stepIndex = Number(state.tutorial_step ?? 0);
  if (stepIndex >= TUTORIAL_STEPS.length) throw new Error('Обучение уже завершено');
  const step = TUTORIAL_STEPS[stepIndex];
  const buildings = await tx<any[]>`SELECT type,level,status FROM buildings WHERE user_id=${userId}`;
  const stats = (await tx<any[]>`SELECT * FROM player_stats WHERE user_id=${userId}`)[0] ?? {};
  if (!conditionMet(stepIndex, state, buildings, stats)) throw new Error('Сначала выполни текущую задачу обучения');

  const inserted = await tx<any[]>`
    INSERT INTO tutorial_claims(user_id,step_index,step_key)
    VALUES(${userId},${stepIndex},${step.key})
    ON CONFLICT(user_id,step_index) DO NOTHING
    RETURNING step_index
  `;
  if (!inserted.length) throw new Error('Награда этого шага уже получена');
  const r = step.reward;
  await tx`
    UPDATE game_states SET
      ore=ore+${Number(r.ore ?? 0)}, energy=energy+${Number(r.energy ?? 0)}, parts=parts+${Number(r.parts ?? 0)},
      credits=credits+${Number(r.credits ?? 0)}, crystals=crystals+${Number(r.crystals ?? 0)},
      tutorial_step=tutorial_step+1,
      tutorial_completed_at=CASE WHEN tutorial_step+1 >= ${TUTORIAL_STEPS.length} THEN now() ELSE tutorial_completed_at END,
      updated_at=now()
    WHERE user_id=${userId}
  `;
  if (r.cosmeticId) await grantCosmetic(tx, userId, r.cosmeticId, `tutorial_${step.key}`);
  await analyticsEvent(tx, userId, 'tutorial_step_claimed', { step_index: stepIndex, step_key: step.key });
  if (stepIndex + 1 >= TUTORIAL_STEPS.length) {
    await pushInbox(tx,userId,{kind:'milestone',dedupeKey:'tutorial_complete',title:'Базовая подготовка завершена',body:'Теперь доступны свободное развитие, рынок, исследования, экспедиции и социальные механики COLONY.'});
  }
  return { stepIndex, step };
}
