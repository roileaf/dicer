import { dieTypeForFaces, dsnTypeOf } from '../core/dice-shapes.js';
import { FATE_FACES } from '../compat/faces.js';

/**
 * @typedef {{kind:'glyph', text:string}|{kind:'text', text:string}|{kind:'image', url:string}|{kind:'blank'}} FaceLabel
 * @typedef {{ key: string, labels: FaceLabel[] }} FaceSet indexed like getShape(type).values
 * @typedef {{ type: string, value: number, variant?: 'd100tens'|'dF'|'dc'|'d3'|'d5'|'d7', appearance?: object,
 *   faces?: FaceSet, ghost?: boolean, model?: string,
 *   fx?: import('../effects/fx-resolver.js').Fx[], damageType?: string, trail?: 0|1|2, petVolume?: number,
 *   key?: string, free?: true, shapeType?: string }} DieSpec
 *   `fx` and `damageType` are result-dependent: set only for real views (never on a ghost).
 *   `key` is 'term:result:part' (planThrow). `free`: physics decides the face (never forced).
 *   `shapeType` forces the geometry (a replay draws the recorded shape whatever this viewer's look).
 */

/** The die a dN without its own shape is thrown on: face v or v + N shows v (labelFor). */
const RELABEL = { 3: 'd6', 5: 'd10', 7: 'd14' };
/** Fate result -1 / 0 / +1 -> d6 face, [even, odd] result index (FATE_FACES: 1, 2 +; 3, 4 blank; 5, 6 -). */
const FATE = [[6, 5], [3, 4], [1, 2]];

/** Foundry's Coin (DENOMINATION 'c'), or any 2-faced term whose lowest result is 0. */
const isCoin = (term) => dsnTypeOf(term) === 'dc' || (term?.faces === 2 && term.minValue === 0);

/**
 * The dice one result throws: a d100 is a tens d10 plus a ones d10. `odd` is the result's index
 * in its term mod 2: a relabelled die picks between its two faces by it, never by chance, so
 * every client and ghost shows the same face.
 */
function diceFor(term, r, shape, odd) {
  const faces = term.faces;
  // Before shapeFor: a DSN preset aliases df onto the d6, whose faces cannot show -1 or 0.
  if (dsnTypeOf(term) === 'df') {
    const value = FATE[r + 1]?.[odd];
    return value ? [{ type: 'd6', value, variant: 'dF', faces: FATE_FACES }] : null;
  }
  // Foundry's Coin rolls 0 (tails) or 1 (heads): the d2 shows face 2 or 1, so the result survives.
  // A preset may alias it onto another shape: faces 1 and 2 exist on every die.
  if (isCoin(term)) {
    return r === 0 || r === 1 ? [{ type: shape || 'd2', value: r === 0 ? 2 : 1, variant: 'dc' }] : null;
  }
  if (shape) return [{ type: shape, value: r }];
  if (faces === 100) {
    return [
      { type: 'd10', value: Math.floor((r % 100) / 10) * 10, variant: 'd100tens' },
      { type: 'd10', value: r % 10 || 10 },
    ];
  }
  // A result off 1..n (a Fate die sent as a plain Die by a legacy show()) has no face: skipped.
  if (RELABEL[faces]) {
    return r >= 1 && r <= faces ? [{ type: RELABEL[faces], value: r + odd * faces, variant: `d${faces}` }] : null;
  }
  const type = dieTypeForFaces(faces);
  return type ? [{ type, value: r }] : null;
}

/**
 * Turns a Foundry Roll into the dice to throw. Hidden results are not thrown; unsupported
 * faces and dice beyond maxDice are counted in `skipped`. With showExtra false, discarded and
 * inactive results are not thrown (and not counted). `decorate(term, result, termIndex)` returns
 * a partial DieSpec merged into every die of that result (both dice of a d100); type, value and
 * variant are never overwritten, and a throwing decorate warns once and leaves the die as is.
 * `shapeFor(term)` returns a base die type (or null) and is consulted before the face count.
 * A Fate die (dsnTypeOf 'df') and a d3 / d5 / d7 are thrown as relabelled d6 / d6 / d10 / d14.
 * @returns {{ dice: DieSpec[], skipped: number }}
 */
export function planThrow(roll, { maxDice = 20, showExtra = true, decorate, shapeFor } = {}) {
  const dice = [];
  let skipped = 0;
  let warned = false;
  const decorateSafely = (term, res, termIndex) => {
    try {
      return decorate(term, res, termIndex);
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn('dicer: a die decorator threw; the die is shown undecorated', err);
      }
      return null;
    }
  };
  const shapeOf = (term) => {
    try {
      return shapeFor?.(term) || null;
    } catch {
      return null;
    }
  };
  (roll?.dice ?? []).forEach((term, termIndex) => {
    (term.results ?? []).forEach((res, i) => {
      if (res.hidden) return;
      if (!showExtra && (res.discarded === true || res.active === false)) return;
      let out = diceFor(term, res.result, shapeOf(term), i & 1);
      const extra = out && decorate ? decorateSafely(term, res, termIndex) : null;
      if (out && extra) {
        const d100 = out.length === 2;
        out = out.map((d, p) => {
          const merged = { ...d, ...extra, type: d.type, value: d.value };
          delete merged.onesFaces;
          if (d.variant) merged.variant = d.variant;
          else delete merged.variant;
          // A relabelled die (dF, d3, d5, d7) keeps its own faces: a preset's fit another shape.
          if (d.faces) merged.faces = d.faces;
          else if (d.variant && d.variant !== 'd100tens' && d.variant !== 'dc') delete merged.faces;
          // A d100's ones die: the system's d10 faces (extra.onesFaces), never the tens die's.
          else if (d100 && p === 1) {
            if (extra.onesFaces) merged.faces = extra.onesFaces;
            else delete merged.faces;
          }
          return merged;
        });
      }
      // The die's place in the roll (term, result, part: a d100's ones die is part 1), last so a
      // decorator cannot change it: a replay matches its recorded dice by it.
      out?.forEach((d, p) => (d.key = `${termIndex}:${i}:${p}`));
      if (!out) skipped += 1;
      else if (dice.length + out.length > maxDice) skipped += out.length;
      else dice.push(...out);
    });
  });
  return { dice, skipped };
}
