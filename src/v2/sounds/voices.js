import { reactionSound } from '../../pet/chunk/reaction.js';

const MODULE = 'dicer';
const BASE = `modules/${MODULE}/assets/sounds/dsn`;

export const FX_SOUNDS = Object.freeze([
  'chime',
  'fanfare',
  'sparkle',
  'fizzle',
  'thud',
  'whoosh',
  'crackle',
  'zap',
  'boom',
  'frost',
  'hiss',
  'ring',
  'hum',
  'shimmer',
  'rift',
  'bubble',
  'warble',
  'ethereal',
  'squelch',
  'knock',
]);
export const PET_SOUNDS = Object.freeze([
  'petHappy',
  'petSad',
  'petHmm',
  'petHuh',
  'petPurr',
  'petYelp',
]);
export const PET_ACTION_SOUND = Object.freeze({ pet: 'petPurr', startle: 'petYelp' });

export const fxSoundUrl = (name) => (FX_SOUNDS.includes(name) ? `${BASE}/fx/${name}.ogg` : null);
export const petSoundUrl = (kind, name) =>
  PET_SOUNDS.includes(name) && typeof kind === 'string' && kind !== 'none'
    ? `${BASE}/pets/${kind}-${name}.ogg`
    : null;

export function petActionSound(action, reaction) {
  if (action === 'react') return reactionSound(reaction);
  return PET_ACTION_SOUND[action] ?? null;
}

export function createVoices({
  getDice3d = () => globalThis.game?.dice3d,
  getSetting = (key) => globalThis.game.settings.get(MODULE, key),
  getHelper = () => globalThis.foundry?.audio?.AudioHelper,
} = {}) {
  const on = (key) => {
    try {
      return getSetting(key) !== false;
    } catch {
      return true;
    }
  };
  const volume = () => {
    const v = Number(getDice3d()?.box?.volume);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  };
  function play(src) {
    const v = volume();
    if (!src || !(v > 0)) return false;
    try {
      getHelper()?.play({ src, volume: v, autoplay: true, loop: false }, false);
      return true;
    } catch (err) {
      console.warn(`dicer: cannot play ${src}`, err);
      return false;
    }
  }
  return {
    effect: (sound) => on('effectSounds') && play(fxSoundUrl(sound?.builtin)),
    pet: (kind, action, reaction) =>
      on('petSounds') && play(petSoundUrl(kind, petActionSound(action, reaction))),
  };
}

export function registerVoiceSettings(settings = globalThis.game.settings) {
  for (const key of ['effectSounds', 'petSounds'])
    settings.register(MODULE, key, {
      name: `DICER.Settings.${key}.Name`,
      hint: `DICER.Settings.${key}.Hint`,
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
    });
}
