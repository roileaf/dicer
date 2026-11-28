import { dropCoreDiceSound } from './foundry/core-dice-sound.js';
import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { onLookExtrasReady } from './render/extras-loader.js';
import { getPets, requestPets, releasePets } from './pet/pet-loader.js';
import { petFor } from './pet/pet-for.js';
import { loadHand, prefetchHand, handNow } from './hand/hand-loader.js';
import { syncGrab } from './grab/grab-loader.js';
import { createHandGate, markCard } from './hand/gate-hand.js';
import {
  registerHandMethod,
  setHandDeps,
  syncDiceConfiguration,
  handAllowed,
  wantsHand,
} from './hand/shell.js';
import { createFontAtlases, createFontWorker } from './fonts/font-atlas.js';
import { createQualityController } from './render/quality-controller.js';
import { createWarmup, createAppearanceRewarm } from './render/warmup.js';
import { userWarmupLooks } from './render/user-looks.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { createInitiativeHider } from './compat/initiative.js';
import { registerChatCommands } from './compat/chat-commands.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { measureArea, watchArea } from './foundry/area.js';
import { createAreaResolver } from './areas/area-resolver.js';
import { emitRollAreasChanged } from './areas/area-store.js';
import { startEngine, announceReady } from './foundry/startup.js';
import { createDice3dApi, createDebugCounters, materialReadyNotifier } from './api/dice3d.js';
import { createRegistry } from './compat/registry.js';
import { createLookResolver } from './compat/resolve-looks.js';
import { createGhostDecorate } from './compat/ghost-look.js';
import { facesFor, atlasGlyphTest } from './compat/faces.js';
import { createFaceTextures, FACE_FONT_FAMILY } from './render/face-textures.js';
import {
  mirrorLookSetting,
  mirrorLookIfMissing,
  shouldMirror,
  ownDefaultRefs,
  lookRefToAppearance,
} from './compat/user-looks.js';
import { DEFAULT_APPEARANCE } from './look/appearance.js';
import { readThemeList } from './themes/themes.js';
import { createSoundEngine } from './audio/sound-engine.js';
import {
  createFxResolver,
  composeDecorateFor,
  createLandedFx,
  moduleRulesOf,
} from './effects/fx-resolver.js';
import { createDamageThemer } from './effects/damage-themes.js';
import { createEffectLayer } from './effects/effect-layer.js';
import { createDsnSfx } from './effects/dsn-sfx.js';
import { jb2aSource } from './jb2a/source.js';
import { lightingFor } from './render/scene-light.js';
import { registerNoticeSetting, registerSettings, getSetting, migrateLookSetting, migratePetStay, moveToUserSettings, resetControls } from './settings.js';

import { watchStaleCopy } from './foundry/stale-copy.js';

let dormant = false;
let gate = null;
let initiative = null; // hides rolled initiative in the combat tracker while its dice fly
// Roll All / Roll NPCs as one throw (lazy chunk)
const batchChunk = () => import('./foundry/initiative-batch.js');
let diceBox = null;
let diceRenderer = null;
let quality = null;
let stopWatchingArea = null;
let stopLookExtras = null;
let digitAtlas = null;
let fontAtlases = null; // the font layer: the atlas of each look's numbers.font
let registry = null; // the DSN registry, once activate() made it
let faceTextures = null; // shared by DiceBox and preloadPresets (one cache)
let dice3d = null; // game.dice3d, once activate() made it
let soundEngine = null; // impact and result sounds; its synth is a lazy chunk
let effectLayer = null; // trigger effects; its library is a lazy chunk
let petDeps = null; // what the lazy pet chunk's layer is made from
let tray = null; // this screen's dice tray (the lazy tray chunk), once loaded
let trayDeps = null; // what it is made from (activate sets them)
let trayEditing = false; // the Dice tray window is open (the tray shows while it is)
// The dice tray in a window of its own (src/tray/popout.js: another screen): {win, tray, stage()}.
// Every roll this screen shows lands there, the dice drawn in it; the table's tray hides meanwhile.
let popped = null;
const onTray = () => popped?.tray ?? tray;
const stageRect = () => popped?.stage() ?? measureArea();
Hooks.on('dicerTrayPopOut', () => {
  if (!diceRenderer || !trayDeps) return;
  const set = (p) => {
    popped = p;
    if (tray?.element) tray.element.style.display = p ? 'none' : '';
  };
  import('./tray/popout.js')
    .then((m) => m.popOut({ ...trayDeps, canvas: diceRenderer.canvas, resize: resizeDice, set }))
    .catch((err) => console.warn('dicer: cannot open the dice tray window', err));
});
// The Dice tray window (its lazy chunk) says when it opens and closes.
Hooks.on('dicerTrayEditing', (on) => {
  trayEditing = !!on;
  tray?.preview(trayEditing);
});

/**
 * This screen's dice tray: the tray chunk loads once a tray is wanted (a mode that is not 'none',
 * and a look for it), then follows the settings. Until it is in, rolls use the roll areas.
 */
function syncTray() {
  if (tray) return void tray.refresh();
  if (!trayDeps) return;
  const mode = getSetting('trayMode');
  if (mode === 'none' || (mode !== 'mine' && !getSetting('tableTray'))) return;
  const deps = trayDeps;
  import('./tray/tray.js')
    .then((m) => {
      if (tray || trayDeps !== deps) return;
      tray = m.createTray(deps);
      tray.preview(trayEditing);
      tray.refresh();
      layerDice();
    })
    .catch((err) => console.warn('dicer: cannot load the dice tray', err));
}

/** The table surface the dice sound on: the client's override unless it is 'world'. */
export function soundSurface(get) {
  const own = get('soundSurfaceOverride');
  return own && own !== 'world' ? own : get('soundSurface') || 'felt';
}

/**
 * A trigger rule's Animater moment (rules.js MOMENT_WHERES) for everyone: on the whole screen, where
 * the dice landed or on the roller's token. Animater takes a moment from a GM only, so only the
 * active GM's client calls it for a roll: once per roll.
 */
