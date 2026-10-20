import { type BuildingType } from './config';
import { calculatePassiveGain } from './economy';
import { offlineCapHours, productionMultipliers, sciencePerHour } from './research';

type Timestamp = Date | string | number;

export type IncomeBuilding = {
  type: BuildingType;
  level: number;
  status: string;
  target_level?: number | null;
  completes_at?: Timestamp | null;
  created_at?: Timestamp | null;
};

export type IncomeResearch = {
  key: string;
  // Null is a legacy completed research whose activation time was not recorded.
  completedAt: Timestamp | null;
};

type IncomeParams = {
  from: Timestamp;
  to: Timestamp;
  premium: boolean;
  buildings: IncomeBuilding[];
  research: IncomeResearch[];
};

export type ResearchIncomeSegment = {
  ore: number;
  energy: number;
  credits: number;
  science: number;
  warehouseLevels: number[];
  storageMultiplier: number;
};

function timestamp(value: Timestamp | null | undefined) {
  if (value == null) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

/** Rate and storage availability for each interval, in chronological order. */
export function calculateResearchIncomeSegments(params: IncomeParams): ResearchIncomeSegment[] {
  const segments: ResearchIncomeSegment[] = [];
  const from = timestamp(params.from);
  const to = timestamp(params.to);
  if (from == null || to == null || to <= from) return segments;

  const research = params.research.map((entry) => ({ key: entry.key, at: timestamp(entry.completedAt) ?? from }));
  const buildings = params.buildings.map((building) => ({
    ...building,
    createdAt: timestamp(building.created_at) ?? from,
    completesAt: timestamp(building.completes_at),
  }));
  const boundaries = new Set([from, to]);
  const addBoundary = (at: number | null) => {
    if (at != null && at > from && at < to) boundaries.add(at);
  };
  for (const entry of research) addBoundary(entry.at);
  for (const building of buildings) {
    addBoundary(building.createdAt);
    addBoundary(building.completesAt);
  }
  // Archive changes the horizon from the time it completes. It never restores
  // production missed before completion, even if the expanded horizon covers it.
  addBoundary(from + offlineCapHours(params.premium, new Set()) * 3_600_000);
  addBoundary(from + offlineCapHours(params.premium, new Set(['archive_network'])) * 3_600_000);

  const intervals = [...boundaries].sort((a, b) => a - b);
  for (let i = 0; i < intervals.length - 1; i++) {
    const start = intervals[i];
    const end = intervals[i + 1];
    const completed = new Set(research.filter((entry) => entry.at <= start).map((entry) => entry.key));
    if (start >= from + offlineCapHours(params.premium, completed) * 3_600_000) continue;
    const activeBuildings = buildings.flatMap((building) => {
      if (building.createdAt > start) return [];
      if (building.status === 'active') return [{ type: building.type, level: building.level, status: 'active' }];
      if ((building.status === 'building' || building.status === 'upgrading') && building.completesAt != null && building.completesAt <= start) {
        return [{ type: building.type, level: building.target_level ?? building.level, status: 'active' }];
      }
      return [];
    });
    const hours = (end - start) / 3_600_000;
    const effects = productionMultipliers(completed);
    const passive = calculatePassiveGain({
      buildings: activeBuildings,
      hoursElapsed: hours,
      premium: params.premium,
      resourceMultipliers: { ore: effects.ore, energy: effects.energy },
    });
    segments.push({
      ...passive,
      science: sciencePerHour(activeBuildings.filter((building) => building.type === 'research_lab').map((building) => building.level), completed) * hours,
      warehouseLevels: activeBuildings.filter((building) => building.type === 'warehouse').map((building) => building.level),
      storageMultiplier: effects.storage,
    });
  }
  return segments;
}

/** Total uncapped production; callers with storage limits settle each segment. */
export function calculateResearchIncome(params: IncomeParams) {
  return calculateResearchIncomeSegments(params).reduce((gain, segment) => ({
    ore: gain.ore + segment.ore,
    energy: gain.energy + segment.energy,
    credits: gain.credits + segment.credits,
    science: gain.science + segment.science,
  }), { ore: 0, energy: 0, credits: 0, science: 0 });
}
