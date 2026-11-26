import { dsnAppearance } from './dsn-look.js';

export const PICTURE_TYPES = Object.freeze(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);

export const pictureSize = (cssSize, ratio = globalThis.devicePixelRatio || 1) =>
  Math.round(cssSize * ratio);

export async function themePicture(
  theme,
  dieType = 'd20',
  cssSize = 96,
  dice3d = globalThis.game?.dice3d,
) {
  if (!dice3d?.renderDieImage) return null;
  try {
    return await dice3d.renderDieImage(dieType, dsnAppearance(theme), {
      size: pictureSize(cssSize),
    });
  } catch (err) {
    console.warn(`dicer: no picture of ${theme.id} ${dieType}`, err);
    return null;
  }
}

export function pictureQueue(jobs, show, picture = themePicture) {
  let stopped = false;
  (async () => {
    for (const job of jobs) {
      if (stopped) return;
      const url = await picture(...job);
      if (stopped) return;
      show(job, url);
    }
  })();
  return () => {
    stopped = true;
  };
}
