"use strict";
// =============================================================
// CZYSTE FUNKCJE MATEMATYCZNE (bez zależności od stanu symulacji)
// =============================================================
const clamp = (v,a,b)=> v<a?a:v>b?b:v;
const rand = (a=1,b)=> b===undefined ? Math.random()*a : a+Math.random()*(b-a);
function angNorm(a){ while(a> Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clamp, rand, angNorm };
}
