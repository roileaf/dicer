// Dicer v2: Dicer as an add-on of Dice So Nice. DsN is the dice engine (physics, rendering,
// impact sounds, chat messages, game.dice3d); Dicer brings its looks, effects, sounds, pets and
// tools on top of it, each feature on the DsN API made for it. v1's entry (src/main.js) stays in
// the tree, unbuilt, while its features are ported one at a time.
import { DiceMaterial } from 'dice-so-nice/api.js';
import { registerLighting } from './lighting.js';
import { registerBodies } from './materials/bodies.js';
import { registerInsideMotion, registerResin } from './materials/resin.js';
import { registerSounds } from './sounds/register.js';

export const DSN_ID = 'dice-so-nice';

/** Everything Dicer registers in Dice So Nice. DsN fires the hook with Hooks.call: return nothing. */
export function onDiceSoNiceReady(dice3d) {
  // first, and synchronously: DsN loads the player's environment right after this hook
  try {
    registerLighting(dice3d);
  } catch (err) {
    console.error('dicer: cannot register the studio lighting', err);
  }
  try {
    registerSounds(dice3d);
  } catch (err) {
    console.error('dicer: cannot register the impact sounds', err);
  }
  // after the sounds: each material names its set of impact sounds
  try {
    registerBodies(dice3d, DiceMaterial);
    registerResin(dice3d, DiceMaterial);
  } catch (err) {
    console.error('dicer: cannot register the body materials', err);
  }
}

Hooks.once('diceSoNiceReady', (dice3d) => {
  onDiceSoNiceReady(dice3d);
});

// the living insides follow each die through DsN's dice events
registerInsideMotion();

Hooks.once('ready', () => {
  if (game.modules.get(DSN_ID)?.active) return;
  if (game.user?.isGM)
    ui.notifications.error(game.i18n.localize('DICER.V2.NeedsDsn'), { permanent: true });
});
