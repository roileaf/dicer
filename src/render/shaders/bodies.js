/**
 * Body and finish shader modules (Task 5): marble veins, pearl tint, brushed/antique metal,
 * the raised metal face border, number glow and the resin environment refraction (P2-R6).
 *
 * Every block is behind its own define (DICER_MARBLE, DICER_PEARL, DICER_BRUSHED,
 * DICER_ANTIQUE, DICER_BORDER, DICER_GLOW, DICER_RESIN). The defines follow programKey (body
 * type, metal finish, glow flag), so there is still one program per key; every colour and
 * number is a uniform. dice-material.js only injects the blocks a program needs (bodyChunks),
 * so the noise library is compiled only where it is used.
 *
 * Shared varyings: vEdgeDist (aEdgeDist, face units, 0 at the face polygon edge), vLocalPos
 * (die-local position) and, for resin, vLocalCam (camera position in die-local space). Task 6's
 * interior march uses vLocalPos / vLocalCam too.
 */
import { NOISE_GLSL } from './noise.js';
import { RIM_DARK } from './engrave.js';

/** Raised border band across aEdgeDist (face units) and its bump height. */
export const BORDER = Object.freeze({ from: 0.06, to: 0.14, height: 0.012 });
/**
 * Resin: index of refraction, body ellipsoid radius (die-local), Beer-Lambert reference chord
 * (a full diameter transmits the body colour), lit-table albedo, exit-normal share of the
 * mirrored entry face (vs the ellipsoid normal), the coin's density boost (its chord through
 * the thin caps is about a seventh of a die's, so it would read pale grey), the clearcoat
 * roughness and the minimum roughness on the rounded bevels (aFaceId < 0), which otherwise
 * mirror the studio strip lights as a hard white bar.
 */
export const RESIN = Object.freeze({
  ior: 1.52,
  radius: 0.85,
  refChord: 1.7,
  floor: 0.35,
  parallel: 0.5,
  coinDensity: 4.0,
  coatRoughness: 0.06,
  bevelRoughness: 0.3,
  bevelCoatRoughness: 0.35,
});
/** Schlick F0 at the air/resin interface: ((n - 1) / (n + 1))^2. */
const RESIN_F0 = ((RESIN.ior - 1) / (RESIN.ior + 1)) ** 2;
/**
 * Marker line in RESIN_REFRACTION where the interior march (shaders/interior.js) is spliced
 * in: after dcRefracted, inside the block that owns the refracted ray (dcRd, dcRm, dcRbody).
 */
export const INTERIOR_HOOK = '\t\t// dicer:interior';
/** Marble vein scale (uVeinScale default). */
export const VEIN_SCALE = 1.6;

const f = (x) => x.toFixed(4);

/** Vertex shader: after `#include <common>`. */
export const BODY_VERTEX_PARS = /* glsl */ `
attribute float aEdgeDist;
varying float vEdgeDist;
varying vec3 vLocalPos;
#ifdef DICER_RESIN
varying vec3 vLocalCam;
#endif
`;

/** Vertex shader: after `#include <begin_vertex>`. */
export const BODY_VERTEX = /* glsl */ `
	vEdgeDist = aEdgeDist;
	vLocalPos = transformed;
#ifdef DICER_RESIN
	vLocalCam = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
#endif
`;

export const RESIN_UNIFORMS = /* glsl */ `
uniform float uResinDensity; // Beer-Lambert strength (1: a full ${RESIN.refChord} chord transmits the body colour)
uniform float uResinFloor;   // albedo of the lit table seen below the horizon through resin
uniform vec3 uResinRadii;    // body ellipsoid semi-axes, die-local (a ${RESIN.radius} sphere; flattened on the coin)
uniform vec4 uResinTint;     // rgb: tint target, a: its share of the Beer-Lambert body colour
`;

