import { createModelCreature } from '../../pet/chunk/model-pet.js';
import { summarize } from '../../pet/chunk/reaction.js';
import { KIND_FOOTPRINT, PET_HEIGHT } from '../../pet/chunk/resting.js';
import { ENTER_MS, REACT_MS, THROW_MS } from '../../pet/chunk/timeline.js';
import { readPet } from '../../pet/pet-for.js';

const MODULE = 'dicer';
export const MAX_PETS = 4;
const MODEL_FIT = { mimic: 2 };
const COLLIDER_SHARE = 0.75;
const DRAG_PX = 6;
const EDGE = 0.07;
const FAR_EDGE = 0.93;
const REACT_WAIT_MS = 200;
export const ACTION_MS = Object.freeze({
  enter: ENTER_MS,
  throw: THROW_MS,
  react: REACT_MS,
  pet: 900,
  startle: 750,
});
const SPOTS = [
  { x: 0.14, y: 0.8 },
  { x: 0.86, y: 0.8 },
  { x: 0.14, y: 0.2 },
  { x: 0.86, y: 0.2 },
];

export const petObjectId = (userId) => `${MODULE}.pet.${userId}`;
export const modelUrl = (kind) => `modules/${MODULE}/assets/pets/${kind}.glb`;
const clamp = (v) => Math.min(FAR_EDGE, Math.max(EDGE, v));

export function spotOf(user, index = 0) {
  let s = null;
  try {
    s = user?.getFlag?.(MODULE, 'pet')?.spot;
  } catch {
    s = null;
  }
  if (Number.isFinite(s?.x) && Number.isFinite(s?.y)) return { x: clamp(s.x), y: clamp(s.y) };
  return { ...SPOTS[index % SPOTS.length] };
}

export function stableIndex(user, users) {
  const ids = [...users]
    .filter((u) => readPet(u).kind !== 'none')
    .map((u) => u.id)
    .sort();
  return Math.max(0, ids.indexOf(user.id));
}

export const facing = (spot) => Math.atan2(0.5 - spot.x, 0.5 - spot.y);

export function petsToShow({ users, me, getSetting }) {
  if (getSetting('petsAllowed') === false || getSetting('showPets') === false) return [];
  const others = getSetting('showOthersPets') !== false;
  const list = [...users]
    .filter((u) => u.id === me?.id || (others && u.active))
    .filter((u) => readPet(u).kind !== 'none');
  list.sort((a, b) => Number(b.id === me?.id) - Number(a.id === me?.id));
  return list.slice(0, MAX_PETS);
}

export function createPet({
  TabletopObject,
  dice3d,
  user,
  index = 0,
  canMove = false,
  now = () => performance.now(),
  saveSpot = () => {},
  view = globalThis,
  voice = () => {},
}) {
  const { kind, color, natural } = readPet(user);
  const spot = spotOf(user, index);
  const radius = (KIND_FOOTPRINT[kind] ?? 0.8) * COLLIDER_SHARE;
  const object = new TabletopObject(petObjectId(user.id))
    .setModel(modelUrl(kind))
    .setCollider([{ type: 'cylinder', radius, height: PET_HEIGHT }])
    .setPosition(spot)
    .setRotation(facing(spot));
  const EVENT = TabletopObject.OBJECT_EVENT_TYPE;
  const look = { yaw: 0, now: 0 };
  let creature = null;
  let action = null;
  let removed = false;

  function act(phase, reaction = 'plain') {
    const ms = ACTION_MS[phase];
    if (!creature || !ms) return false;
    action = { phase, reaction, t0: now(), ms };
    object.setAnimated(true);
    voice(kind, phase, reaction);
    return true;
  }

  function step() {
    if (!creature) return;
    const t = now();
    look.now = t;
    if (action) {
      const k = (t - action.t0) / action.ms;
      if (k < 1) {
        creature.pose(action.phase, k, action.reaction, look);
        return;
      }
      action = null;
      object.setAnimated(false);
    }
    creature.pose('watch', 0, 'plain', look);
  }

  function onClick() {
    const target = view.window ?? view;
    let from = null;
    let dragged = false;
    const move = (event) => {
      from ??= { x: event.clientX, y: event.clientY };
      if (!dragged && Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_PX) return;
      if (!canMove) return;
      dragged = true;
      const place = dice3d.getAreaPosition?.({ x: event.clientX, y: event.clientY });
      if (!place) return;
      const at = { x: clamp(place.x), y: clamp(place.y) };
      object.setPosition(at).setRotation(facing(at));
      spot.x = at.x;
      spot.y = at.y;
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      if (dragged) saveSpot({ x: spot.x, y: spot.y });
      else act('pet');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up, { once: true });
  }

  object.on(EVENT.FRAME, () => step());
  object.on(EVENT.HIT, ({ delay }) => {
    if (!(delay > 1 / 15) && action?.phase !== 'startle') act('startle');
  });
  object.on(EVENT.CLICK, () => onClick());

  const ready = Promise.resolve(dice3d.addTabletopObject(object))
    .then(() => {
      if (removed || !object.model) return false;
      creature = createModelCreature(object.model, natural ? null : color, {
        kind,
        drawHeight: MODEL_FIT[kind],
      });
      object.setModel(creature.root);
      creature.pose('watch', 0, 'plain', look);
      return true;
    })
    .catch((err) => {
      console.warn(`dicer: the ${kind} pet cannot be shown`, err);
      return false;
    });

  return {
    userId: user.id,
    kind,
    object,
    ready,
    act,
    step,
    get action() {
      return action?.phase ?? null;
    },
    remove() {
      removed = true;
      dice3d.removeTabletopObject(object.id ?? petObjectId(user.id));
      creature?.dispose();
      creature = null;
    },
  };
}

