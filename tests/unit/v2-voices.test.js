import { existsSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FX_SOUNDS as SCRIPT_FX,
  fxFile,
  PET_SOUNDS as SCRIPT_PET,
  PET_VOICES,
  petFile,
} from '../../scripts/build-dsn-voices.mjs';
import { PET_KINDS } from '../../src/pet/pet-for.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { createReactions, themeIndex } from '../../src/v2/effects/reactions.js';
import { createPet } from '../../src/v2/pets/pets.js';
import {
  createVoices,
  FX_SOUNDS,
  fxSoundUrl,
  PET_SOUNDS,
  petActionSound,
  petSoundUrl,
  registerVoiceSettings,
} from '../../src/v2/sounds/voices.js';
import { dsnAppearance } from '../../src/v2/themes/dsn-look.js';
import { TabletopObject } from '../helpers/dsn-api.js';

function world({ volume = 0.6, settings = {} } = {}) {
  const helper = { play: vi.fn() };
  const voices = createVoices({
    getDice3d: () => ({ box: { volume } }),
    getSetting: (key) => settings[key],
    getHelper: () => helper,
  });
  return { helper, voices };
}

afterEach(() => vi.restoreAllMocks());

describe('v2 rendered sounds: v1`s synthesized sounds as files', () => {
  it('ships every effect sound and every pet`s voice the module can ask for', () => {
    expect([...FX_SOUNDS]).toEqual([...SCRIPT_FX]);
    expect([...PET_SOUNDS]).toEqual([...SCRIPT_PET]);
    expect([...PET_VOICES].sort()).toEqual(PET_KINDS.filter((k) => k !== 'none').sort());
    for (const name of FX_SOUNDS) {
      expect(fxSoundUrl(name)).toBe(`modules/dicer/${fxFile(name)}`);
      expect(existsSync(fxFile(name)), fxFile(name)).toBe(true);
      expect(statSync(fxFile(name)).size).toBeGreaterThan(1000);
    }
    for (const kind of PET_VOICES)
      for (const name of PET_SOUNDS) {
        expect(petSoundUrl(kind, name)).toBe(`modules/dicer/${petFile(kind, name)}`);
        expect(statSync(petFile(kind, name)).size).toBeGreaterThan(1000);
      }
  });

  it('has a file for every sound a built-in theme`s celebration names', () => {
    const named = new Set(
      BUILTIN_THEMES.flatMap((t) => t.rules.map((r) => r.sound?.builtin)).filter(Boolean),
    );
    expect(named.size).toBeGreaterThan(3);
    for (const name of named) expect(fxSoundUrl(name), name).not.toBeNull();
  });

  it('knows no file for an unknown sound, a pet sound as an effect, or no pet', () => {
    expect(fxSoundUrl('petHappy')).toBeNull();
    expect(fxSoundUrl('../x')).toBeNull();
    expect(fxSoundUrl(undefined)).toBeNull();
    expect(petSoundUrl('none', 'petHappy')).toBeNull();
    expect(petSoundUrl('cat', 'chime')).toBeNull();
  });

  it('picks a pet`s sound from what it does', () => {
    expect(petActionSound('react', 'crit')).toBe('petHappy');
    expect(petActionSound('react', 'fumble')).toBe('petSad');
    expect(petActionSound('react', 'mixed')).toBe('petHuh');
    expect(petActionSound('react', 'plain')).toBe('petHmm');
    expect(petActionSound('pet')).toBe('petPurr');
    expect(petActionSound('startle')).toBe('petYelp');
    expect(petActionSound('throw')).toBeNull();
  });

  it('plays a file at DsN`s volume, locally, and not at all when DsN is silent', () => {
    const { helper, voices } = world({ volume: 0.6 });
    expect(voices.effect({ builtin: 'fanfare' })).toBe(true);
    expect(helper.play).toHaveBeenCalledWith(
      {
        src: 'modules/dicer/assets/sounds/dsn/fx/fanfare.ogg',
        volume: 0.6,
        autoplay: true,
        loop: false,
      },
      false,
    );
    expect(voices.pet('owl', 'pet')).toBe(true);
    expect(helper.play).toHaveBeenLastCalledWith(
      {
        src: 'modules/dicer/assets/sounds/dsn/pets/owl-petPurr.ogg',
        volume: 0.6,
        autoplay: true,
        loop: false,
      },
      false,
    );
    expect(voices.effect({ src: 'x.ogg' })).toBe(false);
    expect(voices.effect(null)).toBe(false);
    expect(voices.pet('owl', 'throw')).toBe(false);
    const silent = world({ volume: 0 });
    expect(silent.voices.effect({ builtin: 'fanfare' })).toBe(false);
    expect(silent.helper.play).not.toHaveBeenCalled();
  });

  it('follows the two sound settings, each on its own', () => {
    const a = world({ settings: { effectSounds: false } });
    expect(a.voices.effect({ builtin: 'chime' })).toBe(false);
    expect(a.voices.pet('cat', 'pet')).toBe(true);
    const b = world({ settings: { petSounds: false } });
    expect(b.voices.pet('cat', 'pet')).toBe(false);
    expect(b.voices.effect({ builtin: 'chime' })).toBe(true);
    const settings = { register: vi.fn() };
    registerVoiceSettings(settings);
    expect(settings.register.mock.calls.map(([, key, o]) => [key, o.scope, o.default])).toEqual([
      ['effectSounds', 'client', true],
      ['petSounds', 'client', true],
    ]);
  });

  it('a failing player does not break the roll', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const voices = createVoices({
      getDice3d: () => ({ box: { volume: 1 } }),
      getSetting: () => {
        throw new Error('not registered');
      },
      getHelper: () => ({
        play: () => {
          throw new Error('no audio');
        },
      }),
    });
    expect(voices.effect({ builtin: 'chime' })).toBe(false);
  });

  it('a theme`s celebration plays its sound with its effect', () => {
    const box = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      dicefactory: { baseScale: 0.04 },
      renderer: { domElement: {} },
    };
    const look = dsnAppearance(BUILTIN_THEMES.find((t) => t.id === 'gold-polished')).global;
    const parent = new THREE.Group();
    box.scene.add(parent);
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0.03, 0, 0, 0, 0.02, 0, 0, 0, 0.01], 3),
      ),
      new THREE.MeshPhysicalMaterial(),
    );
    parent.add(mesh);
    mesh.material.userData.appearance = {
      material: look.material,
      materialSettings: look.materialSettings,
      diceColor: look.diceColor,
      labelColor: look.labelColor,
    };
    mesh.die = { type: 'd20', result: 20, role: 'basic', isolateMaterial: () => mesh.material };
    const voices = { effect: vi.fn() };
    const reactions = createReactions({
      index: themeIndex(),
      getBox: () => box,
      now: () => 0,
      voices,
    });
    reactions.onResult({ dice: mesh, type: 'd20', result: 19 });
    expect(voices.effect).not.toHaveBeenCalled();
    reactions.onResult({ dice: mesh, type: 'd20', result: 20 });
    expect(voices.effect).toHaveBeenCalledWith({ builtin: 'fanfare' });
  });

  it('a pet speaks when it acts', async () => {
    const voice = vi.fn();
    const dice3d = {
      addTabletopObject: vi.fn(async (object) => {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
        object.model = scene;
      }),
      removeTabletopObject: vi.fn(),
    };
    const user = { id: 'u1', color: '#3366cc', getFlag: () => ({ kind: 'frog' }) };
    const pet = createPet({ TabletopObject, dice3d, user, voice });
    await pet.ready;
    pet.act('react', 'crit');
    expect(voice).toHaveBeenLastCalledWith('frog', 'react', 'crit');
    pet.act('pet');
    expect(voice).toHaveBeenLastCalledWith('frog', 'pet', 'plain');
    pet.act('no-such-pose');
    expect(voice).toHaveBeenCalledTimes(2);
  });
});
