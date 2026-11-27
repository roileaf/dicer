import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ELEMENTS } from '../../src/effects/elements.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';
import {
  damageTypeOf,
  defaultLines,
  effectClass,
  effectName,
  EFFECTS,
  fxUniforms,
  registerEffects,
  sfxId,
  SPARKS_ID,
  sparksClass,
  SPARK_STRENGTH,
  TRAIL_ID,
  trailClass,
  v1Die,
} from '../../src/v2/effects/classes.js';
import { scalePoolSizes, stageOf, stageScale, V1_D6_EDGE } from '../../src/v2/effects/stage.js';
import { TIERS } from '../../src/render/quality.js';
import { DiceSFX } from '../helpers/dsn-api.js';

const EDGE = 0.04;

function board() {
  const scene = new THREE.Scene();
  return {
    scene,
    camera: new THREE.PerspectiveCamera(),
    dicefactory: { baseScale: EDGE },
    renderer: { domElement: {} },
  };
}

function dieMesh(
  box,
  { role = 'basic', result = 20, at = [0.2, 0.03, -0.1], radius = 0.035 } = {},
) {
  const parent = new THREE.Group();
  parent.position.set(...at);
  box.scene.add(parent);
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([radius, 0, 0, 0, radius / 2, 0, 0, 0, radius / 3], 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial());
  parent.add(mesh);
  box.scene.updateMatrixWorld(true);
  mesh.die = { type: 'd20', result, role, isolateMaterial: vi.fn(() => mesh.material) };
  return mesh;
}

afterEach(() => vi.restoreAllMocks());

