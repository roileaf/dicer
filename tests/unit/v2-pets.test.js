import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_KINDS } from '../../src/pet/pet-for.js';
import {
  ACTION_MS,
  createPet,
  createPets,
  facing,
  MAX_PETS,
  modelUrl,
  petObjectId,
  petsToShow,
  registerPets,
  registerPetSettings,
  spotOf,
} from '../../src/v2/pets/pets.js';
import { kindChoices, savePet } from '../../src/v2/pets/window.js';
import { TabletopObject } from '../helpers/dsn-api.js';

function user(id, pet, { active = true, isGM = false, color = '#3366cc' } = {}) {
  const flags = { pet };
  return {
    id,
    active,
    isGM,
    color,
    getFlag: (_scope, key) => flags[key],
    setFlag: vi.fn(async (_scope, key, value) => void (flags[key] = value)),
  };
}

function template() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  return scene;
}

function dsn() {
  const added = [];
  return {
    added,
    removed: [],
    addTabletopObject: vi.fn(async (object) => {
      added.push(object);
      if (typeof object.modelSource === 'string') object.model = template();
    }),
    removeTabletopObject: vi.fn(function (id) {
      this.removed.push(id);
    }),
    getAreaPosition: vi.fn(({ x, y }) => ({ x: x / 1000, y: y / 1000 })),
  };
}

function pointerTarget() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => void (listeners[type] = fn),
    removeEventListener: (type) => void delete listeners[type],
    fire: (type, event) => listeners[type]?.(event),
    has: (type) => type in listeners,
  };
}

const EVENT = TabletopObject.OBJECT_EVENT_TYPE;

afterEach(() => vi.restoreAllMocks());

