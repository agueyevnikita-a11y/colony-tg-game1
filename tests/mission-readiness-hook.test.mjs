import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module, registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { missionReadiness } = await import('../lib/game/mission-readiness.ts');
const filename = fileURLToPath(new URL('../lib/client/use-mission-readiness.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const now = Date.parse('2030-01-01T12:00:00.000Z');
const iso = value => new Date(value).toISOString();
const snapshot = () => ({
  dailyLogin: { today: {} }, dailyQuests: [{ progress: 1, target: 1 }], weeklyQuests: [{ progress: 1, target: 1 }],
  questPeriods: { daily: { resetsAt: iso(now + 100) }, weekly: { resetsAt: iso(now + 200) } },
  season: { starts_at: iso(now + 50), ends_at: iso(now + 300), points: 1, rewards: [{ level: 1, points: 1 }] },
});

function harness(t, initialGame = snapshot()) {
  let clock = now, game = initialGame, cursor = 0, dirty = true, counts, renders = 0, nextTimer = 1;
  const slots = [], pending = [], timers = new Map(), windowListeners = new Map(), documentListeners = new Map();
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const subscribe = listeners => (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
  };
  const unsubscribe = listeners => (event, listener) => listeners.get(event)?.delete(listener);
  const fakeWindow = {
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay, due: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { throw new Error('Mission badges must not use an interval'); },
    addEventListener: subscribe(windowListeners), removeEventListener: unsubscribe(windowListeners),
  };
  const fakeDocument = { visibilityState: 'visible', addEventListener: subscribe(documentListeners), removeEventListener: unsubscribe(documentListeners) };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  t.mock.method(Date, 'now', () => clock);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        const value = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo(compute, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) pending.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const loaded = new Module(filename);
  const require = createRequire(import.meta.url);
  loaded.filename = filename;
  loaded.require = specifier => specifier === 'react' ? react : specifier === '../game/mission-readiness' ? { missionReadiness } : require(specifier);
  loaded._compile(compiled, filename);
  const render = () => {
    let loops = 0;
    while (dirty) {
      assert.ok(++loops < 10, 'hook must settle without a render loop');
      dirty = false;
      cursor = 0;
      renders++;
      counts = loaded.exports.useMissionReadiness(game);
      pending.splice(0).forEach(effect => effect());
    }
    return counts;
  };
  const cleanup = () => { slots.forEach(slot => slot?.cleanup?.()); slots.length = 0; };
  t.after(() => {
    cleanup();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  });
  render();
  return {
    get counts() { return counts; }, get renders() { return renders; }, timers, windowListeners, documentListeners,
    at(value) { clock = value; },
    fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); return render(); },
    replace(value) { game = value; dirty = true; return render(); },
    windowEvent(event) { windowListeners.get(event)?.forEach(listener => listener()); return render(); },
    visibility(state) { fakeDocument.visibilityState = state; documentListeners.get('visibilitychange')?.forEach(listener => listener()); return render(); },
    cleanup,
  };
}

test('the badge hook schedules only the next known boundary and stops after all periods end', t => {
  const hook = harness(t);
  assert.deepEqual(hook.counts, { daily: 2, weekly: 1, achievements: 0, season: 0 });
  for (const [time, delay, expected] of [
    [now + 50, 50, { daily: 2, weekly: 1, achievements: 0, season: 1 }],
    [now + 100, 50, { daily: 0, weekly: 1, achievements: 0, season: 1 }],
    [now + 200, 100, { daily: 0, weekly: 0, achievements: 0, season: 1 }],
    [now + 300, 100, { daily: 0, weekly: 0, achievements: 0, season: 0 }],
  ]) {
    assert.equal(hook.timers.size, 1);
    assert.equal([...hook.timers.values()][0].delay, delay);
    hook.at(time);
    assert.deepEqual(hook.fireTimer(), expected);
  }
  assert.equal(hook.timers.size, 0);
  assert.equal(hook.renders, 5);
});

test('an early timer reschedules the remaining boundary without falsely unlocking a reward', t => {
  const hook = harness(t);
  hook.at(now + 49);
  assert.equal(hook.fireTimer().season, 0);
  assert.equal([...hook.timers.values()][0].delay, 1);
  hook.at(now + 50);
  assert.equal(hook.fireTimer().season, 1);
});

test('returning from a suspended tab resamples all deadlines and cleans listeners on unmount', t => {
  const hook = harness(t);
  hook.at(now + 400);
  hook.visibility('hidden');
  assert.equal(hook.renders, 1, 'hiding the tab must not update badges');
  assert.deepEqual(hook.visibility('visible'), { daily: 0, weekly: 0, achievements: 0, season: 0 });
  assert.equal(hook.timers.size, 0);
  hook.windowEvent('focus');
  hook.windowEvent('pageshow');
  assert.equal(hook.renders, 4);
  hook.cleanup();
  assert.ok([...hook.windowListeners.values(), ...hook.documentListeners.values()].every(listeners => listeners.size === 0));
  assert.equal(hook.timers.size, 0);
});

test('new snapshots immediately replace stale counts and cancel the preceding boundary timer', t => {
  const hook = harness(t);
  const oldTimer = [...hook.timers.keys()][0];
  hook.at(now + 400);
  const fresh = snapshot();
  fresh.questPeriods.daily.resetsAt = iso(now + 1_000);
  fresh.dailyLogin.today.claimed_at = iso(now + 350);
  assert.deepEqual(hook.replace(fresh), { daily: 1, weekly: 0, achievements: 0, season: 0 });
  assert.equal(hook.timers.has(oldTimer), false);
  assert.equal([...hook.timers.values()][0].delay, 600);
  assert.deepEqual(hook.replace(null), { daily: 0, weekly: 0, achievements: 0, season: 0 });
  assert.equal(hook.timers.size, 0);
});

test('a very distant boundary is capped at the browser timeout limit and safely rescheduled', t => {
  const game = { dailyLogin: { today: {} }, questPeriods: { daily: { resetsAt: iso(now + 3_000_000_000) } } };
  const hook = harness(t, game);
  assert.equal([...hook.timers.values()][0].delay, 2_147_483_647);
  hook.at(now + 2_147_483_647);
  assert.equal(hook.fireTimer().daily, 1);
  assert.equal([...hook.timers.values()][0].delay, 3_000_000_000 - 2_147_483_647);
});
