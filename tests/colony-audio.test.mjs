import assert from 'node:assert/strict';
import test from 'node:test';
import { createColonyMediaController, parseColonyMediaPreferences } from '../lib/client/colony-audio.ts';

function fixture({ saved = null, supported = true, storageBlocked = false, resumeFails = false } = {}) {
  const calls = { constructors: 0, resumes: 0, suspends: 0, oscillators: [], writes: [] };
  const state = { visible: true, activated: true, reduced: false, saved };
  const watches = { visibility: new Set(), reduced: new Set(), storage: new Set() };
  class FakeAudioContext {
    state = 'suspended'; currentTime = 1; destination = {}; oscillators = [];
    constructor() { calls.constructors++; calls.context = this; }
    async resume() { calls.resumes++; if (resumeFails) throw new Error('WebView refused audio'); this.state = 'running'; }
    async suspend() { calls.suspends++; this.state = 'suspended'; }
    createOscillator() {
      const node = { type: 'sine', onended: null, frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, starts: [], stops: [],
        start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); } };
      calls.oscillators.push(node); return node;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const watch = group => notify => { watches[group].add(notify); return () => watches[group].delete(notify); };
  const environment = {
    storage: { getItem() { if (storageBlocked) throw new Error('Storage unavailable'); return state.saved; }, setItem(key, value) { if (storageBlocked) throw new Error('Storage unavailable'); state.saved = value; calls.writes.push({ key, value }); } },
    audioConstructor: supported ? FakeAudioContext : undefined,
    visible: () => state.visible, activated: () => state.activated, reducedMotion: () => state.reduced,
    watchVisibility: watch('visibility'), watchReducedMotion: watch('reduced'), watchStorage: watch('storage'),
  };
  return { controller: createColonyMediaController(() => environment), environment, calls, state, watches,
    emit(group) { watches[group].forEach(callback => callback()); } };
}

test('device media preferences default to silent and reject malformed or inherited settings', () => {
  const defaults = { soundEnabled: false, animationsEnabled: true, volume: 0.35 };
  for (const raw of [undefined, null, '', 'invalid', '[]', 'true', '{}', { soundEnabled: 'true', animationsEnabled: 'false', volume: NaN }, Object.create({ soundEnabled: true })]) {
    assert.deepEqual(parseColonyMediaPreferences(raw), defaults);
  }
  assert.deepEqual(parseColonyMediaPreferences('{"soundEnabled":true,"animationsEnabled":false,"volume":0.5}'), { soundEnabled: true, animationsEnabled: false, volume: 0.5 });
  assert.equal(parseColonyMediaPreferences({ volume: 9 }).volume, 1);
  assert.equal(parseColonyMediaPreferences({ volume: -2 }).volume, 0);
  let getterCalled = false;
  const accessor = Object.defineProperty({}, 'soundEnabled', { get() { getterCalled = true; return true; } });
  assert.equal(parseColonyMediaPreferences(accessor).soundEnabled, false);
  assert.equal(getterCalled, false);
});

test('reading stored sound consent or subscribing never constructs or resumes browser audio', async () => {
  const f = fixture({ saved: '{"soundEnabled":true}' });
  assert.equal(f.controller.getServerSnapshot().soundEnabled, false);
  const unsubscribe = f.controller.subscribe(() => {});
  assert.equal(f.controller.getSnapshot().soundEnabled, true);
  assert.equal(f.controller.getSnapshot().audioReady, false);
  f.emit('storage'); f.emit('visibility'); f.emit('reduced');
  assert.equal(f.controller.play('success'), false);
  assert.equal(f.calls.constructors, 0); assert.equal(f.calls.resumes, 0);
  assert.deepEqual(Object.values(f.watches).map(group => group.size), [1, 1, 1]);
  unsubscribe();
  assert.deepEqual(Object.values(f.watches).map(group => group.size), [0, 0, 0]);
});

test('explicit opt-in still requires an active gesture; playback never unlocks audio itself', async () => {
  const f = fixture(); f.controller.subscribe(() => {});
  f.state.activated = false;
  assert.equal(await f.controller.setSoundEnabled(true), false);
  assert.equal(f.calls.constructors, 0);
  assert.equal(f.controller.play('build'), false);
  f.state.activated = true;
  assert.equal(await f.controller.primeFromGesture(), true);
  assert.equal(f.calls.constructors, 1); assert.equal(f.calls.resumes, 1);
  assert.equal(f.controller.play('success'), true);
  assert.equal(f.calls.oscillators.length, 2);
  assert.ok(f.calls.oscillators.every(node => node.stops[0] - node.starts[0] <= 0.14));
  assert.equal(f.controller.play('success'), false, 'Rapid duplicate results are not replayed');
  await f.controller.setSoundEnabled(false);
  assert.equal(f.controller.play('success'), false);
  assert.equal(f.controller.getSnapshot().audioReady, false);
  assert.ok(f.calls.oscillators.every(node => node.stops.length === 2), 'Disabling stops already scheduled tones');
});

