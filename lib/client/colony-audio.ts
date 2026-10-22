export type ColonySound = 'tap' | 'success' | 'error' | 'build';
export const COLONY_MEDIA_STORAGE_KEY = 'colony:media:v1';

export type ColonyMediaPreferences = { soundEnabled: boolean; animationsEnabled: boolean; volume: number };
export type ColonyMediaSnapshot = ColonyMediaPreferences & {
  reducedMotion: boolean; pageVisible: boolean; motionActive: boolean; audioSupported: boolean; audioReady: boolean;
};
const defaults: ColonyMediaPreferences = { soundEnabled: false, animationsEnabled: true, volume: 0.35 };
const serverSnapshot: ColonyMediaSnapshot = Object.freeze({ ...defaults, reducedMotion: false, pageVisible: true, motionActive: true, audioSupported: true, audioReady: false });

export function parseColonyMediaPreferences(raw: unknown): ColonyMediaPreferences {
  let value: unknown = raw;
  try { if (typeof raw === 'string') value = JSON.parse(raw); } catch { value = null; }
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sound = Object.getOwnPropertyDescriptor(saved, 'soundEnabled')?.value;
  const animations = Object.getOwnPropertyDescriptor(saved, 'animationsEnabled')?.value;
  const volume = Object.getOwnPropertyDescriptor(saved, 'volume')?.value;
  return {
    soundEnabled: typeof sound === 'boolean' ? sound : defaults.soundEnabled,
    animationsEnabled: typeof animations === 'boolean' ? animations : defaults.animationsEnabled,
    volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : defaults.volume,
  };
}

type MediaEnvironment = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  audioConstructor?: typeof AudioContext;
  visible: () => boolean;
  activated: () => boolean;
  reducedMotion: () => boolean;
  watchVisibility: (notify: () => void) => () => void;
  watchReducedMotion: (notify: () => void) => () => void;
  watchStorage: (notify: () => void) => () => void;
};

function browserEnvironment(): MediaEnvironment | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Device settings also work in memory. */ }
  const reduced = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const audioWindow = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return {
    storage, audioConstructor: audioWindow.AudioContext ?? audioWindow.webkitAudioContext,
    visible: () => document.visibilityState !== 'hidden' && window.Telegram?.WebApp?.isActive !== false,
    activated: () => navigator.userActivation?.isActive !== false,
    reducedMotion: () => reduced?.matches ?? false,
    watchVisibility: notify => {
      let watchedSdk: NonNullable<Window['Telegram']>['WebApp'] | undefined;
      const removeSdk = () => {
        try { watchedSdk?.offEvent?.('activated', changed); watchedSdk?.offEvent?.('deactivated', changed); } catch { /* Older Telegram clients may omit these events. */ }
        watchedSdk = undefined;
      };
      const attachSdk = () => {
        const sdk = window.Telegram?.WebApp;
        if (!sdk || sdk === watchedSdk) return;
        removeSdk(); watchedSdk = sdk;
        document.removeEventListener('load', changed, true);
        try { sdk.onEvent?.('activated', changed); sdk.onEvent?.('deactivated', changed); } catch { /* DOM visibility remains available. */ }
      };
      function changed() { attachSdk(); notify(); }
      document.addEventListener('visibilitychange', changed);
      // Next loads the SDK after hydration. Capture its load once it exists.
      document.addEventListener('load', changed, true);
      attachSdk();
      return () => { document.removeEventListener('visibilitychange', changed); document.removeEventListener('load', changed, true); removeSdk(); };
    },
    watchReducedMotion: notify => {
      if (!reduced) return () => {};
      if (reduced.addEventListener) { reduced.addEventListener('change', notify); return () => reduced.removeEventListener('change', notify); }
      reduced.addListener(notify); return () => reduced.removeListener(notify);
    },
    watchStorage: notify => {
      const changed = (event: StorageEvent) => { if (event.key === COLONY_MEDIA_STORAGE_KEY || event.key === null) notify(); };
      window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
    },
  };
}

type Tone = { hz: number; delay: number; duration: number; amplitude: number; wave?: OscillatorType };
const tones: Record<ColonySound, readonly Tone[]> = {
  tap: [{ hz: 620, delay: 0, duration: 0.045, amplitude: 0.1 }],
  success: [{ hz: 660, delay: 0, duration: 0.09, amplitude: 0.13 }, { hz: 880, delay: 0.07, duration: 0.12, amplitude: 0.1 }],
  error: [{ hz: 220, delay: 0, duration: 0.1, amplitude: 0.09, wave: 'triangle' }, { hz: 165, delay: 0.08, duration: 0.13, amplitude: 0.07, wave: 'triangle' }],
  build: [{ hz: 330, delay: 0, duration: 0.08, amplitude: 0.11 }, { hz: 494, delay: 0.06, duration: 0.1, amplitude: 0.1 }, { hz: 660, delay: 0.13, duration: 0.13, amplitude: 0.09 }],
};

