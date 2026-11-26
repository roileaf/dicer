import { Color, Vector2, Vector3, Vector4 } from 'three';

export const MAX_FACES = 20;
export const GLOW_INK = 1.6;
export const INKS = Object.freeze({
  paint: [0, 0.6, 0, 0],
  gold: [1, 0.3, 0, 0],
  silver: [1, 0.25, 0, 0],
  enamel: [0, 0.15, 1, 0],
  outline: [0, 0.6, 0, 0],
  holo: [1, 0.2, 0, 1],
  glow: [0, 0.6, 0, 0],
});
export const STRIPS = Object.freeze({
  body: [0, 0.45, 0],
  paint: [0, 0.45, 0],
  metal: [1, 0.25, 0],
  glow: [0, 0.45, 1],
});
export const DETAIL_DEFAULTS = Object.freeze({
  ink: 'paint',
  inkGlow: 100,
  glowColor: '#ffffff',
  glowIntensity: 0,
  strip: 'body',
  stripColor: '#ffffff',
  stripStrength: 100,
  stripWidth: 10,
});
export const STRIP_WIDTH_MAX = 0.3;
export const LIFT = Object.freeze({
  gem: [1.1, 1.5, 0.5],
  wood: [1.1, 1.35, 1],
  metal: [1.2, 1.3, 1],
});
const NO_LIFT = [1, 1, 1];

const faceData = new WeakMap();
const NONE = Object.freeze({ normals: [], inradius: 0, faceInradius: 1 });

