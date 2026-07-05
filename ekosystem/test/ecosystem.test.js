const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../app.js');
const { NEAT_CONFIG, GENE_BOUNDS } = require('../neat.js');

function createSimpleAnimal(kind, genome) {
  return {
    id: 1,
    kind,
    x: 10,
    y: 10,
    h: 0,
    e: 100,
    g: genome,
    age: 0,
    cool: 0,
    fitness: 0,
    tPlant: null,
    tThreat: null,
    herdIntent: 0,
    lineage: [],
    parentIds: [],
    metrics: { kills: 0, plants: 0, children: 0, dist: 0, avgEnergy: 0, efficiency: 0, survival: 0, energySum: 0, energySamples: 0 }
  };
}

test('serializeState produces JSON-safe payload', () => {
  const state = app.serializeState();
  assert.doesNotThrow(() => JSON.parse(state));
  assert.match(state, /"tick"/);
});

test('shouldReproducePair scales chance with the weaker breed signal, no hard cutoff', () => {
  const a = { g: { lastBreedSignal: 0.4 } };
  const b = { g: { lastBreedSignal: 0.6 } };
  assert.equal(app.shouldReproducePair(a, b, 0), false);
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.39; // just below min(0.4,0.6) * baseChance(1) = 0.4
    assert.equal(app.shouldReproducePair(a, b, 1), true);
    Math.random = () => 0.41; // just above the effective threshold
    assert.equal(app.shouldReproducePair(a, b, 1), false);
    Math.random = () => 0.05; // weak signal below 0.35 can still occasionally succeed
    assert.equal(app.shouldReproducePair(a, b, 1), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('shouldApplyWolfHerdInfluence ignores weak or distant signals', () => {
  const wolf = { herdIntent: 0.1, x: 10, y: 10 };
  const sheep = { x: 20, y: 20 };
  const signal = { plant: { x: 20, y: 20 }, w: wolf };
  assert.equal(app.shouldApplyWolfHerdInfluence(signal, wolf, sheep), false);
});

test('sanitizeForStorage removes circular references', () => {
  const source = { reg: { name: 'core' }, value: 3, nested: { reg: { name: 'inner' } } };
  const cleaned = app.sanitizeForStorage(source);
  assert.equal(cleaned.reg, undefined);
  assert.equal(cleaned.value, 3);
  assert.equal(cleaned.nested.reg, undefined);
});

test('sanitizeForStorage survives a genuine mutual reference cycle (e.g. wolf.tThreat <-> sheep.tThreat)', () => {
  const wolf = { kind: 'wolf', tThreat: null };
  const sheepAnimal = { kind: 'sheep', tThreat: wolf };
  wolf.tThreat = sheepAnimal; // mutual cycle, mirrors real tPlant/tThreat cross-references
  assert.doesNotThrow(() => app.sanitizeForStorage(wolf));
  assert.doesNotThrow(() => JSON.stringify(app.sanitizeForStorage(wolf)));
});

test('sanitizeForStorage keeps a legitimately shared (non-cyclic) reference on both branches', () => {
  const sharedTarget = { id: 42, value: 'shared' };
  const source = { a: sharedTarget, b: sharedTarget };
  const cleaned = app.sanitizeForStorage(source);
  assert.equal(cleaned.a.value, 'shared');
  assert.equal(cleaned.b.value, 'shared');
});

test('createDefaultMetrics returns zeroed metrics', () => {
  const metrics = app.createDefaultMetrics();
  assert.deepEqual(metrics, {
    kills: 0,
    plants: 0,
    children: 0,
    dist: 0,
    avgEnergy: 0,
    efficiency: 0,
    survival: 0,
    energySum: 0,
    energySamples: 0,
    denDeliveries: 0,
    closeCallsSurvived: 0
  });
});

test('nearestInGrid matches a naive brute-force nearest-neighbor scan', () => {
  const points = [];
  for (let i = 0; i < 200; i++) points.push({ id: i, x: Math.random() * 96, y: Math.random() * 96 });
  const grid = app.buildSpatialGrid(points);
  for (let trial = 0; trial < 30; trial++) {
    const qx = Math.random() * 96, qy = Math.random() * 96;
    const visionLimit = 20;
    const bruteForce = points.reduce((best, p) => {
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d >= visionLimit) return best;
      return (!best || d < best.d) ? { o: p, d } : best;
    }, null);
    const gridResult = app.nearestInGrid(qx, qy, grid, null, visionLimit);
    if (!bruteForce) {
      assert.equal(gridResult, null);
    } else {
      assert.ok(gridResult, 'grid should find a neighbor when brute force does');
      assert.equal(gridResult.o.id, bruteForce.o.id);
    }
  }
});

test('nearestInGrid respects the predicate filter', () => {
  const a = { id: 1, x: 10, y: 10 };
  const b = { id: 2, x: 10.5, y: 10 };
  const grid = app.buildSpatialGrid([a, b]);
  const result = app.nearestInGrid(10, 10, grid, o => o.id !== 1, 20);
  assert.equal(result.o.id, 2);
});

test('removeFromSpatialGrid makes an object unreachable by nearestInGrid', () => {
  const a = { id: 1, x: 10, y: 10 };
  const grid = app.buildSpatialGrid([a]);
  assert.ok(app.nearestInGrid(10, 10, grid, null, 20));
  app.removeFromSpatialGrid(grid, a);
  assert.equal(app.nearestInGrid(10, 10, grid, null, 20), null);
});

test('nearestInGrid finds neighbors across cell boundaries when vision spans multiple cells', () => {
  const cell = app.SPATIAL_GRID_CELL_SIZE;
  const far = { id: 1, x: 0, y: 0 };
  const grid = app.buildSpatialGrid([far], cell);
  const result = app.nearestInGrid(cell * 1.5, 0, grid, null, cell * 2);
  assert.ok(result, 'should find the neighbor even though it is in a different grid cell');
  assert.equal(result.o.id, 1);
});

function createMockLocalStorage(initialEntries) {
  const store = new Map(Object.entries(initialEntries || {}));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

function withIsolatedEcosystemState(overrides, fn) {
  const saved = app.getEcosystemStateForTests();
  app.setEcosystemStateForTests(overrides);
  try {
    fn();
  } finally {
    app.setEcosystemStateForTests(saved);
  }
}

test('isMature requires either enough age or enough energy, not both', () => {
  const stats = { maturityAge: 200, maturityEnergy: 80 };
  assert.equal(app.isMature({ age: 199, e: 79 }, stats), false);
  assert.equal(app.isMature({ age: 200, e: 0 }, stats), true);
  assert.equal(app.isMature({ age: 0, e: 80 }, stats), true);
});

test('tickAgeAndCooldown ages the animal and counts down cooldown without going negative', () => {
  const a = { age: 5, cool: 2 };
  app.tickAgeAndCooldown(a);
  assert.deepEqual(a, { age: 6, cool: 1 });
  app.tickAgeAndCooldown(a);
  assert.deepEqual(a, { age: 7, cool: 0 });
  app.tickAgeAndCooldown(a); // cool already 0, must not go negative
  assert.deepEqual(a, { age: 8, cool: 0 });
});

test('vitalsSense composes energy/bias/age into the three shared "vitals" inputs', () => {
  const stats = { maxEnergy: 200, maxAge: 1000 };
  const a = { e: 150, age: 250 };
  const [energyNorm, bias, ageSignal] = app.vitalsSense(a, stats);
  assert.ok(Math.abs(energyNorm - 0.5) < 1e-9, 'e=150/200 should map to (150/200)*2-1 = 0.5');
  assert.equal(bias, 1);
  assert.ok(Math.abs(ageSignal - 0.25) < 1e-9, 'age=250/maxAge=1000 should map to 0.25');
});

test('turnHeading rotates by turn * turnRate, nothing else', () => {
  const a = { h: 0 };
  app.turnHeading(a, 1, { turnRate: 0.2 });
  assert.ok(Math.abs(a.h - 0.2) < 1e-9);
});

test('moveAndMeasure advances position along heading, clamps to world bounds, and tracks distance', () => {
  const a = { x: app.WORLD - 0.01, y: 5, h: 0, metrics: { dist: 0 } };
  const v = app.moveAndMeasure(a, 1, { speed: 2 });
  assert.ok(v > 0, 'full-throttle should produce a positive velocity');
  assert.equal(a.x, app.WORLD, 'x must be clamped at the world edge, not run past it');
  assert.equal(a.metrics.dist, v, 'distance metric should accumulate exactly the velocity moved this tick');
});

test('applyMetabolism drains energy, tracks avg energy/efficiency/survival', () => {
  const a = { e: 100, age: 500, metrics: { energySum: 0, energySamples: 0, dist: 20 } };
  const stats = { metabolism: 0.1, moveCost: 0.05, maxAge: 1000 };
  app.applyMetabolism(a, stats, 2, 4); // v=2, dietSuccessCount=4
  assert.ok(Math.abs(a.e - (100 - (0.1 + 2*0.05))) < 1e-9);
  assert.equal(a.metrics.energySamples, 1);
  assert.ok(Math.abs(a.metrics.efficiency - (4 / Math.max(1, 20/10))) < 1e-9);
  assert.ok(Math.abs(a.metrics.survival - 0.5) < 1e-9);
});

test('createDenTrait only gives wolves a den; createLineageTrait merges and caps a single parent chain', () => {
  assert.deepEqual(app.createDenTrait('wolf', 3, 4), { x: 3, y: 4 });
  assert.equal(app.createDenTrait('sheep', 3, 4), null);

  const parent = { id: 7, lineage: [1, 2, 3] };
  assert.deepEqual(app.createLineageTrait([parent]), [1, 2, 3, 7]);
  assert.deepEqual(app.createLineageTrait([]), []);
});

test('hungerSense saturates at +1 when hungry, -1 when full, and interpolates in between', () => {
  const stats = { maxEnergy: 100 };
  assert.equal(app.hungerSense({ e: 40 }, stats), 1, 'at or below the hungry threshold, signal should saturate at +1');
  assert.equal(app.hungerSense({ e: 10 }, stats), 1, 'well below hungry threshold, still saturated at +1, not runaway');
  assert.equal(app.hungerSense({ e: 80 }, stats), -1, 'at or above the well-fed threshold, signal should saturate at -1');
  assert.equal(app.hungerSense({ e: 100 }, stats), -1, 'well above well-fed threshold, still saturated at -1');
  assert.ok(Math.abs(app.hungerSense({ e: 60 }, stats) - 0) < 1e-9, 'exactly midway between thresholds should read neutral (0)');
});

test('hungerSense thresholds match the visual hungry/well-fed thresholds animals are drawn with', () => {
  assert.equal(app.HUNGRY_ENERGY_RATIO, 0.4);
  assert.equal(app.WELL_FED_ENERGY_RATIO, 0.8);
});

test('shouldRestoreMissingSheepPopulation/Wolf trigger only below the survival floor', () => {
  withIsolatedEcosystemState({ sheep: new Array(9).fill(null), wolves: new Array(2).fill(null) }, () => {
    assert.equal(app.shouldRestoreMissingSheepPopulation(), true);
    assert.equal(app.shouldRestoreMissingWolfPopulation(), false);
  });
  withIsolatedEcosystemState({ sheep: new Array(10).fill(null), wolves: new Array(1).fill(null) }, () => {
    assert.equal(app.shouldRestoreMissingSheepPopulation(), false);
    assert.equal(app.shouldRestoreMissingWolfPopulation(), true);
  });
});

test('checkPopulationCollapse restores animals and resets uptime on a real crash', () => {
  withIsolatedEcosystemState({ sheep: [], wolves: [], ecosystemUptime: 500 }, () => {
    app.checkPopulationCollapse();
    const after = app.getEcosystemStateForTests();
    assert.ok(after.sheep.length >= 10, 'sheep should be restocked above the survival floor');
    assert.ok(after.wolves.length >= 2, 'wolves should be restocked above the survival floor');
    assert.equal(after.ecosystemUptime, 0);
  });
});

test('computeSheepRestockCount scales the restock batch with the current wolf population', () => {
  withIsolatedEcosystemState({ sheep: [], wolves: new Array(6).fill(null) }, () => {
    assert.equal(app.computeSheepRestockCount(), app.SHEEP_RESTOCK_BASE + 6 * app.SHEEP_RESTOCK_PER_WOLF);
  });
  withIsolatedEcosystemState({ sheep: [], wolves: new Array(220).fill(null) }, () => {
    const expected = Math.min(app.P.sheep.cap, app.SHEEP_RESTOCK_BASE + 220 * app.SHEEP_RESTOCK_PER_WOLF);
    assert.equal(app.computeSheepRestockCount(), expected, 'a large wolf pack must not overwhelm a fixed-size restock batch');
  });
});

test('checkPopulationCollapse restocks proportionally more sheep when many wolves are present', () => {
  withIsolatedEcosystemState({ sheep: [], wolves: new Array(50).fill(null).map((_, i) => app.makeAnimal('wolf', i, i, app.neatWolf.createBaseGenome())), ecosystemUptime: 500 }, () => {
    app.checkPopulationCollapse();
    const after = app.getEcosystemStateForTests();
    assert.ok(after.sheep.length >= app.SHEEP_RESTOCK_BASE + 40, `expected a much larger batch than the old fixed 15, got ${after.sheep.length}`);
  });
});

test('checkPopulationCollapse leaves a healthy population and its uptime untouched', () => {
  const sheepArr = Array.from({ length: 20 }, (_, i) => app.makeAnimal('sheep', i, i, app.neatSheep.createBaseGenome()));
  const wolfArr = Array.from({ length: 5 }, (_, i) => app.makeAnimal('wolf', i, i, app.neatWolf.createBaseGenome()));
  withIsolatedEcosystemState({ sheep: sheepArr, wolves: wolfArr, ecosystemUptime: 500 }, () => {
    app.checkPopulationCollapse();
    const after = app.getEcosystemStateForTests();
    assert.equal(after.sheep.length, 20);
    assert.equal(after.wolves.length, 5);
    assert.equal(after.ecosystemUptime, 500);
  });
});

test('step() detects a population crash the same tick instead of waiting up to 800 ticks for the next epoch', () => {
  withIsolatedEcosystemState({ sheep: [], wolves: [], plants: [], epochTimer: 0, ecosystemUptime: 300, bestEcosystemUptime: 300 }, () => {
    app.step();
    const after = app.getEcosystemStateForTests();
    assert.equal(after.epochTimer, 1, 'sanity check: the 800-tick epoch boundary was not reached');
    assert.equal(after.ecosystemUptime, 0, 'uptime must reset the moment the population crashes, not 800 ticks later');
  });
});

test('wolves are born with a den at their birth location; sheep have none', () => {
  const wolf = app.makeAnimal('wolf', 12, 34, app.neatWolf.createBaseGenome());
  assert.deepEqual(wolf.den, { x: 12, y: 34 });
  const sheep = app.makeAnimal('sheep', 12, 34, app.neatSheep.createBaseGenome());
  assert.equal(sheep.den, null);
});

test('wolf brain gained a den-sensing input on top of the boundary sense both species share', () => {
  assert.equal(app.neatWolf.nIn, 17);
  assert.equal(app.neatWolf.names.length, app.neatWolf.nIn + app.neatWolf.nOut);
  assert.equal(app.neatWolf.names[10], 'Legowisko blisko');
  assert.equal(app.neatSheep.nIn, 14, 'sheep have no den, but they do share the fence/boundary/hunger senses');

  const g = app.neatWolf.createBaseGenome();
  const out = app.neatWolf.activate(g, new Array(app.neatWolf.nIn).fill(0.1));
  assert.equal(out.length, app.neatWolf.nOut);
});

test('nearestBoundaryPoint finds the closest of the four world edges', () => {
  const W = app.WORLD;
  assert.deepEqual(app.nearestBoundaryPoint(3, W/2), { o: { x: 0, y: W/2 }, d: 3 });
  assert.deepEqual(app.nearestBoundaryPoint(W-3, W/2), { o: { x: W, y: W/2 }, d: 3 });
  assert.deepEqual(app.nearestBoundaryPoint(W/2, 3), { o: { x: W/2, y: 0 }, d: 3 });
  assert.deepEqual(app.nearestBoundaryPoint(W/2, W-3), { o: { x: W/2, y: W }, d: 3 });
  const center = app.nearestBoundaryPoint(W/2, W/2);
  assert.equal(center.d, W/2, 'dead center should be equidistant from all edges');
});

test('sheep and wolf brains both gain a fence-sensing input at the edge of the world', () => {
  assert.equal(app.neatSheep.names[10], 'Płot blisko');
  assert.equal(app.neatWolf.names[13], 'Płot blisko');
});

test('a kill away from the den only grants the immediate share; the rest is carried, not eaten', () => {
  const wolf = app.makeAnimal('wolf', 50, 50, app.neatWolf.createBaseGenome());
  wolf.den = { x: 0, y: 0 }; // far from the kill site, so nothing can be delivered this tick
  const prey = { x: 50.1, y: 50, e: 100, id: 999 }; // within EAT range of the wolf's starting position
  withIsolatedEcosystemState({ sheep: [prey], wolves: [wolf], plants: [] }, () => {
    app.updateWolves(app.P.plant, 1);
  });
  assert.equal(wolf.metrics.kills, 1);
  assert.ok(
    Math.abs(wolf.carriedFood - app.P.wolf.sheepE * app.DEN_FOOD_SHARE) < 1e-9,
    `expected ${app.P.wolf.sheepE * app.DEN_FOOD_SHARE} carried, got ${wolf.carriedFood}`
  );
});

test('delivering carried food at the den grants the reserved energy, a fitness bonus, and clears the carry', () => {
  const wolf = app.makeAnimal('wolf', 50, 50, app.neatWolf.createBaseGenome());
  wolf.carriedFood = 30;
  wolf.den = { x: 50, y: 50 }; // already at the den
  const startE = wolf.e;
  const startFitness = wolf.g.fitness;
  withIsolatedEcosystemState({ sheep: [], wolves: [wolf], plants: [] }, () => {
    app.updateWolves(app.P.plant, 1);
  });
  assert.equal(wolf.carriedFood, 0, 'carried food should be delivered and cleared');
  assert.equal(wolf.metrics.denDeliveries, 1);
  assert.ok(wolf.e > startE, 'delivering 30 carried food should outweigh a single tick of metabolism loss');
  assert.ok(wolf.g.fitness >= startFitness + app.DEN_DELIVERY_BONUS - 1e-9, 'a successful delivery must add the den bonus to fitness');
});

test('a wolf resting at its den with nothing carried gains no free energy', () => {
  const wolf = app.makeAnimal('wolf', 50, 50, app.neatWolf.createBaseGenome()); // den defaults to this birth spot
  const startE = wolf.e;
  withIsolatedEcosystemState({ sheep: [], wolves: [wolf], plants: [] }, () => {
    app.updateWolves(app.P.plant, 1);
  });
  assert.ok(wolf.e < startE, 'without carried food, merely being at the den must not prevent normal metabolism loss');
});

test('wolf cubs are born at a parent den, not the midpoint between mates', () => {
  const denHolder = app.makeAnimal('wolf', 5, 5, app.neatWolf.createBaseGenome());
  denHolder.den = { x: 5, y: 5 };
  const mate = app.makeAnimal('wolf', 90, 90, app.neatWolf.createBaseGenome());
  mate.den = { x: 90, y: 90 };
  denHolder.g.fitness = 1000; // make denHolder the fitter parent so fit[0] is deterministic
  mate.g.fitness = 0;
  denHolder.g.lastBreedSignal = 1; mate.g.lastBreedSignal = 1;
  denHolder.cool = 0; mate.cool = 0;
  denHolder.age = denHolder.g.stats.maturityAge; mate.age = mate.g.stats.maturityAge;
  mate.x = denHolder.x; mate.y = denHolder.y; // stand next to each other so the REPRO distance check passes
  const originalRandom = Math.random;
  Math.random = () => 0.0001; // guarantee the reproduction roll succeeds; must stay > 0, mathGauss()'s while(!u) loops forever on exactly 0
  try {
    withIsolatedEcosystemState({ sheep: [], wolves: [denHolder, mate], plants: [] }, () => {
      app.finalizeReproduction([], []);
      const state = app.getEcosystemStateForTests();
      const cub = state.wolves.find(w => w.id !== denHolder.id && w.id !== mate.id);
      assert.ok(cub, 'expected a cub to be born');
      assert.ok(Math.hypot(cub.x - 5, cub.y - 5) <= 1.5, `cub should be born near the fitter parent's den, was at (${cub.x}, ${cub.y})`);
    });
  } finally {
    Math.random = originalRandom;
  }
});

test('plant spawn rate stays well below the actual food need, and fills the map gradually rather than near-instantly', () => {
  // Regression guard: spawn was once scaled proportionally to plant.cap every time caps were
  // raised, which made the whole map "green up" from empty in ~5 seconds — visually unnatural
  // and hugely oversized versus real steady-state grazing demand (~1 plant/tick even at full
  // sheep cap). Keep both a pacing floor (not near-instant) and a supply floor (not starved).
  const ticksToFillFromEmpty = app.P.plant.cap / app.P.plant.spawn;
  assert.ok(ticksToFillFromEmpty > 300, `map should take more than 300 ticks (~12.5s @1x) to fill from empty, took ${ticksToFillFromEmpty.toFixed(0)}`);
  const roughSteadyStateNeed = app.P.sheep.cap * 0.0015; // ~ conservative per-sheep plants/tick at full cap
  assert.ok(app.P.plant.spawn > roughSteadyStateNeed * 2, `spawn rate should keep a healthy safety margin above real grazing demand (~${roughSteadyStateNeed.toFixed(2)}/tick)`);
});

test('spawnPlant() usually self-seeds near an existing plant instead of scattering uniformly', () => {
  withIsolatedEcosystemState({ plants: [{ x: 50, y: 50, g: 1, age: 0, life: 1000 }] }, () => {
    let nearCount = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const p = app.spawnPlant();
      if (!p) continue; // astronomically rare: all retry attempts landed within PLANT_MIN_SPACING of the one existing plant
      const d = Math.hypot(p.x - 50, p.y - 50);
      if (d <= app.PLANT_SEED_MAX_DIST + 1e-9) nearCount++;
    }
    assert.ok(nearCount / trials > 0.6, `expected most seeded plants to land near the existing one, got ${nearCount}/${trials}`);
  });
});

test('spawnPlant() never returns a candidate closer than PLANT_MIN_SPACING to an existing plant', () => {
  const existing = [{ x: 50, y: 50, g: 1, age: 0, life: 1000 }];
  withIsolatedEcosystemState({ plants: existing }, () => {
    const grid = app.buildSpatialGrid(existing);
    for (let i = 0; i < 100; i++) {
      const p = app.spawnPlant(grid);
      if (!p) continue;
      const d = Math.hypot(p.x - 50, p.y - 50);
      assert.ok(d >= app.PLANT_MIN_SPACING, `spawned plant at distance ${d} violates the minimum spacing of ${app.PLANT_MIN_SPACING}`);
    }
  });
});

test('spawnPlant() gives up and returns null when every retry lands on an existing plant', () => {
  const originalRandom = Math.random;
  // A constant Math.random makes spawnPlantCandidate() deterministic: same parent index,
  // same angle, same distance -> the exact same candidate position on every retry attempt.
  Math.random = () => 0.01;
  try {
    const parent = { x: 50, y: 50, g: 1, age: 0, life: 1000 };
    const angle = 0.01 * (Math.PI * 2);
    const dist = app.PLANT_SEED_MIN_DIST + 0.01 * (app.PLANT_SEED_MAX_DIST - app.PLANT_SEED_MIN_DIST);
    const blocker = { x: parent.x + Math.cos(angle) * dist, y: parent.y + Math.sin(angle) * dist, g: 1, age: 0, life: 1000 };
    const existing = [parent, blocker];
    withIsolatedEcosystemState({ plants: existing }, () => {
      const grid = app.buildSpatialGrid(existing);
      assert.equal(app.spawnPlant(grid), null, 'every retry lands exactly on the blocker, so spawning should give up');
    });
  } finally {
    Math.random = originalRandom;
  }
});

test('updatePlants() never lets two plants land on top of each other after a burst of growth', () => {
  withIsolatedEcosystemState({ plants: [{ x: 50, y: 50, g: 1, age: 0, life: 1000 }] }, () => {
    for (let i = 0; i < 30; i++) app.updatePlants(app.P.plant, 1);
    const after = app.getEcosystemStateForTests().plants;
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) {
        const d = Math.hypot(after[i].x - after[j].x, after[i].y - after[j].y);
        assert.ok(d >= app.PLANT_MIN_SPACING - 1e-9, `plants ${i} and ${j} overlap at distance ${d}`);
      }
    }
  });
});

