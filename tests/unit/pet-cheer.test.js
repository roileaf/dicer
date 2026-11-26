import * as THREE from 'three';
import { createPetLayer, CHEER_MS, DIE_WIDTH } from '../../src/pet/chunk/pets.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { createMoods } from '../../src/pet/chunk/moods.js';

// ---- the pet layer: cheering for someone else's natural 20 (petCheer) ----
const PX = 48;
const STAGE = {
  cx: 0,
  cz: 0,
  halfWidth: 640 / PX,
  halfDepth: 400 / PX,
  rect: { left: 0, top: 0, width: 1280, height: 800 },
};
const AREA = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
let clockNow = 0;
const make = (settings = {}, over = {}) => {
  clockNow = 0;
  const all = { petStay: 60, petRestSpot: 'bottomRight', ...settings };
  const scene = new THREE.Scene();
  const timers = [];
  const deps = {
    scene,
    getSetting: (k) => all[k],
    playSound: vi.fn(),
    now: () => clockNow,
    wake: vi.fn(),
    win: new EventTarget(),
    random: () => 0.5,
    moods: createMoods(),
    reducedMotion: () => false,
    setTimer: vi.fn((fn, ms) => (timers.push({ fn, ms }), timers.length)),
    clearTimer: vi.fn(),
    ...over,
  };
  const layer = createPetLayer(deps);
  layer.areaChanged(STAGE);
  return { layer, scene, deps, settings: all, timers };
};
const runTo = (m, ms) => {
  let r;
  while (clockNow < ms) r = m.layer.update((clockNow += 16));
  return r;
};
const USERS = [
  ['u1', 'mimic'],
  ['u2', 'slime'],
  ['u3', 'dragonling'],
];
const spec = (userId, kind, ghost = false) => ({ userId, kind, color: '#ff0000', ghost });
/** A plain roll of `user`'s pet, to its rest at its corner spot. */
const rollToRest = (m, user, kind) => {
  const key = `k-${user}-${clockNow}`;
  m.layer.begin(key, {
    spec: spec(user, kind),
    edge: 0,
    area: AREA,
    centre: () => ({ x: 0, z: 0 }),
  });
  runTo(m, clockNow + 400);
  m.layer.landed(key, [{ type: 'd20', value: 10, x: 0, z: 0 }]);
  runTo(m, clockNow + 2500);
  m.layer.leave(key, 0);
  m.layer.end(key);
  expect(runTo(m, clockNow + 1000)).toBe('rest');
};
/** Three pets resting (u1 mimic, u2 slime, u3 dragonling), the layer idle. */
const three = (settings, over) => {
  const m = make(settings, over);
  for (const [u, k] of USERS) rollToRest(m, u, k);
  m.deps.wake.mockClear();
  m.deps.playSound.mockClear();
  return m;
};
const groups = (m) => m.scene.children.filter((c) => c.userData.dicerPet);
const phases = (m) => groups(m).map((g) => g.userData.dicerPet.phase);
const d20 = (value, more = {}) => ({ type: 'd20', value, x: 0.5, z: -0.5, ...more });
/** `user`'s roll begins; returns its key (land it with m.layer.landed). */
const beginRoll = (m, user, kind, ghost = false) => {
  const key = `r-${user}-${clockNow}`;
  m.layer.begin(key, {
    spec: spec(user, kind, ghost),
    edge: 1,
    area: AREA,
    centre: () => ({ x: 0, z: 0 }),
  });
  runTo(m, clockNow + 800); // past its throw: watching
  m.deps.wake.mockClear();
  m.deps.playSound.mockClear();
  return key;
};
/** Runs `ms` and counts, per pet, how many separate cheers it started. */
const countCheers = (m, ms) => {
  const counts = groups(m).map(() => 0);
  let was = phases(m);
  for (const end = clockNow + ms; clockNow < end;) {
    m.layer.update((clockNow += 16));
    const now = phases(m);
    now.forEach((p, i) => {
      if (p === 'cheer' && was[i] !== 'cheer') counts[i]++;
    });
    was = now;
  }
  return counts;
};
const happy = (m) => m.deps.playSound.mock.calls.filter(([s]) => /^petHappy\d*$/.test(s?.builtin ?? '')).length;

