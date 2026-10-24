import { ALLIANCE_COOPERATION_MAX_UNITS, ALLIANCE_COOPERATION_TECH_COSTS, COOPERATION_ROLES } from './alliance-cooperation';
import { COMPETITION_POINTS_PER_MODULE } from './alliance-competition';

type RecordValue = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const matchingId = (actual: unknown, expected: unknown) => id(actual) && id(expected) && actual.toLowerCase() === expected.toLowerCase();
function amounts(value: unknown, required?: readonly string[]): boolean {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => (required ?? ['ore', 'energy', 'parts', 'credits', 'science']).includes(key) && integer(value[key]))
    && (!required || required.every(key => Object.hasOwn(value, key)));
}
function personalReward(value: unknown): value is RecordValue {
  return amounts(value, ['ore', 'credits', 'science']) && record(value) && Number(value.ore) > 0 && Number(value.credits) > 0;
}
function roleCost(value: unknown, role: unknown) {
  const expected = COOPERATION_ROLES.find(item => item.id === role)?.cost;
  return expected && record(value) && amounts(value) && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([resource, amount]) => value[resource] === amount);
}

/** A success message needs a receipt for the submitted operation, never a preview fallback. */
export function validCooperationReceipt(value: unknown, intent: Readonly<RecordValue>): value is RecordValue {
  if (!record(value)) return false;
  if (intent.action === 'start') return id(value.operationId) && typeof value.started === 'boolean'
    && typeof value.endsAt === 'string' && Number.isFinite(Date.parse(value.endsAt));
  if (intent.action === 'research') return ['drilling', 'analysis'].includes(String(intent.technologyId))
    && value.technologyId === intent.technologyId && integer(intent.expectedLevel)
    && intent.expectedLevel < ALLIANCE_COOPERATION_TECH_COSTS.length && value.level === intent.expectedLevel + 1
    && value.cost === ALLIANCE_COOPERATION_TECH_COSTS[intent.expectedLevel] && integer(value.sharedScience);
  if (!matchingId(value.operationId, intent.operationId)) return false;
  if (intent.action === 'claim') return integer(value.count) && value.count > 0 && value.count <= ALLIANCE_COOPERATION_MAX_UNITS && personalReward(value.reward);
  if (intent.action === 'contribute') {
    if (!id(value.contributionId) || !['drilling', 'power', 'analysis'].includes(String(intent.role)) || value.role !== intent.role
      || !roleCost(value.cost, intent.role) || !personalReward(value.reward)) return false;
    return value.competition === undefined || (record(value.competition) && typeof value.competition.eligible === 'boolean'
      && (value.competition.eligible ? value.competition.points === 0 || value.competition.points === COMPETITION_POINTS_PER_MODULE : value.competition.points === 0));
  }
  return false;
}
