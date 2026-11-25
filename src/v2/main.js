// Dicer v2: Dicer as an add-on of Dice So Nice. DsN is the dice engine (physics, rendering,
// impact sounds, chat messages, game.dice3d); Dicer brings its looks, effects, sounds, pets and
// tools on top of it, each feature on the DsN API made for it. v1's entry (src/main.js) stays in
// the tree, unbuilt, while its features are ported one at a time.
import { registerSounds } from './sounds/register.js';

export const DSN_ID = 'dice-so-nice';

/** Everything Dicer registers in Dice So Nice. DsN fires the hook with Hooks.call: return nothing. */
export function onDiceSoNiceReady(dice3d) {
  try {
    registerSounds(dice3d);
  } catch (err) {
    console.error('dicer: cannot register the impact sounds', err);
  }
}

Hooks.once('diceSoNiceReady', (dice3d) => {
  onDiceSoNiceReady(dice3d);
});

Hooks.once('ready', () => {
  if (game.modules.get(DSN_ID)?.active) return;
  if (game.user?.isGM) ui.notifications.error(game.i18n.localize('DICER.V2.NeedsDsn'), { permanent: true });
});
