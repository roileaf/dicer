import { AdaptiveQuality, effectiveTier, TIER_ORDER } from '../../render/quality.js';
import { currentTier, DEFAULT_TIER, setTier } from './state.js';

const MODULE = 'dicer';
const MAX_FRAME_GAP_MS = 250;
const SAME_FRAME_MS = 0.5;

export const DSN_QUALITY = Object.freeze({
  ultra: null,
  high: null,
  medium: Object.freeze({ shadowQuality: 'low', glow: false }),
  low: Object.freeze({
    shadowQuality: 'low',
    glow: false,
    antialiasing: 'none',
    useHighDPI: false,
    advancedGlass: false,
    persistentDiceOutlines: false,
  }),
});

const known = (tier) => TIER_ORDER.includes(tier);

export function createQualityControl({
  getDice3d = () => globalThis.game?.dice3d,
  getSetting = (key) => globalThis.game.settings.get(MODULE, key),
  setSetting = (key, value) => globalThis.game.settings.set(MODULE, key, value),
  notify = (message) => globalThis.ui?.notifications?.info(message),
  localize = (key) => globalThis.game?.i18n?.localize(key) ?? key,
  now = () => performance.now(),
} = {}) {
  let ours = false;
  let ceiling = null;
  let notified = false;
  let lastFrame = null;
  const adaptive = new AdaptiveQuality({ onDrop: () => drop() });

  const read = (key, fallback) => {
    try {
      return getSetting(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  function wanted() {
    const choice = String(read('quality', 'auto'));
    const remembered = String(read('autoTier', ''));
    const base = effectiveTier({
      choice: known(choice) ? choice : 'auto',
      autoTier: known(remembered) ? remembered : DEFAULT_TIER,
      cap: String(read('qualityCap', 'ultra')),
    });
    return TIER_ORDER[Math.min(TIER_ORDER.indexOf(base), ceiling ?? TIER_ORDER.length - 1)];
  }

  async function applyDsn(tier) {
    const dice3d = getDice3d();
    if (!dice3d?.setQuality) return;
    const keys = DSN_QUALITY[tier];
    if (ours && dice3d.getQuality?.().temporary === false) ours = false;
    if (keys) {
      await dice3d.setQuality({ ...keys });
      ours = true;
    } else if (ours) {
      await dice3d.setQuality(null);
      ours = false;
    }
  }

  async function apply() {
    const tier = wanted();
    const changed = setTier(tier);
    if (changed) getDice3d()?.DiceFactory?.disposeCachedMaterials?.();
    try {
      await applyDsn(tier);
    } catch (err) {
      console.warn('dicer: cannot set the display quality', err);
    }
    return changed;
  }

  let pending = Promise.resolve();
  const schedule = () => (pending = pending.then(apply, apply));

  function drop() {
    const at = TIER_ORDER.indexOf(currentTier());
    if (at <= 0) return;
    ceiling = at - 1;
    if (String(read('quality', 'auto')) === 'auto')
      Promise.resolve(setSetting('autoTier', TIER_ORDER[ceiling])).catch(() => {});
    if (!notified) {
      notified = true;
      notify(localize('DICER.Quality.Dropped'));
    }
    schedule();
  }

  return {
    get tier() {
      return currentTier();
    },
    get ours() {
      return ours;
    },
    start: schedule,
    settled: () => pending,
    refresh() {
      ceiling = null;
      return schedule();
    },
    onFrame() {
      const t = now();
      if (lastFrame !== null && t - lastFrame < SAME_FRAME_MS) return;
      const interval = lastFrame === null ? null : t - lastFrame;
      lastFrame = t;
      if (interval === null || interval > MAX_FRAME_GAP_MS) return;
      adaptive.frame(interval, { interval });
    },
  };
}

export function registerQualitySettings(control, settings = globalThis.game.settings) {
  const choices = Object.fromEntries(
    ['auto', ...TIER_ORDER].map((t) => [t, `DICER.Settings.quality.Choices.${t}`]),
  );
  settings.register(MODULE, 'quality', {
    name: 'DICER.Settings.quality.Name',
    hint: 'DICER.V2.Quality.Hint',
    scope: 'client',
    config: true,
    type: String,
    choices,
    default: 'auto',
    onChange: () => void control.refresh(),
  });
  settings.register(MODULE, 'qualityCap', {
    name: 'DICER.Settings.qualityCap.Name',
    hint: 'DICER.Settings.qualityCap.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: Object.fromEntries(TIER_ORDER.map((t) => [t, choices[t]])),
    default: 'ultra',
    onChange: () => void control.refresh(),
  });
  settings.register(MODULE, 'autoTier', {
    scope: 'client',
    config: false,
    type: String,
    default: '',
  });
}

export function registerQuality(hooks = globalThis.Hooks, control = createQualityControl()) {
  hooks.once('init', () => registerQualitySettings(control));
  hooks.once('diceSoNiceReady', () => void control.start());
  hooks.on('diceSoNiceDiceFrame', () => void control.onFrame());
  return control;
}