export const RESIN_PARS = /* glsl */ `
#ifdef DICER_RESIN
varying vec3 vLocalCam;
uniform mat4 modelMatrix; // three uploads it per object; the vertex stage declares it too

// Length of the ray p + t d (d unit) to the far side of the body ellipsoid uResinRadii. A
// start point outside the ellipsoid (die corners reach past it) inflates it to pass through
// p, so the chord stays continuous instead of collapsing to 0 (a visible "orb" otherwise).
// radii: the ellipsoid used, for the exit normal.
float dcChord( vec3 p, vec3 d, out vec3 radii ) {
	radii = uResinRadii * max( 1.0, length( p / uResinRadii ) );
	vec3 sp = p / radii;
	vec3 sd = d / radii;
	float a = dot( sd, sd );
	float b = dot( sp, sd );
	float c = dot( sp, sp ) - 1.0;
	return max( ( - b + sqrt( max( b * b - a * c, 0.0 ) ) ) / a, 0.0 );
}
#endif
`;

/** Fragment shader: after `#include <common>` (after ENGRAVE_PARS). */
export const BODY_PARS = /* glsl */ `
uniform vec3 uBodyColor2;
uniform float uVeinScale;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
${RESIN_UNIFORMS.trimStart()}varying float vEdgeDist;
varying vec3 vLocalPos;
${RESIN_PARS.trimStart()}
// Raised border: a smoothstep bump of height ${BORDER.height} across aEdgeDist in [${BORDER.from}, ${BORDER.to}].
float dcBorderH( float e ) {
	float m = ${f((BORDER.from + BORDER.to) / 2)};
	return ${f(BORDER.height)} * smoothstep( ${f(BORDER.from)}, m, e ) * ( 1.0 - smoothstep( m, ${f(BORDER.to)}, e ) );
}
// d(height)/d(edge distance): positive on the outer flank, negative on the inner one.
float dcBorderDH( float e ) {
	float m = ${f((BORDER.from + BORDER.to) / 2)};
	float w = m - ${f(BORDER.from)};
	float a = clamp( ( e - ${f(BORDER.from)} ) / w, 0.0, 1.0 );
	float b = clamp( ( e - m ) / w, 0.0, 1.0 );
	return ${f(BORDER.height)} * ( 6.0 * a * ( 1.0 - a ) - 6.0 * b * ( 1.0 - b ) ) / w;
}
`;

/** Brushed metal grooves: a 1D value noise along face U (no texture, no fbm). */
const BRUSH_PARS = /* glsl */ `
float dcLineHash( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
float dcLines( float x ) {
	float i = floor( x );
	float t = fract( x );
	t = t * t * ( 3.0 - 2.0 * t );
	return mix( dcLineHash( i ), dcLineHash( i + 1.0 ), t );
}
`;

/**
 * Fragment shader: after `#include <color_fragment>`, before ENGRAVE_COLOR (so the number fill
 * is mixed over the body). Marble veins, the pearl tint and the brushed grooves.
 */
export const MARBLE_COLOR = /* glsl */ `
#ifdef DICER_MARBLE
	{
		// Domain-warped fbm in die-local space: the veins turn with the die.
		vec3 dcMp = vLocalPos * uVeinScale;
		vec3 dcMw = vec3( dcFbm3( dcMp, 3 ),
			dcFbm3( dcMp + vec3( 5.2, 1.3, 2.8 ), 3 ),
			dcFbm3( dcMp + vec3( 1.7, 9.2, 4.1 ), 3 ) );
		float dcMt = dcFbm3( dcMp + 2.4 * dcMw, 4 );
		float dcMain = abs( sin( ( dot( dcMp, vec3( 0.80, 0.45, 0.35 ) ) + 4.0 * dcMt ) * 3.14159 ) );
		float dcFine = abs( sin( ( dot( dcMp, vec3( - 0.30, 0.90, 0.30 ) ) * 1.7 + 6.0 * dcFbm3( dcMp * 2.1 + dcMw, 3 ) ) * 3.14159 ) );
		// Fixed sharpness: thin main veins, thinner and fainter secondary ones.
		float dcVein = max( 1.0 - smoothstep( 0.0, 0.10, dcMain ), 0.55 * ( 1.0 - smoothstep( 0.0, 0.05, dcFine ) ) );
		float dcCloud = smoothstep( 0.35, 0.80, dcMt );
		vec3 dcStone = mix( diffuseColor.rgb, mix( diffuseColor.rgb, uBodyColor2, 0.3 ), dcCloud );
		diffuseColor.rgb = mix( dcStone, uBodyColor2, dcVein );
	}
#endif
`;

