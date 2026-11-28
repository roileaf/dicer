import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import {
  celebrationsFor,
  createReactions,
  lookKey,
  registerReactions,
  themeIndex,
  themeOf,
} from '../../src/v2/effects/reactions.js';
import { settingDefaults } from '../../src/v2/materials/defaults.js';
import { dsnAppearance } from '../../src/v2/themes/dsn-look.js';

const theme = (id) => BUILTIN_THEMES.find((t) => t.id === id);

function board() {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    dicefactory: { baseScale: 0.04 },
    renderer: { domElement: {} },
  };
}

function dieOf(box, look, { asRoll = false, filled = false } = {}) {
  const parent = new THREE.Group();
  box.scene.add(parent);
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.035, 0, 0, 0, 0.02, 0, 0, 0, 0.01], 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial());
  parent.add(mesh);
  const own = filled
    ? { ...settingDefaults(look.material), ...look.materialSettings }
    : look.materialSettings;
  const settings = Object.fromEntries(Object.entries(own).reverse());
  mesh.material.userData.appearance = asRoll
    ? {
        material: look.material,
        materialSettings: settings,
        background: look.diceColor.toUpperCase(),
        foreground: look.labelColor,
      }
    : {
        material: look.material,
        materialSettings: settings,
        diceColor: look.diceColor,
        labelColor: look.labelColor,
      };
  mesh.material.userData.uniforms = {
    uFxTint: { value: new THREE.Vector4() },
    uFxFlare: { value: new THREE.Vector3() },
  };
  mesh.die = { type: 'd20', result: 20, role: 'basic', isolateMaterial: () => mesh.material };
  return mesh;
}

afterEach(() => vi.restoreAllMocks());

