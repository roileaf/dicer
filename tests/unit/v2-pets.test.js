import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_KINDS } from '../../src/pet/pet-for.js';
import {
  ACTION_MS,
  createPet,
  createPets,
  elementReaction,
  facing,
  MAX_PETS,
  modelUrl,
  petObjectId,
  petsToShow,
  REACT_REACH,
  registerPets,
  registerPetSettings,
  spotOf,
  tiltQuaternion,
  VIEW_TILT,
} from '../../src/v2/pets/pets.js';
import { TabletopObject } from '../helpers/dsn-api.js';

const EDGE = 0.04;
const EVENT = TabletopObject.OBJECT_EVENT_TYPE;

function user(id, pet, { active = true, isGM = false, color = '#3366cc' } = {}) {
  const flags = { pet };
  return {
    id,
    active,
    isGM,
    color,
    flags,
    getFlag: (_scope, key) => flags[key],
    setFlag: vi.fn(async (_scope, key, value) => void (flags[key] = value)),
  };
}

function template() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  return scene;
}

function dsn() {
  const added = [];
  const removed = [];
  return {
    added,
    removed,
    box: { dicefactory: { baseScale: EDGE } },
    addTabletopObject: vi.fn(async (object) => {
      added.push(object);
      if (typeof object.modelSource === 'string') object.model = template();
    }),
    removeTabletopObject: vi.fn((id) => void removed.push(id)),
    getAreaPosition: vi.fn(({ x, y }) => ({ x: x / 1000, y: y / 1000 })),
  };
}

function pointerTarget() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => void (listeners[type] = fn),
    removeEventListener: (type) => void delete listeners[type],
    fire: (type, event) => {
      const fn = listeners[type];
      if (type === 'pointerup') delete listeners[type];
      fn?.(event);
    },
    has: (type) => type in listeners,
  };
}

function clock() {
  const c = { t: 0, timers: [] };
  c.now = () => c.t;
  c.setTimer = (fn, ms) => {
    const timer = { fn, at: c.t + ms, off: false };
    c.timers.push(timer);
    return timer;
  };
  c.clearTimer = (timer) => void (timer.off = true);
  c.advance = (ms, pets = []) => {
    c.t += ms;
    for (const timer of c.timers.filter((x) => !x.off && x.at <= c.t)) {
      timer.off = true;
      timer.fn();
    }
    for (const pet of pets) pet.object.emit(EVENT.FRAME, {});
  };
  return c;
}

async function petOf(kind, options = {}) {
  const c = options.clock ?? clock();
  const dice3d = options.dice3d ?? dsn();
  const settings = options.settings ?? {};
  const pet = createPet({
    TabletopObject,
    dice3d,
    user: options.user ?? user('u1', { kind }),
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    getSetting: (key) => settings[key],
    ...options.extra,
  });
  await pet.ready;
  return { pet, c, dice3d, settings };
}

function rested(pet, c) {
  pet.arrive();
  c.advance(ACTION_MS.enter + 1, [pet]);
}

afterEach(() => vi.restoreAllMocks());

