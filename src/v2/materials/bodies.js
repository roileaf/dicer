import { Color, Vector3, Vector4 } from 'three';
import { soundMaterialOf } from '../../audio/sound-material.js';
import { PRESET_COLORS } from '../../look/body-colors.js';
import * as bone from '../../render/extras/bodies/bone.js';
import * as gem from '../../render/extras/bodies/gem.js';
import * as iridescent from '../../render/extras/bodies/iridescent.js';
import * as metalFinishes from '../../render/extras/bodies/metal-finishes.js';
import * as stone from '../../render/extras/bodies/stone.js';
import * as wood from '../../render/extras/bodies/wood.js';
import {
  FX_COLOR,
  FX_EMISSIVE,
  FX_PARS,
  MARBLE_COLOR,
  PEARL_COLOR,
  VEIN_SCALE,
} from '../../render/shaders/bodies.js';
import { NOISE_GLSL } from '../../render/shaders/noise.js';
import { diceSoundSetId, GROUP, MODULE_ID } from '../sounds/register.js';
import {
  addDetailSettings,
  addDetailUniforms,
  applyDetailSettings,
  DETAIL_BEGIN,
  DETAIL_COAT,
  DETAIL_COLOR,
  DETAIL_EMISSIVE,
  DETAIL_MASK,
  DETAIL_METALNESS,
  DETAIL_PARS,
  DETAIL_ROUGHNESS,
  setFaceUniforms,
} from './details.js';

export const LOCAL_SCALE = 60;
const radii = new WeakMap();
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
export function trackLocalScale(mat) {
  mat.onBeforeRender = function (_renderer, _scene, _camera, geometry) {
    const u = this.userData.uniforms?.uDcLocalScale;
    if (u) u.value = localScaleOf(geometry);
    setFaceUniforms(this.userData.uniforms, geometry);
  };
}

const METAL_COAT = 0.001;
const METAL_FINISHES = ['polished', 'mirror', 'patina', 'worn'];

const MODULES = { iridescent, gem, wood, stone, bone };

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

export const presetsOf = (type) => Object.keys(MODULES[type]?.PRESET_PARAMS ?? {});

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

const roughnessDefault = (type) => {
  const first = presetsOf(type)[0];
  return Math.round(100 * (PRESET_COLORS[first]?.roughness ?? BODIES[type].base?.roughness ?? 0.4));
};
const color2Default = (type) =>
  BODIES[type].color2 ?? PRESET_COLORS[presetsOf(type)[0]]?.color2 ?? '#000000';

export const after = (src, anchor, code) =>
  src.replace(`#include <${anchor}>`, `#include <${anchor}>\n${code}`);

export const VERTEX_PARS = /* glsl */ `
varying vec3 vLocalPos;
uniform float uDcLocalScale;
`;
export const VERTEX = /* glsl */ `
	vLocalPos = transformed * uDcLocalScale;
`;

export const FRAGMENT_PARS = /* glsl */ `
varying vec3 vLocalPos;
uniform vec3 uBodyColor2;
${DETAIL_PARS}
#define vFaceId dcFaceV
#define vEdgeDist dcEdgeV
#define vFaceUV ( vLocalPos.xy )
#define dcD ( - 1.0 )
float dcBorderH( float e ) { return 0.0; }
`;

export const LABEL_MASK = /* glsl */ `
${DETAIL_BEGIN}
	vec4 dcTexel = diffuseColor;
	float dcMask = 0.0;
#ifdef USE_EMISSIVEMAP
	dcMask = smoothstep( 0.02, 0.2, texture2D( emissiveMap, vEmissiveMapUv ).r );
#endif
${DETAIL_MASK}
`;
export const LABEL_RESTORE = /* glsl */ `
	diffuseColor.rgb = mix( diffuseColor.rgb, dcTexel.rgb, dcMask );
`;

const PATINA_METALNESS = /* glsl */ `
#ifdef DICER_PATINA
	metalnessFactor = mix( metalnessFactor, 0.0, dcPatina );
#endif
`;

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

export function patchBodyShader(shader, glsl) {
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
    `${defines}\n${FRAGMENT_PARS}\n${FX_PARS}\n${glsl.noise ? NOISE_GLSL : ''}\n${glsl.pars}`,
  );
  f = after(
    f,
    'color_fragment',
    `${LABEL_MASK}\n${glsl.color}\n${LABEL_RESTORE}\n${DETAIL_COLOR}\n${FX_COLOR}`,
  );
  f = after(f, 'emissivemap_fragment', `${DETAIL_EMISSIVE}\n${FX_EMISSIVE}`);
  f = after(f, 'roughnessmap_fragment', `${glsl.roughness}\n${DETAIL_ROUGHNESS}`);
  f = after(f, 'metalnessmap_fragment', `${glsl.metalness}\n${DETAIL_METALNESS}`);
  f = after(f, 'lights_physical_fragment', `${DETAIL_COAT}\n${glsl.coat}`);
  shader.fragmentShader = f;
  return shader;
}

export function addFxUniforms(material) {
  material.addUniform('uFxTint', new Vector4(0, 0, 0, 0));
  material.addUniform('uFxFlare', new Vector3(0, 0, 0));
  return material;
}

export const L = (k) =>
  globalThis.game?.i18n?.localize(`DICER.Appearance.${k}`) ?? `DICER.Appearance.${k}`;

export const V = (k) =>
  globalThis.game?.i18n?.localize(`DICER.V2.Material.${k}`) ?? `DICER.V2.Material.${k}`;

export function createBodyMaterial(DiceMaterial, type) {
  const spec = BODIES[type];
  const presets = presetsOf(type);
  const first = presets[0];
  const patch = MODULES[type] ? modulePatch(type, first) : null;
  const base = { ...(spec.base ?? {}), ...(patch?.params ?? {}) };
  base.roughness = roughnessDefault(type) / 100;

  const material = new DiceMaterial(bodyMaterialId(type), `DICER.V2.Material.${type}`, GROUP)
    .setBase('physical', base)
    .setFallback(spec.fallback)
    .setImpactSounds(diceSoundSetId(soundMaterialOf({ body: { type } })))
    .setWeight(spec.weight);

  const uses2 = type !== 'opaque';
  if (uses2) material.addUniform('uBodyColor2', new Color(color2Default(type)));
  for (const [name, { value }] of Object.entries(patch?.uniforms ?? {}))
    material.addUniform(name, value);
  if (type === 'marble') material.addUniform('uVeinScale', VEIN_SCALE);
  material.addUniform('uDcLocalScale', LOCAL_SCALE);
  addFxUniforms(material);
  addDetailUniforms(material);

  material.addSettingSeparator({ name: L('Section.body') });
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
      ...(type === 'metal' ? { showIf: { finish: ['patina', 'worn'] } } : {}),
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

  addDetailSettings(material, L, V);

  material.registerProcessMaterialCallback((_diceType, mat, appearance) => {
    applySettings(type, mat, appearance?.materialSettings ?? {});
    applyDetailSettings(mat, appearance?.materialSettings ?? {}, appearance, type);
  });
  material.registerBeforeShaderCompileCallback((shader, mat) => {
    patchBodyShader(shader, bodyGlsl(type, mat.userData.appearance?.materialSettings?.finish));
  });
  return material;
}

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

export const BODY_TYPES = Object.freeze(Object.keys(BODIES));

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