describe('cheering in the layer', () => {
  test("another roller's visible crit: the two other resting pets cheer once, the roller's own does not", () => {
    const m = three();
    const key = beginRoll(m, 'u2', 'slime');
    m.layer.landed(key, [d20(20)]);
    expect(m.deps.wake).toHaveBeenCalled();
    m.layer.update((clockNow += 16));
    const [a, b, c] = phases(m);
    expect(a).toBe('cheer');
    expect(b).toBe('react'); // the roller's own pet: its crit reaction, not a cheer
    expect(c).toBe('cheer');
    expect(countCheers(m, CHEER_MS * 2)).toEqual([0, 0, 0]); // each cheered once (already counted)
  });

  test('two 20s in one roll: one cheer per pet', () => {
    const m = three();
    const key = beginRoll(m, 'u1', 'mimic');
    m.layer.landed(key, [d20(20), d20(20, { x: -0.5 })]);
    expect(countCheers(m, CHEER_MS + 200)).toEqual([0, 1, 1]);
  });

  test('a roll with no pet of its own (no key): every resting pet cheers, once, with one chirp', () => {
    const m = three();
    m.layer.landed(null, [d20(20), d20(20, { x: 1 })]);
    expect(m.deps.wake).toHaveBeenCalled();
    expect(countCheers(m, CHEER_MS + 200)).toEqual([1, 1, 1]);
    expect(happy(m)).toBe(1);
  });

  test('Review Focus 3: a ghost (blind) crit never sets off a cheer', () => {
    const m = three();
    // a ghost roll: even a 20 on it is not this viewer's to see
    const key = beginRoll(m, 'u2', 'slime', true);
    m.layer.landed(key, [d20(20)]);
    expect(countCheers(m, CHEER_MS)).toEqual([0, 0, 0]);
    // ghost dice in a visible roll, and a keyless roll of ghost dice (even carrying a value)
    const k2 = beginRoll(m, 'u3', 'dragonling');
    m.layer.landed(k2, [d20(20, { ghost: true }), d20(4)]);
    m.layer.landed(null, [d20(20, { ghost: true }), { type: 'd20', ghost: true, x: 0, z: 0 }]);
    expect(countCheers(m, CHEER_MS)).toEqual([0, 0, 0]);
    expect(happy(m)).toBe(0);
  });

  test('petCheer off: no cheer', () => {
    const m = three({ petCheer: false });
    m.layer.landed(null, [d20(20)]);
    expect(m.deps.wake).not.toHaveBeenCalled();
    expect(countCheers(m, CHEER_MS)).toEqual([0, 0, 0]);
    expect(happy(m)).toBe(0);
  });

  test('pets hidden: no cheer', () => {
    const m = three();
    m.settings.showPets = false;
    m.layer.landed(null, [d20(20)]);
    expect(m.deps.wake).not.toHaveBeenCalled();
  });

  test('petSounds off: the pets cheer in silence', () => {
    const m = three({ petSounds: false });
    m.layer.landed(null, [d20(20)]);
    expect(countCheers(m, CHEER_MS + 200)).toEqual([1, 1, 1]);
    expect(m.deps.playSound).not.toHaveBeenCalled();
  });

  test("the roller's own pet chirps for its crit: the cheer adds no second chirp", () => {
    const m = three();
    const key = beginRoll(m, 'u2', 'slime');
    m.layer.landed(key, [d20(20)]);
    runTo(m, clockNow + CHEER_MS);
    expect(happy(m)).toBe(1);
  });

  test('a crit that is also fumbled (mixed), or no 20 at all: no cheer', () => {
    const m = three();
    m.layer.landed(null, [d20(19), d20(2)]);
    m.layer.landed(null, [d20(20), d20(1)]);
    expect(countCheers(m, CHEER_MS)).toEqual([0, 0, 0]);
  });

  test('it turns toward the roll’s dice, cheers, and turns back; then the loop goes idle', () => {
    const m = three();
    const g = groups(m)[0];
    const yaw0 = g.rotation.y;
    // dice off to one side of the first pet
    const dice = [
      d20(20, { x: g.position.x - 3, z: g.position.z }),
      d20(6, { x: g.position.x - 3, z: g.position.z - 2 }),
    ];
    const toward = Math.atan2(-3, -1); // the mean of the two: (-3, -1) from the pet
    m.layer.landed(null, dice);
    runTo(m, clockNow + CHEER_MS * 0.5);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    expect(Math.abs(wrap(g.rotation.y - toward))).toBeLessThan(0.05);
    runTo(m, clockNow + CHEER_MS);
    expect(Math.abs(wrap(g.rotation.y - yaw0))).toBeLessThan(1e-6);
    m.deps.wake.mockClear();
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(m.layer.update((clockNow += 5000))).toBe('rest');
    expect(m.deps.wake).not.toHaveBeenCalled();
  });

  test('a proud pet cheers and then settles back into proud', () => {
    const m = make();
    for (let i = 0; i < 3; i++) {
      const key = `p${i}`;
      m.layer.begin(key, {
        spec: spec('u1', 'mimic'),
        edge: 0,
        area: AREA,
        centre: () => ({ x: 0, z: 0 }),
      });
      runTo(m, clockNow + 400);
      m.layer.landed(key, [d20(20)]);
      runTo(m, clockNow + 2500);
      m.layer.leave(key, 0);
      m.layer.end(key);
      runTo(m, clockNow + 2000);
    }
    expect(phases(m)).toEqual(['proud']);
    m.layer.landed(null, [d20(20)]);
    m.layer.update((clockNow += 16));
    expect(phases(m)).toEqual(['cheer']);
    expect(runTo(m, clockNow + CHEER_MS + 1200)).toBe('rest');
    expect(phases(m)).toEqual(['proud']);
  });

  test('a fire die by a pet on a crit landing: it cheers instead of scorching', () => {
    const m = three();
    const g = groups(m)[0];
    m.layer.landed(null, [
      d20(20, { x: g.position.x + DIE_WIDTH, z: g.position.z, damageType: 'fire' }),
    ]);
    m.layer.update((clockNow += 16));
    expect(phases(m)[0]).toBe('cheer');
    expect(countCheers(m, CHEER_MS + 100)[0]).toBe(0);
    expect(phases(m)[0]).not.toBe('scorch');
  });

  test('a pet mid-reaction does not cheer', () => {
    const m = three();
    const [g0] = groups(m);
    // u1's pet scorches from a fire die by it (no crit), then a crit lands while it still does
    m.layer.landed(null, [
      { type: 'd6', value: 3, x: g0.position.x + DIE_WIDTH, z: g0.position.z, damageType: 'fire' },
    ]);
    m.layer.update((clockNow += 16));
    expect(phases(m)[0]).toBe('scorch');
    m.layer.landed(null, [d20(20)]);
    m.layer.update((clockNow += 16));
    expect(phases(m)).toEqual(['scorch', 'cheer', 'cheer']);
  });

  test('reduced motion: a gentler cheer, and its stars never flicker', () => {
    for (const calm of [false, true]) {
      const m = three({}, { reducedMotion: () => calm });
      m.layer.landed(null, [d20(20)]);
      const sparkle = groups(m)[1].children.find((c) => c.name === 'petSparkle');
      const tops = [];
      const seen = [];
      for (const end = clockNow + CHEER_MS; clockNow < end;) {
        m.layer.update((clockNow += 8));
        const col = sparkle.geometry.attributes.color;
        const b = [];
        for (let i = 0; i < col.count; i++)
          b.push(sparkle.visible ? col.getX(i) + col.getY(i) + col.getZ(i) : 0);
        seen.push(b);
        tops.push(groups(m)[1].getObjectByName('slime').position.y);
      }
      // each star swells and fades once: one rise and one fall, never a flicker
      const lit = seen[0].map((_, i) => seen.map((f) => f[i]));
      let stars = 0;
      for (const series of lit) {
        if (Math.max(...series) < 1e-3) continue;
        stars++;
        let turns = 0;
        for (let k = 2; k < series.length; k++) {
          const d1 = series[k - 1] - series[k - 2];
          const d2 = series[k] - series[k - 1];
          if (d1 < -1e-6 && d2 > 1e-6) turns++; // a dip and a rise again: a flicker
        }
        expect(turns).toBe(0);
      }
      expect(stars).toBeGreaterThan(0);
      if (calm) expect(stars).toBeLessThanOrEqual(3);
    }
  });
});

