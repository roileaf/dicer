import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  BUDGET,
  WORLD_START_ASSETS,
  distFiles,
  isLazy,
  worldStartFiles,
} from '../../build/world-start.js';

// The world-start set (non-lazy dist/ plus the digit atlas and api.js), the lazy chunk list and
// the budget live in build/world-start.js, shared with scripts/bundle-report.mjs.
const worldStartBytes = () => worldStartFiles().reduce((sum, p) => sum + statSync(p).size, 0);

describe('build', () => {
  beforeAll(() => execSync('node node_modules/vite/bin/vite.js build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('emits the GLTF loader, the DSN migration, the audio synth, the effects library and the trigger editor as their own chunks, out of the world-start bundle', () => {
    const lazy = distFiles().filter((p) => isLazy(p));
    const chunk = lazy.find((p) => /model-loader-/.test(p));
    const migration = lazy.find((p) => /migration-/.test(p));
    const synth = lazy.find((p) => /synth-/.test(p));
    const effects = lazy.find((p) => /effects-/.test(p));
    const editor = lazy.find((p) => /trigger-editor-/.test(p));
    const damageEditor = lazy.find((p) => /damage-map-editor-/.test(p));
    const areaEditor = lazy.find((p) => /area-editor-/.test(p));
    const themeBrowser = lazy.find((p) => /theme-browser-/.test(p));
    const appearanceEditor = lazy.find((p) => /appearance-editor-/.test(p));
    const themeForm = lazy.find((p) => /theme-form-/.test(p)); // theme helpers + thumbnailer, shared by the theme browser and the appearance editor
    const damageForm = lazy.find((p) => /damage-map-form-/.test(p)); // shared by the damage map editor and the theme browser
    const soundNames = lazy.find((p) => /sound-names-/.test(p)); // the built-in sound list, shared by the synth and the editor
    const points = lazy.find((p) => /(LineSegments|InterleavedBufferAttribute)-/.test(p)); // three's InterleavedBuffer(Attribute), shared by the effects and model-loader chunks (named after its first export)
    const fontBuilder = lazy.find((p) => /font-builder-/.test(p)); // runtime font atlases (P7-D3)
    const sdfBuilder = lazy.find((p) => /sdf-builder-/.test(p)); // the SDF builder, shared by font-builder and look-extras (icons)
    const fontWorker = lazy.find((p) => /font-worker-/.test(p));
    const benchAdapter = lazy.find((p) => /dicer-adapter-/.test(p)); // game.dice3d.benchmark(): adapter + runner
    const benchApp = lazy.find((p) => /benchmark-app-/.test(p));
    const benchReport = lazy.find((p) => /^dist\/report-/.test(p)); // the bench library (scenarios, stats, recorder, report)
    const lookExtras = lazy.find((p) => /look-extras-/.test(p)); // new look shader code (dice designs)
    const pets = lazy.find((p) => /^dist\/pet-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the dice pet layer
    const threePoints = lazy.find((p) => /^dist\/Points-[A-Za-z0-9_-]{8}\.js$/.test(p)); // three's Points, shared by the pet chunk and the model loader
    const elementOf = lazy.find((p) => /^dist\/element-of-[A-Za-z0-9_-]{8}\.js$/.test(p)); // elementOf, shared by the effects and pet chunks
    const hand = lazy.find((p) => /^dist\/hand-[A-Za-z0-9_-]{8}\.js$/.test(p)); // rolling by hand (src/hand/hand.js)
    const grab = lazy.find((p) => /^dist\/grab-[A-Za-z0-9_-]{8}\.js$/.test(p)); // grab and toss (src/grab/grab.js)
    expect(grab).toBeTruthy();
    expect(readFileSync(grab, 'utf8')).toContain('dicer-grab-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-grab-chunk');
    const rollFilters = lazy.find((p) => /^dist\/roll-filters-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the Roll filters window
    expect(rollFilters).toBeTruthy();
    expect(readFileSync(rollFilters, 'utf8')).toContain('dicer-roll-filters');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-roll-filters');
    const petWindow = lazy.find((p) => /^dist\/pet-window-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the Your pet window
    expect(petWindow).toBeTruthy();
    expect(readFileSync(petWindow, 'utf8')).toContain('dicer-pet-window');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-pet-window');
    const settingsGroups = lazy.find((p) => /^dist\/settings-groups-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the settings sections
    expect(settingsGroups).toBeTruthy();
    expect(readFileSync(settingsGroups, 'utf8')).toContain('dicer-settings-group');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-settings-group');
    const jb2a = lazy.find((p) => /^dist\/jb2a-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the JB2A player (src/jb2a/jb2a.js)
    const chatTray = lazy.find((p) => /^dist\/chat-tray-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the chat dice tray (src/ui/chat-tray.js)
    const trayDice = lazy.find((p) => /^dist\/tray-dice-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the tray core, shared by the hand and chat-tray chunks
    expect(chatTray).toBeTruthy();
    expect(trayDice).toBeTruthy();
    // docked lazily on the first chat render: dicer.js only names the chunk, never its code or the hand chunk's
    expect(readFileSync(chatTray, 'utf8')).toContain('dicer-chat-tray');
    expect(readFileSync(chatTray, 'utf8')).not.toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-chat-tray');
    expect(readFileSync('dist/dicer.js', 'utf8')).toContain(chatTray.slice('dist/'.length));
    expect(jb2a).toBeTruthy();
    expect(readFileSync(jb2a, 'utf8')).toContain('Library/Generic');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('Library/Generic');
    expect(pets).toBeTruthy();
    // The hand chunk is lazy: only src/hand/hand-loader.js names it (import()); dicer.js never holds its code.
    expect(hand).toBeTruthy();
    expect(readFileSync(hand, 'utf8')).toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).toContain(hand.slice('dist/'.length));
    // The dice tray (window, throw, styles) is the hand chunk's; world start only adds its tool.
    expect(readFileSync(hand, 'utf8')).toContain('dicer-tray-style');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-tray');
    expect(threePoints).toBeTruthy();
    // lazy for real: only the lazy chunks import it, never the world-start bundle
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain(threePoints.slice('dist/'.length));
    expect(elementOf).toBeTruthy();
    const atlasReader = lazy.find((p) => /^dist\/atlas-[A-Za-z0-9_-]{8}\.js$/.test(p)); // Dice So Nice atlases (src/compat/atlas.js)
    expect(atlasReader).toBeTruthy();
    expect(readFileSync(atlasReader, 'utf8')).toContain('#xywh=');
    const trayEditor = lazy.find((p) => /^dist\/tray-editor-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the Dice tray window
    expect(trayEditor).toBeTruthy();
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-tt-editor-app');
    // the table tray itself and its rules, shared by the tray and its window: loaded once a tray is wanted
    const tableTray = lazy.find((p) => /^dist\/tray-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const trayModel = lazy.find((p) => /^dist\/tray-model-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(tableTray).toBeTruthy();
    expect(trayModel).toBeTruthy();
    // the dice tray in a window of its own (another screen): opened from the Dice tray window
    const trayWindow = lazy.find((p) => /^dist\/popout-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(trayWindow).toBeTruthy();
    // dice of installed modules that are not active: the loader and the GM's picker
    const installedDice = lazy.filter((p) => /^dist\/installed-dice-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(installedDice).toHaveLength(2);
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-installed-dice');
    // Dice So Nice add-on textures (their bump maps as normal maps), shared by the loader and the look extras
    const addonTextures = lazy.find((p) => /^dist\/addon-textures-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(addonTextures).toBeTruthy();
    // the GM's Dice So Nice migration report window (with its report data)
    const dsnReport = lazy.find((p) => /^dist\/dsn-report-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(dsnReport).toBeTruthy();
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-dsn-report');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-tt-edge');
    // the crit scenes (the effects chunk imports them on a scene's first play), their catalog
    // (shared with the theme editors), and the three geometries the lazy chunks share (named after
    // one of them): never imported statically by dicer.js, or they would be world-start code
    const scenes = lazy.find((p) => /^dist\/scenes-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const sceneCatalog = lazy.find((p) => /^dist\/scene-catalog-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const geometries = lazy.filter((p) => /^dist\/[A-Z][A-Za-z]*Geometry-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(scenes && sceneCatalog).toBeTruthy();
    expect(geometries.length).toBeGreaterThan(0);
    const mainSrc = readFileSync('dist/dicer.js', 'utf8');
    for (const g of geometries) expect(mainSrc).not.toMatch(new RegExp(`from\\s*["']\\./${g.slice(5).replace(/[.]/g, '\\.')}["']`));
    expect(readFileSync(scenes, 'utf8')).toContain('dicer-scenes-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-scenes-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('Shadow Thief');
    // the theme API for other modules (src/api/theme-api.js): loaded in Dicer's ready hook
    const themeApi = lazy.find((p) => /^dist\/theme-api-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(themeApi).toBeTruthy();
    expect(readFileSync(themeApi, 'utf8')).toContain('registerDefaultProvider');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('registerDefaultProvider');
    // fonts add-on modules registered (api.registerFont): read by lazy chunks only
    const addonFonts = lazy.find((p) => /^dist\/addon-fonts-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(addonFonts).toBeTruthy();
    // the registry's own destructuring of a font ({ id, moduleId, label, file }) lives in the chunk, not in world start
    const fontRow = /\{id:\w+,moduleId:\w+,label:\w+,file:\w+\}/;
    expect(readFileSync(addonFonts, 'utf8')).toMatch(fontRow);
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toMatch(fontRow);
    // what add-ons registered for Dicer's windows (tabs, showInAll, stubs): read by lazy chunks only
    const addonRegistry = lazy.find((p) => /^dist\/addon-registry-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(addonRegistry).toBeTruthy();
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer.themesChanged');
    // the pet accessory registry (api.registerPetAccessory), shared by the theme API and pet chunks
    const petAccessories = lazy.find((p) => /^dist\/pet-accessories-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(petAccessories).toBeTruthy();
    // the tray picker (issue #5) and the other trays' list it shares with the chat dice tray
    const trayPick = lazy.find((p) => /^dist\/tray-pick-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const otherTrays = lazy.find((p) => /^dist\/other-trays-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(trayPick && otherTrays).toBeTruthy();
    expect(readFileSync(otherTrays, 'utf8')).toContain('enableDiceTray');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('enableDiceTray');
    // roll stats: the window, the pet moods it shares with the pet chunk, the recorder (first roll)
    const rollStats = lazy.find((p) => /^dist\/roll-stats-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const moods = lazy.find((p) => /^dist\/moods-[A-Za-z0-9_-]{8}\.js$/.test(p));
    const recorder = lazy.find((p) => /^dist\/recorder-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(rollStats && moods && recorder).toBeTruthy();
    expect(readFileSync(rollStats, 'utf8')).toContain('dicer-roll-stats');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-roll-stats');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('cannot save roll stats');
    // Roll All as one throw (src/foundry/initiative-batch.js): loaded with a combat's tracker, and by the hand chunk
    const initiativeBatch = lazy.find((p) => /^dist\/initiative-batch-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(initiativeBatch).toBeTruthy();
    expect(readFileSync(initiativeBatch, 'utf8')).toContain('cannot mark an initiative roll');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('cannot mark an initiative roll');
    // typed-in dice (src/ui/manual-entry.js): the die shapes and the chat button
    const manualEntry = lazy.find((p) => /^dist\/manual-entry-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(manualEntry).toBeTruthy();
    expect(readFileSync(manualEntry, 'utf8')).toContain('dicer-manual-style');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-manual-style');
    // lazy for real too: no world-start file names it
    for (const f of worldStartFiles().filter((p) => p.endsWith('.js')))
      expect(readFileSync(f, 'utf8')).not.toContain(elementOf.slice('dist/'.length));
    expect(lookExtras).toBeTruthy();
    expect(readFileSync(lookExtras, 'utf8')).toContain('dicer-look-extras');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-look-extras');
    expect(benchAdapter).toBeTruthy();
    expect(benchApp).toBeTruthy();
    expect(benchReport).toBeTruthy();
    expect(readFileSync(benchApp, 'utf8')).toContain('dicer-benchmark');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-benchmark');
    expect(readFileSync(benchReport, 'utf8')).toContain('Dicer benchmark');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('Dicer benchmark');
    expect(fontBuilder).toBeTruthy();
    expect(sdfBuilder).toBeTruthy();
    expect(fontWorker).toBeTruthy();
    // The SDF builder lives in the lazy chunks only; dicer.js just names the worker's URL.
    expect(readFileSync(sdfBuilder, 'utf8')).toContain('nodigits');
    expect(readFileSync(fontWorker, 'utf8')).toContain('nodigits');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('nodigits');
    expect(WORLD_START_ASSETS.some((p) => p.includes('digits-sans'))).toBe(false);
    expect(
      WORLD_START_ASSETS.some((p) => /digits-(blackletter|norse|uncial|scifi|handwritten|deco)/.test(p)),
    ).toBe(false);
    expect(synth).toBeTruthy();
    expect(editor).toBeTruthy();
    expect(soundNames).toBeTruthy();
    // The editor is code + templates' logic; only the settings menu proxy is in the world-start bundle.
    expect(readFileSync(editor, 'utf8')).toContain('dicer-trigger-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-trigger-editor');
    expect(damageEditor).toBeTruthy();
    expect(readFileSync(damageEditor, 'utf8')).toContain('dicer-damage-map-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-damage-map-editor');
    expect(areaEditor).toBeTruthy();
    expect(readFileSync(areaEditor, 'utf8')).toContain('dicer-area-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-area-editor');
    expect(themeBrowser).toBeTruthy();
    expect(readFileSync(themeBrowser, 'utf8')).toContain('dicer-theme-browser');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-theme-browser');
    expect(appearanceEditor).toBeTruthy();
    expect(readFileSync(appearanceEditor, 'utf8')).toContain('dicer-appearance-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-appearance-editor');
    expect(themeForm).toBeTruthy();
    expect(effects).toBeTruthy();
    expect(readFileSync(effects, 'utf8')).toContain('glow-pulse');
    expect(readFileSync(effects, 'utf8')).toContain('shockwave');
    // Effect ids are data (the damage themes name them); the library's shader uniforms are code.
    expect(readFileSync(effects, 'utf8')).toContain('uAlpha');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('uAlpha');
    expect(migration).toBeTruthy();
    expect(chunk).toBeTruthy();
    expect(readFileSync(chunk, 'utf8')).toContain('KHR_draco_mesh_compression');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('KHR_draco_mesh_compression');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('has no Dicer counterpart yet');
    expect(readFileSync(migration, 'utf8')).toContain('has no Dicer counterpart yet');
    expect(lazy.sort()).toEqual(
      [
        chunk,
        migration,
        synth,
        effects,
        editor,
        damageEditor,
        areaEditor,
        themeBrowser,
        appearanceEditor,
        themeForm,
        damageForm,
        soundNames,
        points,
        fontBuilder,
        sdfBuilder,
        fontWorker,
        benchAdapter,
        benchApp,
        benchReport,
        lookExtras,
        pets,
        threePoints,
        elementOf,
        atlasReader,
        trayEditor,
        tableTray,
        trayModel,
        trayWindow,
        ...installedDice,
        addonTextures,
        dsnReport,
        scenes,
        sceneCatalog,
        themeApi,
        addonFonts,
        addonRegistry,
        petAccessories,
        trayPick,
        otherTrays,
        ...geometries,
        hand,
        grab,
        rollFilters,
        petWindow,
        settingsGroups,
        jb2a,
        chatTray,
        trayDice,
        rollStats,
        moods,
        recorder,
        initiativeBatch,
        manualEntry,
        'dist/draco/draco_decoder.wasm',
        'dist/draco/draco_wasm_wrapper.js',
      ].sort(),
    );
  });
  it("hand chunk is lazy and dist/dicer.js does not contain 'dicer-hand-chunk'", () => {
    const hand = distFiles().find((p) => /^dist\/hand-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(hand).toBeTruthy();
    expect(isLazy(hand)).toBe(true);
    expect(worldStartFiles()).not.toContain(hand);
    const chunk = readFileSync(hand, 'utf8');
    expect(chunk).toContain('dicer-hand-chunk');
    expect(chunk).toContain('dicer: a throw recorder threw'); // the hand half of DiceBox lives here
    const main = readFileSync('dist/dicer.js', 'utf8');
    expect(main).not.toContain('dicer-hand-chunk');
    expect(main).not.toContain('dicer: a throw recorder threw');
  });
  // 7 KiB since Sherp's second batch (nine themes, 39 in all): owner approved, 2026-11-17.
  it('keeps the built-in theme table under 7 KiB minified (P5-R1)', () => {
    const js = readFileSync('dist/dicer.js', 'utf8');
    const a = js.indexOf('@@dicer-themes-start');
    const b = js.indexOf('@@dicer-themes-end');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const bytes = Buffer.byteLength(js.slice(a, b + 20));
    console.info(`dicer theme table: ${bytes} bytes minified`);
    expect(bytes).toBeLessThanOrEqual(7 * 1024);
  });
  it('leaves api.js out of the bundle: it ships beside module.json, imported at runtime', () => {
    expect(statSync('api.js').isFile()).toBe(true);
    for (const p of distFiles().filter((f) => f.endsWith('.js'))) {
      expect(readFileSync(p, 'utf8')).not.toContain('SETTING_FORMATING');
    }
  });
  it('strips comments and indentation from the shaders in the world-start bundle (Plan 8 Task 6)', () => {
    const js = readFileSync('dist/dicer.js', 'utf8');
    // A comment in three's alphahash_pars_fragment chunk, and one in Dicer's noise library.
    expect(js).not.toContain('Derived from trials only');
    expect(js).not.toContain('Rotate-ish and scale between octaves');
    expect(js).toContain('#include <lights_physical_pars_fragment>');
  });
  it('does not grow the world-start download by more than 2 KB (ratchet, Plan 8 Task 6)', () => {
    // 4_086_989 bytes after Task 6 (GLSL stripping), 107 KB under the 4 MiB budget (H-R9 keeps
    // 4 MiB): the headroom must not be spent unnoticed. Lower this reference whenever world start
    // shrinks. P9-R8 raised it by 650 bytes on purpose (4_087_639): the adaptive-quality drop log
    // the benchmark reads must live in the world-start renderer. P9-R16 re-based it on the bundle
    // as it stood (4_090_248, about 105 KB under the 4 MiB budget) after the single-mesh blob
    // shadows (+565 bytes) spent the last of the allowance; the next 2 KB must again be noticed.
    // The preview buttons re-based it on purpose (4_092_397): api._throwLook lives in the
    // world-start API (the editors call it through game.dice3d). The readable-numbers fix
    // re-based it on purpose (+1_738, 4_094_135): every die's material picks its number colour
    // against the die's own colour, so the contrast rule lives in the world-start renderer.
    // Dice designs plan 1 re-based it on purpose (4_094_135): its option lists, normalisation and
    // the look-extras loader must live in world start (spec Constraints, World-start size); plan 1
    // may spend at most 1,536 bytes of the next 2 KB.
    // Dice designs plan 2 re-based it on purpose (4_095_655): plan 2 may spend at most 1,024
    // bytes of the next 2 KB.
    // Dice designs plan 3 re-based it on purpose (4_096_369): plan 3 may spend at most 768 bytes
    // of the next 2 KB.
    // Dice designs plan 4 re-based it on purpose (4_097_080): plan 4 may spend at most 1,536 bytes
    // of the next 2 KB.
    // dice pet plan: 4,096,854 + 2,048; the plan's cap is 4,096 B over 4,096,854 (controller
    // ruling, ledger). All pet art, animation and sound is lazy.
    // pet splat plan: 1,536 B cap + 64 B controller allowance (ledger) over 4,100,546.
    // pet splat plan: +512 B for the final-review fixes (ledger).
    // pet dodge plan: 512 B over 4,102,587
    // rolling by hand plan: 12,288 B cap over 4,103,020 (owner approval, 2026-11-14). Re-based once,
    // at its Task 1 (pre-flight R1), so no later task re-bases it.
    // living insides plan: re-based on the bundle as it stood after rolling-by-hand plus later plans
    // (4,115,282, i.e. 13.6 KB past the rolling-by-hand base, beyond that plan's 12,288 B cap); this
    // plan may spend 1,536 B (controller ruling during the plan; owner informed at sign-off).
    // edge strips plan (2026-11-15-dicer-edge-strips): +300 B on the same base for the strip look
    // field (owner approval, 2026-11-15).
    // elemental trails: owner raised the allowance by 500 B (1,836 -> 2,336) for trails and bursts.
    // tester requests (2026-11-16): owner approved raising it for the batch; dice above windows
    // +968 B (2,336 -> 3,304); number size/weight, module dice sets, chat tray and grab and toss
    // +854 B together (3,304 -> 4,158); layered insides and per-look motion +300 B (4,158 -> 4,458).
    // Physical dice (Pixels coexistence, physicalDice setting and card mark): owner approved +845 B
    // (4,458 -> 5,303), 2026-11-16.
    // Face images (appearance.faces): owner approved +911 B (5,303 -> 6,214), 2026-11-16.
    // pet interactions: owner raised it by 300 B for the five pet settings, then by 191 B when
    // merged with the tester-request batch: +491 B (6,214 -> 6,705).
    // Body images (appearance.bodyImage): owner approved +1,490 B (6,705 -> 8,195), 2026-11-16.
    // Dice So Nice texture images and fonts from module colorsets: owner approved +513 B
    // (8,195 -> 8,708), 2026-11-16.
    // Per-value Dice So Nice model rotations (d8-d20 models): owner approved +314 B
    // (8,708 -> 9,022), 2026-11-16.
    // TEXTURELIST in game.dice3d.exports (module dice previews draw texture art): owner approved
    // +48 B (9,022 -> 9,070), 2026-11-16.
    // Roll filters (the rules showForRoll asks before every throw, two settings, the menu): owner
    // approved +1,621 B (9,070 -> 10,691), 2026-11-16.
    // Module models on d4, the d100 tens die and hand-thrown dice (Playback's follow call, the
    // per-value rules; the follow logic itself is in the model chunk): owner approved +216 B
    // (10,691 -> 10,907), 2026-11-16.
    // The theme browser's Throw hands a module dice set's presets (system, faces, model) to each
    // die: owner approved +173 B (10,907 -> 11,080), 2026-11-16.
    // Theme face images for the coin, the Fate die and the d100 tens die (compat/faces.js keys,
    // the faces schema, DiceBox and the thumbnailer): owner approved +196 B (11,080 -> 11,276),
    // 2026-11-16.
    // The damageOverDiceSet setting (resolve-looks) and the Your pet menu: owner approved +364 B
    // (11,276 -> 11,640), 2026-11-16.
    // Sherp's eight built-in themes (the theme table and its author credit): owner approved
    // +1,722 B (11,640 -> 13,362), 2026-11-16.
    // Module dice faces (bump/glow maps, atlases, d100), dice lighting, light pools, the long dice
    // shapes and the stone/bone/jelly/mirror hooks: owner approved +7,251 B (13,362 -> 20,613),
    // 2026-11-17.
    // The glint trigger, Animater moments in trigger rules and Dicer's ready-made module rules:
    // owner approved +1,764 B (20,613 -> 22,377), 2026-11-17.
    // Dice trays (their settings and the lazy tray's hookup; the tray, its rules and its window
    // are lazy chunks): owner approved with the 0.3.0 release, +1,334 B (22,377 -> 23,711), 2026-11-17.
    // Tester fixes: the petInTray (now petTray) and trayPresets settings, the tray shown while its window is open,
    // hand throws into the tray, glowing dice lighting the table, the Animater moment check and the
    // tray fading with the dice: owner approved +735 B (23,711 -> 24,446), 2026-11-17.
    // Pets on the tray's rim (the petTray setting, the perch hookup, wall hits to the pet layer):
    // owner approved +281 B (24,446 -> 24,727), 2026-11-17.
    // The diceLight setting (clear and glowing dice light the table only when it is on; off by
    // default) and DiceBox's lightPools check: owner approved +218 B (24,727 -> 24,945), 2026-11-17.
    // Animater moments, all 16 with where each plays (screen, at the dice, the roller's token) and a
    // strength, the dice's map point and the speaker token: owner approved +1,031 B (24,945 -> 25,976),
    // 2026-11-17.
    // Dice walls that follow round, hexagon and octagon trays (the physics worker's shape walls,
    // their closing and corner herding; the tray's shape passed to it): owner approved +1,700 B
    // (25,976 -> 27,676), 2026-11-17.
    // The dice tray on another screen (main's hookup: the pop-out's stage and tray, the button's
    // hook; the window is the lazy popout chunk): owner approved +467 B (27,676 -> 28,143), 2026-11-17.
    // Dice from installed modules that are not active (the installedDice setting and main's call
    // into the lazy loader): owner approved +310 B (28,143 -> 28,453), 2026-11-17.
    // Readable numbers on the built-in themes (contrast.js counts resin darker and sparse insides
    // less; five themes' number colours): owner approved +120 B (28,453 -> 28,573), 2026-11-17.
    // Roll stats (the rollStats, statsTool, rollStatsSession and rollStatsHidden settings, the menu,
    // the token tool and main's loader for the lazy recorder; the window and recorder are lazy
    // chunks): owner approved +1,227 B (28,573 -> 29,800), 2026-11-17.
    // The GM's Dice So Nice migration report menu (its settings entry; the window and report data
    // are the lazy dsn-report chunk): owner approved +147 B (29,800 -> 29,947), 2026-11-17.
    // A landing sound for every damage type (the 11 names in the damage table and the sound-only
    // landing; the sounds are in the lazy synth chunk): owner approved +119 B (29,947 -> 30,066), 2026-11-17.
    // "Physics decides" (the handRolls choice, the chat card's atom mark; the roll path is in the
    // lazy hand chunk), with the v14 resolver getter fix: owner approved +139 B (30,066 -> 30,205), 2026-11-17.
    // Physics decides as its own setting (physicsResults), out of Roll by hand: owner approved +28 B
    // (30,205 -> 30,233), 2026-11-17.
    // 128-bit throw seeds (Web Crypto seed creation and checks in DiceBox; xoshiro128** in the
    // physics worker): owner approved +819 B (30,233 -> 31,052), 2026-11-17.
    // A fresh collider frame and point order per throw (sim.js framedPoints: the d12 face bias
    // from Rapier's internal layout averages out): owner approved +477 B (31,052 -> 31,529), 2026-11-17.
    // Glow ink brightness (numbers.inkGlow in the look) and stone dice's number contrast with their
    // second colour: owner approved +152 B (31,529 -> 31,681), 2026-11-17.
    // Keep numbers readable (numbers.contrast: a picked colour is drawn as picked): owner approved
    // +62 B (31,681 -> 31,743), 2026-11-17.
    // Sherp's second batch of themes (nine new, Wonderland and Eruption updated; the theme table
    // is in the world-start bundle): owner approved +2,237 B (31,743 -> 33,980), 2026-11-17.
    // Damage dice looks compiled at world start and one fade clone kept per material (the freezes
    // on a first damage roll and as dice fade): owner approved +1,210 B (33,980 -> 35,190), 2026-11-18.
    // Picture tray opacity and darkness (two tray look fields and the veil colour in trayStyle):
    // owner approved +18 B (35,190 -> 35,208), 2026-11-18.
    // Damage looks warmed 3 at a time, a timeout logged as info (+158 B), measured with the dice
    // pets work then in progress (+67 B): owner approved +225 B (35,208 -> 35,433), 2026-11-18.
    // One damage look per compile with a pause between where compiles block the page, the GPU
    // name without Firefox's deprecated extension (+368 B), measured with the dice pets work then
    // in progress (+82 B): owner approved +450 B (35,433 -> 35,883), 2026-11-18.
    // Without parallel compiling only the own look warms at load, and a throw compiles its fade
    // programs as it starts (DiceBox #compileFades): owner approved +415 B (35,883 -> 36,298), 2026-11-18.
    // The physics and font workers start from a same-origin blob when the module is served from
    // another origin (The Forge's asset CDN): owner approved +103 B (36,298 -> 36,401), 2026-11-18.
    // The pet window's Preview (a local one-d20 throw: _throwLook takes the die types):
    // owner approved +3 B (36,401 -> 36,404), 2026-11-18.
    // Pet view (the petView client setting: from above, angled, facing you): owner approved
    // +114 B (36,404 -> 36,518), 2026-11-18.
    // Pets from artist-style models (a skinned model is copied with its own skeleton: one more
    // three.js class at world start): owner approved +15 B (36,518 -> 36,533), 2026-11-18.
    // The pet on your own physics, hand and dice-bar throws, pet models preloaded at ready, and the
    // pets' result and "ooh?" sound names: owner approved +267 B (36,533 -> 36,800), 2026-11-18.
    // Each pet kind's own voice (a sound may bring its own buffer: sound.voice(ctx)): owner approved
    // +89 B (36,800 -> 36,889), 2026-11-18.
    // The pet sound volume setting, cocked dice nudged as they rest (tipped toward their nearest
    // face, in the physics worker) and a free roll's slow motion from its message: owner approved
    // +1,147 B (36,889 -> 38,036), 2026-11-18.
    // A player's Dice So Nice saved looks imported as themes after diceSoNiceReady (the GM report's
    // import-all reads the registry) and the benchmark's stop signal: owner approved +684 B
    // (38,036 -> 38,720), 2026-11-18.
    // Personal settings moved from the browser to user settings, with the one-time copy of this
    // browser's old values on ready: owner approved +580 B (38,720 -> 39,300), 2026-11-18.
    // The stale-copy repair (an old cached dicer.js after an update is fetched again and the page
    // reloads once; a chunk that fails to load does the same): owner approved +1,000 B
    // (39,300 -> 40,300), 2026-11-19.
    // animateRoll's Dice So Nice call shape (author, speaker -> the actor's theme, messageMode
    // 'blind'), the speaker reaching the looks and trigger effects: owner approved +400 B
    // (40,300 -> 40,700), 2026-11-19.
    // Dice So Nice add-ons run while they stay off (the dsnAddons setting and main's call into the
    // lazy loader before announceReady): owner approved +300 B (40,700 -> 41,000), 2026-11-19.
    // PF2e precision damage (the type, its default map entry and the built-in Precision look with
    // sharp edges and a crystal d4): owner approved +205 B (41,000 -> 41,205), 2026-11-19.
    // A theme's own damage dice looks (theme.damage: the look resolver finds the die's own theme
    // and hands its map to the damage themer, ranked under the viewer's override): owner approved
    // +255 B (41,205 -> 41,460), 2026-11-19.
    // A module dice set's animated material keeps its dice drawing (its mixer, as Dice So Nice does:
    // IRL Dice Packs' moving insides) and crit title cards name their roller: owner approved
    // +40 B (41,460 -> 41,500), 2026-11-19.
    // A module dice set's own natural 20 / natural 1 effects (rules.js setRules, IRL Dice Packs'
    // lists), dice staying while a Dice So Nice effect plays, and a DSN appearance's colorset:
    // owner approved +350 B (41,500 -> 41,850), 2026-11-19.
    // A theme imported from a module dice set keeps its system (themes.js, resolve-looks) and Dice So
    // Nice colour sets' bigger, bolder numbers: owner approved +50 B (41,850 -> 41,900), 2026-11-19.
    // Dice So Nice's SPAWN event hands the die (dice.mesh: IRL's smoked glass) and a chat message's
    // speaker brings its actor's theme: owner approved +60 B (41,900 -> 41,960), 2026-11-19.
    // A preview's last frame lowers the dice and tray from above windows (dice-box _finish):
    // owner approved +20 B (41,960 -> 41,980), 2026-11-20.
    // A module set's face images cover its Dice So Nice texture tile (compat/faces.js DSN_TILE_HALF,
    // the uFaceHalf uniform): owner approved +280 B (41,980 -> 42,260), 2026-11-20.
    // Five new pet kinds (fox, lantern, imp, robot, jester: their names in pet-for.js PET_KINDS; the
    // creatures, models and sounds are lazy): owner approved +64 B (42,260 -> 42,324), 2026-11-20.
    // Previews land in the user's own area or table tray (api/dice3d.js previewOpts): owner
    // approved +45 B (42,324 -> 42,369), 2026-11-20.
    // Another user's user-scope setting change is ignored (settings.js register): owner approved
    // +49 B (42,369 -> 42,418), 2026-11-21.
    // An imported module set's own face images keep its tile size (faces.js lookFacesFor): owner
    // approved +84 B (42,418 -> 42,502), 2026-11-21.
    // The roll filters shared with the hand chunk (no throw for a roll the filters hide): owner
    // approved +9 B (42,502 -> 42,511), 2026-11-22.
    // Roll filters applied to chat messages (message-gate.js viewsOf) and the hidden physics
    // roll's tooltip (gate-hand.js markFor): owner approved +211 B (42,511 -> 42,722), 2026-11-22.
    // The showOthersPets setting (settings.js, pet-for.js): owner approved +255 B (42,722 -> 42,977),
    // 2026-11-22.
    // The theme API for other modules: module themes in findTheme, default providers and the
    // speaking token's actor in resolve-looks.js (the API object is the lazy theme-api chunk): owner
    // approved +1,015 B (42,977 -> 43,992), 2026-11-22.
    // PR #3 (lost dice context hidden and asked back, renderer.js) and PR #4 (coins tip off their
    // rim in the physics worker's sim.js; default sounds by body style): owner approved +1,400 B
    // (43,992 -> 45,392), 2026-11-22.
    // The tray picker's check at ready (main.js TRAY_MODULE_IDS; the picker is the lazy tray-pick
    // chunk): owner approved +188 B (45,392 -> 45,580), 2026-11-22.
    // Warming the other players' dice looks (render/user-looks.js; their first roll on another
    // screen froze the canvas compiling shaders): owner approved +762 B (45,580 -> 46,342), 2026-11-22.
    // Warming the actors' and module providers' looks (the hook-up only: render/actor-looks.js rides
    // the lazy theme API chunk) and themed ghost dice (the themedGhostDice setting, compat/ghost-look.js,
    // DiceBox's ghostLook): owner approved +755 B (46,342 -> 47,097), 2026-11-23.
    // Roll by hand moved into the Roll filters window ("All rolls" and a choice per kind): whether a
    // user's dice go to Dicer now reads those choices too (hand/shell.js diceOnDicer), and a change
    // of the filters re-syncs the dice configuration (settings.js): owner approved +120 B
    // (47,097 -> 47,217), 2026-11-23.
    // Roll All / Roll NPCs as one throw: the gate hands a marked message's throw to the lazy
    // initiative-batch chunk, which main.js loads when a combat tracker renders with a combat:
    // owner approved +178 B, 2026-11-24.
    // PR #8 (api.registerFont: the font id check takes add-on font ids), PR #9 (numbers.offsetY: the
    // look field and the uNum uniform's third component) and PR #10 (body.streaks in the look):
    // owner approved +165 B (47,384 -> 47,549), 2026-11-24.
    // PR #11 (numbers.outline: the look fields and the check that a look needs the extras chunk, +247 B)
    // and PR #7 (extension points for add-on theme modules: stubs, materials, user defaults and the
    // damage map on the api, +492 B): owner approved +739 B (47,549 -> 48,288), 2026-11-24.
    // Version 1.4.10: the version string is one character longer than 1.4.9: owner approved +1 B
    // (48,288 -> 48,289), 2026-11-24.
    // PR #12 (roughness above 0.7 reads matte: the clear coat fades out on every body but metal and
    // resin): owner approved +295 B (48,289 -> 48,584), 2026-11-24.
    // PR #13 (number contrast that sees the material: the coat's veil, the second colour, both inside
    // colours, the font and numbers.minContrast): owner approved +1,594 B (48,584 -> 50,178), 2026-11-24.
    // Dice that follow Ember's moons: the look resolver asks the registry's moonRef (set by the lazy
    // installed-dice chunk) once per die: owner approved +48 B (50,178 -> 50,226), 2026-11-25.
    // PR #14 (a registered theme's pets.volume: kept on the theme, put on its dice by the fx resolver
    // and passed on to the pet layer by the dice box): owner approved +469 B (50,226 -> 50,695), 2026-11-26.
    // Four new pet kinds (raven, spider, skull, drone: their names in pet-for.js PET_KINDS; the
    // creatures, models and sounds are lazy): owner approved +33 B (50,695 -> 50,728), 2026-11-26.
    // PR #15 (pet accessories: the petAccessories setting and its hook call; the registry, the API
    // and the fitting are lazy): owner approved +232 B (50,728 -> 50,960), 2026-11-27.
    // Typed-in dice (the manualButton, manualDiceForm, manualGlow, manualText and manualStash
    // settings and main's two hooks; the die shapes and chat button are the lazy manual-entry
    // chunk): owner approved +793 B (50,960 -> 51,753), 2026-11-28.
    // PR #19 (a registered theme's landing rules: isLanding in rules.js and the resolver's check, +209 B)
    // and PR #20 (appearance.trail: its normalizer and the element list in appearance.js, +304 B). Main
    // sat 116 B under the limit: owner approved +397 B (51,753 -> 52,150), 2026-11-28.
    const growth = worldStartBytes() - 4_115_282;
    console.info(`dicer world-start growth since the living-insides base: ${growth} bytes`);
    // Typed-in dice lockable with Big Bad Module Manager (the manualEntry client setting and main's
    // ready-time sync; the switch itself is in the lazy manual-entry chunk): owner approved +66 B
    // (52,150 -> 52,216, on top of PR #19 and PR #20), 2026-11-28.
    expect(growth).toBeLessThanOrEqual(52_216);
  });
  it('ships no sourcemaps in dist/ (they are made only for scripts/bundle-report.mjs)', () => {
    const maps = readdirSync('dist', { recursive: true }).filter((f) => String(f).endsWith('.map'));
    expect(maps).toEqual([]);
    for (const p of distFiles().filter((f) => f.endsWith('.js'))) {
      expect(readFileSync(p, 'utf8')).not.toContain('sourceMappingURL');
    }
  });
  it('keeps the world-start download (dist/ minus lazy chunks, plus the font atlas and api.js) under 4 MiB (H-R9)', () => {
    const files = worldStartFiles();
    const total = worldStartBytes();
    // Gzip is for information only: Foundry serves these files as they are.
    const gzip = files.reduce((sum, p) => sum + gzipSync(readFileSync(p), { level: 9 }).length, 0);
    console.info(
      `dicer size guard: ${total} of ${BUDGET} bytes (world-start dist/ + ${WORLD_START_ASSETS.join(' + ')}); ` +
        `headroom ${BUDGET - total} bytes; gzip -9 total ${gzip} bytes (information only)`,
    );
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});
