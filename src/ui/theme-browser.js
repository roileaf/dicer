/**
 * The theme browser (lazy chunk, opened from the `dicer.themeBrowser` settings menu): a gallery
 * of built-in, world and the user's own themes with live thumbnails, "use" assignment (default,
 * die type, roll role, owned actor, damage type), create / duplicate / edit (in the appearance
 * editor, its own lazy chunk), export / import files and the GM's publish. The pure logic is in ./theme-form.js; the data actions below
 * (assign, clear, save, import, export, publish) are exported so they can be tested without a DOM.
 */
import { chosenRef, isNeverChose, mirrorLookSetting, neverChoseRef, readUserLooks } from '../compat/user-looks.js';
import {
  moduleDiceEntries,
  registryView,
  useModulePatch,
  stopSystemPatch,
  currentModuleIds,
  moduleThemeRaw,
} from './module-dice.js';
import { DIE_TYPES, findTheme, readThemeList } from '../themes/themes.js';
import { setRules } from '../effects/rules.js';
import { createThumbnailer } from '../themes/thumbnailer.js';
import { lookFromModels as modelLookOf } from '../themes/model-colours.js';
import { damageTypeList } from './damage-map-form.js';
import { BROWSER_TABS, STUBS, inAll, loadStub, tabEntries } from '../api/addon-registry.js';
import {
  ROLL_ROLES,
  roleSlot,
  slotPatch,
  assignDamage,
  galleryEntries,
  upsertTheme,
  removeTheme,
  duplicateTheme,
  publishToWorld,
  exportJson,
  importThemes,
  slugify,
  themeAssignments,
  userThemeId,
} from './theme-form.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE = 'dicer';
const FLAG = 'appearance';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const notify = (kind, message) => globalThis.ui?.notifications?.[kind]?.(message);
const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const humanize = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const SOURCE_LABEL = {
  builtin: 'DICER.Themes.Source.builtin',
  world: 'DICER.Themes.Source.world',
  user: 'DICER.Themes.Source.user',
  module: 'DICER.Themes.Source.module',
};
// 'module' (dice sets other modules registered through the DSN API) is not part of "All": they are not themes.
const FILTER_KEYS = { all: 'DICER.Themes.Filter_all', builtin: 'DICER.Themes.Source.builtin', world: 'DICER.Themes.Source.world', user: 'DICER.Themes.Source.user', module: 'DICER.Themes.Source.module' };
const ROLE_LABEL = {
  attack: 'DICER.Themes.Role.attack',
  damage: 'DICER.Themes.Role.damage',
  save: 'DICER.Themes.Role.save',
  skill: 'DICER.Themes.Role.skill',
  initiative: 'DICER.Themes.Role.initiative',
  check: 'DICER.Themes.Role.check',
};

const isPlainObjectLike = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const me = () => globalThis.game?.user;
const settings = () => globalThis.game?.settings;

/** The GM has set everyone's dice (a world default with the lock on); never true for a GM. */
function isLocked() {
  if (me()?.isGM) return false;
  try {
    return Boolean(settings()?.get(MODULE, 'lockPlayerLooks')) && Boolean(settings()?.get(MODULE, 'worldDefaultTheme'));
  } catch {
    return false;
  }
}

// --- data actions ---------------------------------------------------------------------------
/** 'default' | 'die:d20' | 'role:attack' | 'actor:<id>' | 'damage:fire' | 'worlddamage:fire' -> {kind, key}. */
export function parseTarget(value) {
  const s = String(value ?? '');
  if (s === 'default') return { kind: 'default', key: '' };
  const i = s.indexOf(':');
  if (i < 0) return null;
  const kind = s.slice(0, i);
  const key = s.slice(i + 1);
  return ['die', 'role', 'actor', 'damage', 'worlddamage'].includes(kind) && key ? { kind, key } : null;
}

/**
 * Sets (themeId) or clears (null) one place a theme is used. A player's choices go to their own
 * flag / settings; the world damage map needs a GM.
 * @returns {Promise<boolean>} false when the target is not allowed or not found
 */
export async function assignTarget(target, themeId) {
  const t = typeof target === 'string' ? parseTarget(target) : target;
  const user = me();
  if (!t || !user) return false;
  const id = typeof themeId === 'string' && themeId ? themeId : null;
  // a stub becomes its theme before anything stores it; a failed load stores nothing
  if (id && STUBS.has(id) && !(await loadStub(id, { retry: true }))) return false;
  switch (t.kind) {
    case 'default':
      if (id) {
        // Written directly as well: the setting's onChange (which mirrors too) does not fire when
        // the value is unchanged, e.g. re-picking the old theme after a GM push. Idempotent.
        await mirrorLookSetting(user, id);
        await settings().set(MODULE, 'theme', id);
      } else {
        // Clear: a never-chose global first, so the world default applies again (P7-R5); the
        // setting's mirror then sees it and leaves it alone (shouldMirror).
        await user.setFlag(MODULE, FLAG, { global: neverChoseRef() });
        await settings().set(MODULE, 'theme', 'default');
      }
      return true;
    case 'die':
      if (!DIE_TYPES.includes(t.key)) return false;
      await user.setFlag(MODULE, FLAG, slotPatch(t.key, id));
      return true;
    case 'role':
      if (!ROLL_ROLES.includes(t.key)) return false;
      await user.setFlag(MODULE, FLAG, slotPatch(roleSlot(t.key), id));
      return true;
    case 'actor': {
      const actor = globalThis.game?.actors?.get?.(t.key);
      if (!actor || actor.isOwner !== true) return false;
      await actor.setFlag(MODULE, FLAG, slotPatch('global', id));
      return true;
    }
    case 'damage':
      return writeDamageMap('damageThemeOverrides', t.key, id);
    case 'worlddamage':
      if (!user.isGM) return false;
      return writeDamageMap('damageTypeMap', t.key, id);
    default:
      return false;
  }
}

export const clearTarget = (target) => assignTarget(target, null);

