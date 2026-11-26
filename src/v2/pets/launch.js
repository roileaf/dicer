import { readPet } from '../../pet/pet-for.js';
import { spotOf, stableIndex } from './pets.js';

const MODULE = 'dicer';
const DSN = 'dice-so-nice';
export const REACH = 0.15;

export function launchFrom(spot, reach = REACH) {
  const dx = 0.5 - spot.x;
  const dy = 0.5 - spot.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: spot.x + (dx / length) * reach, y: spot.y + (dy / length) * reach };
}

export function petLaunch({ user, users, getSetting }) {
  if (!user || getSetting('petsAllowed') === false) return null;
  if (readPet(user).kind === 'none') return null;
  return { from: launchFrom(spotOf(user, stableIndex(user, users))) };
}

export function onPreCreateMessage(
  message,
  {
    user = globalThis.game?.user,
    users = globalThis.game?.users ?? [],
    getSetting = (key) => globalThis.game.settings.get(MODULE, key),
  } = {},
) {
  if (!message?.isRoll || message.flags?.[DSN]?.launch) return;
  let launch = null;
  try {
    launch = petLaunch({ user, users, getSetting });
  } catch {
    launch = null;
  }
  if (launch) message.updateSource({ [`flags.${DSN}.launch`]: launch });
}

export function registerLaunch(hooks = globalThis.Hooks) {
  hooks.on('preCreateChatMessage', (message) => void onPreCreateMessage(message));
}