test('lineage stays bounded across many generations instead of doubling every generation', () => {
  let a = app.makeAnimal('sheep', 0, 0, app.neatSheep.createBaseGenome());
  let b = app.makeAnimal('sheep', 1, 1, app.neatSheep.createBaseGenome());
  for (let gen = 0; gen < 40; gen++) {
    const child = app.makeAnimal('sheep', 0, 0, app.neatSheep.createBaseGenome(), [a, b]);
    assert.ok(
      child.lineage.length <= app.LINEAGE_HISTORY_LIMIT,
      `lineage must stay capped at ${app.LINEAGE_HISTORY_LIMIT}, got ${child.lineage.length} at generation ${gen}`
    );
    a = child;
    b = app.makeAnimal('sheep', 1, 1, app.neatSheep.createBaseGenome(), [a, b]);
  }
});

test('speciate() enforces a hard species-count cap regardless of how diverse genomes are', () => {
  const core = app.neatSheep;
  for (let i = 0; i < 100; i++) {
    const g = core.createBaseGenome();
    for (let m = 0; m < 20; m++) core.mutate(g, 3); // push it structurally far from everything already speciated
    core.speciate(g);
    assert.ok(core.species.length <= NEAT_CONFIG.MAX_SPECIES, `species count should never exceed the cap, got ${core.species.length}`);
  }
});