let momentNoted = false;
function playAnimaterMoment(m, preview, die, token) {
  // a roll's from the active GM's view, once; a preview's from the GM who clicked it (Animater
  // itself takes a moment from a GM only)
  if (!preview && game.users?.activeGM?.id !== game.user.id) return;
  // where: the map point under the die as this screen shows it, or the roller's token (a
  // preview's: the token the GM has selected); neither found: the whole screen
  let at = null;
  if (m.where === 'dice')
    try {
      const v = die.outer.position.clone().project(diceRenderer.camera);
      const r = diceRenderer.canvas.getBoundingClientRect();
      const b = canvas.app.view.getBoundingClientRect();
      at = canvas.stage.toLocal({ x: r.left - b.left + ((v.x + 1) / 2) * r.width, y: r.top - b.top + ((1 - v.y) / 2) * r.height });
    } catch {
      at = null;
    }
  const id = m.where === 'token' && (token || (preview && canvas.tokens?.controlled?.[0]?.id));
  const api = game.modules?.get('animater')?.active ? game.modules.get('animater').api : null;
  if (typeof api?.moment !== 'function') {
    // said once: a rule asked for a moment this Animater cannot play (off, or a version without moments)
    if (!momentNoted) console.warn('dicer: no Animater moments');
    momentNoted = true;
    return;
  }
  const held = !['pulse', 'shake', 'shock', 'dust'].includes(m.kind);
  api.moment({ kind: m.kind, where: at ? 'point' : id ? 'tokens' : 'screen', ...(at && { x: at.x, y: at.y, radius: 2.5 * (canvas.grid?.size || 100) }), ...(id && { ids: [id] }), ...(m.colour && { colour: m.colour }), ...(m.strength !== undefined && { strength: m.strength }), ...(held && { ms: 1500, fade: 400 }) });
}

/** game.dice3d._debug.fxPlays / resultSounds: counted where effects start and sounds are requested. */
const debugCounters = createDebugCounters();

/** Result sounds (never awaited) and trigger macros, once per landed die carrying fx. */
const landedFx = createLandedFx({
  playSound: (sound) => (getSetting('effectSounds') === false ? undefined : soundEngine?.result(sound)),
  onSound: debugCounters.countSound,
  fromUuid: (uuid) => globalThis.fromUuid(uuid),
  playMoment: playAnimaterMoment,
});

/**
 * Runs `run` in an idle callback (a 200 ms timer where there is none), within 2 s at the latest: a
 * busy page (an animated scene, video calls) may never go idle, and the pets, sounds and effects
 * it preloads would never come.
 */
const idle = (run) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));

/** The modules in other-trays.js OTHER_TRAYS (a copy, so world start stays without it; a test checks). */
const TRAY_MODULE_IDS = ['dice-calculator', 'pf2e-hud'];

/** Renders the sounds in an idle callback (never on a roll's frames). */
function preloadSounds() {
  if (!soundEngine || getSetting('sounds') === false) return;
  const run = () => soundEngine?.preload();
  idle(run);
}

/** Fetches the effects library in an idle callback, so it is in before the first effect. */
function preloadEffects() {
  if (!effectLayer || getSetting('effects') === false) return;
  const run = () => effectLayer?.prefetch();
  idle(run);
}

/** Fetches the pet chunk now, only when pets are allowed and shown (requestPets loads it once). */
function preloadPetsNow() {
  if (petDeps && getSetting('petsAllowed') !== false && getSetting('showPets') !== false) requestPets(petDeps);
}

/** Fetches the pet chunk in an idle callback, only when pets are allowed and shown. */
function preloadPets() {
  if (!petDeps || getSetting('petsAllowed') === false || getSetting('showPets') === false) return;
  const run = () => petDeps && requestPets(petDeps);
  idle(run);
}

/** Fetches the editor chunks (triggers, damage map, roll areas, themes, appearance) in an idle callback (they are small), so opening one is instant. */
export function preloadEditors(
  loaders = [() => import('./ui/trigger-editor.js'), () => import('./ui/damage-map-editor.js'), () => import('./ui/area-editor.js'), () => import('./ui/theme-browser.js'), () => import('./ui/appearance-editor.js')],
) {
  const run = () => {
    for (const load of loaders) {
      try {
        Promise.resolve(load()).catch(() => {}); // a failed prefetch only means a later cold open
      } catch {
        /* same */
      }
    }
  };
  idle(run);
}

/** The core client setting Foundry's dice fulfillment reads (Roll.DICE_CONFIGURATION_SETTING). */
const getCore = () => game.settings.get('core', 'diceConfiguration');

/** Rolling by hand: maps this user's dice to the `dicer` method, or removes Dicer's entries (ready, settings). */
function syncHand() {
  try {
    Promise.resolve(
      syncDiceConfiguration({
        getSetting,
        user: game.user,
        getCore,
        setCore: (v) => game.settings.set('core', 'diceConfiguration', v),
        setSetting: (k, v) => game.settings.set('dicer', k, v), // a failure skips setCore (warned below)
      }),
    ).catch((err) => console.warn('dicer: cannot update the dice configuration', err));
  } catch (err) {
    console.warn('dicer: cannot update the dice configuration', err);
  }
}

/**
 * diceAboveWindows: 'all' lifts the dice canvas over Foundry's windows; 'mine' only while one of
 * this user's rolls (or held dice) is on screen. One canvas draws everyone's dice, so another
 * player's dice that show at the same time as yours are lifted too. A preview throw from the
 * editors (`mine` 'always') is lifted whatever the setting: its window is open over the table.
 */
function layerDice(mine = diceBox?.mineShown) {
  const mode = getSetting('diceAboveWindows');
  const above = mine === 'always' || mode === 'all' || (mode === 'mine' && !!mine);
  diceRenderer?.canvas?.classList.toggle('dicer-above', above);
  tray?.raise(above);
}

function onSoundChange(key, value) {
  if (key === 'sounds' && value) preloadSounds();
}

