// Themes: a look per die type, an impact-sound material and celebration rules (Plan 5, P5-D4).
// Pure data and validation; no Foundry or DOM access.
import { LOOKS } from '../look/looks.js';
import { normalizeAppearance } from '../look/appearance.js';
import { normalizeRule } from '../effects/rules.js';
import { EFFECT_IDS } from '../effects/effect-ids.js';

export const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
/** perType keys a theme may carry: the editor's DIE_TYPES plus the dice it has no tab for yet. */
const THEME_TYPES = [...DIE_TYPES, 'd3', 'd5', 'd7', 'd14', 'd16', 'df'];
export const SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone', 'squishy'];
/** Effect catalogue ids (world start's own list: the library chunk is lazy); 'dsn:' ids are also allowed. */
export const KNOWN_EFFECTS = [...EFFECT_IDS];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

export function deepFreeze(o) {
  for (const v of Object.values(o))
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

const fail = (warn, msg) => (warn(msg), null);

/**
 * Validate and canonicalise a raw theme (built-in, world or imported).
 * @returns {object|null} the frozen theme, or null after exactly one warn() call.
 */
export function normalizeTheme(raw, source = 'user', warn = console.warn) {
  if (!isObj(raw)) return fail(warn, 'Dicer: ignoring theme: not an object');
  const label = isStr(raw.id) ? ` "${raw.id}"` : '';
  if (!isStr(raw.id)) return fail(warn, 'Dicer: ignoring theme: missing id');
  if (!isStr(raw.name)) return fail(warn, `Dicer: ignoring theme${label}: missing name`);
  if (!isObj(raw.appearance))
    return fail(warn, `Dicer: ignoring theme${label}: missing appearance`);
  const perType = {};
  if (isObj(raw.perType)) {
    for (const t of THEME_TYPES)
      if (isObj(raw.perType[t])) perType[t] = normalizeAppearance(raw.perType[t]);
  }
  let soundMaterial = null;
  if (raw.soundMaterial != null) {
    if (SOUND_MATERIALS.includes(raw.soundMaterial)) soundMaterial = raw.soundMaterial;
    else warn(`Dicer: theme${label}: unknown sound material "${String(raw.soundMaterial)}"`);
  }
  const rules = [];
  for (const r of Array.isArray(raw.rules) ? raw.rules : []) {
    const rule = normalizeRule(r, 'theme', warn);
    if (!rule) continue;
    const fx = rule.effect?.id;
    if (fx && !KNOWN_EFFECTS.includes(fx) && !fx.startsWith('dsn:') && !fx.startsWith('scene-')) {
      warn(`Dicer: theme${label}: ignoring rule "${rule.id}": unknown effect "${fx}"`);
      continue;
    }
    rules.push(rule);
  }
  // its own damage dice looks: damage type -> a theme id, colorset name or 'none' (damage-themes.js)
  const damage = {};
  if (isObj(raw.damage)) for (const k in raw.damage) if (isStr(raw.damage[k])) damage[k] = raw.damage[k];
  return deepFreeze({
    id: raw.id,
    name: raw.name,
    appearance: normalizeAppearance(raw.appearance),
    perType,
    soundMaterial,
    rules,
    source,
    ...(Object.keys(damage).length && { damage }),
    // a module dice set's system it was made from (Import as theme): its dice and shaders, in these colours
    ...(isStr(raw.system) && { system: raw.system }),
    // a registered theme's `pets.volume` (0..1): scales the dice pets' voices for its rolls
    ...(source === 'addon' && Number.isFinite(raw.pets?.volume) && { pets: { volume: Math.min(1, Math.max(0, raw.pets.volume)) } }),
  });
}

// --- built-in library -------------------------------------------------------
const nat = (v, fx, snd, color) => ({
  id: v === 20 ? 'dicer.nat20' : 'dicer.nat1',
  name: v === 20 ? 'Natural 20' : 'Natural 1',
  die: 'd20',
  result: { kind: 'value', value: v },
  effect: color ? { id: fx, color } : { id: fx },
  sound: { builtin: snd },
});
const A = (id) => LOOKS[id].appearance;
const N = normalizeAppearance;
const build = (id, name, appearance, soundMaterial, perType, rules, author) =>
  deepFreeze({
    id,
    name,
    appearance,
    perType: perType || {},
    soundMaterial,
    rules: rules.map((r) => normalizeRule(r, 'theme')),
    source: 'builtin',
    ...(author && { author }), // who designed it: the theme browser credits them
  });
/** A theme Sherp designed in the dice editor and shared: [id, name, sound material, look]. */
const S = ([id, name, mat, look]) => build(id, name, N(look), mat, null, [], 'Sherp');
/** A theme from an existing look: [look id, sound material, celebration?]. */
const L = ([id, mat, rule]) => build(id, LOOKS[id].name, A(id), mat, null, rule ? [rule] : []);

const D = [
  '@@dicer-themes-start',
  [
    ['default', 'glass'],
    ['ruby-classic', 'plastic'],
    ['abyss-liquid', 'glass'],
    ['starlit-glitter', 'glass', nat(20, 'sparkles', 'sparkle')],
    ['galaxy-nebula', 'glass', nat(20, 'glow-pulse', 'chime', '#c04dff')],
    ['sharp-crystal', 'glass'],
    ['dwarven-brass', 'metal'],
    ['silver-brushed', 'metal'],
    ['gold-polished', 'metal', nat(20, 'light-burst', 'fanfare')],
    ['marble-white', 'stone'],
    ['jade-marble', 'stone'],
    ['pearl-moon', 'stone'],
    ['ember-core', 'glass', nat(20, 'embers', 'crackle')],
    ['frost-crystal', 'glass', nat(20, 'frost', 'chime')],
    ['void-star', 'glass', nat(20, 'shockwave', 'boom')],
    ['smoke-swirl', 'plastic', nat(20, 'smoke', 'whoosh')],
  ],
  [
    build(
      'dragon-hoard',
      'Dragon Hoard',
      N({
        body: { type: 'resin', color: '#6b3a0a', color2: '#2a1203', roughness: 0.05 },
        interior: { type: 'glitter', colors: ['#ffd24a', '#ff9a1f'], density: 0.75 },
        numbers: { fill: 'gold', color: '#ffd24a', depth: 0.5 },
      }),
      'metal',
      null,
      [nat(20, 'embers', 'fanfare')],
    ),
    build(
      'stormcaller',
      'Stormcaller',
      N({
        body: { type: 'resin', color: '#0b1030', color2: '#04061a', roughness: 0.04 },
        interior: { type: 'nebula', colors: ['#6cf0ff', '#7a5cff'], density: 0.7 },
        // white paint, a faint glow: the cyan glow tinted the numbers into the cyan storm
        numbers: { fill: 'paint', color: '#f4fbff', depth: 0.5 },
        glow: { color: '#6cf0ff', intensity: 0.15 },
      }),
      'glass',
      null,
      [nat(20, 'lightning', 'zap')],
    ),
    build(
      'blood-moon',
      'Blood Moon',
      N({
        body: { type: 'resin', color: '#4a0610', color2: '#1a0206', roughness: 0.04 },
        interior: { type: 'liquid', colors: ['#c4121f', '#7a0a14'], density: 0.7 },
        numbers: { fill: 'silver', color: '#e8d0d0', depth: 0.5 },
      }),
      'glass',
      null,
      [nat(20, 'smoke', 'whoosh', '#c4121f')],
    ),
    build(
      'celestial',
      'Celestial',
      N({
        body: { type: 'pearl', color: '#f2eff6', color2: '#b9d4f2', roughness: 0.25 },
        numbers: { fill: 'gold', color: '#d9a93a', depth: 0.5 },
      }),
      'glass',
      {
        d20: N({
          body: { color: '#0a1030' },
          interior: { type: 'shape', colors: ['#ffd24a', '#fff3c4'], extra: 'glitter' },
          numbers: { fill: 'silver', color: '#f2f4f8' }, // gold numbers vanished over the gold shape
        }),
      },
      [nat(20, 'sparkles', 'chime')],
    ),
    build(
      'obsidian',
      'Obsidian',
      N({
        body: { type: 'resin', color: '#050507', color2: '#000000', roughness: 0.02 },
        interior: { type: 'none' },
        numbers: { fill: 'silver', color: '#d8dde6', depth: 0.6 },
        edges: { style: 'sharp' },
      }),
      'glass',
      null,
      [nat(1, 'shatter', 'thud')],
    ),
    build(
      'verdant',
      'Verdant',
      N({
        body: { type: 'gem', preset: 'malachite', color: '#1f8a5a', color2: '#0a3a24' },
      }),
      'stone',
      null,
      [],
    ),
  ],
  [
    ['against-the-grain', 'Against the Grain', 'wood', { body: { type: 'wood', color: '#d59662', color2: '#6d4217', roughness: 1, preset: 'oak' }, numbers: { fill: 'outline', color: '#000000', depth: 1, size: 1.4, weight: 1 }, edges: { radius: 1, strip: { color: '#3d190a', strength: 0.4 } } }],
    ['all-seeing', 'All-Seeing', 'glass', { body: { color: '#000000', roughness: 0 }, interior: { type: 'eye', colors: ['#de3f3f', '#5c002c'], density: 0.23, extraColor: '#52ffe2', extraDensity: 1 }, numbers: { fill: 'outline', icons: { fumble: 'skull' }, color: '#ffffff', depth: 0.72, size: 1.05, weight: 1 }, edges: { radius: 1 }, glow: { intensity: 0.9 } }],
    ['antelope-canyon', 'Antelope Canyon', 'stone', { body: { type: 'stone', color: '#aa3109', color2: '#c46c08', roughness: 1, preset: 'sandstone' }, numbers: { fill: 'enamel', color: '#ce7a2c', depth: 0.68, size: 1.15, weight: 0.4 }, glow: { color: '#ce7a2c', intensity: 0.4 } }],
    ['carbon-fiber', 'Carbon Fiber', 'plastic', { body: { type: 'stone', color: '#2e2e2e', color2: '#575757', roughness: 0, preset: 'brick' }, numbers: { fill: 'glow', relief: 'raised', color: '#828282', depth: 0.68, font: 'sans', size: 1.1, weight: 1 }, edges: { radius: 0.75 }, glow: { intensity: 0.4 } }],
    ['dark-opal', 'Dark Opal', 'glass', { body: { type: 'iridescent', color: '#000000', color2: '#000000', roughness: 0, preset: 'opal' }, numbers: { fill: 'glow', color: '#d8dde6', depth: 1, weight: 1 }, edges: { radius: 0.75 }, glow: { intensity: 2 } }],
    ['ebony-ivory', 'Ebony & Ivory', 'wood', { body: { type: 'wood', color: '#000000', color2: '#585450', roughness: 0.12, preset: 'ebony' }, numbers: { fill: 'enamel', relief: 'raised', color: '#d8d3cb', depth: 1, weight: 1 }, edges: { strip: { style: 'paint', color: '#000000', strength: 0.05 } }, glow: { color: '#d8d3cb' } }],
    ['edgelight', 'Edgelight', 'metal', { body: { type: 'metal', color: '#000000', color2: '#3a3d40', finish: 'mirror', roughness: 0 }, numbers: { fill: 'glow', color: '#ffffff', depth: 1, font: 'blackletter', size: 1.25, weight: 1 }, edges: { strip: { style: 'glow', color: '#ffffff' } }, glow: { intensity: 2 } }],
    ['eruption', 'Eruption', 'glass', { body: { color: '#000000', color2: '#2a0f45', roughness: 0 }, interior: { type: 'lava', colors: ['#da7734', '#d11010'], density: 0, extra: 'sand', extraColor: '#e6d0c6', extraDensity: 0.25 }, numbers: { fill: 'glow', icons: { crit: 'flame' }, color: '#c6c09f', depth: 0.35, font: 'uncial', weight: -0.6 }, edges: { strip: { style: 'glow', strength: 0 } }, glow: { intensity: 0.7 } }],
    ['ivory-ebony', 'Ivory & Ebony', 'wood', { body: { type: 'bone', color: '#f1e9d6', color2: '#2b2b2b', roughness: 0.74, preset: 'ivory' }, numbers: { fill: 'enamel', color: '#000000', depth: 1, weight: 1 }, edges: { strip: { color: '#000000', strength: 0.05 } }, glow: { color: '#d8d3cb' } }],
    ['jelly-belly', 'Jelly Belly', 'plastic', { body: { type: 'jelly', color: '#e0a910', color2: '#ff00c8', roughness: 0 }, numbers: { fill: 'paint', relief: 'raised', icons: { crit: 'heart' }, color: '#e86721', depth: 0.6, font: 'blackletter', size: 1.4, weight: -0.85 }, edges: { radius: 1 } }],
    ['nautilus', 'Nautilus', 'glass', { body: { roughness: 0 }, interior: { type: 'smoke', colors: ['#3fccde', '#00175c'], density: 0.85, extra: 'bubbles', extraColor: '#52ffe2', extraDensity: 1 }, numbers: { fill: 'glow', color: '#ffffff', depth: 0.67, size: 1.05, weight: 0.3 }, edges: { radius: 0.75 }, glow: { intensity: 0.2 } }],
    ['olympus-heights', 'Olympus Heights', 'metal', { body: { type: 'metal', color: '#b5653a', color2: '#3fae9a', finish: 'patina', roughness: 0.47 }, numbers: { fill: 'glow', relief: 'raised', color: '#70ffee', depth: 1, font: 'deco', size: 0.9, weight: -0.3 }, edges: { radius: 0.75, strip: { color: '#b5653a', strength: 0.15 } } }],
    ['rare-shiny', 'Rare Shiny', 'glass', { body: { type: 'iridescent', color: '#077e46', color2: '#451674', roughness: 0, preset: 'chameleon' }, numbers: { fill: 'holo', relief: 'raised', icons: { crit: 'starburst' }, depth: 0.85, font: 'uncial', size: 1.1, weight: 0.35 }, edges: { radius: 0.25 }, glow: { color: '#e2b04a', intensity: 0.25 } }],
    ['sandalwood-sense', 'Sandalwood Sense', 'wood', { body: { type: 'wood', color: '#4a130d', color2: '#000000', roughness: 0.86, preset: 'walnut' }, numbers: { fill: 'silver', color: '#d8dde6', depth: 0.45, font: 'blackletter', size: 1.35, weight: -1 }, edges: { radius: 0.25, strip: { style: 'paint', color: '#3d190a', strength: 0.4 } } }],
    ['scarborough', 'Scarborough', 'glass', { body: { color: '#175e47', color2: '#2a0f45', finish: 'worn', roughness: 1 }, interior: { type: 'smoke', colors: ['#f0f0f0', '#aec2be'], density: 1, motion: false, extra: 'foil', extraColor: '#ffdf6b', extraDensity: 1 }, numbers: { depth: 1, font: 'blackletter', size: 1.35, weight: 1 }, edges: { radius: 0, style: 'sharp' }, glow: { color: '#6f5c15' } }],
    ['vault-floor', 'Vault Floor', 'stone', { body: { type: 'stone', color: '#5a5953', color2: '#48413d', roughness: 0, preset: 'granite' }, numbers: { depth: 0.85, font: 'deco', size: 1.15, weight: -0.35 }, edges: { radius: 0, style: 'sharp' }, glow: { color: '#e2b04a', intensity: 0.25 } }],
    ['wonderland', 'Wonderland', 'glass', { body: { color: '#d6f7ff', roughness: 0.16 }, interior: { type: 'frost', colors: ['#ebebeb', '#b3f0ff'], density: 0.25, extra: 'sand', extraDensity: 1 }, numbers: { fill: 'paint', icons: { crit: 'starburst' }, color: '#ded9d9', depth: 0.59, size: 1.2, weight: 1 }, edges: { radius: 1 }, glow: { intensity: 2 } }],
  ],
  '@@dicer-themes-end',
];

export const BUILTIN_THEMES = Object.freeze([...D[1].map(L), ...D[2], ...D[3].map(S)]);
/** Markers around the table in the bundle; build.test.js measures the span. */
export const THEME_TABLE_MARKS = Object.freeze([D[0], D[4]]);

const listCache = new WeakMap();
const textCache = new Map(); // settings may hand out a fresh copy per read: also cache by content
/**
 * A stored theme list (world setting or user flag) as valid frozen themes. Cached per array and
 * per content, so a bad entry warns once per stored value, not once per roll; unreadable entries
 * are skipped here, never removed from storage.
 */
export function readThemeList(list, source, warn = console.warn) {
  if (!Array.isArray(list)) return [];
  let out = listCache.get(list);
  let text = null;
  if (!out) {
    try {
      text = `${source}:${JSON.stringify(list)}`;
    } catch {
      /* uncacheable by content */
    }
    out = text === null ? undefined : textCache.get(text);
    if (out) listCache.set(list, out);
  }
  if (!out) {
    out = [];
    for (const raw of list) {
      const theme = normalizeTheme(raw, source, (msg) => {
        try {
          warn(msg);
        } catch {
          /* a throwing logger must not reach the roll */
        }
      });
      if (theme) out.push(theme);
    }
    listCache.set(list, out);
    if (text !== null) {
      if (textCache.size >= 16) textCache.delete(textCache.keys().next().value);
      textCache.set(text, out);
    }
  }
  return out;
}

/**
 * Themes other modules registered this session (api.registerTheme, src/api/theme-api.js): id ->
 * theme (source 'addon', moduleId). Every client registers them itself, so they resolve for all.
 */
export const ADDON_THEMES = new Map();

/** Told of an id findTheme cannot resolve; the API chunk sets it to load a module's theme stub. */
export const MISSING = { hook: null };

/** Built-in, else a module's, else the world list, else the roller's own list. */
export function findTheme(id, { worldThemes, userThemes } = {}) {
  if (!isStr(id)) return null;
  const hit = (list) => (Array.isArray(list) ? list.find((t) => t && t.id === id) : undefined);
  const found = BUILTIN_THEMES.find((t) => t.id === id) ?? ADDON_THEMES.get(id) ?? hit(worldThemes) ?? hit(userThemes);
  if (!found) MISSING.hook?.(id);
  return found ?? null;
}
