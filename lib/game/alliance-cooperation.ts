export const ALLIANCE_COOPERATION_DURATION_SEC = 6 * 60 * 60;
export const ALLIANCE_COOPERATION_MAX_UNITS = 3;
export const ALLIANCE_COOPERATION_SHARED_SCIENCE = 2;
export const ALLIANCE_COOPERATION_TECH_COSTS = [100, 200, 400] as const;
export type CooperationRole = 'drilling' | 'power' | 'analysis';
export type CooperationTechnology = 'drilling' | 'analysis';
export type CooperationAmounts = Partial<Record<'ore' | 'energy' | 'parts' | 'credits' | 'science', number>>;
export type CooperationReward = { ore: number; credits: number; science: number };
export type CooperationTechnologySnapshot = { drilling: number; analysis: number };
export const COOPERATION_ROLES: readonly { id: CooperationRole; name: string; cost: CooperationAmounts; reward: CooperationReward }[] = [
  { id: 'drilling', name: 'Буровой модуль', cost: { energy: 100, parts: 10 }, reward: { ore: 350, credits: 50, science: 5 } },
  { id: 'power', name: 'Энергоподдержка', cost: { energy: 200 }, reward: { ore: 240, credits: 50, science: 5 } },
  { id: 'analysis', name: 'Анализ залежи', cost: { science: 15, energy: 80 }, reward: { ore: 240, credits: 120, science: 0 } },
];
export const COOPERATION_TECHNOLOGIES = [
  { id: 'drilling' as const, name: 'Кооперативное бурение', effectText: '+5% руды с каждого модуля за уровень. Применяется к новым операциям.' },
  { id: 'analysis' as const, name: 'Общий научный архив', effectText: '+1 личной науки с каждого модуля за уровень. Применяется к новым операциям.' },
];

export function cooperationTeamBonus(participants: number, distinctRoles: number) {
  if (participants >= 3 && distinctRoles >= 3) return 20;
  return participants >= 2 && distinctRoles >= 2 ? 10 : 0;
}

export function cooperationModuleReward(role: CooperationRole, technologies: CooperationTechnologySnapshot): CooperationReward {
  const config = COOPERATION_ROLES.find(item => item.id === role);
  if (!config) throw new Error('Неизвестная роль добычи');
  return { ore: Math.floor(config.reward.ore * (100 + technologies.drilling * 5) / 100),
    credits: config.reward.credits, science: config.reward.science + technologies.analysis };
}

export function cooperationFinalReward(base: CooperationReward, bonusPercent: number): CooperationReward {
  return { ...base, ore: Math.floor(base.ore * (100 + bonusPercent) / 100) };
}

export type CooperationRequest =
  | { action: 'start'; requestId: string }
  | { action: 'contribute'; requestId: string; operationId: string; role: CooperationRole }
  | { action: 'claim'; requestId: string; operationId: string }
  | { action: 'research'; requestId: string; technologyId: CooperationTechnology; expectedLevel: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseAllianceCooperationRequest(input: unknown): CooperationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Выбери действие совместной добычи');
  const body = input as Record<string, unknown>;
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw new Error('Некорректный идентификатор действия');
  const requestId = body.requestId.toLowerCase();
  if (body.action === 'start') return { action: 'start', requestId };
  if (body.action === 'research') {
    if (body.technologyId !== 'drilling' && body.technologyId !== 'analysis') throw new Error('Неизвестная технология альянса');
    if (!Number.isInteger(body.expectedLevel) || Number(body.expectedLevel) < 0 || Number(body.expectedLevel) >= ALLIANCE_COOPERATION_TECH_COSTS.length) throw new Error('Обнови уровень технологии альянса');
    return { action: 'research', requestId, technologyId: body.technologyId, expectedLevel: Number(body.expectedLevel) };
  }
  if ((body.action === 'contribute' || body.action === 'claim') && typeof body.operationId === 'string' && UUID.test(body.operationId)) {
    const operationId = body.operationId.toLowerCase();
    if (body.action === 'claim') return { action: 'claim', requestId, operationId };
    if (!COOPERATION_ROLES.some(item => item.id === body.role)) throw new Error('Неизвестная роль добычи');
    return { action: 'contribute', requestId, operationId, role: body.role as CooperationRole };
  }
  throw new Error('Некорректное действие совместной добычи');
}
