// Métodos de optimización del Simulador HRES-H2.
//
// Variables: vector de enteros [n_wt, n_pv, n_con, n_ele, n_ht, n_fc, n_bat, n_dg] dentro de `limites`.
// Cada evaluación trae `obj` (objetivo único que se minimiza: LCOE, costo presente neto o inversión, con
// penalizaciones), `objs` (vector de objetivos para el frente de Pareto) y `viol` (0 si cumple la confiabilidad).
//
// Un objetivo:
//  - mc, ha, ga: los tres métodos de la tesis (Monte Carlo; búsqueda caótica-armónica con recocido simulado;
//    algoritmo genético como en DEAP), con la misma penalización que la tesis.
//  - shade: evolución diferencial adaptativa (SHADE) con reglas de factibilidad de Deb y pulido final.
//  - pso, gwo, woa, eo: enjambre de partículas, lobo gris, ballena y optimizador de equilibrio, los métodos más
//    usados o mejor evaluados en la literatura de dimensionamiento de sistemas híbridos (Diab et al. 2019;
//    Kharrich et al. 2021). Usan las mismas reglas de factibilidad que SHADE.
// Multiobjetivo (frente de Pareto):
//  - nsga2: NSGA-II (Deb et al. 2002) con dominancia restringida.
//  - mopso: enjambre de partículas multiobjetivo con archivo externo (Coello et al. 2004).
//
// Los métodos poblacionales piden evaluaciones por lotes con `evaluar(lote)`, que la página reparte entre varios
// Web Workers. El híbrido es secuencial: cada corrida se ejecuta completa dentro de un worker (`correrHA`).

export const PENALIZACION = 1e6;   // la tesis descarta las soluciones que no cumplen con LCOE = 10⁶

// Generador pseudoaleatorio con semilla (mulberry32): los resultados se pueden repetir.
export function rng(semilla) {
  let s = semilla >>> 0;
  const f = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.normal = () => { let u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  f.cauchy = () => Math.tan(Math.PI * (f() - 0.5));
  return f;
}

export function aleatorio(r, limites) { return limites.map(([lo, hi]) => r.int(lo, hi)); }
function acotar(x, limites) { return x.map((v, k) => Math.min(limites[k][1], Math.max(limites[k][0], Math.round(v)))); }
const libresDe = (limites) => limites.map((_, k) => k).filter((k) => limites[k][1] > limites[k][0]);

// Aptitud con penalización (como en la tesis) y comparación con reglas de factibilidad de Deb.
export const aptitud = (e) => (e.viol > 0 ? PENALIZACION + e.viol : e.obj);
export function mejorQue(a, b) {
  if (!b) return true;
  if (a.viol === 0 && b.viol === 0) return a.obj < b.obj;
  if (a.viol === 0) return true;
  if (b.viol === 0) return false;
  return a.viol < b.viol || (a.viol === b.viol && a.obj < b.obj);
}
const mejorDe = (lista) => lista.reduce((m, e) => (mejorQue(e, m) ? e : m), null);
const ordenar = (lista) => [...lista].sort((a, b) => (mejorQue(a.e, b.e) ? -1 : mejorQue(b.e, a.e) ? 1 : 0));

// Población inicial por hipercubo latino: cubre cada rango de forma pareja (valores continuos).
function hipercubo(r, limites, n) {
  const pts = Array.from({ length: n }, () => new Array(limites.length));
  for (let k = 0; k < limites.length; k++) {
    const orden = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]]; }
    const [lo, hi] = limites[k];
    for (let i = 0; i < n; i++) pts[i][k] = lo + ((orden[i] + r()) / n) * (hi - lo);
  }
  return pts;
}

/* ---------- Monte Carlo (tesis) ---------- */

