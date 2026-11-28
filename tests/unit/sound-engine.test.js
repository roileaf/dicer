import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAudioContext } from './fake-audio.js';
import {
  createSoundEngine,
  impactGain,
  MIN_IMPACT_SPEED,
  LOUD_IMPACT_SPEED,
  MAX_VOICES,
  DIE_DEBOUNCE_MS,
  HEAVY_GAIN,
  MEDIUM_GAIN,
  hitLevel,
  RESULT_WINDOW_MS,
} from '../../src/audio/sound-engine.js';

const MATS = ['plastic', 'metal', 'wood', 'glass', 'stone'];
const fakeSynth = {
  VARIANTS: 4,
  renderAll: async () => {
    const m = new Map();
    for (const mat of MATS) for (let v = 0; v < 4; v++) m.set(`impact:${mat}:${v}`, new Float32Array(480));
    for (const s of ['felt', 'wood', 'stone', 'metal']) m.set(`surface:${s}`, new Float32Array(480));
    for (const r of ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'petHappy', 'petSad']) m.set(`result:${r}`, new Float32Array(480));
    return m;
  },
};

// A small hit table: every level has two d20 hits and one d6, d4 and d10 hit.
const HITS = [];
for (const level of ['heavy', 'medium', 'light']) {
  for (const die of ['d20', 'd20', 'd6', 'd4', 'd10']) {
    HITS.push({ start: 0.05 + HITS.length * 0.2, duration: 0.1, level, die });
  }
}
// The felt-table sprite: its own hits, far from the hard-table ones, so tests can tell them apart.
const FELT_HITS = ['heavy', 'heavy', 'medium', 'light'].map((level, i) => ({
  start: 10.05 + i * 0.2,
  duration: 0.1,
  level,
  die: 'd6',
}));
const spriteOk = async (url) => {
  const felt = /dice-hits-felt/.test(url);
  if (url.endsWith('.json')) return { ok: true, json: async () => ({ rate: 48000, hits: felt ? FELT_HITS : HITS }) };
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(felt ? 32 : 16) };
};
const noFelt = async (url) => (/dice-hits-felt/.test(url) ? { ok: false, status: 404 } : spriteOk(url));
const hitAt = (source) => HITS[Math.round((source.offset + 0.01 - 0.05) / 0.2)];

let ctx;
let decodeCtx;
let decodeCtxCount;
let settings;
let warn;
let now;
let focus;
function make(extra = {}) {
  ctx = undefined;
  decodeCtx = undefined;
  decodeCtxCount = 0;
  const createContext = vi.fn(() => (ctx = new FakeAudioContext()));
  // The sprite is fetched through the same fetchSound as custom files; tests that supply their
  // own custom-file fetcher keep the sprite on the happy path unless they pass `sprite`.
  const { fetchSound: custom, sprite = spriteOk, ...rest } = extra;
  const fetchSound = (url, ...a) => (/dice-hits/.test(url) || !custom ? sprite(url, ...a) : custom(url, ...a));
  const engine = createSoundEngine({
    createContext,
    loadSynth: async () => fakeSynth,
    getSetting: (k) => settings[k],
    hasFocus: () => focus,
    warn,
    now: () => now,
    idle: (cb) => setTimeout(cb, 0),
    fetchSound,
    createDecodeContext: () => {
      decodeCtxCount++;
      return (decodeCtx = new FakeAudioContext());
    },
    ...rest,
  });
  return { engine, createContext };
}
const hit = (over = {}) => ({ material: 'plastic', surface: 'felt', speed: 30, other: 2, dieKey: 'a', ...over });

beforeEach(() => {
  vi.useFakeTimers();
  settings = { sounds: true, soundVolume: 1, effectsVolume: 1, quietWhenUnfocused: true };
  warn = vi.fn();
  now = 1000;
  focus = true;
});
afterEach(() => vi.useRealTimers());

async function ready(extra) {
  const m = make(extra);
  const p = m.engine.preload();
  await vi.advanceTimersByTimeAsync(50);
  await p;
  return m;
}