export const PEARL_COLOR = /* glsl */ `
#ifdef DICER_PEARL
	{
		// Uniform-only tint (no noise): the body shifts towards color2 at grazing angles and
		// drifts through a soft thin-film hue cycle with view angle (nacre).
		float dcGraze = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, uBodyColor2, 0.8 * smoothstep( 0.05, 0.75, dcGraze ) );
		vec3 dcFilm = cos( 6.2832 * ( 1.6 * dcGraze + vec3( 0.0, 0.33, 0.67 ) ) );
		diffuseColor.rgb = clamp( diffuseColor.rgb * ( 1.0 + 0.16 * dcFilm ), 0.0, 1.0 );
	}
#endif
`;

export const BRUSHED_COLOR = /* glsl */ `
#ifdef DICER_BRUSHED
	// Grooves run along face V (the anisotropic highlight stretches along U, across them).
	// Faded out where a groove is under a pixel wide.
	float dcBrushFreq = 22.0;
	float dcBrushAA = 1.0 - smoothstep( 0.6, 2.0, fwidth( vFaceUV.x ) * dcBrushFreq );
	float dcBrush = vFaceId > - 0.5
		? ( dcLines( vFaceUV.x * dcBrushFreq + vFaceId * 37.0 ) * 0.7 + dcLines( vFaceUV.x * dcBrushFreq * 0.31 + 11.0 ) * 0.3 - 0.5 ) * dcBrushAA
		: 0.0;
	diffuseColor.rgb *= 1.0 + 0.35 * dcBrush;
#endif
`;

/**
 * Fragment shader: after ENGRAVE_COLOR (needs the glyph distance dcD and dcMask). Antique
 * cavity darkening: the face-edge channel (aEdgeDist < 0.12), a tarnish halo just outside the
 * engraved glyph walls and the raised border, all broken up by fbm grime. The fill is untouched.
 */
export const ANTIQUE_COLOR = /* glsl */ `
#ifdef DICER_ANTIQUE
	float dcGrime = dcFbm3( vLocalPos * 7.0, 4 );
	float dcCav = 0.0;
	if ( vFaceId > - 0.5 ) {
		dcCav = 1.0 - smoothstep( 0.0, 0.12, vEdgeDist );
		dcCav = max( dcCav, 1.0 - smoothstep( 0.0, 0.08, - dcD ) );
	#ifdef DICER_BORDER
		dcCav = max( dcCav, 0.35 * dcBorderH( vEdgeDist ) / ${f(BORDER.height)} );
	#endif
	}
	dcCav *= ( 1.0 - dcMask ) * mix( 0.35, 1.0, dcGrime );
	float dcTarnish = mix( 0.6, 1.0, smoothstep( 0.3, 0.7, dcFbm3( vLocalPos * 2.3 + 4.0, 3 ) ) );
	diffuseColor.rgb *= mix( 1.0, dcTarnish, 1.0 - dcMask );
	diffuseColor.rgb = mix( diffuseColor.rgb, uBodyColor2 * 0.3, dcCav );
#endif
`;

/** Fragment shader: after `#include <roughnessmap_fragment>`, before the fill roughness mix. */
export const BODY_ROUGHNESS = /* glsl */ `
#ifdef DICER_BRUSHED
	roughnessFactor = clamp( roughnessFactor + 0.2 * dcBrush, 0.0, 1.0 );
#endif
#ifdef DICER_ANTIQUE
	roughnessFactor = mix( roughnessFactor, 0.85, dcCav );
#endif
`;

/**
 * Resin and pearl: rougher bevels (fragment shader, after `#include <roughnessmap_fragment>`).
 * A rounded bevel is a cylinder that mirrors a whole line of directions, so any studio panel
 * crossing it drew a hard bar along the edge.
 */
export const BEVEL_ROUGHNESS = /* glsl */ `
#if defined( DICER_RESIN ) || defined( DICER_PEARL )
	if ( vFaceId < - 0.5 ) roughnessFactor = max( roughnessFactor, ${f(RESIN.bevelRoughness)} );
#endif
`;

