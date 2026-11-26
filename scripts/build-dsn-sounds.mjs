import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MATERIAL_COLOUR } from '../src/audio/sound-engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RATE = 48000;
const LEAD = 0.01;
const TAIL = 0.03;
const OUT_DIR = 'assets/sounds/dsn';

export const DICE_COLOUR = {
  plastic: {},
  glass: {
    rate: 1.3,
    filters: [
      { type: 'highpass', frequency: 700 },
      { type: 'peaking', frequency: 5000, Q: 2, gain: 8 },
      { type: 'ring', delays: [6, 11], decays: [0.45, 0.3] },
    ],
    db: -3,
  },
  metal: {
    rate: 1.15,
    filters: [
      { type: 'highpass', frequency: 400 },
      { type: 'peaking', frequency: 2600, Q: 3, gain: 8 },
      { type: 'highshelf', frequency: 6000, gain: 5 },
      { type: 'ring', delays: [10, 17], decays: [0.4, 0.25] },
    ],
    db: -3,
  },
  wood: {
    rate: 0.82,
    filters: [
      { type: 'lowpass', frequency: 2400 },
      { type: 'peaking', frequency: 250, Q: 1, gain: 6 },
    ],
  },
  stone: {
    rate: 0.92,
    filters: [
      { type: 'lowpass', frequency: 5000 },
      { type: 'peaking', frequency: 1500, Q: 1.5, gain: 6 },
    ],
  },
  squishy: MATERIAL_COLOUR.squishy,
};

export const TABLE_COLOUR = {
  felt: {},
  wood: {
    rate: 0.85,
    filters: [
      { type: 'lowpass', frequency: 2600 },
      { type: 'peaking', frequency: 220, Q: 1, gain: 6 },
    ],
  },
  stone: {
    rate: 1,
    filters: [
      { type: 'highpass', frequency: 350 },
      { type: 'highshelf', frequency: 3500, gain: 6 },
    ],
  },
  metal: {
    rate: 1.25,
    filters: [
      { type: 'highpass', frequency: 500 },
      { type: 'peaking', frequency: 2800, Q: 3, gain: 9 },
      { type: 'highshelf', frequency: 6000, gain: 6 },
      { type: 'ring', delays: [9, 15], decays: [0.4, 0.25] },
    ],
    db: -3,
  },
};

export function ffmpegFilter(f) {
  if (f.type === 'lowpass')
    return `lowpass=f=${f.frequency}${f.Q ? `:width_type=q:width=${f.Q}` : ''}`;
  if (f.type === 'highpass') return `highpass=f=${f.frequency}`;
  if (f.type === 'ring') return `aecho=0.9:0.9:${f.delays.join('|')}:${f.decays.join('|')}`;
  if (f.type === 'highshelf') return `highshelf=f=${f.frequency}:g=${f.gain}`;
  if (f.type === 'peaking')
    return `equalizer=f=${f.frequency}:width_type=q:width=${f.Q ?? 1}:g=${f.gain}`;
  throw new Error(`no ffmpeg filter for ${f.type}`);
}

export function filterChain({ rate = 1, filters = [], db = 0 }) {
  const chain = [];
  if (rate !== 1) chain.push(`asetrate=${Math.round(RATE * rate)}`, `aresample=${RATE}`);
  for (const f of filters) chain.push(ffmpegFilter(f));
  if (db) chain.push(`volume=${db}dB`);
  return chain.join(',') || 'anull';
}

export function hitSpans(hits, rate = 1, length = Infinity) {
  const r = (x) => Math.round(x * 10000) / 10000;
  return hits.map((h) => ({
    start: r(Math.max(0, h.start - LEAD) / rate),
    end: r(Math.min(length, (h.start + h.duration + TAIL) / rate)),
    level: h.level,
  }));
}

function render(input, output, colour) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    input,
    '-ac',
    '1',
    '-af',
    filterChain(colour),
    '-ar',
    String(RATE),
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    output,
  ]);
}

function main() {
  mkdirSync(`${root}${OUT_DIR}`, { recursive: true });
  const hard = JSON.parse(readFileSync(`${root}assets/sounds/dice-hits.json`, 'utf8'));
  const felt = JSON.parse(readFileSync(`${root}assets/sounds/dice-hits-felt.json`, 'utf8'));
  const manifest = { dice: {}, table: {} };
  for (const [name, colour] of Object.entries(DICE_COLOUR)) {
    render(`${root}assets/sounds/dice-hits.mp3`, `${root}${OUT_DIR}/dice-${name}.ogg`, colour);
    manifest.dice[name] = {
      file: `${OUT_DIR}/dice-${name}.ogg`,
      hits: hitSpans(hard.hits, colour.rate),
    };
  }
  for (const [name, colour] of Object.entries(TABLE_COLOUR)) {
    const fromFelt = name === 'felt';
    const src = fromFelt ? 'dice-hits-felt.mp3' : 'dice-hits.mp3';
    render(
      `${root}assets/sounds/${src}`,
      `${root}${OUT_DIR}/table-${name}.ogg`,
      fromFelt ? {} : colour,
    );
    manifest.table[name] = {
      file: `${OUT_DIR}/table-${name}.ogg`,
      hits: hitSpans((fromFelt ? felt : hard).hits, colour.rate),
    };
  }
  const js = `export const SOUND_SPRITES = ${JSON.stringify(manifest)};\n`;
  mkdirSync(`${root}src/v2/sounds`, { recursive: true });
  writeFileSync(`${root}src/v2/sounds/manifest.js`, js);
  console.log(
    `wrote ${Object.keys(manifest.dice).length} dice and ${Object.keys(manifest.table).length} table sprites`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