test('checkPopulationCollapse throttles repeated restocking to avoid runaway species/genome churn', () => {
  withIsolatedEcosystemState({ sheep: [], wolves: [], tick: 1000, lastRestockTick: 990, ecosystemUptime: 50 }, () => {
    app.checkPopulationCollapse();
    let after = app.getEcosystemStateForTests();
    assert.equal(after.sheep.length, 0, 'restock should be skipped while inside the cooldown window');
    assert.equal(after.ecosystemUptime, 0, 'uptime must still reflect the real, ongoing collapse even while restocking is on cooldown');

    app.setEcosystemStateForTests({ tick: 990 + app.RESTOCK_COOLDOWN_TICKS });
    app.checkPopulationCollapse();
    after = app.getEcosystemStateForTests();
    assert.ok(after.sheep.length >= 10, 'restock should proceed once the cooldown window elapses');
  });
});

test('updateSheep tracks the best-fitness sheep genome seen this tick', () => {
  const weak = app.makeAnimal('sheep', 10, 10, app.neatSheep.createBaseGenome());
  const strong = app.makeAnimal('sheep', 40, 40, app.neatSheep.createBaseGenome());
  strong.metrics.children = 5; // pushes its fitness well above weak's
  withIsolatedEcosystemState({ sheep: [weak, strong], wolves: [], plants: [], sheepBestGenomeSeen: null }, () => {
    app.updateSheep(app.P.plant, 1, 1, []);
    const after = app.getEcosystemStateForTests();
    assert.ok(after.sheepBestGenomeSeen, 'expected a tracked best genome after processing sheep');
    assert.ok(Math.abs(after.sheepBestGenomeSeen.fitness - strong.g.fitness) < 1e-9, 'the tracked genome should match the strongest sheep this tick');
  });
});

