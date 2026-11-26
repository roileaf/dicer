import { PET_KINDS, readPet } from '../../pet/pet-for.js';

const MODULE = 'dicer';
const title = (kind) => kind[0].toUpperCase() + kind.slice(1);

export function kindChoices(localize = (k) => globalThis.game.i18n.localize(k)) {
  return PET_KINDS.map((kind) => ({
    kind,
    label: localize(`DICER.Appearance.Pet.${title(kind)}`),
  }));
}

export async function savePet(user, { kind, color, natural }) {
  const flag = user.getFlag(MODULE, 'pet') ?? {};
  const next = {
    ...flag,
    kind: PET_KINDS.includes(kind) ? kind : 'mimic',
    natural: natural === true,
  };
  if (/^#[0-9a-f]{6}$/i.test(String(color))) next.color = String(color).toLowerCase();
  await user.setFlag(MODULE, 'pet', next);
  return next;
}

let PetWindow = null;

export function petWindowClass() {
  if (PetWindow) return PetWindow;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  PetWindow = class DicerPetWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: 'dicer-pet-window',
      tag: 'form',
      classes: ['dicer-theme-browser', 'dicer-pet-window'],
      window: { title: 'DICER.PetWindow.Title', icon: 'fa-solid fa-dragon' },
      position: { width: 380 },
      form: { handler: DicerPetWindow.#onSubmit, closeOnSubmit: true },
    };

    static PARTS = { body: { template: 'modules/dicer/templates/v2-pet-window.hbs' } };

    async _prepareContext() {
      const pet = readPet(game.user);
      return {
        kinds: kindChoices().map((k) => ({ ...k, selected: k.kind === pet.kind })),
        color: pet.color,
        natural: pet.natural,
      };
    }

    static async #onSubmit(_event, _form, data) {
      const o = data.object;
      await savePet(game.user, { kind: o.kind, color: o.color, natural: o.natural === true });
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
    name: 'DICER.PetWindow.Title',
    label: 'DICER.PetWindow.Button',
    hint: 'DICER.PetWindow.ButtonHint',
    icon: 'fa-solid fa-dragon',
    type: petWindowClass(),
    restricted: false,
  });
}
