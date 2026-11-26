/**
 * Decides what each die looks like. The first matching rule wins, per term:
 *   1. term.options.appearance   2. term.options.colorset
 *   3. the damage theme of the term's damage type (P4-D3; also sets soundMaterial): the viewer's own
 *      override, else the damage looks of the theme the die would wear (its own `damage` map), else the world's
 *   3b. the term's flavor as a colorset name (only with no damage theme: a [fire] damage die is themed)
 *   4. the actor's dicer.appearance (options.dsnActorId, else the speaker's actor)   5. the roller's dicer.appearance
 *      (role:<role> when the message has one, die type, base shape, then global)
 *   6. DEFAULT_APPEARANCE.
 * Refs at steps 4-5 may name a theme (Plan 5): built-in, the world's (worldThemes) or the
 * roller's own (user flag dicer.themes). The theme gives the die type's look, its id (themeId)
 * and its sound material when no damage theme set one. A missing theme warns once per roller.
 * The GM's world default theme (worldDefaultTheme) is the fallback after the roller's own refs
 * and before DEFAULT_APPEARANCE; with lockPlayerLooks on, a non-GM roller's refs and actor flags
 * are skipped and the world default is used instead (P7-D4).
 * A roller who has their dice follow Ember's moons (registry.moonRef) gets the moon's dice set as
 * the system of their global ref (rule 5: moonRef(user, looks) writes it); refs for a die type, a role or an actor are untouched.
 * A registered preset for the ref's system replaces rules 5-6 (its colorset) and attaches its
 * model. Everything read here is third-party data: no step may throw.
 */
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../look/appearance.js';
import {
  isPlainObject,
  isNeverChose,
  readUserLooks,
  lookRefToAppearance,
  colorsetNameToAppearance,
} from './user-looks.js';
import { readThemeList, findTheme } from '../themes/themes.js';
import { PROVIDERS, flagChoice, providedTheme } from '../api/theme-registry.js';
import { roleOf } from '../effects/roll-context.js';
import { dsnTypeOf } from '../core/dice-shapes.js';

const STANDARD = 'standard';
const FALLBACK_REF = { look: 'default' }; // what readUserLooks supplies when a user has no global

/**
 * The Dice So Nice die type of a term: 'd20', or 'd' + the bare-letter DENOMINATION of a custom
 * die ('c' gives 'dc', 'f' gives 'df'), which is how DSN presets name them.
 */

const systemOf = (v) => (isPlainObject(v) && typeof v.system === 'string' && v.system ? v.system : null);

/**
 * @param {object} deps
 * @param {object} deps.registry
 * @param {(id: string) => object | undefined} deps.getUser
 * @param {(id: string) => object | undefined} [deps.getActor]
 * @param {(preset: object) => object | undefined} [deps.facesFor] the Task 5 seam: a preset's FaceSet
 * @param {(roll: object, authorId?: string) => (((term, index: number) => object | null) | null)} [deps.damageThemeFor]
 *   a roll's damage themer (createDamageThemer.forRoll); null when damagePresets is off
 * @param {() => unknown} [deps.getWorldThemes] the raw worldThemes setting
 * @param {() => string} [deps.getWorldDefaultTheme] the worldDefaultTheme setting ('' = none)
 * @param {() => boolean} [deps.getLockPlayerLooks] the lockPlayerLooks setting
 * @param {() => boolean} [deps.damageOverDiceSet] the damageOverDiceSet setting: a damage-themed die
 *   drops the player's dice set (its models and faces); false keeps them
 * @param {(msg: string, err?: unknown) => void} [deps.warn]
 */