test('the tracked best sheep genome only improves, never regresses toward a weaker one', () => {
  const priorBest = { fitness: 500 };
  const weaker = app.makeAnimal('sheep', 10, 10, app.neatSheep.createBaseGenome());
  withIsolatedEcosystemState({ sheep: [weaker], wolves: [], plants: [], sheepBestGenomeSeen: priorBest }, () => {
    app.updateSheep(app.P.plant, 1, 1, []);
    const after = app.getEcosystemStateForTests();
    assert.equal(after.sheepBestGenomeSeen.fitness, 500, 'a weaker currently-alive sheep must not overwrite a stronger previously-tracked genome');
  });
});

test('checkPopulationCollapse restocks sheep from the freshly-tracked best genome, not the stale epoch champion pool', () => {
  const freshGenome = app.neatSheep.createBaseGenome();
  freshGenome.stats.speed = 5; // extreme marker, unmistakable even after normal mutation drift
  withIsolatedEcosystemState({ sheep: [], wolves: [], sheepBestGenomeSeen: freshGenome }, () => {
    app.checkPopulationCollapse();
    const after = app.getEcosystemStateForTests();
    assert.ok(after.sheep.length > 0);
    assert.ok(after.sheep.every(s => s.g.stats.speed > 2), 'restocked sheep should be clones of the tracked genome (speed=5), not the base fallback (speed=0.48)');
  });
});

