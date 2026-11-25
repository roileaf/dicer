// Dicer v2, step 2: Dicer's studio lighting as a Dice So Nice environment (DsN note 5.3).
// v1 renders its procedural studio through PMREM at run time; DsN takes an equirectangular
// .hdr file, baked once by scripts/bake-studio-hdr.mjs from the same scene.
import { MODULE_ID } from './sounds/register.js';

export const STUDIO_ENVIRONMENT = Object.freeze({
  id: `${MODULE_ID}.studio`,
  name: 'DICER.V2.Ambiance.studio',
  src: `modules/${MODULE_ID}/assets/lighting/dicer-studio.hdr`,
});

/**
 * Adds the studio to the players' Ambiance list. DsN loads the player's environment right
 * after diceSoNiceReady returns: call it in the hook, before any await.
 */
export function registerLighting(dice3d) {
  dice3d.addEnvironment({ ...STUDIO_ENVIRONMENT });
  return STUDIO_ENVIRONMENT.id;
}