const NOOP_HANDLERS = { onCreate() {}, onUpdate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;
/**
 * Task 8 (P6-D2): this user's hand throws of `m` go to the users allowed to see them, under the
 * gate's RollStart outcome (none known: GMs only). A throw is stored only where the chunk loaded.
 */
const sendHand = (m) =>
  handNow()?.sendHand(m, { start: gate?.startOf(m.id), pending: gate?.isAnimating(m.id) });

/**
 * This user's own default look (DiceBox's fallback and the warm-up), by the resolver's chain:
 * the world default under the lock, else the stored global choice (a GM push included), the
 * world default, then the client `theme` setting. An unknown id (e.g. a removed theme) is
 * skipped; nothing usable gives the default.
 */
export const getAppearance = () => {
  const quiet = () => {};
  const themes = {
    worldThemes: readThemeList(getSetting('worldThemes'), 'world', quiet),
    userThemes: readThemeList(game.user?.getFlag?.('dicer', 'themes'), 'user', quiet),
  };
  const refs = ownDefaultRefs(game.user, {
    theme: getSetting('theme'),
    worldDefaultTheme: getSetting('worldDefaultTheme'),
    lock: getSetting('lockPlayerLooks'),
  });
  for (const ref of refs) {
    const got = lookRefToAppearance(ref, registry, 0, { themes });
    if (got) return got.appearance;
  }
  return DEFAULT_APPEARANCE;
};

/** Foundry's v12+ colour (a Number with .rgb) or anything else as [r, g, b] 0..1, else null. */
const rgbOf = (c) => (Array.isArray(c?.rgb) ? c.rgb : null);

/**
 * The diceLighting setting on the dice scene: scene mode follows the canvas's darkness and
 * ambient colours (re-read on lightingRefresh).
 */
function lightDice() {
  const env = globalThis.canvas?.environment;
  diceRenderer?.sceneApi?.setLighting?.(
    lightingFor(getSetting('diceLighting'), { darkness: env?.darknessLevel, daylight: rgbOf(env?.colors?.ambientDaylight), night: rgbOf(env?.colors?.ambientDarkness) }),
  );
  diceBox?.wake?.();
}

/** The dice of installed modules that are not active (the GM's picks; a lazy chunk), after diceSoNiceReady. */
function loadInstalled() {
  const list = dice3d && getSetting('installedDice');
  if (list?.length) import('./compat/installed-dice.js').then((m) => m.loadInstalledDice(list, { api: dice3d })).catch(() => {});
}

/** A module-relative or absolute URL as the browser can fetch it. */
const routeOf = (url) =>
  /^([a-z][a-z0-9+.-]*:|\/)/i.test(url) ? url : foundry.utils.getRoute(url);

/**
 * The public api.js (DiceSystem, DiceSFX, DiceMap) ships beside module.json, outside the
 * bundle: it is imported at runtime from its route (the path is computed so Vite leaves the
 * import alone) and exposed as globalThis.DicerAPI, which is set asynchronously during init.
 * globalThis.DicerAPIReady is a promise of the module (null if the load failed); it never
 * rejects. Integrations should prefer importing `modules/dicer/api.js` directly (e.g.
 * `import { DiceSystem } from '/modules/dicer/api.js'`): it needs neither global.
 */
function loadPublicApi() {
  globalThis.DicerAPIReady = (async () => {
    try {
      const url = foundry.utils.getRoute(['modules', 'dicer', 'api.js'].join('/'));
      const api = await import(/* @vite-ignore */ url);
      globalThis.DicerAPI = api;
      return api;
    } catch (err) {
      console.warn('dicer: cannot load api.js; DiceSystem and DiceSFX are unavailable', err);
      return null;
    }
  })();
}

/** Makes the bundled DM Serif Display available to canvas text (text die faces). */
async function loadFaceFont() {
  const url = routeOf('modules/dicer/assets/fonts/DMSerifDisplay-Regular.woff');
  const face = new FontFace(FACE_FONT_FAMILY, `url("${url}")`);
  document.fonts.add(await face.load());
}

/** Image die faces load through Foundry's route (module paths are relative). */
function loadFaceImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = routeOf(url);
  });
}

/** A layer right after #board holding the dice canvas (document.body without a board). */
function createLayer() {
  const layer = document.createElement('div');
  layer.id = 'dicer-layer';
  const board = document.getElementById('board');
  if (board) board.after(layer);
  else document.body.appendChild(layer);
  return layer;
}

function resizeDice() {
  try {
    diceBox?.onResize();
  } catch (err) {
    console.error('dicer: resize failed', err);
  }
}

/**
 * Compiles the current look's materials (one per die type, current tier) without starting the
 * render loop; calls made while one runs coalesce. A context loss or a 10 s timeout rejects
 * the compile, so the pass still releases its materials and later warm-ups still run.
 */
/** The damage themes' looks, warmed after the own look (set once the damage themer exists). */
let damageLooks = () => [];
/** The other users' looks (set once the look resolver exists): their first roll here froze the canvas. */
let userLooks = () => [];
/** The actors' looks and the themes a module named (render/actor-looks.js, in the lazy theme API chunk). */
let moreLooks = () => [];
let lookResolver = null;
let ownLook = null; // this user's own look for a die of `faces` faces (the typed-in dice window)

const warmUp = createWarmup({
  getBox: () => diceBox,
  getRenderer: () => diceRenderer,
  onWarmed: () => quality?.warmedUp(), // P2-R10: fresh adaptive window once the new programs exist
  // Players' looks first: someone rolls every turn, a damage theme only on its damage type.
  getLooks: () => [...userLooks(), ...moreLooks(), ...damageLooks()],
});

/** Another user's dice flags changed: warm their look (debounced), so their next roll here doesn't freeze. */
let otherLookTimer = null;
function rewarmSoon() {
  clearTimeout(otherLookTimer);
  otherLookTimer = setTimeout(warmUp, 1000);
}
function onOtherUserLook(user, changes) {
  if (user?.id !== game.user?.id && changes?.flags?.dicer) rewarmSoon();
}

/**
 * The look, a feature flag or the tier changed: new rolls get rebuilt materials, rolls in
 * flight keep theirs (unless a shader failed: then they move onto the rebuilt ones too).
 */
function refreshMaterials({ replaceInFlight = false } = {}) {
  if (!diceBox) return;
  try {
    diceBox.invalidateMaterials({ replaceInFlight });
  } catch (err) {
    console.error('dicer: cannot rebuild dice materials', err);
  }
  appearanceRewarm.markWarmed();
  warmUp();
}

/** The raw world settings storage (a WorldSettings collection); DSN's scope is not registered. */
const worldStorage = () => game.settings.storage?.get('world') ?? null;

/** The DSN world settings the migration maps or logs (keys as stored in the world settings). */
const DSN_WORLD_KEYS = new Set(
  [
    'maxDiceNumber',
    'immediatelyDisplayChatMessages',
    'showGhostDice',
    'hideNpcRolls',
    'diceCanBeFlipped',
  ].map((k) => `dice-so-nice.${k}`),
);