/** One controller per page. Reading/subscribing never creates or resumes audio. */
export function createColonyMediaController(getEnvironment: () => MediaEnvironment | null = browserEnvironment) {
  let environment: MediaEnvironment | null = null;
  let snapshot = serverSnapshot;
  let preferences = { ...defaults };
  let initialized = false;
  let context: AudioContext | null = null;
  let unlocked = false;
  let lastPlayed = -Infinity;
  let lastPlayedKind: ColonySound | null = null;
  let unwatch: (() => void)[] = [];
  const listeners = new Set<() => void>();
  const activeTones = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();

  function publish() {
    const next: ColonyMediaSnapshot = {
      ...preferences, reducedMotion: environment?.reducedMotion() ?? false, pageVisible: environment?.visible() ?? true,
      motionActive: preferences.animationsEnabled && !(environment?.reducedMotion() ?? false) && (environment?.visible() ?? true),
      audioSupported: environment ? Boolean(environment.audioConstructor) : true,
      audioReady: unlocked && context?.state === 'running',
    };
    if ((Object.keys(next) as (keyof ColonyMediaSnapshot)[]).every(key => next[key] === snapshot[key])) return;
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  }
  function stopTones() {
    for (const tone of activeTones) {
      try { tone.oscillator.stop(); } catch { /* A short tone may already have finished. */ }
      try { tone.oscillator.disconnect(); tone.gain.disconnect(); } catch { /* Browser audio was interrupted. */ }
    }
    activeTones.clear();
  }
  function suspend() {
    unlocked = false;
    stopTones();
    try { if (context && context.state !== 'closed') void context.suspend().catch(() => {}); } catch { /* Gameplay never depends on audio. */ }
  }
  function readPreferences() {
    try { preferences = parseColonyMediaPreferences(environment?.storage?.getItem(COLONY_MEDIA_STORAGE_KEY)); }
    catch { /* Keep the current in-memory preferences if storage is blocked. */ }
  }
  function initialize() {
    if (initialized) return;
    environment = getEnvironment();
    if (!environment) return;
    initialized = true;
    readPreferences();
    publish();
  }
  function persist() {
    try { environment?.storage?.setItem(COLONY_MEDIA_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Keep settings in memory. */ }
  }
  function watch() {
    if (!environment || unwatch.length) return;
    unwatch = [
      environment.watchVisibility(() => { if (!environment?.visible()) suspend(); publish(); }),
      environment.watchReducedMotion(publish),
      environment.watchStorage(() => { readPreferences(); if (!preferences.soundEnabled) suspend(); publish(); }),
    ];
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener); initialize(); watch(); publish();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unwatch.forEach(remove => remove()); unwatch = []; suspend(); publish(); }
      };
    },
    async primeFromGesture(): Promise<boolean> {
      initialize();
      if (!environment || !preferences.soundEnabled || !environment.visible() || !environment.activated() || !environment.audioConstructor) return false;
      try {
        if (!context || context.state === 'closed') context = new environment.audioConstructor();
        if (context.state !== 'running') await context.resume();
        unlocked = context.state === 'running' && preferences.soundEnabled && environment.visible();
        publish();
        return unlocked;
      } catch { unlocked = false; publish(); return false; }
    },
    async setSoundEnabled(enabled: boolean): Promise<boolean> {
      initialize();
      preferences = { ...preferences, soundEnabled: enabled === true };
      if (!preferences.soundEnabled) suspend();
      persist(); publish();
      return preferences.soundEnabled ? this.primeFromGesture() : false;
    },
    setAnimationsEnabled(enabled: boolean) {
      initialize(); preferences = { ...preferences, animationsEnabled: enabled === true }; persist(); publish();
    },
    setVolume(value: number) {
      if (!Number.isFinite(value)) return;
      initialize(); preferences = { ...preferences, volume: Math.min(1, Math.max(0, value)) }; persist(); publish();
    },
    play(kind: ColonySound): boolean {
      // No context creation, resume, replay or queued sounds in this function.
      if (!preferences.soundEnabled || preferences.volume <= 0 || !unlocked || !environment?.visible() || context?.state !== 'running'
        || !Object.hasOwn(tones, kind)) return false;
      const now = context.currentTime;
      const rapid = now - lastPlayed < 0.045;
      if (rapid && (kind === 'tap' || kind === lastPlayedKind)) return false;
      // A confirmed action must still be audible after its immediate UI tap.
      if (kind !== 'tap' && ((rapid && lastPlayedKind === 'tap') || activeTones.size + tones[kind].length > 8)) stopTones();
      if (activeTones.size + tones[kind].length > 8) return false;
      lastPlayed = now; lastPlayedKind = kind;
      try {
        for (const tone of tones[kind]) {
          const oscillator = context.createOscillator(), gain = context.createGain();
          const start = now + tone.delay, end = start + tone.duration;
          oscillator.type = tone.wave ?? 'sine';
          oscillator.frequency.setValueAtTime(tone.hz, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(Math.max(0.0001, tone.amplitude * preferences.volume), start + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(gain); gain.connect(context.destination);
          const active = { oscillator, gain }; activeTones.add(active);
          oscillator.onended = () => { activeTones.delete(active); try { oscillator.disconnect(); gain.disconnect(); } catch {} };
          oscillator.start(start); oscillator.stop(end);
        }
        return true;
      } catch { stopTones(); return false; }
    },
  };
}

const controller = createColonyMediaController();
export const subscribeColonyMedia = controller.subscribe;
export const getColonyMediaSnapshot = controller.getSnapshot;
export const getServerColonyMediaSnapshot = controller.getServerSnapshot;
export const primeColonyAudioFromGesture = () => controller.primeFromGesture();
export const playColonySound = (kind: ColonySound) => controller.play(kind);
export const setColonySoundEnabled = (enabled: boolean) => controller.setSoundEnabled(enabled);
export const setColonyAnimationsEnabled = controller.setAnimationsEnabled;
export const setColonyVolume = controller.setVolume;
