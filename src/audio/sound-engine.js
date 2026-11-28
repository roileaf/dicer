// WebAudio sound engine: lazy AudioContext, pre-rendered synth buffers, voice cap, gains and
// cached custom files. Nothing here touches the dice box; callers feed it impact/result events.

export const MIN_IMPACT_SPEED = 4; // sim units/s; settling taps (p90 ~3.9) are silent
export const LOUD_IMPACT_SPEED = 24; // first floor impact median ~24 is full volume
export const MIN_GAIN = 0.03;
export const DIE_DEBOUNCE_MS = 40;
export const MAX_VOICES = 8;
/** The same landing sound due again within this many ms of its voice starting plays no second voice. */
export const RESULT_WINDOW_MS = 100;
export const IDLE_SUSPEND_MS = 30000;
export const CUSTOM_CACHE_SIZE = 32;
export const UNFOCUSED_GAIN = 0.25;
export const RATE_JITTER = 0.04;
// Buffers are rendered at a fixed rate and tagged with it; WebAudio resamples on playback,
// so the context's own rate never needs to be known before the first sound is due.
export const RENDER_RATE = 48000;
// Real recorded dice hits live in one audio sprite (assets/sounds/dice-hits.mp3 + .json).
export const SPRITE_PATHS = {
  audio: 'modules/dicer/assets/sounds/dice-hits.mp3',
  table: 'modules/dicer/assets/sounds/dice-hits.json',
};
// Dice recorded on a felt table (a different recording, not a filtered hard one): floor hits on
// a felt surface play these. Optional: without them felt falls back to SURFACE_COLOUR.felt.
export const FELT_SPRITE_PATHS = {
  audio: 'modules/dicer/assets/sounds/dice-hits-felt.mp3',
  table: 'modules/dicer/assets/sounds/dice-hits-felt.json',
};
// Loudness buckets on impactGain: a first floor impact (~24 sim units/s, gain 1) is heavy, the
// mid bounces are medium, late settling taps (speed < ~11) are light.
export const HEAVY_GAIN = 0.5; // speed >= ~18.1
export const MEDIUM_GAIN = 0.12; // speed >= ~10.9
export const SAMPLE_RATE_JITTER = 0.03;
const HIT_LEAD = 0.01; // seconds kept before each hit's onset and
const HIT_TAIL = 0.03; // after its end (hits are separated by 50 ms of silence)

