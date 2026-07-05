"use strict";
// =============================================================
// ARCHITEKTURA: KOMPOZYCJA, NIE DZIEDZICZENIE
// =============================================================
// Ten plik celowo NIE modeluje owiec/wilków przez klasy i dziedziczenie
// (Animal -> Sheep/Wolf). Oba gatunki różnią się bardziej tym, CO POTRAFIĄ
// (dieta, legowisko, nagon stadny) niż tym, CZYM SĄ — sztywna hierarchia klas
// zmuszałaby np. do przeciągania pól specyficznych dla wilka (den,
// carriedFood) do wspólnej klasy bazowej, albo do sztucznych klas pośrednich.
//
// Zamiast tego: zwierzę to zwykły obiekt danych złożony z niezależnych cech
// (makeAnimal → createLineageTrait/createDenTrait), a każdy krok symulacji to
// mała, wielokrotnego użytku funkcja ("system") komponowana w
// updateWolves/updateSheep — np. tickAgeAndCooldown, vitalsSense,
// turnHeading, moveAndMeasure, applyMetabolism. Zachowania specyficzne dla
// gatunku (dieta, wzór fitness, zachowanie stadne) zostają jawne i osobne
// w każdej funkcji, zamiast być ukryte za nadpisywaniem metod.
//
// Wyjątek: silnik NEAT w neat.js celowo UŻYWA klas (NEATCore/Species) —
// tam pasują naturalnie, bo mają złożony, hermetyczny stan wewnętrzny
// (liczniki innowacji, przynależność do gatunku) i jasną tożsamość obiektową.
// =============================================================
// 1. PODSTAWOWE FUNKCJE POMOCNICZE
// =============================================================
const hasBrowserDom = typeof window !== "undefined" && typeof document !== "undefined";
if (typeof module !== "undefined" && module.exports) {
  const mathUtils = require("./math.js");
  globalThis.clamp = mathUtils.clamp;
  globalThis.rand = mathUtils.rand;
  globalThis.angNorm = mathUtils.angNorm;
  const { NEATCore } = require("./neat.js");
  globalThis.NEATCore = NEATCore;
}
// =============================================================
// 2. KONFIGURACJA ŚWIATA I EKOSYSTEMU
// =============================================================
const WORLD = 96;
const EAT = 1.3;
const REPRO = 4.0;
const SIM_STEPS_PER_SECOND = 24;
const FIXED_STEP_MS = 1000 / SIM_STEPS_PER_SECOND;
const LINEAGE_HISTORY_LIMIT = 20; // formatLineage() only ever displays the last 6 anyway
const DEN_REST_RADIUS = 3;
const DEN_FOOD_SHARE = 0.5; // fraction of a kill's energy carried home instead of eaten on the spot
const DEN_DELIVERY_BONUS = 40; // fitness reward for successfully bringing carried food back to the den
const PLANT_SEED_NEARBY_CHANCE = 0.8;
const PLANT_SEED_MIN_DIST = 1;
const PLANT_SEED_MAX_DIST = 5;
const SHEEP_RESTOCK_BASE = 15;
const SHEEP_RESTOCK_PER_WOLF = 1; // extra restocked sheep per currently-alive wolf
const THREAT_EVASION_RADIUS = 5; // "real danger" zone — closer than this counts as a genuine close call
const EVASION_BONUS_PER_TICK = 1.5; // fitness reward per tick a sheep survives within that danger zone (~80 ticks of survived danger ~= one wolf kill's killBonus)
const SHEEP_RESTOCK_MUTATION_POWER = 0.8; // gentler than the old 1.5 — preserves the champion's evolved qualities instead of blasting them away
const HUNGRY_ENERGY_RATIO = 0.4; // below this fraction of maxEnergy, an animal feels hungry (also drives the visual tint)
const WELL_FED_ENERGY_RATIO = 0.8; // above this fraction of maxEnergy, an animal feels full (also drives the visual tint)
const PLANT_MIN_SPACING = 0.5; // minimum allowed distance between any two plants, so new growth can't land on top of existing plants
const PLANT_SPAWN_MAX_ATTEMPTS = 5; // give up on this spawn attempt if no free spot is found nearby (a crowded area just grows more slowly)

// Geny bazowe organizmów
const BASE_GENES_SHEEP = { speed: 0.48, turnRate: 0.16, vision: 20, metabolism: 0.082, moveCost: 0.038, maxEnergy: 190, maxAge: 1250, maturityAge: 220, maturityEnergy: 85, reproductionCost: 34 };
const BASE_GENES_WOLF = { speed: 0.49, turnRate: 0.18, vision: 20, metabolism: 0.17, moveCost: 0.042, maxEnergy: 320, maxAge: 1450, maturityAge: 280, maturityEnergy: 180, reproductionCost: 54 };