describe('v2 effect stage: v1 effects (one die edge = 1) in DsN`s scene (metres)', () => {
  it('scales a group in the dice scene by DsN`s d6 edge over v1`s', () => {
    const box = board();
    const stage = stageOf(box);
    expect(stageScale(box)).toBeCloseTo(EDGE / V1_D6_EDGE, 12);
    expect(stage.group.parent).toBe(box.scene);
    expect(stage.group.scale.x).toBeCloseTo(EDGE / V1_D6_EDGE, 12);
    expect(stageOf(box)).toBe(stage);
    const p = stage.toStage(new THREE.Vector3(EDGE, 0, 0));
    expect(p.x).toBeCloseTo(V1_D6_EDGE, 9);
  });

  it('follows a new dice size and a rebuilt scene', () => {
    const box = board();
    const stage = stageOf(box);
    box.dicefactory.baseScale = EDGE * 2;
    box.scene = new THREE.Scene();
    stageOf(box);
    expect(stage.group.parent).toBe(box.scene);
    expect(stage.scale).toBeCloseTo((EDGE * 2) / V1_D6_EDGE, 12);
  });

  it('draws particles at the stage`s scale: their size is not part of the model matrix', () => {
    const box = board();
    const stage = stageOf(box);
    const pool = stage.particles;
    expect(pool.layers.length).toBe(2);
    for (const { material, mesh } of pool.layers) {
      expect(mesh.parent).toBe(stage.group);
      expect(material.vertexShader).toContain('uniform float uDcStage;');
      expect(material.vertexShader).toContain('uDcStage * aSize * mix(');
      expect(material.uniforms.uDcStage.value).toBeCloseTo(stage.scale, 12);
    }
    expect(() =>
      scalePoolSizes(
        { layers: [{ material: { vertexShader: 'void main() {}', uniforms: {} } }] },
        { value: 1 },
      ),
    ).toThrow(/size line/);
  });

  it('ticks the particle clock once per frame however many effects run', () => {
    const stage = stageOf(board());
    const update = vi.spyOn(stage.particles, 'update');
    stage.tick(1000);
    stage.tick(1000);
    stage.tick(1016);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('v2 effects as DsN effect classes (DsN 5.6)', () => {
  it('shows a DsN die to a v1 effect: its place and size in stage units, its role as a damage type', () => {
    const box = board();
    const stage = stageOf(box);
    const mesh = dieMesh(box, { role: 'ice' });
    const die = v1Die(mesh, stage);
    expect(die.outer.position.x).toBeCloseTo(0.2 / stage.scale, 9);
    expect(die.inner.geometry.boundingSphere.radius).toBeCloseTo(0.035 / stage.scale, 5);
    expect(die.inner.getWorldScale(new THREE.Vector3()).toArray()).toEqual([1, 1, 1]);
    expect([die.type, die.value, die.damageType]).toEqual(['d20', 20, 'cold']);
    die.outer.visible = false;
    expect(mesh.visible).toBe(false);
    mesh.parent.position.x = 0.4;
    box.scene.updateMatrixWorld(true);
    die.sync();
    expect(die.outer.position.x).toBeCloseTo(0.4 / stage.scale, 9);
    expect(v1Die(mesh, stage, { real: true }).inner).toBe(mesh);
    expect(damageTypeOf(dieMesh(box))).toBeNull();
  });

  it('runs a v1 effect module from play to its end, then stops it once', async () => {
    const box = board();
    const mesh = dieMesh(box);
    let ctx = null;
    const handle = { update: vi.fn((now) => now < 2000), stop: vi.fn() };
    const mod = {
      id: 'test-fx',
      defaults: { color: '#ff0000', intensity: 2, duration: 500 },
      start: vi.fn((c) => ((ctx = c), handle)),
    };
    const Cls = effectClass(DiceSFX, mod, 'Test');
    expect([Cls.id, Cls.specialEffectName, Cls.group]).toEqual(['Dicer.test-fx', 'Test', 'Dicer']);
    const sfx = new Cls(box, mesh);
    expect(await sfx.play()).toBe(true);
    expect(ctx.scene).toBe(stageOf(box).group);
    expect(ctx.camera).toBe(box.camera);
    expect(ctx.position.x).toBeCloseTo(0.2 / stageOf(box).scale, 9);
    expect([ctx.color.getHexString(), ctx.intensity, ctx.duration, ctx.tier]).toEqual([
      'ff0000',
      2,
      500,
      TIERS.high,
    ]);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    sfx.render();
    expect(sfx.destroyed).toBe(false);
    now.mockReturnValue(2500);
    sfx.render();
    expect(sfx.destroyed).toBe(true);
    sfx.destroy();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it('shows nothing, and tells DsN so, when a v1 effect cannot start', async () => {
    const box = board();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const starts = [
      () => null,
      () => ({}),
      () => {
        throw new Error('no');
      },
    ];
    for (const start of starts) {
      const sfx = new (effectClass(DiceSFX, { id: 'x', start }, 'X'))(box, dieMesh(box));
      expect(await sfx.play()).toBe(false);
      expect(sfx.destroyed).toBe(true);
    }
  });

  it('gives a die effect the die`s own uniforms only on a Dicer material', () => {
    const box = board();
    const mesh = dieMesh(box);
    expect(fxUniforms(mesh)).toBeNull();
    expect(mesh.die.isolateMaterial).not.toHaveBeenCalled();
    mesh.material.userData.uniforms = { uFxTint: { value: new THREE.Vector4() } };
    expect(fxUniforms(mesh)).toBe(mesh.material.userData.uniforms);
  });

  it('starts every v1 effect of the library on a DsN die without throwing', async () => {
    const box = board();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const mod of Object.values(EFFECTS)) {
      const mesh = dieMesh(box, { role: 'fire' });
      mesh.material.userData.uniforms = {
        uFxTint: { value: new THREE.Vector4() },
        uFxFlare: { value: new THREE.Vector3() },
      };
      const sfx = new (effectClass(DiceSFX, mod, mod.id))(box, mesh);
      await sfx.play();
      if (!sfx.destroyed) {
        sfx.render();
        sfx.destroy();
      }
      expect(sfx.destroyed, mod.id).toBe(true);
    }
    expect(warn.mock.calls.map((c) => c[0])).toEqual([]);
  });

  it('trails only dice with a damage role, until they rest', async () => {
    const box = board();
    const Trail = trailClass(DiceSFX, 'Trail');
    expect(Trail.id).toBe(TRAIL_ID);
    expect(await new Trail(box, dieMesh(box)).play()).toBe(false);
    const mesh = dieMesh(box, { role: 'fire' });
    const trail = new Trail(box, mesh);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    expect(await trail.play()).toBe(true);
    const flight = vi.spyOn(stageOf(box).trailFx, 'flight');
    for (let t = 16; t <= 320; t += 16) {
      now.mockReturnValue(t);
      mesh.parent.position.x += 0.01;
      box.scene.updateMatrixWorld(true);
      trail.render();
    }
    expect(trail.destroyed).toBe(false);
    expect(flight).toHaveBeenCalledTimes(20);
    expect(flight.mock.calls[0][0][0].damageType).toBe('fire');
    now.mockReturnValue(320 + 700);
    trail.render();
    expect(trail.destroyed).toBe(true);
  });

  it('sparks where a die hits the table hard, by the strength of DsN`s hit', async () => {
    const box = board();
    const stage = stageOf(box);
    const Sparks = sparksClass(DiceSFX, 'Sparks');
    expect([Sparks.id, Sparks.group]).toEqual([SPARKS_ID, 'Dicer']);
    const impact = vi.spyOn(stage.impactFx, 'impact');
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const at = (kind, strength) => ({ kind, position: new THREE.Vector3(EDGE, 0, 0), strength });
    const play = async (hit) => {
      const sfx = new Sparks(box, dieMesh(box));
      sfx.hit = hit;
      return [await sfx.play(), sfx];
    };
    expect((await play(null))[0]).toBe(false);
    expect((await play(at('dice', 1)))[0]).toBe(false);
    expect((await play(at('table', SPARK_STRENGTH - 0.05)))[0]).toBe(false);
    expect((await play(at('table', undefined)))[0]).toBe(false);
    expect(impact).not.toHaveBeenCalled();
    const [played, sfx] = await play(at('table', 1));
    expect(played).toBe(true);
    const hit = impact.mock.calls[0][0];
    expect(hit.speed).toBeCloseTo(stage.impactFx.minSpeed / SPARK_STRENGTH, 6);
    expect(hit.position.x).toBeCloseTo(V1_D6_EDGE, 9);
    expect((await play(at('table', SPARK_STRENGTH)))[0]).toBe(true);
    expect(impact.mock.calls[1][0].speed).toBeCloseTo(stage.impactFx.minSpeed, 6);
    now.mockReturnValue(500);
    sfx.render();
    expect(sfx.destroyed).toBe(true);
  });

  it('registers every v1 effect, the trail and the sparks, and default lines for players who never saved theirs', () => {
    const dice3d = { addSFXMode: vi.fn(), addSFXDefaults: vi.fn() };
    const ids = registerEffects(dice3d, DiceSFX);
    expect(ids).toEqual([...Object.keys(EFFECTS).map(sfxId), TRAIL_ID, SPARKS_ID]);
    expect(Object.keys(EFFECTS).sort()).toEqual([...EFFECT_IDS].sort());
    expect(dice3d.addSFXMode).toHaveBeenCalledTimes(ids.length);
    for (const [cls] of dice3d.addSFXMode.mock.calls) expect(cls.prototype).toBeInstanceOf(DiceSFX);
    const [lines] = dice3d.addSFXDefaults.mock.calls[0];
    expect(lines).toEqual(defaultLines());
    for (const line of lines) {
      expect(ids).toContain(line.specialEffect);
      expect(line.options?.isGlobal).toBeUndefined();
    }
    expect(lines).toContainEqual({
      diceType: 'd20',
      onResult: ['20'],
      specialEffect: 'Dicer.celebrate',
    });
    expect(lines).toContainEqual({
      diceType: '*',
      role: 'fire',
      onResult: ['*'],
      moment: 'throw',
      specialEffect: TRAIL_ID,
    });
    expect(lines).toContainEqual({
      diceType: 'd20',
      role: 'cold',
      onResult: ['20'],
      specialEffect: 'Dicer.burst-frost',
    });
    expect(lines.filter((l) => l.moment === 'collide')).toEqual([
      { diceType: '*', onResult: ['*'], moment: 'collide', specialEffect: SPARKS_ID },
    ]);
    for (const l of lines.filter((x) => x.specialEffect.startsWith('Dicer.burst-')))
      expect(ELEMENTS).toContain(l.specialEffect.slice('Dicer.burst-'.length));
  });

  it('names an effect from its translation, else from its id', () => {
    expect(effectName('glow-pulse', (k) => k)).toBe('Glow Pulse');
    expect(effectName('trail', () => 'Elemental trail')).toBe('Elemental trail');
  });
});
