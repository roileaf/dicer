// Dicer v2, step 3: Dicer's body types as Dice So Nice materials (DsN note 5.1).
//
// DsN draws the faces (dice colour, labels, outline, texture) into the material's map; a
// material only defines the surface under them. Each Dicer body becomes a DiceMaterial whose
// three.js base is v1's MeshPhysical preset and whose shader callback splices in v1's own body
// GLSL (src/render/extras/bodies/*, src/render/shaders/bodies.js), unchanged, behind a few
// stand-ins for what only Dicer's geometry has:
// - vLocalPos: die-local position in v1's units (unit circumradius), from DsN's metres;
// - vFaceId, vEdgeDist, vFaceUV, dcD: no face ids, edge distances or glyph distances on a DsN
//   die, so every fragment reads as the middle of a face, away from any glyph;
// - dcMask (v1: the number fill): DsN's emissive map, which holds the labels (grey on black)
//   whether or not they glow. The body pattern is drawn under it and the labels are put back.
// The die's colour is DsN's (the map); the second colour, the style (preset), the metal finish
// and the roughness are material settings, saved with the player's look.
//
// Resin and jelly see through the body (v1's environment refraction) and come with the insides
// in step 4.
import { Color, Vector4 } from 'three';
import { soundMaterialOf } from '../../audio/sound-material.js';
import { PRESET_COLORS } from '../../look/body-colors.js';
import * as bone from '../../render/extras/bodies/bone.js';
import * as gem from '../../render/extras/bodies/gem.js';
import * as iridescent from '../../render/extras/bodies/iridescent.js';
import * as metalFinishes from '../../render/extras/bodies/metal-finishes.js';
import * as stone from '../../render/extras/bodies/stone.js';
import * as wood from '../../render/extras/bodies/wood.js';
import { MARBLE_COLOR, PEARL_COLOR, VEIN_SCALE } from '../../render/shaders/bodies.js';
import { NOISE_GLSL } from '../../render/shaders/noise.js';
import { diceSoundSetId, MODULE_ID } from '../sounds/register.js';

/**
 * DsN metres to v1 die-local units. v1's dice have unit circumradius; a DsN die's size follows
 * the screen on the board (DiceFactory.baseScale) and is another one in pictures and previews,
 * so the factor is 1 / the circumradius of the geometry being drawn: the uniform uDcLocalScale,
 * set by trackLocalScale() before each draw. LOCAL_SCALE is its value until then (a d6 preview).
 */
