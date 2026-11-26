import { stripActive } from '../../look/appearance.js';
import { readableNumbers } from '../../look/contrast.js';
import { BODIES, bodyMaterialId, presetsOf } from '../materials/bodies.js';
import { detailSettingsOf } from '../materials/details.js';
import { fontFamilyOf } from './fonts.js';
import { iconPackOf, iconSystemId, isRounded } from './icons.js';

const pct = (v) => Math.round(v * 100);

export function materialSettingsOf(a) {
  const b = a.body;
  if (b.type === 'jelly')
    return typeof b.color2 === 'string'
      ? { roughness: pct(b.roughness), glow: true, color2: b.color2 }
      : { roughness: pct(b.roughness) };
  if (b.type === 'resin') {
    const i = a.interior;
    return {
      inside: i.type,
      shape: i.shape,
      inclusion: i.inclusion,
      insideColor: i.colors[0],
      insideColor2: i.colors[1],
      density: pct(i.density),
      bubble: !!i.bubble,
      sand: !!i.sand,
      motion: i.motion !== false,
      extra: i.extra,
      extraColor: i.extraColor,
      extraDensity: pct(i.extraDensity),
      roughness: pct(b.roughness),
    };
  }
  const s = { roughness: pct(b.roughness) };
  if (b.type !== 'opaque') s.color2 = b.color2;
  if (presetsOf(b.type).length)
    s.preset = presetsOf(b.type).includes(b.preset) ? b.preset : presetsOf(b.type)[0];
  if (BODIES[b.type]?.finishes)
    s.finish = BODIES[b.type].finishes.includes(b.finish) ? b.finish : 'polished';
  if (b.type === 'iridescent') s.streaks = b.streaks !== false;
  return s;
}

export function dsnLook(a) {
  const readable = readableNumbers(a);
  const hollow = a.numbers.fill === 'outline';
  const lined = !!a.numbers.outline && a.numbers.outlineWidth > 0;
  return {
    colorset: 'custom',
    system: isRounded(a) ? 'rounded' : 'standard',
    texture: 'none',
    font: fontFamilyOf(a.numbers.font),
    diceColor: a.body.color,
    edgeColor: a.body.color,
    labelColor: hollow ? a.body.color : readable.fill,
    outlineColor: hollow
      ? readable.fill
      : lined
        ? a.numbers.outline
        : a.body.type === 'resin'
          ? a.body.color2
          : 'none',
    material: bodyMaterialId(a.body.type),
    materialSettings: {
      ...materialSettingsOf(a),
      ...detailSettingsOf(a, readable, stripActive(a)),
    },
  };
}

export function dsnAppearance(theme) {
  const out = { global: dsnLook(theme.appearance) };
  for (const [type, a] of Object.entries(theme.perType ?? {})) out[type] = dsnLook(a);
  const pack = iconPackOf(theme.perType?.d20 ?? theme.appearance);
  if (pack) out.d20 = { ...(out.d20 ?? out.global), system: iconSystemId(pack) };
  return out;
}