describe('v2 pets as DsN tabletop objects (DsN 5.7)', () => {
  it('makes a user`s pet an object with its model, a cylinder the dice bounce off, its spot, facing the middle', async () => {
    const dice3d = dsn();
    const pet = createPet({
      TabletopObject,
      dice3d,
      user: user('u1', { kind: 'owl', spot: { x: 0.2, y: 0.7 } }),
    });
    const { object } = pet;
    expect(object.id).toBe(petObjectId('u1'));
    expect(object.id).toBe('dicer.pet.u1');
    expect(object.modelSource).toBe('modules/dicer/assets/pets/owl.glb');
    expect(object.collider).toEqual([
      { type: 'cylinder', radius: expect.any(Number), height: 1.5 },
    ]);
    expect(object.collider[0].radius).toBeGreaterThan(0.3);
    expect(object.collider[0].radius).toBeLessThan(1);
    expect(object.position).toEqual({ x: 0.2, y: 0.7 });
    expect(object.rotation).toBeCloseTo(facing({ x: 0.2, y: 0.7 }), 12);
    expect(object.persistent).toBe(false);
    expect(await pet.ready).toBe(true);
    expect(object.model.name).toBe('owl');
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

  it('poses the model on DsN`s frames, and asks for frames only while it acts', async () => {
    let t = 0;
    const pet = createPet({
      TabletopObject,
      dice3d: dsn(),
      user: user('u1', { kind: 'cat' }),
      now: () => t,
    });
    expect(pet.act('pet')).toBe(false);
    await pet.ready;
    const { object } = pet;
    object.emit(EVENT.FRAME, { delta: 0.016 });
    expect(object.animated).toBe(false);
    expect(pet.act('pet')).toBe(true);
    expect(object.animated).toBe(true);
    t = ACTION_MS.pet / 2;
    object.emit(EVENT.FRAME, { delta: 0.016 });
    expect(pet.action).toBe('pet');
    t = ACTION_MS.pet + 1;
    object.emit(EVENT.FRAME, { delta: 0.016 });
    expect(pet.action).toBeNull();
    expect(object.animated).toBe(false);
    expect(pet.act('no-such-pose')).toBe(false);
  });

  it('flinches when a die hits it, unless the hit is shown late or it already flinches', async () => {
    let t = 0;
    const pet = createPet({
      TabletopObject,
      dice3d: dsn(),
      user: user('u1', { kind: 'fox' }),
      now: () => t,
    });
    await pet.ready;
    pet.object.emit(EVENT.HIT, { strength: 1, delay: 0.2 });
    expect(pet.action).toBeNull();
    pet.object.emit(EVENT.HIT, { strength: 1, delay: 0 });
    expect(pet.action).toBe('startle');
    t = 100;
    pet.object.emit(EVENT.HIT, { strength: 1, delay: 0 });
    t = ACTION_MS.startle - 50;
    pet.object.emit(EVENT.FRAME, {});
    expect(pet.action).toBe('startle');
  });

  it('a click pets it; a drag moves it, keeps it off the walls and saves the spot', async () => {
    const dice3d = dsn();
    const view = pointerTarget();
    const saveSpot = vi.fn();
    const pet = createPet({
      TabletopObject,
      dice3d,
      user: user('u1', { kind: 'frog' }),
      canMove: true,
      saveSpot,
      view,
    });
    await pet.ready;
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 102, clientY: 101 });
    view.fire('pointerup', {});
    expect(pet.action).toBe('pet');
    expect(saveSpot).not.toHaveBeenCalled();
    expect(view.has('pointermove')).toBe(false);
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 400, clientY: 990 });
    expect(pet.object.position).toEqual({ x: 0.4, y: 0.93 });
    expect(pet.object.rotation).toBeCloseTo(facing({ x: 0.4, y: 0.93 }), 12);
    view.fire('pointerup', {});
    expect(saveSpot).toHaveBeenCalledWith({ x: 0.4, y: 0.93 });
  });

  it('another player`s pet can be petted, not moved', async () => {
    const dice3d = dsn();
    const view = pointerTarget();
    const saveSpot = vi.fn();
    const pet = createPet({
      TabletopObject,
      dice3d,
      user: user('u2', { kind: 'imp' }),
      canMove: false,
      saveSpot,
      view,
    });
    await pet.ready;
    const before = { ...pet.object.position };
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 500, clientY: 500 });
    view.fire('pointerup', {});
    expect(pet.object.position).toEqual(before);
    expect(saveSpot).not.toHaveBeenCalled();
    expect(pet.action).toBe('pet');
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

  it('the roller`s pet throws, then reacts to the roll once its dice have landed', async () => {
    const dice3d = dsn();
    const me = user('me', { kind: 'cat' });
    const other = user('a', { kind: 'owl' });
    let timer = null;
    const pets = createPets({
      TabletopObject,
      getDice3d: () => dice3d,
      getUsers: () => [me, other],
      getMe: () => me,
      getSetting: () => true,
      setTimer: (fn) => ((timer = fn), 1),
    });
    pets.refresh();
    expect(pets.size).toBe(2);
    await Promise.all([pets.pet('me').ready, pets.pet('a').ready]);
    pets.onRollStart('m1', { user: other });
    expect(pets.pet('a').action).toBe('throw');
    expect(pets.pet('me').action).toBeNull();
    pets.onResult({ type: 'd20', result: 20 });
    pets.onResult({ type: 'd6', result: 3 });
    expect(pets.pet('a').action).toBe('throw');
    timer();
    expect(pets.pet('a').action).toBe('react');
    pets.onResult({ type: 'd20', result: 1 });
    expect(pets.pet('me').action).toBeNull();
    pets.onRollStart(null, { user: 'me' });
    expect(pets.pet('me').action).toBe('throw');
    pets.onRollStart(null, { user: { id: 'nobody' } });
    pets.onResult({ type: 'd20', result: 20 });
  });

  it('follows a changed pet or colour: the object is removed and added again', async () => {
    const dice3d = dsn();
    const me = user('me', { kind: 'cat' }, { isGM: true });
    const pets = createPets({
      TabletopObject,
      getDice3d: () => dice3d,
      getUsers: () => [me],
      getMe: () => me,
      getSetting: () => true,
    });
    pets.refresh();
    await pets.pet('me').ready;
    pets.onUserChanged(me, { name: 'x' });
    expect(dice3d.removeTabletopObject).not.toHaveBeenCalled();
    pets.onUserChanged(me, { flags: { dicer: { pet: { kind: 'owl' } } } });
    expect(dice3d.removed).toEqual(['dicer.pet.me']);
    expect(dice3d.addTabletopObject).toHaveBeenCalledTimes(2);
    pets.onUserChanged(me, { color: '#ff0000' });
    expect(dice3d.addTabletopObject).toHaveBeenCalledTimes(3);
  });

  it('saves a dragged spot in the owner`s flag, keeping the pet`s kind', async () => {
    const dice3d = dsn();
    const me = user('me', { kind: 'cat', natural: true });
    const pets = createPets({
      TabletopObject,
      getDice3d: () => dice3d,
      getUsers: () => [me],
      getMe: () => me,
      getSetting: () => true,
    });
    pets.refresh();
    const pet = pets.pet('me');
    await pet.ready;
    const view = pointerTarget();
    vi.stubGlobal('window', view);
    pet.object.emit(EVENT.CLICK, {});
    view.fire('pointermove', { clientX: 100, clientY: 100 });
    view.fire('pointermove', { clientX: 600, clientY: 300 });
    view.fire('pointerup', {});
    vi.unstubAllGlobals();
    expect(me.setFlag).toHaveBeenCalledWith('dicer', 'pet', {
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
    };
    registerPetSettings(pets, settings);
    expect(settings.register.mock.calls.map(([, key, o]) => [key, o.scope])).toEqual([
      ['petsAllowed', 'world'],
      ['showPets', 'client'],
      ['showOthersPets', 'client'],
    ]);
    settings.register.mock.calls[0][2].onChange();
    expect(pets.refresh).toHaveBeenCalledTimes(1);
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

describe('v2 pet picker', () => {
  it('lists every pet kind with its name, and no pet', () => {
    const choices = kindChoices((k) => k);
    expect(choices.map((c) => c.kind)).toEqual([...PET_KINDS]);
    expect(choices[0].label).toBe('DICER.Appearance.Pet.None');
    expect(choices.find((c) => c.kind === 'dragonling').label).toBe(
      'DICER.Appearance.Pet.Dragonling',
    );
  });

  it('saves the pet in the user`s flag, keeping its spot', async () => {
    const u = user('me', { kind: 'cat', spot: { x: 0.3, y: 0.4 } });
    expect(await savePet(u, { kind: 'owl', color: '#AABBCC', natural: true })).toEqual({
      kind: 'owl',
      natural: true,
      color: '#aabbcc',
      spot: { x: 0.3, y: 0.4 },
    });
    expect(u.setFlag).toHaveBeenCalledWith('dicer', 'pet', {
      kind: 'owl',
      natural: true,
      color: '#aabbcc',
      spot: { x: 0.3, y: 0.4 },
    });
    expect((await savePet(u, { kind: 'unicorn', color: 'red', natural: false })).kind).toBe(
      'mimic',
    );
  });
});