describe('v2 pets as DsN tabletop objects (DsN 5.7)', () => {
  it('is an object with its model at its spot, facing the middle, and nothing to bounce off until it comes', async () => {
    const { pet } = await petOf('owl', {
      user: user('u1', { kind: 'owl', spot: { x: 0.2, y: 0.7 } }),
    });
    const { object } = pet;
    expect(object.id).toBe(petObjectId('u1'));
    expect(object.model.name).toBe('owl-pet');
    expect(object.model.children[0].name).toBe('owl');
    expect(object.model.children[0].visible).toBe(false);
    expect(object.collider).toEqual([]);
    expect(object.position).toEqual({ x: 0.2, y: 0.7 });
    expect(object.rotation).toBeCloseTo(facing({ x: 0.2, y: 0.7 }), 12);
    expect(object.persistent).toBe(false);
    expect(pet.present).toBe(false);
  });

  it('every kind has its model file, and a spot is kept off the walls', () => {
    for (const kind of PET_KINDS.filter((k) => k !== 'none'))
      expect(modelUrl(kind)).toBe(`modules/dicer/assets/pets/${kind}.glb`);
    expect(spotOf(user('a', { kind: 'cat', spot: { x: 2, y: -1 } }))).toEqual({ x: 0.93, y: 0.07 });
    expect(spotOf(user('a', { kind: 'cat' }), 1)).toEqual({ x: 0.86, y: 0.8 });
    expect(spotOf(user('a', { kind: 'cat', spot: { x: 'no' } }), 0)).toEqual({ x: 0.14, y: 0.8 });
    expect(facing({ x: 0.5, y: 0.1 })).toBeCloseTo(0, 12);
    expect(facing({ x: 0.1, y: 0.5 })).toBeCloseTo(Math.PI / 2, 12);
  });

  it('hops in when it comes: shown, with its cylinder for the dice, and asks for frames while it moves', async () => {
    const { pet, c } = await petOf('cat');
    expect(pet.act('pet')).toBe(false);
    expect(pet.arrive()).toBe(true);
    expect(pet.present).toBe(true);
    expect(pet.action).toBe('enter');
    expect(pet.object.model.children[0].visible).toBe(true);
    expect(pet.object.collider).toEqual([
      { type: 'cylinder', radius: expect.any(Number), height: 1.5 },
    ]);
    expect(pet.object.animated).toBe(true);
    expect(pet.arrive()).toBe(false);
    c.advance(ACTION_MS.enter + 1, [pet]);
    expect(pet.action).toBeNull();
    expect(pet.object.animated).toBe(false);
  });

  it('plays queued moves one after the other', async () => {
    const { pet, c } = await petOf('cat');
    pet.arrive();
    expect(pet.after('throw')).toBe(true);
    expect(pet.action).toBe('enter');
    c.advance(ACTION_MS.enter + 1, [pet]);
    expect(pet.action).toBe('throw');
    c.advance(ACTION_MS.throw + 1, [pet]);
    expect(pet.action).toBeNull();
    expect(pet.act('no-such-pose')).toBe(false);
  });

  it('stays after its roll as long as the player set, keeping the dice layer shown, then hops out', async () => {
    const { pet, c } = await petOf('fox', { settings: { petStay: 30 } });
    rested(pet, c);
    pet.rest();
    expect(pet.object.persistent).toBe(true);
    c.advance(29000, [pet]);
    expect(pet.present).toBe(true);
    c.advance(1500, [pet]);
    expect(pet.action).toBe('exit');
    c.advance(ACTION_MS.exit + 1, [pet]);
    expect(pet.present).toBe(false);
    expect(pet.object.model.children[0].visible).toBe(false);
    expect(pet.object.collider).toEqual([]);
    expect(pet.object.persistent).toBe(false);
    expect(pet.object.animated).toBe(false);
  });

  it('leaves right after the roll, or never, by the same setting; a new roll cancels the leaving', async () => {
    const off = await petOf('fox', { settings: { petStay: 0 } });
    rested(off.pet, off.c);
    off.pet.rest();
    expect(off.pet.action).toBe('exit');
    const always = await petOf('fox', { settings: { petStay: -1 } });
    rested(always.pet, always.c);
    always.pet.rest();
    always.c.advance(3600000, [always.pet]);
    expect(always.pet.present).toBe(true);
    const again = await petOf('fox', { settings: { petStay: 30 } });
    rested(again.pet, again.c);
    again.pet.rest();
    again.c.advance(20000, [again.pet]);
    again.pet.arrive();
    again.c.advance(20000, [again.pet]);
    expect(again.pet.present).toBe(true);
  });

  it('flinches when a die hits it, unless the hit is shown late or it is busy', async () => {
    const { pet, c } = await petOf('fox');
    pet.object.emit(EVENT.HIT, { delay: 0 });
    expect(pet.action).toBeNull();
    pet.arrive();
    pet.object.emit(EVENT.HIT, { delay: 0 });
    expect(pet.action).toBe('enter');
    c.advance(ACTION_MS.enter + 1, [pet]);
    pet.object.emit(EVENT.HIT, { delay: 0.2 });
    expect(pet.action).toBeNull();
    pet.object.emit(EVENT.HIT, { delay: 0 });
    expect(pet.action).toBe('startle');
  });

  it('a click pets it; five quick pats and it huffs and ignores the next clicks', async () => {
    const view = pointerTarget();
    const { pet, c } = await petOf('frog', { extra: { view } });
    rested(pet, c);
    const patIt = () => {
      pet.object.emit(EVENT.CLICK, {});
      view.fire('pointerup', {});
    };
    for (let i = 0; i < 4; i++) {
      patIt();
      expect(pet.action).toBe('pet');
      c.advance(200, [pet]);
    }
    patIt();
    expect(pet.action).toBe('huff');
    c.advance(ACTION_MS.huff + 1, [pet]);
    pet.object.emit(EVENT.CLICK, {});
    expect(view.has('pointerup')).toBe(false);
    c.advance(4000, [pet]);
    patIt();
    expect(pet.action).toBe('pet');
  });

  it('a drag moves it, keeps it off the walls, hops and saves the spot; with petClick off, clicks do nothing', async () => {
    const view = pointerTarget();
    const saveSpot = vi.fn();
    const settings = {};
    const { pet, c } = await petOf('frog', { settings, extra: { view, canMove: true, saveSpot } });
    rested(pet, c);
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 400, clientY: 990 });
    expect(pet.object.position).toEqual({ x: 0.4, y: 0.93 });
    expect(pet.object.rotation).toBeCloseTo(facing({ x: 0.4, y: 0.93 }), 12);
    view.fire('pointerup', {});
    expect(saveSpot).toHaveBeenCalledWith({ x: 0.4, y: 0.93 });
    expect(pet.action).toBe('move');
    c.advance(ACTION_MS.move + 1, [pet]);
    settings.petClick = false;
    pet.object.emit(EVENT.CLICK, {});
    expect(view.has('pointerup')).toBe(false);
  });

  it('another player`s pet can be petted, not moved', async () => {
    const view = pointerTarget();
    const saveSpot = vi.fn();
    const { pet, c } = await petOf('imp', { extra: { view, canMove: false, saveSpot } });
    rested(pet, c);
    const before = { ...pet.object.position };
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 500, clientY: 500 });
    view.fire('pointerup', {});
    expect(pet.object.position).toEqual(before);
    expect(saveSpot).not.toHaveBeenCalled();
    expect(pet.action).toBe('pet');
  });

  it('leans back towards the viewer by the Pet view setting, whichever way it faces, and takes the Pet size', async () => {
    const top = await petOf('cat');
    expect(top.pet.object.model.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const settings = { petView: 'front', petScale: 1.5 };
    const { pet } = await petOf('cat', {
      settings,
      user: user('u1', { kind: 'cat', spot: { x: 0.2, y: 0.3 } }),
    });
    const yaw = facing({ x: 0.2, y: 0.3 });
    const q = pet.object.model.quaternion;
    expect(q.angleTo(tiltQuaternion(yaw, VIEW_TILT.front))).toBeCloseTo(0, 9);
    const world = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(world);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.z).toBeCloseTo(-Math.sin(VIEW_TILT.front), 9);
    expect(pet.object.scale).toBe(1.5);
    settings.petView = 'top';
    pet.fit();
    expect(q.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
  });

  it('shows my pet and the pets of the players here, at most four, by the settings', () => {
    const me = user('me', { kind: 'cat' });
    const users = [
      user('a', { kind: 'owl' }),
      me,
      user('b', { kind: 'none' }),
      user('c', { kind: 'fox' }, { active: false }),
      user('d', { kind: 'imp' }),
      user('e', { kind: 'frog' }),
      user('f', { kind: 'eye' }),
    ];
    const on = () => true;
    expect(petsToShow({ users, me, getSetting: on }).map((u) => u.id)).toEqual([
      'me',
      'a',
      'd',
      'e',
    ]);
    expect(MAX_PETS).toBe(4);
    expect(
      petsToShow({ users, me, getSetting: (k) => k !== 'showOthersPets' }).map((u) => u.id),
    ).toEqual(['me']);
    expect(petsToShow({ users, me, getSetting: (k) => k !== 'showPets' })).toEqual([]);
    expect(petsToShow({ users, me, getSetting: (k) => k !== 'petsAllowed' })).toEqual([]);
  });

  it('knows each damage type`s reaction and sound', () => {
    expect(elementReaction('fire')).toEqual({ element: 'fire', pose: 'scorch', sound: 'petCough' });
    expect(elementReaction('cold')).toEqual({
      element: 'frost',
      pose: 'shiver',
      sound: 'petShiver',
    });
    expect(elementReaction('lightning')).toEqual({
      element: 'storm',
      pose: 'bristle',
      sound: 'petZap',
    });
    expect(elementReaction('radiant').pose).toBe('pet');
    expect(elementReaction('basic')).toBeNull();
    expect(elementReaction(undefined)).toBeNull();
  });
});