// Stored data of the wrong shape is never overwritten: the write is refused and warned once.
const warnedShapes = new Set();
const refuse = (what) => {
  if (!warnedShapes.has(what)) {
    warnedShapes.add(what);
    notify('warn', `${loc('DICER.Themes.StoredUnusable')} (${what})`);
  }
  return null;
};
/** The stored list; [] when never set; null (refused, warned once) when it is not an array. */
const listOf = (v, what) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : refuse(what));
const userList = () => listOf(me()?.getFlag?.(MODULE, 'themes'), 'themes');
const worldList = () => listOf(settings()?.get(MODULE, 'worldThemes'), 'worldThemes');
const saveUserList = (list) => me().setFlag(MODULE, 'themes', list);
const saveWorldList = (list) => settings().set(MODULE, 'worldThemes', list);

async function writeDamageMap(setting, type, id) {
  const next = assignDamage(settings().get(MODULE, setting), type, id);
  if (next === null) {
    refuse(setting);
    return false;
  }
  await settings().set(MODULE, setting, next);
  return true;
}

/** Saves one raw theme into My themes (replacing the entry of the same id); all other entries are kept. False when refused. */
export async function saveMine(raw) {
  const list = userList();
  if (!list) return false;
  await saveUserList(upsertTheme(list, raw));
  return true;
}

/** Removes one of My themes (only that entry; unreadable entries stay). False when refused. */
export async function deleteMine(id) {
  const list = userList();
  if (!list) return false;
  await saveUserList(removeTheme(list, id));
  return true;
}

/** Whether `id` is the GM's world default theme (worldDefaultTheme). */
export function isWorldDefault(id) {
  try {
    const current = settings()?.get(MODULE, 'worldDefaultTheme');
    return typeof current === 'string' && current !== '' && current === id;
  } catch {
    return false;
  }
}

/**
 * GM only: removes a world theme. Deleting the world default also clears worldDefaultTheme
 * (none): the lock then has no effect (it needs a default), and players use their own looks.
 */
export async function deleteWorld(id) {
  if (!me()?.isGM) return false;
  const list = worldList();
  if (!list) return false;
  await saveWorldList(removeTheme(list, id));
  if (isWorldDefault(id)) await settings().set(MODULE, 'worldDefaultTheme', '');
  return true;
}

/** GM only: copies the theme into the world themes. */
export function publish(theme) {
  const isGM = Boolean(me()?.isGM);
  const list = isGM ? worldList() : [];
  if (!list) return Promise.resolve({ ok: false, reason: 'unreadable' });
  return publishToWorld(theme, { isGM, worldList: list, setWorld: saveWorldList });
}

/** A copy of the theme in My themes; returns the new raw theme (null when refused). */
export async function duplicate(theme) {
  const list = userList();
  if (!list) return null;
  const copy = duplicateTheme(theme, me().id, list, loc('DICER.Themes.Copy'));
  await saveMine(copy);
  return copy;
}

/**
 * GM only: sets `themeId` as the default (global slot) of every non-GM user, by writing their look
 * flag. Their per-type and per-role choices stay unless `replaceAll`, which also clears them.
 * A player whose flag cannot be written is skipped and not counted.
 * @returns {Promise<{updated: number, refused?: boolean}>}
 */
export async function pushThemeToPlayers(themeId, { replaceAll = false } = {}) {
  if (!me()?.isGM) return { updated: 0, refused: true };
  if (typeof themeId !== 'string' || !themeId) return { updated: 0 };
  // Only themes every player can resolve: built-in or world. A GM's own theme is not shared.
  let world = [];
  try {
    world = readThemeList(settings()?.get(MODULE, 'worldThemes'), 'world', () => {});
  } catch {
    world = [];
  }
  if (!findTheme(themeId, { worldThemes: world })) {
    notify('warn', loc('DICER.Themes.PushNotShared'));
    return { updated: 0, refused: true };
  }
  const users = globalThis.game?.users;
  let updated = 0;
  for (const player of users ? [...users] : []) {
    if (!player || player.isGM) continue;
    const patch = { global: chosenRef(themeId) };
    if (replaceAll) {
      let flag = null;
      try {
        flag = player.getFlag?.(MODULE, FLAG);
      } catch {
        flag = null;
      }
      if (flag && typeof flag === 'object' && !Array.isArray(flag)) {
        for (const key of Object.keys(flag)) if (key !== 'global') Object.assign(patch, slotPatch(key, null));
      }
    }
    try {
      await player.setFlag(MODULE, FLAG, patch);
      updated++;
    } catch {
      /* this player is skipped */
    }
  }
  return { updated };
}

/**
 * Uses a module dice set (a colorset or system entry of module-dice.js) for a target: this user's
 * default (the look flag's global slot), a die type or roll role slot, or an owned actor. Damage
 * targets hold theme ids only, so they are refused, as is everything under the GM's lock.
 */
export async function useModuleDice(entry, target = 'default') {
  const user = me();
  const t = typeof target === 'string' ? parseTarget(target) : target;
  if (!user || !entry || !t || isLocked()) return false;
  if (t.kind === 'actor') {
    const actor = globalThis.game?.actors?.get?.(t.key);
    if (!actor || actor.isOwner !== true) return false;
    // no fallback theme: dice the set has no preset for keep the player's own look
    await actor.setFlag(MODULE, FLAG, useModulePatch(entry, actor.getFlag?.(MODULE, FLAG)?.global, null));
    return true;
  }
  const slot = t.kind === 'default' ? 'global' : t.kind === 'die' && DIE_TYPES.includes(t.key) ? t.key : t.kind === 'role' && ROLL_ROLES.includes(t.key) ? roleSlot(t.key) : null;
  if (!slot) return false;
  let theme = 'default';
  try {
    theme = settings()?.get(MODULE, 'theme') ?? 'default';
  } catch {
    /* settings not ready */
  }
  const looks = readUserLooks(user, { fill: false });
  await user.setFlag(MODULE, FLAG, useModulePatch(entry, looks[slot], slot === 'global' ? theme : null, slot));
  return true;
}

/** The user flag listing the dice sets whose own natural 20 / natural 1 they turned off (compat/installed-dice.js). */
const SET_FX_OFF = 'setFxOff';

/** Whether this user plays a dice set's own natural 20 / natural 1 effects (on unless turned off). */
export const setFxOn = (system) => {
  const off = me()?.getFlag?.(MODULE, SET_FX_OFF);
  return !(Array.isArray(off) && off.includes(system));
};

