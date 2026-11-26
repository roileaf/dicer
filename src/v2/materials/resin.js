import { Color, Matrix3, Quaternion, Vector3, Vector4 } from 'three';
import { soundMaterialOf } from '../../audio/sound-material.js';
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../../look/appearance.js';
import { jellyPatch } from '../../render/extras/bodies/jelly.js';
import { EXTRA_KINDS } from '../../render/extras/insides/extra.js';
import { insidePatch } from '../../render/extras/insides/index.js';
import { insideMotion, prefersReduced } from '../../render/extras/insides/live.js';
import { restFactor } from '../../render/extras/insides/motion.js';
import {
  INTERIOR_HOOK,
  RESIN,
  RESIN_PARS,
  RESIN_REFRACTION,
  RESIN_UNIFORMS,
  FX_EMISSIVE,
  FX_PARS,
} from '../../render/shaders/bodies.js';
import { interiorChunk, SHAPE_ROT } from '../../render/shaders/interior.js';
import { tierConfig } from '../quality/state.js';
import { diceSoundSetId } from '../sounds/register.js';
import {
  addFxUniforms,
  after,
  bodyMaterialId,
  FRAGMENT_PARS,
  L,
  LABEL_MASK,
  LOCAL_SCALE,
  localScaleOf,
  trackLocalScale,
  VERTEX,
  VERTEX_PARS,
} from './bodies.js';

export const INSIDE_TYPES = Object.freeze([
  'none',
  'liquid',
  'glitter',
  'swirl',
  'nebula',
  'shape',
  'foil',
  'eye',
  'botanical',
  'smoke',
  'fire',
  'lava',
  'storm',
  'frost',
]);
export const INSIDE_SHAPES = Object.freeze([
  'star',
  'heart',
  'skull',
  'sphere',
  'sword',
  'axe',
  'shield',
  'dragon',
  'runes',
]);
const INCLUSIONS = ['flower', 'moss', 'butterfly'];
const EXTRAS = ['none', ...EXTRA_KINDS];

export const flags = () => ({
  interiors: true,
  interiorSteps: tierConfig().interiorSteps,
  insideMotion: true,
});

const KEY_LIGHT_DIR = [-6, 4, 2].map((v) => v / Math.hypot(-6, 4, 2));

const D = DEFAULT_APPEARANCE.interior;
export const RESIN_DEFAULTS = Object.freeze({
  inside: D.type,
  shape: D.shape,
  inclusion: D.inclusion,
  insideColor: D.colors[0],
  insideColor2: D.colors[1],
  density: Math.round(D.density * 100),
  bubble: D.bubble,
  sand: D.sand,
  motion: D.motion,
  extra: D.extra,
  extraColor: D.extraColor,
  extraDensity: Math.round(D.extraDensity * 100),
  roughness: 5,
});
export const JELLY_DEFAULTS = Object.freeze({ roughness: 20 });

const pct = (v, d) => (Number.isFinite(v) ? v : d) / 100;

export function lookOf(type, settings = {}) {
  if (type === 'jelly') {
    const s = { ...JELLY_DEFAULTS, ...settings };
    return normalizeAppearance({
      body: { type, roughness: pct(s.roughness, 20) },
    });
  }
  const s = { ...RESIN_DEFAULTS, ...settings };
  return normalizeAppearance({
    body: { type: 'resin', roughness: pct(s.roughness, 5) },
    interior: {
      type: s.inside,
      shape: s.shape,
      inclusion: s.inclusion,
      colors: [s.insideColor, s.insideColor2],
      density: pct(s.density, 60),
      bubble: !!s.bubble,
      sand: !!s.sand,
      motion: s.motion !== false,
      extra: s.extra,
      extraColor: s.extraColor,
      extraDensity: pct(s.extraDensity, 50),
    },
  });
}

const VERTEX_CAM_PARS = /* glsl */ `
varying vec3 vLocalCam;
`;
const VERTEX_CAM = /* glsl */ `
	vLocalCam = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz * uDcLocalScale;
`;

export const RESIN_GAIN = Object.freeze({ resin: 2.5, jelly: 2 });

function bodyFromTexel(lighting) {
  const from = 'mix( diffuse, uResinTint.rgb, uResinTint.a )';
  const out = 'dcRefracted *= 1.0 - dcRFin;';
  if (!lighting.includes(from) || !lighting.includes(out))
    throw new Error('dicer: the resin refraction lines moved');
  return lighting
    .replace(from, 'mix( dcTexel.rgb, uResinTint.rgb, uResinTint.a )')
    .replace(out, 'dcRefracted *= ( 1.0 - dcRFin ) * uDcResinGain;');
}

const JELLY_HUE = /* glsl */ `
vec3 dcJellyHue( vec3 c ) { return c / max( max( c.r, c.g ), max( c.b, 1e-3 ) ); }
`;
const JELLY_SHEEN = /* glsl */ `
#ifdef USE_SHEEN
	material.sheenColor = dcJellyHue( dcTexel.rgb );
#endif
`;
function ownColour(lighting) {
  if (!lighting.includes('uBodyColor2')) throw new Error('dicer: the jelly glow line moved');
  return lighting.replaceAll('uBodyColor2', 'dcJellyHue( dcTexel.rgb )');
}

