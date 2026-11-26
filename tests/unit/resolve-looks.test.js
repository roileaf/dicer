import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { PROVIDERS } from '../../src/api/theme-registry.js';
import { facesFor } from '../../src/compat/faces.js';
import { createRegistry } from '../../src/compat/registry.js';
import { LOOKS } from '../../src/look/looks.js';
import { findTheme } from '../../src/themes/themes.js';
import { themeRef, chosenRef, mirrorLookSetting, colorsetNameToAppearance } from '../../src/compat/user-looks.js';
import { slotPatch } from '../../src/ui/theme-form.js';
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../../src/look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from '../../src/compat/colorset-map.js';

const user = (flag) => ({
  getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? flag : undefined),
});
const term = (faces, extra = {}) => ({ faces, options: {}, results: [{ result: 1 }], ...extra });
const RES = { result: 1 };
const CRYSTAL = LOOKS['sharp-crystal'].appearance;
const RUBY = LOOKS['ruby-classic'].appearance;

function make({ users = {}, actors = {}, facesFor, worldDefault = '', lock = false } = {}) {
  const registry = createRegistry({ warn: () => {} });
  const warn = vi.fn();
  const resolver = createLookResolver({
    registry,
    getUser: (id) => users[id],
    getActor: (id) => actors[id],
    warn,
    facesFor,
    getWorldDefaultTheme: () => worldDefault,
    getLockPlayerLooks: () => lock,
  });
  return { registry, warn, resolver };
}
const look = (resolver, t, authorId, i = 0) => resolver.decorate(null, {}, authorId)(t, RES, i);
const fire = colorsetToAppearance(BUILTIN_COLORSETS.fire, { index: 0 });

