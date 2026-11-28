import { BUILTIN_THEMES } from '../../themes/themes.js';
import { settingDefaults } from '../materials/defaults.js';
import { dsnAppearance } from './dsn-look.js';
import { PICTURE_TYPES, pictureQueue } from './pictures.js';

const DSN = 'dice-so-nice';
const CARD_SIZE = 96;
const DETAIL_SIZE = 220;
const DIE_SIZE = 56;

const RELIEF = ['textureRelief', 'labelRelief'];

const equal = (a, b) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

function sameSettings(material, a = {}, b = {}) {
  const defaults = settingDefaults(material);
  const x = { ...defaults, ...a };
  const y = { ...defaults, ...b };
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => equal(x[k], y[k]));
}

function sameLook(theme, mine) {
  if (!theme || !mine) return false;
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'materialSettings') {
      if (!sameSettings(theme.material, value, mine.materialSettings)) return false;
    } else if (!RELIEF.includes(key) && !equal(value, mine[key])) return false;
  }
  return RELIEF.every((k) => (theme[k] ?? true) === (mine[k] ?? true));
}

const same = (theme, mine) =>
  [...new Set([...Object.keys(theme), ...Object.keys(mine)])].every((scope) =>
    sameLook(theme[scope], mine[scope]),
  );

export function themeInUse(appearance, themes = BUILTIN_THEMES) {
  if (!appearance) return null;
  return themes.find((t) => same(dsnAppearance(t), appearance))?.id ?? null;
}

export async function useTheme(theme, user = game.user, socket = game.socket) {
  await user.unsetFlag(DSN, 'appearance');
  await user.setFlag(DSN, 'appearance', dsnAppearance(theme));
  const saved = user.getFlag(DSN, 'saved') ?? {};
  await user.setFlag(DSN, 'saved', { appearance: true, sfx: !!saved.sfx });
  socket?.emit(`module.${DSN}`, { type: 'update', user: user.id });
}

export const matching = (themes, query) => {
  const q = query.trim().toLowerCase();
  return q ? themes.filter((t) => t.name.toLowerCase().includes(q)) : themes;
};

let ThemeBrowser = null;

export function themeBrowserClass() {
  if (ThemeBrowser) return ThemeBrowser;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  ThemeBrowser = class DicerThemeBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: 'dicer-theme-browser',
      tag: 'div',
      classes: ['dicer-theme-browser'],
      window: { title: 'DICER.Themes.Title', icon: 'fa-solid fa-dice-d20', resizable: true },
      position: { width: 900, height: 680 },
      actions: {
        select: DicerThemeBrowser.#onSelect,
        use: DicerThemeBrowser.#onUse,
      },
    };

    static PARTS = {
      body: {
        template: 'modules/dicer/templates/v2-theme-browser.hbs',
        scrollable: ['.dicer-theme-grid'],
      },
    };

    #selected = null;
    #query = '';
    #urls = new Map();
    #stop = null;

    async _prepareContext() {
      const inUse = themeInUse(game.user.getFlag(DSN, 'appearance'));
      const themes = matching(BUILTIN_THEMES, this.#query);
      this.#selected =
        themes.find((t) => t.id === this.#selected)?.id ??
        themes.find((t) => t.id === inUse)?.id ??
        themes[0]?.id ??
        null;
      const detail = themes.find((t) => t.id === this.#selected);
      return {
        query: this.#query,
        hidden: !game.dice3d?.renderDieImage,
        cards: themes.map((t) => ({
          id: t.id,
          name: t.name,
          swatch: t.appearance.body.color,
          selected: t.id === this.#selected,
          inUse: t.id === inUse,
        })),
        detail: detail && {
          id: detail.id,
          name: detail.name,
          swatch: detail.appearance.body.color,
          credit: detail.author ? game.i18n.format('DICER.Themes.By', { name: detail.author }) : '',
          inUse: detail.id === inUse,
          dice: PICTURE_TYPES,
        },
      };
    }

    _onRender() {
      const search = this.element.querySelector('input[name=dicerThemeSearch]');
      search?.addEventListener('input', () => {
        this.#query = search.value;
        this.render().then(() => {
          const again = this.element.querySelector('input[name=dicerThemeSearch]');
          again?.focus();
          again?.setSelectionRange(again.value.length, again.value.length);
        });
      });
      this.#loadPictures();
    }

    #loadPictures() {
      this.#stop?.();
      const jobs = [];
      for (const img of this.element.querySelectorAll('img.dicer-thumb')) {
        const theme = BUILTIN_THEMES.find((t) => t.id === img.dataset.theme);
        if (!theme) continue;
        const job = [theme, img.dataset.die || 'd20', Number(img.dataset.size) || CARD_SIZE];
        const url = this.#urls.get(DicerThemeBrowser.#key(job));
        if (url) DicerThemeBrowser.#show(img, url);
        else jobs.push([job, img]);
      }
      jobs.sort(
        (a, b) =>
          Number(!!b[1].closest('.dicer-theme-detail')) -
          Number(!!a[1].closest('.dicer-theme-detail')),
      );
      const imgs = new Map(jobs.map(([job, img]) => [job, img]));
      this.#stop = pictureQueue(
        jobs.map(([job]) => job),
        (job, url) => {
          if (!url) return;
          this.#urls.set(DicerThemeBrowser.#key(job), url);
          DicerThemeBrowser.#show(imgs.get(job), url);
        },
      );
    }

    static #key = ([theme, die, size]) => `${theme.id}|${die}|${size}`;

    static #show(img, url) {
      if (!img?.isConnected) return;
      img.src = url;
      img.hidden = false;
      img.closest('.dicer-stage, .dicer-die')?.classList.add('has-thumb');
    }

    static #onSelect(_event, target) {
      this.#selected = target.closest('[data-theme]')?.dataset.theme ?? null;
      this.render();
    }

    static async #onUse(_event, target) {
      const theme = BUILTIN_THEMES.find((t) => t.id === target.dataset.theme);
      if (!theme) return;
      await useTheme(theme);
      ui.notifications.info(game.i18n.format('DICER.V2.Themes.Applied', { name: theme.name }));
      this.render();
    }

    _onClose(options) {
      this.#stop?.();
      super._onClose?.(options);
    }
  };
  ThemeBrowser.SIZES = { CARD_SIZE, DETAIL_SIZE, DIE_SIZE };
  return ThemeBrowser;
}

export function openThemeBrowser() {
  const App = themeBrowserClass();
  const open = foundry.applications.instances.get('dicer-theme-browser') ?? new App();
  open.render({ force: true });
  return open;
}

export function registerThemeBrowser(settings = game.settings) {
  settings.registerMenu('dicer', 'themes', {
    name: 'DICER.V2.Themes.Menu',
    label: 'DICER.V2.Themes.MenuLabel',
    hint: 'DICER.V2.Themes.MenuHint',
    icon: 'fa-solid fa-dice-d20',
    type: themeBrowserClass(),
    restricted: false,
  });
}
