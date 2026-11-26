/**
 * Dice from installed modules that are not active (src/compat/installed-dice.js): which modules
 * are offered, and running only their Dice So Nice hooks.
 */
import { afterEach, expect, test, vi } from 'vitest';
import {
  scriptsOf,
  classify,
  scanInstalled,
  runDice,
  loadInstalledDice,
  moonSystemFor,
  followEmberMoons,
  isLoaded,
  resetLoaded,
} from '../../src/compat/installed-dice.js';

afterEach(() => resetLoaded());

const DICE_SET = `Hooks.once('diceSoNiceReady', (dice3d) => {
  dice3d.addSystem({ id: "marble", name: "Marble" }, false);
  dice3d.addDicePreset({ type: "d20", labels: "", modelFile: "modules/marble/d20.gltf", system: "marble" });
});`;

test('a module whose scripts only add dice is offered; more work, ES modules and no dice are not', () => {
  expect(classify([DICE_SET])).toBe('ok');
  expect(classify(['console.log(1)'])).toBe('none');
  expect(classify([`${DICE_SET}\nHooks.on('renderChatMessage', () => {});`])).toBe('other');
  expect(classify([`${DICE_SET}\ngame.settings.register('marble', 'x', {});`])).toBe('other');
  expect(classify([`${DICE_SET}\nCONFIG.Dice.terms.x = 1;`])).toBe('other');
  expect(classify([`${DICE_SET}\nwindow.marble = 1;`])).toBe('other');
  expect(classify([`import x from './x.js';\n${DICE_SET}`])).toBe('bundle');
  expect(classify([`${DICE_SET}\nif (CONFIG.x === 1) {}`])).toBe('ok'); // reading CONFIG is fine
});

test("only the module's own script files are fetched", () => {
  const mod = {
    id: 'marble',
    scripts: new Set(['modules/marble/diceset.js', 'https://evil.example/x.js', 'modules/other/x.js', 'modules/marble/../x.js']),
    esmodules: new Set(['/modules/marble/esm.mjs']),
  };
  expect(scriptsOf(mod)).toEqual(['modules/marble/esm.mjs', 'modules/marble/diceset.js']);
});

test('the scan offers inactive modules that may hold dice, with what each one is', async () => {
  const files = {
    'modules/marble/diceset.js': DICE_SET,
    'modules/adventure/index.js': `${DICE_SET}\nHooks.once('ready', () => {});`,
    'modules/flavor/main.js': `Hooks.on('diceSoNiceReady', () => {});`, // patches, adds no dice
  };
  const dsn = { requires: new Set([{ id: 'dice-so-nice' }]) };
  const modules = new Map(
    [
      { id: 'marble', title: 'Marble Dice', active: false, scripts: new Set(['modules/marble/diceset.js']) },
      { id: 'adventure', title: 'An Adventure', active: false, relationships: dsn, esmodules: new Set(['modules/adventure/index.js']) },
      { id: 'flavor', title: 'Flavor', active: false, relationships: dsn, scripts: new Set(['modules/flavor/main.js']) },
      { id: 'on-dice', title: 'On Dice', active: true, scripts: new Set(['modules/on-dice/x.js']) },
      { id: 'maps', title: 'Maps', active: false, scripts: new Set(['modules/maps/x.js']) }, // never fetched
    ].map((m) => [m.id, m]),
  );
  const fetchText = vi.fn(async (p) => files[p] ?? '');
  const found = await scanInstalled({ modules, fetchText });
  expect(found).toEqual([
    // it needs Dice So Nice: an add-on Dicer can run in full (loadDsnAddons)
    { id: 'adventure', title: 'An Adventure', scripts: ['modules/adventure/index.js'], status: 'other', addon: true },
    { id: 'marble', title: 'Marble Dice', scripts: ['modules/marble/diceset.js'], status: 'ok' },
  ]);
  expect(fetchText).not.toHaveBeenCalledWith('modules/maps/x.js');
  expect(fetchText).not.toHaveBeenCalledWith('modules/on-dice/x.js');
});

test("a loader add-on (it imports another module's script, which adds the dice) is offered to run in full", async () => {
  // the SF2e Playtest Dice Wrapper: an init hook importing the installed, inactive adventure pack's index.js
  const wrapper = `const PREMIUM_MODULE_ID = 'sf2e-playtest-deluxe-adventure-pack';
const PREMIUM_SCRIPT_PATH = \`modules/\${PREMIUM_MODULE_ID}/index.js\`;
Hooks.once('init', async () => {
  if (!(await foundry.utils.srcExists(PREMIUM_SCRIPT_PATH))) return;
  try { await import(\`/\${PREMIUM_SCRIPT_PATH}\`); } catch (e) { console.error(e); }
});`;
  const dsn = { requires: new Set([{ id: 'dice-so-nice' }]) };
  const modules = new Map([
    ['sf2e-playtest-dice-wrapper', { id: 'sf2e-playtest-dice-wrapper', title: 'SF2e Playtest Dice Wrapper', active: false, relationships: dsn, esmodules: new Set(['modules/sf2e-playtest-dice-wrapper/src/index.js']) }],
    // an import of something that is no module script, from a module that does not need Dice So Nice: not offered
    ['tool-dice', { id: 'tool-dice', title: 'Tool Dice', active: false, esmodules: new Set(['modules/tool-dice/x.js']) }],
  ]);
  const files = { 'modules/sf2e-playtest-dice-wrapper/src/index.js': wrapper, 'modules/tool-dice/x.js': `await import('modules/other/y.js');` };
  const found = await scanInstalled({ modules, fetchText: async (p) => files[p] ?? '' });
  expect(found).toEqual([
    { id: 'sf2e-playtest-dice-wrapper', title: 'SF2e Playtest Dice Wrapper', scripts: ['modules/sf2e-playtest-dice-wrapper/src/index.js'], status: 'bundle', addon: true },
  ]);
});