describe('the cheer pose', () => {
  test('every creature: starts and ends on the standing pose; calm is gentler (a lower hop)', () => {
    const snap = (c) => {
      const out = [];
      c.root.traverse((o) =>
        out.push(
          ...o.position.toArray(),
          ...o.rotation.toArray().slice(0, 3),
          ...o.scale.toArray(),
        ),
      );
      return out;
    };
    const height = (c) => new THREE.Box3().setFromObject(c.root).max.y;
    for (const kind of Object.keys(CREATURES)) {
      const c = CREATURES[kind]('#44aa66');
      c.pose('exit', 1, 'plain', { yaw: 0, now: 0 });
      const stand = snap(c);
      c.pose('cheer', 0, 'plain', { yaw: 0, now: 0 });
      expect(snap(c)).toEqual(stand);
      c.pose('cheer', 1, 'plain', { yaw: 0, now: 0 });
      snap(c).forEach((v, i) => expect(v).toBeCloseTo(stand[i], 6));
      let peak = 0;
      let calmPeak = 0;
      const base = height(c);
      for (let t = 0; t <= 1; t += 0.02) {
        c.pose('cheer', t, 'plain', { yaw: 0, now: 0 });
        peak = Math.max(peak, height(c) - base);
        c.pose('cheer', t, 'plain', { yaw: 0, now: 0, calm: true });
        calmPeak = Math.max(calmPeak, height(c) - base);
      }
      expect(peak).toBeGreaterThan(0.1); // it hops for joy
      expect(calmPeak).toBeLessThan(peak * 0.6);
      c.dispose();
    }
  });
});

