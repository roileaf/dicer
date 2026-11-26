import { Group, Quaternion, Vector3 } from 'three';
import { elementOf } from '../../effects/element-of.js';
import { ELEMENT_FX } from '../../pet/chunk/element-fx.js';
import { createModelCreature } from '../../pet/chunk/model-pet.js';
import { createMoods } from '../../pet/chunk/moods.js';
import { HUFF_HITS, HUFF_IGNORE_MS, HUFF_WINDOW_MS } from '../../pet/chunk/petting.js';
import { summarize } from '../../pet/chunk/reaction.js';
import { KIND_FOOTPRINT, PET_HEIGHT } from '../../pet/chunk/resting.js';
import { ENTER_MS, EXIT_MS, REACT_MS, REST_HOP_MS, THROW_MS } from '../../pet/chunk/timeline.js';
import { readPet } from '../../pet/pet-for.js';

const MODULE = 'dicer';
export const MAX_PETS = 4;
const MODEL_FIT = { mimic: 2 };
const COLLIDER_SHARE = 0.75;
const DRAG_PX = 6;
const EDGE = 0.07;
const FAR_EDGE = 0.93;
const REACT_WAIT_MS = 200;
export const REACT_REACH = 2;
export const VIEW_TILT = Object.freeze({ top: 0, angled: 0.7, front: 1.15 });
export const STAY_CHOICES = Object.freeze([0, 30, 60, 120, -1]);
export const ACTION_MS = Object.freeze({
  enter: ENTER_MS,
  throw: THROW_MS,
  react: REACT_MS,
  exit: EXIT_MS,
  move: REST_HOP_MS,
  pet: 900,
  huff: 600,
  startle: 750,
  scorch: 1200,
  shiver: 1300,
  bristle: 1000,
  proud: 800,
  sulk: 800,
  cheer: 1300,
});
const BUSY = new Set([
  'enter',
  'throw',
  'react',
  'exit',
  'move',
  'huff',
  'scorch',
  'shiver',
  'bristle',
  'startle',
  'cheer',
]);
const SPOTS = [
  { x: 0.14, y: 0.8 },
  { x: 0.86, y: 0.8 },
  { x: 0.14, y: 0.2 },
  { x: 0.86, y: 0.2 },
];
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);

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

export function tiltQuaternion(yaw, tilt, out = new Quaternion()) {
  if (!tilt) return out.identity();
  const turn = new Quaternion().setFromAxisAngle(AXIS_Y, yaw);
  out.setFromAxisAngle(AXIS_X, -tilt).multiply(turn);
  return out.premultiply(turn.invert());
}

export function petsToShow({ users, me, getSetting }) {
  if (getSetting('petsAllowed') === false || getSetting('showPets') === false) return [];
  const others = getSetting('showOthersPets') !== false;
  const list = [...users]
    .filter((u) => u.id === me?.id || (others && u.active))
    .filter((u) => readPet(u).kind !== 'none');
  list.sort((a, b) => Number(b.id === me?.id) - Number(a.id === me?.id));
  return list.slice(0, MAX_PETS);
}

