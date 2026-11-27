import { SOUND_SPRITES } from './manifest.js';

export const MODULE_ID = 'dicer';
export const GROUP = 'Dicer';

export const diceSoundSetId = (material) => `${MODULE_ID}.dice-${material}`;
export const tableSoundSetId = (surface) => `${MODULE_ID}.table-${surface}`;
export const surfaceId = (surface) => `${MODULE_ID}.${surface}`;

export function spriteSounds({ file, hits }, route = (p) => p) {
  const src = route(`modules/${MODULE_ID}/${file}`);
  return hits.map(({ start, end }) => ({ src, start, end }));
}

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
    dice3d.addSurface({
      id: surfaceId(surface),
      name: `DICER.V2.Surface.${surface}`,
      group: GROUP,
      sounds: id,
    });
    ids.table[surface] = id;
    ids.surfaces[surface] = surfaceId(surface);
  }
  return ids;
}