export function resinGlsl(a, diceType = 'd20') {
  const coin = diceType === 'd2';
  const jelly = a.body.type === 'jelly';
  const defines = ['#define DICER_RESIN'];
  const uniforms = {
    uResinDensity: { value: coin ? RESIN.coinDensity : 1 },
    uResinFloor: { value: RESIN.floor },
    uResinRadii: {
      value: coin
        ? new Vector3(0.95, 0.125, 0.95)
        : new Vector3(RESIN.radius, RESIN.radius, RESIN.radius),
    },
    uResinTint: { value: new Vector4(0, 0, 0, 0) },
    uDcResinGain: { value: jelly ? RESIN_GAIN.jelly : RESIN_GAIN.resin },
  };
  if (jelly) {
    const p = jellyPatch(a);
    defines.push('#define DICER_JELLY');
    Object.assign(uniforms, p.uniforms);
    return {
      defines,
      pars: JELLY_HUE,
      roughness: p.chunks.roughness,
      lighting: ownColour(bodyFromTexel(p.chunks.lighting)),
      coat: JELLY_SHEEN,
      uniforms,
      live: false,
    };
  }
  let pars = '';
  let lighting = RESIN_REFRACTION;
  let live = false;
  if (a.interior.type !== 'none') {
    const p = insidePatch(a, flags());
    const interior = p.interior ?? interiorChunk(a.interior.type, a.interior.shape);
    defines.push(
      '#define DICER_INTERIOR',
      `#define DICER_STEPS ${flags().interiorSteps}`,
      ...Object.keys(p.defines ?? {}).map((d) => `#define ${d}`),
    );
    pars = interior.pars;
    lighting = lighting.replace(INTERIOR_HOOK, interior.main);
    Object.assign(uniforms, {
      uInteriorColors: {
        value: [new Color(a.interior.colors[0]), new Color(a.interior.colors[1])],
      },
      uInteriorDensity: { value: a.interior.density },
      uKeyLightDir: { value: new Vector3(...KEY_LIGHT_DIR) },
      uShapeRot: { value: new Matrix3().fromArray(coin ? SHAPE_ROT.coin : SHAPE_ROT.die) },
      ...p.uniforms,
    });
    live = insideMotion.wants(a, flags());
  }
  return { defines, pars, roughness: '', lighting: bodyFromTexel(lighting), uniforms, live };
}

export function patchResinShader(shader, glsl) {
  shader.vertexShader = after(
    after(shader.vertexShader, 'common', VERTEX_PARS + VERTEX_CAM_PARS),
    'begin_vertex',
    VERTEX + VERTEX_CAM,
  );
  let f = shader.fragmentShader;
  f = after(
    f,
    'common',
    [
      glsl.defines.join('\n'),
      FRAGMENT_PARS,
      '#define dcRim 0.0',
      FX_PARS,
      'uniform float uDcResinGain;',
      RESIN_UNIFORMS,
      RESIN_PARS,
      glsl.pars,
    ].join('\n'),
  );
  f = after(f, 'color_fragment', LABEL_MASK);
  f = after(f, 'emissivemap_fragment', FX_EMISSIVE);
  if (glsl.roughness) f = after(f, 'roughnessmap_fragment', glsl.roughness);
  if (glsl.coat) f = after(f, 'lights_physical_fragment', glsl.coat);
  f = after(f, 'transmission_fragment', glsl.lighting);
  shader.fragmentShader = f;
  return shader;
}

const select = (id, name, list, key, defaultValue) => ({
  id,
  name: L(name),
  defaultValue,
  options: Object.fromEntries(list.map((v) => [v, L(`${key}.${v}`)])),
});

export function insideUniforms() {
  const all = {};
  const add = (settings) => Object.assign(all, resinGlsl(lookOf('resin', settings)).uniforms);
  for (const inside of INSIDE_TYPES) add({ inside, extra: 'glitter' });
  for (const shape of INSIDE_SHAPES) add({ inside: 'shape', shape });
  add({ inside: 'liquid', bubble: true, sand: true });
  return all;
}

export function applyResinSettings(type, mat, diceType, settings) {
  const a = lookOf(type, settings);
  const { uniforms, live } = resinGlsl(a, diceType);
  trackLocalScale(mat);
  const u = (mat.userData.uniforms ??= {});
  for (const [name, { value }] of Object.entries(uniforms)) u[name] = { value };
  mat.roughness = a.body.roughness;
  mat.userData.dicerLive = live;
  if (live) mat.userData.animated = true;
}

