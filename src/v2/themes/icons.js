import { ICON_IDS } from '../../look/appearance.js';
import { BUILTIN_THEMES } from '../../themes/themes.js';

export const ICON_FONT = 'Dicer Icons';
export const iconChar = (id) => String.fromCharCode(0xe000 + ICON_IDS.indexOf(id));

export function iconsOf(a) {
  const i = a?.numbers?.icons ?? {};
  const crit = ICON_IDS.includes(i.crit) ? i.crit : null;
  const fumble = ICON_IDS.includes(i.fumble) ? i.fumble : null;
  return crit || fumble ? { crit, fumble } : null;
}

export const isRounded = (a) => (a?.edges?.radius ?? 0) > 0;

export const iconSystemId = ({ crit, fumble }, rounded = true) =>
  `dicer-icons-${crit ?? 'none'}-${fumble ?? 'none'}${rounded ? '' : '-sharp'}`;

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
      const icons = iconsOf(a);
      if (icons) combos.set(iconSystemId(icons, isRounded(a)), { ...icons, rounded: isRounded(a) });
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
  for (const icons of iconCombos(themes)) {
    const id = iconSystemId(icons, icons.rounded);
    const names = [icons.crit, icons.fumble].filter(Boolean).join(', ');
    const system = new DiceSystem(
      id,
      `${localize('DICER.V2.Icons')}: ${names}`,
      'default',
      'Dicer',
    );
    system.setMesh?.(icons.rounded ? 'rounded' : 'chamfered');
    dice3d.addSystem(system);
    dice3d.addDicePreset({ type: 'd20', labels: iconLabels(icons), system: id });
    ids.push(id);
  }
  return ids;
}
