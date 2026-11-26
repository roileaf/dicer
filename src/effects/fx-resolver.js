/**
 * Trigger effects decided at plan time (P4-D2: the roller's rules decide, the viewer filters).
 *
 * Privacy (G1): this resolver is only ever reached through `decorateFor`, which the message gate
 * and showForRoll call for `real` views only (a ghost view uses the ghost decorator, a `none`
 * view is not planned). So nothing result-dependent (effect, result sound, slow motion, macro)
 * is ever computed for a die the current user may not see. Keep it that way: never call
 * `decorate` from anywhere a ghost or none view could reach.
 */
import { normalizeRules, matchRule, effectiveRules, dsnDefaultsToRules, setRules } from './rules.js';
import { outcomeOf, roleOf, damageTypesByTerm, KNOWN_DAMAGE_TYPES } from './roll-context.js';
import { getShape, dieTypeForFaces, dsnTypeOf } from '../core/dice-shapes.js';
import { findTheme, readThemeList } from '../themes/themes.js';

/**
 * @typedef {{ ruleId: string, effect: object|null, sound: object|null, macro: string|null,
 *   slowMotion: boolean, value: number, type: string }} Fx
 *   `macro` is set only on the roller's client with triggerMacros on; `value` / `type` are the
 *   matched result (a d100's full 1-100 result and 'd100') for the macro's arguments.
 */