export function createResinMaterial(DiceMaterial, type) {
  const jelly = type === 'jelly';
  const base = jelly
    ? { ...jellyPatch({ body: { type, color2: '#ffffff' } }).params, roughness: 0.2 }
    : { ior: RESIN.ior, roughness: 0.05, clearcoat: 1, clearcoatRoughness: RESIN.coatRoughness };
  const material = new DiceMaterial(bodyMaterialId(type), `DICER.V2.Material.${type}`)
    .setBase('physical', base)
    .setFallback('resin')
    .setImpactSounds(diceSoundSetId(soundMaterialOf({ body: { type } })))
    .setWeight(jelly ? 1 : 2);

  const defaults = jelly ? resinGlsl(lookOf('jelly')).uniforms : insideUniforms();
  for (const [name, { value }] of Object.entries(defaults)) material.addUniform(name, value);
  material.addUniform('uBodyColor2', new Color('#000000'));
  material.addUniform('uDcLocalScale', LOCAL_SCALE);
  addFxUniforms(material);
  if (!jelly) {
    const d = RESIN_DEFAULTS;
    material.addSettingSelect(
      select('inside', 'Inside.Type', INSIDE_TYPES, 'InsideType', d.inside),
    );
    material.addSettingColor({
      id: 'insideColor',
      name: L('Inside.MainColor'),
      defaultValue: d.insideColor,
    });
    material.addSettingColor({
      id: 'insideColor2',
      name: L('Inside.SecondColor'),
      defaultValue: d.insideColor2,
    });
    material.addSettingRange({
      id: 'density',
      name: L('Inside.Density'),
      defaultValue: d.density,
      min: 0,
      max: 100,
      step: 5,
    });
    material.addSettingSelect(select('shape', 'Inside.Shape', INSIDE_SHAPES, 'Shape', d.shape));
    material.addSettingSelect(
      select('inclusion', 'Inside.Inclusion', INCLUSIONS, 'Inclusion', d.inclusion),
    );
    material.addSettingBoolean({ id: 'bubble', name: L('Inside.Bubble'), defaultValue: d.bubble });
    material.addSettingBoolean({ id: 'sand', name: L('Inside.Sand'), defaultValue: d.sand });
    material.addSettingBoolean({ id: 'motion', name: L('Inside.Motion'), defaultValue: d.motion });
    material.addSettingSelect(select('extra', 'Inside.Extra', EXTRAS, 'Extra', d.extra));
    material.addSettingColor({
      id: 'extraColor',
      name: L('Inside.ExtraColor'),
      defaultValue: d.extraColor,
    });
    material.addSettingRange({
      id: 'extraDensity',
      name: L('Inside.ExtraDensity'),
      defaultValue: d.extraDensity,
      min: 0,
      max: 100,
      step: 5,
    });
  }
  const roughness = (jelly ? JELLY_DEFAULTS : RESIN_DEFAULTS).roughness;
  material.addSettingRange({
    id: 'roughness',
    name: L('Body.Roughness'),
    defaultValue: roughness,
    min: 0,
    max: 100,
    step: 5,
  });

  material.registerProcessMaterialCallback((diceType, mat, appearance) =>
    applyResinSettings(type, mat, diceType, appearance?.materialSettings ?? {}),
  );
  material.registerBeforeShaderCompileCallback((shader, mat, diceType) => {
    patchResinShader(
      shader,
      resinGlsl(lookOf(type, mat.userData.appearance?.materialSettings ?? {}), diceType),
    );
  });
  return material;
}

export const RESIN_TYPES = Object.freeze(['resin', 'jelly']);

export function registerResin(dice3d, DiceMaterial) {
  const ids = [];
  for (const type of RESIN_TYPES) {
    const material = createResinMaterial(DiceMaterial, type);
    Promise.resolve(dice3d.addMaterial(material)).catch((err) =>
      console.error(`dicer: cannot add the ${type} material`, err),
    );
    ids.push(material.id);
  }
  return ids;
}

const landed = new WeakMap();
const quat = new Quaternion();
const stepOpts = { reduced: false, factor: 1, flare: 0 };

export function onDiceFrame({ dice, delta }, now = performance.now()) {
  if (!dice?.material?.userData?.dicerLive) return;
  const own = dice.die?.isolateMaterial();
  const u = own?.userData.uniforms;
  if (!u?.uInteriorTime) return;
  const at = landed.get(dice);
  stepOpts.reduced = prefersReduced();
  stepOpts.factor = restFactor(at == null ? null : now - at);
  stepOpts.flare = u.uInteriorFlare?.value ?? 0;
  if (u.uDcLocalScale) u.uDcLocalScale.value = localScaleOf(dice.geometry);
  insideMotion.step(dice, u, dice.getWorldQuaternion(quat), delta, stepOpts);
  own.userData.animated = stepOpts.factor > 0;
}

export function onDiceResult({ dice }, now = performance.now()) {
  if (dice?.material?.userData?.dicerLive) landed.set(dice, now);
}

export function onDiceCollide({ dice }, now = performance.now()) {
  const data = dice?.material?.userData;
  if (!data?.dicerLive || !landed.has(dice)) return;
  landed.set(dice, now);
  data.animated = true;
}

export function registerInsideMotion(hooks = globalThis.Hooks) {
  hooks.on('diceSoNiceDiceFrame', (e) => void onDiceFrame(e));
  hooks.on('diceSoNiceDiceResult', (e) => void onDiceResult(e));
  hooks.on('diceSoNiceDiceCollide', (e) => void onDiceCollide(e));
}