export async function monteCarlo({ limites, evaluar, muestras = 20000, lote = 2000, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla); let mejor = null; const historial = [];
  for (let hecho = 0; hecho < muestras && !detenido(); hecho += lote) {
    const n = Math.min(lote, muestras - hecho);
    // Como MC_LCOE.py: número real uniforme en cada rango y luego parte entera.
    const cfgs = Array.from({ length: n }, () => limites.map(([lo, hi]) => Math.min(hi, Math.floor(lo + r() * (hi - lo + 1)))));
    const res = await evaluar(cfgs);
    res.forEach((e) => { if (!mejor || aptitud(e) < aptitud(mejor)) mejor = e; });
    historial.push(aptitud(mejor));
    alProgresar?.({ fraccion: (hecho + n) / muestras, mejor, historial, etiqueta: `${(hecho + n).toLocaleString("es-CL")} de ${muestras.toLocaleString("es-CL")} muestras` });
  }
  return { mejor, historial };
}

/* ---------- Algoritmo híbrido CS-HS-SA (tesis; una corrida, síncrona) ---------- */

// Se ejecuta dentro de un worker con un evaluador síncrono. Sigue cs_hs_sa_optimizer.py: memoria armónica
// de 5 soluciones, HMCR, PAR creciente, paso ±1, aceptación de recocido simulado y memoria FIFO.
// A diferencia del script original, además de la solución actual guarda la mejor de la corrida.
export function correrHA({ limites, evaluarUno, iteraciones = 1000, hmcr = 0.9, parMin = 0.1, parMax = 1.0, t0 = 1000, s = 0.97, semilla = 1 }) {
  const r = rng(semilla);
  const HM = Array.from({ length: 5 }, () => aleatorio(r, limites));
  let actual = null;
  for (const e of HM.map(evaluarUno)) if (!actual || aptitud(e) < aptitud(actual)) actual = e;
  let mejor = actual, T = t0;
  const historial = [];
  for (let it = 0; it < iteraciones; it++) {
    const par = parMin + (parMax - parMin) * it / iteraciones;
    const x = limites.map(([lo, hi], k) => {
      if (r() > hmcr) return r.int(lo, hi);
      let v = HM[Math.floor(r() * HM.length)][k];
      if (r() < par) v += r() < 0.5 ? 1 : -1;
      return Math.min(hi, Math.max(lo, v));
    });
    const e = evaluarUno(x);
    const delta = aptitud(e) - aptitud(actual);
    if (delta < 0 || r() < Math.exp(-delta / T)) actual = e;
    if (aptitud(e) < aptitud(mejor)) mejor = e;
    T *= s;
    HM.push(x); HM.shift();
    historial.push(aptitud(mejor));
  }
  return { mejor, historial };
}

/* ---------- Algoritmo genético (tesis, DEAP) ---------- */

export async function genetico({ limites, evaluar, poblacion = 100, generaciones = 100, cxpb = 0.7, mutpb = 0.2, indpb = 0.2, torneo = 3, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla);
  let pop = await evaluar(Array.from({ length: poblacion }, () => aleatorio(r, limites)));
  let mejor = null; const historial = [];
  const actualizar = () => { for (const e of pop) if (!mejor || aptitud(e) < aptitud(mejor)) mejor = e; };
  actualizar();
  for (let g = 1; g <= generaciones && !detenido(); g++) {
    // selTournament(k=3), cxTwoPoint, mutUniformInt(indpb) y reemplazo generacional completo.
    const hijos = Array.from({ length: poblacion }, () => {
      let m = null;
      for (let k = 0; k < torneo; k++) { const c = pop[Math.floor(r() * poblacion)]; if (!m || aptitud(c) < aptitud(m)) m = c; }
      return { cfg: m.cfg.slice(), e: m };
    });
    for (let i = 0; i + 1 < poblacion; i += 2) {
      if (r() < cxpb) {
        const a = hijos[i].cfg, b = hijos[i + 1].cfg, n = a.length;
        let p1 = 1 + Math.floor(r() * n), p2 = 1 + Math.floor(r() * (n - 1));
        if (p2 >= p1) p2++; else [p1, p2] = [p2, p1];
        for (let k = p1; k < p2; k++) [a[k], b[k]] = [b[k], a[k]];
        hijos[i].e = hijos[i + 1].e = null;
      }
    }
    for (const h of hijos) {
      if (r() < mutpb) {
        h.cfg = h.cfg.map((v, k) => (r() < indpb ? r.int(limites[k][0], limites[k][1]) : v));
        h.e = null;
      }
    }
    const nuevos = hijos.filter((h) => !h.e);
    const res = await evaluar(nuevos.map((h) => h.cfg));
    nuevos.forEach((h, i) => { h.e = res[i]; });
    pop = hijos.map((h) => h.e);
    actualizar();
    historial.push(aptitud(mejor));
    alProgresar?.({ fraccion: g / generaciones, mejor, historial, etiqueta: `Generación ${g} de ${generaciones}` });
  }
  return { mejor, historial };
}

