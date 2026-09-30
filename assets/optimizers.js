// Métodos de optimización del Simulador HRES-H2.
//
// Todos minimizan el LCOE sujeto a la confiabilidad (LOLE ≤ h). Trabajan con vectores de 6 enteros
// [n_wt, n_pv, n_con, n_ele, n_ht, n_fc] dentro de `limites`.
//  - mc:    Monte Carlo (tesis): muestreo aleatorio uniforme.
//  - ha:    algoritmo híbrido de búsqueda caótica, armónica y recocido simulado (tesis, Zhang et al.).
//  - ga:    algoritmo genético como en DEAP (tesis): torneo 3, cruce en dos puntos, mutación entera uniforme.
//  - shade: evolución diferencial adaptativa (SHADE) con reglas de factibilidad de Deb y pulido final
//           por búsqueda de patrones entera. No está en la tesis: se agrega por ser más eficiente.
//
// Los métodos poblacionales (mc, ga, shade) piden evaluaciones por lotes con `evaluar(lote)`, que la
// página reparte entre varios Web Workers. El híbrido es secuencial: cada corrida se ejecuta completa
// dentro de un worker (`correrHA`), y las corridas se reparten entre workers.

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

// Aptitud con penalización (como en la tesis) y comparación con reglas de factibilidad (para SHADE).
export const aptitud = (e) => (e.viol > 0 ? PENALIZACION + e.viol : e.lcoe);
export function mejorQue(a, b) {
  if (!b) return true;
  if (a.viol === 0 && b.viol === 0) return a.lcoe < b.lcoe;
  if (a.viol === 0) return true;
  if (b.viol === 0) return false;
  return a.viol < b.viol || (a.viol === b.viol && a.lcoe < b.lcoe);
}

/* ---------- Monte Carlo ---------- */

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

/* ---------- Algoritmo híbrido CS-HS-SA (una corrida, síncrona) ---------- */

// Se ejecuta dentro de un worker con un evaluador síncrono. Sigue cs_hs_sa_optimizer.py: memoria armónica
// de 5 soluciones, HMCR, PAR creciente, paso ±1, aceptación de recocido simulado y memoria FIFO.
// A diferencia del script original, además de la solución actual guarda la mejor de la corrida.
export function correrHA({ limites, evaluarUno, iteraciones = 1000, hmcr = 0.9, parMin = 0.1, parMax = 1.0, t0 = 1000, s = 0.97, semilla = 1 }) {
  const r = rng(semilla);
  const HM = Array.from({ length: 5 }, () => aleatorio(r, limites));
  const evals = HM.map(evaluarUno);
  let actual = evals[0];
  for (const e of evals) if (aptitud(e) < aptitud(actual)) actual = e;
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

/* ---------- Algoritmo genético (DEAP) ---------- */

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

/* ---------- SHADE con reglas de factibilidad + búsqueda de patrones ---------- */

export async function shade({ limites, evaluar, poblacion = 60, generaciones = 150, memoria = 6, pMejor = 0.11, pulir = true, semilla = 1, alProgresar, detenido }) {
  const r = rng(semilla);
  const libres = limites.map(([lo, hi]) => hi > lo);
  const indicesLibres = [0, 1, 2, 3, 4, 5].filter((k) => libres[k]);
  const rango = limites.map(([lo, hi]) => hi - lo);
  // Población inicial por hipercubo latino: cubre cada rango de forma pareja.
  const inicio = Array.from({ length: poblacion }, () => new Array(6));
  for (let k = 0; k < 6; k++) {
    const orden = Array.from({ length: poblacion }, (_, i) => i);
    for (let i = poblacion - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]]; }
    for (let i = 0; i < poblacion; i++) inicio[i][k] = limites[k][0] + ((orden[i] + r()) / poblacion) * rango[k];
  }
  let pop = await evaluar(inicio.map((x) => acotar(x, limites)));
  const MF = new Array(memoria).fill(0.5), MCR = new Array(memoria).fill(0.5);
  let km = 0; const archivo = []; const historial = [];
  let mejor = pop.reduce((m, e) => (mejorQue(e, m) ? e : m), null);

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
      const xi = pop[i].cfg, jr = indicesLibres.length ? indicesLibres[Math.floor(r() * indicesLibres.length)] : 0;
      // current-to-pbest/1 con cruce binomial; si un valor sale del rango, se refleja hacia adentro.
      const u = xi.map((v, k) => {
        if (!libres[k]) return limites[k][0];
        if (k !== jr && r() >= CR) return v;
        let w = v + F * (pb[k] - v) + F * (xa[k] - xb[k]);
        if (w < limites[k][0]) w = (limites[k][0] + v) / 2;
        if (w > limites[k][1]) w = (limites[k][1] + v) / 2;
        return w;
      });
      const c = acotar(u, limites);
      if (indicesLibres.length && c.every((v, k) => v === xi[k])) {   // en enteros un paso pequeño puede no moverse: empujar ±1
        const k = indicesLibres[Math.floor(r() * indicesLibres.length)];
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
        pesos.push(o.viol > 0 ? 1 + o.viol - e.viol : Math.abs(o.lcoe - e.lcoe) + 1e-9);
        pop[i] = e;
        if (mejorQue(e, mejor)) mejor = e;
      } else if (e.viol === o.viol && e.lcoe === o.lcoe) {
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

  if (pulir && !detenido() && indicesLibres.length) {   // búsqueda de patrones entera alrededor de la mejor solución
    let paso = limites.map(([lo, hi]) => Math.max(1, Math.round((hi - lo) / 50)));
    for (let ronda = 1; ronda <= 60 && !detenido(); ronda++) {
      const vecinos = [];
      for (const k of indicesLibres) {
        for (const sgn of [-1, 1]) {
          const c = mejor.cfg.slice(); c[k] = Math.min(limites[k][1], Math.max(limites[k][0], c[k] + sgn * paso[k]));
          if (c[k] !== mejor.cfg[k]) vecinos.push(c);
        }
      }
      if (!vecinos.length) break;
      const res = await evaluar(vecinos);
      const mejorVecino = res.reduce((m, e) => (mejorQue(e, m) ? e : m), null);
      if (mejorQue(mejorVecino, mejor)) mejor = mejorVecino;
      else if (indicesLibres.every((k) => paso[k] <= 1)) break;
      else paso = paso.map((p) => Math.max(1, Math.floor(p / 2)));
      historial.push(aptitud(mejor));
      alProgresar?.({ fraccion: 0.9 + 0.1 * Math.min(1, ronda / 30), mejor, historial, etiqueta: `Pulido final · ronda ${ronda}` });
    }
  }
  return { mejor, historial };
}
