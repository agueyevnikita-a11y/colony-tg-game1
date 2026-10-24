import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { SEASON_POINT_SOURCES, nextSeasonQuestGoal } = await import('../lib/game/season-goals.ts');
const { SEASON_EVENT_POINTS } = await import('../lib/game/season.ts');
const { progressGoalForEvent } = await import('../lib/game/progress-goals.ts');
const { DAILY_QUESTS, WEEKLY_QUESTS } = await import('../lib/game/progression.ts');

const now = Date.UTC(2026, 9, 24, 12);
const reset = new Date(now + 1000).toISOString();
const snapshot = (config, progress = 0, patch = {}) => ({ id: `row-${config.key}`, quest_key: config.key,
  progress, target: config.target, credit_reward: config.credits, crystal_reward: config.crystals, ...patch });
const period = (catalog, progress = {}) => ({ catalog, resetsAt: reset, quests: catalog.map(config => snapshot(config, progress[config.key] ?? 0)) });
const daily = (patch = {}) => ({ ...period(DAILY_QUESTS, { daily_smelt: 1 }), ...patch });
const weekly = (patch = {}) => ({ ...period(WEEKLY_QUESTS, { weekly_contracts: 2 }), ...patch });

test('all nine source guides use real positive SP values and exact shared purposes and counting rules', () => {
  const actual = Object.fromEntries(SEASON_POINT_SOURCES.map(source => [source.event, source.points]));
  assert.deepEqual(actual, Object.fromEntries(Object.entries(SEASON_EVENT_POINTS).filter(([, points]) => points > 0)));
  assert.equal(SEASON_POINT_SOURCES.length, 9);
  for (const source of SEASON_POINT_SOURCES) {
    assert.equal(source.goal, progressGoalForEvent(source.event));
    assert.ok(source.label.trim());
    assert.ok(source.goal.purpose && source.goal.countHint);
  }
});

test('sources distinguish paid cycles, result collection and repeat artifacts without minting extra unique-artifact SP', () => {
  const source = event => SEASON_POINT_SOURCES.find(row => row.event === event);
  assert.match(source('foundry_started').label, /Оплата каждого цикла/);
  assert.match(source('foundry_started').goal.countHint, /оплаченный цикл/);
  assert.match(source('expedition_completed').label, /Получение результата/);
  assert.match(source('expedition_completed').goal.countHint, /Дождаться возвращения аппарата недостаточно/);
  assert.match(source('artifact_found').label, /Каждый.*включая повторы/);
  assert.match(source('artifact_found').goal.countHint, /повторные артефакты/);
  assert.equal(source('foundry_started').points, 3);
  assert.equal(source('artifact_found').points, 15);
  for (const event of ['unique_artifact_found', 'quest_claimed', 'achievement_claimed', 'daily_login_claimed', 'market_order_created', 'market_trade_bought', 'market_trade_sold', 'supply_completed']) {
    assert.equal(source(event), undefined, event);
  }
});

test('real daily and weekly goals connect to the same development event and select the closest progress ratio', () => {
  const result = nextSeasonQuestGoal({ daily: daily(), weekly: weekly(), now });
  assert.equal(result.period, 'weekly');
  assert.equal(result.quest.quest_key, 'weekly_contracts');
  assert.equal(result.config.event, 'contract_completed');
  assert.equal(result.source.goal.destination, 'contracts');
  assert.equal(result.remaining, 1);
  assert.equal(result.source.points, SEASON_EVENT_POINTS.contract_completed);
  assert.equal(Object.hasOwn(result, 'guaranteedPoints'), false);
  assert.equal(Object.hasOwn(result, 'actionsToReward'), false);
});

test('daily wins equal ratios before weekly and original catalog row order is stable within a period', () => {
  const result = nextSeasonQuestGoal({ daily: daily(), weekly: period(WEEKLY_QUESTS, { weekly_smelt: 5 }), now });
  assert.equal(result.period, 'daily');
  assert.equal(result.quest.quest_key, 'daily_smelt');
  const tied = nextSeasonQuestGoal({ weekly: period(WEEKLY_QUESTS), now });
  assert.equal(tied.quest.quest_key, 'weekly_build');
});

test('first daily entry is described as an SP source but never proposed as a repeatable quest action', () => {
  const config = DAILY_QUESTS.find(row => row.key === 'daily_login');
  assert.ok(SEASON_POINT_SOURCES.some(source => source.event === config.event && source.points === 10));
  assert.equal(nextSeasonQuestGoal({ daily: period([config]), now }), null);
});

