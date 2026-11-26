// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_KINDS } from '../../src/pet/pet-for.js';
import { registerPetSettings } from '../../src/v2/pets/pets.js';
import { petForm, registerPetWindow, UNPORTED, wirePetForm } from '../../src/v2/pets/window.js';
import { registerVoiceSettings } from '../../src/v2/sounds/voices.js';

function user(id, pet, { isGM = false, name = id, color = '#3366cc' } = {}) {
  const flags = { pet };
  return {
    id,
    name,
    isGM,
    color,
    flags,
    getFlag: (_scope, key) => flags[key],
    setFlag: vi.fn(async (_scope, key, value) => void (flags[key] = value)),
  };
}

function settingsStore(values = {}) {
  const registered = new Map();
  const store = { ...values };
  const settings = {
    settings: registered,
    register: (scope, key, cfg) => {
      registered.set(`${scope}.${key}`, cfg);
      if (!(key in store)) store[key] = cfg.default;
    },
    registerMenu: vi.fn(),
    get: (_scope, key) => store[key],
    set: vi.fn(async (_scope, key, value) => void (store[key] = value)),
  };
  registerPetSettings({ refresh() {}, onViewChanged() {} }, settings);
  registerVoiceSettings(settings);
  return { settings, store };
}

const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const settle = () => new Promise((r) => setTimeout(r));

beforeEach(() => {
  vi.stubGlobal('game', { i18n: { localize: (k) => k }, settings: settingsStore().settings });
});
afterEach(() => vi.unstubAllGlobals());

