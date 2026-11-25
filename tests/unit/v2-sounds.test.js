import { describe, expect, it, vi } from 'vitest';
import { MATERIAL_COLOUR, SURFACE_COLOUR } from '../../src/audio/sound-engine.js';
import { SOUND_SPRITES } from '../../src/v2/sounds/manifest.js';
import { diceSoundSetId, registerSounds, spriteSounds, surfaceId, tableSoundSetId } from '../../src/v2/sounds/register.js';
import { filterChain, ffmpegFilter, hitSpans } from '../../scripts/build-dsn-sounds.mjs';

const fakeDice3d = () => ({ addImpactSounds: vi.fn(), addSurface: vi.fn() });

describe('v2 impact sounds (DsN 5.2)', () => {
  it('has a dice sprite per sound material and a table sprite per surface', () => {
    expect(Object.keys(SOUND_SPRITES.dice).sort()).toEqual(Object.keys(MATERIAL_COLOUR).sort());
    expect(Object.keys(SOUND_SPRITES.table).sort()).toEqual(Object.keys(SURFACE_COLOUR).sort());
  });

  it('every hit is a valid span of its sprite', () => {
    for (const group of [SOUND_SPRITES.dice, SOUND_SPRITES.table])
      for (const { hits } of Object.values(group)) {
        expect(hits.length).toBeGreaterThan(5);
        for (const h of hits) {
          expect(h.start).toBeGreaterThanOrEqual(0);
          expect(h.end).toBeGreaterThan(h.start);
          expect(h.end - h.start).toBeLessThan(0.5);
        }
      }
  });

  it('registers dice sets (dice sounds only) and table sets with a surface each, under dicer ids', () => {
    const dice3d = fakeDice3d();
    const ids = registerSounds(dice3d);
    const sets = dice3d.addImpactSounds.mock.calls.map(([s]) => s);
    const metal = sets.find((s) => s.id === diceSoundSetId('metal'));
    expect(metal.dice.length).toBe(SOUND_SPRITES.dice.metal.hits.length);
    expect(metal.table).toBeUndefined(); // the player's surface stays theirs
    expect(metal.dice[0].src).toBe('modules/dicer/assets/sounds/dsn/dice-metal.ogg');
    const felt = sets.find((s) => s.id === tableSoundSetId('felt'));
    expect(felt.dice).toBeUndefined();
    expect(felt.table.length).toBe(SOUND_SPRITES.table.felt.hits.length);
    expect(dice3d.addSurface).toHaveBeenCalledWith({ id: surfaceId('felt'), name: 'DICER.V2.Surface.felt', sounds: tableSoundSetId('felt') });
    for (const id of sets.map((s) => s.id)) expect(id.startsWith('dicer.')).toBe(true);
    expect(ids.dice.plastic).toBe('dicer.dice-plastic');
    expect(Object.keys(ids.surfaces)).toHaveLength(Object.keys(SURFACE_COLOUR).length);
  });

  it('spriteSounds maps hits to { src, start, end }', () => {
    expect(spriteSounds({ file: 'a.ogg', hits: [{ start: 0.1, end: 0.2, level: 'heavy' }] })).toEqual([{ src: 'modules/dicer/a.ogg', start: 0.1, end: 0.2 }]);
  });
});

describe('build-dsn-sounds', () => {
  it('maps WebAudio filters to ffmpeg filters', () => {
    expect(ffmpegFilter({ type: 'lowpass', frequency: 3500 })).toBe('lowpass=f=3500');
    expect(ffmpegFilter({ type: 'lowpass', frequency: 900, Q: 0.7 })).toBe('lowpass=f=900:width_type=q:width=0.7');
    expect(ffmpegFilter({ type: 'highshelf', frequency: 4000, gain: 4 })).toBe('highshelf=f=4000:g=4');
    expect(ffmpegFilter({ type: 'peaking', frequency: 220, Q: 1, gain: 4 })).toBe('equalizer=f=220:width_type=q:width=1:g=4');
    expect(() => ffmpegFilter({ type: 'notch', frequency: 1 })).toThrow();
  });

  it('builds a rate, filter and gain chain', () => {
    expect(filterChain({})).toBe('anull');
    expect(filterChain({ rate: 1.15, filters: [{ type: 'highshelf', frequency: 4000, gain: 4 }], db: -4 })).toBe(
      'asetrate=55200,aresample=48000,highshelf=f=4000:g=4,volume=-4dB',
    );
  });

  it('scales hit spans by the playback rate, with the engine margins', () => {
    const [h] = hitSpans([{ start: 1, duration: 0.1, level: 'heavy' }], 2);
    expect(h).toEqual({ start: 0.495, end: 0.565, level: 'heavy' });
  });
});
