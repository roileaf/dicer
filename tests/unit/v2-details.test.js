import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ICON_IDS } from '../../src/look/appearance.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { createBodyMaterial, patchBodyShader, bodyGlsl } from '../../src/v2/materials/bodies.js';
import {
  applyDetailSettings,
  DETAIL_DEFAULTS,
  detailUniforms,
  faceDataOf,
  GLOW_INK,
  INKS,
  LIFT,
  MAX_FACES,
  setFaceUniforms,
  STRIP_WIDTH_MAX,
  STRIPS,
} from '../../src/v2/materials/details.js';
import {
  createResinMaterial,
  lookOf,
  patchResinShader,
  resinGlsl,
} from '../../src/v2/materials/resin.js';
import {
  conditionCss,
  dicerMaterialClass,
  labelCss,
} from '../../src/v2/materials/settings-window.js';
import { dsnAppearance, dsnLook } from '../../src/v2/themes/dsn-look.js';
import {
  FONTS,
  fontFamilyOf,
  ICONS,
  preloadFonts,
  registerFonts,
} from '../../src/v2/themes/fonts.js';
import {
  iconChar,
  iconCombos,
  iconLabels,
  iconPackFont,
  iconPackOf,
  iconsOf,
  iconSystemId,
  registerIconSystems,
} from '../../src/v2/themes/icons.js';
import { DiceMaterial, DiceSystem } from '../helpers/dsn-api.js';

const theme = (id) => BUILTIN_THEMES.find((t) => t.id === id);
const physical = () => ({
  uniforms: {},
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
});

function chamferedBox(size = 2, cut = 0.1) {
  const h = size / 2;
  const box = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const p = box.attributes.position;
  const tris = [];
  for (let i = 0; i < p.count; i++) tris.push(p.getX(i), p.getY(i), p.getZ(i));
  tris.push(h + cut, h, 0, h, h + cut, 0, h + cut / 2, h + cut / 2, cut);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  return g;
}

describe('v2 die faces and edges from DsN`s geometry', () => {
  it('finds the faces of a die and leaves its bevels out', () => {
    const data = faceDataOf(chamferedBox());
    expect(data.normals.length).toBe(6);
    const r = Math.sqrt(3);
    expect(data.inradius).toBeCloseTo(1 / r, 4);
    expect(data.faceInradius).toBeCloseTo(1 / r, 4);
    for (const n of data.normals) expect(Math.hypot(...n)).toBeCloseTo(1, 5);
  });

  it('reads a geometry once, and gives nothing for a die it cannot read', () => {
    const g = chamferedBox();
    expect(faceDataOf(g)).toBe(faceDataOf(g));
    expect(faceDataOf(null).normals).toEqual([]);
    expect(faceDataOf({}).normals).toEqual([]);
    const ball = new THREE.IcosahedronGeometry(1, 2);
    expect(faceDataOf(ball).normals.length).toBe(0);
  });

  it('hands the faces of the drawn die to its material', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    applyDetailSettings(mat, {});
    const u = mat.userData.uniforms;
    expect(u.uDcFaces.value.length).toBe(MAX_FACES);
    expect(u.uDcFaceCount.value).toBe(0);
    setFaceUniforms(u, new THREE.IcosahedronGeometry(1, 0));
    expect(u.uDcFaceCount.value).toBe(20);
    expect(u.uDcFaceGeo.value.x).toBeCloseTo(0.7947, 3);
    setFaceUniforms(u, chamferedBox());
    expect(u.uDcFaceCount.value).toBe(6);
    expect(() => setFaceUniforms({}, chamferedBox())).not.toThrow();
  });
});