export function createPets({
  TabletopObject,
  getDice3d = () => globalThis.game?.dice3d,
  getUsers = () => globalThis.game?.users ?? [],
  getMe = () => globalThis.game?.user,
  getSetting = (key) => globalThis.game.settings.get(MODULE, key),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  now,
  voices = null,
} = {}) {
  const pets = new Map();
  let rolling = null;

  const read = (key) => {
    try {
      return getSetting(key);
    } catch {
      return undefined;
    }
  };

  function refresh() {
    const dice3d = getDice3d();
    if (!dice3d?.addTabletopObject) return;
    for (const pet of pets.values()) pet.remove();
    pets.clear();
    const me = getMe();
    const users = getUsers();
    petsToShow({ users, me, getSetting: read }).forEach((user) => {
      const index = stableIndex(user, users);
      const canMove = user.id === me?.id || me?.isGM === true;
      const saveSpot = (spot) =>
        Promise.resolve(
          user.setFlag?.(MODULE, 'pet', { ...(user.getFlag?.(MODULE, 'pet') ?? {}), spot }),
        ).catch(() => {});
      pets.set(
        user.id,
        createPet({
          TabletopObject,
          dice3d,
          user,
          index,
          canMove,
          saveSpot,
          voice: (kind, phase, reaction) => void voices?.pet(kind, phase, reaction),
          ...(now && { now }),
        }),
      );
    });
  }

  return {
    get size() {
      return pets.size;
    },
    pet: (userId) => pets.get(userId) ?? null,
    refresh,
    onRollStart(_messageId, context) {
      const id = context?.user?.id ?? context?.user ?? null;
      const pet = pets.get(id);
      rolling = pet ? { pet, dice: [], timer: null } : null;
      pet?.act('throw');
    },
    onResult({ type, result }) {
      if (!rolling) return;
      rolling.dice.push({ type, value: result, ghost: result == null });
      if (rolling.timer) return;
      const roll = rolling;
      roll.timer = setTimer(() => {
        if (rolling === roll) rolling = null;
        roll.pet.act('react', summarize(roll.dice, false));
      }, REACT_WAIT_MS);
    },
    onUserChanged(user, changes) {
      if (changes?.flags?.[MODULE]?.pet !== undefined || changes?.color !== undefined) refresh();
    },
  };
}

export function registerPetSettings(pets, settings = globalThis.game.settings) {
  const toggle = (key, scope) =>
    settings.register(MODULE, key, {
      name: `DICER.Settings.${key}.Name`,
      hint: `DICER.Settings.${key}.Hint`,
      scope,
      config: true,
      type: Boolean,
      default: true,
      onChange: () => void pets.refresh(),
    });
  toggle('petsAllowed', 'world');
  toggle('showPets', 'client');
  toggle('showOthersPets', 'client');
}

export function registerPets(
  TabletopObject,
  hooks = globalThis.Hooks,
  pets = createPets({ TabletopObject }),
) {
  hooks.once('init', () => registerPetSettings(pets));
  hooks.once('diceSoNiceReady', () => void pets.refresh());
  hooks.on(
    'diceSoNiceRollStart',
    (messageId, context) => void pets.onRollStart(messageId, context),
  );
  hooks.on('diceSoNiceDiceResult', (event) => void pets.onResult(event));
  hooks.on('updateUser', (user, changes) => void pets.onUserChanged(user, changes));
  hooks.on('userConnected', () => void pets.refresh());
  return pets;
}
