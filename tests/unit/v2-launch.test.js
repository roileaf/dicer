import { describe, expect, it, vi } from 'vitest';
import {
  launchFrom,
  onPreCreateMessage,
  petLaunch,
  REACH,
  registerLaunch,
} from '../../src/v2/pets/launch.js';
import { spotOf, stableIndex } from '../../src/v2/pets/pets.js';

const user = (id, pet) => ({
  id,
  color: '#3366cc',
  getFlag: (_scope, key) => (key === 'pet' ? pet : undefined),
});
const on = () => true;

function message({ isRoll = true, flags = {} } = {}) {
  return { isRoll, flags, updateSource: vi.fn() };
}

describe('v2 pet launch on DsN`s launch flag (DsN 5.8)', () => {
  it('starts the dice in front of the pet, towards the middle, outside its collider', () => {
    const from = launchFrom({ x: 0.1, y: 0.5 });
    expect(from.x).toBeCloseTo(0.1 + REACH, 12);
    expect(from.y).toBeCloseTo(0.5, 12);
    const corner = launchFrom({ x: 0.14, y: 0.8 });
    expect(Math.hypot(corner.x - 0.14, corner.y - 0.8)).toBeCloseTo(REACH, 12);
    expect(corner.x).toBeGreaterThan(0.14);
    expect(corner.y).toBeLessThan(0.8);
    expect(launchFrom({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('uses the pet`s saved spot, or the same default corner on every client', () => {
    const a = user('a', { kind: 'owl' });
    const b = user('b', { kind: 'cat', spot: { x: 0.3, y: 0.6 } });
    const none = user('0', { kind: 'none' });
    const users = [b, none, a];
    expect(stableIndex(a, users)).toBe(0);
    expect(stableIndex(b, users)).toBe(1);
    expect(stableIndex(a, [a, b, none])).toBe(0);
    expect(petLaunch({ user: a, users, getSetting: on }).from).toEqual(launchFrom(spotOf(a, 0)));
    expect(petLaunch({ user: b, users, getSetting: on }).from).toEqual(
      launchFrom({ x: 0.3, y: 0.6 }),
    );
  });

  it('gives no launch without a pet, or when the world turned pets off', () => {
    const a = user('a', { kind: 'owl' });
    expect(petLaunch({ user: user('n', { kind: 'none' }), users: [], getSetting: on })).toBeNull();
    expect(petLaunch({ user: a, users: [a], getSetting: (k) => k !== 'petsAllowed' })).toBeNull();
    expect(petLaunch({ user: null, users: [], getSetting: on })).toBeNull();
  });

  it('sets the flag on the roller`s own roll message, and returns nothing: a false would cancel the message', () => {
    const a = user('a', { kind: 'owl', spot: { x: 0.2, y: 0.2 } });
    const m = message();
    expect(onPreCreateMessage(m, { user: a, users: [a], getSetting: on })).toBeUndefined();
    expect(m.updateSource).toHaveBeenCalledWith({
      'flags.dice-so-nice.launch': { from: launchFrom({ x: 0.2, y: 0.2 }) },
    });
  });

  it('leaves alone a message that is not a roll, or already has a launch', () => {
    const a = user('a', { kind: 'owl' });
    const text = message({ isRoll: false });
    onPreCreateMessage(text, { user: a, users: [a], getSetting: on });
    expect(text.updateSource).not.toHaveBeenCalled();
    const own = message({ flags: { 'dice-so-nice': { launch: { strength: 2 } } } });
    onPreCreateMessage(own, { user: a, users: [a], getSetting: on });
    expect(own.updateSource).not.toHaveBeenCalled();
    const broken = message();
    onPreCreateMessage(broken, {
      user: a,
      users: [a],
      getSetting: () => {
        throw new Error('not registered');
      },
    });
    expect(broken.updateSource).not.toHaveBeenCalled();
  });

  it('listens to preCreateChatMessage', () => {
    const hooks = { on: vi.fn() };
    registerLaunch(hooks);
    expect(hooks.on.mock.calls.map(([name]) => name)).toEqual(['preCreateChatMessage']);
    expect(hooks.on.mock.calls[0][1]({ isRoll: false })).toBeUndefined();
  });
});