describe('v2 number inks, number glow and edge strips', () => {
  it('has v1`s seven inks and four strip styles', () => {
    expect(Object.keys(INKS)).toEqual([
      'paint',
      'gold',
      'silver',
      'enamel',
      'outline',
      'holo',
      'glow',
    ]);
    expect(Object.keys(STRIPS)).toEqual(['body', 'paint', 'metal', 'glow']);
  });

  it('leaves a die as it was with no settings: paint numbers, no glow, no strip, no lift', () => {
    const u = detailUniforms();
    expect(u.uDcInk.toArray()).toEqual([0, 0.6, 0, 0]);
    expect(u.uDcInkGlow).toBe(0);
    expect(u.uDcHalo.toArray()).toEqual([0, 0, 0]);
    expect(u.uDcHollow.w).toBe(0);
    expect(u.uDcStrip.w).toBe(0);
    expect(u.uDcStripWidth).toBe(0);
    expect(u.uDcLift.toArray()).toEqual([1, 1, 1]);
  });

  it('turns the settings into the ink, the glow and the strip', () => {
    const gold = detailUniforms({ ink: 'gold' });
    expect(gold.uDcInk.toArray()).toEqual([1, 0.3, 0, 0]);
    expect(detailUniforms({ ink: 'holo' }).uDcInk.w).toBe(1);
    expect(detailUniforms({ ink: 'enamel' }).uDcInk.z).toBe(1);
    expect(detailUniforms({ ink: 'glow', inkGlow: 50 }).uDcInkGlow).toBeCloseTo(GLOW_INK / 2);
    expect(detailUniforms({ ink: 'gold', inkGlow: 300 }).uDcInkGlow).toBe(0);
    const halo = detailUniforms({ glowColor: '#ff0000', glowIntensity: 200 }).uDcHalo;
    expect(halo.toArray()).toEqual([2, 0, 0]);
    const strip = detailUniforms({
      strip: 'glow',
      stripColor: '#ffffff',
      stripStrength: 50,
      stripWidth: 40,
    });
    expect(strip.uDcStrip.toArray()).toEqual([1, 1, 1, 0.5]);
    expect(strip.uDcStripPBR.z).toBe(1);
    expect(strip.uDcStripWidth).toBeCloseTo(STRIP_WIDTH_MAX * 0.4);
    expect(detailUniforms({ strip: 'metal' }).uDcStripPBR.toArray()).toEqual([1, 0.25, 0]);
    expect(
      detailUniforms({ ink: 'nope', strip: 'nope', glowColor: 'red' }).uDcInk.toArray(),
    ).toEqual([0, 0.6, 0, 0]);
  });

  it('hollows outline numbers by the colour DsN painted them in', () => {
    const u = detailUniforms({ ink: 'outline' }, '#ffffff');
    expect(u.uDcHollow.toArray()).toEqual([1, 1, 1, 1]);
    expect(detailUniforms({ ink: 'outline' }).uDcHollow.w).toBe(0);
    expect(detailUniforms({ ink: 'gold' }, '#ffffff').uDcHollow.w).toBe(0);
    const mat = new THREE.MeshPhysicalMaterial();
    applyDetailSettings(mat, { ink: 'outline' }, { foreground: '#ff0000' });
    expect(mat.userData.uniforms.uDcHollow.value.toArray()).toEqual([1, 0, 0, 1]);
  });

  it('gives enamel its gloss on a body with no clearcoat', () => {
    const mat = new THREE.MeshPhysicalMaterial({ clearcoat: 0 });
    applyDetailSettings(mat, { ink: 'gold' });
    expect(mat.clearcoat).toBe(0);
    applyDetailSettings(mat, { ink: 'enamel' });
    expect(mat.clearcoat).toBeGreaterThan(0);
  });

  it('lifts gem, wood and metal for DsN`s tone mapping, and no other body', () => {
    expect(Object.keys(LIFT)).toEqual(['gem', 'wood', 'metal']);
    const mat = new THREE.MeshPhysicalMaterial();
    applyDetailSettings(mat, {}, null, 'gem');
    expect(mat.userData.uniforms.uDcLift.value.toArray()).toEqual(LIFT.gem);
    applyDetailSettings(mat, {}, null, 'pearl');
    expect(mat.userData.uniforms.uDcLift.value.toArray()).toEqual([1, 1, 1]);
  });

  it('offers the settings on every Dicer material, with a uniform for each', () => {
    for (const material of [
      createBodyMaterial(DiceMaterial, 'opaque'),
      createResinMaterial(DiceMaterial, 'resin'),
      createResinMaterial(DiceMaterial, 'jelly'),
    ]) {
      const ids = material.settings.map((s) => s.id);
      for (const id of Object.keys(DETAIL_DEFAULTS)) expect(ids, material.id).toContain(id);
      for (const name of Object.keys(detailUniforms()))
        expect(material._uniforms.has(name), name).toBe(true);
    }
    const ink = createBodyMaterial(DiceMaterial, 'opaque').settings.find((s) => s.id === 'ink');
    expect(Object.keys(ink.options)).toEqual(Object.keys(INKS));
    expect(ink.options.holo).toBe('DICER.Appearance.Fill.holo');
  });

  it('splices the face data, inks and strips into body and resin shaders', () => {
    const body = patchBodyShader(physical(), bodyGlsl('wood')).fragmentShader;
    const resin = patchResinShader(physical(), resinGlsl(lookOf('resin', {}))).fragmentShader;
    for (const f of [body, resin]) {
      expect(f).toContain(`uniform vec3 uDcFaces[ ${MAX_FACES} ];`);
      expect(f).toContain('#define vEdgeDist dcEdgeV');
      expect(f).toContain('#define vFaceId dcFaceV');
      expect(f.indexOf('dcFaceInfo( vLocalPos );')).toBeLessThan(f.indexOf('float dcMask = 0.0;'));
      expect(f).toContain('metalnessFactor = mix( metalnessFactor, uDcInk.x, dcMask );');
      expect(f).toContain('roughnessFactor = mix( roughnessFactor, uDcStripPBR.y, dcEdge );');
      expect(f).toContain('uDcStrip.rgb * dcEdge * uDcStripPBR.z');
      expect(f).toContain('material.clearcoat = max( material.clearcoat, uDcInk.z * dcMask );');
      expect(f).not.toContain('#define vEdgeDist 1.0');
    }
    expect(resin).toContain('vec3 dcEdgeLit = totalDiffuse;');
    expect(resin).toContain('totalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );');
  });
});