describe('v2 pet window: v1`s Your pet window on DsN', () => {
  it('shows a button per pet kind, the chosen one active, as v1 does', () => {
    const { settings } = settingsStore();
    const form = petForm(user('me', { kind: 'owl' }), { self: user('me'), users: [], settings });
    const buttons = [...form.querySelectorAll('.dicer-pet-kinds button[data-kind]')];
    expect(buttons.map((b) => b.dataset.kind)).toEqual([...PET_KINDS]);
    expect(form.querySelector('select[name=kind]')).toBeNull();
    expect(
      buttons.filter((b) => b.classList.contains('active')).map((b) => b.dataset.kind),
    ).toEqual(['owl']);
    expect(form.querySelector('[data-kind=owl]').getAttribute('aria-checked')).toBe('true');
    expect(form.querySelector('[data-kind=dragonling] span').textContent).toBe(
      'DICER.Appearance.Pet.Dragonling',
    );
    expect(form.querySelector('button[type=submit]')).toBeNull();
  });

  it('leaves out what v2 has no counterpart for: voice pitch, the die catch and the preview throw', () => {
    const { settings } = settingsStore();
    const form = petForm(user('me', { kind: 'owl' }), { self: user('me'), users: [], settings });
    expect(form.querySelectorAll(UNPORTED).length).toBe(0);
    expect(form.querySelector('[data-pet-natural]')).not.toBeNull();
    expect(form.querySelectorAll('[data-pet-color]').length).toBe(2);
  });

  it('holds the player`s pet settings that v2 registers, out of Foundry`s own settings list', () => {
    const { settings } = settingsStore();
    const form = petForm(user('me', { kind: 'owl' }), { self: user('me'), users: [], settings });
    const rows = [...form.querySelectorAll('[data-setting]')].map((r) => r.dataset.setting);
    expect(rows).toEqual([
      'showPets',
      'showOthersPets',
      'petScale',
      'petView',
      'petStay',
      'petClick',
      'petElemental',
      'petMoods',
      'petCheer',
      'petSounds',
    ]);
    for (const key of rows) expect(settings.settings.get(`dicer.${key}`).config, key).toBe(false);
    expect(settings.settings.get('dicer.petsAllowed').config).toBe(true);
    expect(settings.settings.get('dicer.effectSounds').config).toBe(true);
    expect(form.querySelector('[data-setting=petStay] select').value).toBe('60');
  });

  it('with no pet, shows only the kinds and the settings', () => {
    const { settings } = settingsStore();
    const form = petForm(user('me', { kind: 'none' }), { self: user('me'), users: [], settings });
    expect(form.querySelector('.dicer-pet-color')).toBeNull();
    expect(form.querySelector('[data-kind=none]').classList.contains('active')).toBe(true);
  });

  it('says when the GM turned pets off, or the player hid them', () => {
    const off = settingsStore({ petsAllowed: false, showPets: false });
    const form = petForm(user('me', { kind: 'owl' }), {
      self: user('me'),
      users: [],
      settings: off.settings,
    });
    expect([...form.querySelectorAll('.dicer-pet-off')].map((p) => p.textContent.trim())).toEqual([
      'DICER.PetWindow.Off',
      'DICER.Appearance.Pet.Hidden',
    ]);
  });

  it('saves each change at once: a kind, natural colours, and a colour that turns natural off', async () => {
    const { settings } = settingsStore();
    const me = user('me', { kind: 'owl', natural: true, spot: { x: 0.3, y: 0.4 } });
    const rerender = vi.fn();
    const form = petForm(me, { self: me, users: [], settings });
    document.body.replaceChildren(form);
    wirePetForm(form, { getTarget: () => me, setTarget: vi.fn(), rerender, settings });
    form.querySelector('[data-kind=owl]').click();
    await settle();
    expect(me.setFlag).not.toHaveBeenCalled();
    form.querySelector('[data-kind=cat] span').click();
    await settle();
    expect(me.setFlag).toHaveBeenLastCalledWith('dicer', 'pet', {
      kind: 'cat',
      natural: true,
      spot: { x: 0.3, y: 0.4 },
    });
    expect(rerender).toHaveBeenCalledTimes(1);
    const text = form.querySelector('input[type=text][data-pet-color]');
    text.value = '#AB';
    fire(text, 'input');
    fire(text, 'change');
    await settle();
    expect(me.setFlag).toHaveBeenCalledTimes(1);
    text.value = '#AABBCC';
    fire(text, 'input');
    expect(form.querySelector('input[type=color][data-pet-color]').value).toBe('#aabbcc');
    fire(text, 'change');
    await settle();
    expect(me.setFlag).toHaveBeenLastCalledWith('dicer', 'pet', {
      kind: 'cat',
      natural: false,
      color: '#aabbcc',
      spot: { x: 0.3, y: 0.4 },
    });
    expect(form.querySelector('[data-pet-natural]').checked).toBe(false);
    const natural = form.querySelector('[data-pet-natural]');
    natural.checked = true;
    fire(natural, 'change');
    await settle();
    expect(me.flags.pet.natural).toBe(true);
  });

  it('saves a pet setting when its control changes, with the setting`s own type', async () => {
    const { settings, store } = settingsStore();
    const me = user('me', { kind: 'owl' });
    const rerender = vi.fn();
    const form = petForm(me, { self: me, users: [], settings });
    document.body.replaceChildren(form);
    wirePetForm(form, { getTarget: () => me, setTarget: vi.fn(), rerender, settings });
    const stay = form.querySelector('[data-setting=petStay] select');
    stay.value = '0';
    fire(stay, 'change');
    const size = form.querySelector('[data-setting=petScale] input[type=range]');
    size.value = '1.5';
    fire(size, 'input');
    expect(size.nextElementSibling.textContent).toBe('1.5');
    fire(size, 'change');
    const moods = form.querySelector('[data-setting=petMoods] input');
    moods.checked = false;
    fire(moods, 'change');
    const shown = form.querySelector('[data-setting=showPets] input');
    shown.checked = false;
    fire(shown, 'change');
    await settle();
    expect([store.petStay, store.petScale, store.petMoods, store.showPets]).toEqual([
      0,
      1.5,
      false,
      false,
    ]);
    expect(rerender).toHaveBeenCalledTimes(1);
    expect(me.setFlag).not.toHaveBeenCalled();
  });

  it('lets a GM pick a player and set their pet, without that player`s own settings', async () => {
    const { settings } = settingsStore();
    const gm = user('gm', { kind: 'cat' }, { isGM: true, name: 'GM' });
    const ann = user('ann', { kind: 'frog' }, { name: 'Ann' });
    const users = [ann, gm];
    let target = gm;
    const mine = petForm(gm, { self: gm, users, settings });
    const select = mine.querySelector('[data-pet-player]');
    expect([...select.options].map((o) => o.value)).toEqual(['gm', 'ann']);
    document.body.replaceChildren(mine);
    const rerender = vi.fn();
    wirePetForm(mine, {
      getTarget: () => target,
      setTarget: (id) => void (target = users.find((u) => u.id === id)),
      rerender,
      settings,
    });
    select.value = 'ann';
    fire(select, 'change');
    await settle();
    expect(target).toBe(ann);
    expect(rerender).toHaveBeenCalledTimes(1);
    const theirs = petForm(ann, { self: gm, users, settings });
    expect(theirs.querySelectorAll('[data-setting]').length).toBe(0);
    expect(theirs.querySelector('[data-kind=frog]').classList.contains('active')).toBe(true);
    document.body.replaceChildren(theirs);
    wirePetForm(theirs, { getTarget: () => target, setTarget: vi.fn(), rerender, settings });
    theirs.querySelector('[data-kind=imp]').click();
    await settle();
    expect(ann.flags.pet.kind).toBe('imp');
    expect(gm.setFlag).not.toHaveBeenCalled();
    expect(
      petForm(ann, { self: ann, users, settings }).querySelector('[data-pet-player]'),
    ).toBeNull();
  });

  it('opens from Dicer`s settings as Your pet', () => {
    vi.stubGlobal('foundry', {
      applications: { api: { ApplicationV2: class {} }, instances: new Map() },
    });
    const settings = { registerMenu: vi.fn() };
    registerPetWindow(settings);
    const [scope, key, menu] = settings.registerMenu.mock.calls[0];
    expect([scope, key, menu.name, menu.label, menu.restricted]).toEqual([
      'dicer',
      'pet',
      'DICER.Settings.petWindow.Name',
      'DICER.Settings.petWindow.Label',
      false,
    ]);
    expect(typeof menu.type).toBe('function');
  });
});
