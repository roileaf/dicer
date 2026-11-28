/**
 * Typed-in dice (lazy chunk; main.js loads it when Foundry's dice entry window shows a manual die,
 * or for the chat button): each manual die of the RollResolver drawn as a big faceted die with its
 * number field on the front face, in the colours of the player's own dice look, and the chat button
 * that switches a player's dice between typing them in (Foundry's `manual` method) and rolling them.
 */
import { HAND_DICE } from '../hand/shell.js';
import { readableNumbers, visibleBodyColor } from '../look/contrast.js';

export const MANUAL_KEYS = [...HAND_DICE, 'default'];

/** `n` points on a circle of radius `r` around the centre, the first at `turn` degrees. */
const ring = (n, r, turn = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((turn + (360 / n) * i) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
  });

/** The d12: a front pentagon, the five faces around it out to a decagon. */
function d12() {
  const p = ring(5, 27);
  const o = ring(10, 47);
  const faces = p.map((v, i) => [i === 0 || i === 4 ? 1 : 2, [v, o[2 * i], o[2 * i + 1], o[(2 * i + 2) % 10], p[(i + 1) % 5]]]);
  return { faces: [...faces, [0, p]], n: [0, 2, 26] };
}

/** The d20: a front triangle, its three neighbours, and six faces out to a hexagon. */
function d20() {
  const [t0, t1, t2] = ring(3, 33);
  const [h0, h1, h2, h3, h4, h5] = ring(6, 47);
  return {
    faces: [
      [2, [t0, h0, h1]], [2, [t1, h1, h2]], [2, [t1, h2, h3]], [2, [t2, h3, h4]], [2, [t2, h4, h5]], [2, [t0, h5, h0]],
      [1, [t0, t1, h1]], [1, [t1, t2, h3]], [1, [t2, t0, h5]],
      [0, [t0, t1, t2]],
    ],
    n: [0, 3, 24],
  };
}

const split = (s) => s.split(' ');

/**
 * Each denomination's faces (shade 0: the front face, where the number goes; 1 and 2: the sides,
 * darker) in a 100 x 100 box, and where its number sits: [dx, dy, font size] in pixels.
 */
const SHAPES = {
  d4: { faces: [[2, split('50,6 64,90 95,90')], [0, split('50,6 5,90 64,90')]], n: [-10, 13, 24] },
  d6: {
    faces: [[1, split('8,26 28,8 92,8 72,26')], [2, split('72,26 92,8 92,72 72,90')], [0, split('8,26 72,26 72,90 8,90')]],
    n: [-10, 8, 28],
  },
  d8: {
    faces: [
      [2, split('8,52 16,60 84,60 92,52 50,96')],
      [1, split('50,4 8,52 16,60')],
      [1, split('50,4 92,52 84,60')],
      [0, split('50,4 84,60 16,60')],
    ],
    n: [0, -8, 26],
  },
  d10: {
    faces: [
      [2, split('6,46 24,50 50,64 50,96')],
      [2, split('94,46 76,50 50,64 50,96')],
      [1, split('50,4 24,50 6,46')],
      [1, split('50,4 94,46 76,50')],
      [0, split('50,4 76,50 50,64 24,50')],
    ],
    n: [0, -8, 22],
  },
  d12: d12(),
  d20: d20(),
  coin: { circles: [[1, 45], [0, 34]], n: [0, 0, 28] },
};
SHAPES.d100 = SHAPES.d10;
SHAPES.d2 = SHAPES.c = SHAPES.coin;
SHAPES.f = SHAPES.d6;
SHAPES.d3 = SHAPES.d4;

const NS = 'http://www.w3.org/2000/svg';

/** The SVG die of `denomination` (a coin for one Dicer has no shape for). */
export function shapeOf(denomination, doc = document) {
  const s = SHAPES[denomination] ?? SHAPES.coin;
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'dicer-manual-shape');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const el = doc.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    svg.append(el);
  };
  for (const [shade, points] of s.faces ?? []) add('polygon', { class: `face f${shade}`, points: points.join(' ') });
  for (const [shade, r] of s.circles ?? []) add('circle', { class: `face f${shade}`, cx: 50, cy: 50, r });
  return svg;
}

