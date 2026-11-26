import { Color, Vector3 } from 'three';
import { ELEMENTS } from '../../effects/elements.js';
import { BURSTS } from '../../effects/library/bursts.js';
import { CATALOGUE } from '../../effects/library/catalogue.js';
import { DIE_EFFECTS } from '../../effects/library/die-effects.js';
import { localScaleOf } from '../materials/bodies.js';
import { reducedMotion, stageOf, TIER } from './stage.js';

export const EFFECTS = Object.freeze({ ...DIE_EFFECTS, ...CATALOGUE, ...BURSTS });
export const TRAIL_ID = 'DicerTrail';
export const SPARKS_ID = 'DicerImpactSparks';
export const sfxId = (id) => `Dicer.${id}`;

const ROLE_DAMAGE = Object.freeze({ ice: 'cold' });
const TRAIL_REST_MS = 600;
const TRAIL_MAX_MS = 12000;
const SPARKS_MS = 450;
const SHAKE_PX = 6;

const motions = new WeakMap();

const SPEED_REST_S = 0.1;
export const SPARK_GAIN = 1.8;

export function trackSpeed({ dice, delta }) {
  const p = dice?.parent?.position;
  if (!p || !(delta > 0)) return;
  const m = motions.get(dice);
  if (!m) {
    motions.set(dice, { at: p.clone(), speed: 0, before: 0, elapsed: 0 });
    return;
  }
  m.elapsed += delta;
  const moved = m.at.distanceTo(p);
  if (moved > 0) {
    m.before = m.speed;
    m.speed = moved / m.elapsed;
    m.elapsed = 0;
    m.at.copy(p);
  } else if (m.elapsed > SPEED_REST_S) {
    m.before = 0;
    m.speed = 0;
  }
}

export function speedOf(dicemesh) {
  const m = motions.get(dicemesh);
  return m ? Math.max(m.speed, m.before) : 0;
}

export function damageTypeOf(dicemesh) {
  const role = dicemesh?.die?.role;
  if (typeof role !== 'string' || role === 'basic') return null;
  return ROLE_DAMAGE[role] ?? role;
}

export function v1Die(dicemesh, stage, { real = false } = {}) {
  const position = new Vector3();
  const world = new Vector3();
  const sync = () => stage.toStage((dicemesh.parent ?? dicemesh).getWorldPosition(world), position);
  sync();
  const radius = 1 / localScaleOf(dicemesh.geometry) / stage.scale;
  const proxy = {
    isMesh: true,
    geometry: { boundingSphere: { radius } },
    updateWorldMatrix() {},
    getWorldScale: (v) => v.set(1, 1, 1),
  };
  const outer = {
    position,
    get visible() {
      return dicemesh.visible;
    },
    set visible(v) {
      dicemesh.visible = v;
    },
    get parent() {
      return stage.group;
    },
    traverse: (fn) => fn(proxy),
  };
  return {
    outer,
    inner: real ? dicemesh : proxy,
    type: dicemesh.die?.type,
    value: dicemesh.die?.result,
    damageType: damageTypeOf(dicemesh),
    appearance: null,
    trail: 1,
    sync,
  };
}

export function fxUniforms(dicemesh) {
  if (!dicemesh.material?.userData?.uniforms?.uFxTint) return null;
  return dicemesh.die?.isolateMaterial()?.userData.uniforms ?? null;
}

export function shake(box, amount, ms) {
  const canvas = box?.renderer?.domElement;
  const amp = SHAKE_PX * Math.min(1, Math.max(0, Number(amount) || 0));
  if (!canvas?.animate || !(amp > 0) || !(ms > 0) || reducedMotion()) return;
  const frames = [];
  const n = Math.max(4, Math.round(ms / 40));
  const seed = Math.random() * 6.283;
  for (let i = 0; i <= n; i++) {
    const k = 1 - i / n;
    const a = amp * k * k * Math.sin(i * 3.6 + seed);
    const dir = i * 0.9 + seed * 1.7;
    frames.push({
      translate: `${(a * Math.cos(dir)).toFixed(2)}px ${(a * Math.sin(dir)).toFixed(2)}px`,
    });
  }
  frames[n] = { translate: '0px 0px' };
  canvas.animate(frames, { duration: ms });
}

export function effectContext(sfx, mod, stage, die) {
  const d = mod.defaults ?? {};
  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  return {
    scene: stage.group,
    camera: sfx.box.camera,
    die,
    position: die.outer.position.clone(),
    color: new Color(d.color ?? '#ffffff'),
    intensity: num(d.intensity, 1),
    duration: Math.max(0, num(d.duration, 1000)),
    options: {},
    get particles() {
      return stage.particles;
    },
    tier: TIER,
    isolate: (target) => (target === die ? fxUniforms(sfx.dicemesh) : null),
    shake: (amount, ms) => shake(sfx.box, amount, ms),
    reducedMotion: reducedMotion(),
    setting: () => undefined,
    box: null,
  };
}

