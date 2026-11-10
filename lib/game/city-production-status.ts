import { foundryQueueCapacity, foundryQueueOverview, type FoundryBuilding, type FoundryJob } from './foundry';

export type CityProductionState = 'idle' | 'running' | 'queued' | 'ready' | 'blocked' | 'check' | 'building' | 'upgrading';
export type CityProductionStatus = {
  buildingId: string;
  status: CityProductionState;
  buildingStatus: string;
  occupied: number | null;
  capacity: number | null;
  freeSlots: number | null;
  readyCount: number;
  readyParts: number;
  collectableCount: number | null;
  blockedCount: number | null;
  running: { jobId: string; startedAt: number; completesAt: number; progress: number } | null;
  nextAt: number | null;
};

type Input = {
  buildings: readonly FoundryBuilding[];
  jobs?: readonly FoundryJob[];
  currentParts: unknown;
  partsCapacity?: number;
  now: number;
};
type TimedJob = { job: FoundryJob; startedAt: number; completesAt: number };

function validJob(job: FoundryJob): TimedJob | null {
  const startedAt = typeof job.started_at === 'string' ? Date.parse(job.started_at) : NaN;
  const completesAt = typeof job.completes_at === 'string' ? Date.parse(job.completes_at) : NaN;
  const output = typeof job.parts_reward === 'number' || typeof job.parts_reward === 'string' && String(job.parts_reward).trim()
    ? Number(job.parts_reward) : NaN;
  return Number.isFinite(startedAt) && Number.isFinite(completesAt) && completesAt > startedAt
    && Number.isFinite(output) && output > 0 ? { job, startedAt, completesAt } : null;
}

/** Read-only map hints from saved paid jobs. A passed timer never issues output or frees a queue slot. */
export function cityProductionStatuses(input: Input): CityProductionStatus[] {
  const foundries = input.buildings.filter(building => building.type === 'foundry');
  const foundryIds = new Set(foundries.map(building => building.id));
  const knownJobs = Array.isArray(input.jobs);
  const jobs = knownJobs ? input.jobs!.filter(job => foundryIds.has(job.building_id)) : [];
  const timed = jobs.map(validJob);
  const valid = timed.filter((row): row is TimedJob => row !== null);
  const validNow = typeof input.now === 'number' && Number.isFinite(input.now);
  // Incomplete owned jobs can change the shared issuance order. Keep other ready outputs uncertain too.
  const knownIssuance = knownJobs && validNow && valid.length === jobs.length;
  const overview = foundryQueueOverview({ buildings: foundries, jobs: valid.map(row => row.job), now: input.now,
    currentParts: input.currentParts, partsCapacity: knownIssuance ? input.partsCapacity : undefined });

  return foundries.map(building => {
    const ownJobs = jobs.filter(job => job.building_id === building.id);
    const ownTimed = valid.filter(row => row.job.building_id === building.id);
    const level = Number(building.level);
    const capacity = Number.isInteger(level) && level >= 1 && level <= 15 ? foundryQueueCapacity(level) : null;
    const occupied = knownJobs ? ownJobs.length : null;
    const freeSlots = capacity !== null && occupied !== null ? Math.max(0, capacity - occupied) : null;
    const due = validNow ? ownTimed.filter(row => row.completesAt <= input.now) : [];
    const queue = overview.workshops.find(row => row.id === building.id);
    const readyCount = due.length;
    const collectableCount = readyCount === 0 ? 0 : queue?.collectableCount ?? null;
    const blockedCount = collectableCount === null ? null : readyCount - collectableCount;
    const runningRows = validNow ? ownTimed.filter(row => row.startedAt <= input.now && row.completesAt > input.now) : [];
    const invalid = !knownJobs || !validNow || capacity === null || ownTimed.length !== ownJobs.length
      || !['active', 'building', 'upgrading'].includes(building.status) || runningRows.length > 1;
    const runningRow = !invalid && runningRows.length === 1 ? runningRows[0] : null;
    const running = runningRow ? { jobId: runningRow.job.id, startedAt: runningRow.startedAt, completesAt: runningRow.completesAt,
      progress: Math.min(1, Math.max(0, (input.now - runningRow.startedAt) / (runningRow.completesAt - runningRow.startedAt))) } : null;
    const boundaries = !invalid ? ownTimed.flatMap(row => [row.startedAt, row.completesAt]).filter(at => at > input.now) : [];
    const nextAt = boundaries.length ? Math.min(...boundaries) : null;
    let status: CityProductionState;
    if (invalid) status = 'check';
    else if (readyCount > 0) status = collectableCount === null ? 'check' : blockedCount! > 0 ? 'blocked' : 'ready';
    else if (building.status === 'building' || building.status === 'upgrading') status = building.status;
    else if (running) status = 'running';
    else if (ownTimed.some(row => row.startedAt > input.now)) status = 'queued';
    else status = ownJobs.length === 0 ? 'idle' : 'check';
    return { buildingId: building.id, status, buildingStatus: building.status, occupied, capacity, freeSlots, readyCount,
      readyParts: due.reduce((sum, row) => sum + Number(row.job.parts_reward), 0), collectableCount, blockedCount, running, nextAt };
  });
}
