/**
 * Dicer's part of Foundry's settings window, in sections: each setting row moved under its
 * heading, in this order (lazy chunk; main.js loads it when the settings window renders). The
 * windows (themes, pet, roll filters, editors) stay as Foundry draws them, above. A setting not
 * listed keeps its place, after the sections, under "Other".
 */
export const GROUPS = [
  ['General', ['enabled', 'physicsResults', 'diceScale', 'diceAboveWindows', 'diceLighting', 'diceLight', 'trayMode', 'trayShow', 'petTray', 'timeBeforeHide', 'grabDice', 'showExtraDice', 'physicalDice', 'diceLookButton', 'maxDice', 'showGhostDice', 'themedGhostDice', 'immediatelyDisplayChatMessages', 'hideInitiative', 'lockPlayerLooks', 'rollStats', 'statsTool', 'migrateFromDsn']],
  ['Graphics', ['quality', 'qualityCap', 'pixelRatioCap', 'interiors', 'insideMotion', 'engraving', 'shadows', 'glow', 'presetFaces', 'presetModels']],
  ['Sound', ['sounds', 'soundVolume', 'effectSounds', 'effectsVolume', 'quietWhenUnfocused', 'soundSurface', 'soundSurfaceOverride', 'muteCoreDiceSound']],
  ['Effects', ['effects', 'showOthersEffects', 'slowMotion', 'screenShake', 'impactEffects', 'jb2aEffects', 'insideFlare', 'elementalTrails', 'elementalCritBursts', 'triggerMacros']],
  ['Damage', ['damagePresets', 'damageOverDiceSet', 'elementalDamageInsides']],
  ['Pets', ['petsAllowed']],
  ['Hand', ['handRollsAllowed', 'handRollsRequired', 'handRollTimeout', 'handReplay', 'handFollowUps', 'handLiveShare']],
  ['Areas', ['perPlayerAreas', 'areaScale', 'gmPrivateCorner']],
  ['Chat', ['chatTray', 'diceTray']],
  ['Manual', ['manualButton', 'manualEntry', 'manualDiceForm']],
];

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const heading = (doc, id) => {
  const h = doc.createElement('h3');
  h.className = 'dicer-settings-group';
  h.dataset.group = id;
  h.textContent = loc(`DICER.SettingsGroup.${id}`);
  return h;
};

/** The setting row (.form-group) of `dicer.<key>` inside `root`, or null (not shown to this user). */
const rowOf = (root, key) => root.querySelector(`[name="dicer.${key}"]`)?.closest('.form-group') ?? null;

/** Puts Dicer's settings in `root` (the settings window) under their headings. Never throws. */
export function groupSettings(root) {
  try {
    if (!root?.querySelector || root.querySelector('.dicer-settings-group')) return;
    const all = [...root.querySelectorAll('[name^="dicer."]')].map((el) => el.closest('.form-group')).filter(Boolean);
    const anchor = all[0];
    if (!anchor) return;
    const doc = root.ownerDocument ?? globalThis.document;
    const placed = new Set();
    for (const [id, keys] of GROUPS) {
      const rows = keys.map((k) => rowOf(root, k)).filter((r) => r && !placed.has(r));
      if (!rows.length) continue; // a player without the GM's settings: no empty heading
      anchor.before(heading(doc, id), ...rows);
      for (const r of rows) placed.add(r);
    }
    const rest = all.filter((r) => !placed.has(r));
    if (rest.length) rest[0].before(heading(doc, 'Other'));
  } catch (err) {
    console.warn('dicer: could not group the settings', err);
  }
}