export function effectClass(DiceSFX, mod, name) {
  return class extends DiceSFX {
    static id = sfxId(mod.id);
    static specialEffectName = name;

    async play() {
      this.stage = stageOf(this.box);
      const die = v1Die(this.dicemesh, this.stage, { real: Object.hasOwn(DIE_EFFECTS, mod.id) });
      try {
        this.handle = mod.start(effectContext(this, mod, this.stage, die));
      } catch (err) {
        console.warn(`dicer: effect "${mod.id}" failed to start`, err);
        this.handle = null;
      }
      if (typeof this.handle?.update === 'function') return true;
      this.destroyed = true;
      return false;
    }

    render() {
      const now = performance.now();
      this.stage.tick(now);
      let alive = false;
      try {
        alive = this.handle?.update(now) === true;
      } catch (err) {
        console.warn(`dicer: effect "${mod.id}" failed`, err);
      }
      if (!alive) this.destroy();
    }

    destroy() {
      const handle = this.handle;
      this.handle = null;
      try {
        handle?.stop?.();
      } catch (err) {
        console.warn(`dicer: effect "${mod.id}" failed to stop`, err);
      }
      this.destroyed = true;
    }
  };
}

export function trailClass(DiceSFX, name) {
  return class extends DiceSFX {
    static id = TRAIL_ID;
    static specialEffectName = name;

    async play() {
      this.stage = stageOf(this.box);
      this.die = v1Die(this.dicemesh, this.stage);
      if (!this.die.damageType || reducedMotion()) {
        this.destroyed = true;
        return false;
      }
      this.dice = [this.die];
      this.t0 = performance.now();
      this.movedAt = this.t0;
      this.last = this.die.outer.position.clone();
      return true;
    }

    render() {
      const now = performance.now();
      this.die.sync();
      if (this.die.outer.position.distanceToSquared(this.last) > 1e-6) {
        this.movedAt = now;
        this.last.copy(this.die.outer.position);
        this.stage.trailFx.flight(this.dice, now);
      }
      this.stage.tick(now);
      if (now - this.movedAt > TRAIL_REST_MS || now - this.t0 > TRAIL_MAX_MS) this.destroyed = true;
    }

    destroy() {
      this.destroyed = true;
    }
  };
}

export function sparksClass(DiceSFX, name) {
  return class extends DiceSFX {
    static id = SPARKS_ID;
    static specialEffectName = name;

    async play() {
      const hit = this.hit;
      if (!hit?.position || hit.kind !== 'table' || reducedMotion()) {
        this.destroyed = true;
        return false;
      }
      this.stage = stageOf(this.box);
      const speed = (SPARK_GAIN * speedOf(this.dicemesh)) / this.stage.scale;
      if (!(speed >= this.stage.impactFx.minSpeed)) {
        this.destroyed = true;
        return false;
      }
      this.t0 = performance.now();
      this.stage.impactFx.impact({
        speed,
        position: this.stage.toStage(hit.position),
        dieKey: this.dicemesh.id,
      });
      return true;
    }

    render() {
      const now = performance.now();
      this.stage.tick(now);
      if (now - this.t0 > SPARKS_MS) this.destroyed = true;
    }

    destroy() {
      this.destroyed = true;
    }
  };
}

const TITLE = (id) =>
  id.replace(/(^|-)([a-z])/g, (_m, dash, c) => (dash ? ' ' : '') + c.toUpperCase());

export function effectName(id, localize = (k) => globalThis.game?.i18n?.localize(k) ?? k) {
  const key = `DICER.V2.Effects.${id}`;
  const text = localize(key);
  const label = text && text !== key ? text : TITLE(id);
  return `${label} (Dicer)`;
}

export function defaultLines() {
  const lines = [
    { diceType: 'd20', onResult: ['20'], specialEffect: sfxId('celebrate') },
    { diceType: 'd20', onResult: ['1'], specialEffect: sfxId('fumble') },
    { diceType: '*', onResult: ['*'], moment: 'collide', specialEffect: SPARKS_ID },
  ];
  const roles = {
    fire: 'fire',
    cold: 'frost',
    ice: 'frost',
    lightning: 'storm',
    acid: 'acid',
    necrotic: 'void',
    radiant: 'vitality',
    poison: 'poison',
    thunder: 'sonic',
    force: 'force',
    psychic: 'mental',
  };
  for (const [role, element] of Object.entries(roles)) {
    if (!ELEMENTS.includes(element)) continue;
    lines.push({ diceType: '*', role, onResult: ['*'], moment: 'throw', specialEffect: TRAIL_ID });
    lines.push({
      diceType: 'd20',
      role,
      onResult: ['20'],
      specialEffect: sfxId(`burst-${element}`),
    });
  }
  return lines;
}

export function registerEffects(dice3d, DiceSFX) {
  const ids = [];
  const add = (cls) => {
    dice3d.addSFXMode(cls);
    ids.push(cls.id);
  };
  for (const mod of Object.values(EFFECTS)) add(effectClass(DiceSFX, mod, effectName(mod.id)));
  add(trailClass(DiceSFX, effectName('trail')));
  add(sparksClass(DiceSFX, effectName('impact-sparks')));
  dice3d.addSFXDefaults(defaultLines());
  return ids;
}

export function registerEffectHooks(hooks = globalThis.Hooks) {
  hooks.on('diceSoNiceDiceFrame', (event) => void trackSpeed(event));
}
