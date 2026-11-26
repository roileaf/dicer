import { ICON_IDS } from '../../look/appearance.js';
import { BUILTIN_THEMES } from '../../themes/themes.js';
import { FONTS } from './fonts.js';

export const ICON_FONT = 'Dicer Icons';
export const iconChar = (id) => String.fromCharCode(0xe000 + ICON_IDS.indexOf(id));

export function iconsOf(a) {
  const i = a?.numbers?.icons ?? {};
  const crit = ICON_IDS.includes(i.crit) ? i.crit : null;
  const fumble = ICON_IDS.includes(i.fumble) ? i.fumble : null;
  return crit || fumble ? { crit, fumble } : null;
}

export const isRounded = (a) => (a?.edges?.radius ?? 0) > 0;

export function iconPackOf(a) {
  const icons = iconsOf(a);
  if (!icons) return null;
  const font = Object.hasOwn(FONTS, a.numbers.font) ? a.numbers.font : 'serif';
  return { ...icons, font, rounded: isRounded(a) };
}

export const iconSystemId = ({ crit, fumble, font = 'serif', rounded = true }) =>
  `dicer-icons-${crit ?? 'none'}-${fumble ?? 'none'}-${font}${rounded ? '' : '-sharp'}`;

export const iconPackFont = ({ font = 'serif' }) => `${FONTS[font].family}, ${ICON_FONT}`;

export function iconLabels({ crit, fumble }) {
  const labels = Array.from({ length: 20 }, (_, i) => String(i + 1));
  if (fumble) labels[0] = iconChar(fumble);
  if (crit) labels[19] = iconChar(crit);
  return labels;
}

export function iconCombos(themes = BUILTIN_THEMES) {
  const combos = new Map();
  for (const theme of themes)
    for (const a of [theme.appearance, ...Object.values(theme.perType ?? {})]) {
      const pack = iconPackOf(a);
      if (pack) combos.set(iconSystemId(pack), pack);
    }
  return [...combos.values()];
}

export function registerIconSystems(
  dice3d,
  DiceSystem,
  themes = BUILTIN_THEMES,
  localize = (k) => globalThis.game?.i18n?.localize(k) ?? k,
) {
  const ids = [];
  for (const pack of iconCombos(themes)) {
    const id = iconSystemId(pack);
    const names = [pack.crit, pack.fumble]
      .filter(Boolean)
      .map((icon) => localize(`DICER.Appearance.Icon.${icon}`))
      .join(', ');
    const font = localize(`DICER.Appearance.FontKind.${pack.font}`);
    const name = `${localize('DICER.V2.Icons')}: ${names} (${font})`;
    const system = new DiceSystem(id, name, 'default', 'Dicer');
    system.setMesh?.(pack.rounded ? 'rounded' : 'chamfered');
    dice3d.addSystem(system);
    dice3d.addDicePreset({
      type: 'd20',
      labels: iconLabels(pack),
      system: id,
      font: iconPackFont(pack),
    });
    ids.push(id);
  }
  return ids;
}