// Colouring on top of the recording (resin dice on a hard table): a playbackRate factor and
// filters in order. Surfaces add an extra gain in dB.
export const MATERIAL_COLOUR = {
  plastic: { rate: 1, filters: [] },
  glass: { rate: 1, filters: [] },
  metal: { rate: 1.15, filters: [{ type: 'highshelf', frequency: 4000, gain: 4 }] },
  wood: { rate: 0.9, filters: [{ type: 'lowpass', frequency: 3500 }] },
  stone: { rate: 1.05, filters: [{ type: 'highshelf', frequency: 4000, gain: 2 }] },
  // jelly: the hard recordings pitched down, their click and ring taken off, a soft low body added
  squishy: { rate: 0.7, filters: [{ type: 'lowpass', frequency: 900, Q: 0.7 }, { type: 'peaking', frequency: 220, Q: 1, gain: 4 }] },
};
export const SURFACE_COLOUR = {
  // Only when the felt recordings are unavailable: a strongly muffled hard-table hit.
  felt: { db: -4, filters: [{ type: 'lowpass', frequency: 1200 }] },
  wood: { db: 0, filters: [] },
  stone: { db: 0, filters: [{ type: 'highshelf', frequency: 4000, gain: 3 }] },
  metal: { db: 0, filters: [{ type: 'peaking', frequency: 3000, Q: 1, gain: 4 }] },
};
const DIE_TYPES = new Set(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
const DIE_ALIAS = { d100: 'd10', d2: 'd6', d14: 'd10', d16: 'd12' };
const LEVEL_ORDER = {
  heavy: ['heavy', 'medium', 'light'],
  medium: ['medium', 'heavy', 'light'],
  light: ['light', 'medium', 'heavy'],
};

/** Loudness bucket of an impact gain (0..1): 'heavy' | 'medium' | 'light'. */
export function hitLevel(gain) {
  return gain >= HEAVY_GAIN ? 'heavy' : gain >= MEDIUM_GAIN ? 'medium' : 'light';
}

export function impactGain(speed) {
  if (!(speed > MIN_IMPACT_SPEED)) return 0;
  if (speed >= LOUD_IMPACT_SPEED) return 1;
  const t = (speed - MIN_IMPACT_SPEED) / (LOUD_IMPACT_SPEED - MIN_IMPACT_SPEED);
  return t * t;
}

const defaultIdle = (cb) => {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(() => cb(), { timeout: 1000 });
  return setTimeout(cb, 0);
};

export function createSoundEngine({
  createContext = () => new AudioContext(),
  loadSynth = () => import('./synth.js'),
  getSetting = () => undefined,
  hasFocus = () => (typeof document !== 'undefined' ? document.hasFocus() : true),
  fetchSound = (...a) => fetch(...a),
  idle = defaultIdle,
  resolveUrl = (p) => p,
  createDecodeContext = null, // decodes the sprite without waking the real context
  warn = (...a) => console.warn(...a),
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
  let ctx = null;
  let ctxFailed = false;
  let disposed = false;
  let rendered = null; // Map<key, Float32Array>
  let variants = 4;
  let preloading = null;
  let gestured = false;
  let gestureHooked = false;
  let idleTimer = null;
  const buffers = new Map(); // key -> AudioBuffer (built once a context exists)
  const cursor = new Map(); // material -> next variant
  const lastHit = new Map(); // dieKey -> time
  const custom = new Map(); // src -> AudioBuffer (LRU, insertion order)
  const failed = new Set();
  const inflight = new Map();
  let voices = []; // { src, gain, level, end }; a result voice also has `at` and, if shared, `key`
  let warnedCtx = false;
  let sprite = null; // { buffer, hits } once the recorded hits are decoded
  let spriteFailed = false;
  let spriteLoading = null;
  const lastPick = new Map(); // dieKey -> index of the hit it last played

  const setting = (k, fallback) => {
    try {
      return getSetting(k) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const volume = (k) => {
    const v = Number(setting(k, 1));
    return Number.isFinite(v) ? Math.max(0, v) : 1;
  };
  const focusFactor = () => {
    if (!setting('quietWhenUnfocused', true)) return 1;
    let f = true;
    try {
      f = hasFocus();
    } catch {
      /* assume focused */
    }
    return f ? 1 : UNFOCUSED_GAIN;
  };

  function ensureContext() {
    if (ctx) return ctx;
    if (ctxFailed || disposed) return null;
    try {
      ctx = createContext();
    } catch (e) {
      ctxFailed = true;
      if (!warnedCtx) {
        warnedCtx = true;
        warn('Dicer: WebAudio unavailable, sounds disabled', e);
      }
      return null;
    }
    return ctx;
  }

  function hookGesture() {
    if (gestureHooked) return;
    gestureHooked = true;
    const go = () => {
      gestured = true;
      resume();
    };
    try {
      if (typeof document !== 'undefined') document.addEventListener('pointerdown', go, { once: true });
    } catch {
      /* no DOM */
    }
    try {
      const p = globalThis.game?.audio?.awaitFirstGesture?.();
      if (p && typeof p.then === 'function') p.then(go, () => {});
    } catch {
      /* helper missing or throwing */
    }
  }

  function resume() {
    try {
      const r = ctx?.resume?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** True when the context can play right now; otherwise arranges a resume and says no. */
  function running() {
    if (ctx.state === 'running') return true;
    if (ctx.state === 'closed') return false;
    if (gestured) resume();
    else hookGesture();
    return false;
  }

  function bufferFor(key) {
    let b = buffers.get(key);
    if (b) return b;
    const data = rendered?.get(key);
    if (!data) return null;
    b = ctx.createBuffer(1, data.length, RENDER_RATE);
    b.copyToChannel(data, 0);
    buffers.set(key, b);
    return b;
  }

  function prune() {
    const t = ctx.currentTime;
    voices = voices.filter((v) => v.end > t);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function check() {
      if (!ctx || disposed) return;
      prune();
      if (voices.length) {
        idleTimer = setTimeout(check, IDLE_SUSPEND_MS);
        return;
      }
      if (ctx.state === 'running') {
        try {
          const r = ctx.suspend();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }, IDLE_SUSPEND_MS);
  }

  function start(buffer, gain, rate = 1, { filters = [], offset, duration } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src;
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.frequency;
      if (f.gain !== undefined) b.gain.value = f.gain;
      if (f.Q !== undefined) b.Q.value = f.Q;
      node.connect(b);
      node = b;
    }
    node.connect(g);
    g.connect(ctx.destination);
    const voice = { src, gain, level: g.gain, end: ctx.currentTime + (duration ?? buffer.duration) / rate };
    voices.push(voice);
    src.onended = () => {
      voices = voices.filter((v) => v !== voice);
    };
    if (duration === undefined) src.start(0);
    else src.start(0, offset, duration);
    armIdle();
    return voice;
  }

  /**
   * Make room for a voice of `gain`; false when it should be dropped instead. For a landing sound,
   * impacts stop first, and a result voice only when no impact is left.
   */
  function admit(gain, slots, landing) {
    prune();
    while (voices.length + slots > MAX_VOICES) {
      const impacts = landing ? voices.filter((v) => v.at === undefined) : [];
      const from = impacts.length ? impacts : voices;
      let q = from[0];
      for (const v of from) if (v.gain < q.gain) q = v;
      if (!q || q.gain >= gain) return false;
      try {
        q.src.stop();
      } catch {
        /* already ended */
      }
      voices = voices.filter((v) => v !== q);
    }
    return true;
  }

  /** A hit index of `set` (a decoded sprite) by level, die type, and not the die's last hit. */
  function pickHit(set, level, dieType, dieKey) {
    const hits = set.hits;
    const want = DIE_TYPES.has(dieType) ? dieType : DIE_ALIAS[dieType];
    const prev = dieKey === undefined ? undefined : lastPick.get(dieKey);
    const last = prev?.set === set ? prev.idx : undefined;
    for (const lv of LEVEL_ORDER[level]) {
      const pool = [];
      for (let i = 0; i < hits.length; i++) if (hits[i].level === lv && i !== last) pool.push(i);
      if (!pool.length) continue;
      const same = want ? pool.filter((i) => hits[i].die === want) : [];
      const from = same.length ? same : pool;
      return from[Math.floor(Math.random() * from.length)];
    }
    return -1;
  }

  function playSample({ material, surface, level, gain, other, dieKey, dieType, t }) {
    const floor = other === -1;
    // A felt floor plays the felt recordings as they are; any other floor colours the hard ones.
    const onFelt = floor && surface === 'felt' && sprite.felt;
    const set = onFelt ? sprite.felt : sprite;
    const idx = pickHit(set, level, dieType, dieKey);
    if (idx < 0) return;
    const hit = set.hits[idx];
    const mat = MATERIAL_COLOUR[material] ?? MATERIAL_COLOUR.plastic;
    const surf = floor && !onFelt ? SURFACE_COLOUR[surface] : null;
    const g = gain * (surf ? 10 ** (surf.db / 20) : 1);
    if (!admit(g, 1)) return;
    if (dieKey !== undefined) {
      lastHit.set(dieKey, t);
      lastPick.set(dieKey, { set, idx });
    }
    const jitter = 1 + (Math.random() * 2 - 1) * SAMPLE_RATE_JITTER;
    start(set.buffer, g, mat.rate * jitter, {
      filters: [...mat.filters, ...(surf?.filters ?? [])],
      offset: Math.max(0, hit.start - HIT_LEAD),
      duration: hit.duration + HIT_LEAD + HIT_TAIL,
    });
  }

  function impact({ material, surface, speed, other, dieKey, dieType } = {}) {
    try {
      if (disposed || !setting('sounds', true)) return;
      const gain = impactGain(speed) * volume('soundVolume') * focusFactor();
      if (gain < MIN_GAIN) return;
      const t = now();
      if (dieKey !== undefined) {
        const last = lastHit.get(dieKey);
        if (last !== undefined && t - last < DIE_DEBOUNCE_MS) return;
      }
      if (!sprite && !spriteFailed) {
        if (!spriteLoading) preload(); // late start: this impact is dropped, the next ones play
        return;
      }
      if (sprite) {
        if (!ensureContext() || !running()) return;
        const level = hitLevel(impactGain(speed));
        playSample({ material: material ?? 'plastic', surface, level, gain, other, dieKey, dieType, t });
        if (lastHit.size > 256) {
          for (const [k, v] of lastHit) {
            if (t - v > 1000) {
              lastHit.delete(k);
              lastPick.delete(k);
            }
          }
        }
        return;
      }
      if (!rendered) return; // synth not ready yet; a late clatter is worse than none
      if (!ensureContext() || !running()) return;

      const mat = material ?? 'plastic';
      const n = cursor.get(mat) ?? 0;
      let buf = null;
      for (let i = 0; i < variants && !buf; i++) buf = bufferFor(`impact:${mat}:${(n + i) % variants}`);
      if (!buf) return;
      const floor = other === -1;
      const surf = floor ? bufferFor(`surface:${surface}`) : null;
      if (!admit(gain, surf ? 2 : 1)) return;

      cursor.set(mat, (n + 1) % variants);
      if (dieKey !== undefined) lastHit.set(dieKey, t);
      if (lastHit.size > 256) for (const [k, v] of lastHit) if (t - v > 1000) lastHit.delete(k);
      start(buf, gain, 1 + (Math.random() * 2 - 1) * RATE_JITTER);
      if (surf) start(surf, gain, 1 + (Math.random() * 2 - 1) * RATE_JITTER);
    } catch (e) {
      warn('Dicer: impact sound failed', e);
    }
  }

  async function customBuffer(src) {
    if (custom.has(src)) {
      const b = custom.get(src);
      custom.delete(src);
      custom.set(src, b);
      return b;
    }
    if (failed.has(src)) return null;
    if (inflight.has(src)) return inflight.get(src);
    const p = (async () => {
      try {
        const res = await fetchSound(src);
        if (res && res.ok === false) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(bytes);
        custom.set(src, buf);
        while (custom.size > CUSTOM_CACHE_SIZE) custom.delete(custom.keys().next().value);
        return buf;
      } catch (e) {
        failed.add(src);
        warn(`Dicer: sound file ${src} could not be loaded`, e);
        return null;
      } finally {
        inflight.delete(src);
      }
    })();
    inflight.set(src, p);
    return p;
  }

  const own = (sound, c) => {
    try {
      return typeof sound.voice === 'function' ? sound.voice(c) : null;
    } catch {
      return null; // the shared take
    }
  };
  async function result(sound) {
    try {
      if (disposed || !sound || !setting('sounds', true)) return;
      let vol = volume('effectsVolume') * volume('soundVolume') * focusFactor();
      if (sound.src === undefined && sound.builtin === undefined) return;
      vol *= sound.volume ?? 1; // a file's own volume, or the pets' (petVolume)
      if (vol < MIN_GAIN / 10) return;
      if (sound.builtin !== undefined && !rendered && preloading) await preloading;
      if (disposed || !ensureContext() || !running()) return;
      let buf;
      if (sound.src !== undefined) buf = await customBuffer(String(sound.src));
      // sound.voice(ctx): a pet's own take on the builtin, in its kind's voice (pet chunk voices.js)
      else buf = own(sound, ctx) || (rendered ? bufferFor(`result:${sound.builtin}`) : null);
      if (!buf || disposed) return;
      if (ctx.state !== 'running') return;
      // Dice landing together ask for one sound at once: stacked voices would add up to a louder one.
      // A pet's voice (its own take or pitch) is left alone. Checked here, after any wait for the
      // buffer, so requests that waited for one file together still share a voice.
      const shared = sound.voice === undefined && sound.rate === undefined;
      const key = shared ? (sound.src !== undefined ? `s:${sound.src}` : `b:${sound.builtin}`) : null;
      const at = now();
      if (shared) {
        const playing = voices.find((v) => v.key === key && at - v.at < RESULT_WINDOW_MS);
        if (playing) {
          if (vol > playing.gain) playing.level.value = playing.gain = vol; // the louder request wins
          return;
        }
        admit(Infinity, 1, true);
      }
      // sound.rate: a pet's voice pitch (playback rate, 0.5..2)
      const rate = sound.rate > 0 ? Math.min(2, Math.max(0.5, sound.rate)) : 1;
      Object.assign(start(buf, vol, rate), { key, at });
    } catch (e) {
      warn('Dicer: result sound failed', e);
    }
  }

  /** Fetches and decodes one sprite: `{buffer, hits}`; throws on any failure. */
  async function fetchSprite(paths, dc) {
    const [tableRes, audioRes] = await Promise.all([
      fetchSound(resolveUrl(paths.table)),
      fetchSound(resolveUrl(paths.audio)),
    ]);
    if (tableRes?.ok === false || audioRes?.ok === false) throw new Error('HTTP error');
    const table = await tableRes.json();
    const hits = (table?.hits ?? []).filter(
      (h) => Number.isFinite(h?.start) && Number.isFinite(h?.duration) && h.duration > 0,
    );
    if (!hits.length) throw new Error('empty hit table');
    const buffer = await dc.decodeAudioData(await audioRes.arrayBuffer());
    return { buffer, hits };
  }

  async function loadSprite() {
    let dc;
    try {
      dc = createDecodeContext
        ? createDecodeContext()
        : typeof OfflineAudioContext === 'function'
          ? new OfflineAudioContext(1, 1, RENDER_RATE)
          : ensureContext();
      if (!dc) throw new Error('no audio context to decode with');
    } catch (e) {
      spriteFailed = true;
      warn('Dicer: recorded dice sounds could not be loaded, using synthesized ones', e);
      return;
    }
    const [table, felt] = await Promise.allSettled([fetchSprite(SPRITE_PATHS, dc), fetchSprite(FELT_SPRITE_PATHS, dc)]);
    if (table.status === 'rejected') {
      spriteFailed = true;
      warn('Dicer: recorded dice sounds could not be loaded, using synthesized ones', table.reason);
      return;
    }
    if (felt.status === 'rejected') {
      warn('Dicer: felt-table dice sounds could not be loaded, muffling the hard-table ones', felt.reason);
    }
    if (!disposed) sprite = { ...table.value, felt: felt.status === 'fulfilled' ? felt.value : null };
  }

  async function loadRendered() {
    try {
      const mod = await loadSynth();
      if (Number.isInteger(mod.VARIANTS) && mod.VARIANTS > 0) variants = mod.VARIANTS;
      rendered = await mod.renderAll(RENDER_RATE, { idle });
    } catch (e) {
      warn('Dicer: sound synthesis failed', e);
    }
  }

  function preload() {
    if (preloading) return preloading;
    spriteLoading = loadSprite();
    // The synth stays loaded: it renders the built-in result sounds and the impact fallback.
    preloading = Promise.all([spriteLoading, loadRendered()]).then(() => {});
    return preloading;
  }

  function dispose() {
    disposed = true;
    clearTimeout(idleTimer);
    voices = [];
    buffers.clear();
    custom.clear();
    sprite = null;
    try {
      const r = ctx?.close?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  return { impact, result, preload, dispose };
}
