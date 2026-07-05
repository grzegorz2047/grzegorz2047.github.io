"use strict";
// =============================================================
// NEAT ENGINE
// =============================================================
const NEAT_CONFIG = {
  C1: 1.0,
  C2: 1.0,
  C3: 0.4,
  DT_START: 3.0,
  TARGET_SPECIES: 5,
  STAGNATION: 15,
  MUT_LINK: 0.22,
  MUT_NODE: 0.07,
  MUT_WEIGHT: 0.85,
  MUT_GENE: 0.15, // Szansa na mutację pojedynczej cechy fizyczne
ITNESS_SHARING: 1.4,
  ELITISM: 1,
  MAX_NODES: 60,
  MAX_CONNS: 120,
  MAX_SPECIES: 40
};
// Biologiczne granice mutacji cech ciała, jako mnożnik wartości bazowej (baseGenes)
// danego gatunku. Bez tego dobór naturalny może w setkach pokoleń zjechać np.
// z metabolizmu 0.17 do 0.04 albo z maxAge 1450 do 3000 — technicznie to "działa",
// ale to już nie jest ten sam zwierzak, tylko obejście mechanizmów balansu
// (np. celowo podniesionego metabolizmu wilka, żeby ograniczyć przeludnienie).
const GENE_BOUNDS = {
  metabolism: { min: 0.5, max: 2.0 },
  maxAge: { min: 0.6, max: 1.8 }
};
const mathRand = (a=1,b)=> b===undefined ? Math.random()*a : a+Math.random()*(b-a);
const mathRandI = (n)=> (Math.random()*n)|0;
let _g2=null;
function mathGauss(){
  if(_g2!==null){const g=_g2;_g2=null;return g;}
  let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random();
  const m=Math.sqrt(-2*Math.log(u)); _g2=m*Math.sin(2*Math.PI*v); return m*Math.cos(2*Math.PI*v);
}
class Species {
  constructor(id, mascot) {
    this.id = id;
    this.mascot = mascot;
    this.members = [];
    this.topFitness = 0;
    this.epochsSinceImprovement = 0;
    this.champion = mascot;
  }
  add(genome) {
    this.members.push(genome);
    genome.speciesId = this.id;
  }
  reset() {
    if (this.members.length > 0) this.mascot = this.members[mathRandI(this.members.length)];
    this.members = [];
  }
}
class NEATCore {
  constructor(nIn, nOut, names, seedConns, baseGenes) {
    this.nIn = nIn;
    this.nOut = nOut;
    this.names = names;
    this.seedConns = seedConns;
    this.baseGenes = baseGenes; // Baza startowa genotypu (Etap 2)
    this.innovMap = new Map();
    this.innovCounter = 0;
    this.nodeCounter = nIn + nOut;
    this.species = [];
    this.nextSpeciesId = 1;
    this.DT = NEAT_CONFIG.DT_START;
    this.epochCount = 0;
    this.protectedChampions = [];
  }
  getInnov(inId, outId) {
    const key = `${inId}-${outId}`;
    if (this.innovMap.has(key)) return this.innovMap.get(key);
    const val = this.innovCounter++;
    this.innovMap.set(key, val);
    return val;
  }
  createBaseGenome() {
    const nodes = [];
    for(let i=0; i<this.nIn; i++) nodes.push({id: i, type: "in"});
    for(let o=0; o<this.nOut; o++) nodes.push({id: this.nIn + o, type: "out"});
    const conns = [];
    for(const [a, o, w] of this.seedConns) {
      conns.push({ innov: this.getInnov(a, this.nIn + o), a, b: this.nIn + o, w: w + mathGauss()*0.25, enabled: true });
    }
    // Genotyp fizyczny (Etap 2)
    const stats = { ...this.baseGenes };
    return { reg: this, nodes, conns, dirty: true, fitness: 0, rawFitness: 0, sharedFitness: 0, speciesId: null, gen: 1, stats };
  }
  cloneGenome(g) {
    return {
      reg: this, dirty: true, fitness: g.fitness || 0, rawFitness: g.rawFitness || g.fitness || 0, sharedFitness: g.sharedFitness || 0, speciesId: null, gen: g.gen,
      nodes: g.nodes.map(n => ({...n})),
      conns: g.conns.map(c => ({...c})),
      stats: { ...g.stats } // Klonowanie parametrów ciała
    };
  }
  shouldUseConnection(c, inc){
    return c.enabled && inc.has(c.b) && inc.has(c.a);
  }
  activate(g, inputs) {
    if(g.dirty) {
      const inc=new Map(), typ=new Map(), indeg=new Map(), adj=new Map();
      for(const n of g.nodes){ inc.set(n.id,[]); typ.set(n.id,n.type); indeg.set(n.id,0); adj.set(n.id,[]); }
      for(const c of g.conns){
        if(!this.shouldUseConnection(c, inc)) continue;
        inc.get(c.b).push(c); adj.get(c.a).push(c.b); indeg.set(c.b,indeg.get(c.b)+1);
      }
      const q=[], order=[];
      for(const n of g.nodes) if(indeg.get(n.id)===0) q.push(n.id);
      while(q.length){ const id=q.shift(); order.push(id);
        for(const nb of adj.get(id)){ indeg.set(nb,indeg.get(nb)-1); if(indeg.get(nb)===0) q.push(nb); }
      }
      g._order=order; g._inc=inc; g._typ=typ; g.dirty=false;
    }
    const val = new Map();
    for(let i=0; i<this.nIn; i++) val.set(i, inputs[i]);
    for(const id of g._order){
      if(g._typ.get(id)==="in") continue;
      let s=0; for(const c of g._inc.get(id)) s+=(val.get(c.a)||0)*c.w;
      val.set(id, Math.tanh(s));
    }
    const out=[]; for(let o=0; o<this.nOut; o++) out.push(val.get(this.nIn+o)||0);
    return out;
  }
  distance(g1, g2) {
    let match=0, disjoint=0, excess=0, weightDiff=0;
    const m1 = new Map(g1.conns.map(c => [c.innov, c]));
    const m2 = new Map(g2.conns.map(c => [c.innov, c]));
    const maxInnov1 = g1.conns.length ? Math.max(...g1.conns.map(c=>c.innov)) : 0;
    const maxInnov2 = g2.conns.length ? Math.max(...g2.conns.map(c=>c.innov)) : 0;
    for(const c1 of g1.conns) {
      if(m2.has(c1.innov)) { match++; weightDiff += Math.abs(c1.w - m2.get(c1.innov).w); }
      else if(c1.innov > maxInnov2) excess++; else disjoint++;
    }
    for(const c2 of g2.conns) {
      if(!m1.has(c2.innov)) { if(c2.innov > maxInnov1) excess++; else disjoint++; }
    }
    const N = Math.max(g1.conns.length, g2.conns.length, 1);
    const wAvg = match > 0 ? weightDiff / match : 0;
    return (NEAT_CONFIG.C1*excess)/N + (NEAT_CONFIG.C2*disjoint)/N + NEAT_CONFIG.C3*wAvg;
  }
  shouldJoinSpecies(species, genome){
    return this.distance(genome, species.mascot) < this.DT;
  }
  speciate(genome) {
    for (const s of this.species) {
      if (this.shouldJoinSpecies(s, genome)) { s.add(genome); return; }
    }
    if (this.species.length >= NEAT_CONFIG.MAX_SPECIES) {
      let nearest = this.species[0], bestDist = Infinity;
      for (const s of this.species) {
        const d = this.distance(genome, s.mascot);
        if (d < bestDist) { bestDist = d; nearest = s; }
      }
      nearest.add(genome);
      return;
    }
    const newSpecies = new Species(this.nextSpeciesId++, genome);
    newSpecies.add(genome);
    this.species.push(newSpecies);
  }
  reaches(g, from, to){
    const stack=[from], seen=new Set();
    while(stack.length){ const x=stack.pop(); if(x===to) return true;
      if(seen.has(x)) continue; seen.add(x);
      for(const c of g.conns) if(c.a===x) stack.push(c.b);
    } return false;
  }
  mutate(g, power) {
    for(const c of g.conns){
      if(Math.random()<NEAT_CONFIG.MUT_WEIGHT) c.w += mathGauss()*0.35*power;
      else c.w = mathGauss()*0.9;
      if(!c.enabled && Math.random()<0.02*power) c.enabled=true;
    }
    if(Math.random() < NEAT_CONFIG.MUT_LINK*power && g.conns.length < NEAT_CONFIG.MAX_CONNS) {
      const froms = g.nodes.filter(n=>n.type!=="out");
      // Bez tego cel nowego połączenia losowany jest jednostajnie spośród WSZYSTKICH
      // węzłów ukrytych i wyjściowych — im więcej neuronów ukrytych genom nagromadzi,
      // tym mniejsza szansa, że akurat trafi w rzadko używane wyjście (np. "Rozmnażaj"),
      // które od startu nie ma żadnego połączenia. To sprawia, że im dłużej coś się nie
      // wyewoluuje, tym mniej prawdopodobne staje się, że kiedykolwiek się wyewoluuje.
      // Dajemy więc dodatkową szansę na celowanie akurat w takie "osierocone" wyjścia.
      const unwiredOutputs = g.nodes.filter(n => n.type==="out" && !g.conns.some(c=>c.b===n.id && c.enabled));
      const tos = (unwiredOutputs.length > 0 && Math.random() < 0.5) ? unwiredOutputs : g.nodes.filter(n=>n.type!=="in");
      for(let t=0; t<24; t++){
        const a=froms[mathRandI(froms.length)].id, b=tos[mathRandI(tos.length)].id;
        if(a===b || g.conns.some(c=>c.a===a&&c.b===b) || this.reaches(g,b,a)) continue;
        g.conns.push({innov: this.getInnov(a,b), a, b, w: mathGauss()*0.9, enabled:true});
        g.dirty=true; break;
      }
    }
    if(Math.random() < NEAT_CONFIG.MUT_NODE*power && g.nodes.length < NEAT_CONFIG.MAX_NODES && g.conns.length + 2 <= NEAT_CONFIG.MAX_CONNS) {
      const en = g.conns.filter(c=>c.enabled);
      if(en.length){
        const c = en[mathRandI(en.length)]; c.enabled=false;
        const id = this.nodeCounter++; g.nodes.push({id, type:"hid"});
        g.conns.push({innov: this.getInnov(c.a, id), a: c.a, b: id, w: 1, enabled: true});
        g.conns.push({innov: this.getInnov(id, c.b), a: id, b: c.b, w: c.w, enabled: true});
        g.dirty=true;
      }
    }
    // Mutacja genotypu (ciała)
    for(let key in g.stats) {
      if(Math.random() < NEAT_CONFIG.MUT_GENE * power) {
        // Delikatna mutacja z zachowaniem limitów, żeby np. speed nie był ujemny
        let next = Math.max(0.01, g.stats[key] * (1 + mathGauss() * 0.1 * power));
        const bounds = GENE_BOUNDS[key];
        const base = this.baseGenes && this.baseGenes[key];
        if(bounds && base) {
          next = Math.min(Math.max(next, base * bounds.min), base * bounds.max);
        }
        g.stats[key] = next;
      }
    }
  }
  shouldUseParentGene(c, other){
    return Boolean(c && other && (!c.enabled || !other.enabled));
  }
  crossover(g1, g2) {
    const m2 = new Map(g2.conns.map(c=>[c.innov, c]));
    const child = { reg: this, dirty: true, nodes: [], conns: [], fitness: 0, speciesId: null, gen: Math.max(g1.gen, g2.gen)+1, stats: {} };
    const hidden = new Set();
    for(const c of g1.conns){
      const o = m2.get(c.innov); let gGene;
      if(o) { gGene = {...(Math.random()<0.5 ? c : o)}; if(this.shouldUseParentGene(c, o)) gGene.enabled = Math.random()<0.25; }
      else { gGene = {...c}; }
      child.conns.push(gGene);
      if(gGene.a >= this.nIn+this.nOut) hidden.add(gGene.a);
      if(gGene.b >= this.nIn+this.nOut) hidden.add(gGene.b);
    }
    for(let i=0; i<this.nIn; i++) child.nodes.push({id: i, type:"in"});
    for(let o=0; o<this.nOut; o++) child.nodes.push({id: this.nIn+o, type:"out"});
    for(const h of hidden) child.nodes.push({id: h, type:"hid"});
    // Krzyżowanie genotypu
    for(let key in g1.stats) child.stats[key] = Math.random() < 0.5 ? g1.stats[key] : g2.stats[key];
    return child;
  }
  shouldRemoveStagnantSpecies(species){
    return species.epochsSinceImprovement >= NEAT_CONFIG.STAGNATION && this.species.length > 1;
  }
  epochEvaluate(allAliveGenomes) {
    this.epochCount++; this.species.forEach(s => s.reset());
    for(const g of allAliveGenomes) this.speciate(g);
    this.protectedChampions = [];
    for(let i = this.species.length - 1; i >= 0; i--) {
      const s = this.species[i];
      if (s.members.length === 0) { this.species.splice(i, 1); continue; }
      s.members.sort((a,b) => b.fitness - a.fitness);
      const best = s.members[0];
      for(const m of s.members) {
        const raw = m.rawFitness ?? m.fitness ?? 0;
        m.rawFitness = raw;
        m.sharedFitness = raw / Math.max(1, s.members.length);
        m.fitness = m.sharedFitness;
      }
      s.members.sort((a,b) => b.fitness - a.fitness);
      s.champion = this.cloneGenome(s.members[0]);
      s.champion.fitness = s.members[0].fitness;
      s.champion.rawFitness = s.members[0].rawFitness;
      s.champion.sharedFitness = s.members[0].sharedFitness;
      this.protectedChampions.push(s.champion);
      if (s.champion.fitness > s.topFitness) { s.topFitness = s.champion.fitness; s.epochsSinceImprovement = 0; }
      else { s.epochsSinceImprovement++; }
      if (this.shouldRemoveStagnantSpecies(s)) { this.species.splice(i, 1); }
    }
    if (this.species.length < NEAT_CONFIG.TARGET_SPECIES) this.DT -= 0.1;
    else if (this.species.length > NEAT_CONFIG.TARGET_SPECIES) this.DT += 0.1;
    if (this.DT < 0.3) this.DT = 0.3;
  }
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { NEATCore, NEAT_CONFIG, GENE_BOUNDS };
}