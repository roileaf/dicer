import * as THREE from 'three';
import { getShape, labelFor, resultOf, shapeTypeFor, baseTypeOf } from '../core/dice-shapes.js';
import { buildDieGeometry } from '../core/chamfer.js';
import {
  createDiceMaterial,
  chainShaderHook,
  setDicerTime,
  isolateMaterial,
  DEFAULT_FLAGS,
} from '../render/dice-material.js';
import { MATERIALS } from '../api/theme-registry.js';
import { getLookExtras, requestLookExtras } from '../render/extras-loader.js';
import {
  DEFAULT_APPEARANCE,
  appearanceKey,
  normalizeAppearance,
  programKey,
} from '../look/appearance.js';
import { GHOST_APPEARANCE } from '../compat/colorset-map.js';
import { modelRotationFor } from '../compat/dsn-orientation.js';
import { lookFacesFor } from '../compat/faces.js';
import { Playback, RAMP_STEPS } from './playback.js';
import { soundMaterialOf } from '../audio/sound-material.js';
import { MAX_FREE_STEPS, MAX_OBSTACLES, MAX_STEPS, STEP_SECONDS, maySplat } from '../physics/protocol.js';
import { normalizeSeed, randomSeed, throwEdge } from '../core/rng.js';
import { fitDieCapacity, toDieArea } from '../areas/area-model.js';

/** Die edge size on screen, in CSS px, at diceScale 1. One world unit is one die size. */
export const DIE_SIZE_PX = 48;
export const FADE_MS = 400;
const DEFAULT_LINGER_MS = 2000;
/** R12 stall timeouts, measured from roll(). */
export const FIRST_CHUNK_TIMEOUT_MS = 5000;
export const DONE_TIMEOUT_MS = 15000;
/** After done: a roll that has not landed by its playback duration plus this fails. */
export const LANDING_GRACE_MS = 3000;
/**
 * Longest wait for a roll's face layers and models (face-textures caps each image at 4000 ms;
 * the margin lets that cap win). Past it the roll plays with whatever has arrived and the rest
 * falls back, even if a loader never settles.
 */