export function createLookResolver({
  registry,
  getUser,
  getActor = () => undefined,
  // the speaking token's actor (an unlinked token's synthetic actor carries its own changes: a
  // summoned thrall's flags, a choice set on that token only)
  getTokenActor = (scene, token) => globalThis.game?.scenes?.get?.(scene)?.tokens?.get?.(token)?.actor ?? null,
  facesFor = () => undefined,
  damageThemeFor = null,
  getWorldThemes = () => [],
  getWorldDefaultTheme = () => '',
  getLockPlayerLooks = () => false,
  damageOverDiceSet = () => true,
  warn = console.warn,
}) {
  let warned = false;
  const warnOnce = (err) => {
    if (warned) return;
    warned = true;
    try {
      warn('dicer: cannot resolve a die look; using the default', err);
    } catch {
      /* a throwing logger must not reach the roll */
    }
  };

  const safeWarn = (msg) => {
    try {
      warn(msg);
    } catch {
      /* a throwing logger must not reach the roll */
    }
  };
  const missingWarned = new Set();
  /**
   * Per roll and author: the user, the theme lists their refs may name, and the once-per-roller
   * missing-theme warning.
   */
  function themeContext(authorId) {
    const user = getUser(authorId);
    let worldThemes = [];
    let userThemes = [];
    try {
      worldThemes = readThemeList(getWorldThemes(), 'world', safeWarn);
    } catch {
      /* no world themes */
    }
    try {
      const raw = typeof user?.getFlag === 'function' ? user.getFlag('dicer', 'themes') : user?.flags?.dicer?.themes;
      userThemes = readThemeList(raw, 'user', safeWarn);
    } catch {
      /* no user themes */
    }
    let worldDefault = null;
    let locked = false;
    try {
      const id = getWorldDefaultTheme();
      if (typeof id === 'string' && id) {
        worldDefault = { theme: id };
        locked = Boolean(getLockPlayerLooks()) && user?.isGM !== true;
      }
    } catch {
      /* no world default */
    }
    return {
      user,
      worldDefault,
      locked,
      themes: { worldThemes, userThemes },
      onMissingTheme: (themeId) => {
        const key = `${authorId}|${themeId}`;
        if (missingWarned.has(key)) return;
        missingWarned.add(key);
        safeWarn(`Dicer: theme "${themeId}" no longer exists; using the next look`);
      },
    };
  }

  /** A colorset from a preset (a name, or a list of names picked by index). */
  function presetAppearance(preset, index) {
    const cs = Array.isArray(preset.colorset)
      ? preset.colorset[((index % preset.colorset.length) + preset.colorset.length) % preset.colorset.length]
      : preset.colorset;
    return colorsetNameToAppearance(cs, registry, index);
  }

  function resolve(term, ctx, index, themeOf, role, speakerActorId, tokenActor) {
    const type = dsnTypeOf(term);
    const options = isPlainObject(term?.options) ? term.options : {};
    // The term's own actor, else the speaker's (showForRoll / animateRoll, which have no message).
    // A token-linked speaker names its base actor, whose flags getActor returns; the speaking
    // token's own actor (tokenActor: an unlinked token's synthetic one) goes first when the term
    // names none.
    const ownId = typeof options.dsnActorId === 'string';
    const actorId = ownId ? options.dsnActorId : speakerActorId;
    let appearance = null;
    let system = null;

    if (isPlainObject(options.appearance)) {
      // a Dice So Nice appearance naming a colorset wears it (an add-on's {system, colorset})
      appearance =
        colorsetNameToAppearance(options.appearance.colorset, registry, index) ?? normalizeAppearance(options.appearance);
      system = systemOf(options.appearance);
    }
    if (!appearance) {
      appearance = colorsetNameToAppearance(options.colorset, registry, index);
    }
    // The damage theme (P4-D3): after explicit colorsets, before actor/user looks. It also beats a
    // flavor colorset: PF2e and 5e flavor each damage die with its type ([fire]), which would
    // otherwise match the flat built-in colorset of that name.
    // The author's refs, most specific first. They feed rule 5 and, for every rule, the system.
    // Under the lock the world default replaces every ref of the author's; otherwise it follows
    // them, ahead of the built-in default that readUserLooks supplies for a user with no global.
    const looks = ctx.locked ? {} : readUserLooks(ctx.user, { fill: false });
    // A mirrored "never chose" default is no choice: the world default may apply.
    if (isNeverChose(looks.global)) delete looks.global;
    // A roller whose default dice follow Ember's moons (installed-dice.js sets registry.moonRef once
    // Ember Lunar Dice are loaded): it puts the moon's set in their global ref; their look stays.
    if (!ctx.locked) registry.moonRef?.(ctx.user, looks);
    const shape = type ? registry.baseShape?.(type) : null;
    const keys = [role ? `role:${role}` : null, type, shape, 'global'];
    const refs = keys.map((key) => (key && Object.hasOwn(looks, key) ? looks[key] : null)).filter(Boolean);
    if (ctx.worldDefault) refs.push(ctx.worldDefault);
    if (!ctx.locked && !Object.hasOwn(looks, 'global')) refs.push(FALLBACK_REF);
    // The theme browser writes {global: {theme}}; DSN-migrated flags are a flat LookRef. A
    // global slot takes precedence over flat keys left on the same actor.
    const actor = ctx.locked ? null : (!ownId && tokenActor) || (typeof actorId === 'string' ? getActor(actorId) : null);
    let stored = actor?.flags?.dicer?.appearance;
    // an actor nobody picked dice for: a module's default (theme-registry.js providers), never written
    if (actor && PROVIDERS.size && !flagChoice(stored)) {
      const id = providedTheme(actor);
      if (id) stored = { global: { theme: id } };
    }
    const actorRef = isPlainObject(stored) && isPlainObject(stored.global) ? stored.global : stored;
    // the theme the die would wear (the actor's, else the author's first ref): its own damage looks
    const ownRef = [actorRef, ...refs].find(isPlainObject);
    const themeMap = typeof ownRef?.theme === 'string' ? findTheme(ownRef.theme, ctx.themes)?.damage : undefined;

    let soundMaterial;
    let themed = null; // the Plan 5 theme the die resolved to: {themeId, soundMaterial?, ...}
    const theme = appearance ? null : themeOf?.(term, index, themeMap);
    if (theme?.appearance) {
      appearance = theme.appearance;
      soundMaterial = theme.soundMaterial;
      if (theme.themeId) themed = { themeId: theme.themeId, ...(theme.themeSource ? { themeSource: theme.themeSource } : {}) };
    }
    if (!appearance && typeof term?.flavor === 'string') {
      const flavor = term.flavor.trim();
      const named = flavor.toLowerCase().startsWith('die:') ? flavor.slice(4).trim() : flavor;
      appearance = colorsetNameToAppearance(named, registry, index);
    }
    const refOpts = { dieType: type, themes: ctx.themes, onMissingTheme: ctx.onMissingTheme };
    // a ref's system, else its theme's (a theme imported from a module dice set keeps the set's system)
    const sysOf = (r) => systemOf(r) ?? systemOf(findTheme(r?.theme, ctx.themes));
    if (!appearance && stored !== undefined) {
      const ref = actorRef;
      const got = lookRefToAppearance(ref, registry, index, refOpts);
      if (got) {
        appearance = got.appearance;
        themed = got;
      }
      // a module dice set's system on its own (no look): the author's looks dress the dice it skips
      system = sysOf(ref);
    }

    // damageOverDiceSet: a damage-themed die keeps its damage look, so the player's dice set (a
    // module set's 3D models and faces, whose own material would hide it) is not taken from their
    // refs. A system the roll names itself (options.appearance) still applies.
    const damageWins = !!theme?.appearance && damageOverDiceSet() !== false;
    if (system === null && !damageWins) system = refs.map(sysOf).find(Boolean) ?? null;

    const preset = type ? registry.presetFor?.(system ?? STANDARD, type) : null;
    if (!appearance) {
      // Rules 5-6: the preset's colorset replaces the author's look, then the default.
      const fromPreset = preset?.colorset ? presetAppearance(preset, index) : null;
      if (fromPreset) appearance = fromPreset;
      else {
        for (const ref of refs) {
          themed = lookRefToAppearance(ref, registry, index, refOpts);
          if (themed) break;
        }
        appearance = themed?.appearance ?? DEFAULT_APPEARANCE;
      }
    }

    const out = { appearance };
    if (type) out.dsnType = type;
    // DiceBox finds the preset again by system + dsnType (diceSoNiceOnMaterialReady, P3-R3).
    out.system = preset?.system ?? system ?? STANDARD;
    if (themed?.themeId) out.themeId = themed.themeId;
    if (themed?.themeId && themed.themeSource) out.themeSource = themed.themeSource;
    soundMaterial ??= themed?.soundMaterial;
    if (soundMaterial) out.soundMaterial = soundMaterial;
    if (preset) {
      // A bad preset loses its faces (the dice show numbers), never the look.
      let faces;
      try {
        faces = facesFor(preset);
      } catch (err) {
        warnOnce(err);
      }
      if (faces !== undefined) out.faces = faces;
      // A d100 preset dresses its tens die; the ones die wears the system's d10 (throw-planner).
      if (type === 'd100') {
        try {
          const ones = registry.presetFor?.(out.system, 'd10');
          const onesFaces = ones ? facesFor(ones) : undefined;
          if (onesFaces !== undefined) out.onesFaces = onesFaces;
        } catch (err) {
          warnOnce(err);
        }
      }
      // The routed url (registry routeUrl): the one the registry and DiceBox both load.
      if (preset.modelFile) out.model = preset.modelUrl ?? preset.modelFile;
    }
    return out;
  }

  return {
    /** @returns {(term, result, termIndex) => object} a decorator for planThrow */
    decorate(message, roll, authorId, speaker = null) {
      const author = authorId ?? message?.author?.id;
      // the speaker showForRoll / animateRoll hand over, else the chat message's own (a sheet roll)
      const sp = speaker ?? message?.speaker;
      const who = speaker?.actor ?? message?.speaker?.actor;
      const speakerActorId = typeof who === 'string' ? who : undefined;
      let tokenActor = null;
      try {
        if (typeof sp?.token === 'string' && typeof sp.scene === 'string') tokenActor = getTokenActor(sp.scene, sp.token);
      } catch {
        /* no token: the base actor */
      }
      let role = null;
      try {
        role = roleOf(message); // null on the showForRoll path (no message)
      } catch {
        /* no role */
      }
      let themeOf = null;
      try {
        themeOf = damageThemeFor?.(roll, author) ?? null;
      } catch (err) {
        warnOnce(err);
      }
      let ctx = null; // read on the first die, so a throwing user lookup fails per die
      return (term, result, termIndex = 0) => {
        try {
          ctx ??= themeContext(author);
          return resolve(term, ctx, termIndex, themeOf, role, speakerActorId, tokenActor);
        } catch (err) {
          warnOnce(err);
          return { appearance: DEFAULT_APPEARANCE };
        }
      };
    },

    /** The base shape of the term's die type, or null (d100 and unknown shapes are not handled here). */
    shapeFor(term) {
      try {
        const type = dsnTypeOf(term);
        return type ? registry.baseShape(type) : null;
      } catch {
        return null;
      }
    },
  };
}