test('running a dice set calls only its Dice So Nice hooks, init first, with the api', async () => {
  const calls = [];
  const api = { addSystem: (s) => calls.push(['system', s.id]), addDicePreset: (p) => calls.push(['preset', p.type]) };
  const text = `Hooks.once('diceSoNiceReady', (d) => d.addDicePreset({ type: 'd6' }));
Hooks.once('diceSoNiceInit', (d) => d.addSystem({ id: 'x', name: 'X' }));
Hooks.once('ready', () => { throw new Error('never runs'); });`;
  expect(await runDice([text], api)).toBe(2);
  expect(calls).toEqual([
    ['system', 'x'],
    ['preset', 'd6'],
  ]);
});

test('loading the picks runs each once, skips active modules and ones that changed, and warns on errors', async () => {
  const api = { addSystem: vi.fn(), addDicePreset: vi.fn() };
  const files = {
    'modules/marble/diceset.js': DICE_SET,
    'modules/grown/x.js': `${DICE_SET}\nHooks.on('ready', () => {});`,
    'modules/broken/x.js': `Hooks.once('diceSoNiceReady', (d) => { d.addSystem({ id: 'b', name: 'B' }); throw new Error('boom'); });`,
    'modules/live/x.js': DICE_SET,
  };
  const warn = vi.fn();
  const list = [
    { id: 'marble', title: 'Marble', scripts: ['modules/marble/diceset.js'] },
    { id: 'grown', title: 'Grown', scripts: ['modules/grown/x.js'] },
    { id: 'broken', title: 'Broken', scripts: ['modules/broken/x.js'] },
    { id: 'live', title: 'Live', scripts: ['modules/live/x.js'] },
    { id: 'sneaky', title: 'Sneaky', scripts: ['modules/marble/diceset.js'] }, // not its own files
  ];
  const deps = { api, fetchText: async (p) => files[p], isActive: (id) => id === 'live', warn };
  expect(await loadInstalledDice(list, deps)).toEqual(['marble']);
  expect(api.addSystem).toHaveBeenCalledTimes(2); // marble's and broken's (before it threw)
  expect(api.addDicePreset).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(2); // grown (does more now), broken (threw)
  expect(isLoaded('marble')).toBe(true);
  expect(await loadInstalledDice(list, deps)).toEqual([]); // once per page
  expect(api.addSystem).toHaveBeenCalledTimes(2);
});

test("a pick made as dice only runs a module that does more than add dice: its Dice So Nice hooks, nothing else", async () => {
  // an adventure pack (Paizo's, with The Rollsmith's dice): init and ready hooks beside its dice
  const other = vi.fn();
  globalThis.__dicerOther = other;
  const pack = `Hooks.once('init', () => globalThis.__dicerOther('init'));
Hooks.on('ready', () => { game.settings.register('pack', 'x', {}); globalThis.__dicerOther('ready'); });
${DICE_SET}`;
  const api = { addSystem: vi.fn(), addDicePreset: vi.fn() };
  const warn = vi.fn();
  const files = { 'modules/pack/dist/index.js': pack, 'modules/esm/index.js': `import x from './y.js';\n${pack}` };
  const list = [
    { id: 'pack', title: 'Pack', scripts: ['modules/pack/dist/index.js'], diceOnly: true },
    { id: 'esm', title: 'Esm', scripts: ['modules/esm/index.js'], diceOnly: true }, // cannot run apart
  ];
  try {
    expect(await loadInstalledDice(list, { api, fetchText: async (p) => files[p], isActive: () => false, warn })).toEqual(['pack']);
  } finally {
    delete globalThis.__dicerOther;
  }
  expect(api.addSystem).toHaveBeenCalledTimes(1);
  expect(api.addDicePreset).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1); // esm
});

