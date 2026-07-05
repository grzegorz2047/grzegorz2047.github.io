"use strict";
// ============================================================= //
//  RENDERING & UI                                               //
//  (korzysta ze stanu symulacji zdefiniowanego w app.js —       //
//   sheep/wolves/plants/step/itd. jako współdzielone globalne)  //
// ============================================================= //
function formatLineage(a){
  if(!a || !a.lineage || a.lineage.length === 0) return "—";
  return a.lineage.slice(-6).map(id => `#${id}`).join(" → ");
}
function getMaturityText(stats){
  const age = Math.round(stats.maturityAge);
  const energy = Math.round(stats.maturityEnergy);
  return `${age} ticków albo ${energy} energii`;
}
function shouldSelectDifferentBrainSpecies(current, targetSpecies){
  return !current || current.kind !== targetSpecies;
}
let worldCv=null, wctx=null;
let VW=0,VH=0,DPR=1, S=12, zoom=1, panX=0, panY=0;
function fit(){ DPR=Math.min(window.devicePixelRatio||1,2); const r=worldCv.getBoundingClientRect(); VW=r.width; VH=r.height; worldCv.width=VW*DPR; worldCv.height=VH*DPR; wctx.setTransform(DPR,0,0,DPR,0,0); S=Math.min(VW/(WORLD*1.05), VH/(WORLD*0.62)); }
function camX(){ return VW/2 + panX; }
function camY(){ return VH/2 - WORLD*0.25*S*zoom + panY; }
function iso(x,y,zLift=0){ return [ (x-y)*0.5*S*zoom + camX(), (x+y)*0.25*S*zoom + camY() - zLift ]; }
function screenToWorld(sx,sy){ const A=(sx-camX())/(0.5*S*zoom), B=(sy-camY())/(0.25*S*zoom); return [ (B+A)/2, (B-A)/2 ]; }
function drawGround(){
  const c0=iso(0,0), c1=iso(WORLD,0), c2=iso(WORLD,WORLD), c3=iso(0,WORLD);
  const grad=wctx.createLinearGradient(0,c0[1],0,c2[1]);
  grad.addColorStop(0,"#2c4a2a"); grad.addColorStop(1,"#3f6b3a");
  wctx.beginPath(); wctx.moveTo(...c0); wctx.lineTo(...c1); wctx.lineTo(...c2); wctx.lineTo(...c3); wctx.closePath(); wctx.fillStyle=grad; wctx.fill();
  wctx.strokeStyle="rgba(255,255,255,0.04)"; wctx.lineWidth=1;
  for(let i=0;i<=WORLD;i+=8){ let a=iso(i,0),b=iso(i,WORLD); wctx.beginPath();wctx.moveTo(...a);wctx.lineTo(...b);wctx.stroke(); a=iso(0,i);b=iso(WORLD,i); wctx.beginPath();wctx.moveTo(...a);wctx.lineTo(...b);wctx.stroke(); }
}
const FENCE_POST_SPACING = 6;
function drawFence(){
  const k = zoom*S; const postHeight = 0.5*k;
  const postAt = (x,y) => {
    const [bx,by]=iso(x,y,0), [tx,ty]=iso(x,y,postHeight);
    wctx.beginPath(); wctx.moveTo(bx,by); wctx.lineTo(tx,ty); wctx.stroke();
  };
  wctx.strokeStyle="rgba(120,90,60,0.9)"; wctx.lineWidth=Math.max(1,0.055*k); wctx.lineCap="round";
  for(let x=0; x<=WORLD; x+=FENCE_POST_SPACING){ postAt(x,0); postAt(x,WORLD); }
  for(let y=FENCE_POST_SPACING; y<WORLD; y+=FENCE_POST_SPACING){ postAt(0,y); postAt(WORLD,y); }
  const rail = (x1,y1,x2,y2) => {
    const [ax,ay]=iso(x1,y1,postHeight), [bx,by]=iso(x2,y2,postHeight);
    wctx.beginPath(); wctx.moveTo(ax,ay); wctx.lineTo(bx,by); wctx.stroke();
  };
  wctx.strokeStyle="rgba(150,115,80,0.75)"; wctx.lineWidth=Math.max(1,0.035*k);
  rail(0,0,WORLD,0); rail(0,WORLD,WORLD,WORLD); rail(0,0,0,WORLD); rail(WORLD,0,WORLD,WORLD);
}
function shadow(sx,sy,r){ if(!opt.shadow) return; wctx.fillStyle="rgba(0,0,0,0.22)"; wctx.beginPath(); wctx.ellipse(sx,sy,r,r*0.5,0,0,Math.PI*2); wctx.fill(); }
// ============================================================= //
//  SPRITE CACHE — każdy kształt (roślina/owca/wilk/legowisko)   //
//  rysujemy RAZ na daną skalę/wariant na osobnym off-screen     //
//  canvasie, a potem tylko kopiujemy przez drawImage() zamiast  //
//  wykonywać dziesiątki wywołań arc/stroke/fill co klatkę.      //
//  drawImage to pojedyncza, sprzętowo przyspieszana operacja    //
//  kompozycji GPU — to jest realne wykorzystanie GPU dostępne   //
//  w zwykłym Canvas 2D, bez przepisywania renderera na WebGL.   //
// ============================================================= //
const spriteCache = new Map();
function getSprite(key, build){
  let sprite = spriteCache.get(key);
  if(!sprite){ sprite = build(); spriteCache.set(key, sprite); }
  return sprite;
}
function makeSpriteCanvas(size){
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(size));
  canvas.height = Math.max(1, Math.ceil(size));
  return canvas;
}
const PLANT_GROWTH_BUCKETS = 20; // kwantyzacja wzrostu do 21 stopni (co 0.05) — niezauważalne wizualnie, drastycznie mniej wariantów sprite'ów
function buildPlantSprite(bucket, k){
  const gr = 0.4 + bucket*0.6, h = 0.7*k*gr;
  const canvas = makeSpriteCanvas(0.44*k);
  const ctx = canvas.getContext("2d");
  const ax = canvas.width/2, ay = canvas.height - 2;
  ctx.strokeStyle = bucket>=P.plant.edible ? "#8ecb5c" : "#5f8f43"; ctx.lineWidth=Math.max(1,0.06*k); ctx.lineCap="round";
  for(let b=-1;b<=1;b++){ ctx.beginPath(); ctx.moveTo(ax+b*0.09*k, ay); ctx.lineTo(ax+b*0.16*k, ay-h); ctx.stroke(); }
  if(bucket>=0.9){ ctx.fillStyle="#e6d15a"; ctx.beginPath(); ctx.arc(ax,ay-h,Math.max(1.3,0.07*k),0,Math.PI*2); ctx.fill(); }
  return { canvas, anchorX: ax, anchorY: ay };
}
function drawPlant(p){
  const [sx,sy]=iso(p.x,p.y); const gr=0.4+p.g*0.6, k=zoom*S; shadow(sx,sy,0.11*k*gr);
  const roundedK = Math.round(k);
  const bucket = Math.round(p.g*PLANT_GROWTH_BUCKETS)/PLANT_GROWTH_BUCKETS;
  const sprite = getSprite(`plant:${bucket}:${roundedK}`, () => buildPlantSprite(bucket, roundedK));
  wctx.drawImage(sprite.canvas, sx - sprite.anchorX, sy - sprite.anchorY);
}
function isHungry(a){ return a.e < a.g.stats.maxEnergy * HUNGRY_ENERGY_RATIO; }
function isWellFed(a){ return a.e > a.g.stats.maxEnergy * WELL_FED_ENERGY_RATIO; }
function buildSheepBodySprite(bodyCol, k){
  const canvas = makeSpriteCanvas(0.64*k); // generous fixed extent covering all body parts + belly shade
  const ctx = canvas.getContext("2d");
  const a = canvas.width/2;
  ctx.fillStyle=bodyCol;
  for(const [ox,oy,rr] of [[-0.12,-0.02,0.16],[0.1,-0.04,0.15],[0,-0.14,0.16],[-0.05,-0.02,0.17],[0.06,-0.02,0.16]]){ ctx.beginPath(); ctx.arc(a+ox*k,a+oy*k,rr*k,0,Math.PI*2); ctx.fill(); }
  ctx.fillStyle="rgba(120,110,95,0.25)"; ctx.beginPath(); ctx.ellipse(a,a+0.08*k,0.2*k,0.09*k,0,0,Math.PI*2); ctx.fill();
  return { canvas, anchor: a };
}
function drawSheep(s){
  const [sx,sy]=iso(s.x,s.y); const k=zoom*S; const bob=Math.sin(tick*0.25+s.id)*0.05*k; shadow(sx,sy,0.22*k); const cy=sy-0.28*k+bob;
  const hungry = isHungry(s), wellFed = isWellFed(s);
  const bodyCol = wellFed ? "#ffffff" : hungry ? "#c9beac" : "#f2eede";
  const roundedK = Math.round(k);
  const sprite = getSprite(`sheep:${bodyCol}:${roundedK}`, () => buildSheepBodySprite(bodyCol, roundedK));
  wctx.drawImage(sprite.canvas, sx - sprite.anchor, cy - sprite.anchor);
  const hx=Math.cos(s.h), hy=Math.sin(s.h); const [ix,iy]=[ (hx-hy), (hx+hy)*0.5 ]; wctx.fillStyle="#5a5148"; wctx.beginPath(); wctx.arc(sx+ix*0.22*k,cy+iy*0.22*k,0.085*k,0,Math.PI*2); wctx.fill();
  if(hungry){ wctx.fillStyle="#ffd27a"; wctx.beginPath();wctx.arc(sx+ix*0.3*k,cy+iy*0.3*k,Math.max(1,0.025*k),0,Math.PI*2);wctx.fill(); }
}
function buildWolfBodySprite(bodyCol, k){
  const canvas = makeSpriteCanvas(0.9*k); // covers ellipse + ear + tail regardless of rotation
  const ctx = canvas.getContext("2d");
  const a = canvas.width/2;
  ctx.fillStyle= bodyCol; ctx.beginPath(); ctx.ellipse(a,a,0.28*k,0.14*k,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(a,a-0.04*k,0.24*k,0.08*k,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#8a5326"; ctx.beginPath(); ctx.moveTo(a+0.24*k,a); ctx.lineTo(a+0.4*k,a-0.05*k); ctx.lineTo(a+0.4*k,a+0.05*k); ctx.closePath(); ctx.fill();
  ctx.fillStyle= bodyCol; ctx.beginPath(); ctx.moveTo(a+0.16*k,a-0.1*k); ctx.lineTo(a+0.22*k,a-0.2*k); ctx.lineTo(a+0.26*k,a-0.08*k); ctx.closePath(); ctx.fill();
  return { canvas, anchor: a };
}
function drawWolf(w){
  const [sx,sy]=iso(w.x,w.y); const k=zoom*S; shadow(sx,sy,0.24*k); const cy=sy-0.26*k; const hx=Math.cos(w.h), hy=Math.sin(w.h); const ix=(hx-hy)*0.5, iy=(hx+hy)*0.25;
  const hungry = isHungry(w), wellFed = isWellFed(w); const bodyCol = wellFed ? "#c7b79d" : hungry ? "#c8722f" : "#d98a3f";
  const roundedK = Math.round(k);
  const sprite = getSprite(`wolf:${bodyCol}:${roundedK}`, () => buildWolfBodySprite(bodyCol, roundedK));
  wctx.save(); wctx.translate(sx,cy); wctx.rotate(Math.atan2(iy,ix)); wctx.drawImage(sprite.canvas, -sprite.anchor, -sprite.anchor); wctx.restore();
  if(hungry){ wctx.fillStyle="#ffd27a"; wctx.beginPath();wctx.arc(sx+ix*0.3*k,cy+iy*0.3*k,Math.max(1,0.03*k),0,Math.PI*2);wctx.fill(); }
}
function buildDenHutSprite(k){
  const canvas = makeSpriteCanvas(0.8*k);
  const ctx = canvas.getContext("2d");
  const a = canvas.width/2;
  ctx.fillStyle="rgba(80,55,35,0.9)"; ctx.beginPath(); ctx.ellipse(a,a+0.02*k,0.26*k,0.13*k,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle="rgba(0,0,0,0.5)"; ctx.lineWidth=1.4; ctx.stroke();
  ctx.fillStyle="rgba(205,155,95,0.98)";
  ctx.beginPath(); ctx.moveTo(a-0.2*k,a); ctx.lineTo(a,a-0.3*k); ctx.lineTo(a+0.2*k,a); ctx.closePath(); ctx.fill();
  ctx.strokeStyle="rgba(0,0,0,0.5)"; ctx.lineWidth=1.2; ctx.stroke();
  return { canvas, anchor: a };
}
function drawDenMarker(den){
  const [px,py]=iso(den.x,den.y); const k=zoom*S;
  wctx.strokeStyle="rgba(200,150,90,0.3)"; wctx.setLineDash([3,3]); wctx.lineWidth=1;
  wctx.beginPath(); wctx.ellipse(px,py,DEN_REST_RADIUS*0.5*S*zoom,DEN_REST_RADIUS*0.25*S*zoom,0,0,Math.PI*2); wctx.stroke();
  wctx.setLineDash([]);
  const roundedK = Math.round(k);
  const sprite = getSprite(`den:${roundedK}`, () => buildDenHutSprite(roundedK));
  wctx.drawImage(sprite.canvas, px - sprite.anchor, py - sprite.anchor);
}
function drawDens(){
  for(const w of wolves){ if(w.den) drawDenMarker(w.den); }
}
function drawSenseLines(a){
  if(!opt.sense) return; const [sx,sy]=iso(a.x,a.y-0); const k=zoom*S; const base=sy-0.22*k;
  if(a.tPlant){ const [px,py]=iso(a.tPlant.x,a.tPlant.y); wctx.strokeStyle="rgba(142,203,92,0.55)"; wctx.setLineDash([4,4]); wctx.lineWidth=1.4; wctx.beginPath(); wctx.moveTo(sx,base); wctx.lineTo(px,py); wctx.stroke(); }
  if(a.tThreat){ const [px,py]=iso(a.tThreat.x,a.tThreat.y); wctx.strokeStyle="rgba(217,105,95,0.6)"; wctx.setLineDash([4,4]); wctx.lineWidth=1.4; wctx.beginPath(); wctx.moveTo(sx,base); wctx.lineTo(px,py); wctx.stroke(); }
  if(a.den){
    const [px,py]=iso(a.den.x,a.den.y);
    wctx.strokeStyle="rgba(180,140,90,0.7)"; wctx.setLineDash([2,3]); wctx.lineWidth=1.6; wctx.beginPath(); wctx.moveTo(sx,base); wctx.lineTo(px,py); wctx.stroke();
    wctx.setLineDash([]);
  }
  wctx.setLineDash([]);
}
function drawSelection(a){
  const [sx,sy]=iso(a.x,a.y); const k=zoom*S; wctx.strokeStyle="#4fb8a8"; wctx.lineWidth=2; wctx.beginPath(); wctx.ellipse(sx,sy,0.34*k,0.17*k,0,0,Math.PI*2); wctx.stroke();
  wctx.strokeStyle="rgba(79,184,168,0.18)"; wctx.lineWidth=1.2; wctx.beginPath(); wctx.ellipse(sx,sy,a.g.stats.vision*0.5*S*zoom,a.g.stats.vision*0.25*S*zoom,0,0,Math.PI*2); wctx.stroke();
}
function renderWorld(){
  wctx.clearRect(0,0,VW,VH); drawGround(); drawFence(); drawDens(); const list=[];
  for(const p of plants) list.push([p.x+p.y,0,p]); for(const s of sheep)  list.push([s.x+s.y,1,s]); for(const w of wolves) list.push([w.x+w.y,2,w]);
  list.sort((A,B)=>A[0]-B[0]); const sel=getSel(); if(sel) drawSenseLines(sel);
  for(const [,t,o] of list){ if(t===0) drawPlant(o); else if(t===1) drawSheep(o); else drawWolf(o); }
  if(sel) drawSelection(sel);
}
let netCv=null, nctx=null;
let NW=0,NH=0;
// NEAT nigdy nie usuwa zbędnych połączeń, tylko dodaje (i czasem wyłącza) — więc
// część aktywnych połączeń z czasem staje się ewolucyjnym szumem o wadze zbyt
// małej, żeby realnie wpływać na decyzję (po tanh ich wkład ginie w zaokrągleniu).
const MEANINGFUL_WEIGHT_THRESHOLD = 0.15;
function countMeaningfulConnections(g){
  const enabled = g.conns.filter(c => c.enabled);
  const meaningful = enabled.filter(c => Math.abs(c.w) >= MEANINGFUL_WEIGHT_THRESHOLD);
  return { meaningful: meaningful.length, total: enabled.length };
}
function fitNet() {
  const el = document.getElementById("net"); const parent = el.parentElement;
  NW = parent.clientWidth; NH = parent.clientHeight; el.width = NW; el.height = NH;
}
function layout(g){
  if(g.dirty) g.reg.activate(g, Array(g.reg.nIn).fill(0));
  const depth=new Map(); for(const n of g.nodes) depth.set(n.id, n.type==="in"?0:0);
  for(const id of g._order) for(const c of g._inc.get(id)) depth.set(id, Math.max(depth.get(id), depth.get(c.a)+1));
  let maxD=0; for(const n of g.nodes) if(n.type!=="out") maxD=Math.max(maxD,depth.get(n.id));
  const last=maxD+1;
  for(const n of g.nodes){ if(n.type==="in") depth.set(n.id,0); if(n.type==="out") depth.set(n.id,last); }
  const cols=new Map(); for(const n of g.nodes){ const d=depth.get(n.id); if(!cols.has(d))cols.set(d,[]); cols.get(d).push(n); }
  const pos=new Map(); const padLeft=100, padRight=60, padY=22, usableW=NW-padLeft-padRight, usableH=NH-padY*2;
  for(const [d,arr] of cols){
    const x = last===0 ? NW/2 : padLeft + (usableW*d/last);
    arr.forEach((n,i)=>{ const y=padY + (arr.length===1? usableH/2 : usableH*i/(arr.length-1)); pos.set(n.id,[x,y]); });
  }
  return pos;
}
function renderNet(){
  nctx.clearRect(0,0,NW,NH); const a=getSel();
  const selNone=document.getElementById("selNone");
  const statsSec=document.getElementById("statsSec");
  selNone.style.display=a?"none":"flex";
  statsSec.style.display="block";
  statsSec.style.visibility=a?"visible":"hidden";
  statsSec.style.opacity=a?"1":"0";
  statsSec.style.pointerEvents=a?"auto":"none";
  if(!a) return;
  const g=a.g; const pos=layout(g);
  for(const c of g.conns){
    const pa=pos.get(c.a), pb=pos.get(c.b); if(!pa||!pb) continue;
    const mag=Math.min(Math.abs(c.w),3);
    nctx.lineWidth = c.enabled ? 0.6+mag*1.1 : 0.6;
    nctx.strokeStyle = c.enabled ? (c.w>=0 ? `rgba(108,197,127,${0.35+0.5*mag/3})` : `rgba(217,105,95,${0.35+0.5*mag/3})`) : "rgba(120,140,145,0.16)";
    nctx.setLineDash(c.enabled?[]:[3,3]);
    const mx=(pa[0]+pb[0])/2;
    nctx.beginPath(); nctx.moveTo(pa[0],pa[1]); nctx.bezierCurveTo(mx,pa[1],mx,pb[1],pb[0],pb[1]); nctx.stroke();
  }
  nctx.setLineDash([]);
  for(const n of g.nodes){
    const p=pos.get(n.id); if(!p) continue; const r = n.type==="hid"?4.5:5.5;
    nctx.fillStyle = n.type==="in" ? "#4fb8a8" : n.type==="out" ? "#e0a45a" : "#c9d3d6";
    nctx.beginPath(); nctx.arc(p[0],p[1],r,0,Math.PI*2); nctx.fill(); nctx.strokeStyle="rgba(0,0,0,0.4)"; nctx.lineWidth=1; nctx.stroke();
    if(n.type!=="hid"){
      nctx.fillStyle="#8ba0a6"; nctx.font="9px ui-monospace,monospace";
      let label = g.reg.names[n.id] || "";
      if(n.type==="in"){ nctx.textAlign="right"; nctx.fillText(label, p[0]-8, p[1]+3); }
      else { nctx.textAlign="left"; nctx.fillText(label, p[0]+8, p[1]+3); }
    }
  }
  const speciesInfo = (a.kind === "sheep" ? neatSheep : neatWolf);
  const species = speciesInfo.species.find(s => s.id === g.speciesId) || null;
  const champion = species && species.champion ? species.champion : null;
  const speciesBest = species ? species.members[0] : null;
  document.getElementById("mNodes").textContent=g.nodes.length;
  const connBreakdown = countMeaningfulConnections(g);
  document.getElementById("mConns").textContent=`${connBreakdown.meaningful}/${connBreakdown.total}`;
  document.getElementById("mSpecies").textContent = g.speciesId || "?";
  document.getElementById("mAge").textContent=a.age;
  document.getElementById("selLabel").textContent = a.kind==="sheep"?"🐑 owca #"+a.id:"🐺 wilk #"+a.id;
  document.getElementById("stSpecies").textContent = species ? `#${species.id}` : "—";
  document.getElementById("stChampion").textContent = champion ? (champion.reg === neatSheep ? "🐑" : "🐺") + ` #${champion.gen || "?"}` : "—";
  document.getElementById("stSpeciesFit").textContent = speciesBest ? Math.floor(speciesBest.fitness || 0) : "0";
  // Aktualizacja Statystyk z Etapu 3 i
  document.getElementById("stFit").textContent = Math.floor(a.fitness || 0);
  document.getElementById("stKills").textContent = a.metrics.kills;
  document.getElementById("stPlants").textContent = a.metrics.plants;
  document.getElementById("stChildren").textContent = a.metrics.children;
  document.getElementById("stDist").textContent = Math.floor(a.metrics.dist);
  document.getElementById("stGen").textContent = g.gen;
  document.getElementById("stAvgE").textContent = a.metrics.avgEnergy.toFixed(1);
  document.getElementById("stEff").textContent = a.metrics.efficiency.toFixed(2);
  document.getElementById("stSurvival").textContent = (a.metrics.survival * 100).toFixed(0) + "%";
  document.getElementById("stMaturity").textContent = getMaturityText(g.stats);
  document.getElementById("stLineage").textContent = formatLineage(a);
  document.getElementById("stSpeed").textContent = g.stats.speed.toFixed(2);
  document.getElementById("stMeta").textContent = g.stats.metabolism.toFixed(3);
  document.getElementById("stVision").textContent = Math.floor(g.stats.vision);
}
let chartCv=null, cctx=null;
let CW=0,CH=0;
function fitChart(){ const r=chartCv.getBoundingClientRect();CW=r.width;CH=r.height; chartCv.width=CW*DPR;chartCv.height=CH*DPR;cctx.setTransform(DPR,0,0,DPR,0,0); }
function renderChart(){
  cctx.clearRect(0,0,CW,CH); if(history.length<2) return;
  let mx=1; for(const h of history) mx=Math.max(mx,h[0],h[1],h[2]);
  const line=(idx,col)=>{ cctx.strokeStyle=col; cctx.lineWidth=1.6; cctx.beginPath(); history.forEach((h,i)=>{ const x=CW*i/(history.length-1), y=CH-4-(CH-8)*h[idx]/mx; i?cctx.lineTo(x,y):cctx.moveTo(x,y); }); cctx.stroke(); };
  line(2,"rgba(142,203,92,0.55)"); line(0,"#f2eede"); line(1,"#d98a3f");
}
let evoChartCv=null, evoCctx=null;
let ECW=0, ECH=0;
function fitEvoChart(){ const r=evoChartCv.getBoundingClientRect(); ECW=r.width; ECH=r.height; evoChartCv.width=ECW*DPR; evoChartCv.height=ECH*DPR; evoCctx.setTransform(DPR,0,0,DPR,0,0); }
function linearTrend(values){
  const n = values.length;
  let sumX=0,sumY=0,sumXY=0,sumXX=0;
  for(let i=0;i<n;i++){ sumX+=i; sumY+=values[i]; sumXY+=i*values[i]; sumXX+=i*i; }
  const denom = n*sumXX - sumX*sumX;
  if(denom === 0) return { slope: 0, intercept: values[0] || 0 };
  const slope = (n*sumXY - sumX*sumY) / denom;
  const intercept = (sumY - slope*sumX) / n;
  return { slope, intercept };
}
function renderEvolutionChart(){
  const empty = document.getElementById("evoChartEmpty");
  const trendLabel = document.getElementById("evoTrendLabel");
  if(evolutionHistory.length < 2){
    empty.style.display = "flex";
    evoChartCv.style.display = "none";
    trendLabel.textContent = "Trend: —";
    return;
  }
  empty.style.display = "none";
  evoChartCv.style.display = "block";
  evoCctx.clearRect(0,0,ECW,ECH);
  const values = evolutionHistory.map(e => e.uptime);
  const n = values.length;
  const mx = Math.max(1, ...values);
  evoCctx.strokeStyle = "#f2eede"; evoCctx.lineWidth = 1.6;
  evoCctx.beginPath();
  values.forEach((v,i) => { const x=ECW*i/(n-1), y=ECH-4-(ECH-8)*v/mx; i?evoCctx.lineTo(x,y):evoCctx.moveTo(x,y); });
  evoCctx.stroke();
  const { slope, intercept } = linearTrend(values);
  const y0 = ECH-4-(ECH-8)*intercept/mx;
  const y1 = ECH-4-(ECH-8)*(intercept + slope*(n-1))/mx;
  evoCctx.strokeStyle = slope > 0.5 ? "rgba(108,197,127,0.9)" : slope < -0.5 ? "rgba(217,105,95,0.9)" : "rgba(224,164,90,0.9)";
  evoCctx.lineWidth = 1.8; evoCctx.setLineDash([5,3]);
  evoCctx.beginPath(); evoCctx.moveTo(0,y0); evoCctx.lineTo(ECW,y1); evoCctx.stroke();
  evoCctx.setLineDash([]);
  trendLabel.textContent = slope > 0.5 ? `Trend: rosnący ↑ (+${slope.toFixed(1)}/epokę)` : slope < -0.5 ? `Trend: malejący ↓ (${slope.toFixed(1)}/epokę)` : "Trend: płaski →";
}
function getSel(){ return selId==null ? null : (sheep.find(s=>s.id===selId) || wolves.find(w=>w.id===selId) || null); }
function pickAt(sx,sy){ const [wx,wy]=screenToWorld(sx,sy); let best=null,bd=9; for(const a of [...sheep,...wolves]){ const dx=a.x-wx,dy=a.y-wy,d=dx*dx+dy*dy; if(d<bd){bd=d;best=a;} } return best; }
const $=id=>document.getElementById(id);
const opt={sense:true,shadow:true};
let playing=true, speed=2, brainSpecies="sheep", selFollow=true;
function bindUiControls(){
  $("btnPlay").onclick=()=>{ playing=!playing; $("btnPlay").innerHTML= playing?"⏸ Pauza":"▶ Wznów"; };
  $("btnReset").onclick=()=>{ initEcosystem(); };
  $("btnSave").onclick=()=>{ saveStateToStorage(); $("btnSave").textContent = "✓ Zapisano"; setTimeout(()=>$("btnSave").textContent="💾 Zapisz", 900); };
  $("btnLoad").onclick=()=>{ const ok = loadStateFromStorage(); $("btnLoad").textContent = ok ? "✓ Wczytano" : "✕ Brak zapisu"; setTimeout(()=>$("btnLoad").textContent="📂 Wczytaj", 900); };
  $("addSheep").onclick=()=>{ for(let i=0;i<8;i++) { if(sheep.length>=P.sheep.cap) break; const g = neatSheep.createBaseGenome(); neatSheep.mutate(g, 1.0); sheep.push(makeAnimal("sheep",rand(WORLD),rand(WORLD),g)); } };
  $("addWolf").onclick =()=>{ for(let i=0;i<3;i++) { if(wolves.length>=P.wolf.cap) break; const g = neatWolf.createBaseGenome(); neatWolf.mutate(g, 1.0); wolves.push(makeAnimal("wolf",rand(WORLD),rand(WORLD),g)); } };
  $("addPlant").onclick=()=>{ for(let i=0;i<40;i++) if(plants.length<P.plant.cap) plants.push(Plant(rand(WORLD),rand(WORLD))); };
  document.querySelectorAll("#speedSeg button").forEach(b=>b.onclick=()=>{ document.querySelectorAll("#speedSeg button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); speed=+b.dataset.s; });
  document.querySelectorAll("#brainSeg button").forEach(b=>b.onclick=()=>{ document.querySelectorAll("#brainSeg button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); brainSpecies=b.dataset.sp; selFollow=true; selId=null; });
  $("sPlant").oninput=e=>{ P.plantGrow=e.target.value/100; $("lPlant").textContent=P.plantGrow.toFixed(1)+"×"; };
  $("sMut").oninput  =e=>{ P.mutPow  =e.target.value/100; $("lMut").textContent=P.mutPow.toFixed(1)+"×"; };
  const tog=(id,key)=>{ const el=$(id); el.onclick=()=>{ opt[key]=!opt[key]; el.classList.toggle("on",opt[key]); }; };
  tog("tSense","sense");
  tog("tShadow","shadow");
}
function attachWorldInteractions(){
  let dragging=false, moved=false, lx=0, ly=0;
  worldCv.addEventListener("pointerdown",e=>{ dragging=true;moved=false;lx=e.clientX;ly=e.clientY;worldCv.setPointerCapture(e.pointerId); });
  worldCv.addEventListener("pointermove",e=>{ if(!dragging)return; const dx=e.clientX-lx, dy=e.clientY-ly; if(Math.abs(dx)+Math.abs(dy)>3)moved=true; panX+=dx; panY+=dy; lx=e.clientX; ly=e.clientY; });
  worldCv.addEventListener("pointerup",e=>{ dragging=false; if(!moved){ const r=worldCv.getBoundingClientRect(); const a=pickAt(e.clientX-r.left,e.clientY-r.top); if(a){ selId=a.id; selFollow=false; } } });
  worldCv.addEventListener("wheel",e=>{ e.preventDefault(); zoom=clamp(zoom*(e.deltaY<0?1.1:0.9),0.5,4); },{passive:false});
}
if (hasBrowserDom) {
  worldCv=document.getElementById("world"); wctx=worldCv.getContext("2d");
  netCv=document.getElementById("net"); nctx=netCv.getContext("2d");
  chartCv=document.getElementById("chart"); cctx=chartCv.getContext("2d");
  evoChartCv=document.getElementById("evoChart"); evoCctx=evoChartCv.getContext("2d");
  bindUiControls();
  attachWorldInteractions();
  function resizeAll(){ fit(); fitNet(); fitChart(); fitEvoChart(); } window.addEventListener("resize",resizeAll);
  function loop(ts){
    if(!lastFrameTime) lastFrameTime=ts;
    const delta=ts-lastFrameTime;
    lastFrameTime=ts;
    if(playing){
      const simSpeed = Math.max(1, speed);
      const stepInterval = FIXED_STEP_MS / simSpeed;
      const populationLoad = sheep.length + wolves.length + plants.length;
      const maxStepsPerFrame = populationLoad > 320 ? 2 : populationLoad > 180 ? 4 : 8;
      simAccumulator += delta;
      let steps=0;
      while(simAccumulator >= stepInterval && steps < maxStepsPerFrame){
        step();
        simAccumulator -= stepInterval;
        steps++;
      }
      if(simAccumulator > stepInterval * Math.max(2, maxStepsPerFrame)) simAccumulator = stepInterval * Math.max(2, maxStepsPerFrame);
      if(steps === maxStepsPerFrame) frameDropCounter++;
    }
    if(selFollow){
      const cur=getSel();
      if(shouldSelectDifferentBrainSpecies(cur, brainSpecies)){ const arr = brainSpecies==="sheep"?sheep:wolves; let b=null; for(const a of arr) if(!b||a.g.fitness>b.g.fitness) b=a; selId=b?b.id:null; }
    }
    renderWorld();
    frameRenderCounter++;
    if(frameRenderCounter % 2 === 0) renderNet();
    renderChart();
    renderEvolutionChart();
    $("tick").textContent=tick; $("cSheep").textContent=sheep.length; $("cWolf").textContent=wolves.length; $("cPlant").textContent=plants.length;
    $("epNum").textContent="Epoka " + neatSheep.epochCount;
    $("epUptime").textContent = ecosystemUptime;
    $("epRec").textContent = bestEcosystemUptime;
    requestAnimationFrame(loop);
  }
  resizeAll(); initEcosystem(); requestAnimationFrame(loop);
}