/** The same for the clearcoat lobe (after `#include <lights_physical_fragment>` and FILL_GLOSS). */
export const BEVEL_COAT = /* glsl */ `
#if defined( USE_CLEARCOAT ) && ( defined( DICER_RESIN ) || defined( DICER_PEARL ) )
	if ( vFaceId < - 0.5 ) material.clearcoatRoughness = max( material.clearcoatRoughness, ${f(RESIN.bevelCoatRoughness)} );
#endif
`;

/**
 * Fragment shader: after `#include <normal_fragment_begin>`. Brushed metal: replaces three's
 * tangent frame (getTangentFrame over vUv, which these meshes do not have) with one whose
 * tangent is face U, from the aFaceUV screen derivatives (same construction as
 * getTangentFrame). three's lights_physical_fragment then builds material.anisotropyT/B from
 * this tbn and anisotropyVector (rotation 0: along the tangent). Bevels (no face frame) fall
 * back to any tangent perpendicular to the normal.
 */
export const BRUSHED_TANGENT = /* glsl */ `
#ifdef DICER_BRUSHED
	{
		vec3 dcAq0 = dFdx( - vViewPosition );
		vec3 dcAq1 = dFdy( - vViewPosition );
		vec2 dcAs0 = dFdx( vFaceUV );
		vec2 dcAs1 = dFdy( vFaceUV );
		vec3 dcAnisoT = cross( dcAq1, normal ) * dcAs0.x + cross( normal, dcAq0 ) * dcAs1.x;
		if ( vFaceId < - 0.5 || dot( dcAnisoT, dcAnisoT ) < 1e-24 )
			dcAnisoT = cross( normal, abs( normal.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) );
		dcAnisoT = normalize( dcAnisoT - normal * dot( dcAnisoT, normal ) );
		tbn = mat3( dcAnisoT, cross( normal, dcAnisoT ), normal );
	}
#endif
`;

/**
 * Fragment shader: after ENGRAVE_NORMAL. Raised face border on metal: the normal tilts
 * outward on the lip's outer flank and inward on its inner flank. The tilt direction is the
 * surface gradient of aEdgeDist (inward, perpendicular to the face edge); derivatives are
 * taken outside the face test so they stay in uniform control flow.
 */
export const BORDER_NORMAL = /* glsl */ `
#ifdef DICER_BORDER
	{
		vec3 dcBp0 = dFdx( - vViewPosition );
		vec3 dcBp1 = dFdy( - vViewPosition );
		float dcBe0 = dFdx( vEdgeDist );
		float dcBe1 = dFdy( vEdgeDist );
		vec3 dcBr1 = cross( dcBp1, normal );
		vec3 dcBr2 = cross( normal, dcBp0 );
		float dcBdet = dot( dcBp0, dcBr1 );
		vec3 dcBg = ( dcBr1 * dcBe0 + dcBr2 * dcBe1 ) * ( dcBdet < 0.0 ? - 1.0 : 1.0 );
		float dcBgl = length( dcBg );
		float dcBorderSlope = vFaceId > - 0.5 ? dcBorderDH( vEdgeDist ) : 0.0;
		if ( dcBgl > 0.0 ) normal = normalize( normal - dcBorderSlope * dcBg / dcBgl );
	}
#endif
`;

/** Fragment shader: after `#include <emissivemap_fragment>`. Glow masked to the number fill. */
export const GLOW_EMISSIVE = /* glsl */ `
#ifdef DICER_GLOW
	totalEmissiveRadiance += uGlowColor * uGlowIntensity * dcMask;
#endif
`;

/**
 * Die fx uniform block (trigger effects, Plan 4), injected only when flags.effects (program key
 * fx1). Both default to zero, so a die with no running effect looks unchanged.
 * uFxTint: rgb target, a its share; leans the body (not the numbers) towards the colour, plus
 * a quarter of it as emission so the shift reads on metal and resin too (whose look does not
 * come from diffuseColor). uFxFlare: colour x strength, added to the numbers' emission.
 */
export const FX_PARS = /* glsl */ `
uniform vec4 uFxTint;
uniform vec3 uFxFlare;
`;
/** Fragment shader: after the colour chunks (dcMask is set). */
export const FX_COLOR = /* glsl */ `
	diffuseColor.rgb = mix( diffuseColor.rgb, uFxTint.rgb, uFxTint.a * ( 1.0 - dcMask ) );
`;
/** Fragment shader: after `#include <emissivemap_fragment>`. */
export const FX_EMISSIVE = /* glsl */ `
	totalEmissiveRadiance += uFxFlare * dcMask + uFxTint.rgb * ( 0.25 * uFxTint.a * ( 1.0 - dcMask ) );
`;