test('evaluateEpochs records one evolution-history sample per epoch, capturing the current uptime/record', () => {
  withIsolatedEcosystemState({ epochTimer: 800, ecosystemUptime: 500, bestEcosystemUptime: 700, evolutionHistory: [] }, () => {
    app.evaluateEpochs();
    const after = app.getEcosystemStateForTests();
    assert.equal(after.evolutionHistory.length, 1);
    assert.equal(after.evolutionHistory[0].uptime, 500);
    assert.equal(after.evolutionHistory[0].record, 700);

    app.setEcosystemStateForTests({ epochTimer: 0 });
    app.evaluateEpochs(); // below the 800-tick threshold, should not add another sample
    assert.equal(app.getEcosystemStateForTests().evolutionHistory.length, 1);
  });
});

test('mutate() enforces a hard complexity cap so genomes cannot grow without bound', () => {
  const g = app.neatSheep.createBaseGenome();
  for (let i = 0; i < 800; i++) {
    app.neatSheep.mutate(g, 3); // high power to maximize how often MUT_LINK/MUT_NODE would fire
  }
  assert.ok(g.nodes.length <= NEAT_CONFIG.MAX_NODES, `nodes should never exceed the cap, got ${g.nodes.length}`);
  assert.ok(g.conns.length <= NEAT_CONFIG.MAX_CONNS, `connections should never exceed the cap, got ${g.conns.length}`);
});