describe('rule precedence', () => {
  test('1. options.appearance wins over everything', () => {
    const { resolver } = make();
    const options = { appearance: { body: { type: 'opaque', color: '#123456' } }, colorset: 'fire' };
    const t = term(20, { options, flavor: 'ice' });
    expect(look(resolver, t, 'u').appearance.body.color).toBe('#123456');
  });
  test("1b. a Dice So Nice appearance naming a colorset ({system, colorset}, as add-ons pass) wears that colorset", () => {
    const { resolver } = make();
    const t = term(20, { options: { appearance: { system: 'standard', colorset: 'fire' } } });
    expect(look(resolver, t, 'u').appearance).toEqual(fire);
  });
  test('2. options.colorset beats a matching flavor', () => {
    const { resolver } = make();
    const t = term(20, { options: { colorset: 'fire' }, flavor: 'ice' });
    expect(look(resolver, t, 'u').appearance).toEqual(fire);
  });
  test('3. a die:fire flavor and a bare case-insensitive flavor name a colorset', () => {
    const { resolver } = make();
    expect(look(resolver, term(20, { flavor: 'die:fire' }), 'u').appearance).toEqual(fire);
    expect(look(resolver, term(20, { flavor: 'Fire' }), 'u').appearance).toEqual(fire);
    const other = look(resolver, term(20, { flavor: 'fire and brimstone' }), 'u');
    expect(other.appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test('4. dsnActorId reads the actor flag LookRef', () => {
    const actors = { a1: { flags: { dicer: { appearance: { look: 'ruby-classic' } } } } };
    const { resolver } = make({ actors });
    expect(look(resolver, term(20, { options: { dsnActorId: 'a1' } }), 'u').appearance).toBe(RUBY);
    const missing = term(20, { options: { dsnActorId: 'nobody' } });
    expect(look(resolver, missing, 'u').appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test("4b. a speaker's actor (showForRoll / animateRoll) stands in for a missing dsnActorId", () => {
    const actors = {
      a1: { flags: { dicer: { appearance: { global: { look: 'ruby-classic' } } } } },
      a2: { flags: { dicer: { appearance: { look: 'jade-marble' } } } },
    };
    const flag = { global: { look: 'sharp-crystal' } };
    const { resolver } = make({ actors, users: { u: user(flag) } });
    // A token-linked speaker {token, actor}: the actor id is the base actor's, whose flags apply.
    const speaker = { scene: 's', token: 't1', actor: 'a1' };
    const viaSpeaker = (t) => resolver.decorate(null, {}, 'u', speaker)(t, RES, 0);
    expect(viaSpeaker(term(20)).appearance).toBe(RUBY);
    // The term's own dsnActorId still wins over the speaker.
    expect(viaSpeaker(term(20, { options: { dsnActorId: 'a2' } })).appearance).toBe(LOOKS['jade-marble'].appearance);
    // A speaker without an actor theme falls back to the author's look.
    const noTheme = resolver.decorate(null, {}, 'u', { actor: 'nobody' })(term(20), RES, 0);
    expect(noTheme.appearance).toBe(CRYSTAL);
    // No speaker: the author's look, as before.
    expect(look(resolver, term(20), 'u').appearance).toBe(CRYSTAL);
  });
  test('5. the author: per-type entry, else global', () => {
    const flag = { d20: { look: 'sharp-crystal' }, global: { look: 'ruby-classic' } };
    const { resolver } = make({ users: { u: user(flag) } });
    expect(look(resolver, term(20), 'u').appearance).toBe(CRYSTAL);
    expect(look(resolver, term(6), 'u').appearance).toBe(RUBY);
  });
  test('6. an unknown author gets the default', () => {
    const { resolver } = make();
    expect(look(resolver, term(6), 'ghost').appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

test('two authors in one roll resolve independently', () => {
  const { resolver } = make({
    users: {
      a: user({ global: { look: 'ruby-classic' } }),
      b: user({ global: { look: 'sharp-crystal' } }),
    },
  });
  expect(look(resolver, term(20), 'a').appearance).toBe(RUBY);
  expect(look(resolver, term(20), 'b').appearance).toBe(CRYSTAL);
});

describe('systems and presets', () => {
  test('a pf2e preset attaches its model and consults the faces seam', async () => {
    const facesFor = vi.fn(() => undefined);
    const users = { u: user({ global: { look: 'default', system: 'pf2e' } }) };
    const { registry, resolver } = make({ facesFor, users });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20), 'u');
    expect(out.model).toBe('m.glb');
    expect(out).not.toHaveProperty('faces');
    expect(facesFor).toHaveBeenCalledWith(registry.presetFor('pf2e', 'd20'));
  });
  test('the system can come from options.appearance.system', async () => {
    const { registry, resolver } = make();
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const t = term(20, { options: { appearance: { system: 'pf2e' } } });
    expect(look(resolver, t, 'u').model).toBe('m.glb');
    expect(look(resolver, term(20), 'u').model).toBeUndefined();
  });
  test('the preset colorset replaces the author look but not an explicit colorset', async () => {
    const users = { u: user({ global: { look: 'ruby-classic', system: 'pf2e' } }) };
    const { registry, resolver } = make({ users });
    const preset = { type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb', colorset: 'fire' };
    await registry.addDicePreset(preset);
    expect(look(resolver, term(20), 'u').appearance).toEqual(fire);
    const explicit = look(resolver, term(20, { options: { colorset: 'ice' } }), 'u');
    expect(explicit.appearance).not.toEqual(fire);
  });
});

describe('model urls', () => {
  test('a die gets the routed model url, the one the registry loads', async () => {
    const registry = createRegistry({ warn: () => {}, routeUrl: (u) => `/prefix/${u}` });
    const resolver = createLookResolver({ registry, getUser: () => undefined, warn: vi.fn() });
    await registry.addDicePreset({ type: 'd20', system: 'standard', labels: '', modelFile: 'm.glb' });
    expect(look(resolver, term(20), 'u').model).toBe('/prefix/m.glb');
  });
});

describe('dsnType and system resolution', () => {
  test('dsnType carries the DSN die type; custom dice use d + denomination', () => {
    const { resolver } = make();
    class Coin {
      static DENOMINATION = 'c';
    }
    expect(look(resolver, term(20), 'u').dsnType).toBe('d20');
    expect(look(resolver, term(2, { constructor: Coin }), 'u').dsnType).toBe('dc');
  });
  test('the decorated spec carries the preset system, else the resolved one, else standard', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }), v: user(undefined) };
    const { registry, resolver } = make({ users });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(resolver, term(20), 'u').system).toBe('pf2e');
    expect(look(resolver, term(6), 'u').system).toBe('pf2e'); // no d6 preset: the resolved system
    expect(look(resolver, term(20), 'v').system).toBe('standard');
  });
  test('a custom die finds its per-type flag and preset by d + denomination', async () => {
    class Coin {
      static DENOMINATION = 'c';
    }
    const users = { u: user({ dc: { look: 'sharp-crystal', system: 'coins' } }) };
    const { registry, resolver } = make({ users });
    await registry.addDicePreset({ type: 'dc', system: 'coins', labels: ['H', 'T'], modelFile: 'c.glb' });
    const out = look(resolver, term(2, { constructor: Coin }), 'u');
    expect(out.appearance).toBe(CRYSTAL);
    expect(out.model).toBe('c.glb');
  });
  test('a system-only d20 ref keeps the global look as its colour source', async () => {
    const flag = { d20: { system: 'pf2e' }, global: { look: 'ruby-classic' } };
    const { registry, resolver } = make({ users: { u: user(flag) } });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20), 'u');
    expect(out.model).toBe('m.glb');
    expect(out.appearance).toBe(RUBY);
    expect(look(resolver, term(6), 'u').model).toBeUndefined();
  });
  test('a die:fire flavor keeps the author preset model', async () => {
    const { registry, resolver } = make({ users: { u: user({ global: { system: 'pf2e' } }) } });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20, { flavor: 'die:fire' }), 'u');
    expect(out.appearance).toEqual(fire);
    expect(out.model).toBe('m.glb');
  });
  test('options.appearance.system beats the author system', async () => {
    const { registry, resolver } = make({ users: { u: user({ global: { system: 'a' } }) } });
    await registry.addDicePreset({ type: 'd20', system: 'a', labels: [], modelFile: 'a.glb' });
    await registry.addDicePreset({ type: 'd20', system: 'b', labels: [], modelFile: 'b.glb' });
    const t = term(20, { options: { appearance: { system: 'b' } } });
    expect(look(resolver, t, 'u').model).toBe('b.glb');
  });
  test('faces is absent when the seam returns undefined, present otherwise', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }) };
    const a = make({ users });
    await a.registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(a.resolver, term(20), 'u')).not.toHaveProperty('faces');
    const set = { key: 'k', labels: [] };
    const b = make({ users, facesFor: () => set });
    await b.registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(b.resolver, term(20), 'u').faces).toBe(set);
  });
  test('a throwing facesFor drops the faces but keeps the look', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }) };
    const facesFor = () => {
      throw new Error('bad preset');
    };
    const { registry, resolver, warn } = make({ users, facesFor });
    await registry.addDicePreset({
      type: 'd20',
      system: 'pf2e',
      labels: [],
      modelFile: 'm.glb',
      colorset: 'fire',
    });
    const out = look(resolver, term(20), 'u');
    expect(out).not.toHaveProperty('faces');
    expect(out.model).toBe('m.glb');
    expect(out.appearance).toEqual(fire);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  test('the real facesFor turns a Fate preset into text and blank faces', async () => {
    const users = { u: user({ global: { system: 'fate' } }) };
    const digits = (t) => /^[0-9]{1,2}$/.test(t);
    const { registry, resolver } = make({ users, facesFor: (p) => facesFor(p, digits) });
    await registry.addDicePreset({ type: 'df', system: 'fate', labels: ['-', '-', '', '', '+', '+'] }, 'd6');
    class Fate {
      static DENOMINATION = 'f';
    }
    const t = Object.assign(new Fate(), { faces: 3, options: {}, results: [RES] });
    const out = look(resolver, t, 'u');
    expect(out.faces.key.startsWith('fate|df|')).toBe(true);
    expect(new Set(out.faces.labels.map((l) => l.kind))).toEqual(new Set(['text', 'blank']));
  });
});

