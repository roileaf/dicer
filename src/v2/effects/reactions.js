import { matchRule } from '../../effects/rules.js';
import { DIE_EFFECTS } from '../../effects/library/die-effects.js';
import { BUILTIN_THEMES } from '../../themes/themes.js';
import { dsnLook } from '../themes/dsn-look.js';
import { effectContext, EFFECTS, v1Die } from './classes.js';
import { stageOf } from './stage.js';

const sorted = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

export function lookKey({ material, materialSettings, dice, label }) {
  return JSON.stringify([material, sorted(materialSettings), lower(dice), lower(label)]);
}

export function themeIndex(themes = BUILTIN_THEMES) {
  const index = new Map();
  const add = (theme, look, type) => {
    if (!theme.rules?.length) return;
    const key = lookKey({
      material: look.material,
      materialSettings: look.materialSettings,
      dice: look.diceColor,
      label: look.labelColor,
    });
    const list = index.get(key) ?? [];
    list.push({ theme, type });
    index.set(key, list);
  };
  for (const theme of themes) {
    add(theme, dsnLook(theme.appearance), null);
    for (const [type, a] of Object.entries(theme.perType ?? {})) add(theme, dsnLook(a), type);
  }
  return index;
}

export function themeOf(dice, type, index) {
  const a = dice?.material?.userData?.appearance;
  if (!a?.material) return null;
  const key = lookKey({
    material: a.material,
    materialSettings: a.materialSettings,
    dice: a.background ?? a.diceColor,
    label: a.foreground ?? a.labelColor,
  });
  const entries = index.get(key);
  if (!entries) return null;
  const own = entries.find((e) => e.type === type);
  if (own) return own.theme;
  return entries.find((e) => e.type === null && !e.theme.perType?.[type])?.theme ?? null;
}

export function celebrationsFor(theme, type, result) {
  const faces = Number.parseInt(String(type).slice(1), 10);
  const die = {
    type,
    dsnType: type,
    value: result,
    faces: Number.isFinite(faces) ? faces : undefined,
  };
  return theme.rules.filter(
    (rule) =>
      rule.enabled !== false &&
      rule.effect &&
      Object.hasOwn(EFFECTS, rule.effect.id) &&
      matchRule(rule, die),
  );
}

export function createReactions({
  index = themeIndex(),
  getBox = () => globalThis.game?.dice3d?.box,
  now = () => performance.now(),
} = {}) {
  const running = [];
  let lastTick = -1;

  const hold = (dice, by) => {
    const data = dice.userData;
    data.dicerHolds = (data.dicerHolds ?? 0) + by;
    if (data.dicerHolds > 0) {
      if (data.dicerHolds === by) data.dicerWasAnimated = data.animated;
      data.animated = true;
    } else {
      data.animated = data.dicerWasAnimated;
      delete data.dicerHolds;
      delete data.dicerWasAnimated;
    }
  };

  const end = (i) => {
    const [r] = running.splice(i, 1);
    try {
      r.handle.stop?.();
    } catch (err) {
      console.warn(`dicer: effect "${r.id}" failed to stop`, err);
    }
    hold(r.dice, -1);
  };

  function play(dice, effect) {
    const box = getBox();
    const mod = EFFECTS[effect?.id];
    if (!box || !mod || !dice) return false;
    const stage = stageOf(box);
    const die = v1Die(dice, stage, { real: Object.hasOwn(DIE_EFFECTS, mod.id) });
    let handle = null;
    try {
      handle = mod.start(effectContext({ box, dicemesh: dice }, mod, stage, die, effect));
    } catch (err) {
      console.warn(`dicer: effect "${mod.id}" failed to start`, err);
    }
    if (typeof handle?.update !== 'function') return false;
    running.push({ dice, handle, id: mod.id, stage });
    hold(dice, 1);
    return true;
  }

  return {
    get running() {
      return running.length;
    },
    play,
    onResult({ dice, type, result }) {
      if (result == null) return;
      const theme = themeOf(dice, type, index);
      if (!theme) return;
      for (const rule of celebrationsFor(theme, type, result)) play(dice, rule.effect);
    },
    onFrame() {
      if (!running.length) return;
      const t = now();
      if (t === lastTick) return;
      lastTick = t;
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        r.stage.tick(t);
        let alive = false;
        try {
          alive = r.handle.update(t) === true;
        } catch (err) {
          console.warn(`dicer: effect "${r.id}" failed`, err);
        }
        if (!alive) end(i);
      }
    },
    onDespawn({ dice }) {
      for (let i = running.length - 1; i >= 0; i--) if (running[i].dice === dice) end(i);
    },
  };
}

export function registerReactions(hooks = globalThis.Hooks, reactions = createReactions()) {
  hooks.on('diceSoNiceDiceResult', (event) => void reactions.onResult(event));
  hooks.on('diceSoNiceDiceFrame', () => void reactions.onFrame());
  hooks.on('diceSoNiceDiceDespawn', (event) => void reactions.onDespawn(event));
  return reactions;
}
