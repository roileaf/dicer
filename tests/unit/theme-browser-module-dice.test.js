// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRegistry } from '../../src/compat/registry.js';
import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { colorsetNameToAppearance, chosenRef } from '../../src/compat/user-looks.js';
import { LOOKS } from '../../src/look/looks.js';
import { normalizeAppearance } from '../../src/look/appearance.js';
import { ADDON_THEMES, BUILTIN_THEMES } from '../../src/themes/themes.js';
import { BROWSER_TABS, STUBS } from '../../src/api/addon-registry.js';
import {
  moduleDiceEntries,
  registryView,
  useModulePatch,
  stopSystemPatch,
  currentModuleIds,
  moduleThemeRaw,
} from '../../src/ui/module-dice.js';

vi.mock('../../src/ui/appearance-editor.js', () => ({ openAppearanceEditor: vi.fn(async () => {}) }));
vi.mock('../../src/themes/thumbnailer.js', () => ({
  createThumbnailer: vi.fn(() => ({ thumbnail: vi.fn(async () => null), dispose: vi.fn() })),
}));

const IMG = (i) => `modules/trs/faces/${i}.webp`;

async function fixtureRegistry() {
  const registry = createRegistry({ warn: () => {} });
  await registry.addColorset({
    name: 'pf2e-fire-red',
    description: 'Fire Red',
    category: 'PF2e',
    foreground: '#ffffff',
    background: '#cc0000',
    edge: '#660000',
    texture: 'flames',
    font: 'Eczar',
  });
  await registry.addColorset({ name: 'trs-black', category: 'TRS', foreground: '#dddddd', background: '#111111', texture: 'marble' });
  await registry.addColorset({ name: 'internal', visibility: 'hidden', foreground: '#000', background: '#fff' });
  await registry.addColorset({ name: 'fire', foreground: '#000', background: '#f00' }); // a built-in DSN name
  registry.addSystem({ id: 'trs-marble', name: 'TRS Black Marble', group: 'TRS dice' });
  await registry.addDicePreset({ type: 'd20', system: 'trs-marble', labels: Array.from({ length: 20 }, (_, i) => IMG(i + 1)), colorset: 'trs-black' });
  await registry.addDicePreset({ type: 'd6', system: 'trs-marble', labels: ['1', '2', '3', '4', '5', '6'], modelFile: 'd6.glb', colorset: 'pf2e-fire-red' });
  await registry.addDicePreset({ type: 'd8', system: 'trs-marble', labels: ['1', '2', '3', '4', '5', '6', '7', '8'] }); // no colorset
  registry.addSystem({ id: 'empty', name: 'Empty' }); // no presets: not listed
  await registry.addDicePreset({ type: 'dc', labels: ['H', 'T'] }); // the standard system: not listed
  return registry;
}