/** Where `denomination`'s number sits on its front face, as CSS custom properties. */
export function numberOf(denomination) {
  const [dx, dy, size] = (SHAPES[denomination] ?? SHAPES.coin).n;
  return { '--dicer-manual-dx': `${dx}px`, '--dicer-manual-dy': `${dy}px`, '--dicer-manual-size': `${size}px` };
}

export const MANUAL_CSS = `
.application.dicer-manual-form .standard-form {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
}
.application.dicer-manual-form .standard-form > :not(fieldset) {
  flex: 1 0 100%;
}
.application.dicer-manual-form .standard-form > fieldset {
  flex: 0 1 auto;
  margin: 0;
}
.application.dicer-manual-form .input-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.application.dicer-manual-form .form-fields:has(> .dicer-manual-die) {
  justify-content: center;
}
.application.dicer-manual-form label.dicer-manual-die {
  position: relative;
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  outline: none;
}
.application.dicer-manual-form label.dicer-manual-die > :not(input, svg.dicer-manual-shape, .fa-arrow-rotate-right, .fa-burst) {
  display: none;
}
.application.dicer-manual-form .dicer-manual-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  transition: filter 0.15s;
}
.application.dicer-manual-form .dicer-manual-shape .face {
  stroke: var(--dicer-manual-glow);
  stroke-width: 2.2;
  stroke-linejoin: round;
  transition: fill 0.15s;
}
.application.dicer-manual-form .dicer-manual-shape .f0 {
  fill: var(--dicer-manual-body);
}
.application.dicer-manual-form .dicer-manual-shape .f1 {
  fill: color-mix(in srgb, var(--dicer-manual-body) 55%, var(--dicer-manual-body2));
}
.application.dicer-manual-form .dicer-manual-shape .f2 {
  fill: color-mix(in srgb, var(--dicer-manual-body2) 80%, #000);
}
.application.dicer-manual-form label.dicer-manual-die:focus-within .dicer-manual-shape,
.application.dicer-manual-form label.dicer-manual-die.dicer-manual-filled .dicer-manual-shape {
  filter: drop-shadow(0 0 5px var(--dicer-manual-glow)) drop-shadow(0 0 10px var(--dicer-manual-glow));
}
.application.dicer-manual-form label.dicer-manual-die.dicer-manual-filled .dicer-manual-shape .f0 {
  fill: color-mix(in srgb, var(--dicer-manual-body) 75%, var(--dicer-manual-glow));
}
.application.dicer-manual-form label.dicer-manual-die > input {
  position: relative;
  z-index: 1;
  width: 64px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  outline: none;
  transform: translate(var(--dicer-manual-dx, 0), var(--dicer-manual-dy, 0));
  color: var(--dicer-manual-text);
  font-size: var(--dicer-manual-size, 28px);
  font-weight: bold;
  text-align: center;
  text-shadow: 0 0 3px var(--dicer-manual-body), 0 0 6px var(--dicer-manual-body);
  -moz-appearance: textfield;
}
.application.dicer-manual-form label.dicer-manual-die > input::-webkit-inner-spin-button,
.application.dicer-manual-form label.dicer-manual-die > input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.application.dicer-manual-form label.dicer-manual-die > input::placeholder {
  color: var(--dicer-manual-text);
  opacity: 0.5;
  font-size: calc(var(--dicer-manual-size, 28px) * 0.62);
}
.application.dicer-manual-form label.dicer-manual-die > input:disabled {
  opacity: 0.75;
}
.application.dicer-manual-form label.dicer-manual-die > i {
  position: absolute;
  right: 4px;
  top: 4px;
  z-index: 1;
  color: var(--dicer-manual-glow);
}
#chat-controls .dicer-manual-group {
  display: flex;
  gap: 4px;
  margin-inline: 4px auto;
}
.dicer-chat-tray-bar > .dicer-manual-toggle {
  flex: 0 0 24px;
  padding: 0;
  opacity: 0.8;
}
.dicer-chat-tray-bar > .dicer-manual-toggle:hover,
.dicer-chat-tray-bar > .dicer-manual-toggle[aria-pressed="true"] {
  opacity: 1;
}
.dicer-chat-tray-bar > .dicer-manual-toggle[aria-pressed="true"] {
  border-color: var(--dicer-ct-accent);
  color: var(--dicer-ct-accent);
}
.dicer-manual-toggle.dicer-manual-locked {
  opacity: 0.55;
  cursor: not-allowed;
}
`;