export const ASSET_WAIT_MS = 4250;
/** Dice So Nice's built-in system id: its presets share Dicer's plain material cache. */
const STANDARD_SYSTEM = 'standard';
/** Die types whose materials acquireWarmup() builds by default. */
export const WARMUP_TYPES = Object.freeze(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
/** The DiceSystem.DICE_EVENT_TYPE values DiceBox fires (api.js; CLICK and COLLIDE are not). */
const DICE_EVENT = Object.freeze({ SPAWN: 0, RESULT: 2, DESPAWN: 4 });
const MATERIAL_HOOKS = ['getCacheString', 'processMaterial', 'beforeShaderCompile'];

/**
 * Clone a cached die material for the fade. Material.clone() deep-copies userData through
 * JSON, which would serialise the label and atlas textures, so userData is shared instead
 * (the clone never writes to it). The original is left exactly as it was.
 */
export function cloneForFade(material) {
  const userData = material.userData;
  material.userData = {};
  let clone;
  try {
    clone = material.clone();
  } finally {
    material.userData = userData;
  }
  clone.userData = userData;
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  clone.defines = { ...material.defines }; // clone() resets them to three's own
  clone.transparent = true;
  clone.depthWrite = false;
  return clone;
}

/** GLTF loading lives in its own chunk, fetched the first time a roll shows a model. */
const importModel = (url, options) =>
  import('../render/model-loader.js').then((m) => m.loadForBox(url, options));

/** True when a face set has image or text faces (drawn from face layers). */
/**
 * The colour a die's light pool takes on the table (scene.js shadowFor), or null: a clear body
 * (resin, jelly) passes light in its own colour (a resin's inside, when it has one, in the inside's
 * main colour), as bright as white at that hue. A glowing die (any body) lights it in its glow
 * colour instead, by its glow strength. Other opaque bodies cast only their shadow.
 */
export function poolColor(a) {
  // a glowing die lights the table in its glow colour (strength 0.3 up; full at 1)
  const g = a?.glow?.intensity;
  if (Number.isFinite(g) && g >= 0.3) {
    const c = new THREE.Color(a.glow.color);
    const m = Math.max(c.r, c.g, c.b);
    if (m > 0.02) return c.multiplyScalar(Math.min(1, g) / m);
  }
  const t = a?.body?.type;
  if (t !== 'resin' && t !== 'jelly') return null;
  const c = new THREE.Color(t === 'resin' && a.interior?.type && a.interior.type !== 'none' ? a.interior.colors?.[0] : a.body.color);
  const m = Math.max(c.r, c.g, c.b);
  return m > 0.02 ? c.multiplyScalar(1 / m) : null;
}

function needsLayers(faces) {
  return (
    Array.isArray(faces?.labels) &&
    faces.labels.some((l) => l?.kind === 'image' || l?.kind === 'text')
  );
}

/** An id per face-texture result: a layered material is keyed to the texture it samples. */
const faceTexIds = new WeakMap();
let nextFaceTexId = 1;
function faceTexId(faceTex) {
  if (!faceTexIds.has(faceTex)) faceTexIds.set(faceTex, nextFaceTexId++);
  return faceTexIds.get(faceTex);
}

/**
 * Orchestrates rolls: physics stream -> Playback -> scene, on one shared render loop.
 * Each roll resolves `landed` once its dice come to rest and `finished` after the linger
 * (timeBeforeHide) and a 400 ms fade. When no roll remains the tick returns false, so the
 * renderer stops and hides its canvas.
 *
 * Each roll snapshots the look (getAppearance) and feature flags (getFlags) when it starts.
 * Materials are cached by appearanceKey|programKey|type|variant|faces.key|ghost and refcounted per roll:
 * invalidateMaterials() drops them from the cache and marks them stale, and a stale material
 * is disposed when the last roll (or warm-up) holding it lets go. At most IDLE_MATERIAL_CAP
 * cached materials held by nothing are kept; beyond that the least recently used is evicted
 * and disposed, so per-roll appearances cannot grow the cache without bound.
 */
/** How many cached materials no roll or warm-up holds are kept (least recently used evicted). */
export const IDLE_MATERIAL_CAP = 64;
/**
 * Geometries are cached per die type and edge step (five steps, so at most 5 x types exist) and
 * refcounted per roll like materials; this many held by nothing are kept, the least recently
 * used disposed beyond it.
 */
export const IDLE_GEOMETRY_CAP = 16;

export class DiceBox {
  constructor({
    renderer,
    physics,
    atlas,
    appearance,
    getAppearance,
    getFlags = () => DEFAULT_FLAGS,
    shadows = () => true,
    lightPools = () => false,
    getArea,
    diceScale = () => 1,
    timeBeforeHide = () => DEFAULT_LINGER_MS,
    visibility = globalThis.document,
    faceTextures = null,
    faceLayers = () => true,
    loadModel = importModel,
    modelPresets = () => true,
    onModelLoaded = () => {},
    presetFor = () => null,
    onMaterial = () => {},
    systemFor = () => null,
    onImpact = () => {},
    getSurface = () => 'felt',
    onLandedFx = () => {},
    effects = null,
    fonts = null,
    pet = null,
    onLayer = null,
  }) {
    this._renderer = renderer;
    // onLayer(mine): told when "a roll of this user is on screen" changes (dice above windows).
    this._onLayer = onLayer;
    this._mineShown = false;
    this._physics = physics;
    this._atlas = atlas;
    // The font layer (fonts/font-atlas.js) or null: the atlas of a look's numbers.font. A font
    // not ready yet draws with the serif `atlas` and is requested; once it is ready only the
    // cached materials built with a serif stand-in for it are rebuilt (rolls in flight keep theirs).
    this._fonts = fonts;
    this._offFontReady = null;
    try {
      this._offFontReady = fonts?.onReady?.((id) => this.invalidateFont(id)) ?? null;
    } catch (err) {
      console.warn('dicer: cannot watch the font layer', err);
    }
    // The fixed `appearance` option (Plan 1) is kept as a constant getter.
    this._getAppearance = getAppearance ?? (() => appearance ?? DEFAULT_APPEARANCE);
    this._getFlags = getFlags;
    this._shadows = shadows;
    this._lightPools = lightPools; // clear and glowing dice light the table (diceLight setting)
    this._getArea = getArea;
    this._diceScale = diceScale;
    this._timeBeforeHide = timeBeforeHide;
    this._faceTextures = faceTextures; // face-textures.js; null: text/image faces show numbers
    this._faceLayers = faceLayers; // the presetFaces setting
    this._loadModel = loadModel; // (url, { radius }) -> Promise<{ geometry, material }>
    this._modelPresets = modelPresets; // the presetModels setting
    this._onModelLoaded = onModelLoaded; // (url) after a successful load: registry.noteModelLoaded
    this._presetFor = presetFor; // (system, dsnType) -> registry preset or null
    // (material, dsnType, appearance, preset) once per material built for a die with a preset
    // (main.js: diceSoNiceOnMaterialReady for non-standard systems, P3-R3)
    this._onMaterial = onMaterial;
    // (systemId) -> the DiceSystem instance it was registered with, or null (api.js): its
    // material callbacks and dice events apply to that system's dice.
    this._systemFor = systemFor;
    // ({ material, surface, speed, other, dieKey, dieType }) per impact the playhead crosses (sound engine)
    this._onImpact = onImpact;
    this._getSurface = getSurface;
    // (die, fx, rollKey) once per landed die carrying fx (never a ghost, never a d100's tens
    // die): plays the result sound and macro (main.js). rollKey is one object per roll.
    this._onLandedFx = onLandedFx;
    this._fxWarned = false;
    // The effect layer (effect-layer.js), or null: plays each landed die's effects and keeps
    // the loop alive while they run.
    this._effects = effects;
    this._effectsWarned = false;
    // The pet layer: a PetHook or () => PetHook|null, resolved at each roll's reveal. A roll
    // started with a PetSpec gets begin / landed / leave / end; update(now) runs every frame.
    this._pet = pet;
    this._petHook = null;
    this._petUpdateDead = false;
    this._hookWarned = false;
    this._rollSeq = 0;
    this._systemWarned = new Set(); // system id|kind: one warning each
    this._geometries = new Map(); // type|edge radius -> BufferGeometry (P2-R5, P7-D2)
    this._geoRefs = new Map(); // geometry -> { refs, key }
    this._idleGeo = new Set(); // cached geometries with refs 0, least recently used first
    this._materials = new Map(); // appearanceKey|programKey|type|variant|faces.key|ghost -> material
    this._refs = new Map(); // material -> { refs, stale, key }, cached and stale materials alike
    this._idle = new Set(); // cached materials with refs 0, least recently used first
    this._rolls = new Set();
    this._area = null; // the stage in die units: {halfWidth, halfDepth}
    this._lastRoll = null; // {area, rect, stage, diePx, dice} of the latest roll (lastRollArea)
    this._stageRect = null; // the stage in px, as getArea() gave it at the last onResize
    this._diePx = DIE_SIZE_PX;
    this._tick = (now) => {
      this.#layer();
      return this.#frame(now);
    };
    this.onResize();
    renderer.onContextLost?.(() => this.clear());
    // Rolls waiting for their first rendered frame (armFirstFrame); empty almost always, so the
    // per-frame check is one length test and allocates nothing.
    this._firstFrameWaiters = [];
    this._armedFirstFrame = null;
    renderer.onFrameTime?.(() => {
      if (this._firstFrameWaiters.length) this.#flushFirstFrames();
    });
    // A hidden tab gets no animation frames, so nothing could land: drop every roll.
    this._visibility = visibility ?? null;
    // Visible again (or a restored context): resting pets are drawn again.
    this._onVisibility = () => (this._visibility?.hidden ? this.clear() : this.wake());
    renderer.onContextRestored?.(() => this.wake());
    this._visibility?.addEventListener?.('visibilitychange', this._onVisibility);
  }

  get activeRolls() {
    return this._rolls.size;
  }

  /** Rolls still in view: not yet fading out, plus dice held for a throw (a tray waits for these). */
  get showingRolls() {
    let n = this._hold ? 1 : 0;
    for (const roll of this._rolls) if (roll.phase !== 'fading') n++;
    return n;
  }

  // Rolling by hand: `this.hand` is set by the lazy hand chunk (src/hand/chunk/box.js handFor):
  // read (Playback's free-dice reader), land (values, the d16 glow), record, decorate and hold. It
  // builds on _newRoll, _throw, _finish, _reveal, _fireResults, _fireFx and _systemOf (internal API,
  // not private: private methods are lowered to helper calls in the bundle, which cost bytes).

  /** True while hold() shows dice that are not yet released or dropped (pets hold still: H-8). */
  get holding() {
    return !!this._hold;
  }

  /** The pet hook's alignFor (H-6: a replay moves the pets to the thrower's layout): the ids it aligned; never throws. */
  alignFor(list, area, paths) {
    return this.#hookCall((h) => h.alignFor?.(list, area, paths));
  }

  /**
   * Refit the camera, physics walls and canvas to getArea(), in die units. The only caller of
   * fitArea: a per-throw area never moves the camera or the canvas.
   */
  onResize() {
    const rect = this._getArea();
    const px = DIE_SIZE_PX * this._diceScale();
    this._stageRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    this._diePx = px;
    this._area = { halfWidth: rect.width / 2 / px, halfDepth: rect.height / 2 / px };
    this._renderer.sceneApi.fitArea(this._area);
    this._physics.resize(this._area);
    this._renderer.setArea(rect);
    // The pet layer's stage: die units, plus the px rect it measures Foundry's UI against.
    this._stage = { cx: 0, cz: 0, ...this._area, rect: this._stageRect };
    this.#hookCall((h) => h.areaChanged?.(this._stage));
  }

  /**
   * A px area (an area resolver's rectFor; null: the stage) as the die-unit area a throw of `n`
   * dice uses there.
   */
  dieArea(rect, n = 0) {
    return this.#throwArea(rect, n)?.area ?? { cx: 0, cz: 0, ...this._area };
  }

  /** Starts the render loop when it is stopped or held (a resting pet starts to move, a setting changed). */
  wake() {
    this._renderer.startLoop(this._tick);
  }

  /**
   * Calls an optional hook method outside a roll's pet bookkeeping (obstaclesFor, hit,
   * areaChanged: they concern pets of other users too), on `hook` or, without one, on the pet
   * hook now (a PetHook or the getter's answer). A throw warns once and is swallowed.
   */
  #hookCall(fn, hook) {
    try {
      hook ??= typeof this._pet === 'function' ? this._pet() : this._pet;
      return hook ? fn(hook) : undefined;
    } catch (err) {
      if (!this._hookWarned) console.warn('Dicer | pet', err);
      this._hookWarned = true;
      return undefined;
    }
  }

  /**
   * A per-throw area (px rect {left, top, width, height}) clamped inside the stage, in die units
   * relative to the stage centre, grown around its centre until it holds `n` dice (P5-R6:
   * fitDieCapacity); null for none or a malformed rect (the stage is used).
   */
  #throwArea(rect, n) {
    const stage = this._stageRect;
    if (!rect || typeof rect !== 'object' || !stage) return null;
    const { left, top, width, height } = rect;
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    if (!(this._diePx > 0) || !(stage.width > 0) || !(stage.height > 0)) return null;
    const w = Math.min(width, stage.width);
    const h = Math.min(height, stage.height);
    const clamped = {
      left: Math.min(Math.max(left, stage.left), stage.left + stage.width - w),
      top: Math.min(Math.max(top, stage.top), stage.top + stage.height - h),
      width: w,
      height: h,
    };
    // A strict rect (a dice tray) keeps its size: never grown past what the player sees, its
    // dice pile up inside it instead (room for one die at least).
    return {
      rect: clamped,
      // a tray's shape goes to the physics: its walls follow the outline (sim.js shapeEdges)
      area: { ...fitDieCapacity(toDieArea(clamped, stage, this._diePx), rect.strict ? 1 : n, this._area), ...(rect.shape && { shape: rect.shape }) },
    };
  }

  /**
   * The area the most recent roll used (P5-R4, read by the owner live test through
   * game.dice3d._debug.lastRollArea): `area` is the die-unit area it threw in (after growing to
   * hold the dice; the whole stage when no area was given) and `rect` the px rect asked for,
   * clamped inside the stage (the stage rect when none). `stage` is the stage px rect, `diePx` the px
   * per die unit and `dice` the settled die centres in die units from the stage centre, x right and
   * z down (null until the roll lands). A copy; null before any roll.
   */
  get lastRollArea() {
    const l = this._lastRoll;
    if (!l) return null;
    return {
      area: { ...l.area },
      rect: { ...l.rect },
      stage: { ...l.stage },
      diePx: l.diePx,
      dice: l.dice ? l.dice.map((d) => ({ ...d })) : null,
    };
  }

  /**
   * cb() once, when the next roll() call's dice are first drawn (the benchmark's first-frame
   * mark; the message gate arms it just before throwing). Dropped when that roll never draws.
   */
  armFirstFrame(cb) {
    this._armedFirstFrame = typeof cb === 'function' ? cb : null;
  }

  #waitFirstFrame(roll) {
    if (roll.onFirstFrame) this._firstFrameWaiters.push(roll);
  }

  #flushFirstFrames() {
    const waiters = this._firstFrameWaiters.splice(0);
    for (const roll of waiters) {
      const cb = roll.onFirstFrame;
      roll.onFirstFrame = null;
      if (roll.removed || !cb) continue;
      try {
        cb();
      } catch (err) {
        console.warn('dicer: a first-frame listener threw', err);
      }
    }
  }

  /**
   * @param {import('./throw-planner.js').DieSpec[]} specs
   * @param {object} [options]
   *   `area`: this throw's roll area in page px ({left, top, width, height}, clamped inside the
   *   stage); absent, the whole stage.
   *   `capacityDice`: the dice that share this area (a throw group's total), when more than this roll's.
   *   `pet`: the PetSpec ({ userId, kind, color, ghost }) of the pet that appears for this roll, or none.
   *   `mine`: this user's own roll (diceAboveWindows 'mine' lifts the canvas while it shows);
   *   'always': a preview throw (the editors' Throw buttons), lifted whatever the setting.
   *   Rolling by hand:
   *   `free`: physics decides every face (as does a spec's `free`): the worker nudges cocked dice,
   *   Playback never holds or forces them and reads each result. The pet hook hears `hand: true`.
   *   `launch`: per-die release states for the worker (THROW.launch). `seed`: the throw's seed (four uint32 words, or a legacy integer; absent: a fresh 128-bit one).
   *   `edge`: the pet edge 0..3 (a hand throw passes handEdge(launch, area)); else throwEdge(seed).
   *   `record(rec)`: once at physics done, with {chunks, events, settledStep, nudges,
   *   dice: [{shapeType, key}], area, obstacles: [{id, x, z, r, h}], splatSpeed}.
   *   `source`: {onChunk(cb), done, obstacleIds}: frames instead of physics (a replay). No THROW,
   *   no obstaclesFor; impacts -3 - i hit source.obstacleIds[i].
   *   Recorded and source chunks are never recycled to the worker.
   *   Free dice, `record` and `values` need the hand chunk attached (this.hand).
   * @returns {{landed: Promise<void>, finished: Promise<void>, values: Promise<number[]|null>,
   *   handle: object}} `values` resolves at landing, in spec order: each die's Foundry result (a
   *   free die's read one, a forced die's own); a d100 in its ones-die slot, its tens slot null.
   *   It resolves null for a roll that never lands, or without the hand chunk. `handle` is for
   *   decorateLanded.
   */
  roll(specs, options) {
    // Empty, or a hidden tab (no animation frames would ever land it): resolve at once.
    if (!specs?.length || this._visibility?.hidden === true) {
      const roll = this._newRoll();
      this._armedFirstFrame = null;
      roll.resolveValues(specs?.length ? null : []);
      roll.resolveRead(specs?.length ? null : []);
      roll.resolveLanded();
      roll.resolveFinished();
      return roll.result;
    }
    return this._throw(this._newRoll(specs), options);
  }

  /**
   * Shows `specs` held (rolling by hand), with their looks, once their assets are in (at most
   * ASSET_WAIT_MS): `ready`. setPose(i, {x, y, z}, {x, y, z, w}) places die i in die units; the
   * render loop runs only while dice are held. release(rollOptions) throws these same die objects
   * as roll() would (area defaults to the hold's) and returns roll()'s result; drop() removes them.
   * Once released or dropped, both do nothing more (release returns the same result).
   * One hold at a time: a new one drops the last. The body is the hand chunk's (this.hand).
   */
  hold(specs, options) {
    return this.hand.hold(specs, options);
  }

  /**
   * A roll record with its promises, not in flight. With `specs`, its dice are built (hidden, in
   * the scene) and their assets start loading (roll.assets); a build that throws fails the roll.
   */
  _newRoll(specs) {
    const roll = {
      dice: [],
      shadows: [],
      fades: null,
      materials: new Set(),
      geometries: new Set(),
      phase: 'playing',
      removed: false,
      pet: null,
    };
    roll.landed = new Promise((r) => (roll.resolveLanded = r));
    roll.finished = new Promise((r) => (roll.resolveFinished = r));
    const values = new Promise((r) => (roll.resolveValues = r));
    const read = new Promise((r) => (roll.resolveRead = r));
    roll.result = { landed: roll.landed, finished: roll.finished, values, read, handle: roll };
    roll.assets = Promise.resolve();
    if (specs) {
      try {
        const rollLook = normalizeAppearance(this._getAppearance());
        const flags = this.#flags();
        roll.flags = flags;
        roll.id = ++this._rollSeq;
        for (const spec of specs) roll.dice.push(this.#makeDie(spec, roll, flags, rollLook));
        // Only this client's animation slows down (Task 8 reads it); fx exist on real dice only.
        roll.slowMotion = roll.dice.some((d) => d.fx?.some((f) => f?.slowMotion === true));
        roll.assets = this.#acquireAssets(roll);
        for (const die of roll.dice) this._renderer.scene.add(die.outer);
      } catch (err) {
        this.#fail(roll, err);
      }
    }
    return roll;
  }

  /** Puts a built roll in flight: physics (or a source) -> Playback. Returns roll()'s result. */
  _throw(roll, { area, capacityDice, pet, free, launch, seed, edge, record, source, mine } = {}) {
    const result = roll.result;
    roll.onFirstFrame = this._armedFirstFrame;
    this._armedFirstFrame = null;
    if (roll.removed) return result;
    // A released hold is always this user's own throw (rolling by hand).
    roll.mine = mine === 'always' ? 'always' : mine === true || this._hold === roll;
    if (this._hold === roll) this._hold = null;
    if (this._visibility?.hidden === true) {
      this._finish(roll);
      return result;
    }
    this._rolls.add(roll);
    try {
      roll.pet = pet ? { spec: pet, key: null, begun: false, left: false, dead: false } : null;
      roll.revealed = false; // a released hold is revealed again: its pet begins then
      roll.free = free === true || roll.dice.some((d) => d.free);
      for (const die of roll.dice) die.free = roll.free;
      // Free dice are read by the hand chunk: without it they land unread (values null).
      if (roll.free && !this.hand) this._freeWarned ||= !console.warn('dicer: free dice need the hand chunk');
      roll.keep = !!(record || source); // chunks the recording or the source still owns
      const n = roll.dice.length;
      const thrown = this.#throwArea(
        area,
        Math.max(n, Number.isFinite(capacityDice) ? capacityDice : 0),
      );
      const throwArea = thrown?.area ?? null;
      this._lastRoll = roll.record = {
        area: throwArea ?? { cx: 0, cz: 0, ...this._area },
        rect: thrown?.rect ?? { ...this._stageRect },
        stage: { ...this._stageRect },
        diePx: this._diePx,
        dice: null, // the settled die centres, filled when the roll lands
      };
      roll.playback = new Playback({
        dice: roll.dice,
        area: throwArea ?? this._area,
        read: this.hand?.read,
      });
      roll.received = 0;
      // A caller's seed (128-bit or a legacy integer) as given; else a fresh 128-bit crypto seed.
      seed = normalizeSeed(seed) ?? randomSeed();
      roll.seed = seed;
      roll.edge = [0, 1, 2, 3].includes(edge) ? edge : throwEdge(seed);
      // only a check's d20 may splat a pet (pets.js maySplat): the sim lets the rest bounce off
      const req = { dice: roll.dice.map((d) => ({ type: d.shapeType, ...(!maySplat(d.shapeType, d.damageType) && { splat: false }) })), seed };
      if (throwArea) req.area = throwArea;
      if (roll.free) req.free = true;
      if (Array.isArray(launch)) req.launch = launch;
      let stream = source;
      if (source) {
        roll.hook = this.#hookCall((h) => h);
        roll.ids = source.obstacleIds;
      } else {
        // Resting pets of any user are obstacles for every throw; the hook is the one begin uses.
        this.#hookCall((h) => {
          roll.hook = h;
          const o = h.obstaclesFor?.({
            spec: pet ?? null,
            edge: roll.edge,
            hand: roll.free,
            area: { ...roll.record.area },
            stage: this._stage,
          });
          const list = Array.isArray(o)
            ? o.filter((e) => e && typeof e === 'object').slice(0, MAX_OBSTACLES)
            : [];
          if (!list.length) return;
          roll.ids = list.map((e) => e.id);
          req.obstacles = list.map(({ x, z, r, h }) => ({ x, z, r, h }));
          if (h.splatSpeed > 0) req.splatSpeed = h.splatSpeed; // the sim splats too (null: petSplat off)
        });
        stream = this._physics.throw(req);
      }
      const recycle = (data) => roll.keep || this._physics.recycle(data);
      // Stall guards (R12): a worker that never answers must not keep a roll alive.
      roll.firstChunkTimer = setTimeout(
        () => this.#fail(roll, new Error(`no physics chunk within ${FIRST_CHUNK_TIMEOUT_MS} ms`)),
        FIRST_CHUNK_TIMEOUT_MS,
      );
      roll.doneTimer = setTimeout(
        () => this.#fail(roll, new Error(`physics not done within ${DONE_TIMEOUT_MS} ms`)),
        DONE_TIMEOUT_MS,
      );
      stream.onChunk((chunk) => {
        if (roll.removed) {
          recycle(chunk.data);
          return;
        }
        let pushed = false;
        try {
          roll.playback.push(chunk);
          pushed = true;
          roll.received += 1;
          if (chunk.done) {
            clearTimeout(roll.doneTimer);
            // Only this client's playback: eases down over the last 60 steps before landing.
            if (roll.slowMotion) {
              const settledStep = roll.playback.frames - 1;
              roll.playback.setSpeedRamp({ fromStep: settledStep - RAMP_STEPS });
            }
          }
          if (roll.received === 1) {
            clearTimeout(roll.firstChunkTimer);
            // The loop starts only once there is a frame to draw (zero idle GPU work).
            if (!roll.assetsPending) {
              this.#waitFirstFrame(roll);
              this._renderer.startLoop(this._tick);
            }
          }
        } catch (err) {
          if (!pushed) recycle(chunk.data);
          this.#fail(roll, err);
        }
      });
      stream.done.then(
        (res) => {
          if (record) this.hand?.record(record, roll, req, res); // the chunk builds the recording
          // Live hand throws: Playback read the final frame when the done chunk came in, so the
          // values are known now, seconds before this screen's dice land.
          if (!roll.removed) roll.resolveRead(this.hand?.values?.(roll) ?? null);
          this.#armLandingTimer(roll, res?.settledStep);
        },
        (err) => this.#fail(roll, err),
      );
    } catch (err) {
      this.#fail(roll, err);
    }
    return result;
  }

  /** Remove every die now and resolve every pending promise. */
  clear() {
    for (const roll of [...this._rolls, this._hold]) if (roll) this._finish(roll);
    this.#effectsCall((e) => e.clear());
    this._renderer.hide?.();
  }

  /**
   * Gives a die of a live roll its own material (isolateMaterial: its own uniform copies), so a
   * die effect can write its fx uniforms without touching the dice that share its look.
   * Returns the die's uniforms, or null (a ghost, a model die, a fading or finished roll). The
   * isolated material is freed with the die at #finish; the fade clones it.
   */
  isolate(die) {
    if (!die || die.ghost || die.model) return null;
    if (die.isolated) return die.isolated.userData.uniforms;
    const roll = this.#rollOf(die);
    if (!roll || roll.phase === 'fading') return null;
    const base = die.inner?.material;
    if (!base?.userData?.uniforms) return null;
    const iso = isolateMaterial(base);
    die.isolated = iso;
    die.inner.material = iso;
    return iso.userData.uniforms;
  }

  /**
   * Calls the pet layer for `roll` (or, with no roll, its per-frame update). A throwing pet warns
   * once, and stops being called for that roll (an update that throws, for every roll in flight);
   * a roll is never failed by its pet. A roll without a pet reaches it too (its landing: resting
   * pets react to elemental dice), but only a layer already loaded and hooked: nothing loads.
   */
  #petCall(fn, roll) {
    const hook = this._petHook;
    if (!hook) return undefined;
    if (roll ? roll.pet?.dead : this._petUpdateDead) return undefined;
    try {
      return fn(hook);
    } catch (err) {
      if (roll) (roll.pet ?? {}).dead = true;
      else {
        this._petUpdateDead = true;
        for (const r of this._rolls) if (r.pet) r.pet.dead = true;
      }
      console.warn('Dicer | pet', err);
      return undefined;
    }
  }

  /**
   * Public hook (api flareInside): flares the inside of the dice of the roll(s) on screen whose
   * id (roll.id) or ChatMessage id (set by the message gate) is `target`, or of dice[die] alone.
   * True when at least one die flared.
   */
  flareInside(target, opts) {
    const rolls = [...this._rolls].filter((r) => target != null && (r.id === target || r.messageId === target));
    const flared = this.#effectsCall((e) => e.flare(rolls, opts)) === true;
    if (flared) this._renderer.startLoop(this._tick); // a lingering roll at rest has no loop running
    return flared;
  }

  #rollOf(die) {
    for (const roll of this._rolls) if (roll.dice.includes(die)) return roll;
    return null;
  }

  /** Calls the effect layer; a throwing layer warns once and never fails a roll. */
  #effectsCall(fn) {
    if (!this._effects) return undefined;
    try {
      return fn(this._effects);
    } catch (err) {
      if (!this._effectsWarned) {
        this._effectsWarned = true;
        console.warn('dicer: the effect layer threw', err);
      }
      return undefined;
    }
  }

  /** Clear, stop listening, then free the cached geometries and every live material. */
  dispose() {
    this._visibility?.removeEventListener?.('visibilitychange', this._onVisibility);
    if (typeof this._offFontReady === 'function') this._offFontReady();
    this._offFontReady = null;
    this.clear();
    for (const g of this._geometries.values()) g.dispose();
    this._geoRefs.clear();
    this._idleGeo.clear();
    for (const m of [...this._refs.keys()]) this.#disposeMaterial(m);
    this._idle.clear();
    this._geometries.clear();
    this._materials.clear();
  }

  /**
   * Drops every cached material and marks it stale; the next roll builds fresh ones for the
   * current look and flags. Rolls in flight keep theirs, and each stale material is disposed
   * when its last holder finishes (now, if nothing holds it).
   * With replaceInFlight (a shader failure), rolling and fading dice are moved onto rebuilt
   * materials right away (their own look, the current flags), so they never go invisible.
   */
  invalidateMaterials({ replaceInFlight = false } = {}) {
    for (const m of this._materials.values()) this._refs.get(m).stale = true;
    this._materials.clear();
    if (replaceInFlight) {
      const flags = this.#flags();
      for (const roll of [...this._rolls, this._hold]) if (roll) this.#rematerialize(roll, flags);
      this._renderer.requestFrame?.(); // P9-R18: resting dice changed look while held
    }
    for (const [m, entry] of [...this._refs])
      if (entry.stale && entry.refs <= 0) this.#disposeMaterial(m);
  }

  /**
   * A font became ready (the font layer's onReady): drops only the cached materials that drew
   * with a serif stand-in for that font, plus any bound to a runtime atlas the font layer has
   * since evicted (it evicts just before announcing). Every other material, the warm-up's
   * included, stays compiled. Rolls in flight keep theirs.
   */
  invalidateFont(fontId) {
    let evicted = () => false;
    try {
      if (typeof this._fonts?.has === 'function') evicted = (id) => this._fonts.has(id) === false;
    } catch {
      /* no eviction check */
    }
    for (const [key, m] of [...this._materials]) {
      const entry = this._refs.get(m);
      if (!entry) continue;
      const hit = (fontId && entry.standIn === fontId) || (entry.fontId !== 'serif' && evicted(entry.fontId));
      if (!hit) continue;
      entry.stale = true;
      this._materials.delete(key);
      if (entry.refs <= 0) this.#disposeMaterial(m);
    }
  }

  /**
   * Materials of the current look and flags for `types`, held until release() so an
   * invalidation during the async compile cannot dispose them. The geometry is the d20 of the
   * look's edge style: every die type shares one program per programKey, and the program does
   * not depend on the geometry (all dice have the same attributes).
   */
  acquireWarmup(types = WARMUP_TYPES, looks = null) {
    const appearance = normalizeAppearance(this._getAppearance());
    const flags = this.#flags();
    // `looks` (other appearances, e.g. damage themes): one d6 material each, since every die
    // type of a look shares one program.
    const materials = looks
      ? [...new Set(looks.map((l) => this.#material(normalizeAppearance(l), flags, 'd6')))]
      : [...new Set(types.map((t) => this.#material(appearance, flags, t)))];
    for (const m of materials) this.#retain(m);
    const geometry = this.#geometry('d20', appearance.edges.radius);
    this.#retainGeometry(geometry);
    let released = false;
    return {
      materials,
      // each material's kept fade clone (#keptFade), so the compiled fade program stays alive
      fades: materials.map((m) => this.#keptFade(m)),
      geometry,
      release: () => {
        if (released) return;
        released = true;
        for (const m of materials) this.#release(m);
        this.#releaseGeometry(geometry);
      },
    };
  }

  /**
   * The fade clone kept with a cached material, made on first ask. three deletes a program once
   * no material uses it, so without a kept clone every roll's fade (whose clones are disposed when
   * the roll ends) recompiled the transparent program as the dice faded: a visible freeze on
   * resin dice with an inside. The kept clone is never drawn; it is disposed with its material.
   */
  #keptFade(material) {
    const entry = this._refs.get(material);
    if (!entry) return cloneForFade(material);
    entry.fade ??= cloneForFade(material);
    return entry.fade;
  }

  /** Disposes a roll's fade clone, unless its material has none kept yet: then it is kept. */
  #endFade(base, fade) {
    const entry = base && this._refs.get(base);
    if (entry && !entry.fade) entry.fade = fade;
    else fade.dispose();
  }

  #flags() {
    return { ...DEFAULT_FLAGS, ...this._getFlags() };
  }

  #retain(material) {
    this._refs.get(material).refs++;
    this._idle.delete(material);
  }

  #release(material) {
    const entry = this._refs.get(material);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    if (entry.transient && !entry.stale) {
      for (const [k, m] of this._materials) if (m === material) this._materials.delete(k);
      entry.stale = true;
    }
    if (entry.stale) {
      this.#disposeMaterial(material);
      return;
    }
    this._idle.add(material); // newest last
    this.#trimIdle();
  }

  /** Evicts and disposes the least recently used idle materials beyond IDLE_MATERIAL_CAP. */
  #trimIdle() {
    for (const material of this._idle) {
      if (this._idle.size <= IDLE_MATERIAL_CAP) return;
      const entry = this._refs.get(material);
      if (entry && this._materials.get(entry.key) === material) this._materials.delete(entry.key);
      this.#disposeMaterial(material);
    }
  }

  #disposeMaterial(material) {
    const entry = this._refs.get(material);
    try {
      entry?.releaseAtlas?.();
    } catch {
      /* the font layer is gone */
    }
    this._refs.delete(material);
    this._idle.delete(material);
    entry?.fade?.dispose();
    material.userData.uniforms?.uLabels.value.dispose();
    material.dispose();
  }

  /** Moves a roll's dice (and fade clones) onto materials built with `flags`. */
  #rematerialize(roll, flags) {
    roll.flags = flags;
    const old = roll.materials;
    roll.materials = new Set();
    roll.dice.forEach((die, i) => {
      if (die.model) return; // keeps the model's own material (and its fade clone)
      const mat = this.#material(
        die.appearance,
        flags,
        die.shapeType,
        die.variant,
        die.faces,
        die.ghost,
        die.faceTex,
        die,
        die.bodyTex,
      );
      if (!roll.materials.has(mat)) {
        roll.materials.add(mat);
        this.#retain(mat);
      }
      const own = die.isolated ? this.#reisolate(die, mat) : mat;
      if (roll.fades) {
        const prev = roll.fades[i];
        const fade = cloneForFade(own);
        fade.opacity = prev.opacity;
        roll.fades[i] = fade;
        if (roll.fadeBases) roll.fadeBases[i] = own;
        die.inner.material = fade;
        prev.dispose();
      } else {
        die.inner.material = own;
      }
    });
    for (const m of old) this.#release(m);
  }

  /** A new isolated clone of `mat` for an isolated die, keeping the fx uniforms its effects hold. */
  #reisolate(die, mat) {
    const prev = die.isolated;
    const iso = isolateMaterial(mat);
    const was = prev.userData.uniforms;
    const now = iso.userData.uniforms;
    // its effects' fx uniforms and its living inside's motion (uInteriorTime/Spin/Lag/Flare)
    for (const k in was) if (/^u(Fx(Tint|Flare)|Interior(Time|Spin|Lag|Flare|Swirl))$/.test(k)) now[k] = was[k];
    prev.dispose();
    die.isolated = iso;
    return iso;
  }

  #geometry(type, radius) {
    const key = `${type}|${radius}`;
    let geo = this._geometries.get(key);
    if (!geo) {
      geo = buildDieGeometry(getShape(type), { radius });
      geo.computeBoundingSphere(); // the blob shadow scales by it
      this._geometries.set(key, geo);
      this._geoRefs.set(geo, { refs: 0, key });
      this._idleGeo.add(geo);
      this.#trimIdleGeometry(geo);
    }
    return geo;
  }

  #retainGeometry(geo) {
    const entry = this._geoRefs.get(geo);
    if (!entry) return;
    entry.refs++;
    this._idleGeo.delete(geo);
  }

  #releaseGeometry(geo) {
    const entry = this._geoRefs.get(geo);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    this._idleGeo.delete(geo);
    this._idleGeo.add(geo); // newest last
    this.#trimIdleGeometry();
  }

  /** Disposes the least recently used idle geometries beyond IDLE_GEOMETRY_CAP (never `keep`). */
  #trimIdleGeometry(keep) {
    for (const geo of this._idleGeo) {
      if (this._idleGeo.size <= IDLE_GEOMETRY_CAP) return;
      if (geo === keep) continue;
      const entry = this._geoRefs.get(geo);
      this._idleGeo.delete(geo);
      this._geoRefs.delete(geo);
      if (entry) this._geometries.delete(entry.key);
      geo.dispose();
    }
  }

  /**
   * @param {object} appearance normalized
   * @param {{system?: string, dsnType?: string} | null} [source] the die it is built for: a
   *   newly built material is announced through onMaterial when the die has a preset. A preset
   *   of a non-standard system keys its own materials, so a standard die can neither suppress
   *   the announcement nor share a material a listener may change.
   */
  #material(appearance, flags, type, variant, faces, ghost = false, faceTex = null, source = null, bodyTex = null) {
    const layered = !ghost && faceTex?.texture ? faceTex : null;
    const layerKey = layered ? `|fl${faceTexId(layered)}` : '';
    // The body image, once loaded: part of the key (a die without it yet draws the plain body).
    const bt = !ghost && bodyTex?.texture ? bodyTex : null;
    const bodyKey = bt ? `|bi:${appearance.bodyImage?.src}` : '';
    const found = ghost ? null : this.#presetOf(source, type);
    const custom = found && found.preset.system !== STANDARD_SYSTEM ? found.preset.system : null;
    const systemKey = custom ? `|sys:${custom}` : '';
    // an add-on's material hook (a look's `material`): never on a ghost, nor under the safe flags
    const addon = !ghost && !flags.safe && !custom && appearance.material ? MATERIALS.get(appearance.material) : null;
    const addonKey = addon ? `|am:${addon.key}` : ''; // key = cacheKey@revision: a re-registered hook never meets cached dice
    const hooks = custom ? this.#materialHooks(custom, appearance) : null;
    const hookKey = hooks ? `|sc:${hooks.cacheString}` : '';
    const font = this.#fontAtlas(ghost ? 'serif' : appearance.numbers?.font);
    // The atlas actually used is part of the key: a serif stand-in is never reused once the
    // font is ready.
    const key = `${appearanceKey(appearance)}|${programKey(appearance, flags)}|${type}|${variant ?? ''}|${faces?.key ?? ''}|${ghost ? 1 : 0}${layerKey}${bodyKey}${systemKey}${hookKey}${addonKey}|atlas:${font.id}`;
    let mat = this._materials.get(key);
    if (!mat) {
      const shape = getShape(type);
      const labels = shape.values.map((v, i) => {
        const dflt = () => labelFor(type, variant === 'd100tens' ? v * 10 : v, variant);
        if (ghost) return '';
        const face = faces?.labels?.[i];
        if (!face) return dflt();
        if (face.kind === 'glyph') return String(face.text ?? '');
        if (face.kind === 'blank') return '';
        if (layered?.layers?.[i] >= 0) return ''; // drawn from its face layer
        return dflt(); // a text / image face without a layer shows its number
      });
      const build = () =>
        bt
          ? createDiceMaterial(appearance, font.atlas, shape, labels, flags, layered, bt)
          : layered
            ? createDiceMaterial(appearance, font.atlas, shape, labels, flags, layered)
            : createDiceMaterial(appearance, font.atlas, shape, labels, flags);
      mat = build();
      if (hooks)
        mat = this.#applySystem(mat, build, hooks, custom, found.dsnType, appearance, flags);
      if (addon)
        chainShaderHook(mat, `mat:${addon.key}`, addon.key, addon.hook(type), (err) =>
          this.#systemWarn(`material:${addon.cacheKey}`, 'material', 'a material callback threw; its dice use Dicer’s material', err),
        );
      this._materials.set(key, mat);
      // A layered material lives only while rolls hold it: its texture is theirs.
      // The font layer keeps an evicted atlas's texture until this material lets go of it.
      const releaseAtlas = font.id === 'serif' ? null : this.#holdAtlas(font.atlas);
      // fontId: the atlas it binds; standIn: the font it wanted when it drew with the serif.
      this._refs.set(mat, {
        refs: 0,
        stale: false,
        transient: !!(layered || bt),
        key,
        releaseAtlas,
        fontId: font.id,
        standIn: font.standIn ?? null,
      });
      if (found) {
        try {
          this._onMaterial(mat, found.dsnType, appearance, found.preset);
        } catch (err) {
          console.warn('dicer: a material-ready listener threw; the die keeps its look', err);
        }
      }
    }
    return mat;
  }

  /**
   * { atlas, id, standIn? } for a numbers.font: the font layer's atlas when ready, else the serif
   * with standIn = the font (which is requested). Never throws.
   */
  #fontAtlas(fontId) {
    const serif = { atlas: this._atlas, id: 'serif' };
    if (!fontId || fontId === 'serif' || !this._fonts) return serif;
    try {
      const atlas = this._fonts.get(fontId);
      if (atlas) return { atlas, id: fontId };
      Promise.resolve(this._fonts.request(fontId)).catch(() => {});
    } catch (err) {
      if (!this._fontWarned) {
        this._fontWarned = true;
        console.warn('dicer: the font layer threw; numbers use the serif', err);
      }
    }
    return { ...serif, standIn: fontId };
  }

  /** fonts.hold(atlas) -> release, or null (no hold support / a throwing layer). */
  #holdAtlas(atlas) {
    try {
      const release = this._fonts?.hold?.(atlas);
      return typeof release === 'function' ? release : null;
    } catch {
      return null;
    }
  }

  /** The DiceSystem instance registered for `systemId`, or null; never throws. */
  _systemOf(systemId) {
    if (typeof systemId !== 'string') return null;
    try {
      const instance = this._systemFor(systemId);
      return instance && typeof instance === 'object' ? instance : null;
    } catch (err) {
      this.#systemWarn(systemId, 'lookup', 'cannot look up the dice system', err);
      return null;
    }
  }

  #systemWarn(systemId, kind, message, err) {
    const id = `${systemId}|${kind}`;
    if (this._systemWarned.has(id)) return;
    this._systemWarned.add(id);
    console.warn(`dicer: dice system "${systemId}": ${message}`, err);
  }

  /**
   * { instance, cacheString } when `systemId` was registered with a DiceSystem-like instance
   * (all three material callbacks), else null. A throwing getCacheString warns once and gives
   * null: its dice use the plain Dicer material.
   */
  #materialHooks(systemId, appearance) {
    const instance = this._systemOf(systemId);
    if (!instance || !MATERIAL_HOOKS.every((m) => typeof instance[m] === 'function')) return null;
    try {
      return { instance, cacheString: String(instance.getCacheString(appearance)) };
    } catch (err) {
      this.#systemWarn(
        systemId,
        'material',
        'a material callback threw; its dice use Dicer’s material',
        err,
      );
      return null;
    }
  }

  /**
   * Applies a DiceSystem's material callbacks to a freshly built material: beforeShaderCompile
   * chained after Dicer's patch (not under the safe flags, whose point is a plain program),
   * then processMaterial. If processMaterial throws, the material is replaced by a plain one
   * from `build` and the system warns once.
   */
  #applySystem(mat, build, { instance, cacheString }, systemId, dsnType, appearance, flags) {
    const failed = (err) =>
      this.#systemWarn(
        systemId,
        'material',
        'a material callback threw; its dice use Dicer’s material',
        err,
      );
    if (!flags.safe) {
      chainShaderHook(
        mat,
        systemId,
        cacheString,
        (shader, m) => instance.beforeShaderCompile(shader, m),
        failed,
      );
    }
    try {
      instance.processMaterial(dsnType, mat, appearance);
      return mat;
    } catch (err) {
      failed(err);
      mat.userData.uniforms?.uLabels.value.dispose();
      mat.dispose();
      return build();
    }
  }

  /** Fires a dice event on a system instance; a throwing dispatch warns once per system. */
  #fireEvent(die, type, event) {
    const instance = die.systemInstance;
    if (typeof instance?.fire !== 'function') return;
    try {
      instance.fire(type, event);
    } catch (err) {
      this.#systemWarn(die.system, 'event', 'a dice event listener threw', err);
    }
  }

  /** The registered preset of the die `source` describes, as { preset, dsnType }, or null. */
  #presetOf(source, type) {
    if (typeof source?.system !== 'string') return null;
    try {
      const dsnType = source.dsnType ?? baseTypeOf(type);
      const preset = this._presetFor(source.system, dsnType);
      return preset && typeof preset === 'object' ? { preset, dsnType } : null;
    } catch (err) {
      console.warn('dicer: cannot look up a die preset; the die keeps its look', err);
      return null;
    }
  }

  #makeDie(spec, roll, flags, rollLook) {
    const ghost = spec.ghost === true;
    // Themed ghost dice (the themedGhostDice setting, compat/ghost-look.js): a ghost wears the
    // look its `ghostLook` names, the roller's own dice, never one that depends on the roll. Only
    // the look changes: no numbers, faces, system, model, effects or value, like any ghost.
    const themed = ghost && spec.ghostLook ? normalizeAppearance(spec.ghostLook) : null;
    const look = themed ?? (spec.appearance ? normalizeAppearance(spec.appearance) : rollLook);
    const appearance = ghost ? (themed ?? GHOST_APPEARANCE) : look;
    // The look's own face images over a preset's faces (a coin, Fate or d100 tens die by its own key).
    const own = lookFacesFor(spec.type, look, spec.faces, spec.variant);
    // A d4 with the crystal look is a d4crystal (a d6 with the bullet look a d6bullet ...: the look's
    // shapes, dice-shapes ALT_SHAPES) for hull, geometry, reader and labels; its type (and so its
    // value) stays the die's. A d100's two d10s always stay classic. A ghost follows the viewer's look and carries no appearance of
    // its own, so it has the shape of the look it stands for.
    // A DSN preset's own faces, or a model that is actually drawn (modelRotationFor is not null),
    // win: that die stays classic.
    // A spec's own shapeType wins: a replay draws the recorded shape whatever this viewer's look.
    const shapeType =
      spec.shapeType ||
      (!spec.variant && spec.dsnType !== 'd100' && !(spec.model && modelRotationFor(spec)) && !own
        ? shapeTypeFor(spec.type, look.shapes)
        : spec.type);
    const shape = getShape(shapeType);
    const faces = ghost ? undefined : own;
    const geometry = this.#geometry(shapeType, appearance.edges.radius);
    if (!roll.geometries.has(geometry)) {
      roll.geometries.add(geometry);
      this.#retainGeometry(geometry);
    }
    // A ghost has no preset: nothing about its real look is announced.
    const system = ghost || typeof spec.system !== 'string' ? null : spec.system;
    const dsnType = typeof spec.dsnType === 'string' ? spec.dsnType : null;
    const source = system ? { system, dsnType } : null;
    const material = this.#material(
      appearance,
      flags,
      shapeType,
      spec.variant,
      faces,
      ghost,
      null,
      source,
    );
    if (!roll.materials.has(material)) {
      roll.materials.add(material);
      this.#retain(material);
    }
    const inner = new THREE.Mesh(geometry, material);
    const outer = new THREE.Group();
    outer.userData.dicerDie = true;
    outer.visible = false; // at the origin until Playback places it
    outer.add(inner);
    // A ghost is thrown as a 1: its real value must never reach the die object or the mesh.
    const targetValue = ghost
      ? 1
      : spec.variant === 'd100tens'
        ? spec.value / 10 || 10
        : spec.value;
    return {
      outer,
      inner,
      shape,
      targetValue,
      geometry,
      type: spec.type,
      shapeType,
      variant: spec.variant,
      key: spec.key,
      free: spec.free === true,
      appearance,
      faces,
      ghost,
      // A spec's own sound material wins; else the look's (a DSN preset's hint counts).
      soundMaterial:
        typeof spec.soundMaterial === 'string' && spec.soundMaterial
          ? spec.soundMaterial
          : soundMaterialOf(appearance, ghost ? null : this.#presetOf(source, spec.type)?.preset),
      system,
      dsnType,
      // The system's DiceSystem instance (api.js), if any: it gets this die's dice events.
      // A ghost has no system, so it never fires one.
      systemInstance: system ? this._systemOf(system) : null,
      // The Foundry result (a relabelled die's face 8 on a d7 is a 1), for dice events and sfx.
      value: ghost ? undefined : resultOf(spec.value, spec.variant),
      // Trigger effects: never on a ghost; a d100 plays them once, on its ones die.
      fx:
        !ghost && spec.variant !== 'd100tens' && Array.isArray(spec.fx) && spec.fx.length
          ? spec.fx
          : null,
      damageType: !ghost && typeof spec.damageType === 'string' ? spec.damageType : undefined,
      trail: ghost ? 0 : spec.trail | 0,
      // A theme's pets.volume (0..1): scales the pets' voices for this roll. Never on a ghost.
      petVolume: !ghost && typeof spec.petVolume === 'number' ? spec.petVolume : undefined,
      spawned: false,
      faceTex: null,
      // A ghost never shows a model: its numbers would show through.
      modelUrl: !ghost && typeof spec.model === 'string' && spec.model ? spec.model : null,
      modelRotation: ghost ? null : modelRotationFor(spec),
      model: null,
      modelQuat: null, // set once the model is in: Playback premultiplies it
    };
  }

  /**
   * Starts loading the roll's pending assets: the face layers of every die whose face set has
   * image or text faces, and the model of every die whose model has a verified rotation (never
   * a ghost's). Until they are in, or ASSET_WAIT_MS passes, the roll draws nothing and its
   * playback does not start; the physics throw runs meanwhile. Each asset is applied as it
   * arrives; one that fails, or arrives after the wait, leaves its die as it is (numbers for
   * a face, Dicer's own die for a model). Resolves once the roll stops waiting.
   */
  #acquireAssets(roll) {
    const loads = [...this.#faceLoads(roll), ...this.#modelLoads(roll), ...this.#bodyLoads(roll)];
    if (!loads.length) return Promise.resolve();
    roll.assetsPending = true;
    const deadline = new Promise((resolve) => {
      roll.assetTimer = setTimeout(() => {
        console.warn(`dicer: dice assets not ready within ${ASSET_WAIT_MS} ms; showing the rest`);
        resolve();
      }, ASSET_WAIT_MS);
    });
    const applied = loads.map((load) =>
      load.then((apply) => {
        if (roll.removed || !roll.assetsPending) return; // late: swaps nothing
        try {
          apply?.();
        } catch (err) {
          console.warn('dicer: cannot apply a die asset; the die keeps its look', err);
        }
      }),
    );
    return Promise.race([Promise.all(applied), deadline]).then(() => {
      clearTimeout(roll.assetTimer);
      if (roll.removed || !roll.assetsPending) return;
      roll.assetsPending = false;
      if (roll.received > 0) {
        this.#waitFirstFrame(roll);
        this._renderer.startLoop(this._tick);
      }
      if (roll.settled) this.#armLandingTimer(roll, roll.settled.step);
    });
  }

  /** Face-layer loads, each resolving to a function that applies it (or null). Never rejects. */
  #faceLoads(roll) {
    const ft = this._faceTextures;
    if (!ft) return [];
    // presetFaces off drops a preset's image faces, never the look's own (keys 'look|...').
    const presets = this._faceLayers() !== false;
    const sets = new Map();
    for (const die of roll.dice) {
      const f = die.faces;
      if (!die.ghost && needsLayers(f) && (presets || f.key.startsWith('look|'))) sets.set(f.key, f);
    }
    if (!sets.size) return [];
    roll.faceSets = [...sets.values()]; // released when the roll finishes, however it ends
    const failed = (err) => {
      console.warn('dicer: cannot load face textures; the dice show numbers', err);
      return null;
    };
    return roll.faceSets.map((faces) => {
      let load;
      try {
        load = Promise.resolve(ft.acquire(faces)).catch(failed);
      } catch (err) {
        load = Promise.resolve(failed(err));
      }
      return load.then((tex) => (tex?.texture ? () => this.#applyFaces(roll, faces, tex) : null));
    });
  }

  #applyFaces(roll, faces, tex) {
    for (const die of roll.dice) {
      if (die.ghost || die.model || die.faces?.key !== faces.key) continue;
      die.faceTex = tex;
      const { appearance, shapeType, variant } = die;
      const mat = this.#material(appearance, roll.flags, shapeType, variant, die.faces, false, tex, die, die.bodyTex);
      this.#swapMaterial(roll, die, mat);
    }
  }

  /**
   * Body-image loads (one per url, through the look-extras chunk), each resolving to a function
   * that applies it (or null). Never rejects. What is acquired is released when the roll finishes.
   */
  #bodyLoads(roll) {
    const urls = new Set();
    for (const die of roll.dice) if (!die.ghost && !die.model && die.appearance?.bodyImage) urls.add(die.appearance.bodyImage.src);
    if (!urls.size) return [];
    roll.bodyImages = [];
    return [...urls].map((url) =>
      requestLookExtras()
        .then((x) => x?.bodyImages && Promise.resolve(x.bodyImages.acquire(url)).then((tex) => {
          if (roll.removed) return void x.bodyImages.release(url); // finished meanwhile
          roll.bodyImages.push(url);
          return tex?.texture ? () => this.#applyBody(roll, url, tex) : null;
        }))
        .catch((err) => {
          console.warn('dicer: cannot load a body image; the die keeps its plain body', err);
          return null;
        }),
    );
  }

  #applyBody(roll, url, tex) {
    for (const die of roll.dice) {
      if (die.ghost || die.model || die.appearance?.bodyImage?.src !== url) continue;
      die.bodyTex = tex;
      const { appearance, shapeType, variant } = die;
      const mat = this.#material(appearance, roll.flags, shapeType, variant, die.faces, false, die.faceTex, die, tex);
      this.#swapMaterial(roll, die, mat);
    }
  }

  /** Model loads (one per url), each resolving to a function that applies it. Never rejects. */
  #modelLoads(roll) {
    if (this._modelPresets() === false) return [];
    const byUrl = new Map();
    for (const die of roll.dice) {
      if (!die.modelUrl || !die.modelRotation) continue;
      if (!byUrl.has(die.modelUrl)) byUrl.set(die.modelUrl, []);
      byUrl.get(die.modelUrl).push(die);
    }
    return [...byUrl].map(([url, dice]) => {
      const radius = dice[0].geometry.boundingSphere.radius;
      let load;
      try {
        load = Promise.resolve(this._loadModel(url, { radius }));
      } catch (err) {
        load = Promise.reject(err);
      }
      return load.then(
        (model) => {
          if (!model?.geometry || !model.material) return null;
          try {
            this._onModelLoaded(url); // the preset is loaded, whether or not this roll waits
          } catch (err) {
            console.warn('dicer: a model-loaded listener threw', err);
          }
          return () => this.#applyModel(roll, dice, model);
        },
        (err) => {
          console.warn(`dicer: cannot load the die model ${url}; showing Dicer's die`, err);
          return null;
        },
      );
    });
  }

  /**
   * Moves (not yet shown) dice onto a model: its geometry and its own material on the inner
   * mesh, the model rotation premultiplied before the face-forcing one. The collider and the
   * shadow keep Dicer's shape.
   */
  #applyModel(roll, dice, model) {
    for (const die of dice) {
      // A per-value rotation (dsn-orientation.js 'value'): the model's face for this die's value
      // on Dicer's; without it (no solver, an unknown value) the die keeps Dicer's own shape.
      // A free die (rolling by hand) has no value yet: it follows the face it shows (followFor).
      const follows = die.free && die.modelRotation === 'value' && model.followFor?.(die);
      const rot = follows
        ? follows.rotation
        : die.modelRotation === 'value'
          ? model.rotationFor?.(die.shapeType, die.targetValue)?.rotation
          : die.modelRotation;
      if (!Array.isArray(rot)) continue;
      if (follows) die.follow = follows.follow;
      const old = die.inner.material;
      // its dice system's shader callback on the model's own materials (the model chunk's dressModel)
      if (die.systemInstance) model.dress?.(model, die);
      die.model = model;
      die.modelQuat = new THREE.Quaternion(...rot);
      die.inner.geometry = model.geometry;
      die.inner.material = model.material;
      // Held dice (no playback yet) and free dice show it at once (Playback never turns a free
      // die's inner mesh: identity x it); a forced die gets it with its result.
      if (follows || !roll.playback || roll.playback.resultsApplied)
        die.inner.quaternion.multiply(die.modelQuat);
      if (!roll.dice.some((d) => d.inner.material === old)) {
        roll.materials.delete(old);
        this.#release(old);
      }
    }
  }

  /** Moves a (not yet shown) die onto `mat`, releasing a material no die of the roll uses. */
  #swapMaterial(roll, die, mat) {
    const old = die.inner.material;
    if (old === mat) return;
    if (!roll.materials.has(mat)) {
      roll.materials.add(mat);
      this.#retain(mat);
    }
    die.inner.material = mat;
    if (!roll.dice.some((d) => d.inner.material === old)) {
      roll.materials.delete(old);
      this.#release(old);
    }
  }

  /**
   * Shows a roll's dice (and their shadows) once Playback has placed them. Each die spawns and
   * gets its shadow once (a held roll is revealed again at release, a decorated one at decorate);
   * the pet begins at the first reveal of a thrown roll.
   */
  _reveal(roll) {
    const shadows = this._shadows() !== false;
    for (const die of roll.dice) {
      die.outer.visible = true;
      if (die.systemInstance && !die.spawned) {
        die.spawned = true;
        // No value yet: a die shows its result only once it has landed. Dice So Nice hands the die
        // itself (its add-ons dress it: irl-dice-packs' smoked glass): dice.mesh.
        this.#fireEvent(die, DICE_EVENT.SPAWN, {
          dice: Object.assign([{ type: die.dsnType ?? die.type }], { mesh: die.outer }),
          system: die.system,
        });
      }
      if (!shadows || die.shadow) continue;
      // The shadow follows the outer group's position and scales by the geometry's sphere.
      const follow = { position: die.outer.position, geometry: die.geometry };
      roll.shadows.push((die.shadow = this._renderer.sceneApi.shadowFor(follow, { pool: die.ghost || !this._lightPools() ? null : poolColor(die.appearance) })));
    }
    if (roll.pet && !roll.revealed) this.#petBegin(roll);
    roll.revealed = true;
  }

  /** Resolves the pet hook and tells it a roll with a pet has begun at its edge (hand: a free roll). */
  #petBegin(roll) {
    const pet = roll.pet;
    // The hook that answered obstaclesFor at throw time; resolved afresh only if there was none.
    this._petHook = roll.hook ?? this.#hookCall((h) => h);
    if (!this._petHook) {
      pet.dead = true;
      return;
    }
    this._petUpdateDead = false;
    pet.key = `${roll.id}`;
    pet.begun = true;
    const area = roll.record?.area ?? { cx: 0, cz: 0, ...this._area };
    this.#petCall(
      (h) =>
        h.begin(pet.key, {
          spec: pet.spec,
          edge: roll.edge,
          hand: roll.free,
          area: { ...area },
          // the live dice: the pet faces their centre, and may catch a natural 20 mid-roll
          dice: roll.dice,
        }),
      roll,
    );
  }

  /**
   * Landing guard that needs no animation frames: once physics is done, the roll must land
   * within its playback duration (settledStep steps at the playback speed) plus a grace.
   */
  #armLandingTimer(roll, settledStep) {
    if (roll.removed || roll.phase !== 'playing') return;
    if (roll.assetsPending) {
      roll.settled = { step: settledStep }; // playback has not started: armed once it can
      return;
    }
    const steps = Number.isFinite(settledStep)
      ? settledStep
      : roll.free
        ? MAX_FREE_STEPS
        : MAX_STEPS;
    // durationMs includes a slow-motion ramp (it never undershoots one).
    const play = roll.playback ? roll.playback.durationMs(steps) : steps * STEP_SECONDS * 1000;
    const ms = Math.ceil(play) + LANDING_GRACE_MS;
    roll.landingTimer = setTimeout(
      () => this.#fail(roll, new Error(`dice did not land within ${ms} ms of physics done`)),
      ms,
    );
  }

  #land(roll, now) {
    clearTimeout(roll.landingTimer);
    roll.phase = 'lingering';
    // The hand chunk counts the values and lights a hand-read d16's counted face (roll.glows).
    const landedValues = this.hand?.land(roll, now) ?? null;
    roll.resolveRead(landedValues); // no-op when physics done already read them
    roll.resolveValues(landedValues);
    if (roll.record) {
      roll.record.dice = roll.dice.map((d) => ({ x: d.outer.position.x, z: d.outer.position.z }));
    }
    // Every landing reaches a loaded pet layer (resting pets react to elemental dice); a roll
    // without a pet of its own lands with no key. Ghost dice carry no appearance or damage type.
    const dice = roll.dice.map((d) => ({
      type: d.dsnType ?? d.type,
      value: d.value,
      ghost: !!d.ghost, // the same truthiness that strips its appearance below
      x: d.outer.position.x,
      z: d.outer.position.z,
      ...(!d.ghost && { appearance: d.appearance, damageType: d.damageType, petVolume: d.petVolume }),
    }));
    this.#petCall((h) => h.landed(roll.pet?.key, dice), roll); // no key: a roll without a pet (or not begun)
    this._fireResults(roll);
    this._fireFx(roll);
    roll.resolveLanded();
    this._linger(roll);
  }

  /**
   * (Re)arms a lingering roll's hide timer; grab and toss clears it while a die is held or tossed.
   * A crit scene holding one of its dice (roll.scenes, effects/library/borrow.js) arms it when done.
   */
  _linger(roll) {
    clearTimeout(roll.timer);
    if (roll.scenes) return;
    roll.timer = setTimeout(() => {
      if (roll.removed) return;
      roll.phase = 'fading';
      roll.fadeStart = null;
      this.#unglow(roll);
      this.#petLeave(roll, FADE_MS);
      roll.fadeBases = roll.dice.map((die) => die.inner.material);
      roll.fades = roll.dice.map((die) => {
        const original = die.inner.material;
        die.inner.material = cloneForFade(original);
        return die.inner.material;
      });
      this._renderer.startLoop(this._tick); // restarts the loop if it was stopped meanwhile
    }, this._timeBeforeHide() ?? DEFAULT_LINGER_MS);
  }

  /** Removes a d16 result glow still lit (roll.glows(now) is the hand chunk's: true once gone). */
  #unglow(roll) {
    roll.glows?.(Infinity);
    roll.glows = null;
  }

  /**
   * H-9: the thrower's own hand roll, once its chat message exists: the hand chunk merges each
   * spec's fx, damageType, value, system and dsnType onto the lingering die it belongs to and plays
   * today's landed effects, results and dice events, once. False when the roll is not lingering
   * (still in flight, fading or gone), was decorated, or the hand chunk is not attached.
   */
  decorateLanded(roll, specs) {
    return !!this.hand?.decorate(roll, specs);
  }

  /**
   * The thrower's own free roll (physics decides) got its chat message while still in the air: a
   * spec with a slow-motion effect (a natural 20 or 1) slows its landing down, as a roll thrown
   * with its fx known does. This client only; its landing watchdog is re-armed for the ramp.
   */
  slowLanded(roll, specs) {
    if (roll?.phase !== 'playing' || roll.slowMotion || !specs?.some((s) => s?.fx?.some((f) => f?.slowMotion === true)))
      return false;
    roll.slowMotion = true; // the done chunk ramps it, if it is still to come
    const pb = roll.playback;
    if (pb?.resultsApplied) {
      pb.setSpeedRamp({ fromStep: pb.frames - 1 - RAMP_STEPS });
      clearTimeout(roll.landingTimer);
      this.#armLandingTimer(roll, pb.frames - 1);
    }
    return true;
  }

  /** Tells the pet its roll is going away in `msLeft` ms (0: at once), once. */
  #petLeave(roll, msLeft) {
    const pet = roll.pet;
    if (!pet?.begun || pet.left) return;
    pet.left = true;
    this.#petCall((h) => h.leave(pet.key, msLeft), roll);
  }

  /**
   * onLandedFx (sound, macro) per landed die with fx, and the effect layer per landed die with fx
   * or trail 2 (its crit burst may play alone); a throwing listener or layer warns once and never
   * blocks landing.
   */
  _fireFx(roll) {
    for (const die of roll.dice) {
      if (die.ghost) continue;
      if (die.fx) {
        roll.fxKey ??= { id: roll.id };
        try {
          this._onLandedFx(die, die.fx, roll.fxKey);
        } catch (err) {
          if (!this._fxWarned) {
            this._fxWarned = true;
            console.warn('dicer: a landed-effect listener threw', err);
          }
        }
      }
      if (die.fx || die.trail > 1) this.#effectsCall((e) => e.play(die, die.fx));
    }
  }

  /** One RESULT event per system instance, with that system's landed dice. */
  _fireResults(roll) {
    const bySystem = new Map(); // instance -> { die, dice }
    for (const die of roll.dice) {
      if (!die.systemInstance) continue;
      if (!bySystem.has(die.systemInstance)) bySystem.set(die.systemInstance, { die, dice: [] });
      bySystem
        .get(die.systemInstance)
        .dice.push({ type: die.dsnType ?? die.type, value: die.value });
    }
    for (const { die, dice } of bySystem.values()) {
      this.#fireEvent(die, DICE_EVENT.RESULT, { dice, system: die.system });
    }
  }

  /** 'always' while a preview roll is on screen, else true while dice are held or a roll marked `mine` is. */
  get mineShown() {
    let mine = !!this._hold;
    for (const roll of this._rolls) {
      if (roll.mine === 'always') return 'always';
      if (roll.mine) mine = true;
    }
    return mine;
  }

  /** Tells onLayer when mineShown changed (once per frame: a boolean check, nothing else). */
  #layer() {
    if (!this._onLayer) return;
    const mine = this.mineShown;
    if (mine === this._mineShown) return;
    this._mineShown = mine;
    try {
      this._onLayer(mine);
    } catch (err) {
      console.warn('dicer: onLayer', err);
    }
  }

  #frame(now) {
    setDicerTime(now); // the shared uTime of add-on material hooks
    for (const roll of [...this._rolls]) {
      try {
        if (roll.phase === 'playing') {
          if (roll.assetsPending) continue; // hidden, playback not started, until assets are in
          const hadFrames = roll.received > 0;
          const state = roll.playback.update(now);
          if (hadFrames && !roll.revealed) this._reveal(roll);
          if (state === 'playing') this.#impacts(roll, now);
          if (state === 'landed') this.#land(roll, now);
        } else if (roll.phase === 'fading') {
          roll.fadeStart ??= now;
          const t = Math.min(1, (now - roll.fadeStart) / FADE_MS);
          for (const m of roll.fades) m.opacity = 1 - t;
          if (t >= 1) this._finish(roll);
        } else if (roll.glows?.(now)) roll.glows = null;
      } catch (err) {
        this.#fail(roll, err);
      }
    }
    // Effects outlive their roll (a burst may still be settling): the loop runs while they do.
    const effects = this.#effectsCall((e) => e.update(now)) === true;
    // A pet outlives its roll too (it walks off): the loop runs while it moves.
    this._petHook ??= this.#hookCall((h) => h); // a held rest or wake() before any roll began
    const petState = this.#petCall((h) => h.update(now));
    const pet = petState === true;
    const petRest = petState === 'rest'; // pets shown, nothing moving: hold, no rAF
    // A roll still waiting for its assets draws nothing: it restarts the loop when they are in.
    let shown = false;
    let moving = effects || pet;
    for (const roll of this._rolls) {
      if (roll.assetsPending) continue;
      shown = true;
      // Living insides (the look-extras chunk): stepped every frame, moving until they rest.
      // A module dice set's animated material (its mixer: Dice So Nice keeps such dice drawing) too.
      if (getLookExtras()?.insideMotion.frame(this, roll, now) || roll.phase !== 'lingering' || roll.glows || roll.dice.some((d) => d.inner.material.mixer)) moving = true;
    }
    // Grab and toss (lazy chunk, this.grab): a landed die held or tossed keeps the loop running.
    if (this.grab?.frame(now)) moving = true;
    // Held dice follow the pointer: the loop runs while they are shown.
    if (this._hold?.revealed) return true;
    // P9-R18: every shown roll at rest and no effect running: this frame is drawn, then the loop
    // holds with the dice on screen. The linger timer's startLoop (the fade) or a new roll wakes it.
    if (shown) return moving ? true : 'hold';
    if (effects || pet) return true;
    return petRest ? 'hold' : false;
  }

  /** Runs the trail flight hook, then hands the impacts the playhead just crossed to onImpact; a sound never fails a roll. */
  #impacts(roll, now) {
    this.#effectsCall((e) => e.flight(roll, now));
    let events;
    try {
      events = roll.playback.takeEvents();
      if (!events.length) return;
      const surface = this._getSurface();
      for (const { die, other, speed } of events) {
        const d = roll.dice[die];
        if (!d) continue;
        const dieKey = `${roll.id}:${die}`;
        // An impact reveals no result, so ghost dice get their dust too. Before the sound: a
        // throwing sound hook must not skip it. The position is copied (the die keeps moving).
        const pos = d.outer?.position;
        const position = { x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0 };
        if (other <= -3) {
          // A pet obstacle (-3 - i): the pet layer decides at playback time whether it splats or
          // wobbles; its own sound covers the contact, so no die click and no dust.
          const id = roll.ids?.[-3 - other];
          // its look and damage type: an elemental die sets the pet off instead (pets.js hit)
          const die = { appearance: d.appearance, damageType: d.damageType, ghost: d.ghost, type: d.shapeType, petVolume: d.petVolume };
          if (id !== undefined) this.#hookCall((h) => h.hit?.(id, { speed, position, dieKey, die }), roll.hook);
          continue;
        }
        // a die hitting the roll area's wall: a pet on the tray's rim beside it wobbles (pets.js wall)
        if (other === -2 && this._petHook) this.#hookCall((h) => h.wall?.(position, speed), this._petHook);
        this.#effectsCall((e) => e.impact?.({ position, speed, surface, dieKey }));
        this._onImpact({
          material: d.soundMaterial,
          surface,
          speed,
          other,
          dieKey,
          dieType: d.type,
        });
      }
    } catch (err) {
      console.warn('dicer: impact sound failed', err);
    }
  }

  #fail(roll, err) {
    if (roll.removed) return;
    console.error('dicer: roll failed', err);
    this._finish(roll);
  }

  /** Removes a roll's dice and shadows, recycles its buffers, resolves both promises. */
  _finish(roll) {
    if (roll.removed) return;
    roll.removed = true;
    this._rolls.delete(roll);
    if (this._hold === roll) this._hold = null;
    this.#layer(); // the loop may stop on this frame: no later tick would lower the dice and tray
    this.#unglow(roll);
    clearTimeout(roll.timer);
    clearTimeout(roll.firstChunkTimer);
    clearTimeout(roll.doneTimer);
    clearTimeout(roll.landingTimer);
    clearTimeout(roll.assetTimer);
    if (roll.pet?.begun) {
      this.#petLeave(roll, 0);
      this.#petCall((h) => h.end(roll.pet.key), roll);
    }
    const scene = this._renderer.scene;
    for (const die of roll.dice) {
      scene.remove(die.outer);
      this.#effectsCall((e) => e.releaseDie(die));
      if (die.isolated) {
        die.isolated.dispose(); // its textures are the shared material's: not disposed here
        die.isolated = null;
      }
      if (!die.spawned) continue;
      die.spawned = false;
      this.#fireEvent(die, DICE_EVENT.DESPAWN, {
        dice: [{ type: die.dsnType ?? die.type }],
        system: die.system,
      });
    }
    for (const plane of roll.shadows) this._renderer.sceneApi.releaseShadow(plane);
    // P9-R18: a roll removed while the loop holds (outside a frame) must not stay drawn: the next
    // frame redraws without it, or hides when nothing is left.
    this._renderer.requestFrame?.();
    (roll.fades ?? []).forEach((m, i) => this.#endFade(roll.fadeBases?.[i], m));
    roll.fades = null;
    roll.fadeBases = null;
    for (const m of roll.materials) this.#release(m);
    for (const g of roll.geometries) this.#releaseGeometry(g);
    roll.geometries.clear();
    roll.materials.clear();
    for (const faces of roll.faceSets ?? []) {
      try {
        this._faceTextures.release(faces);
      } catch (err) {
        console.warn('dicer: cannot release face textures', err);
      }
    }
    roll.faceSets = null;
    for (const url of roll.bodyImages ?? []) getLookExtras()?.bodyImages?.release(url);
    roll.bodyImages = null;
    if (roll.playback) {
      // A recording or a replay source still owns its chunks: never handed back to the worker.
      if (!roll.keep) for (const data of roll.playback.release()) this._physics.recycle(data);
      roll.playback = null;
    }
    roll.resolveValues(null); // no-op once landed
    roll.resolveRead(null); // no-op once read
    roll.resolveLanded();
    roll.resolveFinished();
  }
}