/** Turns a dice set's own natural 20 / natural 1 effects on or off for this user's rolls. */
export async function setSetFx(system, on) {
  const user = me();
  if (!user || typeof system !== 'string') return false;
  const off = user.getFlag?.(MODULE, SET_FX_OFF);
  const list = (Array.isArray(off) ? off : []).filter((s) => s !== system);
  if (!on) list.push(system);
  await user.setFlag(MODULE, SET_FX_OFF, list);
  return true;
}

/** The user flag of a player whose default dice follow Ember's moons (compat/installed-dice.js). */
const MOON_DICE = 'moonDice';

/** Whether this user's default dice follow Ember's moons. */
export const moonDiceOn = () => me()?.getFlag?.(MODULE, MOON_DICE) === true;

/** Has this user's default dice follow Ember's moons, or not. */
export async function setMoonDice(on) {
  const user = me();
  if (!user) return false;
  await user.setFlag(MODULE, MOON_DICE, on === true);
  return true;
}

/** Stops using the module system of the global slot (its look stays). */
export async function stopModuleSystem(entry) {
  const user = me();
  if (!user || isLocked()) return false;
  await user.setFlag(MODULE, FLAG, stopSystemPatch(entry));
  return true;
}

/** The look of this user's default theme (the `theme` setting), or null when it cannot be read. */
function myLook() {
  try {
    const id = settings()?.get(MODULE, 'theme');
    const t = findTheme(id, { worldThemes: readThemeList(settings()?.get(MODULE, 'worldThemes'), 'world', () => {}), userThemes: readThemeList(me()?.getFlag?.(MODULE, 'themes'), 'user', () => {}) });
    return t?.appearance ? JSON.parse(JSON.stringify(t.appearance)) : null;
  } catch {
    return null;
  }
}

/**
 * Copies a module dice set into My themes; `{raw, dropped}`, or null when refused. A set whose
 * look is all in its 3D models (no colours) takes its colours from them (`lookFromModels`), so
 * the theme starts near the set instead of as Dicer's default.
 */
export async function importModuleDice(entry, { lookFromModels = modelLookOf } = {}) {
  const list = userList();
  if (!list || !entry) return null;
  const ids = list.map((t) => (isPlainObjectLike(t) ? t.id : undefined)).filter(Boolean);
  if (entry.colourless && entry.models) {
    const look = await Promise.resolve()
      .then(() => lookFromModels(entry.models))
      .catch(() => null);
    if (look) entry = { ...entry, appearance: look, perType: {} };
  } else if (entry.noColours) {
    // a set that names no colours shows on the player's own look (as the Module dice tab shows it):
    // the theme starts from that look, not Dicer's default (Clear Resin)
    const look = myLook();
    if (look) entry = { ...entry, appearance: look, perType: {} };
  }
  const res = moduleThemeRaw(entry, userThemeId(me().id, entry.name, ids));
  await saveUserList(upsertTheme(list, res.raw));
  return res;
}

/** "custom faces (d20), 3D models (d6)": what a theme could not keep. */
const DROP_LABEL = {
  faces: 'DICER.Themes.Module.Drop.faces',
  models: 'DICER.Themes.Module.Drop.models',
  texture: 'DICER.Themes.Module.Drop.texture',
  font: 'DICER.Themes.Module.Drop.font',
};
const droppedText = (dropped) =>
  dropped.map((d) => `${loc(DROP_LABEL[d.kind] ?? d.kind)}${d.types.length ? ` (${d.types.join(', ')})` : ''}`).join(', ');

/** Writes one theme, or all of My themes, to a .json file. */
export function exportToFile(themes, filename) {
  foundry.utils.saveDataToFile(exportJson(themes), 'application/json', filename);
}

/**
 * Imports a theme file into My themes. Warnings (themes that did not validate, odd values) are
 * returned and shown in one notification.
 */
export async function importFromText(text) {
  const existing = userList();
  if (!existing) return { themes: [], warnings: [] };
  const existingIds = existing.map((t) => t?.id).filter(Boolean);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* importThemes reports it */
  }
  // a Dice So Nice export (its whole settings, or its dice library): its dice become themes
  const migration = await import('../compat/migration.js');
  const { themes, warnings } = migration.isDsnFile(parsed)
    ? (() => {
        const found = migration.dsnFileThemes(parsed, { userId: me().id, taken: existingIds, registry: globalThis.game?.dice3d?._registry });
        return { themes: found, warnings: found.length ? [] : [loc('DICER.Themes.DsnFileEmpty')] };
      })()
    : importThemes(text, me().id, { existingIds });
  let list = existing;
  for (const t of themes) list = upsertTheme(list, t);
  if (themes.length) await saveUserList(list);
  const summary = `${loc('DICER.Themes.Imported')} ${themes.length}`;
  if (warnings.length) notify('warn', `${summary}. ${warnings.join(' ')}`);
  else notify('info', summary);
  return { themes, warnings };
}

// --- view model -------------------------------------------------------------------------------
const label = (raw) => (raw && typeof raw === 'object' && (raw.name || raw.id)) || '?';

/** The target select's groups: default, die types, roll roles, owned actors, damage types. */
export function targetGroups({ actors = [], damageTypes = [], isGM = false } = {}) {
  const groups = [
    { label: loc('DICER.Themes.Group.default'), options: [{ value: 'default', label: loc('DICER.Themes.MyDefault') }] },
    { label: loc('DICER.Themes.Group.die'), options: DIE_TYPES.map((t) => ({ value: `die:${t}`, label: t })) },
    { label: loc('DICER.Themes.Group.role'), options: ROLL_ROLES.map((r) => ({ value: `role:${r}`, label: loc(ROLE_LABEL[r]) })) },
  ];
  if (actors.length)
    groups.push({ label: loc('DICER.Themes.Group.actor'), options: actors.map((a) => ({ value: `actor:${a.id}`, label: a.name })) });
  groups.push({
    label: loc('DICER.Themes.Group.damage'),
    options: damageTypes.map((t) => ({ value: `damage:${t}`, label: humanize(t) })),
  });
  if (isGM)
    groups.push({
      label: loc('DICER.Themes.Group.worldDamage'),
      options: damageTypes.map((t) => ({ value: `worlddamage:${t}`, label: humanize(t) })),
    });
  return groups;
}