/** Which DSN data is still to be migrated, judged from raw data only (no chunk is loaded). */
function dsnPending() {
  if (getSetting('migrateFromDsn') === false) return { user: false, world: false };
  const dsnAppearance = game.user?._source?.flags?.['dice-so-nice']?.appearance;
  const user =
    dsnAppearance !== null &&
    typeof dsnAppearance === 'object' &&
    !Array.isArray(dsnAppearance) &&
    Object.keys(dsnAppearance).length > 0 &&
    !(game.user.getFlag('dicer', 'migratedFromDsn') >= 2);
  let world = false;
  if (game.user?.isGM && !getSetting('dsnWorldMigrated')) {
    for (const setting of worldStorage() ?? []) {
      if (DSN_WORLD_KEYS.has(setting?.key)) {
        world = true;
        break;
      }
    }
  }
  return { user, world };
}

/**
 * The user's Dice So Nice save profiles as their own themes (once each): after diceSoNiceReady,
 * so a save naming a module's colorset finds it. The chunk loads only with saves left to import.
 */
async function importDsnSaves() {
  try {
    const dsn = game.user?._source?.flags?.['dice-so-nice'];
    if (getSetting('migrateFromDsn') === false || !(dsn?.saves || dsn?.diceLibrary || game.user.isGM)) return;
    const migration = await import('./compat/migration.js');
    const n = await migration.importLooks({ user: game.user, users: game.users, registry, storage: worldStorage() });
    if (n) ui.notifications?.info(game.i18n.format('DICER.Notice.SavesImported', { n }));
  } catch (err) {
    console.warn('dicer: cannot import the Dice So Nice saved looks', err);
  }
}

/**
 * Copies Dice So Nice data into Dicer (once). The migration code is a lazy chunk, loaded only
 * when there is DSN data. Never rejects, never delays the engine; the look mirror waits for it
 * so a mirrored default does not pre-empt the user's imported global look.
 */
async function migrateFromDsn() {
  try {
    const pending = dsnPending();
    if (!pending.user && !pending.world) return;
    const migration = await import('./compat/migration.js');
    const done = await migration.runMigration({
      user: game.user,
      isGM: pending.world,
      worldSettings: migration.worldSettingsReader(worldStorage()),
      settings: game.settings,
      users: game.users,
    });
    if (done) ui.notifications?.info(game.i18n.localize('DICER.Notice.Migrated'));
  } catch (err) {
    console.warn('dicer: cannot migrate Dice So Nice data', err);
  }
}

/** Publishes the chosen theme in the user flag so other clients draw this user's dice with it. */
function mirrorLook(themeId) {
  if (!shouldMirror(game.user, themeId)) return; // "My default" Clear: stays never-chose (P7-R5)
  mirrorLookSetting(game.user, themeId).catch((err) =>
    console.warn('dicer: cannot mirror the theme setting to the user flag', err),
  );
}

/** Preset face sets the digit atlas cannot draw, as image / text face layers. */
const presetFaces = (preset) => facesFor(preset, atlasGlyphTest(digitAtlas));

/**
 * M-2: a GM push (the user's appearance flag) or a change of the world default / lock changes
 * what getAppearance resolves to, so the materials and warm-up are redone, debounced to 500 ms.
 */
const appearanceRewarm = createAppearanceRewarm({
  rewarm: () => refreshMaterials(),
  getUserId: () => game.user?.id,
  getAppearance: () => getAppearance(),
});
let updateUserHook = null;

function onLookChange(key, value) {
  if (key === 'worldDefaultTheme' || key === 'lockPlayerLooks') {
    appearanceRewarm.onSettingChange();
    return;
  }
  if (key === 'theme') {
    mirrorLook(value);
    dice3d?._releasePreloads(); // preloadPresets holds faces until the theme changes
  }
  if (key === 'effects' && value) preloadEffects();
  // Read per roll; no cached material depends on them.
  if (key === 'shadows' || key === 'presetFaces' || key === 'presetModels') return;
  refreshMaterials();
}

/**
 * quality (client) or qualityCap (world; its onChange fires on every client). A quality pick
 * clears the session's adaptive ceiling; a cap change keeps it (P2-R11).
 */
function onQualityChange(key) {
  quality?.refresh(key); // emits onChange (-> refreshMaterials) only if the tier changed
}

/** Opens Foundry's settings on the Dicer tab (Dicer's own dialog is Plan 7). */
function openDicerSettings() {
  const SettingsConfig = foundry.applications.settings.SettingsConfig;
  new SettingsConfig({ initialCategory: 'dicer' }).render({ force: true });
}

// /dice3d, /d3d and /dsn through the chat-commands module (absent: nothing to register).
// Registered at module load, not in init: the hook may fire before Dicer's init runs, so
// dormancy is checked here, from game.modules too in case init has not set it yet.
Hooks.on('chatCommandsReady', (commands) => {
  if (dormant || dsnIsActive(game)) return;
  registerChatCommands(commands, {
    openSettings: openDicerSettings,
    description: game.i18n.localize('DICER.Commands.Description'),
  });
});

// "Dice look" on actor sheets the user owns: opens the theme browser (lazy chunk) on that actor.
// ApplicationV2 sheets (v14 core, PF2e's new sheets) use getHeaderControls; legacy v1 sheets (PF2e's
// character sheet today) use getActorSheetHeaderButtons. One shared handler. Module load, like the
// chat commands, so the first render of a sheet already has it.
const DICE_LOOK_LABEL = 'DICER.ThemeBrowser.DiceLook';
const DICE_LOOK_ICON = 'fa-solid fa-dice-d20';

/** The actor of a sheet when the user owns it (GMs own everything); else null. Never while Dicer is dormant. */
function ownedActorOf(app) {
  if (dormant || dsnIsActive(game)) return null;
  if (game.settings?.get?.('dicer', 'diceLookButton') === false) return null; // read at hook time: applies on the next render
  const doc = app?.document ?? app?.actor;
  return doc?.documentName === 'Actor' && doc.isOwner === true && doc.id ? doc : null;
}

function openDiceLook(actor) {
  return import('./ui/theme-browser.js')
    .then((m) => m.openThemeBrowser({ target: `actor:${actor.id}` }))
    .catch((err) => console.warn('dicer: cannot open the theme browser', err));
}