describe('module dice entries', () => {
  it('lists module colorsets (not hidden ones, not the built-in palette) and systems with presets', async () => {
    const registry = await fixtureRegistry();
    const entries = moduleDiceEntries(registry);
    expect(entries.map((e) => e.id)).toEqual(['dsn-colorset:pf2e-fire-red', 'dsn-colorset:trs-black', 'dsn-system:trs-marble']);
    const [fire, black, marble] = entries;
    expect(fire).toMatchObject({ kind: 'colorset', key: 'pf2e-fire-red', name: 'Fire Red', category: 'PF2e', source: 'module' });
    expect(fire.appearance).toEqual(colorsetNameToAppearance('pf2e-fire-red', registry));
    expect(fire.dropped.map((d) => d.kind)).toEqual(['texture']); // no image for 'flames'; the font maps (css:Eczar)
    expect(fire.appearance.numbers.font).toBe('css:Eczar');
    expect(black).toMatchObject({ name: 'trs-black', category: 'TRS', dropped: [] }); // marble maps to a body
    expect(marble).toMatchObject({ kind: 'system', key: 'trs-marble', name: 'TRS Black Marble', category: 'TRS dice' });
    expect(marble.appearance).toEqual(colorsetNameToAppearance('trs-black', registry)); // the d20 preset's colours
    expect(Object.keys(marble.perType)).toEqual(['d6']);
    // the d20's image faces are kept by an import (faceImages), so only the model is left out
    expect(marble.dropped).toEqual([{ kind: 'models', types: ['d6'] }]);
    expect(marble.faceImages).toEqual({ d20: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, IMG(i + 1)])) });    expect(marble.models).toEqual({ d6: 'd6.glb' }); // the thumbnails draw them
    expect('models' in fire).toBe(false);
    // the presets with faces of their own, for the thumbnails (plain-number presets are not)
    expect(Object.keys(marble.facePresets)).toEqual(['d20']);
  });

  it('the registry view reads the textures (TEXTURELIST), so texture art reaches the looks', async () => {
    const registry = await fixtureRegistry();
    await registry.addTexture('art', { name: 'Art', composite: 'source-over', source: 'modules/m/d20.webp' });
    await registry.addColorset({ name: 'arty', category: 'M', background: '#272727', foreground: '#ffffff', texture: 'art' });
    const api = { exports: registry.exports, DiceFactory: { systems: registry.systems } };
    const view = registryView(api);
    expect(view.textures.get('art')).toMatchObject({ source: 'modules/m/d20.webp' });
    const arty = moduleDiceEntries(view).find((e) => e.key === 'arty');
    expect(arty.appearance.bodyImage).toMatchObject({ src: 'modules/m/d20.webp', mode: 'face' });
    expect(arty.dropped).toEqual([]);
    expect(registryView({}).textures.size).toBe(0);
  });

  it('a system without colorsets shows the default look; junk registries list nothing', () => {
    const systems = new Map([['s', { name: 'S', dice: new Map([['d6', { labels: ['1', '2', '3', '4', '5', '6'] }]]) }]]);
    const [entry] = moduleDiceEntries({ colorsets: new Map(), systems });
    expect(entry.appearance).toEqual(LOOKS.default.appearance);
    expect(entry.dropped).toEqual([]);
    expect(moduleDiceEntries(null)).toEqual([]);
    expect(moduleDiceEntries({ colorsets: new Map([['x', 'junk'], [1, {}]]), systems: new Map([['y', null]]) })).toEqual([]);
  });

  it('registryView reads game.dice3d public members and tolerates a missing or throwing API', async () => {
    const registry = await fixtureRegistry();
    const view = registryView({ exports: registry.exports, DiceFactory: registry.diceFactory });
    expect([...view.colorsets.keys()]).toContain('pf2e-fire-red');
    expect(view.systems).toBe(registry.systems);
    expect(moduleDiceEntries(view)).toHaveLength(3);
    expect(registryView(undefined).colorsets.size).toBe(0);
    const throwing = {
      get exports() {
        throw new Error('x');
      },
      get DiceFactory() {
        throw new Error('y');
      },
    };
    expect(registryView(throwing).systems.size).toBe(0);
  });

  it('use patches: a colorset replaces the look; a system merges in and keeps a look', () => {
    expect(useModulePatch({ kind: 'colorset', key: 'trs-black' }, { theme: 'verdant', system: 'x' })).toEqual({
      global: { colorset: 'trs-black', appearance: null, theme: null, look: null, chosen: true },
    });
    const sys = { kind: 'system', key: 'trs-marble' };
    expect(useModulePatch(sys, { theme: 'verdant', chosen: true }, 'ruby-classic')).toEqual({ global: { system: 'trs-marble', chosen: true } });
    expect(useModulePatch(sys, undefined, 'ruby-classic')).toEqual({ global: { system: 'trs-marble', chosen: true, theme: 'ruby-classic' } });
    expect(useModulePatch(sys, { theme: 'default', chosen: null }, 'ruby-classic').global.theme).toBe('ruby-classic'); // never chose
    // another slot, and no fallback theme (an actor, a die type: the looks behind it apply)
    expect(useModulePatch(sys, undefined, null, 'd20')).toEqual({ d20: { system: 'trs-marble', chosen: true } });
    expect(useModulePatch({ kind: 'colorset', key: 'trs-black' }, undefined, null, 'role:attack')['role:attack']).toMatchObject({ colorset: 'trs-black' });
  });

  it('currentModuleIds names a listed colorset and system only', async () => {
    const entries = moduleDiceEntries(await fixtureRegistry());
    expect(currentModuleIds({ colorset: 'trs-black', system: 'trs-marble', chosen: true }, entries)).toEqual({
      colorset: 'dsn-colorset:trs-black',
      system: 'dsn-system:trs-marble',
    });
    expect(currentModuleIds({ colorset: 'fire' }, entries)).toEqual({ colorset: null, system: null });
    expect(currentModuleIds({ colorset: 'trs-black', appearance: { body: {} } }, entries).colorset).toBeNull();
    expect(currentModuleIds({ theme: 'default', chosen: null }, entries)).toEqual({ colorset: null, system: null }); // never chose
  });

  it('moduleThemeRaw makes a user theme with per-type looks and reports what was dropped', async () => {
    const [, , marble] = moduleDiceEntries(await fixtureRegistry());
    const { raw, dropped } = moduleThemeRaw(marble, 'user.u1.trs-black-marble-2');
    expect(raw.id).toBe('user.u1.trs-black-marble-2');
    expect(raw.name).toBe('TRS Black Marble');
    expect(raw.appearance).toEqual({ ...marble.appearance, faces: marble.faceImages });
    expect(Object.keys(raw.perType)).toEqual(['d6']);
    expect(dropped.map((d) => d.kind)).toEqual(['models']);
    // the image faces ride on every look of the theme
    expect(raw.appearance.faces).toEqual(marble.faceImages);
    expect(raw.perType.d6.faces).toEqual(marble.faceImages);
  });

  it('plain labels are not custom faces; words, coins and a Fate die with images cannot be kept', () => {
    const n = (k, from = 1) => Array.from({ length: k }, (_, i) => String(from + i));
    const dice = new Map([
      ['d20', { labels: n(20) }],
      ['d10', { labels: [...n(9), '0'] }], // Dicer draws its 10 as 0 too
      ['d100', { labels: [...n(9).map((x) => String(x * 10)), '00'] }],
      ['df', { labels: ['-', '', '+'] }],
      ['dc', { labels: ['tail.webp', 'heads.webp'] }],
      ['d2', { labels: ['tail.webp', 'heads.webp'] }],
      ['d6', { labels: ['1', '2', '3', '4', '5', 'SKULL'] }],
    ]);
    const [entry] = moduleDiceEntries({ colorsets: new Map(), systems: new Map([['s', { name: 'S', dice }]]) });
    expect(entry.dropped).toEqual([{ kind: 'faces', types: ['d6'] }]);
    // a coin's labels go tails, heads: Foundry's 0 and 1
    expect(entry.faceImages).toEqual({ dc: { 0: 'tail.webp', 1: 'heads.webp' }, d2: { 1: 'tail.webp', 2: 'heads.webp' } });
  });

  it('bump and emissive maps leave the image faces in (Daggerdice, Dice Soup); an atlas frame is an image face', () => {
    const faces = (k) => Array.from({ length: k }, (_, i) => `modules/m/f${i + 1}.webp`);
    const dice = new Map([
      ['d12', { labels: faces(12), bumpMaps: faces(12) }],
      ['d6', { labels: faces(6), emissiveMaps: faces(6) }],
      ['d2', { labels: ['modules/m/s.webp#xywh=0,0,64,64', 'modules/m/s.webp#xywh=64,0,64,64'] }],
    ]);
    const [entry] = moduleDiceEntries({ colorsets: new Map(), systems: new Map([['s', { name: 'S', dice }]]) });
    expect(entry.dropped).toEqual([]);
    expect(Object.keys(entry.faceImages)).toEqual(['d12', 'd6', 'd2']);
    expect(entry.faceImages.d2[2]).toBe('modules/m/s.webp#xywh=64,0,64,64');
    // and a theme keeps them (appearance.js faceImages)
    expect(normalizeAppearance({ faces: entry.faceImages }).faces.d2).toEqual(entry.faceImages.d2);
  });
});

