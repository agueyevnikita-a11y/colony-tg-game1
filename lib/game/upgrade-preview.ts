import { BUILDINGS, HQ_UPGRADES, cityGridSize, type BuildingType } from './config';
import { calculatePassiveGain, storageCaps } from './economy';
import { cityScore } from './city-score';
import { expeditionSlots } from './expeditions';
import { foundryQueueCapacity, quoteFoundry } from './foundry';
import { productionMultipliers, sciencePerHour } from './research';

type Building = { id: string; type: string; level: number; status: string };
type UpgradableBuilding = Building & { nextUpgrade?: { level: number } | null };
type PreviewContext = { buildings: readonly Building[]; completedResearch?: readonly string[]; premium?: boolean };
export type UpgradePreview = {
  currentLevel: number;
  targetLevel: number;
  title?: string;
  metrics: { key: string; label: string; resource?: string; icon?: string; before: string; after: string }[];
  note?: string;
};
const number = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
const hourly = (value: number) => `${number(value)}/ч`;
function cycleDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return minutes ? `${minutes} мин.${rest ? ` ${rest} сек.` : ''}` : `${rest} сек.`;
}
const knownType = (type: string): type is BuildingType => Object.hasOwn(BUILDINGS, type);

/** Actual hourly rate, including research and Premium, before storage limits. */
export function buildingHourlyProduction(building: Building, context: Pick<PreviewContext, 'completedResearch' | 'premium'>) {
  if (!knownType(building.type) || building.status !== 'active') return null;
  const completed = new Set(context.completedResearch ?? []);
  if (building.type === 'research_lab') return { resource: 'science', perHour: sciencePerHour([building.level], completed) };
  const passive = BUILDINGS[building.type].passive;
  if (!passive) return null;
  const effects = productionMultipliers(completed);
  const gain = calculatePassiveGain({ buildings: [{ ...building, type: building.type }], hoursElapsed: 1,
    premium: Boolean(context.premium), resourceMultipliers: { ore: effects.ore, energy: effects.energy } });
  return { resource: passive.resource, perHour: gain[passive.resource] };
}