describe('v2 pets and the rolls', () => {
  function table({ settings = {}, users } = {}) {
    const c = clock();
    const dice3d = dsn();
    const me = user('me', { kind: 'cat', spot: { x: 0.5, y: 0.5 } });
    const other = user('a', { kind: 'owl', spot: { x: 0.5, y: 0.5 } });
    const all = users ?? [me, other];
    const voices = { pet: vi.fn() };
    const store = { petStay: 60, ...settings };
    const pets = createPets({
      TabletopObject,
      getDice3d: () => dice3d,
      getUsers: () => all,
      getMe: () => all.find((u) => u.id === 'me'),
      getSetting: (key) => store[key],
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      now: c.now,
      voices,
    });
    pets.refresh();
    const each = () => all.map((u) => pets.pet(u.id)).filter(Boolean);
    const tick = (ms) => c.advance(ms, each());
    return {
      c,
      dice3d,
      me: all.find((u) => u.id === 'me'),
      other: all.find((u) => u.id === 'a'),
      pets,
      voices,
      store,
      tick,
      each,
    };
  }
  const settle = async (t) => {
    await Promise.all(t.each().map((p) => p.ready));
  };
  const die = (role, at = [0, 0, 0]) => {
    const parent = new THREE.Group();
    parent.position.set(...at);
    const mesh = new THREE.Mesh();
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    mesh.die = { role };
    return mesh;
  };

  it('the roller`s pet comes, throws, reacts once the dice have landed, then rests', async () => {
    const t = table();
    await settle(t);
    t.pets.onRollStart('m1', { user: t.other });
    const owl = t.pets.pet('a');
    expect(owl.present).toBe(true);
    expect(t.pets.pet('me').present).toBe(false);
    expect(owl.action).toBe('enter');
    t.tick(ACTION_MS.enter + 1);
    expect(owl.action).toBe('throw');
    expect(t.voices.pet).toHaveBeenLastCalledWith('owl', 'throw', 'plain', undefined);
    t.pets.onResult({ dice: die('basic'), type: 'd20', result: 20 });
    t.pets.onResult({ dice: die('basic'), type: 'd6', result: 3 });
    t.tick(250);
    expect(owl.action).toBe('react');
    expect(t.voices.pet).toHaveBeenLastCalledWith('owl', 'react', 'crit', undefined);
    t.tick(ACTION_MS.react + 1);
    expect(owl.action).toBeNull();
    expect(owl.object.persistent).toBe(true);
    t.pets.onRollStart(null, { user: 'a' });
    expect(owl.action).toBe('throw');
    t.pets.onRollStart(null, { user: { id: 'nobody' } });
    t.pets.onResult({ dice: die('basic'), type: 'd20', result: 5 });
  });

  it('a pet that rolled well several times stands proud; with Pet moods off it does not', async () => {
    const t = table();
    await settle(t);
    const roll = (x, value) => {
      x.pets.onRollStart(null, { user: x.me });
      x.tick(ACTION_MS.enter + ACTION_MS.throw + 2);
      x.pets.onResult({ dice: die('basic'), type: 'd20', result: value });
      x.tick(250);
      x.tick(ACTION_MS.react + 1);
    };
    const cat = t.pets.pet('me');
    roll(t, 18);
    roll(t, 19);
    expect(cat.mood).toBeNull();
    roll(t, 17);
    expect(cat.mood).toBe('proud');
    expect(cat.action).toBe('proud');
    t.tick(ACTION_MS.proud + 1);
    expect(cat.action).toBeNull();
    expect(cat.object.persistent).toBe(true);
    const off = table({ settings: { petMoods: false } });
    await settle(off);
    for (const v of [2, 3, 1]) roll(off, v);
    expect(off.pets.pet('me').mood).toBeNull();
  });

  it('a resting pet reacts to an elemental die landing by it, once a roll, by the die`s damage type', async () => {
    const t = table();
    await settle(t);
    const cat = t.pets.pet('me');
    cat.arrive();
    t.tick(ACTION_MS.enter + 1);
    const near = REACT_REACH * EDGE * 0.9;
    t.pets.onRollStart(null, { user: { id: 'nobody' } });
    t.pets.onResult({ dice: die('basic', [near, 0, 0]), type: 'd6', result: 2 });
    expect(cat.action).toBeNull();
    t.pets.onResult({ dice: die('fire', [REACT_REACH * EDGE * 1.5, 0, 0]), type: 'd6', result: 2 });
    expect(cat.action).toBeNull();
    t.pets.onResult({ dice: die('fire', [near, 0, 0]), type: 'd6', result: null });
    expect(cat.action).toBeNull();
    t.pets.onResult({ dice: die('ice', [0, 0, near]), type: 'd6', result: 2 });
    expect(cat.action).toBe('shiver');
    expect(t.voices.pet).toHaveBeenLastCalledWith('cat', 'shiver', 'plain', 'petShiver');
    t.c.advance(ACTION_MS.shiver + 1);
    cat.object.emit(EVENT.FRAME, {});
    t.pets.onResult({ dice: die('fire', [near, 0, 0]), type: 'd6', result: 2 });
    expect(cat.action).not.toBe('scorch');
    const off = table({ settings: { petElemental: false } });
    await settle(off);
    off.pets.pet('me').arrive();
    off.tick(ACTION_MS.enter + 1);
    off.pets.onRollStart(null, { user: { id: 'nobody' } });
    off.pets.onResult({ dice: die('fire', [near, 0, 0]), type: 'd6', result: 2 });
    expect(off.pets.pet('me').action).toBeNull();
  });

  it('the other resting pets cheer someone`s natural 20, with one voice for them all', async () => {
    const users = [
      user('me', { kind: 'cat' }),
      user('a', { kind: 'owl' }),
      user('b', { kind: 'frog' }),
    ];
    const t = table({ users });
    await settle(t);
    for (const id of ['me', 'b']) t.pets.pet(id).arrive();
    t.tick(ACTION_MS.enter + 1);
    t.voices.pet.mockClear();
    t.pets.onRollStart(null, { user: t.other });
    t.tick(ACTION_MS.enter + ACTION_MS.throw + 2);
    t.pets.onResult({ dice: die('basic'), type: 'd20', result: 20 });
    t.tick(250);
    expect(t.pets.pet('a').action).toBe('react');
    expect(t.pets.pet('me').action).toBe('cheer');
    expect(t.pets.pet('b').action).toBe('cheer');
    const cheers = t.voices.pet.mock.calls.filter(([, phase]) => phase === 'cheer');
    expect(cheers.map(([, , , sound]) => sound)).toEqual(['petHappy', null]);
    const off = table({ settings: { petCheer: false } });
    await settle(off);
    off.pets.pet('me').arrive();
    off.tick(ACTION_MS.enter + 1);
    off.pets.onRollStart(null, { user: off.other });
    off.pets.onResult({ dice: die('basic'), type: 'd20', result: 20 });
    off.tick(250);
    expect(off.pets.pet('me').action).toBeNull();
  });

  it('a moved spot moves the pet where it stands; a new kind or colour replaces it and it comes back', async () => {
    const t = table();
    await settle(t);
    const cat = t.pets.pet('me');
    cat.arrive();
    t.tick(ACTION_MS.enter + 1);
    t.pets.onUserChanged(t.me, { name: 'x' });
    t.me.flags.pet = { kind: 'cat', spot: { x: 0.3, y: 0.6 } };
    t.pets.onUserChanged(t.me, { flags: { dicer: { pet: { spot: { x: 0.3, y: 0.6 } } } } });
    expect(t.dice3d.removeTabletopObject).not.toHaveBeenCalled();
    expect(t.pets.pet('me')).toBe(cat);
    expect(cat.object.position).toEqual({ x: 0.3, y: 0.6 });
    expect(cat.present).toBe(true);
    t.me.flags.pet = { kind: 'owl', spot: { x: 0.3, y: 0.6 } };
    t.pets.onUserChanged(t.me, { flags: { dicer: { pet: { kind: 'owl' } } } });
    expect(t.dice3d.removed).toContain('dicer.pet.me');
    const owl = t.pets.pet('me');
    expect(owl.kind).toBe('owl');
    await owl.ready;
    await Promise.resolve();
    expect(owl.present).toBe(true);
    expect(owl.object.persistent).toBe(true);
  });

  it('saves a dragged spot in the owner`s flag, keeping the pet`s kind', async () => {
    const t = table();
    t.me.flags.pet = { kind: 'cat', natural: true };
    t.pets.refresh();
    await settle(t);
    const pet = t.pets.pet('me');
    pet.arrive();
    t.tick(ACTION_MS.enter + 1);
    const view = pointerTarget();
    vi.stubGlobal('window', view);
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 600, clientY: 300 });
    view.fire('pointerup', {});
    vi.unstubAllGlobals();
    expect(t.me.setFlag).toHaveBeenCalledWith('dicer', 'pet', {
      kind: 'cat',
      natural: true,
      spot: { x: 0.6, y: 0.3 },
    });
  });

  it('a pet whose model fails to load is skipped without breaking the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dice3d = dsn();
    dice3d.addTabletopObject.mockRejectedValueOnce(new Error('404'));
    const pet = createPet({ TabletopObject, dice3d, user: user('u1', { kind: 'cat' }) });
    expect(await pet.ready).toBe(false);
    expect(pet.arrive()).toBe(false);
    expect(pet.act('pet')).toBe(false);
    pet.object.emit(EVENT.FRAME, {});
  });

  it('registers its settings and listens to DsN and to user changes, returning nothing to Hooks.call', () => {
    const settings = { register: vi.fn() };
    const pets = {
      refresh: vi.fn(() => true),
      onRollStart: vi.fn(() => true),
      onResult: vi.fn(() => true),
      onUserChanged: vi.fn(() => true),
      onViewChanged: vi.fn(() => true),
    };
    registerPetSettings(pets, settings);
    expect(settings.register.mock.calls.map(([, key, o]) => [key, o.scope, o.default])).toEqual([
      ['petsAllowed', 'world', true],
      ['showPets', 'client', true],
      ['showOthersPets', 'client', true],
      ['petStay', 'client', 60],
      ['petView', 'client', 'top'],
      ['petScale', 'client', 1],
      ['petClick', 'client', true],
      ['petElemental', 'client', true],
      ['petMoods', 'client', true],
      ['petCheer', 'client', true],
    ]);
    const by = Object.fromEntries(settings.register.mock.calls.map(([, key, o]) => [key, o]));
    expect(
      Object.keys(by.petStay.choices)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([-1, 0, 30, 60, 120]);
    expect(Object.keys(by.petView.choices)).toEqual(['top', 'angled', 'front']);
    by.petsAllowed.onChange();
    expect(pets.refresh).toHaveBeenCalledTimes(1);
    by.petView.onChange();
    by.petScale.onChange();
    expect(pets.onViewChanged).toHaveBeenCalledTimes(2);
    const hooks = { once: vi.fn(), on: vi.fn() };
    expect(registerPets(TabletopObject, hooks, pets)).toBe(pets);
    expect(hooks.once.mock.calls.map(([name]) => name)).toEqual(['init', 'diceSoNiceReady']);
    expect(hooks.on.mock.calls.map(([name]) => name)).toEqual([
      'diceSoNiceRollStart',
      'diceSoNiceDiceResult',
      'updateUser',
      'userConnected',
    ]);
    for (const [, fn] of hooks.on.mock.calls) expect(fn({}, {})).toBeUndefined();
    expect(hooks.once.mock.calls[1][1]()).toBeUndefined();
  });
});
