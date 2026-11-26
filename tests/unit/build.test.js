import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const jsFiles = () => readdirSync('dist').filter((f) => f.endsWith('.js'));

describe('build (v2)', () => {
  beforeAll(() => execSync('node node_modules/vite/bin/vite.js build', { stdio: 'pipe' }), 120000);

  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });

  it('declares Dice So Nice as a required module', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.relationships.requires).toContainEqual({ id: 'dice-so-nice', type: 'module' });
  });

  it('bundles no copy of three.js and imports DsN files by relative paths', () => {
    for (const f of jsFiles()) {
      const code = readFileSync(`dist/${f}`, 'utf8');
      expect(code).not.toMatch(/REVISION\s*=\s*["']\d+/);
      expect(code).not.toMatch(/from\s*["']three["']/);
      for (const m of code.matchAll(/from\s*["']([^"']*dice-so-nice[^"']*)["']/g)) expect(m[1]).toMatch(/^\.\.\/\.\.\/dice-so-nice\//);
    }
  });

  it('ships every sound sprite the entry registers', async () => {
    const { SOUND_SPRITES } = await import('../../src/v2/sounds/manifest.js');
    for (const group of [SOUND_SPRITES.dice, SOUND_SPRITES.table])
      for (const { file } of Object.values(group)) expect(statSync(file).size).toBeGreaterThan(1000);
  });
});
