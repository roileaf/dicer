import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PET_TIMBRES } from '../src/audio/pet-timbre.js';
import { renderPetSound, renderResult, RESULT_SOUNDS } from '../src/audio/synth.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export const RATE = 48000;
export const FX_DIR = 'assets/sounds/dsn/fx';
export const PET_DIR = 'assets/sounds/dsn/pets';
export const FX_SOUNDS = Object.freeze(RESULT_SOUNDS.filter((name) => !name.startsWith('pet')));
export const PET_SOUNDS = Object.freeze([
  'petHappy',
  'petSad',
  'petHmm',
  'petHuh',
  'petPurr',
  'petYelp',
]);
export const PET_VOICES = Object.freeze(Object.keys(PET_TIMBRES));

export const fxFile = (name) => `${FX_DIR}/${name}.ogg`;
export const petFile = (kind, name) => `${PET_DIR}/${kind}-${name}.ogg`;

export function encodeOgg(samples, output) {
  const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'f32le',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-c:a',
      'libvorbis',
      '-q:a',
      '4',
      output,
    ],
    { input: pcm },
  );
}

function main() {
  mkdirSync(`${root}${FX_DIR}`, { recursive: true });
  mkdirSync(`${root}${PET_DIR}`, { recursive: true });
  for (const name of FX_SOUNDS) encodeOgg(renderResult(name, RATE), `${root}${fxFile(name)}`);
  for (const kind of PET_VOICES)
    for (const name of PET_SOUNDS)
      encodeOgg(renderPetSound(name, kind, RATE), `${root}${petFile(kind, name)}`);
  console.log(
    `wrote ${FX_SOUNDS.length} effect sounds and ${PET_VOICES.length * PET_SOUNDS.length} pet sounds`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