describe('shapeFor', () => {
  test('built-in dN types, aliases and custom denominations; d100 and unknown give null', async () => {
    const { registry, resolver } = make();
    await registry.addDicePreset({ type: 'dc', labels: ['1', '2', '3', '4', '5', '6'] }, 'd6');
    await registry.addDicePreset({ type: 'df', labels: ['-', '-', '0', '0', '+', '+'] }, 'd6');
    class Coin {
      static DENOMINATION = 'c';
    }
    class Fate {
      static DENOMINATION = 'f';
    }
    expect(resolver.shapeFor(term(20))).toBe('d20');
    expect(resolver.shapeFor(term(6, { constructor: Coin }))).toBe('d6');
    expect(resolver.shapeFor(term(3, { constructor: Fate }))).toBe('d6');
    expect(resolver.shapeFor(term(100))).toBeNull();
    expect(resolver.shapeFor(term(7))).toBeNull();
    expect(resolver.shapeFor({})).toBeNull();
    expect(resolver.shapeFor(null)).toBeNull();
  });
});

test('resolver survives garbage flags', () => {
  const flag = { global: { appearance: 'nope' }, d20: null };
  const { resolver } = make({
    users: { u: { getFlag: () => flag, flags: { dicer: { appearance: flag } } } },
    actors: { a: { flags: { dicer: { appearance: 5 } } } },
  });
  const options = { dsnActorId: 'a', appearance: 7, colorset: {} };
  expect(look(resolver, term(20, { options, flavor: 42 }), 'u').appearance).toEqual(
    DEFAULT_APPEARANCE,
  );
  expect(look(resolver, term(20), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
});

test('a throwing user lookup warns once and falls back to the default look', () => {
  const warn = vi.fn();
  const getUser = () => {
    throw new Error('x');
  };
  const resolver = createLookResolver({
    registry: createRegistry({ warn: () => {} }),
    getUser,
    warn,
  });
  const dec = resolver.decorate(null, {}, 'u');
  expect(dec(term(20), RES, 0)).toEqual({ appearance: DEFAULT_APPEARANCE });
  expect(() => dec(term(20), RES, 0)).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(1);
});

describe('damage theme (P4-D3)', () => {
  const THEME = { appearance: LOOKS['jade-marble'].appearance, soundMaterial: 'stone' };
  const themed = (users = {}, actors = {}) => {
    const registry = createRegistry({ warn: () => {} });
    return createLookResolver({
      registry,
      getUser: (id) => users[id],
      getActor: (id) => actors[id],
      damageThemeFor: () => () => THEME,
      warn: () => {},
    });
  };
  test('beats the actor flag and the user look; carries soundMaterial', () => {
    const actors = { a1: { flags: { dicer: { appearance: { look: 'ruby-classic' } } } } };
    const users = { u: user({ global: { look: 'sharp-crystal' } }) };
    const out = look(themed(users, actors), term(6, { options: { dsnActorId: 'a1' } }), 'u');
    expect(out.appearance).toBe(THEME.appearance);
    expect(out.soundMaterial).toBe('stone');
  });
  test('loses to options.colorset, with no soundMaterial', () => {
    const r = themed();
    const byColorset = look(r, term(6, { options: { colorset: 'fire' } }), 'u');
    expect(byColorset.appearance).toEqual(fire);
    expect(byColorset.soundMaterial).toBeUndefined();
  });
  test('beats a flavor colorset: a PF2e/5e die flavored [fire] gets the fire damage theme, not the flat colorset', () => {
    const byFlavor = look(themed(), term(6, { flavor: 'Fire' }), 'u');
    expect(byFlavor.appearance).toBe(THEME.appearance);
    expect(byFlavor.soundMaterial).toBe('stone');
    const named = look(themed(), term(6, { flavor: 'die:fire' }), 'u');
    expect(named.appearance).toBe(THEME.appearance);
  });
  test("damageOverDiceSet: the damage look beats the player's module dice set (no model or faces of it); off keeps the set", async () => {
    const registry = createRegistry({ warn: () => {} });
    await registry.addDicePreset({ type: 'd6', system: 'trs', labels: ['a', 'b', 'c', 'd', 'e', 'f'], modelFile: 'd6.glb' });
    const users = { u: user({ global: { look: 'default', system: 'trs', chosen: true } }) };
    const make1 = (themeOf, damageOverDiceSet) =>
      createLookResolver({
        registry,
        getUser: (id) => users[id],
        damageThemeFor: () => themeOf,
        facesFor: () => ({ key: 'f', labels: [] }),
        ...(damageOverDiceSet ? { damageOverDiceSet } : {}),
        warn: () => {},
      });
    const damaged = look(make1(() => THEME), term(6), 'u');
    expect(damaged.appearance).toBe(THEME.appearance);
    expect(damaged).not.toHaveProperty('model');
    expect(damaged).not.toHaveProperty('faces');
    expect(damaged.system).toBe('standard');
    // a die with no damage type still rolls the set
    const plain = look(make1(() => null), term(6), 'u');
    expect(plain.model).toBe('d6.glb');
    expect(plain.system).toBe('trs');
    // a system the roll names itself still applies
    expect(look(make1(() => THEME), term(6, { options: { appearance: { system: 'trs' } } }), 'u').model).toBe('d6.glb');
    // the setting off: the set's model and faces stay on the damage die
    const kept = look(make1(() => THEME, () => false), term(6), 'u');
    expect(kept.model).toBe('d6.glb');
    expect(kept.appearance).toBe(THEME.appearance);
  });
  test('a flavor colorset still applies to a die with no damage theme', () => {
    const registry = createRegistry({ warn: () => {} });
    const r = createLookResolver({ registry, getUser: () => undefined, damageThemeFor: () => () => null, warn: () => {} });
    expect(look(r, term(6, { flavor: 'Fire' }), 'u').appearance).toEqual(fire);
  });
  test('a throwing damageThemeFor leaves the normal chain', () => {
    const registry = createRegistry({ warn: () => {} });
    const r = createLookResolver({
      registry,
      getUser: () => undefined,
      damageThemeFor: () => {
        throw new Error('x');
      },
      warn: () => {},
    });
    expect(look(r, term(6), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('themes in the look chain (Plan 5)', () => {
  const hoard = findTheme('dragon-hoard');
  const obsidian = findTheme('obsidian');
  /** A user whose dicer.appearance and dicer.themes flags are given. */
  const userT = (appearance, themes) => ({
    getFlag: (s, k) => (s !== 'dicer' ? undefined : k === 'appearance' ? appearance : k === 'themes' ? themes : undefined),
  });
  const makeT = ({ users = {}, actors = {}, worldThemes = [] } = {}) => {
    const warn = vi.fn();
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: (id) => users[id],
      getActor: (id) => actors[id],
      getWorldThemes: () => worldThemes,
      warn,
    });
    return { resolver, warn };
  };
  const msg = (pf2eType) => ({ flags: { pf2e: { context: { type: pf2eType } } } });
  const lookOn = (resolver, message, t, authorId) => resolver.decorate(message, {}, authorId)(t, RES, 0);

  test("a chat message's speaker brings its actor's theme (a roll from the character sheet)", () => {
    const users = { u: userT({ global: { appearance: null, chosen: true, colorset: null, look: null, system: null, theme: 'default' } }, []) };
    const actors = { A: { flags: { dicer: { appearance: { global: { appearance: null, colorset: null, look: null, system: null, theme: 'verdant' } } } } } };
    const { resolver } = makeT({ users, actors });
    const t = term(20);
    expect(lookOn(resolver, { speaker: { actor: 'A' }, author: { id: 'u' } }, t, 'u').themeId).toBe('verdant');
    expect(lookOn(resolver, { speaker: { actor: null }, author: { id: 'u' } }, t, 'u').themeId).toBe('default');
    // a die's own dsnActorId still wins over the speaker
    const other = { faces: 20, options: { dsnActorId: 'B' }, results: [{ result: 1 }] };
    expect(lookOn(resolver, { speaker: { actor: 'A' } }, other, 'u').themeId).toBe('default');
  });

  test("a theme imported from a module dice set rolls on the set's system, in the theme's colours", () => {
    const elara = { id: 'user.u.elara', name: 'Elara', appearance: RUBY, system: 'grayce-raven' };
    const { resolver } = makeT({ users: { u: userT({ global: { theme: elara.id } }, [elara]), v: userT({ global: { theme: 'mine' } }, [{ id: 'mine', name: 'Mine', appearance: RUBY }]) } });
    const got = look(resolver, term(20), 'u');
    expect(got.system).toBe('grayce-raven');
    expect(got.appearance).toEqual(normalizeAppearance(RUBY));
    expect(look(resolver, term(20), 'v').system).toBe('standard'); // a theme without one keeps the standard dice
  });

  test('perType.d7 and perType.df looks apply', () => {
    const fate = Object.assign(Object.create({ constructor: { DENOMINATION: 'f' } }), term(3));
    const mine = {
      id: 'mine',
      name: 'Mine',
      appearance: RUBY,
      perType: { d3: CRYSTAL, d5: CRYSTAL, d7: CRYSTAL, df: CRYSTAL, d14: hoard.appearance, d16: CRYSTAL },
    };
    const { resolver } = makeT({ users: { u: userT({ global: { theme: 'mine' } }, [mine]) } });
    const got = (t) => look(resolver, t, 'u');
    expect(got(fate).dsnType).toBe('df');
    expect(got(fate).appearance).toEqual(normalizeAppearance(CRYSTAL));
    for (const n of [3, 5, 7, 16]) expect(got(term(n)).appearance).toEqual(normalizeAppearance(CRYSTAL));
    // A d7 looks up d7, never the d14 it is thrown on.
    expect(got(term(14)).appearance).toEqual(normalizeAppearance(hoard.appearance));
    expect(got(term(7)).appearance).not.toEqual(got(term(14)).appearance);
    expect(got(term(20)).appearance).toEqual(normalizeAppearance(RUBY)); // the fallback is unchanged
  });

  test('a DSN preset for df gives a Fate die its colorset', () => {
    const registry = createRegistry({ warn: () => {} });
    registry.addColorset({ name: 'fateset', foreground: '#ffffff', background: '#123456' });
    registry.addDicePreset({ type: 'df', labels: ['-', '', '+'], colorset: 'fateset' }, 'd6');
    const r = createLookResolver({ registry, getUser: () => undefined, warn: () => {} });
    const fate = Object.assign(Object.create({ constructor: { DENOMINATION: 'f' } }), term(3));
    const out = look(r, fate, 'u');
    expect(out.dsnType).toBe('df');
    expect(out.appearance).toEqual(colorsetNameToAppearance('fateset', registry, 0));
  });

  test('a global theme ref resolves per die type, with its id and sound material', () => {
    const { resolver } = makeT({ users: { u: userT({ global: { theme: 'celestial' } }) } });
    const d20 = look(resolver, term(20), 'u');
    expect(d20.appearance).toBe(findTheme('celestial').perType.d20);
    expect(d20.themeId).toBe('celestial');
    expect(d20.soundMaterial).toBe('glass');
    expect(look(resolver, term(6), 'u').appearance).toBe(findTheme('celestial').appearance);
  });
  test('a role ref beats a type ref on an attack roll and is ignored on a damage roll', () => {
    const flag = { 'role:attack': { theme: 'obsidian' }, d20: { look: 'ruby-classic' } };
    const { resolver } = makeT({ users: { u: userT(flag) } });
    const attack = lookOn(resolver, msg('attack-roll'), term(20), 'u');
    expect(attack.appearance).toBe(obsidian.appearance);
    expect(attack.themeId).toBe('obsidian');
    expect(lookOn(resolver, msg('damage-roll'), term(20), 'u').appearance).toBe(RUBY);
    expect(lookOn(resolver, null, term(20), 'u').appearance).toBe(RUBY); // showForRoll: no role
  });
  test("an actor's theme ref beats the user's", () => {
    const actors = { a1: { flags: { dicer: { appearance: { theme: 'obsidian' } } } } };
    const users = { u: userT({ global: { theme: 'dragon-hoard' } }) };
    const { resolver } = makeT({ users, actors });
    const out = look(resolver, term(20, { options: { dsnActorId: 'a1' } }), 'u');
    expect(out.appearance).toBe(obsidian.appearance);
    expect(out.themeId).toBe('obsidian');
  });
  test("a damage theme's sound material wins over the theme's", () => {
    const users = { u: userT({ global: { theme: 'dragon-hoard' } }) };
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: (id) => users[id],
      damageThemeFor: () => () => ({ appearance: RUBY, soundMaterial: 'stone' }),
      warn: () => {},
    });
    const out = look(resolver, term(6), 'u');
    expect(out).toMatchObject({ appearance: RUBY, soundMaterial: 'stone' });
    expect(out.themeId).toBeUndefined();
  });
  test("the roller's own and the world's themes resolve; bad stored entries are skipped", () => {
    const mine = { id: 'user.mine', name: 'Mine', appearance: { body: { type: 'opaque', color: '#0000aa' } } };
    const world = { id: 'world.ours', name: 'Ours', appearance: { body: { type: 'opaque', color: '#00aa00' } } };
    const users = {
      u: userT({ global: { theme: 'user.mine' } }, [5, mine]),
      v: userT({ global: { theme: 'world.ours' } }),
    };
    const { resolver } = makeT({ users, worldThemes: [world, null] });
    expect(look(resolver, term(6), 'u').appearance.body.color).toBe('#0000aa');
    expect(look(resolver, term(6), 'v').appearance.body.color).toBe('#00aa00');
    expect(look(resolver, term(6), 'v').themeId).toBe('world.ours');
  });
  test('a ref to a deleted user theme falls back to the default look, one warning per roller', () => {
    const users = {
      u: userT({ global: { theme: 'user.gone' } }, []),
      v: userT({ global: { theme: 'user.gone' } }, []),
    };
    const { resolver, warn } = makeT({ users });
    expect(look(resolver, term(20), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
    expect(look(resolver, term(6), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
    expect(look(resolver, term(20), 'u').themeId).toBeUndefined();
    const missing = () => warn.mock.calls.filter((c) => String(c[0]).includes('user.gone'));
    expect(missing()).toHaveLength(1);
    look(resolver, term(20), 'v');
    expect(missing()).toHaveLength(2);
  });
});

describe('actor theme assignment (the theme browser write)', () => {
  const actorWith = (appearance) => ({ a1: { flags: { dicer: { appearance } } } });
  const t20 = { options: { dsnActorId: 'a1' } };

  test("{global: {theme}} as written by the browser's slotPatch resolves to the theme", () => {
    const { resolver } = make({ actors: actorWith(slotPatch('global', 'celestial')) });
    const out = look(resolver, term(20, t20), 'u');
    expect(out.themeId).toBe('celestial');
    expect(out.appearance).toBe(findTheme('celestial').perType.d20);
  });
  test('assigning a theme via global beats an old flat look on the same actor; the flat form still works alone', () => {
    const merged = { look: 'ruby-classic', ...slotPatch('global', 'dragon-hoard') };
    const { resolver } = make({ actors: actorWith(merged) });
    expect(look(resolver, term(20, t20), 'u').themeId).toBe('dragon-hoard');
    const flat = make({ actors: actorWith({ look: 'ruby-classic' }) }).resolver;
    expect(look(flat, term(20, t20), 'u').appearance).toBe(RUBY);
  });
  test('Clear removes only the global slot (what remains is the flat flag)', () => {
    const { resolver } = make({ actors: actorWith({ look: 'ruby-classic' }) });
    expect(look(resolver, term(20, t20), 'u').appearance).toBe(RUBY);
  });
  test("a viewer-sourced damage theme's source is carried on the partial", () => {
    const registry = createRegistry({ warn: () => {} });
    const resolver = createLookResolver({
      registry,
      getUser: () => undefined,
      warn: () => {},
      damageThemeFor: () => () => ({ appearance: RUBY, themeId: 'dragon-hoard', themeSource: 'viewer' }),
    });
    expect(look(resolver, term(20), 'u')).toMatchObject({ themeId: 'dragon-hoard', themeSource: 'viewer' });
  });
});

describe('GM controls: world default theme and the player lock (P7-D4)', () => {
  const T = (id) => ({ global: { theme: id } });
  const dieOf = (id) => findTheme(id).appearance;
  const plain = term(20);
  test('without the lock the world default is the fallback for a player with no choice of their own', () => {
    const { resolver } = make({ users: { p: user(undefined) }, worldDefault: 'verdant' });
    const got = look(resolver, plain, 'p');
    expect(got.themeId).toBe('verdant');
    expect(got.appearance).toBe(dieOf('verdant'));
  });
  test('without the lock a player choice (global, per-type) beats the world default; the default beats DEFAULT_APPEARANCE only when unset', () => {
    const users = { p: user({ ...T('ruby-classic'), d6: T('obsidian').global }) };
    const { resolver } = make({ users, worldDefault: 'verdant' });
    expect(look(resolver, plain, 'p').themeId).toBe('ruby-classic');
    expect(look(resolver, term(6), 'p').themeId).toBe('obsidian');
    const none = make({ users: { p: user(undefined) } });
    expect(look(none.resolver, plain, 'p').appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test('an unset or missing world default falls through to the next look; a missing theme warns once', () => {
    const { resolver, warn } = make({ users: { p: user(undefined) }, worldDefault: 'world.gone' });
    expect(look(resolver, plain, 'p').appearance).toEqual(DEFAULT_APPEARANCE);
    look(resolver, plain, 'p');
    expect(warn.mock.calls.filter((c) => /world\.gone/.test(c[0]))).toHaveLength(1);
  });
  test("a mirrored 'never chose' global (the real themeRef shape, or none) lets the world default apply", () => {
    for (const flag of [{ global: themeRef('default') }, { global: { look: 'default' } }, { global: { theme: 'default' } }]) {
      const { resolver } = make({ users: { p: user(flag) }, worldDefault: 'verdant' });
      expect(look(resolver, plain, 'p').themeId).toBe('verdant');
    }
    // a real choice, even of another theme or a colorset on top of default, still wins
    const keep = make({ users: { p: user({ global: themeRef('obsidian') }) }, worldDefault: 'verdant' });
    expect(look(keep.resolver, plain, 'p').themeId).toBe('obsidian');
    const cs = make({ users: { p: user({ global: { theme: 'default', colorset: 'fire' } }) }, worldDefault: 'verdant' });
    expect(look(cs.resolver, plain, 'p').appearance).toEqual(fire);
    // without a world default the built-in default is unchanged
    const none = make({ users: { p: user({ global: themeRef('default') }) } });
    expect(look(none.resolver, plain, 'p').appearance).toEqual(LOOKS.default.appearance);
  });
  test("a deliberate 'default' choice (chosenRef) beats the world default; the old unmarked auto-mirror does not", () => {
    const wd = (flag) => make({ users: { p: user(flag) }, worldDefault: 'verdant' });
    const chosen = wd({ global: chosenRef('default') });
    expect(look(chosen.resolver, plain, 'p').appearance).toEqual(LOOKS.default.appearance);
    const old = wd({ global: { theme: 'default' } });
    expect(look(old.resolver, plain, 'p').themeId).toBe('verdant');
  });
  test('switching from another theme back to default (the real mirror write, merged) keeps Sapphire', async () => {
    let flag = { global: themeRef('obsidian') };
    const u = {
      getFlag: () => flag,
      setFlag: async (s, k, patch) => {
        flag = { ...flag, global: { ...flag.global, ...patch.global } }; // setFlag merges
      },
    };
    await mirrorLookSetting(u, 'default');
    const { resolver } = make({ users: { p: u }, worldDefault: 'verdant' });
    expect(look(resolver, plain, 'p').appearance).toEqual(LOOKS.default.appearance);
  });
  test('the lock makes the world default win over a player own refs (global, type, role) and actor flags', () => {
    const users = { p: user({ ...T('ruby-classic'), d20: T('obsidian').global, 'role:attack': T('obsidian').global }) };
    const actors = { a1: { flags: { dicer: { appearance: T('obsidian') } } } };
    const { resolver } = make({ users, actors, worldDefault: 'verdant', lock: true });
    const t = term(20, { options: { dsnActorId: 'a1' } });
    const got = resolver.decorate({ flags: { dicer: { role: 'attack' } } }, {}, 'p')(t, RES, 0);
    expect(got.themeId).toBe('verdant');
    expect(look(resolver, term(6), 'p').themeId).toBe('verdant');
  });
  test('the lock never applies to a GM, and does nothing without a world default', () => {
    const users = { g: { isGM: true, ...user(T('ruby-classic')) }, p: user(T('ruby-classic')) };
    const locked = make({ users, worldDefault: 'verdant', lock: true });
    expect(look(locked.resolver, plain, 'g').themeId).toBe('ruby-classic');
    const noDefault = make({ users, worldDefault: '', lock: true });
    expect(look(noDefault.resolver, plain, 'p').themeId).toBe('ruby-classic');
  });
  test('explicit roll colorsets and appearances and damage themes keep their precedence under the lock', () => {
    const damageThemeFor = () => (t) => ({ appearance: CRYSTAL, themeId: 'obsidian', soundMaterial: 'metal' });
    const registry = createRegistry({ warn: () => {} });
    const resolver = createLookResolver({
      registry,
      getUser: () => user(T('ruby-classic')),
      damageThemeFor,
      warn: () => {},
      getWorldDefaultTheme: () => 'verdant',
      getLockPlayerLooks: () => true,
    });
    const via = (t) => resolver.decorate(null, {}, 'p')(t, RES, 0);
    expect(via(plain).themeId).toBe('obsidian'); // the damage theme
    expect(via(term(20, { options: { colorset: 'fire' } })).appearance).toEqual(fire);
    const explicit = { appearance: { body: { type: 'opaque', color: '#123456' } } };
    expect(via(term(20, { options: explicit })).appearance.body.color).toBe('#123456');
  });
  test('a locked player with a throwing user lookup still gets a look', () => {
    const { resolver } = make({ users: {}, worldDefault: 'verdant', lock: true });
    expect(look(resolver, plain, 'nobody').themeId).toBe('verdant');
  });
});

describe('module default providers (theme-registry.js)', () => {
  afterEach(() => PROVIDERS.clear());

  test("an actor nobody picked dice for wears a provider's theme; an actor's own choice wins; nothing is written", () => {
    PROVIDERS.set('necromancer-thrall-helper', (a) => (a.necro ? 'ruby-classic' : null));
    const necro = { necro: true, flags: { dicer: {} } };
    const chose = { necro: true, flags: { dicer: { appearance: { global: themeRef('sharp-crystal') } } } };
    const plain = { flags: { dicer: {} } };
    const { resolver } = make({ actors: { necro, chose, plain } });
    const roll = (id) => look(resolver, term(20, { options: { dsnActorId: id } }), 'u');
    expect(roll('necro').appearance).toEqual(RUBY);
    expect(roll('chose').appearance).toEqual(CRYSTAL);
    expect(roll('plain').appearance).toEqual(DEFAULT_APPEARANCE);
    expect(necro.flags.dicer).toEqual({}); // never written
  });
});

describe('the speaking token (an unlinked thrall token)', () => {
  afterEach(() => PROVIDERS.clear());

  test("a provider sees the token's own actor; a choice set on that token alone wins; a term's own actor still goes first", () => {
    // the base actor has no flags; the token's synthetic actor carries the thrall mark (or a choice)
    const base = { flags: { dicer: {} } };
    const thrallToken = { thrall: true, flags: { dicer: {} } };
    const chosenToken = { thrall: true, flags: { dicer: { appearance: { global: themeRef('sharp-crystal') } } } };
    const tokens = { t1: thrallToken, t2: chosenToken };
    PROVIDERS.set('necromancer-thrall-helper', (a) => (a.thrall ? 'ruby-classic' : null));
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: () => undefined,
      getActor: (id) => (id === 'base' ? base : undefined),
      getTokenActor: (scene, token) => (scene === 's' ? tokens[token] : null),
      warn: () => {},
    });
    const roll = (token, options = {}) =>
      resolver.decorate(null, {}, 'u', { actor: 'base', scene: 's', token })(term(20, { options }), RES, 0).appearance;
    expect(roll('t1')).toEqual(RUBY); // the provider saw the thrall token
    expect(roll('t2')).toEqual(CRYSTAL); // the token's own choice
    expect(roll('t1', { dsnActorId: 'base' })).toEqual(DEFAULT_APPEARANCE); // the term names the base actor
  });
});

// Ember Lunar Dice: a roller may have their default dice follow Ember's moons (compat/installed-dice.js
// puts moonRef on the registry once the dice are loaded)
describe("a roller's default dice follow the moon (registry.moonRef)", () => {
  const sets = async (registry) => {
    await registry.addDicePreset({ type: 'd20', system: 'moon-cora', labels: [], modelFile: 'cora.glb' });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'pf2e.glb' });
    await registry.addDicePreset({ type: 'd6', system: 'pf2e', labels: [], modelFile: 'pf2e6.glb' });
  };
  test("the moon's set is their default system; their own look still colours what the set leaves", async () => {
    const u = user({ global: { look: 'ruby-classic', system: 'pf2e' } });
    const { registry, resolver } = make({ users: { u } });
    await sets(registry);
    expect(look(resolver, term(20), 'u').model).toBe('pf2e.glb');
    registry.moonRef = vi.fn((who, looks) => who === u && (looks.global = { ...looks.global, system: 'moon-cora' }));
    const out = look(resolver, term(20), 'u');
    expect(out).toMatchObject({ model: 'cora.glb', system: 'moon-cora' });
    expect(out.appearance).toBe(RUBY);
    expect(registry.moonRef).toHaveBeenCalledWith(u, expect.any(Object));
    // a user who never chose a look
    const none = make({ users: { n: user(undefined) } });
    await sets(none.registry);
    none.registry.moonRef = (who, looks) => (looks.global = { ...looks.global, system: 'moon-cora' });
    expect(look(none.resolver, term(20), 'n')).toMatchObject({ model: 'cora.glb', appearance: DEFAULT_APPEARANCE });
  });
  test('no moon up (null) leaves their own dice; dice they chose for a die type or an actor stay', async () => {
    const u = user({ global: { look: 'ruby-classic' }, d6: { system: 'pf2e' } });
    const actors = { a: { flags: { dicer: { appearance: { global: { system: 'pf2e' } } } } } };
    const { registry, resolver } = make({ users: { u }, actors });
    await sets(registry);
    registry.moonRef = () => null;
    expect(look(resolver, term(20), 'u').model).toBeUndefined();
    registry.moonRef = (who, looks) => (looks.global = { ...looks.global, system: 'moon-cora' });
    expect(look(resolver, term(6), 'u').model).toBe('pf2e6.glb');
    expect(look(resolver, term(20, { options: { dsnActorId: 'a' } }), 'u').model).toBe('pf2e.glb');
  });
  test("under the GM's lock on player looks the moon is not asked", async () => {
    const u = user({ global: { look: 'ruby-classic' } });
    const { registry, resolver } = make({ users: { u }, worldDefault: 'obsidian', lock: true });
    await sets(registry);
    registry.moonRef = vi.fn(() => 'moon-cora');
    expect(look(resolver, term(20), 'u').model).toBeUndefined();
    expect(registry.moonRef).not.toHaveBeenCalled();
  });
  test('a moonRef that throws never reaches the roll: the die gets the default look, warned once', async () => {
    const u = user({ global: { look: 'ruby-classic' } });
    const { registry, resolver, warn } = make({ users: { u } });
    registry.moonRef = () => {
      throw new Error('boom');
    };
    expect(look(resolver, term(20), 'u').appearance).toBe(DEFAULT_APPEARANCE);
    expect(look(resolver, term(6), 'u').appearance).toBe(DEFAULT_APPEARANCE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