/** target value -> a short readable label ("Die type: d20"); unknown targets show as they are. */
export function targetLabeller(groups) {
  const labels = new Map();
  for (const g of groups)
    for (const o of g.options) labels.set(o.value, o.value === 'default' ? o.label : `${g.label}: ${o.label}`);
  return (target) => labels.get(target) ?? String(target);
}

/** The card to show in the detail panel: the current one if still visible, else the default theme, else the first. */
export function pickSelected(visible, current, defaultId) {
  if (visible.some((t) => t.id === current)) return current;
  if (visible.some((t) => t.id === defaultId)) return defaultId;
  return visible[0]?.id ?? null;
}

/**
 * Whether a card matches the search box: every word of `query` (case-insensitive) is in its name,
 * or for a module dice set also in its group (often the module's name) or its system id. An empty
 * query matches everything.
 */
export function matchesQuery(entry, query) {
  const words = String(query ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const parts = [entry?.name];
  if (entry?.source === 'module') parts.push(entry.category, entry.key);
  const text = parts.filter((p) => typeof p === 'string').join(' ').toLocaleLowerCase();
  return words.every((w) => text.includes(w));
}

/** How long typing pauses before the gallery filters (ms): 300 cards are not drawn per key. */
const SEARCH_DELAY = 150;

let instance = null;

export class ThemeBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-theme-browser',
    tag: 'div',
    classes: ['dicer-theme-browser'],
    window: { title: 'DICER.Themes.Title', icon: 'fa-solid fa-dice-d20', resizable: true },
    position: { width: 900, height: 680 },
    actions: {
      filter: ThemeBrowser.#onFilter,
      select: ThemeBrowser.#onSelect,
      useDefault: ThemeBrowser.#onUseDefault,
      worldDefault: ThemeBrowser.#onWorldDefault,
      apply: ThemeBrowser.#onApply,
      clear: ThemeBrowser.#onClear,
      duplicate: ThemeBrowser.#onDuplicate,
      throwTheme: ThemeBrowser.#onThrowTheme,
      edit: ThemeBrowser.#onEdit,
      create: ThemeBrowser.#onCreate,
      exportOne: ThemeBrowser.#onExportOne,
      exportMine: ThemeBrowser.#onExportMine,
      importThemes: ThemeBrowser.#onImport,
      publish: ThemeBrowser.#onPublish,
      push: ThemeBrowser.#onPush,
      remove: ThemeBrowser.#onRemove,
      useModule: ThemeBrowser.#onUseModule,
      stopModule: ThemeBrowser.#onStopModule,
      setFx: ThemeBrowser.#onSetFx,
      moonDice: ThemeBrowser.#onMoonDice,
      importModule: ThemeBrowser.#onImportModule,
      openPet: ThemeBrowser.#onOpenPet,
      openTray: ThemeBrowser.#onOpenTray,
      openStats: ThemeBrowser.#onOpenStats,
      openInstalledDice: ThemeBrowser.#onOpenInstalledDice,
      openSettings: ThemeBrowser.#onOpenSettings,
    },
  };

  static PARTS = {
    body: { template: 'modules/dicer/templates/theme-browser.hbs', scrollable: ['.dicer-theme-grid'] },
  };

  #filter = 'all';
  #query = ''; // the search box's text, kept while the window is open (every tab filters by it)
  #searchTimer = null;
  #searchCaret = null; // [start, end] of the search box's selection while it has focus, restored after a render
  #selected = null; // the theme id shown in the detail panel
  #target = null; // the "Use this theme for" value the select starts on (an actor's Dice look button sets it)
  #urls = new Map(); // theme id -> thumbnail URL already made (re-renders show it at once)
  #thumbs = null;
  #preview = null; // the live turning die of the detail panel (thumbnailer.preview)
  #token = 0;
  #modules = null; // module dice entries, read from the registry once per render

  get #isGM() {
    return Boolean(me()?.isGM);
  }

  get #locked() {
    return isLocked();
  }

  #moduleEntries() {
    return (this.#modules ??= moduleDiceEntries(registryView(globalThis.game?.dice3d)));
  }

  /**
   * Points the "Use this theme for" select at a target (e.g. 'actor:<id>'). For an actor it also
   * shows that actor's current theme in the detail panel (on all filters, so it is not hidden).
   * Call before render; a target that is not on offer (not owned) just selects nothing.
   */
  focusTarget(target, { select = true } = {}) {
    this.#target = typeof target === 'string' && target ? target : null;
    if (!select) return;
    const parsed = parseTarget(this.#target);
    const actor = parsed?.kind === 'actor' ? this.#actors().find((a) => a.id === parsed.key) : null;
    if (actor?.theme && this.#find(actor.theme)) {
      this.#filter = 'all';
      this.#query = ''; // a search would hide it too
      this.#selected = actor.theme;
    }
  }

  #entries() {
    return galleryEntries({ worldList: worldList(), userList: userList(), warn: () => {} });
  }

  #find(id) {
    return this.#entries().themes.find((t) => t.id === id) ?? this.#moduleEntries().find((e) => e.id === id) ?? null;
  }

  #actors() {
    const list = globalThis.game?.actors;
    const all = list ? [...list] : [];
    return all
      .filter((a) => a?.isOwner === true)
      .map((a) => {
        let global = null;
        try {
          global = a.getFlag?.(MODULE, FLAG)?.global ?? null;
        } catch {
          global = null;
        }
        return { id: a.id, name: String(a.name ?? a.id), theme: global?.theme ?? null, global };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The user's current assignments (default, look slots, owned actors, damage overrides) by theme id. */
  #assignments() {
    const user = me();
    let looks = null;
    let damage = null;
    try {
      looks = user?.getFlag?.(MODULE, FLAG) ?? null;
      damage = settings()?.get(MODULE, 'damageThemeOverrides') ?? null;
    } catch {
      /* settings not ready */
    }
    const actors = this.#actors();
    const out = themeAssignments({
      defaultId: this.#defaultId(looks),
      looks,
      actors,
      damageOverrides: damage,
    });
    const mods = this.#moduleEntries();
    // A module system is used on top of the look, so it is a second "Your default".
    const { system } = currentModuleIds(looks?.global, mods);
    if (system) out.set(system, ['default']);
    // module sets used for a die type, a roll role or an actor
    const tag = (ref, target) => {
      const ids = currentModuleIds(ref, mods);
      for (const id of [ids.colorset, ids.system]) if (id) (out.get(id) ?? out.set(id, []).get(id)).push(target);
    };
    for (const [slot, ref] of isPlainObjectLike(looks) ? Object.entries(looks) : [])
      if (DIE_TYPES.includes(slot)) tag(ref, `die:${slot}`);
      else if (slot.startsWith('role:')) tag(ref, slot);
    for (const a of actors) tag(a.global, `actor:${a.id}`);
    return out;
  }

  /**
   * "Your default": the stored global theme (a push writes it, P7-R6). With no stored choice (no
   * global, or a never-chose one) the GM's world default when it names a theme that exists, as
   * the resolver does (P7-R5); else the client setting.
   */
  #defaultId(looks) {
    const global = isPlainObjectLike(looks?.global) ? looks.global : null;
    const noChoice = !global || isNeverChose(global);
    if (!noChoice) {
      // A registered module colorset outranks the slot's theme (lookRefToAppearance).
      const { colorset } = currentModuleIds(global, this.#moduleEntries());
      if (colorset) return colorset;
      if (typeof global.theme === 'string' && global.theme) return global.theme;
    } else {
      let world = '';
      try {
        world = settings()?.get(MODULE, 'worldDefaultTheme') ?? '';
      } catch {
        world = '';
      }
      if (typeof world === 'string' && world && this.#find(world)) return world;
    }
    try {
      return settings()?.get(MODULE, 'theme');
    } catch {
      return 'default';
    }
  }

  async _prepareContext() {
    this.#modules = null; // a module may have registered more since the last render
    const { themes, unreadable } = this.#entries();
    const modules = this.#moduleEntries();
    const filter = Object.hasOwn(FILTER_KEYS, this.#filter) || BROWSER_TABS.has(this.#filter) ? this.#filter : 'all';
    const isGM = this.#isGM;
    const groups = targetGroups({
      actors: this.#actors(),
      damageTypes: damageTypeList({ systemId: globalThis.game?.system?.id }),
      isGM,
    });
    const assignments = this.#assignments();
    for (const g of groups) for (const o of g.options) if (o.value === this.#target) o.selected = true;
    const labelOf = targetLabeller(groups);
    const query = this.#query;
    const found = themes.filter((t) => matchesQuery(t, query));
    const foundModules = modules.filter((t) => matchesQuery(t, query));
    // All leaves out the add-on themes whose module holds them back (registerTheme's showInAll)
    const inAllTab = found.filter((t) => t.source !== 'addon' || inAll(t));
    // a module's tab (api.registerBrowserTab): its filter picks the themes, in its order and sections
    const tabs = [...BROWSER_TABS.values()].map((tab) => ({ tab, entries: tabEntries(tab, found) }));
    const sectionOf = new Map();
    let visible = filter === 'module' ? foundModules : filter === 'all' ? inAllTab : found.filter((t) => t.source === filter);
    const active = tabs.find((x) => x.tab.id === filter);
    if (active) {
      visible = active.entries.map((e) => e.theme);
      for (const e of active.entries) if (e.section) sectionOf.set(e.theme.id, e.section);
    }
    const defaultId = [...assignments].find(([, list]) => list.includes('default'))?.[0] ?? 'default';
    this.#selected = pickSelected(visible, this.#selected, defaultId);
    const view = (t) => {
      const targets = assignments.get(t.id) ?? [];
      const others = targets.filter((x) => x !== 'default');
      const isModule = t.source === 'module';
      const theme = !isModule;
      return {
        id: t.id,
        name: t.name,
        source: t.source,
        // a module's registered theme (api.registerTheme) is named by its module: read-only, duplicable
        sourceLabel:
          (isModule && t.category) ||
          (t.source === 'addon' && (t.badge || (globalThis.game?.modules?.get?.(t.moduleId)?.title ?? t.moduleId))) ||
          loc(SOURCE_LABEL[t.source] ?? SOURCE_LABEL.user),
        showBadge: t.source !== 'builtin', // cards name only world, own and module sets; the detail panel always does
        isModule,
        credit: t.author ? loc('DICER.Themes.By').replace('{name}', t.author) : '', // who designed it
        kindLabel: isModule ? loc(t.kind === 'system' ? 'DICER.Themes.Module.System' : 'DICER.Themes.Module.Colorset') : '',
        dropNote: isModule && t.dropped.length ? `${loc('DICER.Themes.Module.Dropped')} ${droppedText(t.dropped)}` : '',
        canStop: isModule && t.kind === 'system' && targets.includes('default'),
        // a set that brings its own natural 20 / natural 1 effects: this user may turn them off
        setFx: isModule && t.kind === 'system' && setRules.has?.(t.key) === true,
        setFxOn: isModule && setFxOn(t.key),
        // a moon's dice set (Ember Lunar Dice): this user's default dice may follow the moons
        moonDice: isModule && t.kind === 'system' && setRules.moonSet?.(t.key) === true,
        moonDiceOn: isModule && moonDiceOn(),
        swatch: t.appearance?.body?.color ?? '#444',
        selected: t.id === this.#selected,
        section: sectionOf.get(t.id) ?? '',
        isDefault: targets.includes('default'),
        slotCount: others.length,
        slotTooltip: others.map(labelOf).join(', '),
        assigned: targets.map((target) => ({ target, label: labelOf(target), isDefault: target === 'default' })),
        canEdit: t.source === 'user' || (t.source === 'world' && isGM),
        canPublish: theme && isGM && t.source !== 'world',
        canPush: theme && isGM && t.source !== 'user',
        canDelete: t.source === 'user' || (t.source === 'world' && isGM),
        // the world default: a theme every player has (built-in or world), set by the GM
        // (a module's registered theme too: every client registers it)
        canWorldDefault: isGM && ['builtin', 'world', 'addon'].includes(t.source),
        isWorldDefault: ['builtin', 'world', 'addon'].includes(t.source) && isWorldDefault(t.id),
      };
    };
    const cards = visible.map(view);
    // a section heading shows once, above the first card of its run, not above every card
    let lastSection = '';
    for (const c of cards) {
      const own = c.section;
      c.section = own !== lastSection ? own : '';
      lastSection = own;
    }
    return {
      locked: this.#locked,
      isGM: globalThis.game?.user?.isGM === true,
      lockedNotice: loc('DICER.Themes.Locked'),
      filter,
      query,
      // the counts are of what the search matches on each tab
      filters: Object.entries(FILTER_KEYS)
        .filter(([id]) => id !== 'module' || modules.length || filter === 'module') // only when a module registered any
        .map(([id, key]) => ({
          id,
          label: loc(key),
          active: id === filter,
          count: id === 'all' ? inAllTab.length : id === 'module' ? foundModules.length : found.filter((t) => t.source === id).length,
        }))
        .concat(
          tabs.map(({ tab, entries }) => ({
            id: tab.id,
            label: loc(tab.label),
            active: tab.id === filter,
            count: entries.length,
            iconClass: tab.icon && !/[/.]/.test(tab.icon) ? tab.icon : '',
            iconSrc: tab.icon && /[/.]/.test(tab.icon) ? tab.icon : '',
          })),
        ),
      targetGroups: groups,
      // a module set: not the damage maps, which hold theme ids
      moduleTargetGroups: groups.filter((g) => !g.options.some((o) => /^(world)?damage:/.test(o.value))),
      cards,
      hasCards: cards.length > 0,
      noMatch: cards.length === 0 && query.trim() !== '',
      detail: cards.find((c) => c.selected) ?? null,
      unreadable: unreadable.map((u) => ({ label: label(u.raw), sourceLabel: loc(SOURCE_LABEL[u.source]) })),
    };
  }

  /** Thumbnails: one theme at a time through the offscreen renderer; the swatch stays until one arrives. */
  _onRender() {
    const file = this.element.querySelector('.dicer-theme-file');
    file?.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        await importFromText(await foundry.utils.readTextFromFile(f));
      } catch (err) {
        notify('error', `${loc('DICER.Themes.ImportFailed')} ${err?.message ?? err}`);
      }
      this.render();
    });
    // The select resets on every render; remember its value so a re-render keeps the chosen place.
    const target = this.element.querySelector('.dicer-target');
    target?.addEventListener('change', () => this.focusTarget(target.value, { select: false }));
    this.#bindSearch();
    this.#loadThumbnails();
    this.#startPreview();
  }

  /**
   * The search box filters as the user types (after a short pause). A render rebuilds the box, so
   * while it had focus the new one gets the focus and the caret back.
   */
  #bindSearch() {
    const box = this.element?.querySelector?.('.dicer-theme-search input');
    if (!box) return;
    box.value = this.#query;
    if (this.#searchCaret) {
      const [start, end] = this.#searchCaret;
      box.focus();
      try {
        box.setSelectionRange(Math.min(start, box.value.length), Math.min(end, box.value.length));
      } catch {
        /* an input type without a selection */
      }
    }
    this.#searchCaret = null;
    box.addEventListener('input', () => this.setQuery(box.value));
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !box.value) return;
      event.preventDefault();
      event.stopPropagation(); // Escape empties the box instead of closing the window
      box.value = '';
      this.setQuery('', { now: true });
    });
  }

  /**
   * Before a render replaces the box: its selection when it has the focus (read here, not on blur,
   * since a browser may blur an element as it is removed).
   */
  async _preRender(...args) {
    await super._preRender?.(...args);
    const box = this.element?.querySelector?.('.dicer-theme-search input');
    const focused = box && box.ownerDocument?.activeElement === box;
    this.#searchCaret = focused ? [box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length] : null;
  }

  /** Filters the cards by `text` (see matchesQuery); renders after SEARCH_DELAY, or at once with `now`. */
  setQuery(text, { now = false } = {}) {
    const next = String(text ?? '');
    clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    if (next === this.#query) return Promise.resolve();
    this.#query = next;
    if (now) return this.render();
    return new Promise((done) => {
      this.#searchTimer = setTimeout(() => {
        this.#searchTimer = null;
        done(this.render());
      }, SEARCH_DELAY);
    });
  }

  /** The search box's text. */
  get query() {
    return this.#query;
  }

  /** The offscreen renderer (made on first use); null when the dice atlas is not available. */
  #thumbnailer() {
    if (this.#thumbs) return this.#thumbs;
    let atlas = null;
    let fonts = null;
    try {
      const context = globalThis.game?.dice3d?._themeContext?.();
      atlas = context?.atlas ?? null;
      fonts = context?.fonts ?? null;
    } catch {
      atlas = null;
    }
    if (atlas) this.#thumbs = createThumbnailer({ atlas, fonts, size: 256 });
    return this.#thumbs;
  }

  #stopPreview() {
    this.#preview?.stop();
    this.#preview = null;
  }

  /**
   * The detail panel's d20 turns live on a canvas (same renderer as the thumbnails). It starts on
   * every render for the selected theme and stops on the next one, on close, and when WebGL is lost
   * (the static thumbnail then shows again).
   */
  #startPreview() {
    this.#stopPreview();
    const canvas = this.element?.querySelector?.('canvas.dicer-live');
    const theme = canvas ? this.#find(this.#selected) : null;
    const thumbs = theme && !theme.preview && !theme.stub ? this.#thumbnailer() : null; // a static preview needs no live die
    if (!thumbs) return;
    const stage = canvas.closest('.dicer-stage');
    const css = Math.round((stage?.clientWidth || 190) * 0.92); // the canvas fills 92% of its stage
    canvas.width = canvas.height = Math.max(1, Math.round(css * Math.min(globalThis.devicePixelRatio || 1, 2)));
    const live = (on) => {
      canvas.hidden = !on;
      stage?.classList.toggle('has-live', on);
    };
    this.#preview = thumbs.preview(canvas, theme, 'd20', {
      onFrame: () => canvas.hidden && live(true),
      onLost: () => {
        live(false);
        this.#preview = null;
      },
    });
  }

  /** Shows a thumbnail on every image of that theme (its card and the detail preview). */
  #show(id, url) {
    for (const img of this.element.querySelectorAll('img.dicer-thumb')) {
      if (img.dataset.theme !== id) continue;
      img.src = url;
      img.hidden = false;
      img.closest('.dicer-stage')?.classList.add('has-thumb');
    }
  }

  async #loadThumbnails() {
    const token = ++this.#token;
    const cards = [...this.element.querySelectorAll('.dicer-theme-card')];
    if (!cards.length) return;
    for (const card of cards) {
      const url = this.#urls.get(card.dataset.theme);
      if (url) this.#show(card.dataset.theme, url);
    }
    const themes = new Map([...this.#entries().themes, ...this.#moduleEntries()].map((t) => [t.id, t]));
    // a theme with a static `preview` image shows it, with no 3D render (works without WebGL too)
    for (const card of cards) {
      const id = card.dataset.theme;
      const preview = themes.get(id)?.preview;
      if (preview && !this.#urls.has(id)) {
        this.#urls.set(id, preview);
        this.#show(id, preview);
      }
    }
    const thumbs = this.#thumbnailer();
    if (!thumbs) return;
    // The selected theme first, so the detail preview fills in at once.
    const first = (card) => (card.dataset.theme === this.#selected ? 0 : 1);
    const order = [...cards].sort((x, y) => first(x) - first(y));
    for (const card of order) {
      const id = card.dataset.theme;
      const theme = themes.get(id);
      if (!theme || theme.stub || this.#urls.has(id)) continue;
      const url = await thumbs.thumbnail(theme, 'd20').catch(() => null);
      if (token !== this.#token || this.#thumbs !== thumbs) return;
      if (!url) continue;
      this.#urls.set(id, url);
      this.#show(id, url);
    }
  }

  static #themeOf(app, target) {
    return app.#find(target.dataset.theme);
  }

  /** The theme of a button, loading it first when it is still a module's stub. */
  static async #themeLoaded(app, target) {
    const theme = app.#find(target.dataset.theme);
    if (!theme?.stub) return theme;
    await loadStub(theme.id, { retry: true });
    return app.#find(theme.id)?.stub ? null : app.#find(theme.id);
  }

  /** The place an Apply / Clear button acts on: its own data-target (an assignment chip), else the detail panel's select. */
  static #targetOf(target) {
    return target.dataset.target ?? target.closest('.dicer-theme-detail')?.querySelector('.dicer-target')?.value;
  }

  /** Rolls one of each die with the theme on the table (local only). */
  static async #onThrowTheme(event, target) {
    const theme = await ThemeBrowser.#themeLoaded(this, target);
    if (!theme) return;
    const api = globalThis.game?.dice3d;
    if (typeof api?._throwLook !== 'function') {
      notify('warn', loc('DICER.Appearance.PreviewUnavailable'));
      return;
    }
    await api._throwLook(theme);
  }

  static async #onFilter(event, target) {
    const next = target.dataset.filter;
    if (!(Object.hasOwn(FILTER_KEYS, next) || BROWSER_TABS.has(next)) || next === this.#filter) return;
    this.#filter = next;
    await this.render();
  }

  static async #onSelect(event, target) {
    const id = target.closest('[data-theme]')?.dataset.theme;
    if (!id || id === this.#selected) return;
    this.#selected = id;
    if (STUBS.has(id)) await loadStub(id, { retry: true }); // the full theme replaces the stub, then the panel shows it
    await this.render();
  }

  static async #onUseDefault(event, target) {
    if (this.#locked) return;
    if (!(await assignTarget('default', target.dataset.theme))) return;
    notify('info', loc('DICER.Themes.Applied'));
    await this.render();
  }

  /** GM only: makes the theme the world default (worldDefaultTheme), or clears it (an empty id). */
  static async #onWorldDefault(event, target) {
    if (!this.#isGM) return;
    const id = target.dataset.theme ?? '';
    try {
      await settings().set(MODULE, 'worldDefaultTheme', id);
    } catch {
      notify('warn', loc('DICER.Themes.NotAllowed'));
      return;
    }
    notify('info', loc(id ? 'DICER.Themes.WorldDefaultSet' : 'DICER.Themes.WorldDefaultCleared'));
    await this.render();
  }

  static async #onApply(event, target) {
    if (this.#locked) return;
    const entry = ThemeBrowser.#themeOf(this, target);
    const to = ThemeBrowser.#targetOf(target);
    const ok = entry?.source === 'module' ? await useModuleDice(entry, to) : await assignTarget(to, target.dataset.theme);
    notify(ok ? 'info' : 'warn', loc(ok ? 'DICER.Themes.Applied' : 'DICER.Themes.NotAllowed'));
    if (ok) await this.render();
  }

  static async #onClear(event, target) {
    if (this.#locked) return;
    const ok = await clearTarget(ThemeBrowser.#targetOf(target));
    notify(ok ? 'info' : 'warn', loc(ok ? 'DICER.Themes.Cleared' : 'DICER.Themes.NotAllowed'));
    if (ok) await this.render();
  }

  static async #onUseModule(event, target) {
    if (this.#locked) return;
    const entry = ThemeBrowser.#themeOf(this, target);
    if (entry?.source !== 'module' || !(await useModuleDice(entry))) return;
    notify('info', loc('DICER.Themes.Applied'));
    await this.render();
  }

  static async #onStopModule(event, target) {
    if (this.#locked || !(await stopModuleSystem(ThemeBrowser.#themeOf(this, target)))) return;
    notify('info', loc('DICER.Themes.Cleared'));
    await this.render();
  }

  static async #onSetFx(event, target) {
    const entry = ThemeBrowser.#themeOf(this, target);
    if (entry?.source !== 'module' || !(await setSetFx(entry.key, target.checked))) return;
    await this.render();
  }

  static async #onMoonDice(event, target) {
    const entry = ThemeBrowser.#themeOf(this, target);
    if (entry?.source !== 'module' || this.#locked || !(await setMoonDice(target.checked))) return;
    await this.render();
  }

  /** Import as theme: a theme of mine from the set, opened in the editor; what it cannot hold is named. */
  static async #onImportModule(event, target) {
    const entry = ThemeBrowser.#themeOf(this, target);
    if (entry?.source !== 'module') return;
    const res = await importModuleDice(entry);
    if (!res) return;
    const done = `${loc('DICER.Themes.Module.Imported')} ${res.raw.name}`;
    if (res.dropped.length)
      notify('warn', `${done}. ${loc('DICER.Themes.Module.Dropped')} ${droppedText(res.dropped)}. ${loc('DICER.Themes.Module.KeepHint')}`);
    else notify('info', done);
    this.#filter = 'user';
    this.#query = ''; // the new theme is shown even when the search would hide it
    this.#selected = res.raw.id;
    await this.render();
    return this.#openEditor({ themeId: res.raw.id });
  }

  /** The Your pet window (its own lazy chunk): the pet is the player's, not part of a theme. */
  static async #onOpenPet() {
    const m = await import('./pet-window.js');
    return m.openPetWindow();
  }

  /** The Roll stats window (its own lazy chunk). */
  static async #onOpenStats() {
    const m = await import('./roll-stats.js');
    return m.openRollStats();
  }

  /** The Dice tray window (its own lazy chunk). */
  static async #onOpenInstalledDice() {
    const m = await import('./installed-dice.js');
    return m.openInstalledDice();
  }

  static async #onOpenTray() {
    const m = await import('./tray-editor.js');
    return m.openTrayEditor();
  }

  /** Foundry's settings, on Dicer's page. */
  static async #onOpenSettings() {
    const sheet = globalThis.game?.settings?.sheet;
    if (!sheet) return;
    await sheet.render({ force: true });
    try {
      sheet.changeTab?.('dicer', 'categories');
    } catch {
      /* another layout: the settings stay on their first page */
    }
  }

  /** Opens the appearance editor (its own lazy chunk); a save there refreshes the gallery. */
  #openEditor(options) {
    const onSave = (id) => {
      this.#selected = id;
      this.#urls.clear(); // an edited theme keeps its id: make its thumbnail again
      this.render();
    };
    return import('./appearance-editor.js').then((m) => m.openAppearanceEditor({ ...options, onSave }));
  }

  /** Duplicate opens the editor on an unsaved copy; it becomes a theme of mine on Save. */
  static async #onDuplicate(event, target) {
    const theme = await ThemeBrowser.#themeLoaded(this, target);
    if (theme) return this.#openEditor({ base: theme });
  }

  static #onEdit(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme) return;
    if (theme.source === 'user' || (theme.source === 'world' && this.#isGM)) return this.#openEditor({ themeId: theme.id });
  }

  /** A new theme from the default look. */
  static #onCreate() {
    return this.#openEditor({});
  }

  static async #onExportOne(event, target) {
    const theme = await ThemeBrowser.#themeLoaded(this, target);
    if (theme) exportToFile([theme], `dicer-theme-${slugify(theme.name)}.json`);
  }

  static #onExportMine() {
    const mine = this.#entries().themes.filter((t) => t.source === 'user');
    if (!mine.length) return notify('warn', loc('DICER.Themes.NothingToExport'));
    exportToFile(mine, 'dicer-themes.json');
  }

  static #onImport() {
    this.element.querySelector('.dicer-theme-file')?.click();
  }

  static async #onPublish(event, target) {
    const theme = await ThemeBrowser.#themeLoaded(this, target);
    if (!theme) return;
    const res = await publish(theme);
    notify(res.ok ? 'info' : 'warn', loc(res.ok ? 'DICER.Themes.Published' : 'DICER.Themes.NotAllowed'));
    if (res.ok) await this.render();
  }

  /** GM: "Push to players..." asks first, with the choice to replace every player's own choices. */
  static async #onPush(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme || !this.#isGM) return;
    const choice = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc('DICER.Themes.Push') },
      content: `<p>${escapeHtml(loc('DICER.Themes.PushConfirm'))} <strong>${escapeHtml(theme.name)}</strong></p>
<label class="checkbox"><input type="checkbox" name="replaceAll"> ${escapeHtml(loc('DICER.Themes.PushReplaceAll'))}</label>`,
      yes: { callback: (event, button) => ({ replaceAll: Boolean(button?.form?.elements?.replaceAll?.checked) }) },
    });
    if (!choice) return;
    const res = await pushThemeToPlayers(theme.id, { replaceAll: choice.replaceAll === true });
    notify(res.refused ? 'warn' : 'info', res.refused ? loc('DICER.Themes.NotAllowed') : `${loc('DICER.Themes.Pushed')} ${res.updated}`);
  }

  static async #onRemove(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme) return;
    const warnDefault =
      theme.source === 'world' && isWorldDefault(theme.id)
        ? `<p><strong>${escapeHtml(loc('DICER.Themes.ConfirmDeleteWorldDefault'))}</strong></p>`
        : '';
    const sure = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc('DICER.Themes.Delete') },
      content: `<p>${loc('DICER.Themes.ConfirmDelete')} ${escapeHtml(theme.name)}</p>${warnDefault}`,
    });
    if (!sure) return;
    if (theme.source === 'user') await deleteMine(theme.id);
    else if (theme.source === 'world' && !(await deleteWorld(theme.id))) return notify('warn', loc('DICER.Themes.NotAllowed'));
    await this.render();
  }

  async close(options) {
    if (instance === this) instance = null;
    this.#token++;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    this.#stopPreview(); // nothing keeps drawing once the browser is closed
    this.#thumbs?.dispose();
    this.#thumbs = null;
    this.#urls.clear(); // the thumbnailer revoked its URLs
    return super.close(options);
  }
}

/** Opens (or brings to front) the browser: what the settings menu's proxy class calls. */
let bagThumbs = null;
/**
 * The chat tray's dice bag: a small picture of `dieType` in `theme` (an object URL; the
 * renderer keeps them for the page's life, so a reopened bag fills at once); null without the
 * dice atlas or WebGL.
 */
export function bagThumbnail(theme, dieType = 'd20') {
  if (!bagThumbs) {
    let context = null;
    try {
      context = globalThis.game?.dice3d?._themeContext?.();
    } catch {
      context = null;
    }
    if (!context?.atlas) return Promise.resolve(null);
    bagThumbs = createThumbnailer({ atlas: context.atlas, fonts: context.fonts ?? null, size: 128 });
  }
  return bagThumbs.thumbnail(theme, dieType).catch(() => null);
}

export function openThemeBrowser({ target } = {}) {
  instance ??= new ThemeBrowser();
  if (target) instance.focusTarget(target);
  else if (!instance.rendered) instance.focusTarget(null, { select: false }); // not open: forget an old actor target
  return instance.render({ force: true });
}
