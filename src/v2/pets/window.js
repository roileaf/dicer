import { PET_KINDS, readPet } from '../../pet/pet-for.js';
import { buildPetForm, controlValue, petPlayers, savePet } from '../../ui/pet-window.js';

const MODULE = 'dicer';
const HEX6 = /^#[0-9a-f]{6}$/;
export const UNPORTED = '.dicer-pet-pitch, .dicer-pet-catch, .dicer-pet-preview';

const read = (settings, key) => {
  try {
    return settings.get(MODULE, key);
  } catch {
    return undefined;
  }
};

export function petForm(
  user,
  {
    self = globalThis.game?.user,
    users = globalThis.game?.users,
    settings = globalThis.game?.settings,
  } = {},
) {
  const form = buildPetForm(readPet(user), {
    allowed: read(settings, 'petsAllowed') !== false,
    hidden: read(settings, 'showPets') === false,
    players: petPlayers(self, users),
    target: user?.id,
  });
  for (const el of form.querySelectorAll(UNPORTED)) el.remove();
  return form;
}

export function wirePetForm(
  form,
  { getTarget, setTarget, rerender, save = savePet, settings = globalThis.game?.settings },
) {
  const mirror = (el) => {
    if (el?.type === 'range') el.nextElementSibling.textContent = el.value;
    if (!el?.matches?.('[data-pet-color]')) return null;
    const v = String(el.value).trim().toLowerCase();
    if (!HEX6.test(v)) return null;
    for (const input of form.querySelectorAll('[data-pet-color]')) input.value = v;
    return v;
  };

  async function onKind(button) {
    const kind = button?.dataset.kind;
    if (!PET_KINDS.includes(kind) || kind === readPet(getTarget()).kind) return;
    if (await save({ kind }, getTarget())) rerender();
  }

  async function onSetting(key, el) {
    const cfg = settings.settings.get(`${MODULE}.${key}`);
    try {
      await settings.set(MODULE, key, controlValue(el, cfg));
    } catch (err) {
      console.warn(`dicer: cannot save ${key}`, err);
    }
    if (key === 'showPets') rerender();
  }

  async function onChange(el) {
    if (el?.matches?.('[data-pet-player]')) {
      setTarget(el.value);
      rerender();
      return;
    }
    const key = el?.closest?.('[data-setting]')?.dataset.setting;
    if (key) {
      await onSetting(key, el);
      return;
    }
    if (el?.matches?.('[data-pet-natural]')) {
      if (!(await save({ natural: el.checked }, getTarget()))) rerender();
      return;
    }
    const v = mirror(el);
    if (!v) return;
    const box = form.querySelector('[data-pet-natural]');
    if (box) box.checked = false;
    if (!(await save({ color: v, natural: false }, getTarget()))) rerender();
  }

  form.addEventListener('click', (event) => void onKind(event.target.closest?.('[data-kind]')));
  form.addEventListener('input', (event) => void mirror(event.target));
  form.addEventListener('change', (event) => void onChange(event.target));
  form.addEventListener('submit', (event) => event.preventDefault());
  return { onKind, onChange };
}

let PetWindow = null;

export function petWindowClass() {
  if (PetWindow) return PetWindow;
  const { ApplicationV2 } = foundry.applications.api;

  PetWindow = class DicerPetWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-pet-window',
      classes: ['dicer-pet-window-app'],
      window: { title: 'DICER.PetWindow.Title', icon: 'fa-solid fa-dragon', resizable: true },
      position: { width: 460, height: 'auto' },
    };

    #targetId = null;

    get target() {
      return (this.#targetId && game.users.get(this.#targetId)) || game.user;
    }

    async _renderHTML() {
      return petForm(this.target);
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      wirePetForm(result, {
        getTarget: () => this.target,
        setTarget: (id) => void (this.#targetId = id),
        rerender: () => void this.render(),
      });
    }
  };
  return PetWindow;
}

export function openPetWindow() {
  const App = petWindowClass();
  const open = foundry.applications.instances.get('dicer-pet-window') ?? new App();
  open.render({ force: true });
  return open;
}

export function registerPetWindow(settings = game.settings) {
  settings.registerMenu(MODULE, 'pet', {
    name: 'DICER.Settings.petWindow.Name',
    label: 'DICER.Settings.petWindow.Label',
    hint: 'DICER.Settings.petWindow.Hint',
    icon: 'fa-solid fa-dragon',
    type: petWindowClass(),
    restricted: false,
  });
}
