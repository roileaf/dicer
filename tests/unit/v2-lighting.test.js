import { readFileSync } from 'node:fs';
import { FloatType, Vector3 } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { bake, directionOf, encodeHdr, OUT, radiance, rgbe, studioPanels } from '../../scripts/bake-studio-hdr.mjs';
import { registerLighting, STUDIO_ENVIRONMENT } from '../../src/v2/lighting.js';

const parse = (buf) => new HDRLoader().setDataType(FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

describe('v2 studio lighting (DsN 5.3)', () => {
  it('registers the studio environment under a dicer id', () => {
    const dice3d = { addEnvironment: vi.fn() };
    expect(registerLighting(dice3d)).toBe('dicer.studio');
    expect(dice3d.addEnvironment).toHaveBeenCalledWith({ id: 'dicer.studio', name: 'DICER.V2.Ambiance.studio', src: 'modules/dicer/assets/lighting/dicer-studio.hdr' });
  });

  it('registers the environment before anything else, synchronously, in diceSoNiceReady', async () => {
    const order = [];
    const dice3d = {
      addEnvironment: () => order.push('environment'),
      addImpactSounds: () => order.push('sounds'),
      addSurface: () => {},
    };
    vi.stubGlobal('Hooks', { once: vi.fn() });
    const { onDiceSoNiceReady } = await import('../../src/v2/main.js');
    expect(onDiceSoNiceReady(dice3d)).toBeUndefined(); // DsN calls the hook with Hooks.call
    expect(order[0]).toBe('environment');
  });

  it('the shipped file is the studio, readable by three`s HDRLoader (what DsN uses)', () => {
    const { width, height, data } = parse(readFileSync(OUT));
    expect([width, height]).toEqual([1024, 512]);
    const at = (u, v) => {
      const i = Math.floor(u * width);
      const j = Math.floor((1 - v) * height); // row 0 is up
      const k = (j * width + i) * 4;
      return [data[k], data[k + 1], data[k + 2]];
    };
    const studio = studioPanels();
    // straight up: the overhead softbox; straight down: the table; toward the key light (-6, 4, 2)
    const up = radiance(new Vector3(0, 1, 0), studio);
    expect(at(0.5, 0.999)[0]).toBeCloseTo(up[0], 1);
    const key = new Vector3(-6, 4, 2).normalize();
    const u = Math.atan2(key.z, key.x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(key.y) / Math.PI + 0.5;
    expect(at(u, v)[0]).toBeGreaterThan(5); // the key is at 10x white
    expect(at(0.5, 0.001)[0]).toBeCloseTo(radiance(new Vector3(0, -1, 0), studio)[0], 1);
  });

  it('directionOf inverts three`s equirect mapping', () => {
    for (const [u, v] of [[0.1, 0.2], [0.7, 0.9], [0.5, 0.5]]) {
      const d = directionOf(u, v);
      expect(d.length()).toBeCloseTo(1, 9);
      expect(Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5).toBeCloseTo(u, 9);
      expect(Math.asin(d.y) / Math.PI + 0.5).toBeCloseTo(v, 9);
    }
  });

  it('round-trips a bake through RGBE within RGBE precision', () => {
    const w = 16;
    const px = bake(w);
    const { data } = parse(encodeHdr(px, w, w / 2));
    for (let i = 0; i < px.length / 3; i++)
      for (let c = 0; c < 3; c++) expect(Math.abs(data[i * 4 + c] - px[i * 3 + c])).toBeLessThanOrEqual(px[i * 3 + c] / 64 + 1e-6);
  });

  it('rgbe keeps the largest mantissa below 256', () => {
    expect(rgbe(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(rgbe(1, 1, 1)).toEqual([128, 128, 128, 129]);
    expect(rgbe(10, 0, 0)[0]).toBeLessThan(256);
  });
});