/**
 * Fragment shader: after `#include <transmission_fragment>` (empty: resin has transmission 0),
 * i.e. after totalDiffuse/totalSpecular and before outgoingLight, so the reflection
 * (totalSpecular, sheen, clearcoat Fresnel) stays on top.
 *
 * P2-R6 environment refraction, in die-local space (vLocalPos, vLocalCam):
 * - the view ray refracts into the body at the shaded normal (ior ${RESIN.ior});
 * - it crosses the body ellipsoid (uResinRadii: a radius-${RESIN.radius} sphere, flattened on the
 *   coin) to the far side, where a Fresnel share (all of it on total internal reflection)
 *   reflects back up through the body (a second chord) and the rest refracts out at the
 *   ellipsoid normal;
 * - both directions, back in world space, sample scene.environment (the PMREM envMap) with
 *   textureCubeUV at the body roughness (the internal reflection one step rougher).
 *   Directions below the horizon see the surface the die rests on: a lit table of albedo
 *   uResinFloor under the up-facing environment (the studio's own lower hemisphere is a black
 *   backdrop, which would make every clear die read black over any scene);
 * - Beer-Lambert colour per path: bodyColour^(uResinDensity * chord / ${RESIN.refChord}), so a
 *   full diameter transmits exactly the body colour.
 * - the refracted light (interior included) is scaled by 1 - F_schlick at entry.
 * The number fill (dcMask) stays opaque.
 */
export const RESIN_REFRACTION = /* glsl */ `
#ifdef DICER_RESIN
	vec3 dcRefracted = vec3( 0.0 );
	{
		mat3 dcRm = mat3( modelMatrix ); // rotation x uniform scale
		vec3 dcRi = normalize( vLocalPos - vLocalCam );
		vec3 dcRn = normalize( transpose( dcRm ) * inverseTransformDirection( normal, viewMatrix ) );
		// entry Fresnel: the share reflected at the surface (drawn by the specular/clearcoat
		// lobes) never enters, so the refracted light is scaled by 1 - F
		float dcRFin = ${f(RESIN_F0)} + ${f(1 - RESIN_F0)} * pow( 1.0 - clamp( dot( dcRn, - dcRi ), 0.0, 1.0 ), 5.0 );
		vec3 dcRd = refract( dcRi, dcRn, ${f(1 / RESIN.ior)} );
		if ( dot( dcRd, dcRd ) < 1e-6 ) dcRd = dcRi;
		// chord 1: entry to the far side of the body ellipsoid
		vec3 dcRrad;
		float dcRt1 = dcChord( vLocalPos, dcRd, dcRrad );
		vec3 dcRp = vLocalPos + dcRd * dcRt1;
		// Exit normal: dice other than the d4 have parallel opposite faces, so the far side is
		// mostly the entry face mirrored (-dcRn); the ellipsoid normal keeps some lensing.
		vec3 dcRne = normalize( mix( dcRp / ( dcRrad * dcRrad ), - dcRn, ${f(RESIN.parallel)} ) );
		vec3 dcRout = refract( dcRd, - dcRne, ${f(RESIN.ior)} );
		float dcRtir = dot( dcRout, dcRout ) < 1e-6 ? 1.0 : 0.0;
		// clamped: rounding can push |cos| past 1, and pow() of a negative base is NaN
		float dcRcos = clamp( abs( dot( dcRout, dcRne ) ), 0.0, 1.0 );
		float dcRF = mix( 0.04 + 0.96 * pow( 1.0 - dcRcos, 5.0 ), 1.0, dcRtir );
		// chord 2: the internal reflection back through the body
		vec3 dcRr = reflect( dcRd, - dcRne );
		float dcRt2 = dcChord( dcRp, dcRr, dcRrad );
		vec3 dcRwOut = normalize( dcRm * ( dcRtir > 0.5 ? dcRr : dcRout ) );
		vec3 dcRwRefl = normalize( dcRm * dcRr );
		// up-facing environment irradiance: the lit table below, and the interior's inner light
		vec3 dcRup = vec3( 0.5 );
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		dcRup = textureCubeUV( envMap, envMapRotation * vec3( 0.0, 1.0, 0.0 ), 1.0 ).rgb;
		vec3 dcRfloor = uResinFloor * dcRup;
		vec3 dcRe1 = textureCubeUV( envMap, envMapRotation * dcRwOut, material.roughness ).rgb;
		vec3 dcRe2 = textureCubeUV( envMap, envMapRotation * dcRwRefl, min( material.roughness + 0.25, 1.0 ) ).rgb;
		dcRe1 = mix( dcRe1, dcRfloor, smoothstep( 0.1, - 0.5, dcRwOut.y ) );
		dcRe2 = mix( dcRe2, dcRfloor, smoothstep( 0.1, - 0.5, dcRwRefl.y ) );
		dcRe1 *= envMapIntensity;
		dcRe2 *= envMapIntensity;
	#else
		vec3 dcRe1 = vec3( 0.5 ); // no environment yet: a neutral grey stand-in
		vec3 dcRe2 = vec3( 0.5 );
	#endif
		// uResinTint: the low-tier interior fake (Task 6) leans the body colour towards the interior
		vec3 dcRbody = max( mix( diffuse, uResinTint.rgb, uResinTint.a ), vec3( 1e-3 ) );
		float dcRk = uResinDensity / ${f(RESIN.refChord)};
		dcRefracted = ( 1.0 - dcRF ) * dcRe1 * pow( dcRbody, vec3( dcRk * dcRt1 ) )
			+ dcRF * dcRe2 * pow( dcRbody, vec3( dcRk * ( dcRt1 + dcRt2 ) ) );
${INTERIOR_HOOK}
		dcRefracted *= 1.0 - dcRFin;
	}
	// The ink rim (engrave.js) darkens the refracted body around each number, so a bright inside
	// (a glowing liquid) cannot wash the numbers out.
	totalDiffuse = mix( totalDiffuse, dcRefracted * ( 1.0 - ${RIM_DARK.toFixed(2)} * dcRim ), 1.0 - dcMask );
#endif
`;