describe('v2 themes carry their numbers, edges and fonts to DsN', () => {
  it('maps each v1 font to a font family Dicer ships', () => {
    expect(Object.keys(FONTS)).toEqual([
      'serif',
      'sans',
      'blackletter',
      'norse',
      'uncial',
      'scifi',
      'handwritten',
      'deco',
    ]);
    expect(fontFamilyOf('blackletter')).toBe('Dicer Blackletter');
    expect(fontFamilyOf('css:Georgia')).toBe('auto');
    for (const t of BUILTIN_THEMES) expect(dsnLook(t.appearance).font, t.id).toMatch(/^Dicer /);
  });

  it('adds the fonts to the page without loading them, then loads them in the background', async () => {
    const fonts = { add: vi.fn() };
    const loaded = [];
    class Face {
      constructor(family, src) {
        Object.assign(this, { family, src });
      }
      load() {
        loaded.push(this.family);
        return this.family === 'Dicer Deco'
          ? Promise.reject(new Error('gone'))
          : Promise.resolve(this);
      }
    }
    const faces = registerFonts({ fonts, FontFace: Face, route: (p) => `/base/${p}` });
    expect(faces.length).toBe(Object.keys(FONTS).length + 1);
    expect(fonts.add).toHaveBeenCalledTimes(faces.length);
    expect(loaded).toEqual([]);
    expect(faces[5].src).toBe('url("/base/modules/dicer/assets/fonts/Orbitron%5Bwght%5D.ttf")');
    expect(faces.at(-1).family).toBe(ICONS.family);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await preloadFonts(faces);
    expect(loaded.length).toBe(faces.length);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(registerFonts({ fonts: null })).toEqual([]);
  });

  it('carries the ink, the number glow and the edge strip of a theme', () => {
    const edge = dsnLook(theme('edgelight').appearance);
    expect(edge.materialSettings).toMatchObject({
      ink: 'glow',
      inkGlow: 100,
      glowColor: '#ffffff',
      strip: 'glow',
      stripColor: '#ffffff',
      stripStrength: 100,
      stripWidth: 40,
    });
    expect(dsnLook(theme('gold-polished').appearance).materialSettings.ink).toBe('enamel');
    expect(dsnLook(theme('rare-shiny').appearance).materialSettings.ink).toBe('holo');
    expect('strip' in dsnLook(theme('gold-polished').appearance).materialSettings).toBe(false);
  });

  it('draws outline numbers as DsN`s label outline around numbers in the body colour', () => {
    const look = dsnLook(theme('against-the-grain').appearance);
    expect(look.materialSettings.ink).toBe('outline');
    expect(look.labelColor).toBe(theme('against-the-grain').appearance.body.color);
    expect(look.outlineColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(dsnLook(theme('gold-polished').appearance).outlineColor).toBe('none');
  });
});

describe('v2 d20 icons as DsN dice systems', () => {
  it('reads a look`s icons, and names a system for each icon pair, font and mesh', () => {
    expect(iconsOf(theme('jelly-belly').appearance)).toEqual({ crit: 'heart', fumble: null });
    expect(iconsOf(theme('gold-polished').appearance)).toBeNull();
    expect(iconsOf({ numbers: { icons: { crit: 'nope' } } })).toBeNull();
    expect(iconPackOf(theme('jelly-belly').appearance)).toEqual({
      crit: 'heart',
      fumble: null,
      font: 'blackletter',
      rounded: true,
    });
    expect(iconPackOf(theme('gold-polished').appearance)).toBeNull();
    expect(iconSystemId({ crit: 'heart', fumble: null, font: 'blackletter', rounded: true })).toBe(
      'dicer-icons-heart-none-blackletter',
    );
    expect(iconSystemId({ crit: null, fumble: 'skull', font: 'serif', rounded: false })).toBe(
      'dicer-icons-none-skull-serif-sharp',
    );
    const odd = {
      numbers: { icons: { crit: 'heart' }, font: 'css:Georgia' },
      edges: { radius: 0 },
    };
    expect(iconPackOf(odd)).toMatchObject({ font: 'serif', rounded: false });
  });

  it('puts the crit icon on the 20 and the fumble icon on the 1, as the icon font`s characters', () => {
    const labels = iconLabels({ crit: 'heart', fumble: 'skull' });
    expect(labels.length).toBe(20);
    expect(labels[19]).toBe(iconChar('heart'));
    expect(labels[0]).toBe(iconChar('skull'));
    expect(labels[9]).toBe('10');
    expect(iconChar(ICON_IDS[0]).charCodeAt(0)).toBe(0xe000);
    expect(iconLabels({ crit: 'flame', fumble: null })[0]).toBe('1');
  });

  it('gives every icon pack a font that has the icons, so it reads with any look', () => {
    expect(iconPackFont({ font: 'uncial' })).toBe('Dicer Uncial, Dicer Icons');
    const dice3d = { addSystem: vi.fn(), addDicePreset: vi.fn() };
    const ids = registerIconSystems(dice3d, DiceSystem, BUILTIN_THEMES, (k) => k);
    expect(ids.sort()).toEqual([
      'dicer-icons-flame-none-uncial',
      'dicer-icons-heart-none-blackletter',
      'dicer-icons-none-skull-serif',
      'dicer-icons-starburst-none-serif',
      'dicer-icons-starburst-none-uncial',
    ]);
    expect(iconCombos().length).toBe(5);
    for (const [preset] of dice3d.addDicePreset.mock.calls) {
      expect(preset.type).toBe('d20');
      expect(preset.labels.length).toBe(20);
      expect(preset.font).toMatch(/^Dicer \w+, Dicer Icons$/);
      expect(ids).toContain(preset.system);
    }
    const [system] = dice3d.addSystem.mock.calls[0];
    expect(system).toBeInstanceOf(DiceSystem);
    expect(system.group).toBe('Dicer');
    expect(system.mesh).toBe('rounded');
    expect(system.name).toMatch(
      /^DICER\.V2\.Icons: DICER\.Appearance\.Icon\.\w+ \(DICER\.Appearance\.FontKind\.\w+\)$/,
    );
  });

  it('gives a theme with icons a d20 part on its pack, and changes nothing else', () => {
    const jelly = dsnAppearance(theme('jelly-belly'));
    expect(jelly.d20.system).toBe('dicer-icons-heart-none-blackletter');
    expect(jelly.global.system).toBe('rounded');
    expect({ ...jelly.d20, system: 'rounded' }).toEqual(jelly.global);
    expect('d20' in dsnAppearance(theme('gold-polished'))).toBe(false);
  });
});

describe('v2 material settings window: Dicer`s own layout inside DsN`s dialog', () => {
  const resin = () => createResinMaterial(DiceMaterial, 'resin');
  const content = (material) =>
    material._buildSettingsContent('d20', {}, 'materialSettings', 'data-materialSettings');

  it('extends DsN`s material class once, and every Dicer material uses it', () => {
    const cls = dicerMaterialClass(DiceMaterial);
    expect(dicerMaterialClass(DiceMaterial)).toBe(cls);
    expect(Object.getPrototypeOf(cls)).toBe(DiceMaterial);
    expect(resin()).toBeInstanceOf(cls);
    expect(createBodyMaterial(DiceMaterial, 'wood')).toBeInstanceOf(cls);
    expect(createResinMaterial(DiceMaterial, 'jelly')).toBeInstanceOf(DiceMaterial);
  });

  it('keeps DsN`s wrapper and a field per setting, so DsN reads the values back', () => {
    const material = resin();
    const { content: html, data } = content(material);
    expect(html.startsWith('<div data-materialSettings="dicer.body-resin" class="dicer-ms">')).toBe(
      true,
    );
    for (const s of material.settings.filter((x) => x.id)) {
      expect(html, s.id).toContain(`name="appearance[d20][materialSettings][${s.id}]"`);
      expect(html, s.id).toContain(`<div class="dicer-ms-row" data-setting="${s.id}">`);
      expect(data[s.id].name).toBe(`appearance[d20][materialSettings][${s.id}]`);
    }
    expect(Object.keys(data).length).toBe(material.settings.filter((x) => x.id).length);
  });

  it('puts the settings in a titled section per separator, hints included', () => {
    const html = content(resin()).content;
    expect(html.match(/<fieldset class="dicer-ms-section">/g).length).toBe(6);
    expect(html.match(/<\/fieldset>/g).length).toBe(6);
    expect(html).toContain('<legend>DICER.Appearance.Section.inside</legend>');
    expect(html).toContain('<p class="hint">DICER.Appearance.Glow.Hint</p>');
    expect(html.indexOf('data-setting="shape"')).toBeLessThan(
      html.indexOf('DICER.V2.Material.Suspended'),
    );
  });

  it('shows a control only with the choice it belongs to, by CSS alone', () => {
    const css = conditionCss('dicer.body-resin', [
      { row: 'shape', parent: 'inside', values: ['shape'], show: true },
      { row: 'stripColor', parent: 'strip', values: ['body'], show: false },
      { row: 'color2', parent: 'glow', values: [true], show: true },
    ]);
    const root = '[data-materialsettings="dicer.body-resin"]';
    expect(css).toContain(`${root} .dicer-ms-row[data-setting="shape"]{display:none}`);
    expect(css).toContain(
      `${root}:has(select[name$="[inside]"] option[value="shape"]:checked) .dicer-ms-row[data-setting="shape"]{display:block}`,
    );
    expect(css).toContain(
      `${root}:has(select[name$="[strip]"] option[value="body"]:checked) .dicer-ms-row[data-setting="stripColor"]{display:none}`,
    );
    expect(css).toContain(
      `${root}:has(input[name$="[glow]"]:checked) .dicer-ms-row[data-setting="color2"]{display:block}`,
    );
  });

  it('shows metal`s second colour only for the aged finishes, as v1 does', () => {
    const metal = createBodyMaterial(DiceMaterial, 'metal');
    expect(metal._conditions[0]).toEqual({
      row: 'color2',
      parent: 'finish',
      values: ['patina', 'worn'],
      show: true,
    });
    expect(
      createBodyMaterial(DiceMaterial, 'wood')._conditions.some((c) => c.row === 'color2'),
    ).toBe(false);
  });

  it('calls the main inside colour the iris colour for the Eye inside', () => {
    const material = resin();
    expect(material._labels).toEqual([
      {
        row: 'insideColor',
        label: 'DICER.Appearance.Inside.IrisColor',
        parent: 'inside',
        values: ['eye'],
      },
    ]);
    const html = content(material).content;
    expect(html).toContain(
      '<label><span class="dicer-ms-main">DICER.Appearance.Inside.MainColor</span><span class="dicer-ms-alt">DICER.Appearance.Inside.IrisColor</span></label>',
    );
    const css = labelCss('dicer.body-resin', material._labels);
    const root = '[data-materialsettings="dicer.body-resin"]';
    const picked = `${root}:has(select[name$="[inside]"] option[value="eye"]:checked) .dicer-ms-row[data-setting="insideColor"]`;
    expect(css).toContain(`${root} .dicer-ms-alt{display:none}`);
    expect(css).toContain(`${picked} .dicer-ms-alt{display:inline}`);
    expect(css).toContain(`${picked} .dicer-ms-main{display:none}`);
    expect(labelCss('x', [])).toBe('');
  });

  it('declares what depends on what, for settings the material has', () => {
    for (const material of [
      resin(),
      createResinMaterial(DiceMaterial, 'jelly'),
      createBodyMaterial(DiceMaterial, 'metal'),
    ]) {
      const ids = material.settings.map((s) => s.id);
      for (const c of material._conditions) {
        expect(ids, `${material.id} ${c.row}`).toContain(c.row);
        expect(ids, `${material.id} ${c.parent}`).toContain(c.parent);
      }
    }
    const rows = (m) =>
      m._conditions.map((c) => `${c.show ? '+' : '-'}${c.row}@${c.parent}=${c.values}`);
    expect(rows(resin())).toEqual([
      '+shape@inside=shape',
      '+inclusion@inside=botanical',
      '+bubble@inside=liquid',
      '+sand@inside=liquid',
      '-insideColor@inside=none',
      '-insideColor2@inside=none',
      '-density@inside=none',
      '-motion@inside=none',
      '-extraColor@extra=none',
      '-extraDensity@extra=none',
      '+inkGlow@ink=glow',
      '-stripColor@strip=body',
      '-stripStrength@strip=body',
      '-stripWidth@strip=body',
    ]);
    expect(rows(createResinMaterial(DiceMaterial, 'jelly'))[0]).toBe('+color2@glow=true');
    expect(content(resin()).content).toContain('<style>[data-materialsettings="dicer.body-resin"]');
  });
});