/** Explain only an upgrade actually offered by the server, using the game's shared rules. */
export function buildingUpgradePreview(building: UpgradableBuilding, context: PreviewContext): UpgradePreview | null {
  const level = Number(building.level), target = Number(building.nextUpgrade?.level);
  if (building.status !== 'active' || !knownType(building.type) || !Number.isInteger(level) || level < 1
    || !building.nextUpgrade || target !== level + 1 || target > BUILDINGS[building.type].maxLevel
    || (building.type === 'hq' && !HQ_UPGRADES[target])) return null;
  const type = building.type;
  const completed = new Set(context.completedResearch ?? []), effects = productionMultipliers(completed);
  // Always include the selected building once, even in an incomplete caller snapshot.
  const before = [...context.buildings.filter(other => other.id !== building.id), building];
  const upgraded = { ...building, level: target };
  const after = before.map(other => other.id === building.id ? upgraded : other);
  const preview: UpgradePreview = { currentLevel: level, targetLevel: target, metrics: [] };
  const metric = (key: string, label: string, current: string, next: string, resource?: string, icon?: string) => {
    preview.metrics.push({ key, label, before: current, after: next, resource, icon });
  };
  const hqLevel = (rows: readonly Building[]) => Number(rows.find(other => other.type === 'hq')?.level ?? 1);
  const rating = () => metric('rating', 'Рейтинг города', number(cityScore(before, hqLevel(before))), number(cityScore(after, hqLevel(after))), undefined, 'trophy');
  const activeLevels = (rows: readonly Building[], buildingType: string) => rows.filter(other => other.type === buildingType && other.status === 'active').map(other => Number(other.level));

  if (BUILDINGS[type].passive) {
    const current = buildingHourlyProduction(building, context)!, next = buildingHourlyProduction(upgraded, context)!;
    metric('production', 'Производство', hourly(current.perHour), hourly(next.perHour), current.resource);
    preview.note = `С учётом текущих технологий${context.premium ? ' и Premium' : ''}${current.resource === 'credits' ? '' : ', пока есть место на складе'}. На время улучшения доход этого здания приостановится.`;
  } else if (type === 'warehouse') {
    const current = storageCaps(activeLevels(before, type)), next = storageCaps(activeLevels(after, type));
    for (const [resource, label] of [['ore', 'Руда'], ['energy', 'Энергия'], ['parts', 'Детали']] as const) {
      metric(resource, label, number(Math.floor(current[resource] * effects.storage)), number(Math.floor(next[resource] * effects.storage)), resource);
    }
    preview.title = 'Вместимость всей колонии';
    preview.note = 'Учтены работающие склады и технологии. Ресурсы в ордерах занимают часть вместимости. Во время работ вклад этого склада временно отключится; имеющиеся запасы сохранятся.';
  } else if (type === 'foundry') {
    const quote = (foundryLevel: number) => quoteFoundry({ level: foundryLevel, mode: 'standard', link: 'none', cycles: 1, partsMultiplier: effects.foundryParts });
    const current = quote(level), next = quote(target);
    metric('parts', 'Деталей за цикл', number(current.cycleParts), number(next.cycleParts), 'parts');
    metric('cycleTime', 'Время цикла', cycleDuration(current.cycleSeconds), cycleDuration(next.cycleSeconds), undefined, 'clock');
    metric('queue', 'Циклов в очереди', number(foundryQueueCapacity(level)), number(foundryQueueCapacity(target)), undefined, 'foundry');
    preview.note = 'Стандартный сплав, обычный режим, без связи с соседом; технологии учтены. Бонусы действуют на новые заказы. Оплаченная очередь продолжит работу; новые заказы доступны после улучшения.';
  } else if (type === 'research_lab') {
    metric('science', 'Производство науки', hourly(sciencePerHour([level], completed)), hourly(sciencePerHour([target], completed)), 'science');
    metric('labLevel', 'Уровень для технологий', number(Math.max(0, ...activeLevels(before, type))), number(Math.max(0, ...activeLevels(after, type))), undefined, 'research');
    preview.note = 'Доступ к технологиям определяет лучший работающий центр; учитываются также база и предыдущие исследования. На время работ этот центр перестанет производить науку. Запущенное исследование продолжится.';
  } else if (type === 'hq') {
    metric('grid', 'Территория', `${cityGridSize(level)}×${cityGridSize(level)}`, `${cityGridSize(target)}×${cityGridSize(target)}`, undefined, 'map');
    const available = (hq: number) => Object.values(BUILDINGS).filter(cfg => cfg.unlockHq <= hq).length;
    metric('buildingTypes', 'Типов зданий по уровню базы', number(available(level)), number(available(target)), undefined, 'build');
    rating();
    const unlocked = Object.values(BUILDINGS).filter(cfg => cfg.unlockHq > level && cfg.unlockHq <= target).map(cfg => cfg.name);
    preview.note = unlocked.length ? `Новый уровень базы: ${unlocked.join(', ')}. Для части зданий также нужны технологии; требования указаны в каталоге.`
      : 'Этот уровень повышает рейтинг города. Размер территории и список зданий остаются прежними.';
  } else if (type === 'expedition_center') {
    const slots = (rows: readonly Building[]) => expeditionSlots(Math.max(0, ...activeLevels(rows, type)), completed);
    metric('expeditionSlots', 'Экспедиций одновременно', number(slots(before)), number(slots(after)), undefined, 'rocket');
    rating();
    preview.note = 'Число экспедиций определяют лучший работающий центр и технологии. Дополнительный слот центра появляется на уровне 6. Маршруты открываются уровнем базы и исследованиями.';
  } else if (type === 'logistics') {
    rating();
    preview.note = 'Работающий центр открывает проекты снабжения. Уровень не увеличивает их награды. Во время улучшения поставки приостановятся; прогресс и готовые награды сохранятся.';
  } else {
    rating();
    preview.note = 'На этом уровне улучшается рейтинг города. Отдельного бонуса к производству или новых функций у этого улучшения пока нет.';
  }
  return preview;
}