/* ---------- Pulido final: búsqueda de patrones entera ---------- */

async function pulirPatron({ mejor, limites, evaluar, detenido, historial, alProgresar, base = 0.9 }) {
  const libres = libresDe(limites);
  if (!libres.length) return mejor;
  let paso = limites.map(([lo, hi]) => Math.max(1, Math.round((hi - lo) / 50)));
  for (let ronda = 1; ronda <= 60 && !detenido(); ronda++) {
    const vecinos = [];
    for (const k of libres) {
      for (const sgn of [-1, 1]) {
        const c = mejor.cfg.slice(); c[k] = Math.min(limites[k][1], Math.max(limites[k][0], c[k] + sgn * paso[k]));
        if (c[k] !== mejor.cfg[k]) vecinos.push(c);
      }
    }
    if (!vecinos.length) break;
    const mv = mejorDe(await evaluar(vecinos));
    if (mejorQue(mv, mejor)) mejor = mv;
    else if (libres.every((k) => paso[k] <= 1)) break;
    else paso = paso.map((p) => Math.max(1, Math.floor(p / 2)));
    historial.push(aptitud(mejor));
    alProgresar?.({ fraccion: base + (1 - base) * Math.min(1, ronda / 30), mejor, historial, etiqueta: `Pulido final · ronda ${ronda}` });
  }
  return mejor;
}

/* ---------- SHADE con reglas de factibilidad + búsqueda de patrones ---------- */

