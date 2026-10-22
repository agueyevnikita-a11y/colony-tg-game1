type Building = { id: string; type: string; status: string };
type Job = { building_id: string; completes_at: string; parts_reward: unknown };
type Contract = { resource: string; amount: unknown; expires_at: string; completed_at?: unknown };
export type CityActionSnapshot = {
  gridSize?: number;
  buildings?: readonly Building[];
  decor?: readonly unknown[];
  activeJobs?: readonly Job[];
  state?: Record<string, unknown>;
  caps?: Record<string, unknown>;
  escrow?: Record<string, unknown>;
  comfort?: { score: unknown };
  contracts?: readonly Contract[];
  contractsInfo?: { enabled?: boolean };
  research?: { labStatus?: string; active?: { completes_at: string } | null; completed?: readonly string[] };
  colonyEvents?: { enabled?: boolean; unlocked?: boolean; active?: unknown };
};
export type CityActionItem = { key: string; label: string; icon: string; hint: string; badge?: number; attention?: boolean };

function amount(raw: unknown) {
  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : 0;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function due(date: string, now: number) { const end = Date.parse(date); return Number.isFinite(end) && end <= now; }

/** Navigation hints from the existing snapshot only; no rewards are claimed here. */
export function cityActionItems(game: CityActionSnapshot, now = Date.now()): CityActionItem[] {
  const buildings = game.buildings ?? [];
  const resources = game.state ?? {};
  const gridSize = Number.isInteger(game.gridSize) && Number(game.gridSize) > 0 ? Number(game.gridSize) : 6;
  const freeCells = Math.max(0, gridSize ** 2 - buildings.length - (game.decor?.length ?? 0));
  const foundries = buildings.filter(building => building.type === 'foundry');
  const jobs = (game.activeJobs ?? []).filter(job => foundries.some(building => building.id === job.building_id));
  const dueJobs = jobs.filter(job => due(job.completes_at, now));
  const partsCapacity = game.caps?.parts === undefined ? Infinity
    : Math.max(0, amount(game.caps.parts) - amount(game.escrow?.parts));
  const storageBlocked = dueJobs.some(job => amount(job.parts_reward) > 0
    && amount(resources.parts) + amount(job.parts_reward) > partsCapacity);
  const activeFoundry = foundries.some(building => building.status === 'active');
  const foundryPending = foundries.find(building => building.status === 'building' || building.status === 'upgrading');
  const productionHint = storageBlocked ? 'Не хватает места'
    : dueJobs.length ? 'Проверить выпуск'
    : jobs.length ? `Циклов в очереди: ${jobs.length}`
    : activeFoundry ? 'Нет партий в очереди'
    : foundryPending ? foundryPending.status === 'upgrading' ? 'Цех улучшается' : 'Цех строится'
    : 'Нужен литейный цех';

  const research = game.research;
  const researchDue = !!research?.active && due(research.active.completes_at, now);
  const researchHint = research?.active ? researchDue ? 'Проверить результат' : 'Идёт исследование'
    : research?.labStatus === 'building' ? 'Центр строится'
    : research?.labStatus === 'upgrading' ? 'Центр улучшается'
    : research?.labStatus === 'active' ? 'Выбрать технологию'
    : 'Нужен научный центр';
  const events = game.colonyEvents;
  const hasEvent = !!(events?.enabled && events.unlocked && events.active);
  const eventHint = !events?.enabled ? 'Пока недоступны'
    : !events.unlocked ? 'База ур. 2 и первые шаги'
    : hasEvent ? 'Колония ждёт решения' : 'Пока спокойно';
  const currentContracts = (game.contracts ?? []).filter(contract => {
    const expiry = Date.parse(contract.expires_at);
    const cost = amount(contract.amount);
    return !contract.completed_at && (contract.resource === 'ore' || contract.resource === 'parts')
      && cost > 0 && Number.isFinite(expiry) && expiry > now;
  });
  const readyContracts = game.contractsInfo?.enabled
    ? currentContracts.filter(contract => amount(resources[contract.resource]) >= amount(contract.amount)).length : 0;
  const contractsHint = !game.contractsInfo?.enabled ? 'Нужен торговый узел'
    : readyContracts ? `Можно выполнить: ${readyContracts}`
    : currentContracts.length ? 'Нужны ресурсы для поставки'
    : 'Ждём новые поставки';

  return [
    { key: 'build', label: 'Построить', icon: 'build', hint: freeCells ? `Свободно клеток: ${freeCells}` : 'Карта заполнена' },
    { key: 'production', label: 'Цеха', icon: 'foundry', hint: productionHint, attention: dueJobs.length > 0, badge: dueJobs.length || undefined },
    { key: 'research', label: 'Исследования', icon: 'research', hint: researchHint, attention: researchDue, badge: researchDue ? 1 : undefined },
    { key: 'events', label: 'События', icon: 'events', hint: eventHint, attention: hasEvent, badge: hasEvent ? 1 : undefined },
    { key: 'decor', label: 'Декор', icon: 'decor', hint: `Комфорт: ${Math.min(100, Math.floor(amount(game.comfort?.score)))}/100` },
    { key: 'contracts', label: 'Контракты', icon: 'contracts', hint: contractsHint, attention: readyContracts > 0, badge: readyContracts || undefined },
    { key: 'share', label: 'Поделиться', icon: 'share', hint: 'Показать свой город' },
  ];
}