test('mutate() reliably wires up every output eventually, even after genomes accumulate many hidden nodes', () => {
  // Regression guard: without a bias toward "orphaned" outputs, MUT_LINK's target pool is
  // diluted by every hidden node the genome accumulates, making a never-wired output (like
  // "Rozmnażaj") LESS likely to ever get connected the longer a genome evolves — the exact
  // mechanism that left sheep/wolves unable to reproduce at all in a long-running session.
  const core = app.neatSheep;
  let successCount = 0;
  const trials = 20;
  for (let trial = 0; trial < trials; trial++) {
    const g = core.createBaseGenome();
    for (let i = 0; i < 300; i++) core.mutate(g, 1.5);
    const outputIds = g.nodes.filter(n => n.type === 'out').map(n => n.id);
    const allWired = outputIds.every(id => g.conns.some(c => c.b === id && c.enabled));
    if (allWired) successCount++;
  }
  assert.ok(successCount / trials > 0.8, `expected most genomes to eventually wire every output (including the breed output), got ${successCount}/${trials}`);
});

test('mutate() keeps metabolism and maxAge within biological bounds of the species baseline, however many generations pass', () => {
  // Regression guard: g.stats mutation had no ceiling/floor beyond a bare 0.01 minimum, so
  // over hundreds of generations natural selection could drift metabolism/maxAge arbitrarily
  // far from the species baseline (observed: a wolf with metabolism 0.042 vs a base of 0.17,
  // and maxAge near 3000 vs a base of 1450) — effectively evolving around the metabolism-based
  // population-balance tuning rather than operating within a plausible biological range.
  for (const core of [app.neatSheep, app.neatWolf]) {
    const base = core.baseGenes;
    const g = core.createBaseGenome();
    for (let i = 0; i < 2000; i++) core.mutate(g, 3);
    const metaBounds = GENE_BOUNDS.metabolism;
    const ageBounds = GENE_BOUNDS.maxAge;
    assert.ok(
      g.stats.metabolism >= base.metabolism * metaBounds.min && g.stats.metabolism <= base.metabolism * metaBounds.max,
      `metabolism ${g.stats.metabolism} escaped [${base.metabolism * metaBounds.min}, ${base.metabolism * metaBounds.max}]`
    );
    assert.ok(
      g.stats.maxAge >= base.maxAge * ageBounds.min && g.stats.maxAge <= base.maxAge * ageBounds.max,
      `maxAge ${g.stats.maxAge} escaped [${base.maxAge * ageBounds.min}, ${base.maxAge * ageBounds.max}]`
    );
  }
});