export async function shade({ limites, evaluar, poblacion = 60, generaciones = 150, memoria = 6, pMejor = 0.11, pulir = true, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla);
  const libres = libresDe(limites);
  let pop = await evaluar(hipercubo(r, limites, poblacion).map((x) => acotar(x, limites)));
  const MF = new Array(memoria).fill(0.5), MCR = new Array(memoria).fill(0.5);
  let km = 0; const archivo = []; const historial = [];
  let mejor = mejorDe(pop);

  for (let g = 1; g <= generaciones && !detenido(); g++) {
    const orden = pop.map((e, i) => i).sort((a, b) => (mejorQue(pop[a], pop[b]) ? -1 : mejorQue(pop[b], pop[a]) ? 1 : 0));
    const nP = Math.max(2, Math.round(pMejor * poblacion));
    const pruebas = [], params = [];
    for (let i = 0; i < poblacion; i++) {
      const h = Math.floor(r() * memoria);
      let F; do { F = MF[h] + 0.1 * r.cauchy(); } while (F <= 0); F = Math.min(F, 1);
      const CR = Math.min(1, Math.max(0, MCR[h] + 0.1 * r.normal()));
      const pb = pop[orden[Math.floor(r() * nP)]].cfg;
      let a; do { a = Math.floor(r() * poblacion); } while (a === i);
      const union = pop.length + archivo.length; let b;
      do { b = Math.floor(r() * union); } while (b === i || b === a);
      const xa = pop[a].cfg, xb = b < pop.length ? pop[b].cfg : archivo[b - pop.length];
      const xi = pop[i].cfg, jr = libres.length ? libres[Math.floor(r() * libres.length)] : 0;
      // current-to-pbest/1 con cruce binomial; si un valor sale del rango, se refleja hacia adentro.
      const u = xi.map((v, k) => {
        if (limites[k][1] === limites[k][0]) return limites[k][0];
        if (k !== jr && r() >= CR) return v;
        let w = v + F * (pb[k] - v) + F * (xa[k] - xb[k]);
        if (w < limites[k][0]) w = (limites[k][0] + v) / 2;
        if (w > limites[k][1]) w = (limites[k][1] + v) / 2;
        return w;
      });
      const c = acotar(u, limites);
      if (libres.length && c.every((v, k) => v === xi[k])) {   // en enteros un paso pequeño puede no moverse: empujar ±1
        const k = libres[Math.floor(r() * libres.length)];
        c[k] = Math.min(limites[k][1], Math.max(limites[k][0], c[k] + (r() < 0.5 ? -1 : 1)));
      }
      pruebas.push(c); params.push({ F, CR });
    }
    const res = await evaluar(pruebas);
    const exF = [], exCR = [], pesos = [];
    for (let i = 0; i < poblacion; i++) {
      const e = res[i], o = pop[i];
      if (mejorQue(e, o)) {
        archivo.push(o.cfg); if (archivo.length > poblacion) archivo.splice(Math.floor(r() * archivo.length), 1);
        exF.push(params[i].F); exCR.push(params[i].CR);
        pesos.push(o.viol > 0 ? 1 + o.viol - e.viol : Math.abs(o.obj - e.obj) + 1e-9);
        pop[i] = e;
        if (mejorQue(e, mejor)) mejor = e;
      } else if (e.viol === o.viol && e.obj === o.obj) {
        pop[i] = e;                                     // empate: se acepta para seguir moviéndose
      }
    }
    if (exF.length) {                                  // memoria histórica de F y CR (media de Lehmer ponderada)
      const W = pesos.reduce((s, w) => s + w, 0);
      MF[km] = exF.reduce((s, f, j) => s + pesos[j] * f * f, 0) / exF.reduce((s, f, j) => s + pesos[j] * f, 0);
      MCR[km] = exCR.reduce((s, c, j) => s + (pesos[j] / W) * c, 0);
      km = (km + 1) % memoria;
    }
    historial.push(aptitud(mejor));
    alProgresar?.({ fraccion: (g / generaciones) * (pulir ? 0.9 : 1), mejor, historial, etiqueta: `Generación ${g} de ${generaciones}` });
  }
  if (pulir && !detenido()) mejor = await pulirPatron({ mejor, limites, evaluar, detenido, historial, alProgresar });
  return { mejor, historial };
}

/* ---------- Enjambre de partículas (PSO) ---------- */

// PSO con inercia decreciente (0,9 → 0,4) y c1 = c2 = 2; velocidades limitadas al 20 % del rango.
export async function pso({ limites, evaluar, poblacion = 50, generaciones = 200, c1 = 2, c2 = 2, pulir = true, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla), dim = limites.length;
  const vmax = limites.map(([lo, hi]) => Math.max(1, 0.2 * (hi - lo)));
  const X = hipercubo(r, limites, poblacion);
  const V = X.map(() => Array.from({ length: dim }, (_, k) => (r() - 0.5) * vmax[k]));
  let evals = await evaluar(X.map((x) => acotar(x, limites)));
  const pbest = evals.map((e, i) => ({ e, x: X[i].slice() }));
  let g = ordenar(pbest)[0];
  const historial = [];
  for (let it = 1; it <= generaciones && !detenido(); it++) {
    const w = 0.9 - 0.5 * (it / generaciones);
    for (let i = 0; i < poblacion; i++) {
      for (let k = 0; k < dim; k++) {
        V[i][k] = w * V[i][k] + c1 * r() * (pbest[i].x[k] - X[i][k]) + c2 * r() * (g.x[k] - X[i][k]);
        V[i][k] = Math.max(-vmax[k], Math.min(vmax[k], V[i][k]));
        X[i][k] = Math.max(limites[k][0], Math.min(limites[k][1], X[i][k] + V[i][k]));
      }
    }
    evals = await evaluar(X.map((x) => acotar(x, limites)));
    for (let i = 0; i < poblacion; i++) {
      if (mejorQue(evals[i], pbest[i].e)) pbest[i] = { e: evals[i], x: X[i].slice() };
      if (mejorQue(pbest[i].e, g.e)) g = pbest[i];
    }
    historial.push(aptitud(g.e));
    alProgresar?.({ fraccion: (it / generaciones) * (pulir ? 0.9 : 1), mejor: g.e, historial, etiqueta: `Iteración ${it} de ${generaciones}` });
  }
  let mejor = g.e;
  if (pulir && !detenido()) mejor = await pulirPatron({ mejor, limites, evaluar, detenido, historial, alProgresar });
  return { mejor, historial };
}

