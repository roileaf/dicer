/**
 * Dice from installed modules that are not active in this world (lazy chunk). A dice-set module
 * registers its dice in a `diceSoNiceReady` hook, which only runs when the module is active; this
 * runs such a module's scripts with a stand-in `Hooks` that keeps only the Dice So Nice hooks, then
 * calls those with game.dice3d. Only modules whose scripts do nothing else are offered (a module that
 * also registers settings, other hooks, wrappers or globals is not run unasked: its other work would
 * happen while it is off; the GM can pick such a module as dice only, and its other hooks are then
 * never called, though its top-level code runs). The GM picks them (ui/installed-dice.js); the world setting `installedDice`
 * holds each pick's id, title and script paths, so every client loads the same scripts.
 */
import { BufferAttribute, Quaternion } from 'three';
import { normalizeRule, setRules } from '../effects/rules.js';
import { addonTextures, loadNormal } from '../render/extras/addon-textures.js';

const DSN_HOOKS = ['diceSoNiceInit', 'diceSoNiceReady'];
const MENTIONS = /diceSoNice(?:Init|Ready)/;
const REGISTERS = /\.\s*add(?:System|DicePreset|Colorset|Texture|DiceShape)\s*\(/;
// a hook other than Dice So Nice's
const OTHER_HOOK = /Hooks\s*\.\s*(?:on|once)\s*\(\s*(['"`])(?!diceSoNice(?:Init|Ready)\1)/;
// work beyond registering dice: settings, keybindings, wrappers, CONFIG writes, globals, more code
const OTHER_WORK =
  /game\s*\.\s*(?:settings|keybindings)\s*\.\s*register|libWrapper|\bCONFIG\s*(?:\.\s*[\w$]+|\[[^\]]*\])+\s*=(?!=)|\bimport\s*\(|\bglobalThis\b|\bwindow\s*\.|\bdocument\s*\.|\bfetch\s*\(|\beval\s*\(/;
const DSN_ID = 'dice-so-nice';
const SKIP = new Set(['dicer', DSN_ID]);
const LUNAR_DICE = 'ember-lunar-dice';
const MOON_SET = /^trs-ember-[\w-]+-dice-set$/; // Ember Lunar Dice's system ids, a moon each
const emberCalendar = () => globalThis.ember?.calendar ?? globalThis.game?.time?.calendar;

/** The user flag of a player whose default dice follow Ember's moons (the theme browser's box). */
export const MOON_DICE = 'moonDice';

/**
 * The dice set a player's default dice are right now, when they follow Ember's moons (their
 * `dicer.moonDice` flag): the set of the moon with the most influence at the world's time (Ember's
 * own measure: 0 below the horizon, 1 at its height, "full" above 0.75), among the sets that are
 * loaded (`has(systemId)`). Null when they do not follow the moons, no moon is up, or without
 * Ember: their own dice. Worked out from the world time, not from Ember's animated sky, so every
 * client gives the same set for the same roll. Never throws.
 */
export function moonSystemFor(user, { calendar = emberCalendar, has = () => true, now = () => globalThis.game?.time?.worldTime } = {}) {
  try {
    if (user?.getFlag?.('dicer', MOON_DICE) !== true) return null;
    const moons = calendar()?.moons;
    if (!moons || typeof moons !== 'object') return null;
    const t = now();
    let best = null;
    let top = 0;
    for (const moon of Object.values(moons)) {
      const id = `trs-ember-${moon?.id}-dice-set`;
      const influence = typeof moon?.animate === 'function' ? moon.animate(t)?.influence : moon?.influence;
      if (influence > top && has(id)) {
        top = influence;
        best = id;
      }
    }
    return best;
  } catch {
    return null;
  }
}
// an ES module that imports its own files (an add-on's dice may be added there, not in its entry)
const IMPORTS_OWN = /(?:^|[;\n])\s*import\s[^;]*?from\s*(['"])\.{1,2}\//;
// a dynamic import of another module's script (`import(\`/modules/<id>/index.js\`)`, or a path constant)
const LOADS_OTHER = /\bimport\s*\(/;
const NAMES_MODULE_SCRIPT = /modules\/[\w.${}-]+\/[\w./-]*\.m?js/;
const SAFE_PATH =/^modules\/[\w.-]+\/[^:?#]+\.m?js$/i;

const loaded = new Set(); // module ids whose dice this page has loaded

/** A script's text (a failed fetch throws). */
export async function fetchText(path) {
  const res = await fetch(globalThis.foundry?.utils?.getRoute?.(path) ?? path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.text();
}
const activeNow = (id) => globalThis.game?.modules?.get?.(id)?.active === true;

/** A module's own files from one manifest list (`modules/<id>/…` scripts only, never another host). */
const ownFiles = (id, list) =>
  [...(list ?? [])]
    .map((p) => String(p).replace(/^\/+/, ''))
    .filter((p) => SAFE_PATH.test(p) && p.startsWith(`modules/${id}/`) && !p.includes('..'));

/** A module's script paths Dicer will fetch: its own files only (`modules/<id>/…`), never another host. */
export const scriptsOf = (mod) => [...ownFiles(mod?.id, mod?.esmodules), ...ownFiles(mod?.id, mod?.scripts)];

/** Whether `source` runs as a plain script (an ES module's import/export, or top-level await, does not). */
function compiles(source) {
  try {
    new Function('Hooks', 'libWrapper', source);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a module's scripts are: 'ok' (only registers dice), 'none' (no dice), 'other' (does more
 * than register dice) or 'bundle' (an ES module or bundle Dicer cannot run apart from it).
 */
export function classify(texts) {
  const all = texts.join('\n;\n');
  if (!MENTIONS.test(all) || !REGISTERS.test(all)) return 'none';
  if (!texts.every(compiles)) return 'bundle';
  if (OTHER_HOOK.test(all) || OTHER_WORK.test(all)) return 'other';
  return 'ok';
}

/** The module ids a module names in one of its relationships ('requires', 'recommends'). */
function related(mod, kind) {
  const v = mod.relationships?.[kind];
  return v && typeof v[Symbol.iterator] === 'function' ? [...v].map((r) => r?.id) : [];
}

/** Whether a module needs Dice So Nice (a Dice So Nice add-on: Foundry will not activate it while Dice So Nice is off). */
export const needsDsn = (mod) => related(mod, 'requires').includes('dice-so-nice');

/** Whether a module may hold dice: it names Dice So Nice as needed or recommended, or "dice" is in its name. */
function mayHoldDice(mod) {
  return needsDsn(mod) || related(mod, 'recommends').includes('dice-so-nice') || /dice/i.test(`${mod.id} ${mod.title ?? ''}`);
}

/**
 * The inactive installed modules that register dice, each `{id, title, scripts, status}` (status
 * as classify; `addon: true` when it needs Dice So Nice, so loadDsnAddons can run it), sorted by title. `fetchText(path)` reads a script (a failed one skips the module).
 */
export async function scanInstalled({ modules, fetchText }) {
  const mods = [...(modules?.values?.() ?? modules ?? [])].filter(
    (m) => m && !m.active && !SKIP.has(m.id) && mayHoldDice(m),
  );
  const found = await Promise.all(
    mods.map(async (m) => {
      const scripts = scriptsOf(m);
      if (!scripts.length) return null;
      try {
        const texts = await Promise.all(scripts.map(fetchText));
        let status = classify(texts);
        // an add-on whose entry names the Dice So Nice hooks and imports its own files (which add
        // the dice): Dicer cannot read it apart, but can run it in full (loadDsnAddons)
        const all = texts.join('\n;\n');
        if (status === 'none' && needsDsn(m) && MENTIONS.test(all) && IMPORTS_OWN.test(all)) status = 'bundle';
        // a loader add-on: it imports another module's script that adds the dice (the SF2e Playtest
        // Dice Wrapper loads an installed, inactive adventure pack's index.js); run in full too
        if (status === 'none' && needsDsn(m) && LOADS_OTHER.test(all) && NAMES_MODULE_SCRIPT.test(all)) status = 'bundle';
        if (status === 'none') return null;
        const found = { id: m.id, title: m.title || m.id, scripts, status };
        return needsDsn(m) ? { ...found, addon: true } : found;
      } catch {
        return null;
      }
    }),
  );
  return found.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Runs scripts with a stand-in Hooks and calls their Dice So Nice hooks (init, then ready) with
 * `api`. Returns how many hooks ran; throws what the scripts throw.
 */
export async function runDice(texts, api, name = 'module') {
  const caught = Object.fromEntries(DSN_HOOKS.map((h) => [h, []]));
  const keep = (hook, fn) => {
    if (caught[hook] && typeof fn === 'function') caught[hook].push(fn);
    return 0;
  };
  const hooks = { on: keep, once: keep, off() {}, callAll() {}, call: () => true };
  for (const [i, text] of texts.entries())
    new Function('Hooks', 'libWrapper', `${text}\n//# sourceURL=dicer-installed-dice/${name}/${i}.js`)(hooks, undefined);
  const fns = DSN_HOOKS.flatMap((h) => caught[h]);
  for (const fn of fns) await fn(api);
  return fns.length;
}

/**
 * Loads the dice of the picked modules (the `installedDice` setting) not loaded on this page yet,
 * and not active (`isActive(id)`). Each is re-read and re-checked (it may have been updated since
 * it was picked). A pick made as dice only (`diceOnly`: an adventure pack with dice, say) may do
 * more than add dice: only its Dice So Nice hooks are called. Returns the ids loaded now.
 */
export async function loadInstalledDice(
  list,
  { api, fetchText: read = fetchText, isActive = activeNow, warn = (...a) => console.warn(...a), hooks = globalThis.Hooks, calendar },
) {
  const done = [];
  for (const pick of Array.isArray(list) ? list : []) {
    const id = pick?.id;
    // an active module registers its dice itself
    if (typeof id !== 'string' || loaded.has(id) || !Array.isArray(pick.scripts) || isActive(id)) continue;
    const scripts = pick.scripts.filter((p) => typeof p === 'string' && SAFE_PATH.test(p) && p.startsWith(`modules/${id}/`) && !p.includes('..'));
    if (!scripts.length) continue;
    loaded.add(id);
    try {
      const texts = await Promise.all(scripts.map(read));
      const status = classify(texts);
      if (status !== 'ok' && !(status === 'other' && pick.diceOnly === true)) {
        warn(`dicer: the dice of "${pick.title ?? id}" were not loaded (the module now does more than add dice)`);
        continue;
      }
      await runDice(texts, api, id);
      done.push(id);
      if (id === LUNAR_DICE) followEmberMoons({ hooks, dice3d: api, calendar });
    } catch (err) {
      warn(`dicer: cannot load the dice of "${pick.title ?? id}"`, err);
    }
  }
  return done;
}

// Foundry's start hooks: all have fired by the time Dicer loads add-ons (in its ready hook)
const STARTED = new Set(['init', 'i18nInit', 'setup', 'ready']);

/** Runs a plain (non-module) script the way Foundry loads a module's `scripts`; resolves once it ran. */
export function addScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`cannot load ${url}`));
    document.head.append(el);
  });
}

const importModule = (url) => import(/* @vite-ignore */ url);

/**
 * Runs `fn` (synchronously) while `modules.get('dice-so-nice')` reports the installed, inactive
 * Dice So Nice as active: a view over the real module (its version and files stay its own), with
 * `modules.get` restored right after. Nothing changes when Dice So Nice is missing or active.
 * Returns what `fn` returns.
 */
export function withDsnActive(modules, fn) {
  const real = modules?.get?.(DSN_ID);
  if (!real || real.active) return fn();
  const view = Object.create(real, { active: { value: true } });
  const own = Object.hasOwn(modules, 'get');
  const { get } = modules;
  modules.get = function (id, ...rest) {
    return id === DSN_ID ? view : get.call(this, id, ...rest);
  };
  try {
    return fn();
  } finally {
    if (own) modules.get = get;
    else delete modules.get;
  }
}

const shimmed = new WeakSet();
const modes = new Set(); // the special effect ids add-ons registered through the shim
const sets = new Map(); // DSN system id -> its own natural 20 / natural 1 rules (readSetRules)

/** Add-on files that list each dice set's natural 20 and natural 1 effects. */
const SET_LISTS = { 'irl-dice-packs': ['scripts/characters/catalog.js', 'scripts/gm-themes.js'] };

/** The rule a set's own natural `v` (20 or 1) effect becomes: a theme rule (it replaces the world's). */
export const setRule = (v, effect) =>
  normalizeRule(
    {
      id: v === 20 ? 'dicer.nat20' : 'dicer.nat1',
      name: v === 20 ? 'Natural 20' : 'Natural 1',
      die: 'd20',
      result: { kind: 'value', value: v },
      effect: { id: `dsn:${effect}` },
    },
    'theme',
  );

/**
 * Reads which effects a loaded add-on's dice sets play on a natural 20 and a natural 1, where its
 * files list them (SET_LISTS): any exported array of `{systemId or id, effects: [{id, result}]}`
 * (irl-dice-packs' characters and GM themes). Its Special Effects otherwise need adding by hand.
 */
export async function readSetRules(ids, { route, esmodule = importModule } = {}) {
  for (const id of ids) {
    for (const path of SET_LISTS[id] ?? []) {
      let mod;
      try {
        mod = await esmodule(route(`modules/${id}/${path}`));
      } catch {
        continue;
      }
      for (const list of Object.values(mod ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const set of list) {
          const system = set?.systemId ?? set?.id;
          if (typeof system !== 'string' || !Array.isArray(set.effects)) continue;
          const rules = set.effects
            .filter((e) => (e?.result === 20 || e?.result === 1) && typeof e.id === 'string')
            .map((e) => setRule(e.result, e.id))
            .filter(Boolean);
          if (rules.length) {
            sets.set(system, rules);
            setRules.of = setRulesFor;
            setRules.has = hasSetRules;
          }
        }
      }
    }
  }
}

/** A set's own natural 20 / natural 1 rules whose effect is registered (none: an empty list). */
const registeredOf = (system) => (typeof system === 'string' && sets.get(system)?.filter((r) => modes.has(r.effect.id.slice(4)))) || [];

/** Whether a set brings its own natural 20 / natural 1 effects (the theme browser's toggle). */
export const hasSetRules = (system) => registeredOf(system).length > 0;

/** The flag listing the sets whose own natural 20 / natural 1 a user turned off (theme browser). */
export const SET_FX_OFF = 'setFxOff';

/**
 * A die's theme rules (`own`) with its set's own natural 20 / natural 1 rules over them (those whose
 * effect is registered), or undefined when the set has none or the roller turned them off for it
 * (their `dicer.setFxOff` flag: rules.js setRules.of, which fx-resolver asks).
 */
export function setRulesFor(system, own, rollerId, users = globalThis.game?.users) {
  const off = rollerId ? users?.get?.(rollerId)?.getFlag?.('dicer', SET_FX_OFF) : null;
  if (Array.isArray(off) && off.includes(system)) return undefined;
  const set = registeredOf(system);
  if (!set?.length) return undefined;
  const ids = set.map((r) => r.id);
  return [...(own || []).filter((r) => !ids.includes(r.id)), ...set];
}
const animated = new Set(); // the DSN systems whose materials have been given a mixer (animated surfaces)

/**
 * Dicer's effect box and die (its outer group) as Dice So Nice's DiceSFX reads them: a box with a
 * volume (Foundry's own levels then apply), secret rolls unmuted and DSN's base scale, and a die
 * with options and a shape (its type, which Dicer lends it while the effect plays).
 */
/**
 * A Dicer die material that keeps drawing as Dicer's when an effect clones it. three's clone()
 * resets a material's defines to its own and copies only its standard fields, so a copy an add-on
 * effect makes of a die's material (irl-dice-packs' Aelar isolates them, so its glow stays on that
 * die) lost Dicer's numbers, for good: the effect keeps its copy. Its own clone keeps the defines,
 * the compile patch, the program key and the uniforms (as dice-box.js cloneForFade does).
 */
export function keepDicerOnClone(mat) {
  if (!mat || typeof mat.userData?.programKey !== 'string' || Object.hasOwn(mat, 'clone')) return;
  mat.clone = function () {
    const userData = this.userData;
    this.userData = {}; // three copies userData through JSON, which its uniforms (textures) do not survive
    let copy;
    try {
      copy = Object.getPrototypeOf(this).clone.call(this);
    } finally {
      this.userData = userData;
    }
    copy.userData = { ...userData };
    copy.defines = { ...this.defines };
    copy.onBeforeCompile = this.onBeforeCompile;
    copy.customProgramCacheKey = this.customProgramCacheKey;
    keepDicerOnClone(copy); // a copy of the copy too
    return copy;
  };
}

export function dsnEffectArgs(box, group) {
  const b = box && typeof box === 'object' ? box : {};
  // DSN hands effects the die mesh itself (its material, geometry, options); Dicer's runner its
  // outer group, whose die mesh is its first mesh child. The type it lends the group goes along.
  const mesh = group?.isMesh ? group : (group?.children?.find?.((c) => c?.isMesh) ?? group);
  if (mesh && mesh !== group && typeof group?.type === 'string') {
    if (/^d\d+$/.test(group.type)) mesh.shape ??= group.type;
    if (group.result !== undefined) mesh.result = group.result;
  }
  b.volume ??= 1;
  b.muteSoundSecretRolls ??= false;
  b.dicefactory ??= { baseScale: 100 };
  if (mesh && typeof mesh === 'object') {
    mesh.options ??= {};
    mesh.shape ??= typeof mesh.type === 'string' && /^d\d+$/.test(mesh.type) ? mesh.type : undefined;
  }
  return [b, mesh];
}

/** Dicer body types as Dice So Nice material names (what add-on shaders branch on). */
const DSN_MATERIAL = { opaque: 'plastic', resin: 'glass', metal: 'metal', marble: 'stone', pearl: 'pristine', iridescent: 'iridescent', gem: 'glass', wood: 'wood', stone: 'stone', bone: 'plastic', jelly: 'glass' };

/**
 * A Dicer look as Dice So Nice's appearance (colorset colours, material, system settings) over
 * Dicer's own fields: add-on material and shader callbacks read `background`, `foreground`,
 * `outline`, `edge`, `material` and `systemSettings` from it. A Dice So Nice-shaped one is kept.
 */
export function dsnAppearance(a) {
  if (a && typeof a === 'object' && typeof a.background === 'string') return a;
  const look = a && typeof a === 'object' ? a : {};
  const body = look.body ?? {};
  const numbers = look.numbers ?? {};
  return {
    ...look,
    background: body.color ?? '#000000',
    foreground: numbers.color ?? '#ffffff',
    // no outline drawn: the body colour (a colour every add-on can parse; 'none' is not one)
    outline: numbers.fill === 'outline' ? (numbers.color ?? body.color ?? '#000000') : (body.color ?? '#000000'),
    edge: look.edges?.strip?.style && look.edges.strip.style !== 'body' ? look.edges.strip.color : (body.color2 ?? body.color ?? '#000000'),
    material: DSN_MATERIAL[body.type] ?? 'plastic',
    texture: 'none',
    font: numbers.font ?? 'serif',
    systemSettings: look.systemSettings ?? {},
  };
}

/**
 * The turn (a quaternion) that lays Dicer's die of a type out as Dice So Nice's: their face directions
 * then match DSN's (measured from DSN's standard polyhedra; tests/unit/dsn-addon-shim.test.js checks
 * them). Dicer's d4, d6, d8 and d12 already match; its d20 and d10 (so the d100) are turned.
 */
export const DSN_TURN = Object.freeze({
  d20: Object.freeze([-0.2185084, 0.9256152, -0.2185076, 0.2185063]),
  d10: Object.freeze([-0.5718817, -0.4155804, 0.4155813, 0.572308]),
});
const turned = new WeakMap(); // a source geometry -> its copy turned as DSN's

/**
 * Lays a die mesh out as Dice So Nice's, once: it draws a copy of its geometry turned by `turn`,
 * and is turned back by the same amount, so it looks and lands exactly as before while its local
 * positions (what add-on shaders read) are DSN's. Called from the material's per-frame hook: this
 * frame still draws the old geometry with the old pose (both were fixed before the hook), the next
 * the new pair. Dicer may set the mesh's pose again (the result's turn): the mesh's own per-frame
 * hook, which runs before its matrices are taken, turns it back again.
 */
export function dsnPose(mesh, turn) {
  if (!mesh?.isMesh || mesh.userData.dsnPose || !mesh.geometry?.attributes?.position) return;
  const q = new Quaternion(...turn).normalize();
  const back = q.clone().invert();
  const src = mesh.geometry;
  let geo = turned.get(src);
  if (!geo) {
    geo = src.clone();
    geo.applyQuaternion(q);
    turned.set(src, geo);
  }
  let posed = null; // the pose this hook last set
  const fix = () => {
    if (posed && mesh.quaternion.equals(posed)) return false;
    mesh.quaternion.multiply(back);
    posed = mesh.quaternion.clone();
    return true;
  };
  mesh.userData.dsnPose = true;
  mesh.geometry = geo;
  fix();
  const before = mesh.onBeforeRender;
  mesh.onBeforeRender = function (...args) {
    if (mesh.geometry === src) mesh.geometry = geo; // a fade or a swap put the old one back
    if (fix()) {
      mesh.updateMatrix();
      if (mesh.parent) mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
      else mesh.matrixWorld.copy(mesh.matrix);
    }
    return before.apply(this, args);
  };
}

/**
 * Gives a die geometry without texture coordinates a `uv` attribute as Dice So Nice's dice have
 * one: each flat face its own tile of a 5-wide grid of 1/8 cells, in the order faces first appear.
 * Add-ons find a face by its tile (irl-dice-packs' Unbroken Vow puts its butterfly on tile 15 of a
 * d20 and threw on Dicer's uv-less dice, leaving the die undrawn). Dicer's shaders never read it.
 */
export function faceUvs(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos || geometry.attributes.uv || typeof geometry.setAttribute !== 'function') return;
  const index = geometry.index;
  const corners = index ? index.count : pos.count;
  const uv = new Float32Array(pos.count * 2);
  const faces = []; // face normals, in the order faces first appear
  const p = (id) => [pos.getX(id), pos.getY(id), pos.getZ(id)];
  for (let i = 0; i + 2 < corners; i += 3) {
    const ids = [i, i + 1, i + 2].map((c) => (index ? index.getX(c) : c));
    const [a, b, c] = ids.map(p);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    // a face: the triangles in its plane (normals within ~8 degrees)
    let face = faces.findIndex((f) => (f[0] * n[0] + f[1] * n[1] + f[2] * n[2]) / len > 0.99);
    if (face < 0) face = faces.push(n.map((x) => x / len)) - 1;
    for (const id of ids) {
      uv[id * 2] = ((face % 5) + 0.5) / 8;
      uv[id * 2 + 1] = (Math.floor(face / 5) + 0.5) / 8;
    }
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
}

/**
 * Dicer's base colour (its body, inside and numbers: after `#include <color_fragment>`) moved to
 * before `#include <map_fragment>`. Dice So Nice add-ons recolour the die at map_fragment, where
 * Dice So Nice's colour is final; after Dicer's colour pass their surface would be painted over.
 * Dicer's dice carry no map and no vertex colours, so the two chunks change nothing for its own.
 */
export function baseColourFirst(fs) {
  const m = /#include <color_fragment>\n([\s\S]*?)(\n[ \t]*#include <alphamap_fragment>)/.exec(fs);
  if (!m || !m[1].trim() || !fs.includes('#include <map_fragment>')) return fs;
  const without = fs.slice(0, m.index) + '#include <color_fragment>' + m[2] + fs.slice(m.index + m[0].length);
  return without.replace('#include <map_fragment>', `${m[1]}\n#include <map_fragment>`);
}

/**
 * What Dice So Nice add-ons read from game.dice3d beyond Dicer's own surface, installed once the
 * first add-on has loaded (so worlds without add-ons keep Dicer's stand-in as it is):
 * - `uniforms.time`: Dice So Nice's shader clock ({value}: seconds, performance.now() / 1000),
 *   which add-on shaders bind as a uniform;
 * - a preset added for a system registered as a DiceSystem instance also goes into the
 *   instance's own `dice` map, as Dice So Nice does (its DiceSystem runs its material callbacks
 *   only for die types it holds);
 * - an instance's processMaterial may replace the material's customProgramCacheKey: Dicer's key
 *   is kept in front, so dice with different Dicer looks never share one compiled program.
 */
export function shimDsn(dice3d) {
  if (!dice3d || typeof dice3d !== 'object' || shimmed.has(dice3d)) return;
  shimmed.add(dice3d);
  const uniforms = (dice3d.uniforms ??= {});
  uniforms.time ??= {
    get value() {
      return performance.now() / 1000;
    },
    set value(_) {}, // Dice So Nice sets it each frame; here it reads the clock
  };
  const instanceOf = (id) => dice3d.DiceFactory?.systems?.get?.(id)?.instance;
  const { addSystem, addDicePreset, addSFXMode, addTexture } = dice3d;
  // An add-on's texture is drawn the Dice So Nice way (body-image.js: its metal's reflections, its
  // bump map as a normal map, built now so the dice rolled later have it).
  if (typeof addTexture === 'function') {
    dice3d.addTexture = function (id, texture, ...rest) {
      if (typeof texture?.source === 'string') {
        const bump = typeof texture.bump === 'string' && texture.bump ? texture.bump : null;
        addonTextures.set(texture.source, { bump });
        if (bump) void loadNormal(bump);
      }
      return addTexture.call(this, id, texture, ...rest);
    };
  }
  // A special effect built on Dice So Nice's own DiceSFX reads DSN's dice box and die mesh in its
  // constructor (the die's options.secret and shape, the box's volume, muteSoundSecretRolls and
  // dicefactory.baseScale): a subclass hands it Dicer's with those filled in (dsnEffectArgs).
  if (typeof addSFXMode === 'function') {
    dice3d.addSFXMode = function (cls, ...rest) {
      if (typeof cls !== 'function') return addSFXMode.call(this, cls, ...rest);
      if (typeof cls.id === 'string') modes.add(cls.id);
      const Dsn = class extends cls {
        constructor(box, mesh, options, ...more) {
          super(...dsnEffectArgs(box, mesh), options, ...more);
          mesh?.traverse?.((o) => o.isMesh && [o.material].flat().forEach(keepDicerOnClone));
        }

        /**
         * Dice So Nice's way: play() only sets the effect up; DSN then calls render() every frame
         * until the effect destroys itself. Dicer's runner keeps an effect while play() is pending,
         * so this play() lasts until then, rendering it every frame.
         */
        async play(...args) {
          const out = await super.play(...args);
          if (out === false || this.destroyed || typeof this.render !== 'function') return out;
          const frame = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
          await new Promise((resolve) => {
            const tick = () => {
              if (this.destroyed) return resolve();
              try {
                this.render();
              } catch (err) {
                console.warn('dicer: a Dice So Nice special effect failed while rendering', err);
                try {
                  this.destroy?.();
                } catch {
                  /* nothing more to free */
                }
                return resolve();
              }
              frame(tick);
            };
            frame(tick);
          });
          return out;
        }
      };
      return addSFXMode.call(this, Dsn, ...rest);
    };
  }
  if (typeof addSystem === 'function') {
    dice3d.addSystem = function (system, ...rest) {
      // A die an add-on dresses as it appears (SPAWN, dice.mesh) keeps Dicer's numbers when its
      // materials are copied (irl-dice-packs' smoked glass copies them).
      const fire = system?.fire;
      if (typeof fire === 'function' && !Object.hasOwn(system, 'fire')) {
        system.fire = function (type, event, ...more) {
          if (type === 0) event?.dice?.mesh?.traverse?.((o) => o.isMesh && [o.material].flat().forEach(keepDicerOnClone));
          return fire.call(this, type, event, ...more);
        };
      }
      const pm = system?.processMaterial;
      if (typeof pm === 'function' && !Object.hasOwn(system, 'processMaterial')) {
        system.processMaterial = function (type, mat, appearance, ...more) {
          const key = mat?.customProgramCacheKey;
          const dsn = dsnAppearance(appearance);
          // what Dice So Nice hands the shader callbacks too (Dicer's own call has only the shader and material)
          if (mat?.userData) mat.userData.dsnCall = { type, appearance: dsn };
          const out = pm.call(this, type, mat, dsn, ...more);
          // an animated system's material (a mixer: Dicer keeps such dice drawing, as DSN does);
          // some systems add it only when their shader compiles, which three skips for a reused program
          if (mat && !mat.mixer && animated.has(system.id ?? this?.id)) mat.mixer = { animated: true };
          // Each frame, before their own per-frame hook (if any): the die laid out as Dice So Nice's
          // (dsnPose: their shaders find faces and edges by DSN's face directions) and its texture
          // coordinates (DSN dice have them).
          const obr = mat?.onBeforeRender;
          const turn = DSN_TURN[type === 'd100' ? 'd10' : type];
          if (mat && typeof obr === 'function') {
            mat.onBeforeRender = function (renderer, scene, camera, geometry, object, ...rest) {
              if (turn) dsnPose(object, turn);
              faceUvs(object?.geometry ?? geometry);
              return obr.call(this, renderer, scene, camera, geometry, object, ...rest);
            };
          }
          const theirs = mat?.customProgramCacheKey;
          if (typeof key === 'function' && typeof theirs === 'function' && theirs !== key)
            mat.customProgramCacheKey = () => `${key.call(mat)}|${theirs.call(mat)}`;
          return out;
        };
      }
      const bsc = system?.beforeShaderCompile;
      if (typeof bsc === 'function' && !Object.hasOwn(system, 'beforeShaderCompile')) {
        system.beforeShaderCompile = function (shader, material, type, appearance, ...more) {
          const call = material?.userData?.dsnCall;
          if (typeof shader?.fragmentShader === 'string') shader.fragmentShader = baseColourFirst(shader.fragmentShader);
          const out = bsc.call(this, shader, material, type ?? call?.type, appearance ?? call?.appearance ?? dsnAppearance(null), ...more);
          if (material?.mixer) animated.add(system.id ?? this?.id);
          return out;
        };
      }
      return addSystem.call(this, system, ...rest);
    };
  }
  if (typeof addDicePreset === 'function') {
    dice3d.addDicePreset = function (preset, ...rest) {
      const out = addDicePreset.call(this, preset, ...rest);
      try {
        const dice = typeof preset?.system === 'string' ? instanceOf(preset.system)?.dice : null;
        if (typeof preset.type === 'string' && dice?.has?.(preset.type) === false) dice.set(preset.type, { ...preset });
      } catch {
        // a third-party map that refuses it: its system keeps Dicer's material
      }
      return out;
    };
  }
}

/**
 * Keeps Ember Lunar Dice's moon uniforms in step with Ember's moons. The dice add
 * `game.dice3d.uniforms.moonPhase` (`{<moon id>: {value}}`, true while that moon is full) and Ember
 * sets it, but only while both that module and Dice So Nice read as active, which neither does
 * under Dicer. Set here as Ember does: once the dice have registered (now, when they already have:
 * a plain dice set loads after the announcement; else at the announcement), then at each
 * `ember.lunarPhaseChange`. Without Ember (`calendar()` has no moons) nothing is set.
 */
export function followEmberMoons({ hooks, dice3d, calendar, time }) {
  const cal = calendar ?? emberCalendar;
  // "My dice follow Ember's moons" (a user's dicer.moonDice flag): the look resolver asks the
  // registry which set a roller's default dice are right now, the theme browser which sets offer it
  const registry = dice3d?._registry;
  if (registry) {
    registry.moonRef = (user, looks) => {
      const system = moonSystemFor(user, { calendar: cal, now: time, has: (id) => registry.systems?.has?.(id) === true });
      if (system && looks) looks.global = { ...looks.global, system };
      return system;
    };
  }
  setRules.moonSet = (system) => MOON_SET.test(system);
  const set = (phases) => {
    const mp = dice3d?.uniforms?.moonPhase;
    if (!mp || typeof mp !== 'object' || !phases || typeof phases !== 'object') return;
    for (const [id, phase] of Object.entries(phases)) if (mp[id] && typeof mp[id] === 'object') mp[id].value = phase === 'full';
  };
  const now = () => {
    const moons = cal()?.moons;
    if (moons && typeof moons === 'object') set(Object.fromEntries(Object.values(moons).map((m) => [m?.id, m?.phase])));
  };
  now();
  hooks?.once?.('diceSoNiceReady', now);
  hooks?.on?.('ember.lunarPhaseChange', (change) => set(change?.phases));
}

/**
 * Runs the picked Dice So Nice add-ons (the `dsnAddons` setting: module ids) in full while they
 * stay inactive: such a module needs Dice So Nice, which must stay off, so Foundry will not
 * activate it; nothing else in it checks. Each pick's `scripts` then `esmodules` load from its
 * manifest (its own files only). Dicer runs this in its ready hook before announcing game.dice3d,
 * so the add-ons' diceSoNiceInit/diceSoNiceReady listeners are live for that; listeners for start
 * hooks that have already fired (init, i18nInit, setup, ready) are caught while the files load and
 * run right after. While those listeners and the add-on's Dice So Nice listeners run, an installed
 * Dice So Nice reads as active (withDsnActive: add-ons often check it before registering); once one
 * add-on has loaded, game.dice3d gets what add-ons read from Dice So Nice (shimDsn). Active modules
 * (they load themselves), Dicer and Dice So Nice are skipped, and each module loads once per page.
 * Returns the ids loaded now.
 */
export async function loadDsnAddons(
  ids,
  {
    hooks = globalThis.Hooks,
    modules = globalThis.game?.modules,
    route = (p) => globalThis.foundry?.utils?.getRoute?.(p) ?? `/${p}`,
    script = addScript,
    esmodule = importModule,
    dice3d = globalThis.game?.dice3d,
    warn = (...a) => console.warn(...a),
    fonts = globalThis.CONFIG?.fontDefinitions,
    calendar,
    loadFont = (family, def) => globalThis.foundry?.applications?.settings?.menus?.FontConfig?.loadFont?.(family, def),
  } = {},
) {
  const caught = [];
  const knownFonts = new Set(Object.keys(fonts ?? {}));
  const done = [];
  let current = null;
  const { on, once } = hooks;
  const asDsn = (fn) =>
    function (...args) {
      return withDsnActive(modules, () => fn.apply(this, args));
    };
  const wrap = (orig) =>
    function (hook, fn, ...rest) {
      if (typeof fn !== 'function') return orig.call(this, hook, fn, ...rest);
      // an add-on's own Dice So Nice listeners see Dice So Nice as active (many check it first)
      if (DSN_HOOKS.includes(hook)) return orig.call(this, hook, asDsn(fn), ...rest);
      if (!STARTED.has(hook)) return orig.call(this, hook, fn, ...rest);
      caught.push({ id: current, hook, fn: asDsn(fn) });
      return 0;
    };
  hooks.on = wrap(on);
  hooks.once = wrap(once);
  try {
    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      const mod = typeof id === 'string' && !SKIP.has(id) && !loaded.has(id) ? modules?.get?.(id) : null;
      if (!mod || mod.active) continue;
      const files = [...ownFiles(id, mod.scripts).map((p) => [script, p]), ...ownFiles(id, mod.esmodules).map((p) => [esmodule, p])];
      if (!files.length) continue;
      loaded.add(id);
      current = id;
      for (const [load, path] of files) {
        try {
          await load(route(path));
        } catch (err) {
          warn(`dicer: the Dice So Nice add-on "${id}" could not load ${path}`, err);
        }
      }
      done.push(id);
    }
  } finally {
    hooks.on = on;
    hooks.once = once;
  }
  if (done.length) {
    shimDsn(dice3d);
    await readSetRules(done, { route, esmodule });
    if (done.includes(LUNAR_DICE)) followEmberMoons({ hooks, dice3d, calendar });
  }
  for (const { id, hook, fn } of caught) {
    try {
      await fn();
    } catch (err) {
      warn(`dicer: the ${hook} hook of the Dice So Nice add-on "${id ?? '?'}" failed`, err);
    }
  }
  // Fonts an add-on defined in its init hook (CONFIG.fontDefinitions, as Lordu's dice do) came after
  // Foundry loaded the page's fonts: load them now, so their dice draw in them.
  const added = Object.entries(fonts ?? {}).filter(([family]) => !knownFonts.has(family));
  await Promise.all(added.map(([family, def]) => Promise.resolve().then(() => loadFont(family, def)).catch(() => {})));
  return done;
}

/** Whether a module's dice were loaded on this page (the picker marks them). */
export const isLoaded = (id) => loaded.has(id);

/** Forgets what was loaded (tests). */
export const resetLoaded = () => {
  loaded.clear();
  delete setRules.of;
  delete setRules.has;
  delete setRules.moonSet;
  sets.clear();
  modes.clear();
};