// Parametry świata
const P = {
  plantGrow:1, mutPow:1,
  sheep:{ plantE:62, born:58, cool:32, cap:700 },
  wolf: { sheepE:58, born:104, cool:82, cap:350 },
  // spawn=5 celowo NIE skaluje się proporcjonalnie do cap jak wcześniej — realne
  // zapotrzebowanie owiec na jedzenie w stanie ustabilizowanym to ~1 roślina/tick nawet
  // przy pełnym limicie 700 owiec, więc 5/tick to bezpieczny margines (~5x), a mapa
  // zapełnia się z pustej w ~500 ticków (~21s przy 1x) zamiast nienaturalnych ~5.5s.
  plant:{ cap:2500, spawn:5, grow:0.016, edible:0.5, lifeMin:650, lifeMax:1450 }
};
const SEED_SHEEP = [[1, 0, 1.6], [4, 0, -2.0], [3, 1, 2.2], [0, 1, 0.7], [8, 1, 0.5]];
const SEED_WOLF = [[1, 0, 1.9], [0, 1, 1.7], [5, 1, 0.6]];
const neatSheep = new NEATCore(14, 3, ["Roślina blisko", "Roślina bok", "Roślina przód", "Wilk blisko", "Wilk bok", "Wilk przód", "Stado", "Energia", "Bias", "Wiek", "Płot blisko", "Płot bok", "Płot przód", "Głód", "Skręt", "Ruch", "Rozmnażaj"], SEED_SHEEP, BASE_GENES_SHEEP);
const neatWolf = new NEATCore(17, 4, ["Owca blisko", "Owca bok", "Owca przód", "Roślina blisko", "Roślina bok", "Roślina przód", "Wataha", "Energia", "Bias", "Wiek", "Legowisko blisko", "Legowisko bok", "Legowisko przód", "Płot blisko", "Płot bok", "Płot przód", "Głód", "Skręt", "Ruch", "Naganiaj", "Rozmnażaj"], SEED_WOLF, BASE_GENES_WOLF);
// =============================================================
// 3. STAN SYMULACJI
// =============================================================
let plants=[], sheep=[], wolves=[];
// Najlepszy genom owcy widziany "na żywo", odświeżany co tick — w przeciwieństwie do
// neatSheep.protectedChampions (aktualizowanego tylko raz na 800-tickową epokę), dzięki
// temu awaryjne odtworzenie populacji podczas złej passy korzysta ze świeżej adaptacji,
// a nie wciąż tego samego, coraz bardziej nieaktualnego championa z ostatniej epoki.
let sheepBestGenomeSeen = null;
let tick=0, nextId=1, selId=null, epochTimer=0;
let ecosystemUptime = 0, bestEcosystemUptime = 0;
let lastRecordSaveTick = -Infinity;
const RECORD_SAVE_INTERVAL_TICKS = 100;
let lastRestockTick = -Infinity;
const RESTOCK_COOLDOWN_TICKS = 60;
let lastFrameTime = 0;
let simAccumulator = 0;
let frameDropCounter = 0;
let frameRenderCounter = 0;
const STORAGE_KEY = "ecosystem-neat-state";
function Plant(x,y){ return {x,y,g:rand(0,.3), age:0, life:rand(P.plant.lifeMin,P.plant.lifeMax)}; }
function createDefaultMetrics(){
  return { kills: 0, plants: 0, children: 0, dist: 0, avgEnergy: 0, efficiency: 0, survival: 0, energySum: 0, energySamples: 0, denDeliveries: 0, closeCallsSurvived: 0 };
}
function serializeGenome(g){
  return {
    kind: g.reg === neatSheep ? "sheep" : "wolf",
    nodes: g.nodes,
    conns: g.conns,
    stats: g.stats,
    fitness: g.fitness,
    rawFitness: g.rawFitness,
    sharedFitness: g.sharedFitness,
    speciesId: g.speciesId,
    gen: g.gen,
    lastBreedSignal: g.lastBreedSignal
  };
}
function sanitizeForStorage(value, seen = new Set()){
  if(Array.isArray(value)) return value.map(item => sanitizeForStorage(item, seen));
  if(value && typeof value === "object"){
    if(seen.has(value)) return undefined; // breaks circular/mutual references (e.g. a wolf's tThreat pointing at a sheep that points back)
    seen.add(value);
    const clone = {};
    for(const key of Object.keys(value)){
      if(key === "reg") continue;
      clone[key] = sanitizeForStorage(value[key], seen);
    }
    seen.delete(value);
    return clone;
  }
  return value;
}
function deserializeGenome(data, kind){
  const core = kind === "sheep" ? neatSheep : neatWolf;
  const g = core.createBaseGenome();
  g.nodes = Array.isArray(data.nodes) ? data.nodes : [];
  g.conns = Array.isArray(data.conns) ? data.conns : [];
  g.stats = data.stats || (kind === "sheep" ? BASE_GENES_SHEEP : BASE_GENES_WOLF);
  g.fitness = data.fitness || 0;
  g.rawFitness = data.rawFitness || data.fitness || 0;
  g.sharedFitness = data.sharedFitness || 0;
  g.speciesId = data.speciesId || null;
  g.gen = data.gen || 1;
  g.lastBreedSignal = data.lastBreedSignal || 0;
  g.dirty = true;
  g.reg = core;
  return g;
}
function restoreNEATState(core, genomes){
  let maxNodeId = core.nodeCounter;
  let maxInnov = core.innovCounter;
  for(const g of genomes){
    for(const n of g.nodes || []){ if((n.id||0) >= maxNodeId) maxNodeId = (n.id||0) + 1; }
    for(const c of g.conns || []){
      if((c.innov||0) >= maxInnov) maxInnov = (c.innov||0) + 1;
      const key = `${c.a}-${c.b}`;
      core.innovMap.set(key, c.innov);
      if((c.a||0) >= maxNodeId) maxNodeId = (c.a||0) + 1;
      if((c.b||0) >= maxNodeId) maxNodeId = (c.b||0) + 1;
    }
  }
  core.nodeCounter = maxNodeId;
  core.innovCounter = maxInnov;
}
function serializeState(){
  const payload = {
    tick,
    nextId,
    ecosystemUptime,
    bestEcosystemUptime,
    plants,
    sheep: sheep.map(a => ({ ...a, g: serializeGenome(a.g) })),
    wolves: wolves.map(a => ({ ...a, g: serializeGenome(a.g) }))
  };
  return JSON.stringify(sanitizeForStorage(payload));
}
function loadStateFromText(text){
  try {
    const data = JSON.parse(text);
    plants = (data.plants || []).map(p => ({ ...p }));
    sheep = (data.sheep || []).map(a => ({ ...a, g: deserializeGenome(a.g, "sheep") }));
    wolves = (data.wolves || []).map(a => ({ ...a, g: deserializeGenome(a.g, "wolf") }));
    tick = data.tick || 0;
    nextId = data.nextId || 1;
    ecosystemUptime = data.ecosystemUptime || 0;
    bestEcosystemUptime = data.bestEcosystemUptime || 0;
    restoreNEATState(neatSheep, sheep.map(a => a.g));
    restoreNEATState(neatWolf, wolves.map(a => a.g));
    sheep.forEach(a => { if(!a.metrics) a.metrics = createDefaultMetrics(); if(a.carriedFood === undefined) a.carriedFood = 0; });
    wolves.forEach(a => { if(!a.metrics) a.metrics = createDefaultMetrics(); if(a.carriedFood === undefined) a.carriedFood = 0; });
    selId = null;
    return true;
  } catch (err) {
    console.warn("Nie udało się wczytać stanu", err);
    return false;
  }
}
function saveStateToStorage(){
  try {
    // Kilka kart przeglądarki na tym samym originie potrafi działać równolegle (np. jedna
    // stara karta z sprzed poprawek obok nowej z dobrym przebiegiem). Bez tego zapis z karty
    // o gorszym/starszym przebiegu bezwarunkowo nadpisywałby "Rekord Świata" zapisany
    // wcześniej przez inną, lepszą kartę — ponieważ każda karta porównuje tylko swój własny
    // dotychczasowy najlepszy wynik, nie to, co faktycznie jest już w localStorage.
    const existingRaw = localStorage.getItem(STORAGE_KEY);
    if(existingRaw){
      const existing = JSON.parse(existingRaw);
      if((existing.bestEcosystemUptime||0) > bestEcosystemUptime) bestEcosystemUptime = existing.bestEcosystemUptime;
    }
    localStorage.setItem(STORAGE_KEY, serializeState());
    return true;
  } catch (err) {
    console.warn("Nie udało się zapisać stanu", err);
    return false;
  }
}
function loadStateFromStorage(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    return loadStateFromText(raw);
  } catch (err) {
    console.warn("Nie udało się wczytać stanu z pamięci", err);
    return false;
  }
}
// =============================================================
// KOMPOZYCJA ZWIERZĘCIA — makeAnimal() składa gotowy obiekt z
// niezależnych, nazwanych "cech" zamiast jednego wielkiego
// literału. Każdą cechę można czytać, testować i zmieniać osobno.
// =============================================================
function createLineageTrait(parents){
  const primaryParent = parents[0];
  return (primaryParent && Array.isArray(primaryParent.lineage) ? primaryParent.lineage : [])
    .concat(parents.map(p => p.id))
    .slice(-LINEAGE_HISTORY_LIMIT);
}
function createDenTrait(kind, x, y){
  return kind === "wolf" ? { x, y } : null;
}
function makeAnimal(kind, x, y, genome, parents = []) {
  if(kind === "sheep") neatSheep.speciate(genome); else neatWolf.speciate(genome);
  return {
    id: nextId++,
    kind,
    x,
    y,
    h: rand(0, Math.PI * 2),
    e: genome.stats.maxEnergy * 0.55,
    g: genome,
    age: 0,
    cool: 0,
    fitness: 0,
    tPlant: null,
    tThreat: null,
    herdIntent: 0,
    lineage: createLineageTrait(parents),
    den: createDenTrait(kind, x, y),
    carriedFood: 0,
    parentIds: parents.map(p => p.id),
    metrics: createDefaultMetrics()
  };
}
function createInitialPopulation() {
  for(let i=0; i<P.plant.cap*0.65; i++) plants.push(Plant(rand(WORLD), rand(WORLD)));
  for(let i=0; i<34; i++) {
    const g = neatSheep.createBaseGenome();
    neatSheep.mutate(g, 1.0);
    sheep.push(makeAnimal("sheep", rand(WORLD), rand(WORLD), g));
  }
  for(let i=0; i<6; i++) {
    const g = neatWolf.createBaseGenome();
    neatWolf.mutate(g, 1.0);
    wolves.push(makeAnimal("wolf", rand(WORLD), rand(WORLD), g));
  }
}
function initEcosystem() {
  plants=[]; sheep=[]; wolves=[]; nextId=1; tick=0; epochTimer=0; ecosystemUptime = 0; lastRecordSaveTick = -Infinity; lastRestockTick = -Infinity; sheepBestGenomeSeen = null;
  createInitialPopulation();
}
function shouldSkipCandidateObject(object, predicate){
  return Boolean(predicate && !predicate(object));
}
// Siatka przestrzenna: zamiast liniowo przeszukiwać CAŁĄ tablicę na każde zapytanie
// (O(n) na zapytanie, O(n^2) na cały tick), dzielimy świat na komórki cellSize x cellSize
// i przeszukujemy tylko komórki w promieniu zasięgu wzroku danego zwierzęcia.
const SPATIAL_GRID_CELL_SIZE = 20;
function spatialKey(x, y, cellSize){
  return `${Math.floor(x/cellSize)},${Math.floor(y/cellSize)}`;
}
function buildSpatialGrid(arr, cellSize = SPATIAL_GRID_CELL_SIZE){
  const cells = new Map();
  for(const o of arr){
    const key = spatialKey(o.x, o.y, cellSize);
    let cell = cells.get(key);
    if(!cell){ cell = []; cells.set(key, cell); }
    cell.push(o);
  }
  return { cells, cellSize };
}
function removeFromSpatialGrid(grid, o){
  const cell = grid.cells.get(spatialKey(o.x, o.y, grid.cellSize));
  if(!cell) return;
  const i = cell.indexOf(o);
  if(i >= 0) cell.splice(i, 1);
}
function insertIntoSpatialGrid(grid, o){
  const key = spatialKey(o.x, o.y, grid.cellSize);
  let cell = grid.cells.get(key);
  if(!cell){ cell = []; grid.cells.set(key, cell); }
  cell.push(o);
}
function nearestInGrid(x, y, grid, pred, visionLimit){
  const { cells, cellSize } = grid;
  const cx = Math.floor(x/cellSize), cy = Math.floor(y/cellSize);
  const r = Math.max(1, Math.ceil(visionLimit/cellSize));
  let best=null, bd=visionLimit*visionLimit;
  for(let dx=-r; dx<=r; dx++){
    for(let dy=-r; dy<=r; dy++){
      const cell = cells.get(`${cx+dx},${cy+dy}`);
      if(!cell) continue;
      for(const o of cell){
        if(shouldSkipCandidateObject(o, pred)) continue;
        const ddx=o.x-x, ddy=o.y-y, d=ddx*ddx+ddy*ddy;
        if(d<bd){bd=d; best=o;}
      }
    }
  }
  return best ? {o:best, d:Math.sqrt(bd)} : null;
}
function shouldWrapAnimalOnBoundary(animal){
  return animal.x <= 0 || animal.x >= WORLD || animal.y <= 0 || animal.y >= WORLD;
}
function shouldEatPrey(wolf, preyTarget){
  return Boolean(preyTarget && preyTarget.d < EAT);
}
function shouldEatPlant(sheep, plantTarget){
  return Boolean(plantTarget && plantTarget.d < EAT);
}
function shouldReproducePair(a, b, baseChance = 0.35){
  const signal = Math.min(a.g.lastBreedSignal || 0, b.g.lastBreedSignal || 0);
  return Math.random() < signal * baseChance;
}
function shouldRestoreMissingSheepPopulation(){
  return sheep.length < 10;
}
function shouldRestoreMissingWolfPopulation(){
  return wolves.length < 2;
}
function isMature(animal, stats){
  return animal.age >= stats.maturityAge || animal.e >= stats.maturityEnergy;
}
function senseTo(a,t,visionLimit){
  if(!t) return [0,0,0];
  const dx=t.o.x-a.x, dy=t.o.y-a.y;
  const rel=angNorm(Math.atan2(dy,dx)-a.h);
  return [1 - clamp(t.d/visionLimit,0,1), Math.sin(rel), Math.cos(rel)];
}
function crowd(a,grid,visionLimit){ const t=nearestInGrid(a.x,a.y,grid,o=>o.id!==a.id,visionLimit); return t?1-clamp(t.d/visionLimit,0,1):0; }
function nearestBoundaryPoint(x,y){
  const distLeft=x, distRight=WORLD-x, distBottom=y, distTop=WORLD-y;
  const minDist = Math.min(distLeft, distRight, distBottom, distTop);
  if(minDist===distLeft) return { o:{x:0,y}, d:distLeft };
  if(minDist===distRight) return { o:{x:WORLD,y}, d:distRight };
  if(minDist===distBottom) return { o:{x,y:0}, d:distBottom };
  return { o:{x,y:WORLD}, d:distTop };
}
// =============================================================
// 4. SYMULACJA EKOSYSTEMU
// =============================================================
function getEcosystemBalance() {
  const pc = P.plant;
  const plantCover = plants.length / pc.cap;
  const sheepDensity = sheep.length / P.sheep.cap;
  const wolfDensity = wolves.length / P.wolf.cap;
  const balanceScore = clamp(
    1 - Math.abs(plantCover - 0.42) * 0.8 - Math.abs(sheepDensity - 0.35) * 0.55 - Math.abs(wolfDensity - 0.16) * 0.65,
    0.05,
    1
  );
  const plantRecovery = 1 + clamp(1 - plantCover, 0, 1) * 0.12;
  return { plantCover, sheepDensity, wolfDensity, balanceScore, plantRecovery };
}
function shouldSpawnMorePlants(remainingSpawn, plantCount, maxPlants){
  return remainingSpawn > 0 && plantCount < maxPlants;
}
function spawnPlantCandidate(){
  if(plants.length > 0 && Math.random() < PLANT_SEED_NEARBY_CHANCE){
    const parent = plants[Math.floor(Math.random()*plants.length)];
    const angle = rand(0, Math.PI*2);
    const dist = rand(PLANT_SEED_MIN_DIST, PLANT_SEED_MAX_DIST);
    return Plant(clamp(parent.x+Math.cos(angle)*dist, 0, WORLD), clamp(parent.y+Math.sin(angle)*dist, 0, WORLD));
  }
  return Plant(rand(WORLD), rand(WORLD));
}
function spawnPlant(grid = buildSpatialGrid(plants)){
  for(let attempt=0; attempt<PLANT_SPAWN_MAX_ATTEMPTS; attempt++){
    const candidate = spawnPlantCandidate();
    if(!nearestInGrid(candidate.x, candidate.y, grid, null, PLANT_MIN_SPACING)) return candidate;
  }
  return null; // area too crowded right now — skip this attempt rather than overlap an existing plant
}
function updatePlants(pc, plantRecovery){
  for(const p of plants){ p.age++; if(p.g<1) p.g=Math.min(1,p.g+pc.grow*P.plantGrow*plantRecovery); }
  plants = plants.filter(p=>p.age<p.life);
  const plantsGrid = buildSpatialGrid(plants);
  let toSpawn=pc.spawn*P.plantGrow;
  while(shouldSpawnMorePlants(toSpawn, plants.length, pc.cap)){
    if(Math.random()<toSpawn){
      const p = spawnPlant(plantsGrid);
      if(p){ plants.push(p); insertIntoSpatialGrid(plantsGrid, p); }
    }
    toSpawn-=1;
  }
}
// =============================================================
// "SYSTEMY" RUCHU/METABOLIZMU — komponowane w updateWolves/updateSheep
// zamiast duplikować tę samą logikę w obu funkcjach osobno.
// =============================================================
function tickAgeAndCooldown(a){ a.age++; if(a.cool>0) a.cool--; }
function vitalsSense(a, stats){
  const ageSignal = clamp(a.age / stats.maxAge, 0, 1);
  return [(a.e/stats.maxEnergy)*2-1, 1, ageSignal];
}
// "Energia" (w vitalsSense) to surowy, liniowy poziom energii na całej skali.
// "Głód" to osobny sygnał, wyraźnie nasycony w okolicach progów głodny/najedzony —
// te same progi, których już używamy wizualnie (kolor wilka) — więc zwierzę "wie",
// że jest syte albo głodne, dokładnie tak, jak to widać na ekranie.
function hungerSense(a, stats){
  const ratio = a.e / stats.maxEnergy;
  if(ratio <= HUNGRY_ENERGY_RATIO) return 1;
  if(ratio >= WELL_FED_ENERGY_RATIO) return -1;
  const span = WELL_FED_ENERGY_RATIO - HUNGRY_ENERGY_RATIO;
  return 1 - 2 * (ratio - HUNGRY_ENERGY_RATIO) / span;
}
function turnHeading(a, turn, stats){ a.h += turn*stats.turnRate; }
function moveAndMeasure(a, thrust, stats){
  const v = (thrust+1)*0.5*stats.speed;
  a.x = clamp(a.x+Math.cos(a.h)*v, 0, WORLD);
  a.y = clamp(a.y+Math.sin(a.h)*v, 0, WORLD);
  a.metrics.dist += v;
  if(shouldWrapAnimalOnBoundary(a)) a.h += rand(-1,1);
  return v;
}
function applyMetabolism(a, stats, v, dietSuccessCount){
  a.e -= stats.metabolism + v*stats.moveCost;
  a.metrics.energySum += a.e;
  a.metrics.energySamples += 1;
  a.metrics.avgEnergy = a.metrics.energySum / Math.max(1, a.metrics.energySamples);
  a.metrics.efficiency = dietSuccessCount > 0 ? dietSuccessCount / Math.max(1, a.metrics.dist / 10) : 0;
  a.metrics.survival = a.age / Math.max(1, stats.maxAge);
}
function updateWolves(pc, balanceScore){
  const wcfg = P.wolf;
  const wolfHerdSignals = [];
  const newborns = [];
  const sheepGrid = buildSpatialGrid(sheep);
  const plantsGrid = buildSpatialGrid(plants);
  const wolvesGrid = buildSpatialGrid(wolves);
  for(const w of wolves){
    tickAgeAndCooldown(w);
    const stats = w.g.stats;
    const ts = nearestInGrid(w.x,w.y,sheepGrid,null, stats.vision);
    const tp = nearestInGrid(w.x,w.y,plantsGrid,p=>p.g>=pc.edible, stats.vision);
    const preyHealthBonus = clamp(sheep.length / Math.max(1, P.sheep.cap), 0, 1) * 32;
    const balanceBonus = balanceScore * 44;
    const plantBonus = tp && tp.o.g >= P.plant.edible ? 4 : 0;
    const energyBonus = clamp((w.e / stats.maxEnergy) * 20, 0, 20);
    const survivalBonus = clamp((w.age / stats.maxAge) * 24, 0, 24);
    const killBonus = w.metrics.kills * 120;
    const herdBonus = w.herdIntent > 0.2 ? 10 * w.herdIntent : 0;
    w.g.fitness = w.age * 0.4 + killBonus + survivalBonus + energyBonus + plantBonus + herdBonus + w.metrics.children * 70 + balanceBonus + preyHealthBonus;
    w.tPlant=tp?tp.o:null; w.tThreat=ts?ts.o:null;
    const denDist = w.den ? Math.hypot(w.den.x-w.x, w.den.y-w.y) : null;
    const denTarget = w.den ? { o: w.den, d: denDist } : null;
    const boundaryTarget = nearestBoundaryPoint(w.x, w.y);
    const inp = [...senseTo(w,ts,stats.vision), ...senseTo(w,tp,stats.vision), crowd(w,wolvesGrid,stats.vision), ...vitalsSense(w,stats), ...senseTo(w,denTarget,stats.vision), ...senseTo(w,boundaryTarget,stats.vision), hungerSense(w,stats)];
    const [turn,thr,herd,breed] = neatWolf.activate(w.g, inp);
    const herdDrive = clamp(herd, -1, 1);
    const breedSignal = clamp(breed, 0, 1);
    w.g.lastBreedSignal = breedSignal;
    w.herdIntent = herdDrive;
    wolfHerdSignals.push({ w, plant: tp?tp.o:null });
    if(tp && tp.d < 8) w.g.fitness += 0.25 * (1 - tp.d/8);
    if(ts && tp && ts.d < 6 && tp.d < 8 && herdDrive > 0.2) w.g.fitness += 1.2;
    turnHeading(w, turn, stats);
    const v = moveAndMeasure(w, thr, stats);
    applyMetabolism(w, stats, v, w.metrics.kills);
    if(shouldEatPrey(w, ts)) {
      w.e = Math.min(stats.maxEnergy, w.e + wcfg.sheepE * (1 - DEN_FOOD_SHARE));
      w.carriedFood += wcfg.sheepE * DEN_FOOD_SHARE;
      w.metrics.kills++;
      ts.o.e = -1;
    }
    if(denDist !== null && denDist < DEN_REST_RADIUS && w.carriedFood > 0) {
      w.e = Math.min(stats.maxEnergy, w.e + w.carriedFood);
      w.carriedFood = 0;
      w.metrics.denDeliveries++;
      w.g.fitness += DEN_DELIVERY_BONUS;
    }
  }
  return { wolfHerdSignals, newborns };
}
function shouldApplyWolfHerdInfluence(signal, wolf, sheepAnimal){
  if(!signal.plant || wolf.herdIntent <= 0.2) return false;
  const distToWolf = Math.hypot(wolf.x - sheepAnimal.x, wolf.y - sheepAnimal.y);
  if(distToWolf >= 6) return false;
  const distToPlant = Math.hypot(signal.plant.x - sheepAnimal.x, signal.plant.y - sheepAnimal.y);
  const influence = wolf.herdIntent * (1 - clamp(distToWolf/6,0,1)) * (1 - clamp(distToPlant/12,0,1));
  return influence > 0.05;
}
function updateSheep(pc, balanceScore, plantCover, wolfHerdSignals){
  const scfg = P.sheep;
  const newborns = [];
  const plantsGrid = buildSpatialGrid(plants);
  const wolvesGrid = buildSpatialGrid(wolves);
  const sheepGrid = buildSpatialGrid(sheep);
  let bestFitnessThisTick = null;
  for(const s of sheep) {
    tickAgeAndCooldown(s);
    const stats = s.g.stats;
    const tp = nearestInGrid(s.x,s.y,plantsGrid,p=>p.g>=pc.edible, stats.vision);
    const tw = nearestInGrid(s.x,s.y,wolvesGrid,null, stats.vision);
    const balanceBonus = balanceScore * 24;
    const foodPressurePenalty = plantCover < 0.18 ? -10 : 0;
    const overgrazingPenalty = plantCover < 0.1 ? -18 : 0;
    const foodBonus = s.metrics.plants * 56;
    const energyBonus = clamp((s.e / stats.maxEnergy) * 14, 0, 14);
    const survivalBonus = clamp((s.age / stats.maxAge) * 20, 0, 20);
    const childBonus = s.metrics.children * 90;
    const evasionBonus = s.metrics.closeCallsSurvived * EVASION_BONUS_PER_TICK;
    const plantAwareness = tp && tp.o.g >= P.plant.edible ? 3 : 0;
    s.g.fitness = s.age * 0.45 + foodBonus + childBonus + evasionBonus + energyBonus + survivalBonus + plantAwareness + balanceBonus + foodPressurePenalty + overgrazingPenalty;
    if(!bestFitnessThisTick || s.g.fitness > bestFitnessThisTick.fitness) bestFitnessThisTick = s.g;
    s.tPlant = tp?tp.o:null; s.tThreat = tw?tw.o:null;
    if(tw && tw.d < THREAT_EVASION_RADIUS) s.metrics.closeCallsSurvived++;
    const boundaryTarget = nearestBoundaryPoint(s.x, s.y);
    const inp = [...senseTo(s,tp,stats.vision),...senseTo(s,tw,stats.vision), crowd(s,sheepGrid,stats.vision), ...vitalsSense(s,stats), ...senseTo(s,boundaryTarget,stats.vision), hungerSense(s,stats)];
    const [turn,thr,breed] = neatSheep.activate(s.g, inp);
    const breedSignal = clamp(breed, 0, 1);
    s.g.lastBreedSignal = breedSignal;
    turnHeading(s, turn, stats);
    for(const signal of wolfHerdSignals){
      const w = signal.w;
      if(!shouldApplyWolfHerdInfluence(signal, w, s)) continue;
      const distToWolf = Math.hypot(w.x-s.x, w.y-s.y);
      const distToPlant = Math.hypot(signal.plant.x-s.x, signal.plant.y-s.y);
      const influence = w.herdIntent * (1 - clamp(distToWolf/6,0,1)) * (1 - clamp(distToPlant/12,0,1));
      const targetAngle = Math.atan2(signal.plant.y-s.y, signal.plant.x-s.x);
      const turnError = angNorm(targetAngle - s.h);
      s.h += clamp(turnError*0.16, -0.35, 0.35) * influence;
      const push = 0.03 * influence;
      s.x = clamp(s.x + Math.cos(s.h)*push, 0, WORLD); s.y = clamp(s.y + Math.sin(s.h)*push, 0, WORLD);
    }
    const v = moveAndMeasure(s, thr, stats);
    applyMetabolism(s, stats, v, s.metrics.plants);
    if(shouldEatPlant(s, tp)) {
      s.e = Math.min(stats.maxEnergy, s.e+scfg.plantE);
      s.metrics.plants++;
      const i=plants.indexOf(tp.o); if(i>=0){ plants.splice(i,1); removeFromSpatialGrid(plantsGrid, tp.o); }
    }
  }
  if(bestFitnessThisTick && (!sheepBestGenomeSeen || bestFitnessThisTick.fitness > sheepBestGenomeSeen.fitness)){
    sheepBestGenomeSeen = neatSheep.cloneGenome(bestFitnessThisTick);
  }
  return { newborns };
}
function finalizeReproduction(sheepNewborns, wolfNewborns){
  const scfg = P.sheep;
  const wcfg = P.wolf;
  if(sheep.length < scfg.cap){
    for(let i=0; i<sheep.length; i++){ const a=sheep[i];
      if(a.cool>0||!isMature(a, a.g.stats)) continue;
      for(let j=i+1; j<sheep.length; j++){ const b=sheep[j];
        if(b.cool>0||!isMature(b, b.g.stats)) continue;
        const dx=a.x-b.x, dy=a.y-b.y; if(dx*dx+dy*dy>REPRO*REPRO) continue;
        if(!shouldReproducePair(a, b, 0.35)) continue;
        const fit = a.g.fitness >= b.g.fitness ? [a,b] : [b,a];
        const childGen = neatSheep.crossover(fit[0].g, fit[1].g);
        neatSheep.mutate(childGen, P.mutPow);
        const c = makeAnimal("sheep", (a.x+b.x)/2+rand(-1,1), (a.y+b.y)/2+rand(-1,1), childGen, [a,b]);
        c.e = scfg.born; a.e -= a.g.stats.reproductionCost; b.e -= b.g.stats.reproductionCost; a.cool = scfg.cool; b.cool = scfg.cool;
        a.metrics.children++; b.metrics.children++;
        sheepNewborns.push(c); break;
      }
    }
  }
  sheep = sheep.filter(s=>s.e>0 && s.age<s.g.stats.maxAge); for(const c of sheepNewborns) if(sheep.length<scfg.cap) sheep.push(c);
  sheep = sheep.filter(s=>s.e>0);
  if(wolves.length < wcfg.cap){
    for(let i=0; i<wolves.length; i++){ const a=wolves[i];
      if(a.cool>0||!isMature(a, a.g.stats)) continue;
      for(let j=i+1; j<wolves.length; j++){ const b=wolves[j];
        if(b.cool>0||!isMature(b, b.g.stats)) continue;
        const dx=a.x-b.x, dy=a.y-b.y; if(dx*dx+dy*dy>REPRO*REPRO) continue;
        const shouldReproduce = shouldReproducePair(a, b, 0.42);
        if(!shouldReproduce) continue;
        const fit = a.g.fitness >= b.g.fitness ? [a,b] : [b,a];
        const childGen = neatWolf.crossover(fit[0].g, fit[1].g);
        neatWolf.mutate(childGen, P.mutPow);
        const denSite = fit[0].den || fit[1].den || { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
        const c = makeAnimal("wolf", clamp(denSite.x+rand(-1,1),0,WORLD), clamp(denSite.y+rand(-1,1),0,WORLD), childGen, [a,b]);
        c.e = wcfg.born; a.e -= a.g.stats.reproductionCost; b.e -= b.g.stats.reproductionCost; a.cool = wcfg.cool; b.cool = wcfg.cool;
        a.metrics.children++; b.metrics.children++;
        wolfNewborns.push(c); break;
      }
    }
  }
  wolves = wolves.filter(w=>w.e>0 && w.age<w.g.stats.maxAge); for(const c of wolfNewborns) if(wolves.length<wcfg.cap) wolves.push(c);
}
function recordHistory(){
  if(tick%3===0){ history.push([sheep.length,wolves.length,plants.length]); if(history.length>240)history.shift(); }
}
function computeSheepRestockCount(){
  // Dosypywanie zawsze tej samej liczby owiec bez względu na stado wilków było
  // problemem: kilkanaście świeżych owiec wpuszczonych między setki doświadczonych
  // wilków ginęło niemal natychmiast. Skalujemy więc partię do aktualnej liczby wilków.
  const scaled = SHEEP_RESTOCK_BASE + wolves.length * SHEEP_RESTOCK_PER_WOLF;
  return Math.max(0, Math.min(P.sheep.cap - sheep.length, scaled));
}
function checkPopulationCollapse(){
  const sheepMissing = shouldRestoreMissingSheepPopulation();
  const wolfMissing = shouldRestoreMissingWolfPopulation();
  if(!sheepMissing && !wolfMissing) return;
  ecosystemUptime = 0;
  if(tick - lastRestockTick < RESTOCK_COOLDOWN_TICKS) return;
  lastRestockTick = tick;
  if(sheepMissing) {
    // Wole sheepBestGenomeSeen (odświeżany co tick) zamiast wyłącznie protectedChampions
    // (zamrożone raz na 800-tickową epokę) — podczas złej passy, gdy owce padają
    // wielokrotnie w tej samej epoce, każdy restock korzysta z najświeższej adaptacji,
    // a nie ciągle tego samego, coraz bardziej nieaktualnego championa.
    const champions = neatSheep.protectedChampions.filter(Boolean);
    const epochChampion = champions.length ? champions.sort((a,b)=>(b.fitness||0)-(a.fitness||0))[0] : null;
    const safeS = sheepBestGenomeSeen || epochChampion;
    const restockCount = computeSheepRestockCount();
    for(let i=0; i<restockCount; i++) { let g = safeS ? neatSheep.cloneGenome(safeS) : neatSheep.createBaseGenome(); neatSheep.mutate(g, SHEEP_RESTOCK_MUTATION_POWER); sheep.push(makeAnimal("sheep", rand(WORLD), rand(WORLD), g)); }
  }
  if(wolfMissing) {
    const champions = neatWolf.protectedChampions.filter(Boolean);
    const safeW = champions.length ? champions.sort((a,b)=>(b.fitness||0)-(a.fitness||0))[0] : null;
    for(let i=0; i<4; i++) { let g = safeW ? neatWolf.cloneGenome(safeW) : neatWolf.createBaseGenome(); neatWolf.mutate(g, 1.5); wolves.push(makeAnimal("wolf", rand(WORLD), rand(WORLD), g)); }
  }
}
function evaluateEpochs(){
  if(epochTimer >= 800) {
    epochTimer = 0;
    neatSheep.epochEvaluate(sheep.map(s => s.g));
    neatWolf.epochEvaluate(wolves.map(w => w.g));
    evolutionHistory.push({ epoch: neatSheep.epochCount, uptime: ecosystemUptime, record: bestEcosystemUptime });
    if(evolutionHistory.length > 240) evolutionHistory.shift();
  }
}
function step() {
  tick++; epochTimer++; ecosystemUptime++;
  const pc = P.plant;
  const balance = getEcosystemBalance();
  const plantCover = balance.plantCover;
  const balanceScore = balance.balanceScore;
  const plantRecovery = balance.plantRecovery;
  updatePlants(pc, plantRecovery);
  const { wolfHerdSignals } = updateWolves(pc, balanceScore);
  const { newborns: sheepNewborns } = updateSheep(pc, balanceScore, plantCover, wolfHerdSignals);
  finalizeReproduction(sheepNewborns, []);
  recordHistory();
  checkPopulationCollapse();
  if(ecosystemUptime > bestEcosystemUptime){
    bestEcosystemUptime = ecosystemUptime;
    if(tick - lastRecordSaveTick >= RECORD_SAVE_INTERVAL_TICKS){
      lastRecordSaveTick = tick;
      saveStateToStorage();
    }
  }
  evaluateEpochs();
}
const history=[];
const evolutionHistory=[]; // { epoch, uptime, record } sampled once per ocena epoki (co 800 ticków) — pokazuje trend "czasu bez zapaści" na przestrzeni kolejnych ewolucji

function getEcosystemStateForTests(){
  return { sheep, wolves, plants, tick, epochTimer, ecosystemUptime, bestEcosystemUptime, lastRecordSaveTick, lastRestockTick, evolutionHistory: evolutionHistory.slice(), sheepBestGenomeSeen };
}
function setEcosystemStateForTests(partial){
  if(partial.sheep !== undefined) sheep = partial.sheep;
  if(partial.wolves !== undefined) wolves = partial.wolves;
  if(partial.plants !== undefined) plants = partial.plants;
  if(partial.tick !== undefined) tick = partial.tick;
  if(partial.epochTimer !== undefined) epochTimer = partial.epochTimer;
  if(partial.ecosystemUptime !== undefined) ecosystemUptime = partial.ecosystemUptime;
  if(partial.bestEcosystemUptime !== undefined) bestEcosystemUptime = partial.bestEcosystemUptime;
  if(partial.evolutionHistory !== undefined){ evolutionHistory.length = 0; evolutionHistory.push(...partial.evolutionHistory); }
  if(partial.lastRecordSaveTick !== undefined) lastRecordSaveTick = partial.lastRecordSaveTick;
  if(partial.lastRestockTick !== undefined) lastRestockTick = partial.lastRestockTick;
  if(partial.sheepBestGenomeSeen !== undefined) sheepBestGenomeSeen = partial.sheepBestGenomeSeen;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createDefaultMetrics,
    sanitizeForStorage,
    serializeState,
    saveStateToStorage,
    STORAGE_KEY,
    shouldReproducePair,
    shouldApplyWolfHerdInfluence,
    shouldRestoreMissingSheepPopulation,
    shouldRestoreMissingWolfPopulation,
    isMature,
    makeAnimal,
    updateSheep,
    updatePlants,
    updateWolves,
    finalizeReproduction,
    checkPopulationCollapse,
    computeSheepRestockCount,
    evaluateEpochs,
    step,
    spawnPlant,
    spawnPlantCandidate,
    insertIntoSpatialGrid,
    PLANT_MIN_SPACING,
    PLANT_SPAWN_MAX_ATTEMPTS,
    Plant,
    buildSpatialGrid,
    nearestInGrid,
    removeFromSpatialGrid,
    SPATIAL_GRID_CELL_SIZE,
    nearestBoundaryPoint,
    WORLD,
    tickAgeAndCooldown,
    vitalsSense,
    turnHeading,
    moveAndMeasure,
    applyMetabolism,
    createLineageTrait,
    createDenTrait,
    getEcosystemStateForTests,
    setEcosystemStateForTests,
    RECORD_SAVE_INTERVAL_TICKS,
    RESTOCK_COOLDOWN_TICKS,
    LINEAGE_HISTORY_LIMIT,
    DEN_REST_RADIUS,
    DEN_FOOD_SHARE,
    DEN_DELIVERY_BONUS,
    PLANT_SEED_MIN_DIST,
    PLANT_SEED_MAX_DIST,
    SHEEP_RESTOCK_BASE,
    SHEEP_RESTOCK_PER_WOLF,
    THREAT_EVASION_RADIUS,
    EVASION_BONUS_PER_TICK,
    SHEEP_RESTOCK_MUTATION_POWER,
    hungerSense,
    HUNGRY_ENERGY_RATIO,
    WELL_FED_ENERGY_RATIO,
    clamp,
    rand,
    P,
    BASE_GENES_SHEEP,
    BASE_GENES_WOLF,
    neatSheep,
    neatWolf
  };
}