describe("a theme's pet volume (petVolume on the dice)", () => {
  const volumes = (m) => m.deps.playSound.mock.calls.map(([s]) => s.volume ?? 1);
  /** u1 rolls `dice` (the same dice in flight and landed), the others resting; the voices' volumes. */
  const roll = (m, dice, ghost = false) => {
    const key = `v-${clockNow}`;
    m.layer.begin(key, { spec: spec('u1', 'mimic', ghost), edge: 1, area: AREA, centre: () => ({ x: 0, z: 0 }), dice, hand: true });
    runTo(m, clockNow + 800);
    m.layer.landed(key, dice);
    runTo(m, clockNow + 3000);
    m.layer.leave(key, 0);
    m.layer.end(key);
    runTo(m, clockNow + 1500);
    return volumes(m);
  };

  test('the quietest die of the roll sets the voices that answer it', () => {
    const m = three();
    const got = roll(m, [d20(20, { petVolume: 0.5 }), d20(20, { petVolume: 0.25 })]);
    expect(got.length).toBeGreaterThan(0);
    expect(Math.max(...got)).toBe(0.25);
  });

  test('a silent roll leaves nothing behind: the next one is at full volume', () => {
    const m = three();
    expect(roll(m, [d20(20, { petVolume: 0 })])).toEqual([]);
    const got = roll(m, [d20(20)]);
    expect(got.length).toBeGreaterThan(0);
    expect(Math.min(...got)).toBe(1);
  });
});