let warnedHeader = false;
/** A header hook must never throw into Foundry's sheet render: warn once and add nothing. */
function guarded(fn) {
  return (app, list) => {
    try {
      fn(app, list);
    } catch (err) {
      if (!warnedHeader) {
        warnedHeader = true;
        console.warn('dicer: cannot add the Dice look control', err);
      }
    }
  };
}

export const addDiceLookControl = guarded((app, controls) => {
  const actor = ownedActorOf(app);
  if (!actor || !Array.isArray(controls) || controls.some((c) => c?.action === 'dicerDiceLook')) return;
  controls.push({
    action: 'dicerDiceLook',
    icon: DICE_LOOK_ICON,
    label: DICE_LOOK_LABEL,
    onClick: () => openDiceLook(actor),
  });
});

export const addDiceLookButton = guarded((app, buttons) => {
  const actor = ownedActorOf(app);
  if (!actor || !Array.isArray(buttons) || buttons.some((b) => b?.class === 'dicer-dice-look')) return;
  buttons.unshift({
    class: 'dicer-dice-look',
    icon: DICE_LOOK_ICON,
    label: DICE_LOOK_LABEL,
    onclick: () => openDiceLook(actor),
  });
});

Hooks.on('getHeaderControlsApplicationV2', addDiceLookControl);
Hooks.on('getActorSheetHeaderButtons', addDiceLookButton);
// Foundry's settings window: Dicer's settings under section headings (a lazy chunk). Its root is a
// <form>, whose [0] is its first input: never unwrapped as if it were jQuery.
Hooks.on('renderSettingsConfig', (app, html) =>
  import('./ui/settings-groups.js').then((m) => m.groupSettings(app?.element ?? html)),
);

// Rolling by hand (module load, like the header controls): the card mark (H-15, every viewer) and
// the "Dice tray" tool under the token controls (diceTray on, hand rolls allowed). The tray
// itself is the lazy hand chunk's.
Hooks.on('renderChatMessageHTML', markCard);
Hooks.on('getSceneControlButtons', (c) => {
  try {
    const get = (k) => game.settings.get('dicer', k);
    if (dormant || !c.tokens) return;
    // Roll stats (the lazy window), unless this user hid the tool
    if (get('statsTool') !== false)
      c.tokens.tools.dicerStats = {
        name: 'dicerStats',
        order: 100,
        title: 'DICER.Stats.Title',
        icon: 'fa-solid fa-chart-column',
        button: true,
        onChange: () => import('./ui/roll-stats.js').then((m) => m.openRollStats()),
      };
    if (!get('diceTray') || !handAllowed(game.user, get)) return;
    c.tokens.tools.dicerTray = {
      name: 'dicerTray',
      order: 99,
      title: 'DICER.Tray.Title',
      icon: 'fa-solid fa-dice',
      button: true,
      onChange: () => loadHand(diceBox).then((m) => m?.openTray()),
    };
  } catch {
    /* settings not registered (Dice So Nice active) */
  }
});

// The chat dice tray: its lazy chunk docks it under the chat input, or not (chatTray, Dice Tray).
const dockChat = (e) => dormant || import('./ui/chat-tray.js').then((m) => m.dock(e, loadHand));
for (const h of ['renderChatInput', 'renderChatLog']) Hooks.on(h, (a, e) => dockChat(e));

// Typed-in dice: the chat button (manualButton) and the die shapes in Foundry's dice entry window.
const manual = () => import('./ui/manual-entry.js');
const dockManual = (e, force) => {
  if (!dormant && (force || getSetting('manualButton'))) manual().then((m) => m.dockToggle(e, syncHand));
};
for (const h of ['renderChatInput', 'renderChatLog']) Hooks.on(h, (a, e) => dockManual(e));
// manualEntry (the button, the settings window or a BBMM lock) switches this browser's dice
const syncManual = () => dormant || manual().then((m) => m.syncManual(syncHand));
Hooks.on('renderRollResolver', (app, el) => {
  if (!dormant && getSetting('manualDiceForm') && el.querySelector('[data-method="manual"]'))
    manual().then((m) => m.decorate(app, el, ownLook));
});