// A script that only adds dice is loaded here (not as an add-on run in full), after game.dice3d was
// announced: Ember's moons are followed on this path too, from the moment the dice have registered.
test("Ember Lunar Dice loaded as a plain dice set follow Ember's moons too: at once, then at each phase change", async () => {
  const events = {};
  const hooks = { on: (h, fn) => (events[h] ??= []).push(fn), once: (h, fn) => (events[h] ??= []).push(fn) };
  const api = { addSystem: vi.fn(), uniforms: {} };
  const lunar = `Hooks.once('diceSoNiceReady', (d) => {
  d.addSystem({ id: 'lunar', name: 'Lunar' });
  d.uniforms.moonPhase = { ignis: { value: false }, aqua: { value: true } };
});`;
  const calendar = { moons: { ignis: { id: 'ignis', phase: 'full' }, aqua: { id: 'aqua', phase: 'waning' } } };
  const list = [{ id: 'ember-lunar-dice', title: 'Ember Lunar Dice', scripts: ['modules/ember-lunar-dice/ember-lunar-dice.mjs'] }];
  const deps = { api, fetchText: async () => lunar, isActive: () => false, hooks, calendar: () => calendar };
  expect(await loadInstalledDice(list, deps)).toEqual(['ember-lunar-dice']);
  expect(api.uniforms.moonPhase).toEqual({ ignis: { value: true }, aqua: { value: false } });
  for (const fn of events['ember.lunarPhaseChange'] ?? []) fn({ changed: ['ignis', 'aqua'], phases: { ignis: 'waning', aqua: 'full' } });
  expect(api.uniforms.moonPhase).toEqual({ ignis: { value: false }, aqua: { value: true } });
});

// "My dice follow Ember's moons": the set of the moon with the most influence right now
const moonUser = (on) => ({ getFlag: (s, k) => (s === 'dicer' && k === 'moonDice' ? on : undefined) });
const sky = (influences) => ({
  moons: Object.fromEntries(Object.entries(influences).map(([id, at]) => [id, { id, influence: -1, animate: (t) => ({ influence: at(t) }) }])),
});

test("a player who follows the moons rolls the set of the moon with the most influence at the world's time", () => {
  const calendar = () => sky({ cora: (t) => (t === 5 ? 0.3 : 0.9), aura: () => 0.6, akon: () => 0 });
  const has = (id) => id !== 'trs-ember-none-dice-set';
  const deps = { calendar, has, now: () => 5 };
  expect(moonSystemFor(moonUser(true), deps)).toBe('trs-ember-aura-dice-set');
  expect(moonSystemFor(moonUser(true), { ...deps, now: () => 6 })).toBe('trs-ember-cora-dice-set');
  // not asked for: their own dice
  expect(moonSystemFor(moonUser(false), deps)).toBeNull();
  expect(moonSystemFor(moonUser(undefined), deps)).toBeNull();
  expect(moonSystemFor(null, deps)).toBeNull();
});

test('no moon in the sky, a moon whose set is not loaded, or no Ember: their own dice', () => {
  const has = (id) => id === 'trs-ember-cora-dice-set';
  expect(moonSystemFor(moonUser(true), { calendar: () => sky({ cora: () => 0, aura: () => 0 }), has, now: () => 1 })).toBeNull();
  expect(moonSystemFor(moonUser(true), { calendar: () => sky({ cora: () => 0.2, aura: () => 0.9 }), has, now: () => 1 })).toBe('trs-ember-cora-dice-set');
  expect(moonSystemFor(moonUser(true), { calendar: () => undefined, has, now: () => 1 })).toBeNull();
  expect(moonSystemFor(moonUser(true), { calendar: () => { throw new Error('x'); }, has, now: () => 1 })).toBeNull();
  // a moon without Ember's animate(): its current influence
  const plain = () => ({ moons: { cora: { id: 'cora', influence: 0.4 } } });
  expect(moonSystemFor(moonUser(true), { calendar: plain, has, now: () => 1 })).toBe('trs-ember-cora-dice-set');
});

test('once Ember Lunar Dice are loaded the look resolver can ask the moon (registry.moonRef), and the theme browser offers it', async () => {
  const { setRules } = await import('../../src/effects/rules.js');
  const hooks = { on() {}, once() {} };
  const systems = new Map([['trs-ember-cora-dice-set', {}]]);
  const api = { uniforms: {}, _registry: { systems } };
  followEmberMoons({ hooks, dice3d: api, calendar: () => sky({ cora: () => 0.5 }), time: () => 1 });
  expect(api._registry.moonRef(moonUser(true))).toBe('trs-ember-cora-dice-set');
  expect(api._registry.moonRef(moonUser(false))).toBeNull();
  // the resolver hands the roller's looks: the moon's set becomes their default system, their look stays
  const looks = { global: { theme: 'verdant', system: 'pf2e' }, d6: { system: 'pf2e' } };
  api._registry.moonRef(moonUser(true), looks);
  expect(looks).toEqual({ global: { theme: 'verdant', system: 'trs-ember-cora-dice-set' }, d6: { system: 'pf2e' } });
  const own = { global: { theme: 'verdant' } };
  api._registry.moonRef(moonUser(false), own);
  expect(own).toEqual({ global: { theme: 'verdant' } });
  expect(setRules.moonSet('trs-ember-cora-dice-set')).toBe(true);
  expect(setRules.moonSet('trs-marble')).toBe(false);
  resetLoaded();
  expect(setRules.moonSet).toBeUndefined();
});