/* ---------- Lobo gris (GWO), ballena (WOA) y optimizador de equilibrio (EO) ---------- */

// Los tres comparten la estructura: población continua, líderes según reglas de factibilidad y un parámetro que
// pasa de exploración a explotación a lo largo de las iteraciones.
async function metaheuristica({ nombre, paso, limites, evaluar, poblacion = 50, generaciones = 200, pulir = true, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla), dim = limites.length;
  let X = hipercubo(r, limites, poblacion);
  let evals = await evaluar(X.map((x) => acotar(x, limites)));
  let pob = evals.map((e, i) => ({ e, x: X[i].slice() }));
  const memoria = pob.map((p) => ({ ...p }));       // mejor posición de cada individuo
  let mejor = ordenar(pob)[0];
  const historial = [];
  for (let it = 1; it <= generaciones && !detenido(); it++) {
    X = paso({ r, dim, pob, orden: ordenar(pob), memoria, mejor, it, generaciones });
    X = X.map((x) => x.map((v, k) => (Number.isFinite(v) ? Math.max(limites[k][0], Math.min(limites[k][1], v)) : limites[k][0] + r() * (limites[k][1] - limites[k][0]))));
    evals = await evaluar(X.map((x) => acotar(x, limites)));
    pob = evals.map((e, i) => ({ e, x: X[i].slice() }));
    for (let i = 0; i < poblacion; i++) {
      if (mejorQue(pob[i].e, memoria[i].e)) memoria[i] = { ...pob[i] };
      if (mejorQue(pob[i].e, mejor.e)) mejor = pob[i];
    }
    historial.push(aptitud(mejor.e));
    alProgresar?.({ fraccion: (it / generaciones) * (pulir ? 0.9 : 1), mejor: mejor.e, historial, etiqueta: `${nombre} · iteración ${it} de ${generaciones}` });
  }
  let m = mejor.e;
  if (pulir && !detenido()) m = await pulirPatron({ mejor: m, limites, evaluar, detenido, historial, alProgresar });
  return { mejor: m, historial };
}

// GWO (Mirjalili et al. 2014): cada lobo se mueve hacia el promedio de lo que le indican las guías alfa, beta y delta.
export function gwo(opts) {
  return metaheuristica({ ...opts, nombre: "Lobo gris", paso: ({ r, dim, pob, orden, it, generaciones }) => {
    const a = 2 - 2 * (it / generaciones);
    const lideres = orden.slice(0, 3).map((p) => p.x);
    return pob.map(({ x }) => Array.from({ length: dim }, (_, k) => {
      let suma = 0;
      for (const L of lideres) {
        const A = 2 * a * r() - a, C = 2 * r();
        suma += L[k] - A * Math.abs(C * L[k] - x[k]);
      }
      return suma / lideres.length;
    }));
  } });
}