Hooks.once('init', () => {
  // an old cached dicer.js after an update: fetch the new one and reload, once
  const warnStale = () => ui.notifications.warn(game.i18n.localize('DICER.Notice.Stale'), { permanent: true });
  watchStaleCopy({
    served: game.modules.get('dicer').version,
    route: (p) => foundry.utils.getRoute(p),
    storage: () => globalThis.sessionStorage,
    fetch: (...a) => globalThis.fetch(...a),
    reload: () => location.reload(),
    notify: () => (game.ready ? warnStale() : Hooks.on('ready', warnStale)),
    win: globalThis,
  });
  if (dsnIsActive(game)) {
    dormant = true;
    registerNoticeSetting();
    return;
  }
  registerSettings({
    onAreaChange: resizeDice,
    onRollAreasChange: () => emitRollAreasChanged(Hooks, getSetting),
    onPetChange: () => (preloadPets(), diceBox?.wake()), // a held resting pet must see pets hidden
    onPetStayChange: () => diceBox?.wake(),
    onLookChange,
    onQualityChange,
    onSoundChange,
    onHandChange: () => (syncHand(), resetControls()), // and the tray tool
    onLayerChange: () => layerDice(),
    onLightingChange: () => lightDice(),
    onTrayChange: () => syncTray(),
    onGrabChange: (on) => syncGrab(diceBox, on),
    onInstalledDiceChange: () => loadInstalled(),
    onManualChange: (entry) => (entry ? syncManual() : dockManual(null, true)),
  });
  try {
    registerHandMethod(); // CONFIG.Dice.fulfillment.methods.dicer with the DicerResolver
  } catch (err) {
    console.warn('dicer: cannot register rolling by hand', err);
  }
  loadPublicApi();
  // Scene lighting follows the canvas: a new scene, a darkness change, a light colour change.
  // A block body: Foundry fires canvasReady with Hooks.call, which stops at a listener returning
  // false, and every module's canvasReady listener after Dicer's would then never run (issue #1).
  for (const hook of ['canvasReady', 'lightingRefresh'])
    Hooks.on(hook, () => {
      if (getSetting('diceLighting') === 'scene') lightDice();
    });
  // On the author's client, before the message is stored: everyone then skips Foundry's clatter.
  // (a block body: a pre-hook listener returning false would cancel the message)
  Hooks.on('preCreateChatMessage', (message) => {
    dropCoreDiceSound(message, {
      enabled: getSetting('muteCoreDiceSound') !== false,
      coreSound: globalThis.CONFIG?.sounds?.dice,
    });
  });
  // Roll stats: counted from every roll message, whether or not its dice are shown here. The
  // recorder is a lazy chunk, loaded at the first roll; messages wait for it in order.
  let recorder = null;
  const countRoll = (message) => {
    if (getSetting('rollStats') === false || !message?.isRoll) return;
    const ts = Date.now();
    recorder ??= import('./stats/recorder.js').then((m) =>
      m.createStatsRecorder({
        getSetting,
        setSetting: (k, v) => game.settings.set('dicer', k, v),
        currentUser: () => game.user,
        isActiveGM: () => game.users?.activeGM?.id === game.user?.id,
      }),
    );
    recorder.then((r) => r.onCreate(message, ts)).catch((err) => console.warn('dicer: cannot load roll stats', err));
  };
  Hooks.on('createChatMessage', (message) => {
    handlers().onCreate(message); // first: the hider reads gate.isAnimating
    initiative?.onCreateMessage(message);
    sendHand(message); // what the gate did not send from its RollStart (not animated here)
    countRoll(message);
  });
  Hooks.on('renderCombatTracker', (app, html) => {
    initiative?.onRenderTracker(app, html);
    // a combat: the rolls of a Roll All are marked from now on (a failed load: thrown one by one)
    if (game.combat) batchChunk().then((m) => m.watchRollInitiative(), () => {});
  });
  updateUserHook = Hooks.on('updateUser', (user, changes) => {
    appearanceRewarm.onUpdateUser(user, changes);
    onOtherUserLook(user, changes);
  });
  Hooks.on('updateChatMessage', (message, changes) => {
    handlers().onUpdate(message, changes);
    sendHand(message); // appended hand rolls (sent ones are no longer stored)
  });
  Hooks.on('renderChatMessageHTML', (message, html) => handlers().onRender(message, html));
  Hooks.on('deleteChatMessage', (message) => handlers().onDelete(message));
  Hooks.on('userConnected', (user, connected) => {
    if (!connected) getPets()?.userGone?.(user.id);
  });
});