export function elementReaction(damageType) {
  const element = elementOf(null, damageType);
  const fx = element ? ELEMENT_FX[element] : null;
  return fx ? { element, pose: fx.pose, sound: fx.sound } : null;
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
  getSetting = () => undefined,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  const { kind, color, natural } = readPet(user);
  const spot = spotOf(user, index);
  const radius = (KIND_FOOTPRINT[kind] ?? 0.8) * COLLIDER_SHARE;
  const collider = [{ type: 'cylinder', radius, height: PET_HEIGHT }];
  const object = new TabletopObject(petObjectId(user.id))
    .setModel(modelUrl(kind))
    .setCollider([])
    .setPosition(spot)
    .setRotation(facing(spot));
  const EVENT = TabletopObject.OBJECT_EVENT_TYPE;
  const look = { yaw: 0, now: 0 };
  const holder = new Group();
  let creature = null;
  let action = null;
  let queue = [];
  let mood = null;
  let present = false;
  let removed = false;
  let stayTimer = null;
  let pats = [];
  let ignoreUntil = -Infinity;

  const setting = (key, fallback) => {
    try {
      return getSetting(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  function fit() {
    tiltQuaternion(facing(spot), VIEW_TILT[setting('petView', 'top')] ?? 0, holder.quaternion);
    const scale = Number(setting('petScale', 1));
    object.setScale?.(scale > 0 ? scale : 1);
  }

  function start(next) {
    action = { ...next, t0: now(), ms: ACTION_MS[next.phase] };
    object.setAnimated(true);
    voice(kind, next.phase, next.reaction, next.sound);
  }

  function act(phase, reaction = 'plain', { sound, then } = {}) {
    if (!creature || !present || !ACTION_MS[phase]) return false;
    queue = [];
    start({ phase, reaction, sound, then });
    return true;
  }

  function after(phase, reaction = 'plain', { sound, then } = {}) {
    if (!creature || !present || !ACTION_MS[phase]) return false;
    if (!action) start({ phase, reaction, sound, then });
    else queue.push({ phase, reaction, sound, then });
    return true;
  }

  function step() {
    if (!creature || !present) return;
    const t = now();
    look.now = t;
    while (action) {
      const k = (t - action.t0) / action.ms;
      if (k < 1) {
        creature.pose(action.phase, k, action.reaction, look);
        return;
      }
      const done = action;
      action = null;
      done.then?.();
      if (!present) return;
      const next = queue.shift();
      if (next) start(next);
    }
    object.setAnimated(false);
    if (mood) creature.pose(mood, 1, 'plain', look);
    else creature.pose('watch', 0, 'plain', look);
  }

  function hide() {
    present = false;
    action = null;
    queue = [];
    if (creature) creature.root.visible = false;
    object.setCollider([]);
    object.setAnimated(false);
    object.setPersistent(false);
  }

  function arrive() {
    if (!creature) return false;
    if (stayTimer !== null) clearTimer(stayTimer);
    stayTimer = null;
    if (present) return false;
    present = true;
    mood = null;
    creature.root.visible = true;
    object.setCollider(collider);
    object.setPersistent(true);
    fit();
    start({ phase: 'enter', reaction: 'plain' });
    return true;
  }

  function leave() {
    if (stayTimer !== null) clearTimer(stayTimer);
    stayTimer = null;
    if (!present) return false;
    act('exit', 'plain', { then: hide });
    return true;
  }

  function rest() {
    if (!present) return;
    const stay = Number(setting('petStay', 60));
    if (stay === 0) {
      leave();
      return;
    }
    if (stay > 0) stayTimer = setTimer(() => ((stayTimer = null), leave()), stay * 1000);
  }

  function moveTo(at, { hop = false } = {}) {
    spot.x = clamp(at.x);
    spot.y = clamp(at.y);
    object.setPosition({ x: spot.x, y: spot.y }).setRotation(facing(spot));
    fit();
    if (hop && present && !action) act('move');
  }

  function pat() {
    const t = now();
    pats = pats.filter((at) => t - at < HUFF_WINDOW_MS);
    pats.push(t);
    if (pats.length >= HUFF_HITS) {
      pats = [];
      ignoreUntil = t + HUFF_IGNORE_MS;
      act('huff');
    } else act('pet');
  }

  function onClick() {
    if (!present || setting('petClick', true) === false || now() < ignoreUntil) return;
    const target = view.window ?? view;
    let from = null;
    let dragged = false;
    const move = (event) => {
      from ??= { x: event.clientX, y: event.clientY };
      if (!dragged && Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_PX) return;
      if (!canMove) return;
      dragged = true;
      const place = dice3d.getAreaPosition?.({ x: event.clientX, y: event.clientY });
      if (place) moveTo(place);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      if (dragged) {
        act('move');
        saveSpot({ x: spot.x, y: spot.y });
      } else pat();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up, { once: true });
  }

  object.on(EVENT.FRAME, () => step());
  object.on(EVENT.HIT, ({ delay }) => {
    if (present && !(delay > 1 / 15) && !BUSY.has(action?.phase)) act('startle');
  });
  object.on(EVENT.CLICK, () => onClick());

  const ready = Promise.resolve(dice3d.addTabletopObject(object))
    .then(() => {
      if (removed || !object.model) return false;
      creature = createModelCreature(object.model, natural ? null : color, {
        kind,
        drawHeight: MODEL_FIT[kind],
      });
      holder.name = `${kind}-pet`;
      holder.add(creature.root);
      creature.root.visible = false;
      fit();
      object.setModel(holder);
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
    color,
    natural,
    object,
    ready,
    act,
    after,
    step,
    arrive,
    leave,
    rest,
    moveTo,
    fit,
    get action() {
      return action?.phase ?? null;
    },
    get present() {
      return present;
    },
    get busy() {
      return BUSY.has(action?.phase);
    },
    get mood() {
      return mood;
    },
    setMood(next) {
      mood = next === 'proud' || next === 'sulk' ? next : null;
    },
    position: (out = new Vector3()) => (object.model ? object.model.getWorldPosition(out) : null),
    remove() {
      removed = true;
      if (stayTimer !== null) clearTimer(stayTimer);
      stayTimer = null;
      dice3d.removeTabletopObject(object.id ?? petObjectId(user.id));
      creature?.dispose();
      creature = null;
      present = false;
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
  clearTimer = (id) => clearTimeout(id),
  now,
  voices = null,
  moods = createMoods(),
} = {}) {
  const pets = new Map();
  let rolling = null;
  const here = new Vector3();
  const there = new Vector3();

  const read = (key) => {
    try {
      return getSetting(key);
    } catch {
      return undefined;
    }
  };
  const on = (key) => read(key) !== false;

  function make(user) {
    const dice3d = getDice3d();
    const me = getMe();
    const canMove = user.id === me?.id || me?.isGM === true;
    const saveSpot = (spot) =>
      Promise.resolve(
        user.setFlag?.(MODULE, 'pet', { ...(user.getFlag?.(MODULE, 'pet') ?? {}), spot }),
      ).catch(() => {});
    return createPet({
      TabletopObject,
      dice3d,
      user,
      index: stableIndex(user, getUsers()),
      canMove,
      saveSpot,
      getSetting: read,
      setTimer,
      clearTimer,
      voice: (kind, phase, reaction, sound) => void voices?.pet(kind, phase, reaction, sound),
      ...(now && { now }),
    });
  }

  function refresh() {
    const dice3d = getDice3d();
    if (!dice3d?.addTabletopObject) return;
    for (const pet of pets.values()) pet.remove();
    pets.clear();
    for (const user of petsToShow({ users: getUsers(), me: getMe(), getSetting: read }))
      pets.set(user.id, make(user));
  }

  function reactToElement(dice) {
    if (!rolling || !on('petElemental')) return;
    const fx = elementReaction(dice?.die?.role === 'ice' ? 'cold' : dice?.die?.role);
    const edge = Number(getDice3d()?.box?.dicefactory?.baseScale);
    const from = dice?.parent?.getWorldPosition?.(there) ?? dice?.getWorldPosition?.(there);
    if (!fx || !(edge > 0) || !from) return;
    for (const pet of pets.values()) {
      if (!pet.present || pet.busy || rolling.reacted.has(pet)) continue;
      const at = pet.position(here);
      if (!at || Math.hypot(at.x - from.x, at.z - from.z) > REACT_REACH * edge) continue;
      rolling.reacted.add(pet);
      pet.act(fx.pose, 'plain', { sound: fx.sound });
    }
  }

  function finish(roll) {
    const reaction = summarize(roll.dice, false);
    const values = roll.dice.filter((d) => d.type === 'd20' && !d.ghost).map((d) => d.value);
    if (roll.pet) {
      moods.record(roll.pet.userId, values);
      const pet = roll.pet;
      pet.act('react', reaction, {
        then: () => {
          pet.setMood(on('petMoods') ? moods.moodOf(pet.userId) : null);
          if (pet.mood) pet.after(pet.mood, 'plain', { then: () => pet.rest() });
          else pet.rest();
        },
      });
    }
    if (reaction !== 'crit' || !on('petCheer')) return;
    let voiced = false;
    for (const pet of pets.values()) {
      if (pet === roll.pet || !pet.present || pet.busy) continue;
      pet.act('cheer', 'plain', { sound: voiced ? null : 'petHappy' });
      voiced = true;
    }
  }

  return {
    get size() {
      return pets.size;
    },
    pet: (userId) => pets.get(userId) ?? null,
    refresh,
    onRollStart(_messageId, context) {
      const id = context?.user?.id ?? context?.user ?? null;
      const pet = pets.get(id) ?? null;
      rolling = { pet, dice: [], timer: null, reacted: new Set() };
      if (!pet) return;
      if (pet.arrive()) pet.after('throw');
      else pet.act('throw');
    },
    onResult({ dice, type, result }) {
      if (!rolling) return;
      rolling.dice.push({ type, value: result, ghost: result == null });
      if (result != null) reactToElement(dice);
      if (rolling.timer) return;
      const roll = rolling;
      roll.timer = setTimer(() => {
        if (rolling === roll) rolling = null;
        finish(roll);
      }, REACT_WAIT_MS);
    },
    onUserChanged(user, changes) {
      if (changes?.flags?.[MODULE]?.pet === undefined && changes?.color === undefined) return;
      const pet = pets.get(user.id);
      const next = readPet(user);
      const same =
        pet && pet.kind === next.kind && pet.color === next.color && pet.natural === next.natural;
      if (same) {
        pet.moveTo(spotOf(user, stableIndex(user, getUsers())));
        return;
      }
      const wasHere = pet?.present === true;
      refresh();
      const again = pets.get(user.id);
      if (wasHere && again) again.ready.then((ok) => ok && again.arrive() && again.rest());
    },
    onViewChanged() {
      for (const pet of pets.values()) pet.fit();
    },
  };
}

export function registerPetSettings(pets, settings = globalThis.game.settings) {
  const base = (key) => ({
    name: `DICER.Settings.${key}.Name`,
    hint: `DICER.Settings.${key}.Hint`,
    config: key === 'petsAllowed',
  });
  const toggle = (key, scope, onChange) =>
    settings.register(MODULE, key, { ...base(key), scope, type: Boolean, default: true, onChange });
  const refresh = () => void pets.refresh();
  const fit = () => void pets.onViewChanged();
  toggle('petsAllowed', 'world', refresh);
  toggle('showPets', 'client', refresh);
  toggle('showOthersPets', 'client', refresh);
  settings.register(MODULE, 'petStay', {
    ...base('petStay'),
    scope: 'client',
    type: Number,
    choices: Object.fromEntries(
      STAY_CHOICES.map((v) => [v, `DICER.Settings.petStay.Choices.${v}`]),
    ),
    default: 60,
  });
  settings.register(MODULE, 'petView', {
    ...base('petView'),
    scope: 'client',
    type: String,
    choices: Object.fromEntries(
      Object.keys(VIEW_TILT).map((v) => [v, `DICER.Settings.petView.Choices.${v}`]),
    ),
    default: 'top',
    onChange: fit,
  });
  settings.register(MODULE, 'petScale', {
    ...base('petScale'),
    scope: 'client',
    type: Number,
    range: { min: 0.5, max: 3, step: 0.1 },
    default: 1,
    onChange: fit,
  });
  for (const key of ['petClick', 'petElemental', 'petMoods', 'petCheer']) toggle(key, 'client');
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
