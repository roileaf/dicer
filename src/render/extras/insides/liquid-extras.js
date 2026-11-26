/**
 * Liquid with an air bubble and / or settled sand. Plain liquid is drawn by shaders/interior.js
 * (world start) and never patched; with bubble or sand set, this module draws the whole interior:
 * today's liquid core (LIQUID's maths, copied here so world start is untouched) plus:
 *
 * - bubble: one air bubble of radius LQ.bubbleRadius at the top of the volume along dcIUp (the
 *   die's current world up, set before the march loop), just inside the march sphere, so it
 *   floats up whatever face the die rests on. It sits a little to the side of the top (as a
 *   bubble under a flat face does), so the top face's number does not hide it. It is tested exactly against each march segment
 *   (ray / sphere, like the eye), so it is found once whatever the step count; rays that pass
 *   within DC_LQ_AA of it get partial coverage at their closest approach (a soft, unjittered
 *   edge). The air holds no liquid: the segment's liquid length loses the chord inside the bubble,
 *   so its middle is clear. Its surface is a mirror ring where the view meets it beyond the
 *   critical angle (liquid to air), brighter where it mirrors the sky above, with a thin darker
 *   outline, a sharp key-light highlight and a softer catchlight from above. The bubble displaces
 *   the core: the core's radius shrinks near it.
 * - sand: a settled layer at the bottom along -dcIUp, filling the march sphere up to LQ.sandTop
 *   (about 22% of its height), with a flat top. The top plane is tested exactly against each
 *   segment; a segment that starts in the sand (where the ray enters the sphere below the plane)
 *   shows the bowl's side. It is opaque, so it ends the march. Fine hashed grains in a warm sand
 *   tone tinted 25% towards colors[1] (sand whatever the liquid's colours), each its own shade (a few dark and a few pale ones), faintly mottled, lit
 *   per grain and darker deeper down; a few grains glint in the key light.
 *
 * The options are #defines (DC_LQ_BUBBLE, DC_LQ_SAND): each combination is its own program (the
 * programKey's liquid+b / +s / +bs part).
 */
import { LIQUID_CORE } from './living.js';

export const USES_NOISE = true; // dcNoise3, dcHash13

/**
 * The march sphere radius (shaders/interior.js INTERIOR.radius; a local copy, pinned by a test:
 * importing INTERIOR would add a world-start export).
 */
const RADIUS = 0.62;

const BUBBLE_RADIUS = 0.09;
const BUBBLE_OFFSET = 0.2;
/** the bubble's centre this far from the march sphere's centre: its top 0.035 inside the sphere */
const BUBBLE_REACH = RADIUS - BUBBLE_RADIUS - 0.035;

/**
 * Bubble radius, its centre's height along up and offset to the side (along `bubbleRef`, a
 * die-local axis projected off up), sand top along up (canonical frame).
 */
