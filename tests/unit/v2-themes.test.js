import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { BODY_TYPES, createBodyMaterial } from '../../src/v2/materials/bodies.js';
import { createResinMaterial, RESIN_TYPES } from '../../src/v2/materials/resin.js';
import { matching, themeInUse, useTheme } from '../../src/v2/themes/browser.js';
import { dsnAppearance, dsnLook, materialSettingsOf } from '../../src/v2/themes/dsn-look.js';
import { pictureQueue, pictureSize, themePicture } from '../../src/v2/themes/pictures.js';
import { DiceMaterial } from '../helpers/dsn-api.js';

const theme = (id) => BUILTIN_THEMES.find((t) => t.id === id);
const MATERIALS = new Map(
  [
    ...BODY_TYPES.map((t) => createBodyMaterial(DiceMaterial, t)),
    ...RESIN_TYPES.map((t) => createResinMaterial(DiceMaterial, t)),
  ].map((m) => [m.id, m]),
);

describe('v2 themes as DsN looks (DsN 5.9)', () => {
  it('sets every field of a DsN appearance part, so a theme never mixes with the player`s look', () => {
    for (const t of BUILTIN_THEMES)
      for (const part of Object.values(dsnAppearance(t))) {
        expect(Object.keys(part).sort()).toEqual([
          'colorset',
          'diceColor',
          'edgeColor',
          'font',
          'labelColor',
          'material',
          'materialSettings',
          'outlineColor',
          'system',
          'texture',
        ]);
        expect(part.colorset).toBe('custom');
        expect(part.diceColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(part.labelColor).toMatch(/^#[0-9a-f]{6}$/);
      }
  });

  it('gives every built-in theme a registered Dicer material, with settings that material has', () => {
    for (const t of BUILTIN_THEMES)
      for (const part of Object.values(dsnAppearance(t))) {
        const material = MATERIALS.get(part.material);
        expect(material, `${t.id}: ${part.material}`).toBeDefined();
        const known = Object.fromEntries(material.settings.map((s) => [s.id, s]));
        for (const [id, value] of Object.entries(part.materialSettings)) {
          expect(known[id], `${t.id}: ${part.material} has no setting ${id}`).toBeDefined();
          if (known[id].options)
            expect(Object.keys(known[id].options), `${t.id}: ${id}`).toContain(value);
          if (known[id].type === 'range') expect(value).toBeGreaterThanOrEqual(0);
        }
      }
  });

  it('maps the body, its style and its inside', () => {
    expect(dsnLook(theme('verdant').appearance)).toMatchObject({
      material: 'dicer.body-gem',
      diceColor: '#1f8a5a',
      materialSettings: { preset: 'malachite', color2: '#0a3a24' },
    });
    const storm = materialSettingsOf(theme('stormcaller').appearance);
    expect(storm).toMatchObject({
      inside: 'nebula',
      insideColor: '#6cf0ff',
      insideColor2: '#7a5cff',
      density: 70,
      roughness: 4,
    });
    expect(materialSettingsOf(theme('olympus-heights').appearance)).toMatchObject({
      finish: 'patina',
      roughness: 47,
    });
    expect(materialSettingsOf(theme('silver-brushed').appearance).finish).toBe('polished');
    expect(dsnLook(theme('jelly-belly').appearance).material).toBe('dicer.body-jelly');
  });

  it('gives a theme`s own die types their part', () => {
    const a = dsnAppearance(theme('celestial'));
    expect(a.global.material).toBe('dicer.body-pearl');
    expect(a.d20).toMatchObject({
      material: 'dicer.body-resin',
      diceColor: '#0a1030',
      materialSettings: { inside: 'shape', extra: 'glitter' },
    });
    expect(Object.keys(dsnAppearance(theme('obsidian')))).toEqual(['global']);
  });
});

describe('v2 theme pictures (DsN 5.9)', () => {
  it('asks DsN for the die in the theme`s look, at the screen`s pixel size', async () => {
    const dice3d = { renderDieImage: vi.fn(async () => 'data:image/webp;base64,AAAA') };
    expect(pictureSize(96, 1.5)).toBe(144);
    expect(await themePicture(theme('verdant'), 'd12', 96, dice3d)).toBe(
      'data:image/webp;base64,AAAA',
    );
    expect(dice3d.renderDieImage).toHaveBeenCalledWith('d12', dsnAppearance(theme('verdant')), {
      size: pictureSize(96),
    });
  });

  it('has no picture when the 3D dice are hidden or DsN fails, without throwing', async () => {
    expect(
      await themePicture(theme('verdant'), 'd20', 96, { renderDieImage: async () => null }),
    ).toBeNull();
    expect(await themePicture(theme('verdant'), 'd20', 96, {})).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await themePicture(theme('verdant'), 'd20', 96, {
        renderDieImage: async () => {
          throw new Error('empty die picture');
        },
      }),
    ).toBeNull();
    warn.mockRestore();
  });

  it('draws a list one picture at a time, in order, and stops between two pictures', async () => {
    const asked = [];
    let release;
    const picture = (t, die) => {
      asked.push(`${t}:${die}`);
      return new Promise((r) => (release = () => r(`url-${t}`)));
    };
    const shown = [];
    const stop = pictureQueue(
      [
        ['a', 'd20', 96],
        ['b', 'd20', 96],
        ['c', 'd20', 96],
      ],
      (job, url) => shown.push(url),
      picture,
    );
    await Promise.resolve();
    expect(asked).toEqual(['a:d20']);
    release();
    await new Promise((r) => setTimeout(r));
    expect(shown).toEqual(['url-a']);
    expect(asked).toEqual(['a:d20', 'b:d20']);
    stop();
    release();
    await new Promise((r) => setTimeout(r));
    expect(shown).toEqual(['url-a']);
    expect(asked).toEqual(['a:d20', 'b:d20']);
  });
});

describe('v2 theme browser', () => {
  const user = () => {
    const flags = {};
    return {
      id: 'u1',
      flags,
      getFlag: (scope, key) => flags[`${scope}.${key}`],
      setFlag: vi.fn(async (scope, key, value) => void (flags[`${scope}.${key}`] = value)),
      unsetFlag: vi.fn(async (scope, key) => void delete flags[`${scope}.${key}`]),
    };
  };

  it('saves a theme as the player`s DsN look, as DsN`s own window does', async () => {
    const u = user();
    u.flags['dice-so-nice.appearance'] = {
      global: { material: 'metal' },
      d6: { colorset: 'fire' },
    };
    u.flags['dice-so-nice.saved'] = { appearance: false, sfx: true };
    const socket = { emit: vi.fn() };
    await useTheme(theme('verdant'), u, socket);
    expect(u.unsetFlag).toHaveBeenCalledWith('dice-so-nice', 'appearance');
    expect(u.flags['dice-so-nice.appearance']).toEqual(dsnAppearance(theme('verdant')));
    expect(u.flags['dice-so-nice.saved']).toEqual({ appearance: true, sfx: true });
    expect(socket.emit).toHaveBeenCalledWith('module.dice-so-nice', { type: 'update', user: 'u1' });
  });

  it('knows which theme the player uses, until they change their look', async () => {
    const u = user();
    expect(themeInUse(u.getFlag('dice-so-nice', 'appearance'))).toBeNull();
    await useTheme(theme('celestial'), u, null);
    const saved = JSON.parse(JSON.stringify(u.getFlag('dice-so-nice', 'appearance')));
    expect(themeInUse(saved)).toBe('celestial');
    saved.global.diceColor = '#123456';
    expect(themeInUse(saved)).toBeNull();
  });

  it('searches by name', () => {
    expect(matching(BUILTIN_THEMES, '  ').length).toBe(BUILTIN_THEMES.length);
    expect(matching(BUILTIN_THEMES, 'MOON').map((t) => t.id)).toEqual(['pearl-moon', 'blood-moon']);
  });
});
