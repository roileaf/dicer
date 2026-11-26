import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DiceMaterial } from '../../tests/helpers/dsn-api.js';
import { RESIN_REFRACTION } from '../../src/render/shaders/bodies.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { materialSettingsOf } from '../../src/v2/themes/dsn-look.js';
import {
  applyResinSettings,
  createResinMaterial,
  INSIDE_SHAPES,
  INSIDE_TYPES,
  insideUniforms,
  lookOf,
  onDiceCollide,
  onDiceFrame,
  onDiceResult,
  patchResinShader,
  registerInsideMotion,
  registerResin,
  RESIN_GAIN,
  resinGlsl,
} from '../../src/v2/materials/resin.js';

const physical = () => ({
  uniforms: {},
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
});
const compiled = (settings, type = 'resin', diceType = 'd20') =>
  patchResinShader(physical(), resinGlsl(lookOf(type, settings), diceType));

function boardDie(material, settings) {
  const look = new THREE.MeshPhysicalMaterial();
  look.userData.uniforms = {};
  for (const [name, value] of material._uniforms)
    look.userData.uniforms[name] = { value: value?.clone?.() ?? value };
  for (const cb of material._process) cb('d20', look, { materialSettings: settings });
  const dice = new THREE.Mesh(new THREE.BufferGeometry(), look);
  let own = null;
  dice.die = {
    isolateMaterial() {
      if (!own) {
        own = new THREE.MeshPhysicalMaterial();
        own.userData = { ...look.userData, uniforms: {} };
        for (const [n, u] of Object.entries(look.userData.uniforms))
          own.userData.uniforms[n] = { value: u.value?.clone?.() ?? u.value };
        dice.material = own;
      }
      return own;
    },
  };
  return { dice, look };
}

