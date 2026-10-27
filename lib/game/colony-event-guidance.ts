import type { ColonyEventAmounts, ColonyEventDefinition, ColonyEventResource } from './colony-events';
import type { ProgressDestination } from './progress-goals';

export type ColonyEventResourceGuide = {
  resource: ColonyEventResource;
  destination: ProgressDestination;
  icon: string;
  label: string;
  purpose: string;
};

const RESOURCE_GUIDES: readonly ColonyEventResourceGuide[] = [
  { resource: 'science', destination: 'research', icon: 'research', label: 'К исследованиям', purpose: 'Наука пополняет личный запас для открытия технологий: новых зданий, рецептов и улучшений колонии.' },
  { resource: 'parts', destination: 'build', icon: 'build', label: 'К постройкам', purpose: 'Детали нужны для строительства и улучшений, исследований и поставок.' },
  { resource: 'ore', destination: 'production', icon: 'parts', label: 'К производству', purpose: 'Руда вместе с энергией расходуется в цехе на производство деталей; она также нужна для строительства и поставок.' },
  { resource: 'energy', destination: 'production', icon: 'parts', label: 'К производству', purpose: 'Энергия расходуется на плавку в цехе и запуск экспедиций. Дополнительный запас помогает подготовить следующие партии и маршруты.' },
  { resource: 'credits', destination: 'build', icon: 'build', label: 'К постройкам', purpose: 'Кредиты оплачивают строительство и улучшения зданий, исследования и другие действия колонии.' },
];

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Explain only known positive resources; this is guidance, never a payout calculation. */
export function colonyEventResourceGuidance(amounts: unknown): ColonyEventResourceGuide[] {
  if (!record(amounts)) return [];
  return RESOURCE_GUIDES.filter(({ resource }) => Object.hasOwn(amounts, resource)
    && typeof amounts[resource] === 'number' && Number.isFinite(amounts[resource]) && amounts[resource] > 0)
    .map(guide => ({ ...guide }));
}

/** A mixed reward can lead to the same section only once. Navigation itself is free. */
export function colonyEventResourceActions(amounts: unknown): Omit<ColonyEventResourceGuide, 'resource'>[] {
  const seen = new Set<ProgressDestination>();
  return colonyEventResourceGuidance(amounts).flatMap(({ resource: _resource, ...action }) => {
    if (seen.has(action.destination)) return [];
    seen.add(action.destination);
    return [action];
  });
}

export type ColonyEventReceipt = {
  id: string;
  title: string;
  choiceTitle: string;
  resultText: string;
  cost: ColonyEventAmounts;
  reward: ColonyEventAmounts;
  resolvedAt: string;
};

type EventSnapshot = Pick<ColonyEventDefinition, 'title' | 'choices'> & { id: string };
const RECEIPT_KEYS = ['id', 'title', 'choiceTitle', 'resultText', 'cost', 'reward', 'resolvedAt'];
const RESOURCE_KEYS = new Set<string>(['ore', 'energy', 'parts', 'credits', 'science']);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validAmounts(value: unknown): value is ColonyEventAmounts {
  return record(value) && Reflect.ownKeys(value).every(key => typeof key === 'string'
    && RESOURCE_KEYS.has(key) && typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function sameAmounts(actual: unknown, expected: unknown): boolean {
  return validAmounts(actual) && validAmounts(expected)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every(key => Object.hasOwn(actual, key) && actual[key as ColonyEventResource] === expected[key as ColonyEventResource]);
}

/** Match the atomic server result to the exact event and choice captured before submitting. */
export function validColonyEventReceipt(value: unknown, event: EventSnapshot, choiceId: string): value is ColonyEventReceipt {
  if (!record(event) || !nonEmptyString(event.id) || !nonEmptyString(event.title)
    || !Array.isArray(event.choices) || !nonEmptyString(choiceId)) return false;
  const choiceIds = new Set<string>();
  for (const choice of event.choices) {
    if (!record(choice) || !nonEmptyString(choice.id) || choiceIds.has(choice.id)) return false;
    choiceIds.add(choice.id);
  }
  const choice = event.choices.find(item => item.id === choiceId);
  if (!choice || !nonEmptyString(choice.title) || !nonEmptyString(choice.resultText)
    || !validAmounts(choice.cost) || !validAmounts(choice.reward)) return false;
  if (!record(value) || Reflect.ownKeys(value).length !== RECEIPT_KEYS.length
    || !RECEIPT_KEYS.every(key => Object.hasOwn(value, key))
    || value.id !== event.id || value.title !== event.title || value.choiceTitle !== choice.title
    || value.resultText !== choice.resultText || !sameAmounts(value.cost, choice.cost) || !sameAmounts(value.reward, choice.reward)
    || typeof value.resolvedAt !== 'string') return false;
  const time = new Date(value.resolvedAt);
  return Number.isFinite(time.getTime()) && time.toISOString() === value.resolvedAt;
}