Hooks.once('ready', async () => {
  if (dormant) {
    try {
      await notifyGmOnce(game, ui);
    } catch (err) {
      console.error('dicer: cannot show the Dice So Nice notice', err);
    }
    return;
  }
  // The theme API for other modules (a lazy chunk): game.modules.get('dicer').api, handed over by
  // the `dicer.ready` hook, where modules register their themes and default providers.
  try {
    const chunk = await import('./api/theme-api.js');
    const api = chunk.createThemeApi();
    game.modules.get('dicer').api = api;
    Hooks.callAll('dicer.ready', api);
    moreLooks = chunk.aheadLooks({ resolver: () => lookResolver, registry: () => registry, getSetting, rewarm: rewarmSoon, known: () => userLooks() });
    rewarmSoon();
  } catch (err) {
    console.warn('dicer: cannot load the theme API', err);
  }
  // personal settings left the browser for the user settings (1.0.18): this browser's values are
  // copied first, so everything below reads them
  try {
    await moveToUserSettings(game.settings, game.userId);
  } catch (err) {
    console.warn('dicer: cannot copy the browser settings to your user settings', err);
  }
  // The old client `look` setting moves to `theme` once (its onChange mirrors and refreshes).
  const lookMigrated = migrateLookSetting({
    get: getSetting,
    set: (key, value) => game.settings.set('dicer', key, value),
  }).catch((err) => console.warn('dicer: cannot move the look setting to theme', err));
  migratePetStay(game.settings.storage.get('client'), (k, v) => game.settings.set('dicer', k, v));
  syncHand();
  if (getSetting('manualEntry') || Object.keys(getSetting('manualStash') ?? {}).length) syncManual();
  Promise.all([migrateFromDsn(), lookMigrated])
    .then(() => mirrorLookIfMissing(game.user, getSetting('theme')))
    .catch((err) => console.warn('dicer: cannot mirror the theme setting to the user flag', err));
  let api = null;
  const started = await startEngine({
    // loadDigitAtlas appends /digits.json and /digits.png to this folder.
    loadAtlas: () => loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts')),
    // No initial area: DiceBox sends the real one through resize() on construction.
    createPhysics: () =>
      new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() }),
    createRenderer: () =>
      new DiceRenderer({
        container: createLayer(),
        pixelRatioCap: Number(getSetting('pixelRatioCap')) || 1.5,
      }),
    createDiceBox: ({ atlas, physics, renderer }) => {
      digitAtlas = atlas;
      fontAtlases?.dispose();
      // serif is the atlas above; sans and runtime fonts load only when a look uses them
      fontAtlases = createFontAtlases({
        serif: atlas,
        loadBundled: (name) =>
          loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts'), `digits-${name}`),
        createWorker: createFontWorker,
        getRoute: (path) => foundry.utils.getRoute(path),
      });
      // Applies the medium tier now and starts the (cached) probe; rolls never wait for it.
      quality = createQualityController({
        renderer,
        getSetting,
        atlas,
        notify: (message) => ui.notifications?.info(message),
        localize: (key) => game.i18n.localize(key),
      });
      faceTextures = createFaceTextures({ loadImage: loadFaceImage, loadFont: loadFaceFont });
      soundEngine?.dispose();
      soundEngine = createSoundEngine({ getSetting: (k) => getSetting(k), resolveUrl: routeOf });
      let box = null;
      effectLayer?.dispose();
      releasePets(); // the old engine's layer; preloadPets makes one for this engine
      effectLayer = createEffectLayer({
        scene: renderer.scene,
        camera: renderer.camera,
        canvas: renderer.canvas, // screen shake moves the dice canvas only
        getTier: () => quality.config,
        getSetting,
        onPlay: debugCounters.countFx,
        isSafe: () => quality.flags().safe === true,
        isolate: (die) => box?.isolate(die) ?? null,
        box: () => box,
        // The particle pool's programs compile at prefetch (idle), not on the first impact.
        warm: (objects) => renderer.warmObjects(objects),
        // JB2A animations for mapped effects: its player is the lazy `jb2a` chunk.
        jb2a: { source: () => jb2aSource({ modules: game.modules, settings: game.settings }), load: () => import('./jb2a/jb2a.js') },
        // Dice So Nice special effects: `registry` is made later (activate), so read it lazily.
        dsnSfx: createDsnSfx({
          registry: {
            get sfxModes() {
              return registry?.sfxModes;
            },
          },
          getBox: () => ({
            scene: renderer.scene,
            camera: renderer.camera,
            glRenderer: renderer.glRenderer,
          }),
        }),
      });
      petDeps = {
        scene: renderer.scene,
        camera: renderer.camera,
        getTier: () => quality.config,
        getSetting,
        playSound: (sound) => soundEngine?.result(sound),
        warm: (objects) => renderer.warmObjects(objects),
        wake: () => box?.wake(),
        activeRolls: () => box?.activeRolls ?? 0,
        holding: () => box?.holding, // H-8: pets hold still while dice are held
      };
      preloadPets(); // this engine's layer (idle; the old one was released above)
      box = new DiceBox({
        renderer,
        physics,
        atlas,
        getAppearance,
        getFlags: () => quality.flags(),
        shadows: () => getSetting('shadows') !== false,
        lightPools: () => getSetting('diceLight') === true,
        getArea: stageRect,
        diceScale: () => Number(getSetting('diceScale')) || 1,
        timeBeforeHide: () => Number(getSetting('timeBeforeHide')) || 0,
        faceTextures,
        faceLayers: () => getSetting('presetFaces') !== false,
        modelPresets: () => getSetting('presetModels') !== false,
        onModelLoaded: (url) => registry?.noteModelLoaded(url),
        presetFor: (system, type) => registry?.presetFor(system, type) ?? null,
        onMaterial: materialReadyNotifier(Hooks),
        // addSystem(DiceSystem instance): its material callbacks and dice events (api.js).
        systemFor: (id) => registry?.systems.get(id)?.instance ?? null,
        onImpact: (e) => soundEngine?.impact(e),
        getSurface: () => onTray()?.sound() ?? soundSurface(getSetting),
        onLandedFx: (die, fx, rollKey) => landedFx(die, fx, rollKey),
        effects: effectLayer,
        // not loaded yet (the idle preload has not run): a roll with a pet asks for it now
        pet: () => getPets() ?? (preloadPetsNow(), null),
        fonts: fontAtlases,
        onLayer: layerDice,
      });
      return box;
    },
    activate: ({ renderer, diceBox: box }) => {
      diceBox = box;
      diceRenderer = renderer;
      lightDice();
      // Each die resolves its look from its roll's options and its roller's flag; custom die
      // types are shaped through the registry.
      // Model urls go through the same routeOf as face images: one url policy.
      registry = createRegistry({ hooks: Hooks, routeUrl: routeOf });
      const userThemes = (id) => game.users?.get(id)?.getFlag?.('dicer', 'themes');
      const damageThemer = createDamageThemer({
        registry,
        getSetting,
        getUserThemes: userThemes,
        getViewerId: () => game.user?.id,
      });
      damageLooks = () => damageThemer.warmupLooks();
      const resolver = createLookResolver({
        registry,
        getUser: (id) => game.users?.get(id),
        getActor: (id) => game.actors?.get(id),
        damageThemeFor: (roll, userId) => damageThemer.forRoll(roll, userId),
        getWorldThemes: () => getSetting('worldThemes'),
        getWorldDefaultTheme: () => getSetting('worldDefaultTheme'),
        getLockPlayerLooks: () => getSetting('lockPlayerLooks'),
        damageOverDiceSet: () => getSetting('damageOverDiceSet'),
        // Preset faces the digit atlas cannot draw become image / text face layers.
        facesFor: presetFaces,
      });
      lookResolver = resolver;
      // a user's own look for a die: no message, roll, actor or damage theme
      const userLook = (id, term) => resolver.decorate(null, null, id)(term, null, 0)?.appearance;
      ownLook = (faces) => userLook(game.user?.id, { faces, options: {} });
      userLooks = () => userWarmupLooks({ users: game.users?.contents ?? [], viewerId: game.user?.id, lookOf: userLook });
      const ghostDecorateFor = createGhostDecorate({ getSetting, lookOf: userLook });
      const plan = (roll, opts) => planThrow(roll, { shapeFor: resolver.shapeFor, ...opts });
      // Trigger effects ride the same decorator, which the gate and showForRoll call for real
      // views only (ghosts use the ghost decorator, 'none' is not planned): privacy-first.
      const fxResolver = createFxResolver({
        getWorldRules: () => getSetting('worldTriggers'),
        getUserRules: (id) => game.users?.get(id)?.getFlag?.('dicer', 'triggers'),
        getModuleRules: moduleRulesOf(registry),
        getDisabledModuleRules: () => getSetting('disabledModuleTriggers'),
        currentUser: () => game.user,
        getSetting,
        shapeFor: resolver.shapeFor,
        getKnownDamageTypes: damageThemer.knownTypes,
        // The roller's id, so a theme named in the damage map resolves here as on the look path.
        damageThemeFor: (roll, rollerId) => damageThemer.forRoll(roll, rollerId),
        getWorldThemes: () => getSetting('worldThemes'),
        getUserThemes: userThemes,
      });
      // (message, roll, authorId?, rollerId?): looks from the author, rules from the roller.
      const decorateFor = composeDecorateFor({ looks: resolver, fx: fxResolver });
      // Which area each throw lands in on this screen (the roller's; the GM private corner).
      const areas = createAreaResolver({ getSetting, measureUsable: stageRect, currentUser: () => game.user });
      // A dice tray takes every roll this screen shows (whoever rolled); without one, the roll areas.
      tray?.dispose();
      tray = null;
      trayDeps = {
        getSetting,
        setSetting: (k, v) => game.settings.set('dicer', k, v),
        measure: () => measureArea(),
        route: routeOf,
        activeRolls: () => box.showingRolls,
      };
      syncTray();
      const areaFor = (o) => {
        const inTray = onTray()?.area();
        if (inTray) {
          onTray().rolling();
          return inTray;
        }
        return areas.rectFor(o);
      };
      // A user's area as their throws use it: the pet layer moves resting pets when areas change.
      // petTray: 'rim' (pets sit on the tray's rim: perch), 'in' (in the tray), 'away' (roll areas)
      petDeps.areaOf = (id) =>
        box.dieArea((getSetting('petTray') !== 'away' && onTray()?.area()) || areas.rectFor({ rollerId: id }));
      petDeps.perch = () => {
        const r = getSetting('petTray') === 'rim' && onTray()?.perch();
        return r ? box.dieArea(r) : null;
      };
      // Task 8: hand throws from other users, buffered until their message; the chunk on demand.
      const hand = createHandGate({ importChunk: () => loadHand(box), chunkNow: handNow });
      gate = createMessageGate({
        diceBox: box,
        planThrow: plan,
        decorateFor,
        ghostDecorateFor,
        hooks: Hooks,
        getSetting,
        areaFor,
        hand,
        onStarted: sendHand,
        join: (...a) => batchChunk().then((m) => m.join(...a), () => a[3]()),
      });
      initiative = createInitiativeHider({
        gate,
        getCombat: () => game.combat ?? null,
        documentRef: document,
        enabled: () => getSetting('hideInitiative') !== false,
      });
      api = createDice3dApi({
        diceBox: box,
        gate,
        planThrow: plan,
        decorateFor,
        ghostDecorateFor,
        getSetting,
        renderer,
        hooks: Hooks,
        // showForRoll's synchronize: the module socket ("socket": true in module.json).
        socket: game.socket ?? null,
        onHand: hand.accept,
        currentUser: () => game.user,
        fromData: (data) => foundry.dice.Roll.fromData(data),
        registry,
        faceTextures,
        facesFor: presetFaces,
        getArea: stageRect,
        areaFor,
        debugCounters,
        getAtlas: () => digitAtlas,
        getFonts: () => fontAtlases,
        getTier: () => quality?.tier,
        getQualityDrops: () => quality?.drops ?? [],
      });
      dice3d = api;
      game.dice3d = api;
      // The lazy hand chunk on demand, attached to this engine's DiceBox; with options it opens the
      // throw overlay ({specs, rect?, timeoutMs?, ...}: live checks until the resolver opens it).
      api._debug.hand = (o) =>
        loadHand(box).then((m) => (o ? m.openThrowOverlay({ diceBox: box, ...o }) : m));
      // The pet layer's pets on this screen (live checks, support): null until the chunk is in.
      api._debug.pets = () => getPets()?.debug?.() ?? null;
      // What the DicerResolver's body (the hand chunk) throws with.
      setHandDeps({
        diceBox: box,
        // rolling by hand lands in the tray too (and shows a tray that shows only during rolls)
        areas: { ...areas, rectFor: areaFor },
        decorateFor,
        plan,
        getSetting,
        getCore,
        hooks: Hooks,
        user: () => game.user,
        // the roller's pet for a throw on this screen (physics decides, by hand, the dice tray)
        petSpec: (ghost) => petFor({ user: game.user, view: ghost ? 'ghost' : 'real', getSetting }),
      });
      // The sidebar is observed directly: v14 fires collapseSidebar mid-transition.
      stopWatchingArea = watchArea(() => (resizeDice(), tray?.refresh()));
      // The look-extras chunk landed: later rolls draw the real looks, not their fallbacks.
      stopLookExtras = onLookExtrasReady(refreshMaterials);
      // 'shader': the low fallback or the P2-R12 safe flags; dice in flight move over too.
      quality.onChange((event) => refreshMaterials({ replaceInFlight: event.reason === 'shader' }));
      // three rebuilds every program lazily on a restored context: compile them ahead again.
      renderer.onContextRestored(() => warmUp());
      // Once the probe has picked the tier: rebuild for it and compile ahead of the first roll.
      // Not awaited, so the probe never delays readiness; no render loop starts.
      quality.ready
        .then(() => refreshMaterials())
        .catch((err) => console.warn('dicer: quality setup failed', err));
    },
  });
  if (!started) {
    appearanceRewarm.dispose();
    clearTimeout(otherLookTimer);
    userLooks = () => [];
    lookResolver = null;
    if (updateUserHook !== null) Hooks.off('updateUser', updateUserHook);
    updateUserHook = null;
    quality?.dispose();
    quality = null;
    gate = null;
    initiative = null;
    diceBox = null;
    diceRenderer = null;
    registry = null;
    faceTextures = null;
    dice3d = null;
    fontAtlases?.dispose(); // its textures and the font builder's worker
    fontAtlases = null;
    digitAtlas = null;
    soundEngine?.dispose();
    soundEngine = null;
    effectLayer?.dispose();
    effectLayer = null;
    releasePets();
    petDeps = null;
    setHandDeps(null); // a dicer roll then falls back to Foundry's random
    stopWatchingArea?.();
    stopWatchingArea = null;
    stopLookExtras?.(); // idempotent: no reset needed
    api?._dispose();
    if (api && game.dice3d === api) delete game.dice3d;
    return;
  }
  // The GM's Dice So Nice add-ons (inactive modules that need Dice So Nice; a lazy chunk) run
  // first, so their diceSoNice hooks hear the announcement.
  const addons = getSetting('dsnAddons');
  // After api.js has loaded, so game.dice3d.DiceSystem is set inside both hooks. Not awaited:
  // the engine is already up, and announceReady never rejects.
  Promise.resolve(addons?.length && import('./compat/installed-dice.js').then((m) => m.loadDsnAddons(addons)).catch(() => {}))
    .then(() => announceReady({ hooks: Hooks, api, apiReady: globalThis.DicerAPIReady }))
    .then(() => {
      loadInstalled();
      importDsnSaves();
    });
  preloadSounds();
  preloadEffects();
  preloadPets();
  preloadEditors();
  idle(() => prefetchHand(diceBox, () => wantsHand(game.user, getSetting, getCore()))); // H-20, M8
  idle(() => syncGrab(diceBox, getSetting('grabDice')));
  // Another module's dice tray is active: the picker chunk asks which to keep (issue #5).
  if (TRAY_MODULE_IDS.some((id) => game.modules.get(id)?.active))
    idle(() => import('./ui/tray-pick.js').then((m) => m.askTrayPick()).catch(() => {}));
});