test('a confirmed action takes priority over its same-tick tap and bounded nodes do not queue playback', async () => {
  const f = fixture(); f.controller.subscribe(() => {}); await f.controller.setSoundEnabled(true);
  assert.equal(f.controller.play('tap'), true);
  assert.equal(f.controller.play('tap'), false);
  assert.equal(f.controller.play('build'), true, 'A fast server result must not be swallowed by the UI tap');
  assert.equal(f.calls.oscillators.length, 4);
  assert.equal(f.calls.oscillators[0].stops.length, 2, 'The superseded tap stops immediately');
  assert.equal(f.controller.play('build'), false);
  for (let i = 0; i < 12; i++) { f.calls.context.currentTime += 0.05; assert.equal(f.controller.play(i % 2 ? 'build' : 'success'), true); }
  const live = f.calls.oscillators.filter(node => node.stops.length === 1);
  assert.ok(live.length <= 8, 'Rapid actions retain a fixed small voice budget');
});

test('hidden pages stop tones and motion; becoming visible does not resume or replay sounds', async () => {
  const f = fixture(); f.controller.subscribe(() => {}); await f.controller.setSoundEnabled(true); f.controller.play('build');
  f.state.visible = false; f.emit('visibility');
  assert.equal(f.controller.getSnapshot().motionActive, false);
  assert.equal(f.controller.getSnapshot().audioReady, false);
  assert.equal(f.controller.play('success'), false);
  assert.ok(f.calls.oscillators.every(node => node.stops.length === 2));
  f.state.visible = true; f.emit('visibility');
  assert.equal(f.controller.getSnapshot().motionActive, true);
  assert.equal(f.calls.resumes, 1); assert.equal(f.controller.play('success'), false);
  f.state.reduced = true; f.emit('reduced');
  assert.equal(f.controller.getSnapshot().motionActive, false);
  f.controller.setAnimationsEnabled(true);
  assert.equal(f.controller.getSnapshot().motionActive, false, 'Device reduced-motion preference always wins');
  f.state.reduced = false; f.emit('reduced'); f.controller.setAnimationsEnabled(false);
  assert.equal(f.controller.getSnapshot().motionActive, false);
});

test('unsupported audio, blocked storage and failed resume remain silent without breaking settings', async () => {
  const unsupported = fixture({ supported: false }); unsupported.controller.subscribe(() => {});
  assert.equal(unsupported.controller.getSnapshot().audioSupported, false);
  assert.equal(await unsupported.controller.setSoundEnabled(true), false);
  assert.equal(unsupported.controller.play('error'), false);
  const blocked = fixture({ storageBlocked: true, resumeFails: true }); blocked.controller.subscribe(() => {});
  assert.equal(await blocked.controller.setSoundEnabled(true), false);
  blocked.controller.setAnimationsEnabled(false); blocked.controller.setVolume(0.7);
  assert.equal(blocked.controller.getSnapshot().animationsEnabled, false);
  assert.equal(blocked.controller.getSnapshot().volume, 0.7);
  assert.equal(blocked.controller.play('success'), false);
});

test('the browser adapter attaches a late Telegram SDK once and pauses inactive Mini Apps', async () => {
  const f = fixture();
  const globals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const mediaQuery = Object.assign(new EventTarget(), { matches: false });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), { localStorage: f.environment.storage, AudioContext: f.environment.audioConstructor, matchMedia: () => mediaQuery });
  const events = { activated: new Set(), deactivated: new Set() };
  let registrations = 0;
  const sdk = { isActive: true, onEvent(name, callback) { registrations++; events[name].add(callback); }, offEvent(name, callback) { events[name].delete(callback); } };
  const unsubscriptions = [];
  try {
    for (const [key, value] of Object.entries({ window, document, navigator: { userActivation: { isActive: true } } })) Object.defineProperty(globalThis, key, { value, configurable: true });
    const controller = createColonyMediaController();
    unsubscriptions.push(controller.subscribe(() => {}), controller.subscribe(() => {}));
    assert.equal(registrations, 0);
    window.Telegram = { WebApp: sdk };
    document.dispatchEvent(new Event('load'));
    document.dispatchEvent(new Event('load'));
    assert.equal(registrations, 2, 'One shared handler per Telegram activity event, including late SDK loading');
    assert.equal(await controller.setSoundEnabled(true), true);
    assert.equal(f.calls.resumes, 1);
    sdk.isActive = false; events.deactivated.forEach(callback => callback());
    assert.equal(document.visibilityState, 'visible');
    assert.equal(controller.getSnapshot().pageVisible, false);
    assert.equal(controller.getSnapshot().motionActive, false);
    assert.equal(controller.play('build'), false);
    sdk.isActive = true; events.activated.forEach(callback => callback());
    assert.equal(controller.getSnapshot().motionActive, true);
    assert.equal(controller.getSnapshot().audioReady, false);
    assert.equal(f.calls.resumes, 1, 'SDK activation never resumes sound automatically');
    unsubscriptions.pop()();
    assert.equal(events.activated.size, 1);
    unsubscriptions.pop()();
    assert.equal(events.activated.size, 0); assert.equal(events.deactivated.size, 0);
  } finally {
    unsubscriptions.forEach(unsubscribe => unsubscribe());
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