export const LQ = Object.freeze({
  radius: RADIUS,
  bubbleRadius: BUBBLE_RADIUS,
  bubbleHeight: Math.sqrt(BUBBLE_REACH ** 2 - BUBBLE_OFFSET ** 2),
  bubbleOffset: BUBBLE_OFFSET,
  bubbleRef: Object.freeze([0.83, 0.21, 0.52].map((x) => x / Math.hypot(0.83, 0.21, 0.52))),
  sandTop: -RADIUS + 0.22 * 2 * RADIUS,
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_LQ_BR ${f(LQ.bubbleRadius)}
#define DC_LQ_BH ${f(LQ.bubbleHeight)}
#define DC_LQ_BO ${f(LQ.bubbleOffset)}
#define DC_LQ_REF vec3( ${LQ.bubbleRef.map(f).join(', ')} )
#define DC_LQ_ST ${f(LQ.sandTop)}
#define DC_LQ_AA 0.008
// today's liquid core (shaders/interior.js LIQUID) over length dt; dent shrinks the core
vec4 dcLqLiquid( vec3 p, float dt, float dent ) {
	float r = length( p );
	float wave = dcNoise3( p * 4.0 + 1.7 ) * 0.65 + dcNoise3( p * 9.0 - 3.1 ) * 0.35;
	float coreR = mix( 0.16, 0.42, uInteriorDensity ) + 0.10 * ( wave - 0.5 );
	coreR -= dent;
	float core = 1.0 - smoothstep( coreR - 0.025, coreR + 0.025, r );
	// fake core normal (radial) for a soft lit side, plus a bright rim at the boundary
	float lit = 0.55 + 0.45 * max( dot( p / max( r, 1e-4 ), dcIKey ), 0.0 );
	vec3 coreCol = uInteriorColors[ 0 ] * ( dcILight * lit + 0.35 );
	vec3 hazeCol = uInteriorColors[ 1 ] * ( dcILight + 0.25 );
	float a = dcIAlpha( core * 60.0 + 1.6 * dcIEdge( p ), dt );
	return vec4( min( mix( hazeCol, coreCol, core ), vec3( 1.0 ) ) * a, a );
}
// the bubble's front surface if the segment meets it (o: segment start from the bubble's centre;
// b = dot( o, rd ), oo = dot( o, o ), m2: the squared distance from the centre to the ray)
// th: the distance along the segment to the hit (dt where there is none)
vec4 dcLqBubble( vec3 o, vec3 rd, float dt, float b, float oo, float m2, out float th ) {
	th = dt;
	float m = sqrt( m2 );
	if ( m >= DC_LQ_BR + DC_LQ_AA || oo < DC_LQ_BR * DC_LQ_BR ) return vec4( 0.0 );
	float t0 = m < DC_LQ_BR ? - b - sqrt( DC_LQ_BR * DC_LQ_BR - m2 ) : - b;
	if ( t0 < 0.0 || t0 >= dt ) return vec4( 0.0 );
	th = t0;
	float cover = 1.0 - smoothstep( DC_LQ_BR - DC_LQ_AA, DC_LQ_BR + DC_LQ_AA, m );
	vec3 n = ( o + rd * th ) / max( length( o + rd * th ), 1e-4 );
	float cv = abs( dot( n, rd ) );
	// total internal reflection beyond the critical angle: a mirror ring round a clear middle. It
	// mirrors the bright sky above in its upper part and the darker depths below in its lower
	// part, with a thin dark outline at the silhouette, so it reads against a pale liquid
	float ring = 1.0 - smoothstep( 0.6, 0.74, cv );
	float outline = 1.0 - smoothstep( 0.04, 0.3, cv );
	vec3 r = reflect( rd, n );
	vec3 sky = mix( uInteriorColors[ 1 ], vec3( 1.0 ), 0.75 ) * ( dcILight + 0.4 );
	vec3 deep = uInteriorColors[ 0 ] * 0.3 * ( dcILight + 0.2 );
	vec3 refl = mix( deep, sky, smoothstep( - 0.35, 0.6, dot( r, dcIUp ) ) );
	refl = mix( refl, deep * 0.5, 0.7 * outline );
	float spec = 3.0 * pow( max( dot( r, dcIKey ), 0.0 ), 90.0 )
		+ 0.9 * pow( max( dot( r, normalize( dcIUp + 0.4 * dcIKey ) ), 0.0 ), 40.0 );
	float a = 0.9 * ring;
	vec3 rad = refl * a + sky * 0.08 * ( 1.0 - ring ) + vec3( spec );
	return vec4( min( rad, vec3( 1.0 ) ) * cover, min( a + spec, 1.0 ) * cover );
}
// the sand at x: the flat top (top) or the bowl's side; opaque
vec4 dcLqSand( vec3 x, vec3 rd, bool top ) {
	vec3 cell = floor( x * 130.0 );
	float g = dcHash13( cell );
	float g2 = dcHash13( cell + 7.7 );
	// a warm sand tone tinted a little towards colors[1]: sand whatever the liquid's colours
	vec3 base = mix( vec3( 0.78, 0.66, 0.46 ), uInteriorColors[ 1 ], 0.25 );
	// grain to grain: each its own shade, a few dark and a few pale grains, faint mottling
	vec3 col = base * ( 0.7 + 0.45 * g );
	col = mix( col, base * 0.45, step( 0.88, g2 ) );
	col = mix( col, min( base * 1.35 + 0.08, vec3( 1.0 ) ), step( g2, 0.06 ) );
	col *= 0.85 + 0.3 * dcNoise3( x * 12.0 + 4.0 );
	vec3 n = top ? normalize( dcIUp + 0.6 * ( vec3( g, g2, dcHash13( cell + 3.3 ) ) - 0.5 ) )
		: x / max( length( x ), 1e-4 );
	float kd = clamp( ( dot( n, dcIKey ) + 0.3 ) / 1.3, 0.0, 1.0 );
	float depth = smoothstep( - ${f(RADIUS)}, DC_LQ_ST, dot( x, dcIUp ) );
	vec3 rad = col * ( dcILight * ( 0.35 + 0.65 * kd ) * mix( 0.5, 1.0, depth ) + 0.08 );
	rad += vec3( 0.7 ) * step( 0.97, g ) * pow( max( dot( reflect( rd, n ), dcIKey ), 0.0 ), 12.0 );
	return vec4( min( rad, vec3( 1.0 ) ), 1.0 );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float len = dt; // the segment's length in the liquid (no bubble hit)
	float lim = dt; // where the liquid ends (the sand's top)
	float dent = 0.0;
	float la = dt; // with a bubble hit: the liquid runs 0 .. la, the bubble, then lb .. lim
	float lb = dt;
	bool split = false;
	vec4 front = vec4( 0.0 ); // the bubble's surface
	vec4 back = vec4( 0.0 ); // the sand, behind it
#ifdef DC_LQ_BUBBLE
	// the bubble's centre: up, and a little to the side (along a die-local axis projected off up;
	// a fallback axis where that axis is up), so the top face's number does not hide it
	vec3 dcLqBt = DC_LQ_REF - dot( DC_LQ_REF, dcIUp ) * dcIUp;
	if ( dot( dcLqBt, dcLqBt ) < 1e-6 ) dcLqBt = DC_LQ_REF.zxy - dot( DC_LQ_REF.zxy, dcIUp ) * dcIUp;
	dcLqBt = normalize( dcLqBt );
	vec3 dcLqBc = dcIUp * DC_LQ_BH + dcLqBt * DC_LQ_BO;
	vec3 o = p - dcLqBc;
	float b = dot( o, rd );
	float oo = dot( o, o );
	float m2 = max( oo - b * b, 0.0 );
	dent = 0.14 * ( 1.0 - smoothstep( DC_LQ_BR, DC_LQ_BR + 0.18, sqrt( oo ) ) );
	front = dcLqBubble( o, rd, dt, b, oo, m2, la );
	if ( front.a > 0.0 ) {
		// the bubble is hit at la: liquid before it, the bubble, then the liquid beyond its far side
		split = true;
		lb = clamp( - b + sqrt( max( DC_LQ_BR * DC_LQ_BR - m2, 0.0 ) ), la, dt );
	} else if ( m2 < DC_LQ_BR * DC_LQ_BR ) {
		float hc = sqrt( DC_LQ_BR * DC_LQ_BR - m2 );
		len -= max( min( - b + hc, dt ) - max( - b - hc, 0.0 ), 0.0 ); // no liquid in the air
	}
#endif
#ifdef DC_LQ_SAND
	float hp = dot( p, dcIUp );
	float he = hp + dot( rd, dcIUp ) * dt;
	if ( hp <= DC_LQ_ST ) return front + ( 1.0 - front.a ) * dcLqSand( p, rd, false );
	if ( he < DC_LQ_ST ) {
		float ts = dt * ( hp - DC_LQ_ST ) / ( hp - he ); // hp > DC_LQ_ST > he: no division by 0
		len = min( len, ts );
		lim = min( lim, ts );
		back = dcLqSand( p + rd * ts, rd, true );
	}
#endif
	vec4 acc;
	if ( split && la < lim ) { // (a bubble beyond the sand's top is hidden by the sand)
		acc = dcLqLiquid( p, min( la, lim ), dent );
		acc += ( 1.0 - acc.a ) * front;
		acc += ( 1.0 - acc.a ) * dcLqLiquid( p + rd * lb, max( lim - lb, 0.0 ), dent );
	} else {
		acc = dcLqLiquid( p, max( len, 0.0 ), dent );
	}
	return acc + ( 1.0 - acc.a ) * back;
}
`;

const CORE_FROM = 'vec4 dcLqLiquid(';
const CORE_TO = 'vec4 dcLqBubble(';

/**
 * The body with insideMotion: every dcIUp is the lagged up, and the still core (dcLqLiquid) is
 * swapped for the living liquid's (living.js LIQUID_CORE, dcLvLiquid: sloshing surface, drifting
 * waves) rather than a copy of it. The core takes the same dent from the bubble.
 */
function liveBody() {
  const body = BODY.replaceAll('dcIUp', 'uInteriorLag');
  const from = body.indexOf(CORE_FROM);
  const to = body.indexOf(CORE_TO);
  if (from < 0 || to < from) throw new Error('dicer: liquid core anchors missing');
  return (body.slice(0, from) + LIQUID_CORE.trim() + '\n' + body.slice(to)).replaceAll('dcLqLiquid(', 'dcLvLiquid(');
}

/**
 * @param {boolean} [live] insideMotion: the bubble and the sand follow the lagged up
 *   (uInteriorLag, MOTION_PARS in the pars) instead of dcIUp, so they trail the die's turns and
 *   settle like the liquid's surface, and the core is the living liquid's (living.js)
 * @returns {{ body: string }} the liquid GLSL with the look's options as defines (every colour
 * and the density are uniforms)
 */
export function liquidExtrasInside(a, live = false) {
  const i = a.interior;
  const defs = [i.bubble ? '#define DC_LQ_BUBBLE' : '', i.sand ? '#define DC_LQ_SAND' : ''].filter(Boolean);
  return { body: [...defs, live ? liveBody() : BODY].join('\n') };
}