export const LOCAL_SCALE = 60;
const radii = new WeakMap();
/** 1 / the farthest vertex of a geometry from its origin (kept per geometry). */
export function localScaleOf(geometry) {
  let r = radii.get(geometry);
  if (r === undefined) {
    const p = geometry?.attributes?.position;
    let max = 0;
    for (let i = 0; i < (p?.count ?? 0); i++)
      max = Math.max(max, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    r = max > 0 ? 1 / max : LOCAL_SCALE;
    if (geometry) radii.set(geometry, r);
  }
  return r;
}
/**
 * Keeps a look's uDcLocalScale at the size of the die it draws (a look's material is one die
 * type at one size). A die's own copy (isolateMaterial) starts from the look's value.
 */
export function trackLocalScale(mat) {
  mat.onBeforeRender = function (_renderer, _scene, _camera, geometry) {
    const u = this.userData.uniforms?.uDcLocalScale;
    if (u) u.value = localScaleOf(geometry);
  };
}

/** v1 keeps a hairline coat on metal so an enamel fill can gloss: the same program shape. */
const METAL_COAT = 0.001;
const METAL_FINISHES = ['polished', 'mirror', 'patina', 'worn'];

/** The v1 body module of a body type, with presets (a uniform), or null. */
const MODULES = { iridescent, gem, wood, stone, bone };

/**
 * One entry per body type: v1's MeshPhysical parameters (dice-material.js BODY_PRESETS and the
 * modules' PARAMS), the DsN material shown without Realistic Lighting, the weight against
 * plastic (DsN's own: metal 7, wood 0.65, stone 1.5) and the second colour's default.
 */
export const BODIES = Object.freeze({
  opaque: { base: { roughness: 0.4, clearcoat: 0.6 }, fallback: 'plastic', weight: 1 },
  metal: {
    base: { metalness: 1, roughness: 0.3, clearcoat: METAL_COAT },
    fallback: 'metal',
    weight: 7,
    color2: PRESET_COLORS.patina.color2,
    finishes: METAL_FINISHES,
  },
  marble: {
    base: { roughness: 0.3, clearcoat: 0.4, sheen: 0.4 },
    fallback: 'stone',
    weight: 1.5,
    color2: '#3a3a3a',
  },
  pearl: {
    base: {
      roughness: 0.25,
      clearcoat: 1,
      iridescence: 1,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [250, 650],
      sheen: 0.6,
    },
    fallback: 'iridescent',
    weight: 1,
    color2: '#f0d8e8',
  },
  iridescent: { fallback: 'iridescent', weight: 1 },
  gem: { fallback: 'glass', weight: 1.5 },
  wood: { fallback: 'wood', weight: 0.65 },
  stone: { fallback: 'stone', weight: 1.5 },
  bone: { fallback: 'plastic', weight: 1 },
});

export const bodyMaterialId = (type) => `${MODULE_ID}.body-${type}`;

/** The presets of a body type (v1's order: the first is the default), or []. */
export const presetsOf = (type) => Object.keys(MODULES[type]?.PRESET_PARAMS ?? {});

/** v1's patch of a module body type for one preset (defines, uniforms, chunks, params). */
function modulePatch(type, preset, extra = {}) {
  const fn = {
    iridescent: iridescent.iridescentPatch,
    gem: gem.gemPatch,
    wood: wood.woodPatch,
    stone: stone.stonePatch,
    bone: bone.bonePatch,
  }[type];
  return fn({ body: { type, preset, finish: 'polished', ...extra } });
}

/** A settings range is 0..100: v1's roughness is 0..1. */
const roughnessDefault = (type) => {
  const first = presetsOf(type)[0];
  return Math.round(100 * (PRESET_COLORS[first]?.roughness ?? BODIES[type].base?.roughness ?? 0.4));
};
const color2Default = (type) =>
  BODIES[type].color2 ?? PRESET_COLORS[presetsOf(type)[0]]?.color2 ?? '#000000';

// --- shader ----------------------------------------------------------------------------------

export const after = (src, anchor, code) =>
  src.replace(`#include <${anchor}>`, `#include <${anchor}>\n${code}`);

export const VERTEX_PARS = /* glsl */ `
varying vec3 vLocalPos;
uniform float uDcLocalScale;
`;
export const VERTEX = /* glsl */ `
	vLocalPos = transformed * uDcLocalScale;
`;

/** What v1's body GLSL reads that a DsN die does not have (see the head of this file). */
export const FRAGMENT_PARS = /* glsl */ `
varying vec3 vLocalPos;
uniform vec3 uBodyColor2;
#define vFaceId 0.0
#define vEdgeDist 1.0
#define vFaceUV ( vLocalPos.xy )
#define dcD ( - 1.0 )
float dcBorderH( float e ) { return 0.0; }
`;

/** After color_fragment: the labels (DsN's emissive map) before the body is drawn. */
export const LABEL_MASK = /* glsl */ `
	vec4 dcTexel = diffuseColor;
	float dcMask = 0.0;
#ifdef USE_EMISSIVEMAP
	dcMask = smoothstep( 0.02, 0.2, texture2D( emissiveMap, vEmissiveMapUv ).r );
#endif
`;
export const LABEL_RESTORE = /* glsl */ `
	diffuseColor.rgb = mix( diffuseColor.rgb, dcTexel.rgb, dcMask );
`;

/** Oxide is not metal (v1 swaps this into its own metalness line). */
const PATINA_METALNESS = /* glsl */ `
#ifdef DICER_PATINA
	metalnessFactor = mix( metalnessFactor, 0.0, dcPatina );
#endif
`;

/**
 * The GLSL pieces of a body type: { defines, noise, pars, color, roughness, metalness, coat }.
 * `finish` only matters for metal.
 */
export function bodyGlsl(type, finish = 'polished') {
  const out = {
    defines: [],
    noise: false,
    pars: '',
    color: '',
    roughness: '',
    metalness: '',
    coat: '',
  };
  if (MODULES[type]) {
    const p = modulePatch(type, presetsOf(type)[0]);
    out.defines.push(...Object.keys(p.defines));
    out.noise = !!MODULES[type].USES_NOISE;
    out.pars = p.chunks.pars ?? '';
    out.color = p.chunks.colorPre ?? '';
    out.roughness = p.chunks.roughness ?? '';
    out.coat = p.chunks.coat ?? '';
  } else if (type === 'marble') {
    out.defines.push('DICER_MARBLE');
    out.noise = true;
    out.pars = 'uniform float uVeinScale;';
    out.color = MARBLE_COLOR;
  } else if (type === 'pearl') {
    out.defines.push('DICER_PEARL');
    out.color = PEARL_COLOR;
  } else if (type === 'metal') {
    const p = metalFinishes.metalFinishPatch({ body: { type, finish } });
    if (p.defines) {
      out.defines.push(...Object.keys(p.defines));
      out.noise = !!metalFinishes.USES_NOISE;
      out.color = p.chunks.colorPost ?? '';
      out.roughness = p.chunks.roughness ?? '';
      out.metalness = PATINA_METALNESS;
    }
  }
  return out;
}

/** Splices a body's GLSL into a three.js MeshPhysical shader (a DsN onBeforeCompile shader). */
export function patchBodyShader(shader, glsl) {
  if (!glsl.color && !glsl.roughness && !glsl.coat) return shader;
  shader.vertexShader = after(
    after(shader.vertexShader, 'common', VERTEX_PARS),
    'begin_vertex',
    VERTEX,
  );
  const defines = glsl.defines.map((d) => `#define ${d}`).join('\n');
  let f = shader.fragmentShader;
  f = after(
    f,
    'common',
    `${defines}\n${FRAGMENT_PARS}\n${glsl.noise ? NOISE_GLSL : ''}\n${glsl.pars}`,
  );
  f = after(f, 'color_fragment', `${LABEL_MASK}\n${glsl.color}\n${LABEL_RESTORE}`);
  if (glsl.roughness) f = after(f, 'roughnessmap_fragment', glsl.roughness);
  if (glsl.metalness) f = after(f, 'metalnessmap_fragment', glsl.metalness);
  if (glsl.coat) f = after(f, 'lights_physical_fragment', glsl.coat);
  shader.fragmentShader = f;
  return shader;
}

// --- materials -------------------------------------------------------------------------------

// DsN localizes a material's name, not its settings' names and options: Dicer does (the hook
// runs once Foundry's translations are loaded)
export const L = (k) =>
  globalThis.game?.i18n?.localize(`DICER.Appearance.${k}`) ?? `DICER.Appearance.${k}`;

/** The DiceMaterial of one body type (not registered). */
export function createBodyMaterial(DiceMaterial, type) {
  const spec = BODIES[type];
  const presets = presetsOf(type);
  const first = presets[0];
  const patch = MODULES[type] ? modulePatch(type, first) : null;
  const base = { ...(spec.base ?? {}), ...(patch?.params ?? {}) };
  base.roughness = roughnessDefault(type) / 100;

  const material = new DiceMaterial(bodyMaterialId(type), `DICER.V2.Material.${type}`)
    .setBase('physical', base)
    .setFallback(spec.fallback)
    .setImpactSounds(diceSoundSetId(soundMaterialOf({ body: { type } })))
    .setWeight(spec.weight);

  // the body's uniforms: v1's (uBodyPreset, uDcLines...) and the second colour
  const uses2 = type !== 'opaque';
  if (uses2) material.addUniform('uBodyColor2', new Color(color2Default(type)));
  for (const [name, { value }] of Object.entries(patch?.uniforms ?? {}))
    material.addUniform(name, value);
  if (type === 'marble') material.addUniform('uVeinScale', VEIN_SCALE);
  material.addUniform('uDcLocalScale', LOCAL_SCALE);

  if (presets.length)
    material.addSettingSelect({
      id: 'preset',
      name: L('Body.Preset'),
      defaultValue: first,
      options: Object.fromEntries(presets.map((p) => [p, L(`Preset.${p}`)])),
    });
  if (spec.finishes)
    material.addSettingSelect({
      id: 'finish',
      name: L('Body.Finish'),
      defaultValue: spec.finishes[0],
      options: Object.fromEntries(spec.finishes.map((f) => [f, L(`Finish.${f}`)])),
    });
  if (uses2)
    material.addSettingColor({
      id: 'color2',
      name: L('Body.SecondColor'),
      defaultValue: color2Default(type),
    });
  material.addSettingRange({
    id: 'roughness',
    name: L('Body.Roughness'),
    defaultValue: roughnessDefault(type),
    min: 0,
    max: 100,
    step: 5,
  });
  if (type === 'iridescent')
    material.addSettingBoolean({ id: 'streaks', name: L('Body.LayerLines'), defaultValue: true });

  // a look's values: in the process callback (the shader callback runs again for a die's own copy)
  material.registerProcessMaterialCallback((_diceType, mat, appearance) =>
    applySettings(type, mat, appearance?.materialSettings ?? {}),
  );
  material.registerBeforeShaderCompileCallback((shader, mat) => {
    patchBodyShader(shader, bodyGlsl(type, mat.userData.appearance?.materialSettings?.finish));
  });
  return material;
}

/** Puts a look's material settings on its three.js material and uniforms. */
export function applySettings(type, mat, settings) {
  trackLocalScale(mat);
  const u = mat.userData.uniforms ?? {};
  const presets = presetsOf(type);
  const preset = presets.includes(settings.preset) ? settings.preset : presets[0];
  if (u.uBodyPreset && preset)
    u.uBodyPreset.value = new Vector4(...MODULES[type].PRESET_PARAMS[preset]);
  if (u.uDcLines) u.uDcLines.value = settings.streaks === false ? 0 : 1;
  if (u.uBodyColor2) u.uBodyColor2.value = new Color(settings.color2 ?? color2Default(type));
  if ((type === 'pearl' || type === 'iridescent') && mat.sheenColor)
    mat.sheenColor.copy(u.uBodyColor2.value);
  const r = Number.isFinite(settings.roughness)
    ? settings.roughness / 100
    : roughnessDefault(type) / 100;
  mat.roughness = type === 'metal' && settings.finish === 'mirror' ? 0.02 : r;
}

/** Body types ported in this step, in v1's order. */
export const BODY_TYPES = Object.freeze(Object.keys(BODIES));

/**
 * Registers every body type in DsN's Material list. Returns their ids. addMaterial's promises
 * (resolved once a material's images load: these have none) are not awaited: DsN calls
 * diceSoNiceReady with Hooks.call, which must not get a promise back.
 */
export function registerBodies(dice3d, DiceMaterial) {
  const ids = [];
  for (const type of BODY_TYPES) {
    const material = createBodyMaterial(DiceMaterial, type);
    Promise.resolve(dice3d.addMaterial(material)).catch((err) =>
      console.error(`dicer: cannot add the ${type} material`, err),
    );
    ids.push(material.id);
  }
  return ids;
}