test('goals with unknown, reached or expired period boundaries never get a current-quest recommendation', () => {
  for (const resetsAt of [undefined, '', 'invalid', new Date(now).toISOString(), new Date(now - 1).toISOString(), null, now + 1000]) {
    assert.equal(nextSeasonQuestGoal({ daily: daily({ resetsAt }), now }), null);
  }
  assert.equal(nextSeasonQuestGoal({ daily: daily(), now: NaN }), null);
  assert.equal(nextSeasonQuestGoal({ daily: daily(), now: Infinity }), null);
  assert.equal(nextSeasonQuestGoal({ now }), null);
  const result = nextSeasonQuestGoal({ daily: daily({ resetsAt: undefined }), weekly: weekly(), now });
  assert.equal(result.period, 'weekly');
});

test('ready or claimed rewards are not mistaken for unfinished development actions', () => {
  const config = DAILY_QUESTS.find(row => row.key === 'daily_smelt');
  for (const patch of [{ progress: 2 }, { progress: 9 }, { claimed_at: 'claimed' }]) {
    assert.equal(nextSeasonQuestGoal({ daily: { catalog: [config], resetsAt: reset, quests: [snapshot(config, 1, patch)] }, now }), null);
  }
});

test('numeric database strings are accepted while malformed counters and rewards cannot suggest a goal', () => {
  const config = DAILY_QUESTS.find(row => row.key === 'daily_smelt');
  const run = patch => nextSeasonQuestGoal({ daily: { catalog: [config], resetsAt: reset, quests: [snapshot(config, 1, patch)] }, now });
  assert.equal(run({ progress: '1', target: '2', credit_reward: '200', crystal_reward: '6' }).remaining, 1);
  for (const value of [undefined, null, '', ' ', {}, [], true, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(run({ progress: value }), null, `progress ${String(value)}`);
    assert.equal(run({ target: value }), null, `target ${String(value)}`);
    assert.equal(run({ credit_reward: value }), null, `credits ${String(value)}`);
    assert.equal(run({ crystal_reward: value }), null, `crystals ${String(value)}`);
  }
  assert.equal(run({ target: 0 }), null);
  assert.equal(run({ id: '' }), null);
});

test('catalog mapping must be unique and exact; names and substring lookalikes cannot invent an SP event', () => {
  const config = DAILY_QUESTS.find(row => row.key === 'daily_smelt');
  const run = (catalog, quests = [snapshot(config, 1)]) => nextSeasonQuestGoal({ daily: { catalog, quests, resetsAt: reset }, now });
  assert.equal(run([config, config]), null);
  assert.equal(run([config], [snapshot(config, 1), snapshot(config, 1)]), null);
  assert.equal(run([config, { ...config, key: 'other' }], [snapshot(config, 1), snapshot(config, 1, { quest_key: 'other' })]), null);
  for (const event of ['foundry', 'future_foundry_started', 'build_started_extra', 'quest_claimed', 'market_trade_bought', undefined, '__proto__']) {
    assert.equal(run([{ ...config, event }]), null, String(event));
  }
  assert.equal(run([{ ...config, title: '' }]), null);
  assert.equal(run([{ ...config, description: undefined }]), null);
});

test('invalid collection entries are ignored and valid inputs remain untouched including their stable array order', () => {
  const d = daily(), w = weekly();
  const before = structuredClone({ daily: d, weekly: w });
  const result = nextSeasonQuestGoal({ daily: d, weekly: w, now });
  assert.deepEqual({ daily: d, weekly: w }, before);
  assert.equal(result.quest, w.quests.find(row => row.quest_key === 'weekly_contracts'));
  assert.equal(result.config, w.catalog.find(row => row.key === 'weekly_contracts'));
  assert.equal(result.source, SEASON_POINT_SOURCES.find(source => source.event === 'contract_completed'));
  assert.equal(nextSeasonQuestGoal({ daily: { quests: null, catalog: [], resetsAt: reset }, now }), null);
  assert.equal(nextSeasonQuestGoal({ daily: { quests: [], catalog: null, resetsAt: reset }, now }), null);
  assert.equal(nextSeasonQuestGoal({ daily: { quests: [null], catalog: [null], resetsAt: reset }, now }), null);
});