const injectStyle = (doc) => {
  if (doc.getElementById('dicer-manual-style')) return;
  const style = doc.createElement('style');
  style.id = 'dicer-manual-style';
  style.textContent = MANUAL_CSS;
  doc.head.append(style);
};

/** The window's colours with no dice look to read (the look resolver not started yet). */
export const PLAIN_COLORS = Object.freeze({ body: '#2c2833', body2: '#141218', text: '#ffffff', glow: '#ff9f1c' });

const FACES = { c: 2, f: 3 };

/**
 * A die's colours from its dice look (`appearance`: what the player's own 3D die of that kind is
 * drawn with): the body and its second colour, the numbers as the 3D dice draw them (made readable
 * on the body unless the look keeps its own colour), and the glow (the number colour when the look
 * has none). Anything unreadable falls back to PLAIN_COLORS.
 */
export function colorsOf(appearance) {
  const out = { ...PLAIN_COLORS };
  try {
    if (!appearance?.body) return out;
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
    out.body = hex(visibleBodyColor(appearance)) ?? hex(appearance.body.color) ?? out.body;
    out.body2 = hex(appearance.body.color2) ?? out.body;
    out.text = hex(readableNumbers(appearance).fill) ?? hex(appearance.numbers?.color) ?? out.text;
    out.glow = (appearance.glow?.intensity > 0 && hex(appearance.glow.color)) || out.text;
  } catch {
    /* an unreadable look: whatever was read so far */
  }
  return out;
}

/** The CSS custom properties of `colors`. */
const colorVars = (c) => ({
  '--dicer-manual-body': c.body,
  '--dicer-manual-body2': c.body2,
  '--dicer-manual-text': c.text,
  '--dicer-manual-glow': c.glow,
});

const setStyle = (el, vars) => {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
};

const setting = (key, fallback) => {
  try {
    return game.settings.get('dicer', key) ?? fallback;
  } catch {
    return fallback;
  }
};

const fill = (label) => {
  const input = label.querySelector('input');
  label.classList.toggle('dicer-manual-filled', !!input && input.value !== '');
};

/** Draws one manual die's field inside its die shape (once), in `lookOf`'s colours for its kind. */
function decorateLabel(label, lookOf) {
  if (label.classList.contains('dicer-manual-die')) return;
  label.classList.add('dicer-manual-die');
  const den = label.dataset.denomination;
  label.prepend(shapeOf(den, label.ownerDocument));
  setStyle(label, numberOf(den));
  let look = null;
  try {
    look = lookOf?.(FACES[den] ?? (parseInt(String(den).slice(1), 10) || 6));
  } catch {
    /* no look: the plain colours */
  }
  setStyle(label, colorVars(colorsOf(look)));
  fill(label);
  label.addEventListener('input', () => fill(label));
  label.addEventListener('change', () => fill(label));
}

const observers = new WeakMap();

/**
 * Puts the die shapes on every manual die of the resolver window `app` (its element `el`), and on
 * the ones Foundry adds later (rerolls, explosions: resolveResult appends them without a render).
 * `lookOf(faces)`: this user's own dice look for a die of that many faces (main.js's), or null.
 */
export function decorate(app, el = app?.element, lookOf = null) {
  try {
    if (!el?.querySelectorAll) return;
    const doc = el.ownerDocument ?? document;
    injectStyle(doc);
    el.classList.add('dicer-manual-form');
    setStyle(el, colorVars(colorsOf(null)));
    const all = () =>
      el.querySelectorAll('label.die-input[data-method="manual"]').forEach((l) => decorateLabel(l, lookOf));
    all();
    if (!observers.has(el) && globalThis.MutationObserver) {
      const mo = new MutationObserver(all);
      mo.observe(el, { childList: true, subtree: true });
      observers.set(el, mo);
    }
    app?.setPosition?.({ height: 'auto' });
  } catch (err) {
    console.warn('dicer: cannot draw the dice entry window', err);
  }
}