test('crossover never produces a child larger than its fitter parent', () => {
  const g1 = app.neatSheep.createBaseGenome();
  const g2 = app.neatSheep.createBaseGenome();
  for (let i = 0; i < 200; i++) { app.neatSheep.mutate(g1, 3); app.neatSheep.mutate(g2, 3); }
  const child = app.neatSheep.crossover(g1, g2);
  assert.ok(child.nodes.length <= Math.max(g1.nodes.length, g2.nodes.length));
  assert.ok(child.conns.length <= Math.max(g1.conns.length, g2.conns.length));
});

test('NEAT brains expose an age input alongside the original senses', () => {
  assert.equal(app.neatSheep.nIn, 14);
  assert.equal(app.neatSheep.names.length, app.neatSheep.nIn + app.neatSheep.nOut);
  assert.equal(app.neatSheep.names[9], 'Wiek');
  assert.equal(app.neatWolf.names[9], 'Wiek');

  const g = app.neatSheep.createBaseGenome();
  const out = app.neatSheep.activate(g, new Array(app.neatSheep.nIn).fill(0.1));
  assert.equal(out.length, app.neatSheep.nOut);
});

test('sheep with more children earn a much higher fitness reward', () => {
  const withChildren = app.makeAnimal('sheep', 10, 10, app.neatSheep.createBaseGenome());
  const withoutChildren = app.makeAnimal('sheep', 40, 40, app.neatSheep.createBaseGenome());
  withChildren.metrics.children = 2;
  withIsolatedEcosystemState({ sheep: [withChildren, withoutChildren], wolves: [], plants: [] }, () => {
    app.updateSheep(app.P.plant, 1, 1, []);
    assert.ok(Math.abs((withChildren.g.fitness - withoutChildren.g.fitness) - 2 * 90) < 1e-6);
  });
});

test('sheep gain an evasion fitness bonus for surviving close to a wolf, mirroring the wolf kill bonus', () => {
  const brave = app.makeAnimal('sheep', 10, 10, app.neatSheep.createBaseGenome());
  const safe = app.makeAnimal('sheep', 40, 40, app.neatSheep.createBaseGenome());
  brave.metrics.closeCallsSurvived = 10;
  withIsolatedEcosystemState({ sheep: [brave, safe], wolves: [], plants: [] }, () => {
    app.updateSheep(app.P.plant, 1, 1, []);
    assert.ok(Math.abs((brave.g.fitness - safe.g.fitness) - 10 * app.EVASION_BONUS_PER_TICK) < 1e-6);
  });
});

