// Dicer v2, step 1: Dicer's impact sounds as Dice So Nice sound sets (DsN note 5.2).
// The sprites are Dicer's recordings, coloured per material and per surface ahead of time
// (scripts/build-dsn-sounds.mjs): DsN plays files as they are.
import { SOUND_SPRITES } from './manifest.js';

export const MODULE_ID = 'dicer';

/** The id of the sound set of a sound material ('plastic', 'metal'...), for setImpactSounds. */
export const diceSoundSetId = (material) => `${MODULE_ID}.dice-${material}`;
/** The id of the table sound set of a surface ('felt', 'wood'...). */
export const tableSoundSetId = (surface) => `${MODULE_ID}.table-${surface}`;
/** The id of a surface in the players' Table surface list. */
export const surfaceId = (surface) => `${MODULE_ID}.${surface}`;

/** DsN sounds ({ src, start, end }) of one sprite. */
export function spriteSounds({ file, hits }, route = (p) => p) {
  const src = route(`modules/${MODULE_ID}/${file}`);
  return hits.map(({ start, end }) => ({ src, start, end }));
}

/**
 * Registers a dice sound set per sound material, and a table sound set plus a surface per
 * table surface. Call from diceSoNiceReady. Returns the registered ids.
 */
export function registerSounds(dice3d, { route, sprites = SOUND_SPRITES } = {}) {
  const ids = { dice: {}, table: {}, surfaces: {} };
  for (const [material, sprite] of Object.entries(sprites.dice)) {
    const id = diceSoundSetId(material);
    dice3d.addImpactSounds({ id, dice: spriteSounds(sprite, route) });
    ids.dice[material] = id;
  }
  for (const [surface, sprite] of Object.entries(sprites.table)) {
    const id = tableSoundSetId(surface);
    dice3d.addImpactSounds({ id, table: spriteSounds(sprite, route) });
    dice3d.addSurface({ id: surfaceId(surface), name: `DICER.V2.Surface.${surface}`, sounds: id });
    ids.table[surface] = id;
    ids.surfaces[surface] = surfaceId(surface);
  }
  return ids;
}
