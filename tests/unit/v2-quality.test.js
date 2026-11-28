import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIERS } from '../../src/render/quality.js';
import { flags, lookOf, resinGlsl } from '../../src/v2/materials/resin.js';
import {
  createQualityControl,
  registerQuality,
  registerQualitySettings,
} from '../../src/v2/quality/controller.js';
import { DEFAULT_TIER, setTier, tierConfig } from '../../src/v2/quality/state.js';

function world({ settings = {} } = {}) {
  const store = { quality: 'auto', qualityCap: 'ultra', autoTier: '', ...settings };
  const dice3d = {
    setQuality: vi.fn(async () => {}),
    DiceFactory: { disposeCachedMaterials: vi.fn() },
  };
  let t = 0;
  const control = createQualityControl({
    getDice3d: () => dice3d,
    getSetting: (key) => store[key],
    setSetting: vi.fn(async (key, value) => void (store[key] = value)),
    notify: vi.fn(),
    localize: (k) => k,
    now: () => t,
  });
  const frames = (n, ms) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      control.onFrame();
    }
  };
  return { store, dice3d, control, frames };
}

afterEach(() => {
  setTier(DEFAULT_TIER);
  vi.restoreAllMocks();
});

describe('v2 quality tier: Dicer`s own cost, DsN`s quality left to DsN', () => {
  it('starts at High', async () => {
    const { control } = world();
    await control.start();
    expect(control.tier).toBe('high');
  });

  it('starts at the tier remembered from an earlier visit, under the world`s cap', async () => {
    const a = world({ settings: { autoTier: 'medium' } });
    await a.control.start();
    expect(a.control.tier).toBe('medium');
    expect(a.dice3d.DiceFactory.disposeCachedMaterials).toHaveBeenCalledTimes(1);
    setTier(DEFAULT_TIER);
    const b = world({ settings: { quality: 'ultra', qualityCap: 'low' } });
    await b.control.start();
    expect(b.control.tier).toBe('low');
  });

  it('never sets DsN`s quality, so DsN`s Automatic keeps working', async () => {
    const { control, dice3d, frames } = world({ settings: { quality: 'low' } });
    await control.start();
    frames(200, 16);
    frames(600, 60);
    await control.settled();
    await control.refresh();
    expect(control.tier).toBe('low');
    expect(dice3d.setQuality).not.toHaveBeenCalled();
  });

  it('gives the insides and the particles the tier`s cost', async () => {
    expect(flags().interiorSteps).toBe(TIERS.high.interiorSteps);
    const { control } = world({ settings: { quality: 'ultra' } });
    await control.start();
    expect(tierConfig()).toBe(TIERS.ultra);
    expect(flags().interiorSteps).toBe(48);
    expect(resinGlsl(lookOf('resin', {})).defines).toContain('#define DICER_STEPS 48');
    setTier('low');
    expect(resinGlsl(lookOf('resin', {})).defines).toContain('#define DICER_STEPS 16');
    expect(tierConfig().particleScale).toBe(0.25);
  });

  it('steps down one tier when frames turn slow and stay slow, and remembers it', async () => {
    const { control, dice3d, frames, store } = world();
    await control.start();
    frames(200, 16);
    expect(control.tier).toBe('high');
    frames(400, 60);
    await control.settled();
    expect(control.tier).toBe('medium');
    expect(store.autoTier).toBe(control.tier);
    expect(dice3d.DiceFactory.disposeCachedMaterials).toHaveBeenCalled();
    frames(2000, 60);
    await control.settled();
    expect(control.tier).toBe('medium');
    frames(300, 16);
    frames(400, 60);
    await control.settled();
    expect(control.tier).toBe('low');
    frames(300, 16);
    frames(400, 60);
    await control.settled();
    expect(control.tier).toBe('low');
  });

  it('counts a frame once however many dice call the frame event, and skips a pause', async () => {
    const { control, frames } = world();
    await control.start();
    for (let i = 0; i < 3000; i++) control.onFrame();
    expect(control.tier).toBe('high');
    frames(50, 5000);
    expect(control.tier).toBe('high');
  });

  it('does not remember a drop when the player chose a tier, and a new choice tries again', async () => {
    const { control, frames, store } = world({ settings: { quality: 'high' } });
    await control.start();
    frames(200, 16);
    frames(600, 60);
    await control.settled();
    expect(control.tier).not.toBe('high');
    expect(store.autoTier).toBe('');
    store.quality = 'ultra';
    await control.refresh();
    expect(control.tier).toBe('ultra');
  });

  it('survives a missing DsN', async () => {
    const none = createQualityControl({
      getDice3d: () => null,
      getSetting: () => 'medium',
      setSetting: async () => {},
    });
    await expect(none.start()).resolves.toBe(true);
  });

  it('registers its settings and listens to DsN, returning nothing to Hooks.call', () => {
    const settings = { register: vi.fn() };
    const control = {
      refresh: vi.fn(),
      start: vi.fn(async () => true),
      onFrame: vi.fn(() => true),
    };
    registerQualitySettings(control, settings);
    expect(settings.register.mock.calls.map(([, key]) => key)).toEqual([
      'quality',
      'qualityCap',
      'autoTier',
    ]);
    const [, , quality] = settings.register.mock.calls[0];
    expect(Object.keys(quality.choices)).toEqual(['auto', 'low', 'medium', 'high', 'ultra']);
    expect([quality.scope, settings.register.mock.calls[1][2].scope]).toEqual(['client', 'world']);
    quality.onChange();
    expect(control.refresh).toHaveBeenCalledTimes(1);
    const hooks = { once: vi.fn(), on: vi.fn() };
    expect(registerQuality(hooks, control)).toBe(control);
    expect(hooks.once.mock.calls.map(([name]) => name)).toEqual(['init', 'diceSoNiceReady']);
    expect(hooks.on.mock.calls.map(([name]) => name)).toEqual(['diceSoNiceDiceFrame']);
    expect(hooks.once.mock.calls[1][1]()).toBeUndefined();
    expect(hooks.on.mock.calls[0][1]()).toBeUndefined();
  });
});