describe('the theme browser with module dice', () => {
  let mod;
  let flags;
  let store;
  let user;
  let registry;
  beforeAll(async () => {
    class FakeApp {
      constructor(options = {}) {
        this.options = options;
      }
      static DEFAULT_OPTIONS = {};
      async close() {}
    }
    vi.stubGlobal('foundry', {
      applications: { api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (B) => class extends B {} } },
      utils: { saveDataToFile: vi.fn() },
      data: { operators: { ForcedDeletion: { create: () => 'DELETE' } } },
    });
    mod = await import('../../src/ui/theme-browser.js');
  });
  beforeEach(async () => {
    flags = {};
    store = { theme: 'ruby-classic', damageThemeOverrides: {}, damageTypeMap: {}, worldThemes: [], worldDefaultTheme: '', lockPlayerLooks: false };
    // Foundry's setFlag merges into the stored slot.
    user = {
      id: 'u1',
      isGM: false,
      setFlag: vi.fn(async (s, k, v) => {
        if (k !== 'appearance') return void (flags[k] = v);
        const cur = { ...(flags[k] ?? {}) };
        for (const [slot, ref] of Object.entries(v)) cur[slot] = ref === 'DELETE' ? undefined : { ...(cur[slot] ?? {}), ...ref };
        flags[k] = cur;
      }),
      getFlag: (s, k) => flags[k],
    };
    registry = await fixtureRegistry();
    vi.stubGlobal('game', {
      user,
      actors: [],
      i18n: { localize: (k) => k },
      settings: { get: (_n, k) => store[k], set: vi.fn(async (_n, k, v) => (store[k] = v)) },
      dice3d: { exports: registry.exports, DiceFactory: registry.diceFactory },
    });
    vi.stubGlobal('ui', { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  });
  afterAll(() => vi.unstubAllGlobals());

  const make = () => {
    const app = new mod.ThemeBrowser();
    app.render = vi.fn(async () => {});
    return app;
  };
  const actions = new Proxy({}, { get: (_, k) => mod.ThemeBrowser.DEFAULT_OPTIONS.actions[k] });
  const button = (id) => ({ dataset: { theme: id } });
  const showModules = async (app) => actions.filter.call(app, {}, { dataset: { filter: 'module' } });

  it('a module tab with sections shows each heading once, above the first card of its run', async () => {
    const ids = BUILTIN_THEMES.slice(0, 6).map((t) => t.id);
    const section = new Map(ids.map((id, i) => [id, i < 3 ? 'In season' : i < 5 ? 'Coming up' : 'In season']));
    BROWSER_TABS.set('m-tab', { id: 'm-tab', moduleId: 'm', label: 'Tab', icon: '', filter: (t) => ids.includes(t.id), sort: undefined, sections: (t) => section.get(t.id) });
    try {
      const app = make();
      await actions.filter.call(app, {}, { dataset: { filter: 'm-tab' } });
      const ctx = await app._prepareContext();
      expect(ctx.cards.map((c) => c.id)).toEqual(ids.filter((id) => section.get(id) === 'In season').concat(ids.filter((id) => section.get(id) === 'Coming up')));
      // the tab groups a section's themes together (in first-seen order), so the headings are In season once, Coming up once
      expect(ctx.cards.map((c) => c.section)).toEqual(['In season', '', '', '', 'Coming up', '']);
      expect(ctx.cards.filter((c) => c.section).map((c) => c.section)).toEqual(['In season', 'Coming up']);
    } finally {
      BROWSER_TABS.delete('m-tab');
    }
  });

  it('assigning a stub loads it first; a failed load stores nothing and returns false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = { id: 'mod.good', moduleId: 'mod', name: 'Good', load: vi.fn(async () => ({ id: 'mod.good', name: 'Good', appearance: { body: { type: 'opaque' } } })), loading: null, failed: false };
    const bad = { id: 'mod.bad', moduleId: 'mod', name: 'Bad', load: vi.fn(async () => { throw new Error('offline'); }), loading: null, failed: false };
    STUBS.set('mod.good', good);
    STUBS.set('mod.bad', bad);
    try {
      store.theme = 'default';
      expect(await mod.assignTarget('default', 'mod.bad')).toBe(false);
      expect(store.theme).toBe('default');
      expect(user.setFlag).not.toHaveBeenCalledWith('dicer', 'appearance', expect.anything());
      expect(bad.load).toHaveBeenCalledTimes(1);
      expect(await mod.assignTarget('default', 'mod.good')).toBe(true);
      expect(good.load).toHaveBeenCalledTimes(1);
      expect(store.theme).toBe('mod.good');
    } finally {
      STUBS.clear();
      ADDON_THEMES.delete('mod.good'); // the loaded stub is a registered theme now
      warn.mockRestore();
    }
  });

  it('offers a Module dice filter (only when there are any); All stays the Dicer themes', async () => {
    const app = make();
    let ctx = await app._prepareContext();
    expect(ctx.filters.find((f) => f.id === 'module')).toMatchObject({ label: 'DICER.Themes.Source.module', count: 3, active: false });
    expect(ctx.cards).toHaveLength(BUILTIN_THEMES.length);
    await showModules(app);
    ctx = await app._prepareContext();
    expect(ctx.cards.map((c) => c.id)).toEqual(['dsn-colorset:pf2e-fire-red', 'dsn-colorset:trs-black', 'dsn-system:trs-marble']);
    expect(ctx.cards[0]).toMatchObject({ source: 'module', sourceLabel: 'PF2e', showBadge: true, isModule: true, isDefault: false });
    expect(ctx.detail.id).toBe('dsn-colorset:pf2e-fire-red');
    game.dice3d = undefined;
    ctx = await make()._prepareContext();
    expect(ctx.filters.map((f) => f.id)).toEqual(['all', 'builtin', 'world', 'user']);
  });

  it('module cards cannot be edited, published, pushed or deleted, even by a GM', async () => {
    user.isGM = true;
    const app = make();
    await showModules(app);
    const { detail } = await app._prepareContext();
    expect(detail).toMatchObject({ canEdit: false, canPublish: false, canPush: false, canDelete: false });
    expect(detail.kindLabel).toBe('DICER.Themes.Module.Colorset');
    expect(detail.dropNote).toContain('DICER.Themes.Module.Drop.texture');
  });

  it('use writes the colorset ref into the global slot; the card becomes Your default, no theme card does', async () => {
    const app = make();
    await showModules(app);
    await actions.useModule.call(app, {}, button('dsn-colorset:trs-black'));
    expect(user.setFlag).toHaveBeenCalledWith('dicer', 'appearance', {
      global: { colorset: 'trs-black', appearance: null, theme: null, look: null, chosen: true },
    });
    expect(ui.notifications.info).toHaveBeenCalledWith('DICER.Themes.Applied');
    const ctx = await app._prepareContext();
    expect(ctx.cards.filter((c) => c.isDefault).map((c) => c.id)).toEqual(['dsn-colorset:trs-black']);
    await actions.filter.call(app, {}, { dataset: { filter: 'all' } });
    expect((await app._prepareContext()).cards.filter((c) => c.isDefault)).toEqual([]);
  });

  it('use on a system merges it in (keeping the theme) and can be stopped; a theme choice replaces both', async () => {
    flags.appearance = { global: chosenRef('verdant') };
    const app = make();
    await showModules(app);
    await actions.useModule.call(app, {}, button('dsn-system:trs-marble'));
    expect(flags.appearance.global).toMatchObject({ theme: 'verdant', system: 'trs-marble', chosen: true });
    let ctx = await app._prepareContext();
    expect(ctx.cards.filter((c) => c.isDefault).map((c) => c.id)).toEqual(['dsn-system:trs-marble']);
    await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-system:trs-marble' } }) });
    ctx = await app._prepareContext();
    expect(ctx.detail).toMatchObject({ isDefault: true, canStop: true });
    expect(ctx.detail.dropNote).toContain('d6');
    await actions.filter.call(app, {}, { dataset: { filter: 'all' } });
    expect((await app._prepareContext()).cards.filter((c) => c.isDefault).map((c) => c.id)).toEqual(['verdant']);
    await actions.stopModule.call(app, {}, button('dsn-system:trs-marble'));
    expect(flags.appearance.global).toMatchObject({ theme: 'verdant', system: null });
    await actions.useModule.call(app, {}, button('dsn-system:trs-marble'));
    await mod.assignTarget('default', 'obsidian');
    expect(flags.appearance.global).toMatchObject({ theme: 'obsidian', system: null, colorset: null });
  });

  it("a moon's dice set (Ember Lunar Dice) offers 'my dice follow Ember's moons'; ticking it sets the user's flag", async () => {
    const { setRules } = await import('../../src/effects/rules.js');
    setRules.moonSet = (system) => system === 'trs-marble';
    try {
      const app = make();
      await showModules(app);
      await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-system:trs-marble' } }) });
      expect((await app._prepareContext()).detail).toMatchObject({ moonDice: true, moonDiceOn: false });
      await actions.moonDice.call(app, {}, { ...button('dsn-system:trs-marble'), checked: true });
      expect(flags.moonDice).toBe(true);
      expect((await app._prepareContext()).detail).toMatchObject({ moonDice: true, moonDiceOn: true });
      await actions.moonDice.call(app, {}, { ...button('dsn-system:trs-marble'), checked: false });
      expect(flags.moonDice).toBe(false);
      // any other set (or a colour set) shows none
      await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-colorset:trs-black' } }) });
      expect((await app._prepareContext()).detail.moonDice).toBe(false);
    } finally {
      delete setRules.moonSet;
    }
  });

  it("a set with its own natural 20 / natural 1 effects shows a toggle; turning it off lists the set in the user's flag", async () => {
    const { setRules } = await import('../../src/effects/rules.js');
    setRules.has = (system) => system === 'trs-marble';
    try {
      const app = make();
      await showModules(app);
      await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-system:trs-marble' } }) });
      expect((await app._prepareContext()).detail).toMatchObject({ setFx: true, setFxOn: true });
      await actions.setFx.call(app, {}, { ...button('dsn-system:trs-marble'), checked: false });
      expect(flags.setFxOff).toEqual(['trs-marble']);
      expect((await app._prepareContext()).detail).toMatchObject({ setFx: true, setFxOn: false });
      await actions.setFx.call(app, {}, { ...button('dsn-system:trs-marble'), checked: true });
      expect(flags.setFxOff).toEqual([]);
      // a set without its own effects (or a colour set) shows none
      await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-colorset:trs-black' } }) });
      expect((await app._prepareContext()).detail.setFx).toBe(false);
      expect(readFileSync('templates/theme-browser.hbs', 'utf8')).toMatch(/\{\{#if detail\.setFx\}\}[\s\S]*data-action="setFx"/);
    } finally {
      delete setRules.has;
    }
  });

  it('a locked player cannot use a module set (buttons hidden, actions refused); import still works', async () => {
    store.worldDefaultTheme = 'verdant';
    store.lockPlayerLooks = true;
    const app = make();
    await showModules(app);
    expect((await app._prepareContext()).locked).toBe(true);
    await actions.useModule.call(app, {}, button('dsn-colorset:trs-black'));
    await actions.stopModule.call(app, {}, button('dsn-system:trs-marble'));
    expect(await mod.useModuleDice({ kind: 'colorset', key: 'trs-black', source: 'module' })).toBe(false);
    expect(user.setFlag).not.toHaveBeenCalledWith('dicer', 'appearance', expect.anything());
    const html = readFileSync('templates/theme-browser.hbs', 'utf8');
    expect(html).toMatch(/\{\{#if detail\.isModule\}\}[\s\S]*\{\{#if locked\}\}[\s\S]*\{\{else\}\}[\s\S]*data-action="useModule"/);
    expect(html).toContain('data-action="importModule"');
    await actions.importModule.call(app, {}, button('dsn-colorset:trs-black'));
    expect(flags.themes).toHaveLength(1);
    user.isGM = true; // never locked for a GM
    expect(await mod.useModuleDice({ kind: 'colorset', key: 'trs-black', source: 'module' })).toBe(true);
  });

  it('import as theme saves a user theme, names what was dropped and opens it in the editor', async () => {
    const { openAppearanceEditor } = await import('../../src/ui/appearance-editor.js');
    flags.themes = [{ junk: true }]; // an unreadable stored entry is kept
    const app = make();
    await showModules(app);
    await actions.importModule.call(app, {}, button('dsn-system:trs-marble'));
    expect(flags.themes).toHaveLength(2);
    const saved = flags.themes[1];
    expect(saved).toMatchObject({ id: 'user.u1.trs-black-marble', name: 'TRS Black Marble' });
    expect(Object.keys(saved.perType)).toEqual(['d6']);
    const [message] = ui.notifications.warn.mock.calls.at(-1);
    expect(message).toContain('DICER.Themes.Module.Drop.models (d6)');
    expect(message).toContain('DICER.Themes.Module.Drop.models (d6)');
    expect(message).toContain('DICER.Themes.Module.KeepHint');
    expect(openAppearanceEditor).toHaveBeenLastCalledWith(expect.objectContaining({ themeId: 'user.u1.trs-black-marble' }));
    const ctx = await app._prepareContext();
    expect(ctx.filter).toBe('user');
    expect(ctx.detail.id).toBe('user.u1.trs-black-marble');
    await actions.importModule.call(app, {}, button('dsn-colorset:trs-black'));
    expect(ui.notifications.info).toHaveBeenLastCalledWith('DICER.Themes.Module.Imported trs-black');
  });

  it('a set that is all 3D models (no colours) imports in its models’ colours, not the default look', async () => {
    const look = { ...LOOKS['ruby-classic'].appearance };
    const lookFromModels = vi.fn(async () => look);
    const entry = { id: 'dsn-system:gold', kind: 'system', key: 'gold', name: 'Gold Red', source: 'module', appearance: LOOKS.default.appearance, perType: {}, dropped: [], models: { d20: 'd20.gltf' }, colourless: true };
    const res = await mod.importModuleDice(entry, { lookFromModels });
    expect(lookFromModels).toHaveBeenCalledWith({ d20: 'd20.gltf' });
    expect(res.raw.appearance).toEqual(look);
    // a set with its own colours never asks the models; nor does one whose models give none
    await mod.importModuleDice({ ...entry, colourless: undefined }, { lookFromModels });
    expect(lookFromModels).toHaveBeenCalledTimes(1);
    const none = await mod.importModuleDice(entry, { lookFromModels: async () => null });
    expect(none.raw.appearance).toEqual(LOOKS.default.appearance);
  });

  it('a system with no colorsets and a colorset of the same id (IRL Dice packs) is one set, in that look', async () => {
    const reg = createRegistry({ warn: () => {} });
    await reg.addColorset({ name: 'irl-pc-kev', description: 'Kev colours', category: 'IRL', foreground: '#ffeeaa', background: '#335522' });
    await reg.addColorset({ name: 'irl-other', description: 'Other', category: 'IRL', foreground: '#ffffff', background: '#111111' });
    const view = { ...registryView({ exports: reg.exports }) };
    // Kev's system: plain d20, no colorset named; a second system names its own colorset (not paired)
    view.systems = new Map([
      ['irl-pc-kev', { name: 'Kev, Mycelium Forged', group: 'IRL - Otari 5', dice: new Map([['d20', { labels: [], values: { min: 1 } }]]) }],
      ['irl-other', { name: 'Other set', dice: new Map([['d20', { labels: [], colorset: 'irl-pc-kev' }]]) }],
    ]);
    const entries = moduleDiceEntries(view);
    expect(entries.map((e) => e.id)).toEqual(['dsn-colorset:irl-other', 'dsn-system:irl-pc-kev', 'dsn-system:irl-other']);
    const kev = entries.find((e) => e.key === 'irl-pc-kev');
    expect(kev).toMatchObject({ kind: 'system', pair: 'irl-pc-kev', name: 'Kev, Mycelium Forged' });
    expect(kev.appearance).toEqual(colorsetNameToAppearance('irl-pc-kev', view));
    expect(entries.find((e) => e.key === 'irl-other' && e.kind === 'system').pair).toBeUndefined();
    // using it writes both; stopping it clears both
    expect(useModulePatch(kev, { theme: 'verdant' })).toEqual({ global: { system: 'irl-pc-kev', colorset: 'irl-pc-kev', appearance: null, theme: null, look: null, chosen: true } });
    expect(useModulePatch(kev, undefined, null, 'actor')).toHaveProperty('actor.colorset', 'irl-pc-kev');
    expect(stopSystemPatch(kev)).toEqual({ global: { system: null, colorset: null } });
    expect(stopSystemPatch()).toEqual({ global: { system: null } });
  });

  it('a set that names no colours imports in the player’s own look (as it shows in use), not Clear Resin', async () => {
    const systems = new Map([['fs', { name: 'Flame Stalker', dice: new Map([['d20', { labels: ['a.webp', '2'], values: { min: 1 } }]]) }]]);
    const [entry] = moduleDiceEntries({ colorsets: new Map(), systems });
    expect(entry.noColours).toBe(true);
    const res = await mod.importModuleDice(entry);
    expect(res.raw.appearance).toMatchObject(LOOKS['ruby-classic'].appearance); // store.theme
    expect(res.raw.appearance.faces).toEqual({ d20: { 1: 'a.webp' } });
    expect(res.raw.system).toBe('fs');
    // a set with its own colours keeps them
    const named = moduleDiceEntries({ colorsets: registry.exports.COLORSETS ? new Map(Object.entries(registry.exports.COLORSETS)) : new Map(), systems: new Map([['n', { name: 'N', dice: new Map([['d20', { labels: [], colorset: 'pf2e-fire-red' }]]) }]]) }).find((e) => e.key === 'n');
    expect(named.noColours).toBeUndefined();
  });

  it('systemEntry marks a set with models and no colours as colourless', () => {
    const systems = new Map([['m', { name: 'M', dice: new Map([['d20', { labels: '', modelFile: 'd20.gltf' }]]) }]]);
    expect(moduleDiceEntries({ colorsets: new Map(), systems })[0].colourless).toBe(true);
  });

  it('what use writes is what the look resolver rolls', async () => {
    const resolver = createLookResolver({ registry, getUser: () => user, facesFor: (p) => ({ key: p.type }), warn: () => {} });
    const roll = (faces) => resolver.decorate(null, {}, 'u1')({ faces, options: {} }, {}, 0);
    await mod.useModuleDice({ kind: 'colorset', key: 'pf2e-fire-red', source: 'module' });
    expect(roll(12).appearance).toEqual(colorsetNameToAppearance('pf2e-fire-red', registry));
    flags.appearance = { global: chosenRef('verdant') };
    await mod.useModuleDice({ kind: 'system', key: 'trs-marble', source: 'module' });
    const d20 = roll(20);
    expect(d20).toMatchObject({ system: 'trs-marble', faces: { key: 'd20' } });
    expect(d20.appearance).toEqual(colorsetNameToAppearance('trs-black', registry));
    expect(roll(8).appearance).toEqual(BUILTIN_THEMES.find((t) => t.id === 'verdant').appearance); // no preset colorset: own theme
  });

  /** An owned actor with Foundry's merging setFlag, in a game.actors that has get(). */
  function ownedActor(id = 'a1', name = 'Ryllara') {
    const af = {};
    const actor = {
      id,
      name,
      isOwner: true,
      flags: { dicer: af },
      getFlag: (s, k) => af[k],
      setFlag: vi.fn(async (s, k, v) => {
        const cur = { ...(af[k] ?? {}) };
        for (const [slot, ref] of Object.entries(v)) cur[slot] = ref === 'DELETE' ? undefined : { ...(cur[slot] ?? {}), ...ref };
        af[k] = cur;
      }),
    };
    const list = [actor];
    list.get = (x) => list.find((a) => a.id === x);
    game.actors = list;
    return actor;
  }
  const applyTo = (app, id, to) => actions.apply.call(app, {}, { dataset: { theme: id, target: to } });

  it('a module set can be used for an actor (its system alone, no fallback theme), shown on its card, and cleared', async () => {
    const actor = ownedActor();
    const app = make();
    await showModules(app);
    await applyTo(app, 'dsn-system:trs-marble', 'actor:a1');
    expect(actor.getFlag('dicer', 'appearance').global).toEqual({ system: 'trs-marble', chosen: true });
    expect(flags.appearance).toBeUndefined(); // the player's own looks untouched
    await applyTo(app, 'dsn-colorset:trs-black', 'actor:a1');
    expect(actor.getFlag('dicer', 'appearance').global).toMatchObject({ colorset: 'trs-black', system: 'trs-marble' });
    await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-system:trs-marble' } }) });
    let ctx = await app._prepareContext();
    expect(ctx.detail.assigned.map((a) => a.target)).toContain('actor:a1');
    // the module detail offers every target but the damage maps (they hold theme ids)
    const values = ctx.moduleTargetGroups.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toEqual(expect.arrayContaining(['default', 'die:d20', 'role:attack', 'actor:a1']));
    expect(values.some((v) => /damage:/.test(v))).toBe(false);
    await actions.clear.call(app, {}, { dataset: { target: 'actor:a1' } });
    expect(actor.getFlag('dicer', 'appearance').global).toBeUndefined();
    ctx = await app._prepareContext();
    expect(ctx.detail.assigned.map((a) => a.target)).not.toContain('actor:a1');
    // an actor the user does not own is refused
    actor.isOwner = false;
    expect(await mod.useModuleDice({ kind: 'system', key: 'trs-marble', source: 'module' }, 'actor:a1')).toBe(false);
  });

  it('a module set can be used for a die type or a roll role; damage targets are refused', async () => {
    const entry = { kind: 'system', key: 'trs-marble', source: 'module' };
    expect(await mod.useModuleDice(entry, 'die:d6')).toBe(true);
    expect(flags.appearance.d6).toEqual({ system: 'trs-marble', chosen: true });
    expect(await mod.useModuleDice({ kind: 'colorset', key: 'trs-black', source: 'module' }, 'role:attack')).toBe(true);
    expect(flags.appearance['role:attack']).toMatchObject({ colorset: 'trs-black' });
    expect(await mod.useModuleDice(entry, 'damage:fire')).toBe(false);
    expect(await mod.useModuleDice(entry, 'worlddamage:fire')).toBe(false);
    expect(await mod.useModuleDice(entry, 'die:d7')).toBe(false);
    const app = make();
    await showModules(app);
    await actions.select.call(app, {}, { closest: () => ({ dataset: { theme: 'dsn-system:trs-marble' } }) });
    expect((await app._prepareContext()).detail.assigned.map((a) => a.target)).toEqual(['die:d6']);
  });

  it("an actor's module system dresses its dice even with no look of its own (the player's look elsewhere)", async () => {
    const actor = ownedActor();
    flags.appearance = { global: chosenRef('verdant') };
    await mod.useModuleDice({ kind: 'system', key: 'trs-marble', source: 'module' }, 'actor:a1');
    const resolver = createLookResolver({ registry, getUser: () => user, getActor: (id) => (id === actor.id ? actor : undefined), facesFor: (p) => ({ key: p.type }), warn: () => {} });
    const roll = (faces) => resolver.decorate(null, {}, 'u1', { actor: 'a1' })({ faces, options: {} }, {}, 0);
    expect(roll(20)).toMatchObject({ system: 'trs-marble', faces: { key: 'd20' } });
    expect(roll(20).appearance).toEqual(colorsetNameToAppearance('trs-black', registry));
    expect(roll(8).appearance).toEqual(BUILTIN_THEMES.find((t) => t.id === 'verdant').appearance);
    // without the speaker the player's own dice roll
    expect(resolver.decorate(null, {}, 'u1')({ faces: 20, options: {} }, {}, 0).system).not.toBe('trs-marble');
  });
});
