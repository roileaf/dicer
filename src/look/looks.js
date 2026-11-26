// Curated named looks, tuned in Task 9 against the product photos in
// docs/reference/look-references.md (P2-R8: roughness per finish).
import { DEFAULT_APPEARANCE, normalizeAppearance } from './appearance.js';

const make = (name, partial) => ({ name, appearance: normalizeAppearance(partial) });

const defs = {
  default: { name: 'Sapphire Nebula', appearance: DEFAULT_APPEARANCE },
  'ruby-classic': make('Ruby Classic', {
    body: { type: 'opaque', color: '#b3202a', color2: '#5a0d14', roughness: 0.25 },
    numbers: { fill: 'paint', color: '#f5f5f5', depth: 0.5 },
  }),
  'abyss-liquid': make('Abyss', {
    body: { type: 'resin', color: '#0e3a5c', color2: '#04121f', roughness: 0.04 },
    interior: { type: 'liquid', colors: ['#18b6c9', '#0a4d8c'], density: 0.6 },
    numbers: { fill: 'silver', color: '#d8e4ee', depth: 0.5 },
  }),
  'starlit-glitter': make('Starlit Glitter', {
    body: { type: 'resin', color: '#2e1260', color2: '#12062b', roughness: 0.05 },
    interior: { type: 'glitter', colors: ['#ffd76a', '#ff9ad5'], density: 0.7 },
    numbers: { fill: 'gold', color: '#f3c969', depth: 0.5 },
  }),
  'galaxy-nebula': make('Galaxy Nebula', {
    body: { type: 'resin', color: '#1b1b5e', color2: '#07072a', roughness: 0.05 },
    interior: { type: 'nebula', colors: ['#c04dff', '#2fd0f0'], density: 0.65 },
    numbers: { fill: 'enamel', color: '#ffffff', depth: 0.5 },
  }),
  'sharp-crystal': make('Sharp Crystal', {
    body: { type: 'resin', color: '#58c0d6', color2: '#2a7890', roughness: 0.02 },
    interior: { type: 'none' },
    numbers: { fill: 'paint', color: '#f4f8fa', depth: 0.6 },
    edges: { style: 'sharp' },
  }),
  'dwarven-brass': make('Dwarven Brass', {
    body: {
      type: 'metal',
      color: '#b08a3e',
      color2: '#5e4519',
      finish: 'antique',
      roughness: 0.45,
    },
    numbers: { fill: 'enamel', color: '#1a1410', depth: 0.7 },
  }),
  'silver-brushed': make('Brushed Silver', {
    body: {
      type: 'metal',
      color: '#c9ced6',
      color2: '#7d838c',
      finish: 'brushed',
      roughness: 0.35,
    },
    numbers: { fill: 'enamel', color: '#0c0c0e', depth: 0.6 },
  }),
  'gold-polished': make('Polished Gold', {
    body: {
      type: 'metal',
      color: '#e3b341',
      color2: '#9a6d12',
      finish: 'polished',
      roughness: 0.18,
    },
    numbers: { fill: 'enamel', color: '#2a1a05', depth: 0.6 },
  }),
  'marble-white': make('White Marble', {
    body: { type: 'marble', color: '#f1efe9', color2: '#8d8a84', roughness: 0.3 },
    numbers: { fill: 'gold', color: '#d9a93a', depth: 0.5 },
  }),
  'jade-marble': make('Jade Marble', {
    body: { type: 'marble', color: '#2f7d55', color2: '#0e3a24', roughness: 0.3 },
    numbers: { fill: 'gold', color: '#f0cf72', depth: 0.5 },
  }),
  'pearl-moon': make('Moon Pearl', {
    body: { type: 'pearl', color: '#f2eff6', color2: '#b9d4f2', roughness: 0.25 },
    numbers: { fill: 'silver', color: '#5b5f78', depth: 0.45 },
  }),
  'ember-core': make('Ember Core', {
    body: { type: 'resin', color: '#3a0f06', color2: '#140402', roughness: 0.05 },
    interior: { type: 'liquid', colors: ['#ff7a1a', '#ffb347'], density: 0.7 },
    // dark numbers: light ones vanished on the glowing core
    numbers: { fill: 'enamel', color: '#240802', depth: 0.5 },
  }),
  'frost-crystal': make('Frost Crystal', {
    body: { type: 'resin', color: '#bfe3f5', color2: '#6fb2d4', roughness: 0.04 },
    interior: { type: 'glitter', colors: ['#ffffff', '#9fd8ff'], density: 0.55 },
    numbers: { fill: 'silver', color: '#2a4a60', depth: 0.5 },
  }),
  'void-star': make('Void Star', {
    body: { type: 'resin', color: '#08080f', color2: '#000000', roughness: 0.04 },
    interior: { type: 'shape', colors: ['#ffe27a', '#ff9d2e'], density: 0.8, shape: 'star' },
    // silver: gold numbers vanished over the gold star
    numbers: { fill: 'silver', color: '#f2f4f8', depth: 0.5 },
  }),
  'smoke-swirl': make('Smoke Swirl', {
    body: { type: 'resin', color: '#5a5f6b', color2: '#20232a', roughness: 0.05 },
    interior: { type: 'swirl', colors: ['#e8eaf0', '#7a8090'], density: 0.6 },
    // dark numbers: light ones vanished on the white smoke
    numbers: { fill: 'enamel', color: '#1b2233', depth: 0.5 },
  }),
};

function deepFreeze(o) {
  for (const v of Object.values(o))
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

export const LOOKS = deepFreeze(defs);
