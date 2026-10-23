import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';
import { SEASON_EVENT_POINTS, SEASON_REWARDS } from '../lib/game/season.ts';
import { ACHIEVEMENTS, DAILY_QUESTS, WEEKLY_QUESTS } from '../lib/game/progression.ts';
import { BUILDINGS, HQ_UPGRADES, cityGridSize } from '../lib/game/config.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { storageCaps, upgradeCost } = await import('../lib/game/economy.ts');

test('reversible orders and split trades cannot mint seasonal points; paid colony activities still count', () => {
  for (const event of ['market_order_created', 'market_trade_bought', 'market_trade_sold']) {
    assert.equal(SEASON_EVENT_POINTS[event] ?? 0, 0, event);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(SEASON_EVENT_POINTS).filter(([, points]) => points > 0)), {
    daily_session: 10, build_started: 5, foundry_started: 3, contract_completed: 10,
    qualified_referral: 25, research_completed: 10, expedition_started: 4, expedition_completed: 12, artifact_found: 15,
  });
});

test('closing seasonal farming changes no reward threshold, currency grant or cosmetic duration', () => {
  assert.deepEqual(SEASON_REWARDS.map(reward => reward.points), [25, 75, 150, 250, 400, 600, 850, 1150, 1500, 2000]);
  assert.equal(SEASON_REWARDS.reduce((sum, reward) => sum + (reward.credits ?? 0), 0), 5000);
  assert.equal(SEASON_REWARDS.reduce((sum, reward) => sum + (reward.crystals ?? 0), 0), 60);
  assert.deepEqual(SEASON_REWARDS.filter(reward => reward.cosmeticId).map(({ cosmeticId, cosmeticDays }) => [cosmeticId, cosmeticDays]), [
    ['weather_signal_storm', 7], ['frame_first_signal', 14], ['theme_first_signal', 14], ['badge_pioneer_s1', undefined],
  ]);
});

test('building goals honestly include upgrades and retain existing keys, smaller targets and rewards', () => {
  const daily = DAILY_QUESTS.find(goal => goal.key === 'daily_build');
  const weekly = WEEKLY_QUESTS.find(goal => goal.key === 'weekly_build');
  assert.deepEqual([daily.target, daily.crystals, daily.credits], [1, 6, 250]);
  assert.deepEqual([weekly.target, weekly.crystals, weekly.credits], [7, 25, 1200]);
  for (const goal of [daily, weekly, ...ACHIEVEMENTS.filter(goal => goal.stat === 'buildings_started')]) {
    assert.match(goal.description, /улучшени/);
    assert.match(goal.description, /здани/);
  }
  assert.deepEqual(ACHIEVEMENTS.filter(goal => goal.stat === 'buildings_started').map(({ key, target, reward }) => ({ key, target, reward })), [
    { key: 'builder_10', target: 10, reward: { crystals: 25 } },
    { key: 'builder_100', target: 100, reward: { cosmeticId: 'theme_neon', cosmeticDays: 7 } },
    { key: 'builder_10000', target: 500, reward: { cosmeticId: 'theme_neon' } },
  ]);
});

test('the permanent builder goal has a constructive mixed-city path inside real map and storage limits', () => {
  const layout = [
    ['hq', 6, 1], ['mine', 8, 20], ['solar', 8, 20], ['habitat', 8, 15],
    ['warehouse', 8, 4], ['foundry', 8, 2], ['trade_hub', 8, 2],
  ];
  assert.equal(layout.reduce((sum, [, , count]) => sum + count, 0), cityGridSize(6) ** 2);
  const caps = storageCaps(Array(4).fill(8));
  assert.deepEqual(caps, { ore: 50000, energy: 30000, parts: 20000 });
  for (const [type, level] of layout) {
    assert.ok(level <= BUILDINGS[type].maxLevel);
    const cost = type === 'hq' ? HQ_UPGRADES[level].cost : upgradeCost(type, level - 1);
    for (const resource of ['ore', 'energy', 'parts']) assert.ok((cost[resource] ?? 0) <= caps[resource], `${type}: ${resource}`);
  }
  // Four level-one warehouses fit the initial map and can be improved before
  // the expensive HQ upgrades; storage does not depend on an impossible jump.
  const startingCaps = storageCaps(Array(4).fill(1));
  assert.ok(upgradeCost('warehouse', 7).ore <= startingCaps.ore);
  const events = layout.reduce((sum, [type, level, count]) => sum + count * (level - (type === 'hq' ? 1 : 0)), 0) - 3;
  assert.equal(events, 506, 'The three initially provided non-HQ levels are not paid construction events');
  assert.ok(events >= ACHIEVEMENTS.find(goal => goal.key === 'builder_10000').target);
  assert.ok(10000 > cityGridSize(6) ** 2 * Math.max(...Object.values(BUILDINGS).map(config => config.maxLevel)), 'The previous goal exceeded even a loose physical upper bound');
});
