import { DiceMaterial, DiceSFX, TabletopObject } from 'dice-so-nice/api.js';
import { registerEffectHooks, registerEffects } from './effects/classes.js';
import { registerReactions } from './effects/reactions.js';
import { registerLighting } from './lighting.js';
import { registerBodies } from './materials/bodies.js';
import { registerInsideMotion, registerResin } from './materials/resin.js';
import { registerLaunch } from './pets/launch.js';
import { registerPets } from './pets/pets.js';
import { openPetWindow, registerPetWindow } from './pets/window.js';
import { registerQuality } from './quality/controller.js';
import { registerSounds } from './sounds/register.js';
import { openThemeBrowser, registerThemeBrowser } from './themes/browser.js';

export const DSN_ID = 'dice-so-nice';
const MODULE = 'dicer';

export function onDiceSoNiceReady(dice3d) {
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
  try {
    registerBodies(dice3d, DiceMaterial);
    registerResin(dice3d, DiceMaterial);
  } catch (err) {
    console.error('dicer: cannot register the body materials', err);
  }
  try {
    registerEffects(dice3d, DiceSFX);
  } catch (err) {
    console.error('dicer: cannot register the effects', err);
  }
}

Hooks.once('diceSoNiceReady', (dice3d) => {
  onDiceSoNiceReady(dice3d);
});

registerInsideMotion();
registerEffectHooks();
registerQuality();
const pets = registerPets(TabletopObject);
registerLaunch();
const reactions = registerReactions();

Hooks.once('init', () => {
  registerThemeBrowser();
  registerPetWindow();
  const module = game.modules.get(MODULE);
  if (module)
    module.api = {
      openThemes: openThemeBrowser,
      playEffect: reactions.play,
      openPet: openPetWindow,
      pets,
    };
});

Hooks.once('ready', () => {
  if (game.modules.get(DSN_ID)?.active) return;
  if (game.user?.isGM)
    ui.notifications.error(game.i18n.localize('DICER.V2.NeedsDsn'), { permanent: true });
});
