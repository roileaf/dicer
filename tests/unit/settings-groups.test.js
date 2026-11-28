// @vitest-environment jsdom
/**
 * Dicer's part of Foundry's settings window in sections, and the pet settings in the Your pet
 * window: every setting shown in Foundry's list has a section; every pet setting is in the window.
 */
import { registerSettings } from '../../src/settings.js';
import { GROUPS, groupSettings } from '../../src/ui/settings-groups.js';
import { PET_SETTINGS } from '../../src/ui/pet-window.js';

function capture() {
  const registered = {};
  globalThis.game = { settings: { register: (ns, key, cfg) => (registered[key] = { ns, ...cfg }) } };
  try {
    registerSettings();
  } finally {
    delete globalThis.game;
  }
  return registered;
}

test('every setting in Foundry’s list has a section; the pet settings are in the Your pet window instead', () => {
  const all = capture();
  const shown = Object.keys(all).filter((k) => all[k].config);
  const grouped = GROUPS.flatMap(([, keys]) => keys);
  expect(shown.filter((k) => !grouped.includes(k))).toEqual([]);
  expect(grouped.filter((k) => !all[k])).toEqual([]); // no stale names
  for (const k of PET_SETTINGS) expect(all[k], k).toMatchObject({ config: false, scope: 'user' });
  // the theme dropdowns are gone: the theme browser picks both
  expect(all.theme.config).toBe(false);
  expect(all.worldDefaultTheme.config).toBe(false);
});

/** A settings window body: one .form-group per key, plus a menu row and another module's setting. */
function windowOf(keys) {
  const root = document.createElement('section');
  root.innerHTML =
    '<div class="form-group"><button data-key="dicer.themeBrowser">menu</button></div>' +
    keys.map((k) => `<div class="form-group" data-k="${k}"><input name="dicer.${k}"></div>`).join('') +
    '<div class="form-group" data-k="core"><input name="core.x"></div>';
  return root;
}

describe('groupSettings', () => {
  beforeEach(() => {
    globalThis.game = { i18n: { localize: (k) => k } };
  });
  afterEach(() => delete globalThis.game);

  test('moves each row under its heading, in section order; menus and other modules stay put', () => {
    const root = windowOf(['chatTray', 'enabled', 'sounds', 'handRollsAllowed', 'somethingNew', 'quality']);
    groupSettings(root);
    const order = [...root.children].map((el) => (el.matches('h3') ? `# ${el.dataset.group}` : (el.dataset.k ?? 'menu')));
    expect(order).toEqual(['menu', '# General', 'enabled', '# Graphics', 'quality', '# Sound', 'sounds', '# Hand', 'handRollsAllowed', '# Chat', 'chatTray', '# Other', 'somethingNew', 'core']);
    expect(root.querySelector('h3').textContent).toBe('DICER.SettingsGroup.General');
  });

  test("keeps every section whole when the first row is General's (Foundry's own order)", () => {
    const root = windowOf(['enabled', 'physicsResults', 'quality', 'manualButton', 'manualEntry']);
    groupSettings(root);
    const order = [...root.children].map((el) => (el.matches('h3') ? `# ${el.dataset.group}` : (el.dataset.k ?? 'menu')));
    expect(order).toEqual(['menu', '# General', 'enabled', 'physicsResults', '# Graphics', 'quality', '# Manual', 'manualButton', 'manualEntry', 'core']);
  });

  test('runs once per render, skips empty sections, and never throws', () => {
    const root = windowOf(['enabled']);
    groupSettings(root);
    groupSettings(root);
    expect(root.querySelectorAll('h3')).toHaveLength(1);
    expect(() => groupSettings(null)).not.toThrow();
    expect(() => groupSettings(document.createElement('div'))).not.toThrow();
  });
});