/** Effect ids that slow the landing down (when the slowMotion setting is on). */
export const FX_SLOW_EFFECTS = ['celebrate', 'fumble'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The face label text showing `value`: FaceSet labels are indexed like getShape(type).values. */
function labelOf(faces, baseType, value) {
  if (!Array.isArray(faces?.labels) || !baseType) return undefined;
  let values;
  try {
    values = getShape(baseType).values;
  } catch {
    return undefined;
  }
  const i = values.indexOf(value);
  const text = i >= 0 ? faces.labels[i]?.text : undefined;
  return typeof text === 'string' ? text : undefined;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * @param {object} deps
 * @param {() => unknown} deps.getWorldRules the raw worldTriggers setting
 * @param {(userId: string) => unknown} deps.getUserRules the raw `dicer.triggers` flag of a user
 * @param {() => object[]} [deps.getModuleRules] already normalized module rules (DSN defaults)
 * @param {() => string[]} [deps.getDisabledModuleRules] ids of module rules the GM switched off
 * @param {() => {id?: string}|undefined} deps.currentUser
 * @param {(key: string) => unknown} deps.getSetting
 * @param {(term) => string|null} [deps.shapeFor] base shape of a custom die type
 * @param {() => Set<string>} [deps.getKnownDamageTypes]
 * @param {() => unknown} [deps.getWorldThemes] the raw worldThemes setting (a die's theme rules)
 * @param {(userId: string) => unknown} [deps.getUserThemes] the raw `dicer.themes` flag of a user
 * @param {(roll: object, rollerId?: string) => (((term, index: number) => object | null) | null)} [deps.damageThemeFor]
 *   the roll's damage themer; its theme's `landing` becomes an extra fx per die of that type
 */
export function createFxResolver({
  getWorldRules,
  getUserRules,
  getModuleRules = () => [],
  getDisabledModuleRules = () => [],
  currentUser,
  getSetting,
  shapeFor = () => null,
  getKnownDamageTypes = () => KNOWN_DAMAGE_TYPES,
  damageThemeFor = () => null,
  getWorldThemes = () => [],
  getUserThemes = () => undefined,
  warn = console.warn,
}) {
  /** cache key -> { raw, json, rules }: settings and flags are normalized once per value. */
  const cache = new Map();
  const warned = new Set();
  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(msg);
  };

  function normalized(key, source, raw) {
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.rules;
    let json;
    try {
      json = JSON.stringify(raw ?? null);
    } catch {
      json = undefined;
    }
    if (hit && json !== undefined && hit.json === json) {
      hit.raw = raw;
      return hit.rules;
    }
    let rules = [];
    if (raw === undefined || raw === null) rules = [];
    else if (!Array.isArray(raw))
      warnOnce(`${key}:${json}`, `Dicer: ignoring malformed trigger rules (${key})`);
    else rules = normalizeRules(raw, source, warn);
    cache.set(key, { raw, json, rules });
    return rules;
  }

  const setting = (k) => safe(() => getSetting(k), undefined);

  /** The world's `damageTypeSounds` entry for a type as a rule sound, or null (absent or malformed). */
  function customSoundOf(type) {
    if (typeof type !== 'string') return null;
    const all = setting('damageTypeSounds');
    if (!isObj(all) || !Object.hasOwn(all, type)) return null;
    const entry = all[type];
    if (!isObj(entry) || typeof entry.src !== 'string' || !entry.src) return null;
    const sound = { src: entry.src };
    if (Number.isFinite(entry.volume)) sound.volume = Math.max(0, Math.min(1, entry.volume));
    return sound;
  }

  /** The theme a die resolved to: built-in/world, else the roller's own list (the roller's rules decide, P4-D2). */
  function themeById(themeId, rollerId) {
    const list = (raw, source) => safe(() => readThemeList(raw, source, warn), []);
    return safe(
      () =>
        findTheme(themeId, {
          worldThemes: list(safe(getWorldThemes, []), 'world'),
          userThemes: rollerId ? list(safe(() => getUserThemes(rollerId), undefined), 'user') : [],
        }),
      null,
    );
  }

  function rulesFor(rollerId, themeRules, keepMacros = false) {
    const world = normalized('world', 'world', safe(getWorldRules, null));
    const roller = rollerId
      ? normalized(
          `user:${rollerId}`,
          'user',
          safe(() => getUserRules(rollerId), null),
        )
      : [];
    const mods = safe(getModuleRules, []);
    const off = safe(getDisabledModuleRules, []);
    const module = Array.isArray(mods)
      ? Array.isArray(off) && off.length
        ? mods.filter((r) => !off.includes(r?.id))
        : mods
      : [];
    if (!themeRules?.length) return effectiveRules({ world, roller, module });
    // P5-D4: a theme rule replaces the world rule with the same id, for this theme's dice only.
    // P5-R9: the replaced rule's macro still runs (roller-only): the theme replaces effect and sound.
    const ids = new Set(themeRules.map((r) => r.id));
    const kept = world.flatMap((r) => {
      if (!ids.has(r.id)) return [r];
      return keepMacros && typeof r.macro === 'string' && r.macro
        ? [{ ...r, effect: null, sound: null }]
        : [];
    });
    return effectiveRules({
      world: kept,
      roller,
      module,
      theme: themeRules,
    });
  }

  return {
    /**
     * A decorator for planThrow: `(term, result, termIndex, look?) => {fx?, damageType?}`.
     * `look` is the look resolver's partial for the same die (its faces give label rules).
     * `damageType` follows damagePresets only. The fx (rules and the theme's landing) are absent
     * when effects are off, or the roll is another user's and showOthersEffects is off.
     * `speaker` stands in for the message's speaker on the showForRoll / animateRoll path.
     */
    decorate(message, roll, authorId, speaker = null) {
      const me = safe(currentUser, undefined)?.id ?? null;
      const rollerId = message?.author?.id ?? authorId ?? null;
      // P4-R7: the damage type is not an effect. It follows damagePresets alone; the effects and
      // showOthersEffects settings gate only the fx (trigger rules and the theme's landing).
      const presets = setting('damagePresets') !== false;
      const fxOn =
        setting('effects') !== false && (rollerId === me || setting('showOthersEffects') !== false);
      // Macros run on the roller's client whatever that client's effects setting says.
      const macros = rollerId !== null && rollerId === me && setting('triggerMacros') !== false;
      if (!presets && !fxOn && !macros) return undefined;

      const rules = fxOn || macros ? rulesFor(rollerId) : [];
      /** "themeId|system" -> its effective rules; one without rules shares `rules`. */
      const themed = new Map();
      // A module dice set's own natural 20 / natural 1 effects (rules.js setRules) count as its
      // theme's rules, over the theme's own of the same id.
      const petVolumes = new Map(); // themeId -> its pets.volume
      const petVolumeOf = (themeId) => {
        if (!themeId) return undefined;
        if (!petVolumes.has(themeId)) petVolumes.set(themeId, themeById(themeId, rollerId)?.pets?.volume);
        return petVolumes.get(themeId);
      };
      const rulesOf = (themeId, system) => {
        if (!(fxOn || macros)) return rules;
        const key = themeId + system;
        if (!themed.has(key)) {
          const own = themeById(themeId, rollerId)?.rules;
          const all = setRules.of?.(system, own, rollerId) ?? own;
          themed.set(key, all?.length ? rulesFor(rollerId, all, macros) : rules);
        }
        return themed.get(key);
      };
      const themeOf = presets ? safe(() => damageThemeFor(roll, rollerId ?? undefined), null) : null;
      const outcome = safe(() => outcomeOf(roll, message), null);
      const role = safe(() => roleOf(message), null);
      const formula = safe(() => roll?.formula, undefined);
      const speakerActor = safe(() => message?.speaker?.actor ?? speaker?.actor, undefined);
      const speakerToken = safe(() => message?.speaker?.token ?? speaker?.token, undefined); // a moment on the roller's token
      const damage = safe(() => damageTypesByTerm(roll, getKnownDamageTypes()), new WeakMap());
      const slow = setting('slowMotion') !== false;

      return (term, result, termIndex, look) => {
        const out = {};
        // The theme's pet volume (registerTheme's `pets.volume`), only where this viewer gets the theme's
        // effects: whoever hears no theme sound keeps the pets as they are.
        const petVol = fxOn ? petVolumeOf(look?.themeSource === 'viewer' ? undefined : look?.themeId) : undefined;
        if (petVol !== undefined) out.petVolume = petVol;
        const damageType = isObj(term) ? damage.get(term) : undefined;
        if (presets && typeof damageType === 'string') out.damageType = damageType;
        const theme = fxOn && themeOf ? safe(() => themeOf(term, termIndex), null) : null;
        // P4-R2: the GM's custom sound for this damage type replaces the theme's landing sound.
        const custom = theme ? customSoundOf(damageType) : null;
        const landing = theme?.landing ?? null;
        // A discarded or inactive result (dropped, rerolled away) never triggers anything.
        const dead = result?.active === false || result?.discarded === true;
        if (fxOn) out.trail = dead ? 1 : 2;
        if (dead) return out;
        // A theme chosen by the viewer's own damage override never brings its rules (the roller's decide).
        const dieRules = rulesOf(look?.themeSource === 'viewer' ? undefined : look?.themeId, look?.system);
        if (!dieRules.length && !landing && !custom) return out;
        const value = result?.result;
        const faces = term?.faces;
        const dsnType = (typeof look?.dsnType === 'string' && look.dsnType) || dsnTypeOf(term);
        // A Fate die stays 'df' even when a DSN preset aliases it onto the d6: a "d6 max" rule
        // must never fire on a +1.
        const base =
          faces === 100 || dsnType === 'df' ? null : (safe(() => shapeFor(term), null) ?? dieTypeForFaces(faces));
        const type = faces === 100 ? 'd100' : (base ?? dsnType);
        // Foundry's DiceTerm#minValue (FateDie: -1); JSON or legacy terms may lack it.
        const min = Number.isInteger(term?.minValue) ? term.minValue : dsnType === 'df' ? -1 : 1;
        const actorId =
          (typeof speakerActor === 'string' && speakerActor) || term?.options?.dsnActorId;
        const die = {
          type,
          dsnType,
          value,
          faces,
          min,
          max: min + faces - 1,
          label: labelOf(look?.faces, base, value),
          formula,
          role,
          damageType,
          actorId: typeof actorId === 'string' ? actorId : undefined,
          userId: rollerId ?? undefined,
          outcome,
        };
        const fx = [];
        if (landing || custom) {
          fx.push({
            ruleId: `damage:${theme.id ?? damageType}`,
            effect: landing?.effect ? { ...landing.effect } : null, // bleed and physical land with a sound only
            sound: custom ?? (landing?.sound ? { ...landing.sound } : null),
            macro: null,
            slowMotion: false,
            value,
            type: dsnType ?? type,
          });
        }
        for (const rule of dieRules) {
          if (!fxOn && !(typeof rule.macro === 'string' && rule.macro)) continue;
          if (!safe(() => matchRule(rule, die), false)) continue;
          if (!fxOn) {
            // Effects off: the roller's macro still runs, with no effect, sound or slow motion.
            fx.push({
              ruleId: rule.id,
              effect: null,
              sound: null,
              macro: rule.macro,
              slowMotion: false,
              value,
              type: dsnType ?? type,
            });
            continue;
          }
          const effect = rule.effect ?? null;
          fx.push({
            ruleId: rule.id,
            effect,
            sound: rule.sound ?? null,
            moment: rule.moment ?? null,
            token: speakerToken,
            user: rollerId, // who rolled it (a crit scene's title card names them)
            macro: macros ? (rule.macro ?? null) : null,
            // not with a crit scene: it starts as the die stops (slow motion would hold a still die)
            slowMotion:
              slow &&
              Boolean(
                effect && !effect.scene && (FX_SLOW_EFFECTS.includes(effect.id) || effect.slowMotion === true),
              ),
            value,
            type: dsnType ?? type,
          });
        }
        if (fx.length) out.fx = fx;
        return out;
      };
    },
  };
}

/**
 * The module rules (Dice So Nice `addSFXDefaults`) of a registry, normalized once per change of
 * the defaults or triggers. Warnings are deduplicated across recomputations.
 */
/**
 * Dicer's own ready-made rules, listed with the module rules (a GM switches each off in the
 * trigger editor): attack d20s glint as they land; with Animater active, a natural crit pulses the
 * screen gold and a fumble shakes it (Animater moments, played from the active GM's view).
 */
export function dicerRules({ animater = false } = {}) {
  const rules = [{ id: 'dicer-attack-glint', name: 'Attack dice glint', die: 'd20', context: { role: 'attack' }, effect: { id: 'glint' } }];
  if (animater)
    rules.push(
      { id: 'dicer-animater-crit', name: 'Animater: critical success', die: 'd20', outcome: 'critical-success', moment: { kind: 'pulse', colour: '#ffcf4a', strength: 0.35 } },
      { id: 'dicer-animater-fumble', name: 'Animater: critical failure', die: 'd20', outcome: 'critical-failure', moment: { kind: 'shake', strength: 0.35 } },
    );
  return normalizeRules(rules, 'module');
}

/** Animater is on and can play moments (its api.moment: older versions have none). */
export const animaterMoments = () =>
  safe(() => {
    const m = globalThis.game?.modules?.get?.('animater');
    return m?.active === true && typeof m.api?.moment === 'function';
  }, false);
const animaterActive = animaterMoments;

export function moduleRulesOf(registry, warn = console.warn, { hasAnimater = animaterActive } = {}) {
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    warn(msg);
  };
  let key;
  let rules = [];
  return () => {
    const defaults = safe(() => registry.getSFXDefaults(), []);
    const triggers = registry?.sfxTriggers;
    const animater = hasAnimater();
    let next;
    try {
      next = JSON.stringify([defaults, triggers ? [...triggers.values()] : [], animater]);
    } catch {
      next = undefined;
    }
    if (next !== undefined && next === key) return rules;
    key = next;
    rules = [...safe(() => dsnDefaultsToRules(defaults, triggers, warnOnce), []), ...dicerRules({ animater })];
    return rules;
  };
}

/**
 * main.js's `decorateFor(message, roll, authorId, rollerId?)`: the look resolver's partial first,
 * the fx resolver's merged last without overriding any look field. `authorId` picks the look;
 * `rollerId` (the verified sender of a synchronized roll) picks the rules, else the author.
 * A throwing fx decorator warns once and leaves the look intact.
 */
export function composeDecorateFor({ looks, fx, warn = console.warn }) {
  let warned = false;
  return (message, roll, authorId, rollerId, speaker = null) => {
    const lookDec = looks?.decorate(message, roll, authorId, speaker);
    let fxDec;
    try {
      fxDec = fx?.decorate(message, roll, rollerId ?? authorId, speaker);
    } catch (err) {
      fxDec = undefined;
      if (!warned) {
        warned = true;
        warn('dicer: cannot resolve trigger effects', err);
      }
    }
    if (!fxDec) return lookDec;
    return (term, result, termIndex) => {
      const look = (lookDec ? lookDec(term, result, termIndex) : undefined) ?? {};
      let extra;
      try {
        extra = fxDec(term, result, termIndex, look);
      } catch (err) {
        if (!warned) {
          warned = true;
          warn('dicer: cannot resolve trigger effects', err);
        }
      }
      return extra ? { ...extra, ...look } : look;
    };
  };
}

/**
 * DiceBox's `onLandedFx(die, fx, rollKey)`: plays each fx sound (never awaited) and runs each
 * macro at most once per rule per `rollKey` (one object per DiceBox roll). The fx resolver only
 * leaves `macro` set on the roller's client with triggerMacros on. Failures warn once per
 * source and never throw.
 */
export function createLandedFx({ playSound, fromUuid, playMoment = () => {}, onSound = () => {}, warn = console.warn }) {
  const ran = new WeakMap(); // rollKey -> Set<ruleId>
  const warned = new Set();
  const warnOnce = (key, ...args) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(...args);
  };

  function runMacro(f) {
    Promise.resolve()
      .then(() => fromUuid(f.macro))
      .then((macro) => {
        if (typeof macro?.execute !== 'function') throw new Error(`no macro ${f.macro}`);
        return macro.execute({ dicer: { value: f.value, type: f.type, ruleId: f.ruleId } });
      })
      .catch((err) => warnOnce(`macro:${f.macro}`, `Dicer: trigger macro ${f.macro} failed`, err));
  }

  return (die, fx, rollKey) => {
    if (!Array.isArray(fx)) return;
    for (const f of fx) {
      if (!isObj(f)) continue;
      if (f.sound) {
        try {
          onSound(f.sound.builtin ?? (f.sound.src !== undefined ? String(f.sound.src) : undefined));
          const p = playSound(f.sound);
          if (p && typeof p.catch === 'function')
            p.catch((err) => warnOnce(`sound:${f.ruleId}`, 'Dicer: result sound failed', err));
        } catch (err) {
          warnOnce(`sound:${f.ruleId}`, 'Dicer: result sound failed', err);
        }
      }
      const once = (what) => {
        const key = isObj(rollKey) ? rollKey : null;
        if (!key) return true;
        if (!ran.has(key)) ran.set(key, new Set());
        const done = ran.get(key);
        if (done.has(`${what}:${f.ruleId}`)) return false;
        done.add(`${what}:${f.ruleId}`);
        return true;
      };
      // An Animater moment: once per roll and rule, however many of its dice matched. A preview's
      // (f.preview) plays on the GM who clicked it, not only the active GM: no one else sees it.
      if (isObj(f.moment) && once('moment')) {
        try {
          playMoment(f.moment, f.preview, die, f.token);
        } catch (err) {
          warnOnce(`moment:${f.ruleId}`, 'Dicer: Animater moment failed', err);
        }
      }
      if (typeof f.macro === 'string' && f.macro && once('macro')) runMacro(f);
    }
  };
}