const interactiveOther = (m) =>
  !!m && m !== 'manual' && m !== 'dicer' && !!CONFIG.Dice.fulfillment.methods[m]?.interactive;

/** Every die of this browser's dice configuration is typed in (the button is pressed). */
export const manualOn = (core) =>
  MANUAL_KEYS.some((k) => core?.[k] === 'manual') &&
  MANUAL_KEYS.every((k) => core?.[k] === 'manual' || interactiveOther(core?.[k]));

/**
 * The dice configuration with every die typed in, and the stash that brings the old one back. A die
 * held by another interactive method (Pixels) keeps it; a die Dicer mapped itself (`mapped`) is
 * stashed as empty, so the hand sync maps it again later rather than taking it for the user's pick.
 */
export function manualConfig(core, mapped = []) {
  const out = { ...core };
  const stash = {};
  for (const k of MANUAL_KEYS) {
    const was = core?.[k];
    if (interactiveOther(was) || was === 'manual') continue;
    stash[k] = was === 'dicer' && mapped.includes(k) ? '' : (was ?? '');
    out[k] = 'manual';
  }
  return { out, stash };
}

/** The dice configuration with the typed-in dice rolled again: the stashed methods back, else none. */
export function rolledConfig(core, stash = {}) {
  const out = { ...core };
  for (const k of MANUAL_KEYS) {
    if (out[k] !== 'manual') continue;
    if (stash[k]) out[k] = stash[k];
    else delete out[k];
  }
  return out;
}

let sync = null;
let queue = Promise.resolve();

/** This browser types its dice in (the manualEntry client setting: the button, the settings window, a BBMM lock). */
const wanted = () => setting('manualEntry', false) === true;

/** manualEntry was never stored in this browser (a 1.5.x button switch predates it). */
function neverSet() {
  try {
    return game.settings.storage.get('client').getItem('dicer.manualEntry') === null;
  } catch {
    return false;
  }
}

/**
 * The GM hard-locked manualEntry with Big Bad Module Manager (its Setting Locks): BBMM puts the
 * locked value back whenever a player changes it, so the button does not offer the switch. A GM is
 * never locked; a soft lock is only a recommendation.
 */
export function lockedByGm() {
  try {
    if (game.user?.isGM || !game.modules?.get('bbmm')?.active) return false;
    if (game.settings.get('bbmm', 'enableUserSettingSync') === false) return false;
    const entry = game.settings.get('bbmm', 'userSettingSync')?.['dicer.manualEntry'];
    return !!entry && entry.soft !== true;
  } catch {
    return false;
  }
}

/**
 * Brings this browser's dice configuration in line with manualEntry: on, every die typed in (the
 * methods they had stashed); off, the stashed methods back. Off never undoes dice that something
 * else set to manual (Foundry's own Configure Dice): only a switch this made has a stash. A 1.5.x
 * button switch (typed in, stashed, manualEntry never stored) becomes manualEntry on. Then the
 * hand sync (main.js's). Calls run one after another.
 */
async function applyManual() {
  try {
    const core = game.settings.get('core', 'diceConfiguration') ?? {};
    const stash = game.settings.get('dicer', 'manualStash') ?? {};
    const stashed = Object.keys(stash).length > 0;
    const want = wanted();
    if (!want && stashed && manualOn(core) && neverSet()) {
      await game.settings.set('dicer', 'manualEntry', true);
      return;
    }
    if (want && !manualOn(core)) {
      const fresh = manualConfig(core, game.settings.get('dicer', 'handRollMapped') ?? []);
      await game.settings.set('dicer', 'manualStash', { ...stash, ...fresh.stash });
      await game.settings.set('core', 'diceConfiguration', fresh.out);
    } else if (!want && stashed) {
      await game.settings.set('core', 'diceConfiguration', rolledConfig(core, stash));
      await game.settings.set('dicer', 'manualStash', {});
    } else return;
    sync?.();
  } catch (err) {
    console.warn('dicer: cannot switch typed-in dice', err);
  } finally {
    paint();
  }
}

/** Applies manualEntry (main.js: at ready and on its change). `syncHand`: main.js's hand sync. */
export function syncManual(syncHand) {
  if (syncHand) sync = syncHand;
  return (queue = queue.then(applyManual));
}