describe('impactGain', () => {
  it('maps measured speeds', () => {
    expect(MIN_IMPACT_SPEED).toBe(4);
    expect(LOUD_IMPACT_SPEED).toBe(24);
    expect(impactGain(0)).toBe(0);
    expect(impactGain(3.9)).toBe(0);
    expect(impactGain(5.2)).toBeLessThan(0.01);
    expect(impactGain(20)).toBeCloseTo(0.64, 5);
    expect(impactGain(24)).toBe(1);
    expect(impactGain(99)).toBe(1);
    expect(impactGain(NaN)).toBe(0);
  });
  it('is monotone', () => {
    let prev = 0;
    for (let s = 0; s <= 30; s += 0.5) {
      const g = impactGain(s);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('sound engine', () => {
  it('creates no context before the first impact', async () => {
    const { engine, createContext } = await ready();
    expect(createContext).not.toHaveBeenCalled();
    engine.impact(hit());
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('caps simultaneous voices', async () => {
    const { engine } = await ready();
    for (let i = 0; i < 30; i++) engine.impact(hit({ dieKey: `d${i}` }));
    expect(ctx.sources.length).toBe(MAX_VOICES);
  });

  it('a louder newcomer replaces the quietest voice at the cap', async () => {
    const { engine } = await ready();
    for (let i = 0; i < MAX_VOICES; i++) engine.impact(hit({ dieKey: `d${i}`, speed: 10 }));
    engine.impact(hit({ dieKey: 'loud', speed: 30 }));
    expect(ctx.sources.length).toBe(MAX_VOICES + 1);
    expect(ctx.sources.filter((s) => s.stopped).length).toBe(1);
  });

  it('debounces the same die', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    now += 10;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(1);
    now += DIE_DEBOUNCE_MS;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(2);
  });

  it('a floor hit is one voice: the recording already contains the table', async () => {
    const { engine } = await ready();
    engine.impact(hit({ other: -1 }));
    expect(ctx.sources.length).toBe(1);
    engine.impact(hit({ other: 2, dieKey: 'b' }));
    expect(ctx.sources.length).toBe(2);
  });

  it('drops quiet impacts without creating a context', async () => {
    const { engine, createContext } = await ready();
    engine.impact(hit({ speed: 1.8 }));
    expect(createContext).not.toHaveBeenCalled();
  });

  it('honours settings', async () => {
    let { engine } = await ready();
    settings.sounds = false;
    engine.impact(hit());
    expect(ctx).toBeUndefined();
    settings.sounds = true;

    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    const full = ctx.sources[0].totalGain;
    expect(full).toBeCloseTo(1, 5);

    settings.soundVolume = 0.5;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(full / 2, 5);

    settings.soundVolume = 1;
    focus = false;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(0.25, 5);

    settings.quietWhenUnfocused = false;
    ({ engine } = await ready());
    engine.impact(hit({ speed: 24 }));
    expect(ctx.sources[0].totalGain).toBeCloseTo(1, 5);
  });

  it('synth fallback jitters playback rate within 4% and rotates variants', async () => {
    const { engine } = await ready({ sprite: async () => ({ ok: false, status: 404 }) });
    for (let i = 0; i < 8; i++) {
      now += 100;
      engine.impact(hit());
    }
    for (const s of ctx.sources) {
      expect(s.playbackRate.value).toBeGreaterThanOrEqual(0.96);
      expect(s.playbackRate.value).toBeLessThanOrEqual(1.04);
    }
    const bufs = new Set(ctx.sources.map((s) => s.buffer));
    expect(bufs.size).toBe(4);
  });

  describe('recorded hits', () => {
    const play = (engine, over = {}) => {
      now += 100;
      if (ctx) ctx.currentTime += 1; // earlier hits have finished: the voice cap is not in play
      engine.impact(hit({ other: 2, ...over }));
      return ctx.sources[ctx.sources.length - 1];
    };

    it('loads the sprite once and plays every hit from the shared buffer', async () => {
      const sprite = vi.fn(spriteOk);
      const { engine } = await ready({ sprite });
      expect(sprite).toHaveBeenCalledTimes(4); // table + audio, hard and felt
      expect(decodeCtxCount).toBe(1);
      expect(decodeCtx.decoded.length).toBe(2); // the hard-table and the felt sprite
      for (let i = 0; i < 5; i++) play(engine, { dieKey: `k${i}` });
      await engine.preload();
      expect(sprite).toHaveBeenCalledTimes(4);
      expect(new Set(ctx.sources.map((s) => s.buffer)).size).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('starts at the hit offset with a small lead and tail', async () => {
      const { engine } = await ready();
      const s = play(engine, { dieType: 'd6' });
      const h = HITS.find((x) => x.level === 'heavy' && x.die === 'd6');
      expect(s.startedAt).toBe(0);
      expect(s.offset).toBeCloseTo(h.start - 0.01, 6);
      expect(s.duration).toBeCloseTo(h.duration + 0.04, 6);
      expect(s.playbackRate.value).toBeGreaterThanOrEqual(0.97);
      expect(s.playbackRate.value).toBeLessThanOrEqual(1.03);
    });

    it('buckets by speed', () => {
      expect(hitLevel(impactGain(24))).toBe('heavy');
      expect(hitLevel(impactGain(18.5))).toBe('heavy');
      expect(hitLevel(impactGain(15))).toBe('medium');
      expect(hitLevel(impactGain(10))).toBe('light');
      expect(hitLevel(impactGain(5))).toBe('light');
      expect(MEDIUM_GAIN).toBeLessThan(HEAVY_GAIN);
    });

    it('strong impacts play heavy hits, medium ones medium, soft ones light', async () => {
      const { engine } = await ready();
      const level = (speed, i) => hitAt(play(engine, { speed, dieKey: `s${speed}-${i}` })).level;
      for (let i = 0; i < 5; i++) expect(level(30, i)).toBe('heavy');
      for (let i = 0; i < 5; i++) expect(level(15, i)).toBe('medium');
      for (let i = 0; i < 5; i++) expect(level(9, i)).toBe('light');
    });

    it('prefers the die type, mapping d100 to d10 and d2 to d6', async () => {
      const { engine } = await ready();
      const die = (over) => hitAt(play(engine, over)).die;
      for (let i = 0; i < 6; i++) expect(die({ dieKey: `a${i}`, dieType: 'd4' })).toBe('d4');
      for (let i = 0; i < 6; i++) expect(die({ dieKey: `b${i}`, dieType: 'd100' })).toBe('d10');
      for (let i = 0; i < 6; i++) expect(die({ dieKey: `c${i}`, dieType: 'd2' })).toBe('d6');
      for (let i = 0; i < 6; i++) expect(die({ dieKey: `d${i}`, dieType: 'd14' })).toBe('d10');
      // The recorded set has no d12 hit: a d16 (aliased to the d12) plays any recorded hit.
      expect(['d4', 'd6', 'd10', 'd20']).toContain(die({ dieKey: 'e', dieType: 'd16' }));
      expect(['d4', 'd6', 'd10', 'd20']).toContain(die({ dieKey: 'z', dieType: 'd7' }));
    });

    it('never repeats the previous hit of a die', async () => {
      const { engine } = await ready();
      let prev = null;
      for (let i = 0; i < 30; i++) {
        const s = play(engine, { dieKey: 'same', dieType: 'd20' });
        expect(s.offset).not.toBe(prev);
        prev = s.offset;
      }
    });

    it('colours by material', async () => {
      const { engine } = await ready();
      const m = (material) => play(engine, { material, dieKey: material });
      let s = m('plastic');
      expect(s.filters.length).toBe(0);
      s = m('glass');
      expect(s.filters.length).toBe(0);
      s = m('metal');
      expect(s.playbackRate.value / 1.15).toBeGreaterThanOrEqual(0.97);
      expect(s.playbackRate.value / 1.15).toBeLessThanOrEqual(1.03);
      expect(s.filters.map((f) => [f.type, f.frequency.value, f.gain.value])).toEqual([['highshelf', 4000, 4]]);
      s = m('wood');
      expect(s.playbackRate.value / 0.9).toBeGreaterThanOrEqual(0.97);
      expect(s.playbackRate.value / 0.9).toBeLessThanOrEqual(1.03);
      expect(s.filters.map((f) => [f.type, f.frequency.value])).toEqual([['lowpass', 3500]]);
      s = m('stone');
      expect(s.playbackRate.value / 1.05).toBeGreaterThanOrEqual(0.97);
      expect(s.playbackRate.value / 1.05).toBeLessThanOrEqual(1.03);
      expect(s.filters.map((f) => [f.type, f.frequency.value, f.gain.value])).toEqual([['highshelf', 4000, 2]]);
    });

    it('a felt table plays the felt recordings for floor hits, unfiltered', async () => {
      const { engine } = await ready();
      for (let i = 0; i < 6; i++) {
        const s = play(engine, { surface: 'felt', other: -1, speed: 24, dieKey: `felt${i}` });
        expect(s.offset).toBeGreaterThanOrEqual(10); // a felt hit, not a hard-table one
        expect(s.filters.length).toBe(0);
      }
      // Dice clicking against each other on felt are still resin on resin: the hard-table hits.
      const dd = play(engine, { surface: 'felt', other: 3, speed: 24, dieKey: 'felt-dd' });
      expect(dd.offset).toBeLessThan(10);
      // Soft settling taps on felt use the felt set's quiet hits.
      const soft = play(engine, { surface: 'felt', other: -1, speed: 9, dieKey: 'soft' });
      expect(FELT_HITS[Math.round((soft.offset + 0.01 - 10.05) / 0.2)].level).toBe('light');
    });

    it('without the felt recordings, a felt floor hit falls back to a muffled hard-table hit', async () => {
      const { engine } = await ready({ sprite: noFelt });
      const s = play(engine, { surface: 'felt', other: -1, speed: 24, dieKey: 'nf' });
      expect(s.offset).toBeLessThan(10);
      expect(s.filters.map((x) => [x.type, x.frequency.value])).toEqual([['lowpass', 1200]]);
      expect(s.totalGain).toBeCloseTo(10 ** (-4 / 20), 5);
      expect(warn).toHaveBeenCalledTimes(1);
      // The hard-table sounds still play normally.
      expect(play(engine, { surface: 'wood', other: -1, speed: 24, dieKey: 'nf2' }).offset).toBeLessThan(10);
    });

    it('colours floor hits by surface and leaves other dice contacts alone', async () => {
      const { engine } = await ready();
      const f = (surface, over = {}) => play(engine, { surface, other: -1, speed: 24, dieKey: surface, ...over });
      let s = f('wood');
      expect(s.filters.length).toBe(0);
      expect(s.totalGain).toBeCloseTo(1, 5);
      s = f('stone');
      expect(s.filters.map((x) => [x.type, x.gain.value])).toEqual([['highshelf', 3]]);
      s = f('metal');
      expect(s.filters.map((x) => [x.type, x.frequency.value, x.gain.value])).toEqual([['peaking', 3000, 4]]);
      s = play(engine, { surface: 'felt', other: 3, speed: 24, dieKey: 'dd' });
      expect(s.filters.length).toBe(0);
      expect(s.totalGain).toBeCloseTo(1, 5);
      s = play(engine, { surface: 'metal', material: 'metal', other: -1, dieKey: 'mm' });
      expect(s.filters.map((x) => x.type)).toEqual(['highshelf', 'peaking']);
    });

    it('plays nothing before the sprite is ready and loads lazily without preload', async () => {
      const sprite = vi.fn(spriteOk);
      const { engine } = make({ sprite });
      engine.impact(hit());
      expect(ctx).toBeUndefined();
      await vi.advanceTimersByTimeAsync(50);
      expect(sprite).toHaveBeenCalledTimes(4);
      now += 100;
      engine.impact(hit());
      expect(ctx.sources.length).toBe(1);
    });

    it('nothing plays while the sprite is still loading', async () => {
      let release;
      const gate = new Promise((r) => (release = r));
      const { engine } = make({
        sprite: async (u) => {
          await gate;
          return spriteOk(u);
        },
      });
      engine.preload();
      engine.impact(hit());
      expect(ctx).toBeUndefined();
      release();
      await vi.advanceTimersByTimeAsync(50);
      now += 100;
      engine.impact(hit());
      expect(ctx.sources.length).toBe(1);
    });

    it('a failed load warns once and falls back to the synthesized impacts', async () => {
      const { engine } = await ready({ sprite: async () => ({ ok: false, status: 404 }) });
      expect(warn).toHaveBeenCalledTimes(1);
      engine.impact(hit({ other: -1 }));
      expect(ctx.sources.length).toBe(2); // impact + synth surface voice
      now += 100;
      engine.impact(hit());
      await engine.preload();
      expect(warn).toHaveBeenCalledTimes(1);
      await engine.result({ builtin: 'chime' });
      expect(ctx.sources.length).toBe(4);
    });
  });

  it('survives missing WebAudio with one warning', async () => {
    const { engine } = await ready({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(() => engine.impact(hit())).not.toThrow();
    now += 100;
    engine.impact(hit());
    await expect(engine.result({ builtin: 'chime' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops, not queues, while suspended', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    ctx.state = 'suspended';
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(1);
    ctx.state = 'running';
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(2);
  });

  it('resumes through game.audio.awaitFirstGesture when present', async () => {
    let release;
    globalThis.game = { audio: { awaitFirstGesture: () => new Promise((r) => (release = r)) } };
    try {
      const { engine } = await ready({
        createContext: () => (ctx = new FakeAudioContext({ state: 'suspended' })),
      });
      engine.impact(hit());
      expect(ctx.sources.length).toBe(0);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.state).toBe('running');
      now += 100;
      engine.impact(hit());
      expect(ctx.sources.length).toBe(1);
    } finally {
      delete globalThis.game;
    }
  });

  it('suspends after 30 s with nothing playing', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    ctx.currentTime = 100; // the click has long finished
    await vi.advanceTimersByTimeAsync(29000);
    expect(ctx.state).toBe('running');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.state).toBe('suspended');
  });

  describe('result', () => {
    it('plays a builtin with effects x sound volume', async () => {
      settings.effectsVolume = 0.5;
      settings.soundVolume = 0.5;
      const { engine } = await ready();
      await engine.result({ builtin: 'chime' });
      expect(ctx.sources.length).toBe(1);
      expect(ctx.sources[0].totalGain).toBeCloseTo(0.25, 5);
    });

    it('plays the pet sounds as builtins', async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'petHappy' });
      await engine.result({ builtin: 'petSad' });
      expect(ctx.sources.length).toBe(2);
    });

    it("plays a pet's voice at its pitch (rate, clamped 0.5..2)", async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'petHappy', rate: 1.4 });
      await engine.result({ builtin: 'petHappy', rate: 9 });
      await engine.result({ builtin: 'petHappy' });
      expect(ctx.sources.map((s) => s.playbackRate.value)).toEqual([1.4, 2, 1]);
    });

    it("plays a pet's own take (sound.voice(ctx) -> its buffer); a failing or empty one plays the shared take", async () => {
      const { engine } = await ready();
      const own = { duration: 0.4 };
      const voice = vi.fn(() => own);
      await engine.result({ builtin: 'petHappy', voice });
      expect(voice).toHaveBeenCalledWith(ctx);
      expect(ctx.sources[0].buffer).toBe(own);
      await engine.result({ builtin: 'petHappy', voice: () => { throw new Error('no render'); } });
      await engine.result({ builtin: 'petHappy', voice: () => null });
      await engine.result({ builtin: 'petHappy', voice: 'not a function' });
      expect(ctx.sources.length).toBe(4);
      for (const s of ctx.sources.slice(1)) expect(s.buffer).toBeTruthy();
      expect(ctx.sources[1].buffer).not.toBe(own);
    });

    it("a builtin's volume scales it too (the pets' petVolume)", async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'petHappy' });
      now += 200;
      await engine.result({ builtin: 'petHappy', volume: 0.5 });
      expect(ctx.sources[1].totalGain).toBeCloseTo(ctx.sources[0].totalGain * 0.5, 5);
    });

    it('fetches, decodes and caches a custom file', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({ fetchSound });
      await engine.result({ src: 'a.ogg', volume: 0.5 });
      now += 200;
      await engine.result({ src: 'a.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(ctx.sources.length).toBe(2);
      expect(ctx.sources[0].totalGain).toBeCloseTo(0.5, 5);
    });

    it('warns once per bad src and never refetches', async () => {
      const fetchSound = vi.fn(async () => {
        throw new Error('404');
      });
      const { engine } = await ready({ fetchSound });
      await expect(engine.result({ src: 'bad.ogg' })).resolves.toBeUndefined();
      await expect(engine.result({ src: 'bad.ogg' })).resolves.toBeUndefined();
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      await engine.result({ src: 'bad2.ogg' });
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('survives a decode failure', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({
        fetchSound,
        createContext: () => {
          ctx = new FakeAudioContext();
          ctx.decodeFails = true;
          return ctx;
        },
      });
      await expect(engine.result({ src: 'x.ogg' })).resolves.toBeUndefined();
      await engine.result({ src: 'x.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(ctx.sources.length).toBe(0);
    });

    it('evicts the least recently used custom file beyond 32', async () => {
      const fetchSound = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      const { engine } = await ready({ fetchSound });
      for (let i = 0; i < 33; i++) await engine.result({ src: `f${i}.ogg` });
      expect(fetchSound).toHaveBeenCalledTimes(33);
      now += 200;
      await engine.result({ src: 'f0.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(34);
      await engine.result({ src: 'f32.ogg' });
      expect(fetchSound).toHaveBeenCalledTimes(34);
    });
  });

  describe('the same landing sound on many dice', () => {
    const fetchSound = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

    it('plays one voice for requests that arrive together; different sounds each play', async () => {
      const { engine } = await ready({ fetchSound });
      const requests = [{ src: 'a.ogg' }, { builtin: 'chime' }];
      await Promise.all(Array.from({ length: 6 }, () => requests.map((r) => engine.result(r))).flat());
      expect(ctx.sources.length).toBe(2);
    });

    it('plays again once the window has passed', async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'chime' });
      now += RESULT_WINDOW_MS - 1;
      await engine.result({ builtin: 'chime' });
      expect(ctx.sources.length).toBe(1);
      now += 1;
      await engine.result({ builtin: 'chime' });
      expect(ctx.sources.length).toBe(2);
    });

    it("leaves pets' voices alone", async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'petHappy', rate: 1 });
      await engine.result({ builtin: 'petHappy', rate: 1 });
      expect(ctx.sources.length).toBe(2);
    });

    it('shares one voice between requests that waited for a slow file', async () => {
      const waiting = [];
      const slow = () => new Promise((resolve) => waiting.push(resolve));
      const { engine } = await ready({ fetchSound: slow });
      const first = engine.result({ src: 'slow.ogg' });
      now += RESULT_WINDOW_MS * 2;
      const second = engine.result({ src: 'slow.ogg' });
      await vi.advanceTimersByTimeAsync(0);
      for (const resolve of waiting) resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await Promise.all([first, second]);
      expect(ctx.sources.length).toBe(1);
    });

    it('takes the louder volume of the requests it merges', async () => {
      const { engine } = await ready();
      await engine.result({ builtin: 'chime', volume: 0.2 });
      await engine.result({ builtin: 'chime', volume: 1 });
      await engine.result({ builtin: 'chime', volume: 0.5 });
      expect(ctx.sources.length).toBe(1);
      expect(ctx.sources[0].totalGain).toBeCloseTo(1, 5);
    });

    it('makes room by stopping impacts first, however loud', async () => {
      const { engine } = await ready({ fetchSound });
      await engine.result({ src: 'quiet.ogg', volume: 0.1 });
      for (let i = 1; i < MAX_VOICES; i++) engine.impact(hit({ dieKey: `d${i}` }));
      expect(ctx.sources.length).toBe(MAX_VOICES);
      await engine.result({ src: 'last.ogg' });
      const stopped = ctx.sources.filter((v) => v.stopped);
      expect(stopped.length).toBe(1);
      expect(stopped[0]).not.toBe(ctx.sources[0]);
    });

    it('stops the quietest landing sound only when no impact is left', async () => {
      const { engine } = await ready({ fetchSound });
      for (let i = 0; i < MAX_VOICES; i++) await engine.result({ src: `f${i}.ogg`, volume: i === 3 ? 0.2 : 1 });
      await engine.result({ src: 'last.ogg', volume: 0.1 });
      expect(ctx.sources.length).toBe(MAX_VOICES + 1);
      expect(ctx.sources.filter((v) => v.stopped)).toEqual([ctx.sources[3]]);
    });
  });

  it('dispose closes the context and silences later calls', async () => {
    const { engine } = await ready();
    engine.impact(hit());
    engine.dispose();
    expect(ctx.state).toBe('closed');
    const n = ctx.sources.length;
    now += 100;
    engine.impact(hit());
    expect(ctx.sources.length).toBe(n);
  });
});