// WOA (Mirjalili y Lewis 2016): cerco de la presa o espiral logarítmica; si |A| ≥ 1, explora hacia otra ballena al azar.
export function woa(opts) {
  return metaheuristica({ ...opts, nombre: "Ballena", paso: ({ r, dim, pob, mejor, it, generaciones }) => {
    const a = 2 - 2 * (it / generaciones);
    return pob.map(({ x }) => {
      const A = 2 * a * r() - a, C = 2 * r(), p = r(), l = 2 * r() - 1;
      const ref = Math.abs(A) >= 1 ? pob[Math.floor(r() * pob.length)].x : mejor.x;
      return Array.from({ length: dim }, (_, k) => (p < 0.5
        ? ref[k] - A * Math.abs(C * ref[k] - x[k])
        : Math.abs(mejor.x[k] - x[k]) * Math.exp(l) * Math.cos(2 * Math.PI * l) + mejor.x[k]));
    });
  } });
}

// EO (Faramarzi et al. 2020): cada partícula se acerca a un «equilibrio» elegido entre las 4 mejores y su promedio.
export function eo(opts) {
  const a1 = 2, a2 = 1, GP = 0.5;
  return metaheuristica({ ...opts, nombre: "Equilibrio", paso: ({ r, dim, pob, memoria, it, generaciones }) => {
    const mejores = ordenar(memoria).slice(0, 4).map((p) => p.x);
    const promedio = Array.from({ length: dim }, (_, k) => mejores.reduce((s, x) => s + x[k], 0) / mejores.length);
    const pool = [...mejores, promedio];
    const t = Math.pow(1 - it / generaciones, a2 * it / generaciones);
    return pob.map(({ x }) => {
      const Ceq = pool[Math.floor(r() * pool.length)];
      const GCP = r() >= GP ? 0.5 * r() : 0;
      return Array.from({ length: dim }, (_, k) => {
        const lambda = Math.max(1e-6, r());
        const F = a1 * Math.sign(r() - 0.5) * (Math.exp(-lambda * t) - 1);
        const G = GCP * (Ceq[k] - lambda * x[k]) * F;
        return Ceq[k] + (x[k] - Ceq[k]) * F + (G / lambda) * (1 - F);
      });
    });
  } });
}

/* ---------- Multiobjetivo: dominancia y frente de Pareto ---------- */

// a domina a b (con restricciones): factible gana a infactible; entre infactibles, menor violación;
// entre factibles, no peor en ningún objetivo y mejor en alguno.
export function domina(a, b) {
  if (a.viol === 0 && b.viol > 0) return true;
  if (a.viol > 0 && b.viol === 0) return false;
  if (a.viol > 0 && b.viol > 0) return a.viol < b.viol;
  let mejorEnAlguno = false;
  for (let k = 0; k < a.objs.length; k++) {
    if (a.objs[k] > b.objs[k]) return false;
    if (a.objs[k] < b.objs[k]) mejorEnAlguno = true;
  }
  return mejorEnAlguno;
}

function frentesNoDominados(pop) {
  const n = pop.length, S = Array.from({ length: n }, () => []), cuenta = new Array(n).fill(0), rango = new Array(n);
  const frentes = [[]];
  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (domina(pop[p], pop[q])) S[p].push(q); else if (domina(pop[q], pop[p])) cuenta[p]++;
    }
    if (cuenta[p] === 0) { rango[p] = 0; frentes[0].push(p); }
  }
  for (let i = 0; frentes[i].length; i++) {
    const sig = [];
    for (const p of frentes[i]) for (const q of S[p]) if (--cuenta[q] === 0) { rango[q] = i + 1; sig.push(q); }
    frentes.push(sig);
  }
  frentes.pop();
  return { frentes, rango };
}

function distanciaApinamiento(pop, idx) {
  const d = new Map(idx.map((i) => [i, 0]));
  if (!idx.length) return d;
  const m = pop[idx[0]].objs.length;
  for (let k = 0; k < m; k++) {
    const orden = [...idx].sort((a, b) => pop[a].objs[k] - pop[b].objs[k]);
    const min = pop[orden[0]].objs[k], max = pop[orden[orden.length - 1]].objs[k];
    d.set(orden[0], Infinity); d.set(orden[orden.length - 1], Infinity);
    if (max === min) continue;
    for (let j = 1; j < orden.length - 1; j++) d.set(orden[j], d.get(orden[j]) + (pop[orden[j + 1]].objs[k] - pop[orden[j - 1]].objs[k]) / (max - min));
  }
  return d;
}

