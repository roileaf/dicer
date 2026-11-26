import { Group, Vector3 } from 'three';
import { createImpactFx, createParticlePool } from '../../effects/library/particles.js';
import { createTrailFx } from '../../effects/library/trails.js';
import { tierConfig } from '../quality/state.js';

export const V1_D6_EDGE = 2 / Math.sqrt(3);
const POOL_CAPACITY = 2048;
const SIZE_LINE = 'aSize * mix(';

const stages = new WeakMap();
const warned = new Set();

function warnOnce(key, message, err) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`dicer: ${message}`, err);
}

export function reducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

export function stageScale(box) {
  const edge = Number(box?.dicefactory?.baseScale);
  return edge > 0 ? edge / V1_D6_EDGE : 1;
}

export function scalePoolSizes(pool, uniform) {
  for (const { material } of pool.layers) {
    if (!material.vertexShader.includes(SIZE_LINE))
      throw new Error('dicer: the particle size line moved');
    material.vertexShader = material.vertexShader
      .replace('uniform float uTime;', 'uniform float uTime;\nuniform float uDcStage;')
      .replace(SIZE_LINE, `uDcStage * ${SIZE_LINE}`);
    material.uniforms.uDcStage = uniform;
    material.needsUpdate = true;
  }
  return pool;
}

function createStage(box) {
  const group = new Group();
  group.name = 'dicer-effects';
  const scale = { value: 1 };
  let pool = null;
  let poolFailed = false;
  let lastTick = -1;

  const getPool = () => {
    if (pool || poolFailed) return pool;
    try {
      pool = scalePoolSizes(createParticlePool(group, POOL_CAPACITY), scale);
    } catch (err) {
      poolFailed = true;
      console.warn('dicer: cannot create the particle pool; particle effects are off', err);
    }
    return pool;
  };
  const deps = {
    getPool,
    getTier: tierConfig,
    now: () => performance.now(),
    reducedMotion,
    setting: () => undefined,
    warnOnce,
  };

  const stage = {
    group,
    get particles() {
      return getPool();
    },
    impactFx: createImpactFx(deps),
    trailFx: createTrailFx(deps),
    get scale() {
      return scale.value;
    },
    attach() {
      const s = stageScale(box);
      if (s !== scale.value) {
        scale.value = s;
        group.scale.setScalar(s);
      }
      if (group.parent !== box.scene) box.scene.add(group);
      return stage;
    },
    toStage(world, out = new Vector3()) {
      return out.copy(world).divideScalar(scale.value);
    },
    tick(now) {
      if (now === lastTick) return;
      lastTick = now;
      pool?.update(now);
    },
  };
  return stage;
}

export function stageOf(box) {
  let stage = stages.get(box);
  if (!stage) stages.set(box, (stage = createStage(box)));
  return stage.attach();
}