/** The button: flips manualEntry (its change switches the dice), unless the GM locked it. */
export async function toggleManual() {
  try {
    if (lockedByGm()) {
      ui.notifications?.warn(game.i18n.localize('DICER.Manual.Locked'));
      return;
    }
    const on = !wanted();
    await game.settings.set('dicer', 'manualEntry', on);
    await queue;
    ui.notifications?.info(game.i18n.localize(`DICER.Manual.${on ? 'On' : 'Off'}`));
  } catch (err) {
    console.warn('dicer: cannot switch typed-in dice', err);
  }
}

let button = null;
let group = null;
let hooked = false;

/** The button's pressed state, lock and tooltip, from manualEntry and a BBMM lock. */
function paint() {
  const b = button;
  if (!b) return;
  const on = wanted();
  const locked = lockedByGm();
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('dicer-manual-locked', locked);
  const label = game.i18n.localize(`DICER.Manual.${on ? 'ButtonOn' : 'ButtonOff'}`);
  b.setAttribute('aria-label', locked ? `${label} (${game.i18n.localize('DICER.Manual.Locked')})` : label);
}

/** The button is shown: the GM's manualButton, and no hand rolls required (they take every die). */
const shown = () => setting('manualButton', false) === true && setting('handRollsRequired', false) !== true;

const controlsOf = (els) =>
  els?.['#chat-controls'] ??
  (els instanceof Element ? els.querySelector('#chat-controls') : null) ??
  document.getElementById('chat-controls');

/** Dresses the button for where it sits: a chat dice bar button, or one of Foundry's controls. */
function dress(inBar) {
  if (button.dataset.place === (inBar ? 'bar' : 'controls')) return;
  button.dataset.place = inBar ? 'bar' : 'controls';
  button.className = inBar ? 'dicer-manual-toggle' : 'ui-control icon toggle fa-solid fa-keyboard dicer-manual-toggle';
  button.innerHTML = inBar ? '<i class="fa-solid fa-keyboard" inert></i>' : '';
  button.dataset.tooltipDirection = inBar ? 'UP' : '';
}

/**
 * Puts the typed-in dice button where it takes no room of its own (main.js: renderChatInput,
 * renderChatLog and the manualButton setting's change; the chat dice bar's dicerChatTray hook):
 * in the chat dice bar, before its eraser, while the bar shows; else right after the chat's
 * message modes, in a group that keeps to them (Foundry spreads the controls apart). Never inside
 * Foundry's .control-buttons, which it finds by that class to hide and show. Removed when not
 * shown. `syncHand`: main.js's dice configuration sync, run after each switch.
 */
export function dockToggle(els, syncHand) {
  try {
    if (syncHand) sync = syncHand;
    if (!hooked) {
      hooked = true;
      const repaint = new Set(['core.diceConfiguration', 'bbmm.userSettingSync', 'bbmm.enableUserSettingSync']);
      for (const hook of ['updateSetting', 'createSetting'])
        Hooks.on(hook, (doc) => {
          if (repaint.has(doc?.key)) paint();
        });
      Hooks.on('dicerChatTray', () => {
        dockToggle();
      });
    }
    if (!shown()) {
      button?.remove();
      group?.remove();
      return null;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.tooltip = '';
      button.addEventListener('click', () => toggleManual());
      group = document.createElement('div');
      group.className = 'dicer-manual-group';
      injectStyle(document);
    }
    const bar = document.querySelector('.dicer-chat-tray .dicer-chat-tray-bar');
    if (bar?.isConnected) {
      dress(true);
      const clear = bar.querySelector(':scope > [data-act="clear"]');
      if (button.parentElement !== bar || (clear && button.nextElementSibling !== clear)) bar.insertBefore(button, clear);
      group.remove();
    } else {
      const controls = controlsOf(els);
      if (!controls) return null;
      dress(false);
      if (button.parentElement !== group) group.append(button);
      const modes = controls.querySelector(':scope > #message-modes');
      if (modes) {
        if (modes.nextElementSibling !== group) modes.after(group);
      } else if (group.parentElement !== controls) controls.prepend(group);
    }
    paint();
    return button;
  } catch (err) {
    console.warn('dicer: cannot show the typed-in dice button', err);
    return null;
  }
}