// Frente final: factibles, no dominadas entre sí y sin configuraciones repetidas, ordenadas por el primer objetivo.
export function frenteDePareto(lista) {
  const unicos = [...new Map(lista.map((e) => [e.cfg.join(","), e])).values()].filter((e) => e.viol === 0);
  return unicos.filter((a) => !unicos.some((b) => b !== a && domina(b, a)))
    .sort((a, b) => a.objs[0] - b.objs[0]);
}

/* ---------- NSGA-II ---------- */

// Cruce SBX y mutación polinomial (sobre valores continuos que luego se redondean), torneo binario por rango y
// distancia de apiñamiento, y reemplazo elitista (padres + hijos).
export async function nsga2({ limites, evaluar, poblacion = 80, generaciones = 150, pc = 0.9, etaC = 15, etaM = 20, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla), libres = libresDe(limites), pm = 1 / Math.max(1, libres.length);
  let pop = await evaluar(hipercubo(r, limites, poblacion).map((x) => acotar(x, limites)));
  const clasificar = (P) => {
    const { frentes, rango } = frentesNoDominados(P);
    const dist = new Map();
    for (const f of frentes) for (const [i, v] of distanciaApinamiento(P, f)) dist.set(i, v);
    return { frentes, rango, dist };
  };
  let info = clasificar(pop);
  const historial = [];
  for (let g = 1; g <= generaciones && !detenido(); g++) {
    const torneo = () => {
      const a = Math.floor(r() * pop.length), b = Math.floor(r() * pop.length);
      if (info.rango[a] !== info.rango[b]) return info.rango[a] < info.rango[b] ? a : b;
      return info.dist.get(a) >= info.dist.get(b) ? a : b;
    };
    const hijos = [];
    while (hijos.length < poblacion) {
      const p1 = pop[torneo()].cfg, p2 = pop[torneo()].cfg;
      const c1 = p1.slice(), c2 = p2.slice();
      if (r() < pc) {
        for (const k of libres) {
          if (r() > 0.5 || p1[k] === p2[k]) continue;
          const u = r(), beta = u <= 0.5 ? Math.pow(2 * u, 1 / (etaC + 1)) : Math.pow(1 / (2 * (1 - u)), 1 / (etaC + 1));
          c1[k] = 0.5 * ((1 + beta) * p1[k] + (1 - beta) * p2[k]);
          c2[k] = 0.5 * ((1 - beta) * p1[k] + (1 + beta) * p2[k]);
        }
      }
      for (const c of [c1, c2]) {
        for (const k of libres) {
          if (r() >= pm) continue;
          const [lo, hi] = limites[k], u = r();
          const d = u < 0.5 ? Math.pow(2 * u, 1 / (etaM + 1)) - 1 : 1 - Math.pow(2 * (1 - u), 1 / (etaM + 1));
          c[k] = c[k] + d * Math.max(1, hi - lo);
        }
        hijos.push(acotar(c, limites));
      }
    }
    const evalHijos = await evaluar(hijos.slice(0, poblacion));
    const union = [...pop, ...evalHijos];
    const u = clasificar(union);
    const siguiente = [];
    for (const f of u.frentes) {
      if (siguiente.length + f.length <= poblacion) { siguiente.push(...f); continue; }
      const resto = [...f].sort((a, b) => u.dist.get(b) - u.dist.get(a));
      siguiente.push(...resto.slice(0, poblacion - siguiente.length));
      break;
    }
    pop = siguiente.map((i) => union[i]);
    info = clasificar(pop);
    const frente = frenteDePareto(pop);
    historial.push(frente.length);
    alProgresar?.({ fraccion: g / generaciones, frente, historial, etiqueta: `Generación ${g} de ${generaciones} · ${frente.length} soluciones en el frente` });
  }
  return { frente: frenteDePareto(pop), historial };
}

