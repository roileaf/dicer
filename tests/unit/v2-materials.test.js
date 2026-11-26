import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DiceMaterial } from '../../tests/helpers/dsn-api.js';
import {
  applySettings,
  BODY_TYPES,
  bodyGlsl,
  bodyMaterialId,
  createBodyMaterial,
  LOCAL_SCALE,
  localScaleOf,
  patchBodyShader,
  presetsOf,
  registerBodies,
} from '../../src/v2/materials/bodies.js';

const physical = () => ({
  uniforms: {},
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
});

/** A three.js material as DsN hands it to the callbacks: its uniforms copied in userData. */
function dsnMaterial(material, appearance) {
  const mat = new THREE.MeshPhysicalMaterial(material.base.options);
  mat.userData.uniforms = {};
  for (const [name, value] of material._uniforms)
    mat.userData.uniforms[name] = { value: value?.clone?.() ?? value };
  for (const cb of material._process) cb('d20', mat, appearance);
  mat.userData.appearance = appearance;
  return mat;
}

describe('v2 body materials (DsN 5.1)', () => {
  it('registers the nine opaque bodies under dicer ids, without awaiting DsN', () => {
    const dice3d = { addMaterial: vi.fn(() => Promise.resolve()) };
    const ids = registerBodies(dice3d, DiceMaterial);
    expect(BODY_TYPES).toEqual([
      'opaque',
      'metal',
      'marble',
      'pearl',
      'iridescent',
      'gem',
      'wood',
      'stone',
      'bone',
    ]);
    expect(ids).toEqual(BODY_TYPES.map((t) => `dicer.body-${t}`));
    expect(dice3d.addMaterial).toHaveBeenCalledTimes(9);
    for (const [m] of dice3d.addMaterial.mock.calls) {
      expect(m.base.type).toBe('physical'); // setBase before addMaterial
      expect(m.translucent).toBe(false); // none uses three's transmission
    }
  });

  it('gives each body its fallback, its Dicer impact sounds and a weight', () => {
    const m = Object.fromEntries(BODY_TYPES.map((t) => [t, createBodyMaterial(DiceMaterial, t)]));
    expect(m.metal.fallback).toBe('metal');
    expect(m.wood.fallback).toBe('wood');
    expect(m.stone.fallback).toBe('stone');
    expect(m.opaque.fallback).toBe('plastic');
    expect(m.metal.impactSounds).toBe('dicer.dice-metal');
    expect(m.wood.impactSounds).toBe('dicer.dice-wood');
    expect(m.marble.impactSounds).toBe('dicer.dice-stone');
    expect(m.opaque.impactSounds).toBe('dicer.dice-plastic');
    expect(m.bone.impactSounds).toBe('dicer.dice-wood');
    expect(m.metal.weight).toBe(7);
    expect(m.wood.weight).toBe(0.65);
    expect(m.metal.name).toBe('DICER.V2.Material.metal');
  });

  it('offers v1`s styles, finishes, second colour and roughness as material settings', () => {
    const ids = (t) => createBodyMaterial(DiceMaterial, t).settings.map((s) => s.id);
    expect(ids('wood')).toEqual(['preset', 'color2', 'roughness']);
    expect(ids('metal')).toEqual(['finish', 'color2', 'roughness']);
    expect(ids('iridescent')).toEqual(['preset', 'color2', 'roughness', 'streaks']);
    expect(ids('opaque')).toEqual(['roughness']);
    const wood = createBodyMaterial(DiceMaterial, 'wood').settings[0];
    expect(Object.keys(wood.options)).toEqual(['oak', 'walnut', 'cherry', 'ebony']);
    expect(wood.options.oak).toBe('DICER.Appearance.Preset.oak');
  });

  it('puts a look`s settings on its material: preset, second colour, roughness', () => {
    const wood = createBodyMaterial(DiceMaterial, 'wood');
    const mat = dsnMaterial(wood, {
      materialSettings: { preset: 'walnut', color2: '#ff0000', roughness: 80 },
    });
    expect(mat.userData.uniforms.uBodyPreset.value.toArray()).toEqual([1, 6, 2.2, 0.7]);
    expect(mat.userData.uniforms.uBodyColor2.value.getHexString()).toBe('ff0000');
    expect(mat.roughness).toBeCloseTo(0.8);
    // the defaults when the look comes from a colorset: the first preset
    const plain = dsnMaterial(wood, { materialSettings: {} });
    expect(plain.userData.uniforms.uBodyPreset.value.x).toBe(0);
    // each material owns its values (DsN copies the uniforms per three.js material)
    expect(plain.userData.uniforms.uBodyColor2.value).not.toBe(
      mat.userData.uniforms.uBodyColor2.value,
    );
  });

  it('a mirror metal is polished flawless whatever the roughness', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    applySettings('metal', mat, { finish: 'mirror', roughness: 60 });
    expect(mat.roughness).toBe(0.02);
  });

  it('splices v1`s body GLSL into three`s physical shader, with the label mask around it', () => {
    for (const type of BODY_TYPES.filter((t) => t !== 'opaque')) {
      const shader = patchBodyShader(physical(), bodyGlsl(type, 'patina'));
      const glsl = bodyGlsl(type, 'patina');
      expect(shader.vertexShader).toContain('vLocalPos = transformed * uDcLocalScale;');
      for (const d of glsl.defines) expect(shader.fragmentShader).toContain(`#define ${d}`);
      const f = shader.fragmentShader;
      // mask, body, restore: in that order, after DsN's map has set diffuseColor
      const at = (s) => f.indexOf(s);
      expect(at('#include <map_fragment>')).toBeLessThan(at('vec4 dcTexel'));
      expect(at('vec4 dcTexel')).toBeLessThan(at('mix( diffuseColor.rgb, dcTexel.rgb, dcMask )'));
      expect(f).toContain('texture2D( emissiveMap, vEmissiveMapUv )');
    }
  });

  it('leaves an opaque or polished metal shader alone', () => {
    const src = physical();
    const a = patchBodyShader(physical(), bodyGlsl('opaque'));
    const b = patchBodyShader(physical(), bodyGlsl('metal', 'polished'));
    expect(a.fragmentShader).toBe(src.fragmentShader);
    expect(b.fragmentShader).toBe(src.fragmentShader);
  });

  it('makes the same edits every time (DsN calls the shader callback again for a die`s copy)', () => {
    const gem = createBodyMaterial(DiceMaterial, 'gem');
    const mat = dsnMaterial(gem, { materialSettings: {} });
    const one = physical();
    const two = physical();
    gem._shader[0](one, mat);
    gem._shader[0](two, mat);
    expect(one.fragmentShader).toBe(two.fragmentShader);
    expect(one.fragmentShader).toContain('#define DICER_GEM');
  });

  it('maps DsN metres to v1 die units by the size of the die drawn (DsN sizes dice to the screen)', () => {
    // v1's dice have unit circumradius: a board die of radius 0.04 m and a preview die of 0.02 m
    const die = (r) =>
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([r, 0, 0, 0, -r / 2, 0, 0, 0, r / 3], 3),
      );
    const board = die(0.04);
    expect(localScaleOf(board)).toBeCloseTo(25, 4);
    expect(localScaleOf(die(0.02))).toBeCloseTo(50, 4);
    expect(localScaleOf(new THREE.BufferGeometry())).toBe(LOCAL_SCALE); // nothing to measure
    // every body carries the uniform, and its look follows the geometry at each draw
    for (const type of BODY_TYPES) {
      const material = createBodyMaterial(DiceMaterial, type);
      expect(material._uniforms.get('uDcLocalScale')).toBe(LOCAL_SCALE);
      const mat = dsnMaterial(material, { materialSettings: {} });
      mat.onBeforeRender(null, null, null, board);
      expect(mat.userData.uniforms.uDcLocalScale.value).toBeCloseTo(25, 4);
    }
    expect(presetsOf('stone')[0]).toBe('granite');
    expect(bodyMaterialId('gem')).toBe('dicer.body-gem');
  });
});
