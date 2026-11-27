const MODULE = 'dicer';

export const FONTS = Object.freeze({
  serif: { family: 'Dicer Serif', file: 'DMSerifDisplay-Regular.woff' },
  sans: { family: 'Dicer Sans', file: 'AtkinsonHyperlegible-Bold.ttf' },
  blackletter: { family: 'Dicer Blackletter', file: 'UnifrakturMaguntia-Book.ttf' },
  norse: { family: 'Dicer Norse', file: 'GermaniaOne-Regular.ttf' },
  uncial: { family: 'Dicer Uncial', file: 'UncialAntiqua-Regular.ttf' },
  scifi: { family: 'Dicer Scifi', file: 'Orbitron[wght].ttf' },
  handwritten: { family: 'Dicer Handwritten', file: 'Caveat[wght].ttf' },
  deco: { family: 'Dicer Deco', file: 'Limelight-Regular.ttf' },
});
export const ICONS = Object.freeze({ family: 'Dicer Icons', file: 'DicerIcons.otf' });

export const fontFamilyOf = (id) => FONTS[id]?.family ?? 'auto';

const defaultRoute = (path) => globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`;
const fontUrl = (file, route) =>
  route(`modules/${MODULE}/assets/fonts/${encodeURIComponent(file)}`);

export function defineFonts({ config = globalThis.CONFIG, route = defaultRoute } = {}) {
  const definitions = config?.fontDefinitions;
  if (!definitions) return [];
  const families = [];
  for (const { family, file } of Object.values(FONTS)) {
    definitions[family] ??= { editor: true, fonts: [{ urls: [fontUrl(file, route)] }] };
    families.push(family);
  }
  return families;
}

export function registerFonts({
  fonts = globalThis.document?.fonts,
  FontFace = globalThis.FontFace,
  route = defaultRoute,
} = {}) {
  if (!fonts || !FontFace) return [];
  const added = [];
  for (const { family, file } of [...Object.values(FONTS), ICONS]) {
    const face = new FontFace(family, `url("${fontUrl(file, route)}")`);
    fonts.add(face);
    added.push(face);
  }
  return added;
}

export function preloadFonts(faces) {
  return Promise.all(
    faces.map((face) =>
      Promise.resolve(face.load()).catch((err) =>
        console.warn(`dicer: cannot load the font ${face.family}`, err),
      ),
    ),
  );
}