test('updateSheep only counts a close call when a wolf is within the danger radius, not merely in sight', () => {
  const sheepNear = app.makeAnimal('sheep', 10, 10, app.neatSheep.createBaseGenome());
  const wolfNear = app.makeAnimal('wolf', 10 + app.THREAT_EVASION_RADIUS - 1, 10, app.neatWolf.createBaseGenome());
  const sheepFar = app.makeAnimal('sheep', 50, 50, app.neatSheep.createBaseGenome());
  const wolfFar = app.makeAnimal('wolf', 50 + app.THREAT_EVASION_RADIUS + 5, 50, app.neatWolf.createBaseGenome());
  withIsolatedEcosystemState({ sheep: [sheepNear, sheepFar], wolves: [wolfNear, wolfFar], plants: [] }, () => {
    app.updateSheep(app.P.plant, 1, 1, []);
  });
  assert.equal(sheepNear.metrics.closeCallsSurvived, 1);
  assert.equal(sheepFar.metrics.closeCallsSurvived, 0);
});

test('step() throttles the expensive record save instead of writing to storage every tick', () => {
  const sheepArr = Array.from({ length: 20 }, (_, i) => app.makeAnimal('sheep', i, i, app.neatSheep.createBaseGenome()));
  const wolfArr = Array.from({ length: 5 }, (_, i) => app.makeAnimal('wolf', i, i, app.neatWolf.createBaseGenome()));
  withIsolatedEcosystemState({
    sheep: sheepArr, wolves: wolfArr, plants: [],
    tick: 5000, epochTimer: 0, ecosystemUptime: 1000, bestEcosystemUptime: 999,
    lastRecordSaveTick: 5000 // a save just happened on this very tick
  }, () => {
    app.step(); // still beats the record, but well within the throttle window
    let after = app.getEcosystemStateForTests();
    assert.equal(after.bestEcosystemUptime, 1001, 'the record itself must still update every tick');
    assert.equal(after.lastRecordSaveTick, 5000, 'the actual storage write must not repeat on every tick');

    app.setEcosystemStateForTests({ lastRecordSaveTick: after.tick - app.RECORD_SAVE_INTERVAL_TICKS });
    app.step(); // now enough ticks have passed since the last save
    after = app.getEcosystemStateForTests();
    assert.equal(after.lastRecordSaveTick, after.tick, 'a save should be allowed again once the throttle window elapses');
  });
});

test('saveStateToStorage() never lets a worse/stale tab clobber a better "Rekord Świata" already saved by another tab', () => {
  // Regression guard: multiple browser tabs on the same origin can run concurrently (e.g. one
  // old tab still running pre-fix code next to a fresh one with a great run). Each tab only
  // compares against its OWN best-seen uptime, so a naive save would blindly overwrite whatever
  // better record another tab already persisted. saveStateToStorage() must read-before-write
  // and keep the higher value instead.
  withIsolatedEcosystemState({
    sheep: [], wolves: [], plants: [],
    tick: 100, ecosystemUptime: 50, bestEcosystemUptime: 50
  }, () => {
    const originalStorage = global.localStorage;
    global.localStorage = createMockLocalStorage({
      [app.STORAGE_KEY]: JSON.stringify({ bestEcosystemUptime: 30079, tick: 1, nextId: 1, plants: [], sheep: [], wolves: [] })
    });
    try {
      app.saveStateToStorage();
      const after = app.getEcosystemStateForTests();
      assert.equal(after.bestEcosystemUptime, 30079, 'the worse local record must adopt the better one already in storage');
      const saved = JSON.parse(global.localStorage.getItem(app.STORAGE_KEY));
      assert.equal(saved.bestEcosystemUptime, 30079, 'the persisted record must keep reflecting the better value, not regress');
    } finally {
      global.localStorage = originalStorage;
    }
  });
});

test('a wolf that never finds prey starves out well before the old ~2360-2780 tick survival time', () => {
  const wolf = app.makeAnimal('wolf', 32, 32, app.neatWolf.createBaseGenome());
  withIsolatedEcosystemState({ sheep: [], wolves: [wolf], plants: [] }, () => {
    let ticks = 0;
    while (wolf.e > 0 && ticks < 5000) {
      app.updateWolves(app.P.plant, 1);
      ticks++;
    }
    assert.ok(ticks < 2200, `a hungry, prey-less wolf should starve out well under the old survival time, took ${ticks} ticks`);
  });
});

test('wolves with more children earn a much higher fitness reward', () => {
  const withChildren = app.makeAnimal('wolf', 10, 10, app.neatWolf.createBaseGenome());
  const withoutChildren = app.makeAnimal('wolf', 40, 40, app.neatWolf.createBaseGenome());
  withChildren.metrics.children = 2;
  withIsolatedEcosystemState({ sheep: [], wolves: [withChildren, withoutChildren], plants: [] }, () => {
    app.updateWolves(app.P.plant, 1);
    assert.ok(Math.abs((withChildren.g.fitness - withoutChildren.g.fitness) - 2 * 70) < 1e-6);
  });
});
