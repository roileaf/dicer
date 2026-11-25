// Dicer v2: bakes Dicer's procedural studio (src/render/studio-env.js) to an equirectangular
// Radiance .hdr, the only kind of environment Dice So Nice takes (DsN note 5.3).
// v1 renders the studio scene through PMREM at run time; it is only a dark backdrop and six
// emissive rectangles aimed at the origin, so each pixel is one exact ray cast from the origin,
// supersampled. Colours are three's own (linear, after its sRGB conversion), so the file holds
// the same radiance v1's PMREM saw. Usage: node scripts/bake-studio-hdr.mjs [width]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Matrix4, Vector3 } from 'three';
import { createStudioScene } from '../src/render/studio-env.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export const OUT = 'assets/lighting/dicer-studio.hdr';
const SS = 3; // samples per axis and pixel

/** The panels of the studio scene: world matrix inverse, half sizes, linear radiance. */
export function studioPanels(scene = createStudioScene()) {
  const panels = [];
  let backdrop = null;
  for (const o of scene.children) {
    const c = o.material.color;
    if (!o.userData.panel) {
      backdrop = [c.r, c.g, c.b];
      continue;
    }
    const { width, height } = o.geometry.parameters;
    panels.push({ inv: new Matrix4().copy(o.matrixWorld).invert(), hw: width / 2, hh: height / 2, rgb: [c.r, c.g, c.b] });
  }
  return { panels, backdrop };
}

/** Radiance seen from the origin along `dir` (unit): the nearest panel hit, else the backdrop. */
export function radiance(dir, { panels, backdrop }) {
  let best = Infinity;
  let rgb = backdrop;
  const o = new Vector3();
  const d = new Vector3();
  for (const p of panels) {
    o.set(0, 0, 0).applyMatrix4(p.inv);
    d.copy(dir).transformDirection(p.inv); // the panel's matrix has no scale: lengths are kept
    if (Math.abs(d.z) < 1e-9) continue;
    const t = -o.z / d.z;
    if (!(t > 0) || t >= best) continue;
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    if (Math.abs(x) <= p.hw && Math.abs(y) <= p.hh) {
      best = t;
      rgb = p.rgb;
    }
  }
  return rgb;
}

/** The direction of equirect texel coordinates (u right, v up, both 0..1), as three samples it. */
export function directionOf(u, v, out = new Vector3()) {
  // three's equirectUv: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
  const phi = (u - 0.5) * 2 * Math.PI;
  const lat = (v - 0.5) * Math.PI;
  return out.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
}

/** Linear RGB float pixels, row 0 at the top (up), as HDRLoader (flipY) expects. */
export function bake(width, height = width / 2, studio = studioPanels()) {
  const px = new Float32Array(width * height * 3);
  const dir = new Vector3();
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sj = 0; sj < SS; sj++)
        for (let si = 0; si < SS; si++) {
          const u = (i + (si + 0.5) / SS) / width;
          const v = 1 - (j + (sj + 0.5) / SS) / height;
          const c = radiance(directionOf(u, v, dir), studio);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const k = (j * width + i) * 3;
      const n = SS * SS;
      px[k] = r / n;
      px[k + 1] = g / n;
      px[k + 2] = b / n;
    }
  return px;
}

/** One RGBE texel. */
export function rgbe(r, g, b) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const f = 256 / 2 ** e;
  // the mantissa of the largest channel stays below 256
  return [Math.min(255, Math.floor(r * f)), Math.min(255, Math.floor(g * f)), Math.min(255, Math.floor(b * f)), e + 128];
}

/** Run-length encodes one channel of a scanline (Radiance's new RLE). */
function rle(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let run = 1;
    while (i + run < bytes.length && run < 127 && bytes[i + run] === bytes[i]) run++;
    if (run > 2) {
      out.push(128 + run, bytes[i]);
      i += run;
      continue;
    }
    let lit = 0;
    while (i + lit < bytes.length && lit < 128) {
      const j = i + lit;
      if (j + 2 < bytes.length && bytes[j] === bytes[j + 1] && bytes[j] === bytes[j + 2]) break;
      lit++;
    }
    out.push(lit, ...bytes.slice(i, i + lit));
    i += lit;
  }
  return out;
}

/** A Radiance .hdr file (RLE scanlines) of linear RGB float pixels. */
export function encodeHdr(px, width, height) {
  const header = `#?RADIANCE\n# Dicer studio, scripts/bake-studio-hdr.mjs\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const parts = [Buffer.from(header, 'ascii')];
  const ch = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 3;
      const e = rgbe(px[k], px[k + 1], px[k + 2]);
      for (let c = 0; c < 4; c++) ch[c][i] = e[c];
    }
    const line = [2, 2, (width >> 8) & 0xff, width & 0xff];
    for (const c of ch) line.push(...rle(c));
    parts.push(Buffer.from(line));
  }
  return Buffer.concat(parts);
}

function main() {
  const width = Number(process.argv[2]) || 1024;
  const height = width / 2;
  const file = encodeHdr(bake(width, height), width, height);
  mkdirSync(`${root}assets/lighting`, { recursive: true });
  writeFileSync(`${root}${OUT}`, file);
  console.log(`wrote ${OUT}: ${width}x${height}, ${(file.length / 1024).toFixed(0)} KiB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
