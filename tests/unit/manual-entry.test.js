// @vitest-environment jsdom
/**
 * Typed-in dice (src/ui/manual-entry.js): the die shapes in Foundry's dice entry window, the
 * dice configuration the chat button writes and restores, and the button itself.
 */
import {
  MANUAL_KEYS,
  shapeOf,
  numberOf,
  decorate,
  manualOn,
  manualConfig,
  rolledConfig,
  toggleManual,
  syncManual,
  lockedByGm,
  dockToggle,
  colorsOf,
  PLAIN_COLORS,
} from '../../src/ui/manual-entry.js';
import { normalizeAppearance } from '../../src/look/appearance.js';

const RED_INPUT = {
  body: { type: 'opaque', color: '#b3202a', color2: '#5a0d14', roughness: 0.25 },
  numbers: { fill: 'paint', color: '#f5f5f5', depth: 0.5 },
};
const RED = normalizeAppearance(RED_INPUT);

let store;
let infos;
beforeEach(() => {
  infos = [];
  store = {
    'core.diceConfiguration': {},
    'dicer.manualStash': {},
    'dicer.handRollMapped': [],
    'dicer.manualButton': true,
    'dicer.handRollsRequired': false,
  };
  globalThis.CONFIG = {
    Dice: {
      fulfillment: {
        methods: {
          mersenne: { label: 'Random' },
          manual: { label: 'Manual', interactive: true },
          dicer: { label: 'Dicer', interactive: true },
          pixels: { label: 'Pixels', interactive: true },
        },
      },
    },
  };
  globalThis.game = {
    settings: {
      get: (ns, k) => structuredClone(store[`${ns}.${k}`]),
      set: async (ns, k, v) => (store[`${ns}.${k}`] = structuredClone(v)),
    },
    i18n: { localize: (k) => k },
  };
  globalThis.ui = { notifications: { info: (m) => infos.push(m) } };
  globalThis.Hooks = { on: () => {} };
});
afterEach(() => {
  delete globalThis.CONFIG;
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.Hooks;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

const allManual = () => Object.fromEntries(MANUAL_KEYS.map((k) => [k, 'manual']));

describe('shapeOf', () => {
  const faces = (d) => shapeOf(d).querySelectorAll('.face').length;
  const front = (d) => shapeOf(d).querySelector('polygon.f0')?.getAttribute('points').split(' ').length;
  it('draws each die as its faces, the front one (last, on top) shaped for the number', () => {
    expect([faces('d4'), front('d4')]).toEqual([2, 3]);
    expect([faces('d6'), front('d6')]).toEqual([3, 4]);
    expect([faces('d8'), front('d8')]).toEqual([4, 3]);
    expect([faces('d10'), front('d10')]).toEqual([5, 4]);
    expect([faces('d12'), front('d12')]).toEqual([6, 5]);
    expect([faces('d20'), front('d20')]).toEqual([10, 3]);
    expect(shapeOf('d20').lastElementChild.classList.contains('f0')).toBe(true);
    expect(shapeOf('d100').innerHTML).toBe(shapeOf('d10').innerHTML);
  });
  it('draws a coin for the coin and for a die it has no shape for', () => {
    expect(shapeOf('c').querySelectorAll('circle.face')).toHaveLength(2);
    expect(shapeOf('d7').querySelectorAll('circle.face')).toHaveLength(2);
  });
  it('places each number on its front face', () => {
    expect(numberOf('d6')).toEqual({ '--dicer-manual-dx': '-10px', '--dicer-manual-dy': '8px', '--dicer-manual-size': '28px' });
    expect(numberOf('d7')['--dicer-manual-size']).toBe('28px');
  });
});

describe('decorate', () => {
  const form = () => {
    document.body.innerHTML = `<form class="roll-resolver"><fieldset class="input-grid" data-term-id="a">
      <label class="icon die-input" data-denomination="d20" data-method="manual"><input type="number" name="a" value=""><i class="fas fa-dice-d20"></i></label>
      <label class="icon die-input" data-denomination="d6" data-method="pixels"><input type="number" name="b" readonly></label>
    </fieldset></form>`;
    return document.querySelector('form');
  };

  it("draws the manual dice only, each in the player's look for its kind, and injects the style once", () => {
    const el = form();
    const app = { element: el, setPosition: vi.fn() };
    const lookOf = vi.fn(() => RED);
    decorate(app, el, lookOf);
    decorate(app, el, lookOf);
    const [manual, pixels] = el.querySelectorAll('label');
    expect(manual.classList.contains('dicer-manual-die')).toBe(true);
    expect(manual.querySelectorAll('svg.dicer-manual-shape')).toHaveLength(1);
    expect(pixels.querySelector('svg')).toBeNull();
    expect(lookOf).toHaveBeenCalledWith(20);
    expect(lookOf).toHaveBeenCalledTimes(1);
    expect(manual.style.getPropertyValue('--dicer-manual-body')).toBe('#b3202a');
    expect(manual.style.getPropertyValue('--dicer-manual-body2')).toBe('#5a0d14');
    expect(el.classList.contains('dicer-manual-form')).toBe(true);
    expect(document.querySelectorAll('#dicer-manual-style')).toHaveLength(1);
    expect(app.setPosition).toHaveBeenCalledWith({ height: 'auto' });
  });

  it('marks a die filled once a number is typed in', () => {
    const el = form();
    decorate({ element: el }, el);
    const label = el.querySelector('label');
    label.querySelector('input').value = '17';
    label.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
    expect(label.classList.contains('dicer-manual-filled')).toBe(true);
  });

  it('draws a die Foundry adds later (a reroll) without a render', async () => {
    const el = form();
    decorate({ element: el }, el);
    const extra = document.createElement('label');
    extra.className = 'icon die-input new-addition';
    extra.dataset.denomination = 'd8';
    extra.dataset.method = 'manual';
    extra.innerHTML = '<input type="number">';
    el.querySelector('fieldset').append(extra);
    await new Promise((r) => setTimeout(r));
    expect(extra.querySelector('svg.dicer-manual-shape')).toBeTruthy();
  });

  it('falls back to the plain colours with no look, or a look that throws', () => {
    const el = form();
    decorate({ element: el }, el, () => {
      throw new Error('no resolver');
    });
    const label = el.querySelector('label');
    expect(label.style.getPropertyValue('--dicer-manual-body')).toBe(PLAIN_COLORS.body);
    expect(label.style.getPropertyValue('--dicer-manual-glow')).toBe(PLAIN_COLORS.glow);
  });
});

describe('colorsOf', () => {
  it("takes the body, second colour and number colour of the look", () => {
    const c = colorsOf(RED);
    expect(c).toMatchObject({ body: '#b3202a', body2: '#5a0d14', text: '#f5f5f5' });
    expect(c.glow).toBe(c.text); // no glow on the look: the number colour
  });
  it('uses the look glow colour when it glows', () => {
    const a = normalizeAppearance({ ...RED_INPUT, glow: { color: '#33ccff', intensity: 1 } });
    expect(colorsOf(a).glow).toBe('#33ccff');
  });
  it('makes unreadable numbers readable, as the 3D dice draw them', () => {
    const a = normalizeAppearance({ body: { type: 'opaque', color: '#101010', color2: '#000000' }, numbers: { fill: 'paint', color: '#151515' } });
    expect(colorsOf(a).text).not.toBe('#151515');
  });
  it('gives the plain colours for no look', () => {
    expect(colorsOf(null)).toEqual(PLAIN_COLORS);
  });
});

describe('the dice configuration', () => {
  it('types in every die, keeping Pixels and stashing what each die had', () => {
    const { out, stash } = manualConfig({ d20: 'pixels', d6: 'mersenne', d8: 'dicer', d10: 'dicer' }, ['d8']);
    expect(out.d20).toBe('pixels');
    for (const k of MANUAL_KEYS.filter((k) => k !== 'd20')) expect(out[k]).toBe('manual');
    expect(stash.d20).toBeUndefined();
    expect(stash.d6).toBe('mersenne');
    expect(stash.d8).toBe(''); // Dicer's own mapping: the hand sync maps it again
    expect(stash.d10).toBe('dicer'); // the user's own pick comes back
    expect(stash.default).toBe('');
    expect(manualOn(out)).toBe(true);
  });

  it('rolls again: the stashed methods come back, the rest go', () => {
    const out = rolledConfig({ ...allManual(), d20: 'pixels' }, { d6: 'mersenne', d10: 'dicer', d8: '' });
    expect(out).toEqual({ d20: 'pixels', d6: 'mersenne', d10: 'dicer' });
    expect(manualOn(out)).toBe(false);
  });

  it('is on only when every die is typed in (or held by physical dice)', () => {
    expect(manualOn({})).toBe(false);
    expect(manualOn({ d20: 'manual' })).toBe(false);
    expect(manualOn(allManual())).toBe(true);
    expect(manualOn(Object.fromEntries(MANUAL_KEYS.map((k) => [k, 'pixels'])))).toBe(false);
  });

});

describe('manualEntry', () => {
  let stored;
  let sync;
  beforeEach(() => {
    stored = new Map();
    sync = vi.fn();
    const set = game.settings.set;
    // Foundry runs the setting's onChange (main.js: syncManual) and stores a client setting in the browser
    game.settings.set = async (ns, k, v) => {
      await set(ns, k, v);
      if (`${ns}.${k}` === 'dicer.manualEntry') {
        stored.set('dicer.manualEntry', JSON.stringify(v));
        syncManual(sync); // Foundry does not wait for onChange
      }
      return v;
    };
    game.settings.storage = { get: () => ({ getItem: (k) => stored.get(k) ?? null }) };
    game.modules = new Map();
    game.user = { isGM: false };
    store['dicer.manualEntry'] = false;
  });

  it('the button flips it: every die typed in, then the stashed methods back, the hand sync after each', async () => {
    store['core.diceConfiguration'] = { d6: 'mersenne' };
    await toggleManual();
    expect(store['dicer.manualEntry']).toBe(true);
    expect(manualOn(store['core.diceConfiguration'])).toBe(true);
    expect(store['dicer.manualStash'].d6).toBe('mersenne');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(infos.at(-1)).toBe('DICER.Manual.On');
    await toggleManual();
    expect(store['core.diceConfiguration']).toEqual({ d6: 'mersenne' });
    expect(store['dicer.manualStash']).toEqual({});
    expect(infos.at(-1)).toBe('DICER.Manual.Off');
  });

  it('a value set from elsewhere (a BBMM lock at login) switches the dice too', async () => {
    store['core.diceConfiguration'] = {};
    await game.settings.set('dicer', 'manualEntry', true);
    await syncManual(sync);
    expect(manualOn(store['core.diceConfiguration'])).toBe(true);
  });

  it('off never undoes dice set to manual in Foundry\'s own Configure Dice', async () => {
    store['core.diceConfiguration'] = allManual();
    stored.set('dicer.manualEntry', 'false');
    await syncManual(sync);
    expect(store['core.diceConfiguration']).toEqual(allManual());
    expect(sync).not.toHaveBeenCalled();
  });

  it('a 1.5.x button switch (typed in and stashed, never stored) becomes manualEntry on', async () => {
    store['core.diceConfiguration'] = allManual();
    store['dicer.manualStash'] = { d20: 'dicer' };
    await syncManual(sync);
    await syncManual(sync);
    expect(store['dicer.manualEntry']).toBe(true);
    expect(store['core.diceConfiguration']).toEqual(allManual());
    expect(store['dicer.manualStash']).toEqual({ d20: 'dicer' });
  });

  it('a BBMM hard lock: the button warns and changes nothing; a soft lock or a GM is never locked', async () => {
    game.modules.set('bbmm', { active: true });
    store['bbmm.enableUserSettingSync'] = true;
    store['bbmm.userSettingSync'] = { 'dicer.manualEntry': { namespace: 'dicer', key: 'manualEntry', value: true } };
    expect(lockedByGm()).toBe(true);
    const warn = vi.fn();
    ui.notifications.warn = warn;
    await toggleManual();
    expect(warn).toHaveBeenCalledWith('DICER.Manual.Locked');
    expect(store['dicer.manualEntry']).toBe(false);
    store['bbmm.userSettingSync']['dicer.manualEntry'].soft = true;
    expect(lockedByGm()).toBe(false);
    delete store['bbmm.userSettingSync']['dicer.manualEntry'].soft;
    game.user.isGM = true;
    expect(lockedByGm()).toBe(false);
    game.user.isGM = false;
    store['bbmm.enableUserSettingSync'] = false;
    expect(lockedByGm()).toBe(false);
  });

  it('the button shows the lock', () => {
    document.body.innerHTML = '<div id="chat-controls"><div id="message-modes"></div></div>';
    game.modules.set('bbmm', { active: true });
    store['bbmm.userSettingSync'] = { 'dicer.manualEntry': { value: true } };
    store['dicer.manualEntry'] = true;
    const b = dockToggle({ '#chat-controls': document.getElementById('chat-controls') });
    expect(b.classList.contains('dicer-manual-locked')).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('DICER.Manual.ButtonOn (DICER.Manual.Locked)');
  });
});

describe('dockToggle', () => {
  const controls = (gm = '') => {
    document.body.innerHTML = `<div id="chat-controls"><div id="message-modes"></div>${gm}</div>`;
    return document.getElementById('chat-controls');
  };
  const GM = '<div class="control-buttons"><button class="export"></button><button class="flush"></button></div>';

  it("a player's button: its own control group after the message modes, pressed when the dice are typed in", () => {
    const c = controls();
    store['dicer.manualEntry'] = true;
    const b = dockToggle({ '#chat-controls': c });
    const group = c.querySelector('#message-modes').nextElementSibling;
    expect(group.classList.contains('dicer-manual-group')).toBe(true);
    expect(group.classList.contains('control-buttons')).toBe(false); // Foundry finds its own buttons by that class
    expect(b.parentElement).toBe(group);
    expect(b.classList.contains('ui-control')).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('DICER.Manual.ButtonOn');
  });

  it("the GM's button stays by the message modes, never inside Foundry's own control buttons", () => {
    const c = controls(GM);
    const b = dockToggle({ '#chat-controls': c });
    const own = c.querySelector('.control-buttons');
    expect(own.contains(b)).toBe(false);
    expect(c.querySelector('#message-modes').nextElementSibling).toBe(b.parentElement);
    expect(b.parentElement.nextElementSibling).toBe(own);
    dockToggle({ '#chat-controls': c });
    expect(c.querySelectorAll('.dicer-manual-toggle')).toHaveLength(1);
  });

  it('sits in the chat dice bar before its eraser while the bar shows, and goes back when it is gone', () => {
    const c = controls(GM);
    const b = dockToggle({ '#chat-controls': c });
    expect(b.classList.contains('ui-control')).toBe(true);
    const tray = document.createElement('section');
    tray.className = 'dicer-chat-tray';
    tray.innerHTML = '<div class="dicer-chat-tray-bar"><span class="dicer-chat-tray-mod"></span><button data-act="clear"></button><button data-act="customize"></button><button data-act="roll"></button></div>';
    document.body.append(tray);
    dockToggle();
    const clear = tray.querySelector('[data-act="clear"]');
    expect(clear.previousElementSibling).toBe(b);
    expect(b.classList.contains('ui-control')).toBe(false);
    expect(b.querySelector('i.fa-keyboard')).toBeTruthy();
    expect(c.querySelector('.dicer-manual-group')).toBeNull();
    tray.remove();
    dockToggle({ '#chat-controls': c });
    expect(c.querySelector('#message-modes').nextElementSibling).toBe(b.parentElement);
    expect(b.classList.contains('ui-control')).toBe(true);
    expect(b.querySelector('i')).toBeNull();
  });

  it('removes the button when the GM turns it off or hand rolls are required', () => {
    const c = controls();
    dockToggle({ '#chat-controls': c });
    expect(c.querySelector('.dicer-manual-toggle')).toBeTruthy();
    store['dicer.handRollsRequired'] = true;
    expect(dockToggle({ '#chat-controls': c })).toBeNull();
    expect(c.querySelector('.dicer-manual-toggle')).toBeNull();
    store['dicer.handRollsRequired'] = false;
    store['dicer.manualButton'] = false;
    expect(dockToggle({ '#chat-controls': c })).toBeNull();
  });
});