/* ---------- MOPSO ---------- */

// Enjambre multiobjetivo con archivo externo de soluciones no dominadas (máx. `archivoMax`). El líder de cada
// partícula se elige entre las del archivo con mayor distancia de apiñamiento (zonas del frente menos pobladas).
export async function mopso({ limites, evaluar, poblacion = 60, generaciones = 150, archivoMax = 100, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla), dim = limites.length, libres = libresDe(limites);
  const vmax = limites.map(([lo, hi]) => Math.max(1, 0.2 * (hi - lo)));
  const X = hipercubo(r, limites, poblacion);
  const V = X.map(() => new Array(dim).fill(0));
  let evals = await evaluar(X.map((x) => acotar(x, limites)));
  const pbest = evals.map((e, i) => ({ e, x: X[i].slice() }));
  let archivo = [];
  const actualizarArchivo = (nuevos) => {
    let a = [...archivo];
    for (const p of nuevos) {
      const clave = p.e.cfg.join(",");
      if (a.some((q) => domina(q.e, p.e) || q.e.cfg.join(",") === clave)) continue;
      a = a.filter((q) => !domina(p.e, q.e));
      a.push(p);
    }
    if (a.length > archivoMax) {
      const pe = a.map((p) => p.e), d = distanciaApinamiento(pe, pe.map((_, i) => i));
      a = a.map((p, i) => ({ p, d: d.get(i) })).sort((x, y) => y.d - x.d).slice(0, archivoMax).map((z) => z.p);
    }
    archivo = a;
  };
  actualizarArchivo(evals.map((e, i) => ({ e, x: X[i].slice() })));
  const historial = [];
  for (let it = 1; it <= generaciones && !detenido(); it++) {
    const w = 0.9 - 0.5 * (it / generaciones);
    const pe = archivo.map((p) => p.e);
    const d = distanciaApinamiento(pe, pe.map((_, i) => i));
    const lideres = archivo.map((p, i) => ({ p, d: d.get(i) })).sort((a, b) => b.d - a.d)
      .slice(0, Math.max(1, Math.ceil(archivo.length * 0.3)));
    for (let i = 0; i < poblacion; i++) {
      const L = (lideres.length ? lideres[Math.floor(r() * lideres.length)].p : pbest[i]).x;
      for (let k = 0; k < dim; k++) {
        V[i][k] = w * V[i][k] + 1.5 * r() * (pbest[i].x[k] - X[i][k]) + 1.5 * r() * (L[k] - X[i][k]);
        V[i][k] = Math.max(-vmax[k], Math.min(vmax[k], V[i][k]));
        X[i][k] = Math.max(limites[k][0], Math.min(limites[k][1], X[i][k] + V[i][k]));
      }
      if (libres.length && r() < 0.15 * (1 - it / generaciones)) {    // mutación que decrece, para no estancarse
        const k = libres[Math.floor(r() * libres.length)];
        X[i][k] = limites[k][0] + r() * (limites[k][1] - limites[k][0]);
      }
    }
    evals = await evaluar(X.map((x) => acotar(x, limites)));
    for (let i = 0; i < poblacion; i++) {
      if (domina(evals[i], pbest[i].e) || (!domina(pbest[i].e, evals[i]) && r() < 0.5)) pbest[i] = { e: evals[i], x: X[i].slice() };
    }
    actualizarArchivo(evals.map((e, i) => ({ e, x: X[i].slice() })));
    const frente = frenteDePareto(archivo.map((p) => p.e));
    historial.push(frente.length);
    alProgresar?.({ fraccion: it / generaciones, frente, historial, etiqueta: `Iteración ${it} de ${generaciones} · ${frente.length} soluciones en el frente` });
  }
  return { frente: frenteDePareto(archivo.map((p) => p.e)), historial };
}