/**
 * The fragment chunks a program needs, by body type and metal finish (the define-gated GLSL
 * is only injected where its define can be set, so the body chunks only bring dcFbm3 in for
 * marble and antique metal; a marched resin interior adds the noise library itself, through
 * interiorChunk).
 */
export function bodyChunks(body, finish) {
  const metal = body === 'metal';
  const marble = body === 'marble';
  const brushed = metal && finish === 'brushed';
  const antique = metal && finish === 'antique';
  return {
    pars: [BODY_PARS, marble || antique ? NOISE_GLSL : '', brushed ? BRUSH_PARS : ''].join('\n'),
    colorPre: [
      marble ? MARBLE_COLOR : '',
      body === 'pearl' ? PEARL_COLOR : '',
      brushed ? BRUSHED_COLOR : '',
    ].join('\n'),
    colorPost: antique ? ANTIQUE_COLOR : '',
    roughness: [
      brushed || antique ? BODY_ROUGHNESS : '',
      body === 'resin' || body === 'pearl' ? BEVEL_ROUGHNESS : '',
    ].join('\n'),
    tangent: brushed ? BRUSHED_TANGENT : '',
    normal: metal ? BORDER_NORMAL : '',
    emissive: GLOW_EMISSIVE,
    coat: body === 'resin' || body === 'pearl' ? BEVEL_COAT : '',
    lighting: body === 'resin' ? RESIN_REFRACTION : '',
  };
}

/** The body/finish defines for an appearance (they follow programKey). */
export function bodyDefines(a, flags) {
  const d = {};
  const body = a.body.type;
  if (body === 'resin') d.DICER_RESIN = '';
  if (body === 'marble') d.DICER_MARBLE = '';
  if (body === 'pearl') d.DICER_PEARL = '';
  if (body === 'metal') {
    d.DICER_BORDER = '';
    if (a.body.finish === 'brushed') d.DICER_BRUSHED = '';
    if (a.body.finish === 'antique') d.DICER_ANTIQUE = '';
  }
  if (flags.glow && a.glow.intensity > 0) d.DICER_GLOW = '';
  return d;
}