export function faceDataOf(geometry) {
  if (!geometry?.attributes?.position) return NONE;
  let data = faceData.get(geometry);
  if (data) return data;
  const p = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : p.count;
  let r = 0;
  for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
  const at = (i) => {
    const k = index ? index.getX(i) : i;
    return [p.getX(k) / r, p.getY(k) / r, p.getZ(k) / r];
  };
  const planes = [];
  for (let i = 0; r > 0 && i + 2 < count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    let d = (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / len;
    const s = d < 0 ? -1 : 1;
    d *= s;
    planes.push({ n: n.map((v) => (s * v) / len), d });
  }
  const inradius = planes.reduce((m, f) => Math.min(m, f.d), Infinity);
  const normals = [];
  for (const f of planes) {
    if (f.d > inradius * 1.02) continue;
    if (normals.some((n) => n[0] * f.n[0] + n[1] * f.n[1] + n[2] * f.n[2] > 0.999)) continue;
    normals.push(f.n);
  }
  if (!normals.length || normals.length > MAX_FACES) data = NONE;
  else {
    let faceInradius = Infinity;
    for (const n of normals.slice(1)) {
      const c = n[0] * normals[0][0] + n[1] * normals[0][1] + n[2] * normals[0][2];
      if (Math.abs(c) > 0.999) continue;
      faceInradius = Math.min(faceInradius, (inradius * (1 - c)) / Math.sqrt(1 - c * c));
    }
    data = { normals, inradius, faceInradius: Number.isFinite(faceInradius) ? faceInradius : 1 };
  }
  faceData.set(geometry, data);
  return data;
}

export function setFaceUniforms(uniforms, geometry) {
  const faces = uniforms?.uDcFaces?.value;
  if (!faces) return;
  const data = faceDataOf(geometry);
  for (let i = 0; i < data.normals.length; i++) faces[i].fromArray(data.normals[i]);
  uniforms.uDcFaceCount.value = data.normals.length;
  uniforms.uDcFaceGeo.value.set(data.inradius, data.faceInradius);
}

export const DETAIL_PARS = /* glsl */ `
uniform vec4 uDcInk;
uniform float uDcInkGlow;
uniform vec3 uDcHalo;
uniform vec4 uDcHollow;
uniform vec4 uDcStrip;
uniform vec3 uDcStripPBR;
uniform float uDcStripWidth;
uniform vec3 uDcLift;
uniform vec3 uDcFaces[ ${MAX_FACES} ];
uniform float uDcFaceCount;
uniform vec2 uDcFaceGeo;
float dcEdgeV = 1.0;
float dcFaceV = 0.0;
float dcEdge = 0.0;
void dcFaceInfo( vec3 p ) {
	if ( uDcFaceCount < 0.5 ) return;
	int dcBest = 0;
	float dcD0 = - 1e9;
	for ( int i = 0; i < ${MAX_FACES}; i ++ ) {
		if ( float( i ) >= uDcFaceCount ) break;
		float d = dot( uDcFaces[ i ], p );
		if ( d > dcD0 ) { dcD0 = d; dcBest = i; }
	}
	vec3 dcN0 = uDcFaces[ dcBest ];
	float dcE = 1e9;
	for ( int i = 0; i < ${MAX_FACES}; i ++ ) {
		if ( float( i ) >= uDcFaceCount ) break;
		float c = dot( uDcFaces[ i ], dcN0 );
		if ( abs( c ) > 0.999 ) continue;
		dcE = min( dcE, ( dcD0 - dot( uDcFaces[ i ], p ) ) / sqrt( 1.0 - c * c ) );
	}
	bool dcBevel = dcD0 < uDcFaceGeo.x * 0.994;
	dcFaceV = dcBevel ? - 1.0 : float( dcBest );
	dcEdgeV = dcBevel ? 0.0 : clamp( dcE / uDcFaceGeo.y, 0.0, 4.0 );
}
`;

export const DETAIL_BEGIN = /* glsl */ `
	dcFaceInfo( vLocalPos );
`;

export const DETAIL_MASK = /* glsl */ `
	dcMask *= mix( 1.0, smoothstep( 0.06, 0.25, distance( dcTexel.rgb, uDcHollow.rgb ) ), uDcHollow.a );
`;

export const DETAIL_COLOR = /* glsl */ `
	dcEdge = uDcStrip.a * ( 1.0 - dcMask ) * max( step( dcFaceV, - 0.5 ),
		1.0 - smoothstep( uDcStripWidth * 0.75, uDcStripWidth, dcEdgeV ) ) * step( 1e-4, uDcStripWidth );
	{
		vec3 dcLc = diffuseColor.rgb;
		dcLc = mix( vec3( dot( dcLc, vec3( 0.2126, 0.7152, 0.0722 ) ) ), dcLc, uDcLift.y ) * uDcLift.x;
		diffuseColor.rgb = mix( clamp( dcLc, 0.0, 1.0 ), diffuseColor.rgb, dcMask );
	}
	diffuseColor.rgb = mix( diffuseColor.rgb, uDcStrip.rgb, dcEdge );
`;

export const DETAIL_ROUGHNESS = /* glsl */ `
	roughnessFactor = mix( roughnessFactor, uDcInk.y, dcMask );
	roughnessFactor = mix( roughnessFactor, uDcStripPBR.y, dcEdge );
`;

export const DETAIL_METALNESS = /* glsl */ `
	metalnessFactor = mix( metalnessFactor, uDcInk.x, dcMask );
	metalnessFactor = mix( metalnessFactor, uDcStripPBR.x, dcEdge );
`;

export const DETAIL_EMISSIVE = /* glsl */ `
	{
		float dcHue = 1.6 * dot( normal, normalize( vViewPosition ) ) + 0.35 * ( vLocalPos.x + vLocalPos.y + vLocalPos.z );
		vec3 dcHolo = 0.55 + 0.45 * cos( 6.2832 * ( dcHue + vec3( 0.0, 0.33, 0.67 ) ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, dcHolo * mix( vec3( 1.0 ), dcTexel.rgb, 0.35 ), dcMask * uDcInk.w );
	}
	totalEmissiveRadiance += ( dcTexel.rgb * uDcInkGlow + uDcHalo ) * dcMask + uDcStrip.rgb * dcEdge * uDcStripPBR.z;
`;

export const DETAIL_COAT = /* glsl */ `
#ifdef USE_CLEARCOAT
	material.clearcoat *= mix( uDcLift.z, 1.0, max( dcMask, dcEdge ) );
	material.clearcoat = max( material.clearcoat, uDcInk.z * dcMask );
	material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.0525, uDcInk.z * dcMask );
#endif
`;

const pct = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d) / 100;
const colour = (v, d) => {
  try {
    return new Color(/^#[0-9a-f]{6}$/i.test(String(v)) ? v : d);
  } catch {
    return new Color(d);
  }
};

export function detailUniforms(settings = {}, labelColor = null, lift = NO_LIFT) {
  const s = { ...DETAIL_DEFAULTS, ...settings };
  const ink = Object.hasOwn(INKS, s.ink) ? s.ink : 'paint';
  const strip = Object.hasOwn(STRIPS, s.strip) ? s.strip : 'body';
  const [metal, rough, gloss, holo] = INKS[ink];
  const halo = colour(s.glowColor, '#ffffff').multiplyScalar(pct(s.glowIntensity, 0));
  const edge = colour(s.stripColor, '#ffffff');
  const hollow = colour(labelColor, '#000000');
  const on = strip !== 'body';
  return {
    uDcInk: new Vector4(metal, rough, gloss, holo),
    uDcInkGlow: ink === 'glow' ? GLOW_INK * pct(s.inkGlow, 100) : 0,
    uDcHalo: new Vector3(halo.r, halo.g, halo.b),
    uDcHollow: new Vector4(hollow.r, hollow.g, hollow.b, ink === 'outline' && labelColor ? 1 : 0),
    uDcStrip: new Vector4(edge.r, edge.g, edge.b, on ? pct(s.stripStrength, 100) : 0),
    uDcStripPBR: new Vector3(...STRIPS[strip]),
    uDcStripWidth: on ? STRIP_WIDTH_MAX * pct(s.stripWidth, 10) : 0,
    uDcLift: new Vector3(...lift),
  };
}

export function applyDetailSettings(mat, settings, appearance = null, type = null) {
  const u = (mat.userData.uniforms ??= {});
  const label = appearance?.labelColor ?? appearance?.foreground ?? null;
  for (const [name, value] of Object.entries(
    detailUniforms(settings, label, LIFT[type] ?? NO_LIFT),
  ))
    u[name] = { value };
  u.uDcFaces ??= { value: Array.from({ length: MAX_FACES }, () => new Vector3(0, 1, 0)) };
  u.uDcFaceCount ??= { value: 0 };
  u.uDcFaceGeo ??= { value: new Vector2(0, 1) };
  if (u.uDcInk.value.z > 0 && 'clearcoat' in mat && !(mat.clearcoat > 0)) mat.clearcoat = 0.001;
}

export function addDetailUniforms(material) {
  for (const [name, value] of Object.entries(detailUniforms())) material.addUniform(name, value);
  return material;
}

const hint = (text) => `<p class="hint">${text}</p>`;

export function addDetailSettings(material, L, V) {
  const options = (keys, group) => Object.fromEntries(keys.map((k) => [k, L(`${group}.${k}`)]));
  const d = DETAIL_DEFAULTS;
  material.addSettingSeparator({ name: L('Section.numbers') });
  material.addSettingSelect({
    id: 'ink',
    name: L('Numbers.Fill'),
    defaultValue: d.ink,
    options: options(Object.keys(INKS), 'Fill'),
  });
  material.addSettingRange({
    id: 'inkGlow',
    name: L('Numbers.InkGlow'),
    defaultValue: d.inkGlow,
    min: 0,
    max: 300,
    step: 10,
  });
  material.addSettingSeparator({ name: L('Section.glow') });
  material.addSettingHTML({ name: hint(L('Glow.Hint')) });
  material.addSettingColor({ id: 'glowColor', name: L('Glow.Color'), defaultValue: d.glowColor });
  material.addSettingRange({
    id: 'glowIntensity',
    name: L('Glow.Intensity'),
    defaultValue: d.glowIntensity,
    min: 0,
    max: 300,
    step: 5,
  });
  material.addSettingSeparator({ name: L('Edges.Strip') });
  material.addSettingHTML({ name: hint(V('StripHint')) });
  material.addSettingSelect({
    id: 'strip',
    name: V('Style'),
    defaultValue: d.strip,
    options: options(Object.keys(STRIPS), 'Strip'),
  });
  material.addSettingColor({ id: 'stripColor', name: L('Glow.Color'), defaultValue: d.stripColor });
  material.addSettingRange({
    id: 'stripStrength',
    name: L('Edges.StripStrength'),
    defaultValue: d.stripStrength,
    min: 0,
    max: 100,
    step: 5,
  });
  material.addSettingRange({
    id: 'stripWidth',
    name: V('Width'),
    defaultValue: d.stripWidth,
    min: 0,
    max: 100,
    step: 5,
  });
  material.showWhen?.('inkGlow', 'ink', 'glow');
  for (const row of ['stripColor', 'stripStrength', 'stripWidth'])
    material.hideWhen?.(row, 'strip', 'body');
  return material;
}

export function detailSettingsOf(a, readable, stripOn) {
  const out = {
    ink: Object.hasOwn(INKS, a.numbers.fill) ? a.numbers.fill : 'paint',
    glowColor: a.glow.color,
    glowIntensity: Math.round(100 * readable.glow),
  };
  if (out.ink === 'glow') out.inkGlow = Math.round(100 * (a.numbers.inkGlow ?? 1));
  if (stripOn) {
    const s = a.edges.strip;
    out.strip = s.style;
    out.stripColor = s.color;
    out.stripStrength = Math.round(100 * s.strength);
    out.stripWidth = Math.round(100 * (0.15 + 0.5 * a.edges.radius));
  }
  return out;
}