describe('v2 resin, insides and jelly (DsN 5.1, 5.4)', () => {
  it('registers clear resin and jelly: opaque for the renderer, never animated as a whole', () => {
    const dice3d = { addMaterial: vi.fn(() => Promise.resolve()) };
    expect(registerResin(dice3d, DiceMaterial)).toEqual(['dicer.body-resin', 'dicer.body-jelly']);
    const [resin, jelly] = dice3d.addMaterial.mock.calls.map(([m]) => m);
    for (const m of [resin, jelly]) {
      expect(m.base.type).toBe('physical');
      expect(m.translucent).toBe(false);
      expect(m.animated).toBe(false);
      expect(m.fallback).toBe('resin');
    }
    expect(resin.impactSounds).toBe('dicer.dice-plastic');
    expect(jelly.impactSounds).toBe('dicer.dice-squishy');
    expect(resin.weight).toBe(2);
    expect(resin.settings.map((s) => s.id)).toEqual([
      'inside',
      'insideColor',
      'insideColor2',
      'density',
      'shape',
      'inclusion',
      'bubble',
      'sand',
      'motion',
      'extra',
      'extraColor',
      'extraDensity',
      'roughness',
    ]);
    expect(Object.keys(resin.settings[0].options)).toEqual([...INSIDE_TYPES]);
    expect(jelly.settings.map((s) => s.id)).toEqual(['glow', 'color2', 'roughness']);
  });

  it('declares every uniform any inside reads, so DsN creates them with the material', () => {
    const resin = createResinMaterial(DiceMaterial, 'resin');
    const names = new Set(resin._uniforms.keys());
    for (const inside of INSIDE_TYPES)
      for (const shape of inside === 'shape' ? INSIDE_SHAPES : ['star'])
        for (const extra of ['none', 'foil', 'bubbles'])
          for (const name of Object.keys(
            resinGlsl(lookOf('resin', { inside, shape, extra, bubble: true })).uniforms,
          ))
            expect(names.has(name), `${inside}/${shape}/${extra}: ${name}`).toBe(true);
    for (const name of [
      'uInteriorTime',
      'uInteriorSpin',
      'uInteriorLag',
      'uInteriorFlare',
      'uInteriorSwirl',
      'uResinRadii',
    ])
      expect(names.has(name)).toBe(true);
    expect(Object.keys(insideUniforms()).length).toBe(names.size - 4);
  });

  it('splices v1`s refraction and every inside`s march into three`s physical shader', () => {
    for (const inside of INSIDE_TYPES)
      for (const shape of inside === 'shape' ? INSIDE_SHAPES : ['star']) {
        const { vertexShader: v, fragmentShader: f } = compiled({ inside, shape });
        expect(v).toContain('vLocalCam = ( inverse( modelMatrix )');
        expect(f).toContain('#define DICER_RESIN');
        expect(f).toContain('float dcChord(');
        expect(f).toContain('vec3 dcRefracted = vec3( 0.0 );');
        expect(f).toContain('mix( dcTexel.rgb, uResinTint.rgb, uResinTint.a )');
        if (inside !== 'none') expect(f).not.toContain('// dicer:interior');
        expect(f.includes('vec4 dcInterior(') || f.includes('dcInterior( vec3 p')).toBe(
          inside !== 'none',
        );
        expect(f.includes('#define DICER_STEPS 32')).toBe(inside !== 'none');
        expect(f.indexOf('float dcMask = 0.0;')).toBeLessThan(f.indexOf('vec3 dcRefracted'));
        expect(f.indexOf('float dcMask = 0.0;')).toBeGreaterThan(0);
      }
  });

  it('keeps v1`s refraction GLSL as it is, but for the body colour', () => {
    expect(RESIN_REFRACTION).toContain('mix( diffuse, uResinTint.rgb, uResinTint.a )');
    const f = compiled({ inside: 'none' }).fragmentShader;
    const [head, tail] = RESIN_REFRACTION.split('mix( diffuse, uResinTint.rgb, uResinTint.a )');
    expect(f).toContain(head.split('#ifdef DICER_RESIN')[1].trim().slice(0, 400));
    expect(f).toContain(tail.trim().slice(0, 200));
  });

  it('jelly: the same refraction, denser, rougher, with its rim glow and no inside', () => {
    const g = resinGlsl(lookOf('jelly', {}));
    expect(g.uniforms.uResinDensity.value).toBe(1.8);
    expect(g.live).toBe(false);
    const f = patchResinShader(physical(), g).fragmentShader;
    expect(f).toContain('#define DICER_JELLY');
    expect(f).toContain('totalDiffuse += ( 1.0 - dcMask ) * dcJellyHue( dcTexel.rgb )');
    expect(f).toContain('material.sheenColor = dcJellyHue( dcTexel.rgb );');
    expect(f.indexOf('material.sheenColor = dcJellyHue')).toBeGreaterThan(
      f.indexOf('#include <lights_physical_fragment>'),
    );
    expect(f).toContain('roughnessFactor = max( roughnessFactor, 0.18 );');
    expect(f).not.toContain('DICER_STEPS');
  });

  it('jelly glows in its own hue, or in a second colour when the look asks for one', () => {
    const own = resinGlsl(lookOf('jelly', { color2: '#ff00c8' })).uniforms;
    expect(own.uDcJellyOwn.value).toBe(1);
    const two = resinGlsl(lookOf('jelly', { glow: true, color2: '#ff00c8' })).uniforms;
    expect(two.uDcJellyOwn.value).toBe(0);
    expect(two.uBodyColor2.value.getHexString()).toBe('ff00c8');
    const f = patchResinShader(physical(), resinGlsl(lookOf('jelly', {}))).fragmentShader;
    expect(f).toContain('uniform float uDcJellyOwn;');
    expect(f).toContain(
      'mix( uBodyColor2, c / max( max( c.r, c.g ), max( c.b, 1e-3 ) ), uDcJellyOwn )',
    );
    expect(
      materialSettingsOf(BUILTIN_THEMES.find((t) => t.id === 'jelly-belly').appearance),
    ).toEqual({
      roughness: 0,
      glow: true,
      color2: '#ff00c8',
    });
  });

  it('lifts what is seen through the body for DsN`s tone mapping, not the reflections', () => {
    expect(resinGlsl(lookOf('resin', {})).uniforms.uDcResinGain.value).toBe(RESIN_GAIN.resin);
    expect(resinGlsl(lookOf('jelly', {})).uniforms.uDcResinGain.value).toBe(RESIN_GAIN.jelly);
    const f = compiled({ inside: 'nebula' }).fragmentShader;
    expect(f).toContain('uniform float uDcResinGain;');
    expect(f).toContain('dcRefracted *= ( 1.0 - dcRFin ) * uDcResinGain;');
    expect(f.indexOf('dcRefracted = dcRefracted * ( 1.0 - dcIacc.a ) + dcIacc.rgb;')).toBeLessThan(
      f.indexOf('* uDcResinGain;'),
    );
  });

  it('follows the size of the die drawn, on the look and on a die`s own copy', () => {
    const resin = createResinMaterial(DiceMaterial, 'resin');
    const { dice, look } = boardDie(resin, { inside: 'storm' });
    dice.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0.04, 0, 0, 0, 0.01, 0, 0, 0, 0.02], 3),
    );
    look.onBeforeRender(null, null, null, dice.geometry);
    expect(look.userData.uniforms.uDcLocalScale.value).toBeCloseTo(25, 4);
    expect(compiled({}).vertexShader).toContain('.xyz * uDcLocalScale;');
    const other = boardDie(resin, { inside: 'storm' });
    other.dice.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0.02, 0, 0, 0, 0.01, 0, 0, 0, 0.01], 3),
    );
    onDiceFrame({ dice: other.dice, delta: 0 }, 0);
    expect(other.dice.material.userData.uniforms.uDcLocalScale.value).toBeCloseTo(50, 4);
  });

  it('a coin gets the flat body', () => {
    const g = resinGlsl(lookOf('resin', {}), 'd2');
    expect(g.uniforms.uResinRadii.value.toArray()).toEqual([0.95, 0.125, 0.95]);
    expect(g.uniforms.uResinDensity.value).toBe(4);
  });

  it('puts a look`s inside on its material, and only a moving look asks DsN for frames', () => {
    const resin = createResinMaterial(DiceMaterial, 'resin');
    const fire = boardDie(resin, { inside: 'fire', insideColor: '#ff0000', density: 80 }).look;
    expect(fire.userData.uniforms.uInteriorColors.value[0].getHexString()).toBe('ff0000');
    expect(fire.userData.uniforms.uInteriorDensity.value).toBeCloseTo(0.8);
    expect(fire.userData.animated).toBe(true);
    for (const settings of [
      { inside: 'none' },
      { inside: 'fire', motion: false },
      { inside: 'shape', shape: 'star' },
    ]) {
      const still = boardDie(resin, settings).look;
      expect(still.userData.animated).toBeUndefined();
      expect(still.userData.dicerLive).toBe(false);
    }
    const mat = new THREE.MeshPhysicalMaterial();
    applyResinSettings('resin', mat, 'd20', { roughness: 40 });
    expect(mat.roughness).toBeCloseTo(0.4);
  });

  it('steps each die`s inside on its own material, and lets it rest 10 s after its result', () => {
    const resin = createResinMaterial(DiceMaterial, 'resin');
    const { dice, look } = boardDie(resin, { inside: 'storm' });
    const other = boardDie(resin, { inside: 'storm' });
    dice.quaternion.set(0, 0, 0, 1);
    onDiceFrame({ dice, delta: 0 }, 0);
    dice.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
    dice.updateMatrixWorld(true);
    onDiceFrame({ dice, delta: 0.05 }, 50);
    const u = dice.material.userData.uniforms;
    expect(dice.material).not.toBe(look);
    expect(u.uInteriorTime.value).toBeCloseTo(0.05);
    expect(u.uInteriorSpin.value.length()).toBeGreaterThan(0);
    expect(look.userData.uniforms.uInteriorTime.value).toBe(0);
    expect(other.dice.material.userData.uniforms.uInteriorTime.value).toBe(0);
    onDiceResult({ dice }, 1000);
    onDiceFrame({ dice, delta: 0.016 }, 6000);
    expect(dice.material.userData.animated).toBe(true);
    const t = u.uInteriorTime.value;
    onDiceFrame({ dice, delta: 0.016 }, 11500);
    expect(u.uInteriorTime.value).toBe(t);
    expect(dice.material.userData.animated).toBe(false);
    onDiceCollide({ dice }, 20000);
    expect(dice.material.userData.animated).toBe(true);
    onDiceFrame({ dice, delta: 0.016 }, 20016);
    expect(u.uInteriorTime.value).toBeGreaterThan(t);
  });

  it('leaves the dice of other materials alone, and returns nothing to Hooks.call', () => {
    const dice = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial());
    dice.die = { isolateMaterial: vi.fn() };
    expect(onDiceFrame({ dice, delta: 0.016 })).toBeUndefined();
    expect(dice.die.isolateMaterial).not.toHaveBeenCalled();
    const hooks = { on: vi.fn() };
    registerInsideMotion(hooks);
    expect(hooks.on.mock.calls.map(([n]) => n)).toEqual([
      'diceSoNiceDiceFrame',
      'diceSoNiceDiceResult',
      'diceSoNiceDiceCollide',
    ]);
    for (const [, fn] of hooks.on.mock.calls) expect(fn({ dice, delta: 0 })).toBeUndefined();
  });
});
