import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { missionReadiness } = await import('../lib/game/mission-readiness.ts');

const now = Date.parse('2030-01-01T12:00:00.000Z');
const iso = value => new Date(value).toISOString();
const quest = (progress = 3, target = 3, claimed_at = null) => ({ progress, target, claimed_at });
const snapshot = () => ({
  dailyLogin: { today: { claimed_at: null } },
  dailyQuests: [quest(), quest(1), quest(3, 3, iso(now - 1))],
  weeklyQuests: [quest('3', '3')],
  questPeriods: { daily: { resetsAt: iso(now + 100) }, weekly: { resetsAt: iso(now + 200) } },
  achievementCatalog: [{ key: 'first' }, { key: 'second' }, { key: 'third' }],
  achievements: [{ achievement_key: 'first' }, { achievement_key: 'second', claimed_at: iso(now - 1) }, { achievement_key: 'not-catalogued' }],
  season: {
    starts_at: iso(now - 100), ends_at: iso(now + 300), points: '75',
    claims: [{ level: '1' }],
    rewards: [{ level: 1, points: 25 }, { level: 2, points: '75' }, { level: 3, points: 150 }],
  },
});

test('badges join achievement catalogue and exclude claimed, unfinished and unreached rewards', () => {
  assert.deepEqual(missionReadiness(snapshot(), now), {
    counts: { daily: 2, weekly: 1, achievements: 1, season: 1 }, nextChangeAt: now + 100,
  });
  assert.deepEqual(missionReadiness(null, now), {
    counts: { daily: 0, weekly: 0, achievements: 0, season: 0 }, nextChangeAt: null,
  });
});

test('known daily, weekly and season boundaries remove only their expired badge at equality', () => {
  const game = snapshot();
  assert.equal(missionReadiness(game, now + 99).counts.daily, 2);
  assert.deepEqual(missionReadiness(game, now + 100), {
    counts: { daily: 0, weekly: 1, achievements: 1, season: 1 }, nextChangeAt: now + 200,
  });
  assert.deepEqual(missionReadiness(game, now + 200), {
    counts: { daily: 0, weekly: 0, achievements: 1, season: 1 }, nextChangeAt: now + 300,
  });
  assert.deepEqual(missionReadiness(game, now + 300), {
    counts: { daily: 0, weekly: 0, achievements: 1, season: 0 }, nextChangeAt: null,
  });
});

test('a future season is not ready before start and becomes ready exactly at its known start', () => {
  const game = snapshot();
  game.questPeriods = {};
  game.season.starts_at = iso(now + 50);
  assert.equal(missionReadiness(game, now).counts.season, 0);
  assert.equal(missionReadiness(game, now).nextChangeAt, now + 50);
  assert.equal(missionReadiness(game, now + 49).counts.season, 0);
  assert.equal(missionReadiness(game, now + 50).counts.season, 1);
  assert.equal(missionReadiness(game, now + 50).nextChangeAt, now + 300);
});

test('unknown daily and weekly deadlines preserve server authority without scheduling invented resets', () => {
  for (const resetsAt of [undefined, null, '', 'invalid', now, new Date(now), {}, []]) {
    const game = snapshot();
    game.questPeriods = { daily: { resetsAt }, weekly: { resetsAt } };
    game.season = null;
    const result = missionReadiness(game, now);
    assert.deepEqual(result.counts, { daily: 2, weekly: 1, achievements: 1, season: 0 });
    assert.equal(result.nextChangeAt, null);
  }
});

test('missing, invalid or inverted season dates never invent an active season', () => {
  for (const [starts_at, ends_at] of [
    [undefined, iso(now + 1)], [null, iso(now + 1)], ['', iso(now + 1)], ['invalid', iso(now + 1)],
    [iso(now - 1), undefined], [iso(now - 1), 'invalid'], [iso(now + 1), iso(now - 1)],
    [iso(now), iso(now)], [now - 1, now + 1],
  ]) {
    const game = snapshot();
    game.questPeriods = {};
    Object.assign(game.season, { starts_at, ends_at });
    assert.equal(missionReadiness(game, now).counts.season, 0);
    assert.equal(missionReadiness(game, now).nextChangeAt, null);
  }
  const game = snapshot();
  game.season.starts_at = new Date(now - 1);
  game.season.ends_at = new Date(now + 1);
  assert.equal(missionReadiness(game, now).counts.season, 1, 'Date objects supported by the season panel remain valid');
});

test('malformed numeric progress and thresholds cannot inflate quest or season readiness', () => {
  const invalid = [undefined, null, '', ' ', 'invalid', NaN, Infinity, -1, {}, [], true];
  for (const value of invalid) {
    const game = snapshot();
    game.dailyLogin = null;
    game.dailyQuests = [{ progress: value, target: 1 }, { progress: 100, target: value }];
    game.weeklyQuests = [];
    game.season.claims = [];
    game.season.rewards = [{ level: 1, points: value }];
    assert.equal(missionReadiness(game, now).counts.daily, 0);
    assert.equal(missionReadiness(game, now).counts.season, 0);
    game.season.points = value;
    game.season.rewards = [{ level: 1, points: 0 }];
    assert.equal(missionReadiness(game, now).counts.season, 0);
  }
  const game = snapshot();
  game.dailyLogin = null;
  game.dailyQuests = [quest(0, 0), quest(3, 3), quest('3.5', '3'), quest(3, 4)];
  game.season.claims = [];
  game.season.rewards = [{ level: 0, points: 0 }, { level: 1.5, points: 0 }, { level: Infinity, points: 0 }, { level: '2', points: 0 }];
  assert.equal(missionReadiness(game, now).counts.daily, 2);
  assert.equal(missionReadiness(game, now).counts.season, 1);
});

test('a fresh snapshot replaces ended periods and claimed rows without hiding the new day', () => {
  const old = snapshot();
  assert.equal(missionReadiness(old, now + 400).counts.daily, 0);
  const fresh = structuredClone(old);
  fresh.questPeriods.daily.resetsAt = iso(now + 1_000);
  fresh.dailyLogin.today = { claimed_at: null };
  fresh.dailyQuests = [quest(0, 3), quest(3, 3)];
  fresh.achievements[0].claimed_at = iso(now + 350);
  fresh.season = { ...fresh.season, starts_at: iso(now + 350), ends_at: iso(now + 1_500), claims: [] };
  assert.deepEqual(missionReadiness(fresh, now + 400), {
    counts: { daily: 2, weekly: 0, achievements: 0, season: 2 }, nextChangeAt: now + 1_000,
  });
  assert.equal(missionReadiness(old, now + 400).counts.daily, 0, 'the old snapshot is not mutated');
});

test('invalid client clocks do not expire server periods or claim an active season', () => {
  for (const clock of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(missionReadiness(snapshot(), clock), {
      counts: { daily: 2, weekly: 1, achievements: 1, season: 0 }, nextChangeAt: null,
    });
  }
});
