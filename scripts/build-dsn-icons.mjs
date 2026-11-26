import { writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { ICON_CHARS, ICON_PATHS } from '../src/render/extras/icons.js';

const OUT = 'assets/fonts/DicerIcons.otf';
const SIZE = 760;
const S = SIZE / 100;
const KAPPA = 0.5522847498;

function subpaths(d) {
  const t = d.match(/[MLCAZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const out = [];
  let cur = null;
  let p = [0, 0];
  let i = 0;
  const num = () => Number(t[i++]);
  while (i < t.length) {
    const c = t[i++];
    if (c === 'M') {
      p = [num(), num()];
      cur = { start: p, segs: [] };
      out.push(cur);
    } else if (c === 'L') {
      const q = [num(), num()];
      cur.segs.push([p, q]);
      p = q;
    } else if (c === 'C') {
      const a = [num(), num()];
      const b = [num(), num()];
      const q = [num(), num()];
      cur.segs.push([p, a, b, q]);
      p = q;
    } else if (c === 'A') {
      i += 5;
      const q = [num(), num()];
      const cx = (p[0] + q[0]) / 2;
      const cy = (p[1] + q[1]) / 2;
      const r = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2;
      const a0 = Math.atan2(p[1] - cy, p[0] - cx);
      for (let k = 0; k < 2; k++) {
        const s = a0 - (k * Math.PI) / 2;
        const e = s - Math.PI / 2;
        const p0 = [cx + r * Math.cos(s), cy + r * Math.sin(s)];
        const p3 = [cx + r * Math.cos(e), cy + r * Math.sin(e)];
        const p1 = [p0[0] + KAPPA * r * Math.sin(s), p0[1] - KAPPA * r * Math.cos(s)];
        const p2 = [p3[0] - KAPPA * r * Math.sin(e), p3[1] + KAPPA * r * Math.cos(e)];
        cur.segs.push([p0, p1, p2, p3]);
      }
      p = q;
    } else if (c === 'Z') {
      if (p[0] !== cur.start[0] || p[1] !== cur.start[1]) cur.segs.push([p, cur.start]);
      p = cur.start;
    }
  }
  return out;
}

const at = (seg, u) => {
  if (seg.length === 2)
    return [seg[0][0] + (seg[1][0] - seg[0][0]) * u, seg[0][1] + (seg[1][1] - seg[0][1]) * u];
  const v = 1 - u;
  const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return [0, 1].map((k) => seg.reduce((sum, pt, j) => sum + w[j] * pt[k], 0));
};
const polygon = (sub) => sub.segs.flatMap((seg) => [0, 0.25, 0.5, 0.75].map((u) => at(seg, u)));
const area = (poly) =>
  poly.reduce(
    (sum, a, i) =>
      sum + a[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * a[1],
    0,
  ) / 2;
const inside = (pt, poly) => {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a[1] > pt[1] !== b[1] > pt[1] &&
      pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      odd = !odd;
  }
  return odd;
};
const reversed = (sub) => ({
  start: sub.segs.at(-1).at(-1),
  segs: sub.segs.map((seg) => [...seg].reverse()).reverse(),
});

function glyphPath(d) {
  const subs = subpaths(d);
  const polys = subs.map(polygon);
  const path = new opentype.Path();
  const pt = ([x, y]) => [x * S, (100 - y) * S];
  subs.forEach((sub, n) => {
    const depth = polys.filter((poly, m) => m !== n && inside(polys[n][0], poly)).length;
    const clockwise = area(polys[n].map(pt)) < 0;
    const fixed = clockwise === (depth % 2 === 0) ? sub : reversed(sub);
    path.moveTo(...pt(fixed.segs[0][0]));
    for (const seg of fixed.segs) {
      if (seg.length === 2) path.lineTo(...pt(seg[1]));
      else path.curveTo(...pt(seg[1]), ...pt(seg[2]), ...pt(seg[3]));
    }
    path.close();
  });
  return path;
}

const glyphs = [
  new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: SIZE,
    path: new opentype.Path(),
  }),
];
for (const [id, d] of Object.entries(ICON_PATHS))
  glyphs.push(
    new opentype.Glyph({
      name: id.replace(/[^a-z]/g, ''),
      unicode: ICON_CHARS[id].charCodeAt(0),
      advanceWidth: SIZE,
      path: glyphPath(d),
    }),
  );

const font = new opentype.Font({
  familyName: 'Dicer Icons',
  styleName: 'Regular',
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  glyphs,
});
writeFileSync(OUT, Buffer.from(font.toArrayBuffer()));
console.log(`${OUT}: ${glyphs.length - 1} icons`);