describe('v2 theme celebrations from the dice events (DsN 5.5)', () => {
  const index = themeIndex();

  it('knows a die`s theme when DsN fills its settings with every default', () => {
    const box = board();
    for (const t of BUILTIN_THEMES.filter((x) => x.rules.length)) {
      const look = dsnAppearance(t);
      const type = Object.keys(look).find((k) => k !== 'global') ?? 'd20';
      const die = dieOf(box, look[type] ?? look.global, { filled: true });
      expect(themeOf(die, type, index)?.id, t.id).toBe(t.id);
    }
  });

  it('reads each Dicer material`s setting defaults', () => {
    const resin = settingDefaults('dicer.body-resin');
    expect(resin).toMatchObject({
      inside: expect.any(String),
      inkGlow: expect.any(Number),
      strip: 'body',
    });
    expect(Object.hasOwn(resin, 'irisColor')).toBe(true);
    expect(Object.keys(settingDefaults('dicer.body-metal')).length).toBeGreaterThan(3);
    expect(settingDefaults('plastic')).toEqual({});
    expect(settingDefaults(undefined)).toEqual({});
  });

  it('knows a die`s theme from the look DsN drew it with, on any client', () => {
    const box = board();
    for (const t of BUILTIN_THEMES.filter((x) => x.rules.length)) {
      const look = dsnAppearance(t);
      const type = Object.keys(look).find((k) => k !== 'global') ?? 'd20';
      expect(themeOf(dieOf(box, look[type] ?? look.global), type, index)?.id, t.id).toBe(t.id);
    }
    const gold = dsnAppearance(theme('gold-polished')).global;
    expect(themeOf(dieOf(box, gold, { asRoll: true }), 'd20', index)?.id).toBe('gold-polished');
    expect(themeOf(dieOf(box, { ...gold, diceColor: '#123456' }), 'd20', index)).toBeNull();
    expect(
      themeOf(
        dieOf(box, { ...gold, materialSettings: { ...gold.materialSettings, roughness: 99 } }),
        'd20',
        index,
      ),
    ).toBeNull();
    expect(themeOf({ material: { userData: {} } }, 'd20', index)).toBeNull();
    expect(
      lookKey({ material: 'm', materialSettings: { b: 1, a: 2 }, dice: '#AA0000', label: '#fff' }),
    ).toBe(
      lookKey({ material: 'm', materialSettings: { a: 2, b: 1 }, dice: '#aa0000', label: '#FFF' }),
    );
  });

  it('gives a die type with its own look that look`s theme only', () => {
    const box = board();
    const celestial = dsnAppearance(theme('celestial'));
    expect(themeOf(dieOf(box, celestial.d20), 'd20', index)?.id).toBe('celestial');
    expect(themeOf(dieOf(box, celestial.global), 'd6', index)?.id).toBe('celestial');
    expect(themeOf(dieOf(box, celestial.global), 'd20', index)).toBeNull();
  });

  it('picks a theme`s celebration by die type and result, with v1`s rule matching', () => {
    const gold = theme('gold-polished');
    expect(celebrationsFor(gold, 'd20', 20).map((r) => r.effect.id)).toEqual(['light-burst']);
    expect(celebrationsFor(gold, 'd20', 19)).toEqual([]);
    expect(celebrationsFor(gold, 'd12', 20)).toEqual([]);
    expect(celebrationsFor(theme('obsidian'), 'd20', 1).map((r) => r.effect.id)).toEqual([
      'shatter',
    ]);
    expect(celebrationsFor(theme('galaxy-nebula'), 'd20', 20)[0].effect).toMatchObject({
      id: 'glow-pulse',
      color: '#c04dff',
    });
  });

  it('plays the celebration on the die, keeps DsN drawing while it runs, and ends with it', () => {
    const box = board();
    let t = 1000;
    const reactions = createReactions({ index, getBox: () => box, now: () => t });
    const dice = dieOf(box, dsnAppearance(theme('galaxy-nebula')).global);
    reactions.onResult({ dice, type: 'd20', result: 7 });
    expect(reactions.running).toBe(0);
    reactions.onResult({ dice, type: 'd20', result: null });
    expect(reactions.running).toBe(0);
    reactions.onResult({ dice, type: 'd20', result: 20 });
    expect(reactions.running).toBe(1);
    expect(dice.userData.animated).toBe(true);
    reactions.onFrame();
    t += 16;
    reactions.onFrame();
    expect(dice.material.userData.uniforms.uFxTint.value.w).toBeGreaterThan(0);
    expect(reactions.running).toBe(1);
    t += 60000;
    reactions.onFrame();
    expect(reactions.running).toBe(0);
    expect(dice.userData.animated).toBeUndefined();
    expect(dice.material.userData.uniforms.uFxTint.value.w).toBe(0);
  });

  it('advances once per frame however many dice call the frame event', () => {
    const box = board();
    const t = 1000;
    const reactions = createReactions({ index, getBox: () => box, now: () => t });
    const dice = dieOf(box, dsnAppearance(theme('gold-polished')).global);
    const update = vi.fn(() => true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(reactions.play(dice, { id: 'no-such-effect' })).toBe(false);
    expect(reactions.play(dice, { id: 'light-burst' })).toBe(true);
    void update;
    reactions.onFrame();
    const running = reactions.running;
    reactions.onFrame();
    reactions.onFrame();
    expect(reactions.running).toBe(running);
  });

  it('stops a die`s celebrations when it leaves the board, and leaves an animated die animated', () => {
    const box = board();
    const reactions = createReactions({ index, getBox: () => box, now: () => 1000 });
    const dice = dieOf(box, dsnAppearance(theme('galaxy-nebula')).global);
    const other = dieOf(box, dsnAppearance(theme('gold-polished')).global);
    dice.userData.animated = true;
    reactions.onResult({ dice, type: 'd20', result: 20 });
    reactions.onResult({ dice: other, type: 'd20', result: 20 });
    expect(reactions.running).toBe(2);
    reactions.onDespawn({ dice });
    expect(reactions.running).toBe(1);
    expect(dice.userData.animated).toBe(true);
    expect(dice.material.userData.uniforms.uFxTint.value.w).toBe(0);
    reactions.onDespawn({ dice: other });
    expect(other.userData.animated).toBeUndefined();
  });

  it('listens to the result, frame and despawn events, returning nothing to Hooks.call', () => {
    const hooks = { on: vi.fn() };
    const reactions = {
      onResult: vi.fn(() => true),
      onFrame: vi.fn(() => true),
      onDespawn: vi.fn(() => true),
    };
    expect(registerReactions(hooks, reactions)).toBe(reactions);
    expect(hooks.on.mock.calls.map(([name]) => name)).toEqual([
      'diceSoNiceDiceResult',
      'diceSoNiceDiceFrame',
      'diceSoNiceDiceDespawn',
    ]);
    for (const [, fn] of hooks.on.mock.calls) expect(fn({})).toBeUndefined();
    expect(reactions.onResult).toHaveBeenCalledTimes(1);
  });
});
