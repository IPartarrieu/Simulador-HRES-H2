// Motor del Simulador HRES-H2.
//
// Reproduce el algoritmo de la tesis de Ignacio Partarrieu (Magíster en Geofísica, UdeC, 2026):
// despacho horario de un sistema PV-WT-HESS (funciones.py) y su evaluación económica (NPC, CRF, LCOE).
// Además calcula la potencia de cualquier aerogenerador o panel del catálogo a partir de datos
// meteorológicos, con los modelos físicos del artículo (ecuaciones 2.2.1 a 2.2.6).
//
// Se usa igual en el navegador (página y Web Workers) y en Node (pruebas).

/* ---------- Catálogo de equipos ---------- */

// Valores de la tesis (Tablas 2.2.3 y 2.2.5) y alternativas referenciales de fichas técnicas y literatura.
// Los costos de las alternativas son estimaciones para comparar: el usuario puede editarlos.
export const CATALOGO = {
  wt: [
    { id: "gaia133", nombre: "Gaia-Wind 133 · 11 kW (tesis)", pr: 11, vcin: 3.5, vr: 9.5, vcout: 25, hub: 18,
      ci: 80000, rep: 66000, om: 1600, vu: 20 },
    { id: "bergey10", nombre: "Bergey Excel 10 · 10 kW", pr: 10, vcin: 3.4, vr: 11, vcout: 20, hub: 24,
      ci: 65000, rep: 50000, om: 1300, vu: 20 },
    { id: "eocycle22", nombre: "Eocycle EOX S-16 · 22 kW", pr: 22, vcin: 2.75, vr: 11, vcout: 25, hub: 24,
      ci: 150000, rep: 120000, om: 3000, vu: 20 },
    { id: "nps100", nombre: "Northern Power NPS 100C-24 · 95 kW", pr: 95, vcin: 3, vr: 12, vcout: 25, hub: 37,
      ci: 450000, rep: 380000, om: 9000, vu: 20 },
  ],
  pv: [
    { id: "cs6u330", nombre: "Canadian Solar CS6U-330P · 330 W (tesis)", pr: 0.33, eff: 16.97, alfa: -0.41, noct: 45, fpv: 0.8,
      ci: 206.67, rep: 206.67, om: 0, vu: 25 },
    { id: "jinko440", nombre: "JinkoSolar Tiger Neo · 440 W", pr: 0.44, eff: 22.5, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 275.6, rep: 275.6, om: 0, vu: 30 },
    { id: "longi430", nombre: "LONGi Hi-MO 6 · 430 W", pr: 0.43, eff: 22.0, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 269.3, rep: 269.3, om: 0, vu: 30 },
    { id: "trina405", nombre: "Trina Vertex S · 405 W", pr: 0.405, eff: 21.1, alfa: -0.34, noct: 43, fpv: 0.8,
      ci: 253.6, rep: 253.6, om: 0, vu: 30 },
  ],
  con: [
    { id: "conv1", nombre: "Conversor genérico · 1 kW, 95 % (tesis)", pr: 1, eta: 0.95, ci: 300, rep: 300, om: 0, vu: 15 },
    { id: "conv5", nombre: "Inversor bidireccional · 5 kW, 97 %", pr: 5, eta: 0.97, ci: 1750, rep: 1750, om: 0, vu: 15 },
  ],
  ele: [
    { id: "pem3", nombre: "PEM · 3 kW, 74 % (tesis, Zhang et al.)", pr: 3, eta: 0.74, ci: 4500, rep: 700, om: 0, vu: 5 },
    { id: "ael5", nombre: "Alcalino (AEL) · 5 kW, 65 %", pr: 5, eta: 0.65, ci: 5000, rep: 1750, om: 50, vu: 10 },
    { id: "pem5", nombre: "PEM de larga vida · 5 kW, 70 %", pr: 5, eta: 0.70, ci: 7000, rep: 2100, om: 70, vu: 10 },
  ],
  ht: [
    { id: "tank03", nombre: "Tanque de H₂ · 0,3 kWh (tesis, Zhang et al.)", cap: 0.3, ci: 600, rep: 0, om: 5, vu: 20 },
    { id: "tank1", nombre: "Tanque de H₂ tipo IV · 1 kWh", cap: 1, ci: 1500, rep: 0, om: 10, vu: 20 },
  ],
  fc: [
    { id: "pemfc3", nombre: "Celda PEM · 3 kW, 50 % (tesis, Zhang et al.)", pr: 3, eta: 0.50, ci: 600, rep: 700, om: 0, vu: 5 },
    { id: "pemfc5", nombre: "Celda PEM de larga vida · 5 kW, 55 %", pr: 5, eta: 0.55, ci: 7500, rep: 3000, om: 50, vu: 8 },
    { id: "sofc5", nombre: "Celda de óxido sólido (SOFC) · 5 kW, 60 %", pr: 5, eta: 0.60, ci: 15000, rep: 5000, om: 150, vu: 6 },
  ],
};

export const MODULOS = ["wt", "pv", "con", "ele", "ht", "fc"];
export const NOMBRES = { wt: "Aerogeneradores", pv: "Paneles fotovoltaicos", con: "Conversores DC/AC", ele: "Electrolizadores", ht: "Tanques de H₂", fc: "Celdas de combustible" };

export const ECONOMIA_TESIS = { dn: 0.08, ie: 0.03, anios: 20, reserva: 0.10 };

/* ---------- Potencia por equipo a partir del clima ---------- */

// Panel fotovoltaico (ec. 2.2.1 a 2.2.3): radiación inclinada y temperatura de celda.
export function potenciaPV(pv, gti, tempC) {
  const out = new Float64Array(gti.length);
  const tauAlfa = 0.9, eta = pv.eff / 100;
  for (let t = 0; t < gti.length; t++) {
    const g = Math.max(0, gti[t]);
    const tc = tempC[t] + g * ((pv.noct - 20) / 800) * (1 - eta / tauAlfa);
    const p = pv.pr * pv.fpv * (g / 1000) * (1 + (pv.alfa / 100) * (tc - 25));
    out[t] = Math.min(Math.max(p, 0), pv.pr);
  }
  return out;
}

// Aerogenerador (ec. 2.2.4 a 2.2.6): viento a la altura del buje (ley potencial con el perfil 10-100 m de cada hora),
// curva lineal entre la velocidad de arranque y la nominal, y corrección por densidad del aire.
export function potenciaWT(wt, v10, v100, tempC, presionHpa) {
  const out = new Float64Array(v10.length);
  for (let t = 0; t < v10.length; t++) {
    let a = 1 / 7;
    if (v10[t] > 0.5 && v100[t] > 0.5) a = Math.min(0.6, Math.max(0, Math.log(v100[t] / v10[t]) / Math.log(10)));
    const v = v10[t] > 0 ? v10[t] * Math.pow(wt.hub / 10, a) : 0;
    let p = 0;
    if (v > wt.vcin && v < wt.vr) p = wt.pr * (v - wt.vcin) / (wt.vr - wt.vcin);
    else if (v >= wt.vr && v < wt.vcout) p = wt.pr;
    const rho = (presionHpa[t] * 100) / (287.05 * (tempC[t] + 273.15));
    out[t] = Math.min(p * rho / 1.225, wt.pr);
  }
  return out;
}

/* ---------- Economía (params.py y funciones.py) ---------- */

export function tasaReal(dn, ie) { return (dn - ie) / (1 + ie); }

export function crf(i, anios) {
  const coef = (i * Math.pow(1 + i, anios)) / (Math.pow(1 + i, anios) - 1);
  const df = [];
  for (let j = 0; j <= anios; j++) df.push(1 / Math.pow(1 + i, j));
  return { coef, df };
}

// Costo presente neto de una unidad: inversión + reemplazos cada `vu` años (incluido el último año)
// + operación y mantenimiento anual − valor residual al final del proyecto (ec. 2.2.15 a 2.2.17).
export function npcUnidad(dev, df, anios) {
  let npc = dev.ci;
  for (let y = dev.vu; y <= anios; y += dev.vu) npc += dev.rep * df[y];
  for (let y = 1; y <= anios; y++) npc += dev.om * df[y];
  const resto = anios - dev.vu * Math.floor(anios / dev.vu);
  npc -= dev.rep * (resto / dev.vu) * df[anios];
  return npc;
}

/* ---------- Preparación del caso ---------- */

// Arma todo lo que necesita la simulación: series por unidad, capacidades y costos por unidad.
// `demanda`: kW horarios; `wtKw`, `pvKw`: potencia de UNA unidad en cada hora.
export function prepararCaso({ demanda, wtKw, pvKw, equipos, economia }) {
  const n = demanda.length;
  const D = new Float64Array(n), WT = new Float64Array(n), PV = new Float64Array(n);
  let sumaD = 0, maxD = 0;
  for (let t = 0; t < n; t++) {
    D[t] = demanda[t] * (1 + economia.reserva);
    WT[t] = wtKw ? Math.min(wtKw[t], equipos.wt.pr) : 0;     // la tesis recorta a la potencia nominal
    PV[t] = pvKw ? Math.min(pvKw[t], equipos.pv.pr) : 0;
    sumaD += D[t]; if (D[t] > maxD) maxD = D[t];
  }
  const i = tasaReal(economia.dn, economia.ie);
  const { coef, df } = crf(i, economia.anios);
  const npcU = MODULOS.map((k) => npcUnidad(equipos[k], df, economia.anios));
  return {
    n, D, WT, PV, mediaD: sumaD / n, maxD,
    wtPr: equipos.wt.pr, pvPr: equipos.pv.pr,
    con: { pr: equipos.con.pr, eta: equipos.con.eta },
    ele: { pr: equipos.ele.pr, eta: equipos.ele.eta },
    ht: { cap: equipos.ht.cap },
    fc: { pr: equipos.fc.pr, eta: equipos.fc.eta },
    crf: coef, npcU, ciU: MODULOS.map((k) => equipos[k].ci),
  };
}

/* ---------- Simulación horaria (HRES de funciones.py) ---------- */

// round(x, 2) de Python: redondea el valor binario exacto y, en empates exactos, al par más cercano.
// Solo se usa el camino lento en las horas con déficit visible.
function redondear2(x) {
  if (Math.abs(x) < 0.004) return 0;
  const c = x * 100, f = c - Math.floor(c);
  if (Math.abs(f - 0.5) > 1e-6) return Math.round(c) / 100;        // lejos de un empate: el camino rápido da lo mismo
  const doble = x * 200;
  if (Number.isInteger(doble) && Math.abs(doble % 2) === 1) {      // empate exacto (…,xx5)
    const c = x * 100, abajo = Math.floor(c);
    return (abajo % 2 === 0 ? abajo : abajo + 1) / 100;
  }
  return Number(x.toFixed(2));
}

// cfg = [n_wt, n_pv, n_con, n_ele, n_ht, n_fc]. Con `completo` devuelve también las series horarias.
export function simular(caso, cfg, completo = false) {
  const [nWt, nPv, nCon, nEle, nHt, nFc] = cfg;
  const { n, D, WT: wt1, PV: pv1 } = caso;
  const etaCon = caso.con.eta, capCon = nCon * caso.con.pr;
  const etaEle = caso.ele.eta, capEle = nEle * caso.ele.pr;
  const capHt = nHt * caso.ht.cap;
  const etaFc = caso.fc.eta, capFc = nFc * caso.fc.pr;

  let eStr = capHt; const eStrMax = capHt, eStrMin = 0;   // los tanques parten llenos
  let eSum = 0, perdida = 0, ens = 0, lole = 0, h2Entra = 0, h2Sale = 0;
  let sWt, sPv, sSum, sStr, sLoss, sDef;
  if (completo) {
    sWt = new Float64Array(n); sPv = new Float64Array(n); sSum = new Float64Array(n);
    sStr = new Float64Array(n); sLoss = new Float64Array(n); sDef = new Float64Array(n);
  }

  for (let t = 0; t < n; t++) {
    const WT = wt1[t] * nWt, PV = pv1[t] * nPv, d = D[t];
    let sum = 0, exc = 0, necStr = 0;
    let lossAcDc = 0, lossEle = 0, lossStr = 0, lossFc = 0;

    if (WT >= d) {
      sum = d;
      const A = (WT - d) * etaCon;                  // excedente eólico que pasa del bus AC al DC
      const eAcDc = Math.min(A, capCon);
      lossAcDc = Math.max(A - capCon, 0);
      exc = PV + eAcDc;
    } else {
      const necDc = (d - WT) / etaCon;
      if (capCon >= necDc * etaCon) {
        if (PV >= necDc) { sum = WT + necDc * etaCon; exc = PV - necDc; }
        else { sum = WT; necStr = necDc - PV; }
      } else if (capCon >= PV * etaCon) {
        sum = WT; necStr = capCon / etaCon - PV;
      } else {
        sum = WT + capCon; exc = PV - capCon / etaCon;
      }
    }

    if (exc > 0) {                                   // excedente al electrolizador y a los tanques
      const A = exc * etaEle;
      const eEleHt = Math.min(A, capEle);
      lossEle = Math.max(A - capEle, 0);
      let E;
      if (eEleHt + eStr > eStrMax) { E = eStrMax - eStr; lossStr = eEleHt - E; }
      else { E = eEleHt; }
      eStr += E; h2Entra += E;
    }

    if (necStr > 0) {                                // déficit cubierto con los tanques y las celdas
      const X = necStr / etaFc;
      const eHtFc = Math.min(X, eStr - eStrMin, capHt);
      eStr -= eHtFc; h2Sale += eHtFc;
      const A = eHtFc * etaFc;
      const eFcSys = Math.min(A, capFc);
      lossFc = Math.max(A - capFc, 0);
      sum += (eFcSys + PV) * etaCon;
    }

    const loss = lossAcDc + lossEle + lossStr + lossFc;
    const def = redondear2(d - sum);                 // igual que round(D - E_sys_D, 2) en Python
    eSum += sum; perdida += loss; ens += def;
    if (def > 0.01) lole++;
    if (completo) { sWt[t] = WT; sPv[t] = PV; sSum[t] = sum; sStr[t] = eStr; sLoss[t] = loss; sDef[t] = def; }
  }

  let npc = 0, capex = 0;
  for (let k = 0; k < 6; k++) { npc += cfg[k] * caso.npcU[k]; capex += cfg[k] * caso.ciU[k]; }
  const lcoe = eSum > 0 ? Math.round((caso.crf * npc / eSum) * 1e4) / 1e4 : Infinity;
  const r = { lcoe, lole, ens, eSum, perdida, npc, capex, h2Entra, h2Sale, eStrFinal: eStr };
  if (completo) r.series = { wt: sWt, pv: sPv, sum: sSum, str: sStr, loss: sLoss, def: sDef, d: D };
  return r;
}

/* ---------- Restricción de confiabilidad ---------- */

// LOLE ≤ h (horas con déficit) y, opcionalmente, ENS ≤ h · demanda media (ec. 2.2.18 y 2.2.19).
// La violación es 0 si se cumple; si no, mide cuánto falta (sirve para las reglas de factibilidad).
export function violacion(res, h, caso, usarEnergia) {
  let v = Math.max(0, res.lole - h);
  if (usarEnergia) v += Math.max(0, res.ens - h * caso.mediaD) / Math.max(caso.mediaD, 1e-9);
  return v;
}

// Límites de búsqueda. Para el caso de la tesis se usan los del artículo; si no, escalan con la demanda.
export function limitesPorDefecto(caso, arquitectura, tesis) {
  const maxD = caso.maxD;
  const lim = tesis
    ? [[0, 20], [0, 50000], [0, Math.ceil(maxD / caso.con.pr)], [0, 500], [0, 50000], [0, Math.ceil(maxD / (caso.fc.pr * caso.con.eta))]]
    : [[0, Math.ceil(2.5 * maxD / caso.wtPr)], [0, Math.ceil(90 * maxD / caso.pvPr)],
       [0, Math.ceil(maxD / caso.con.pr)], [0, Math.ceil(8 * maxD / caso.ele.pr)], [0, Math.ceil(80 * maxD / caso.ht.cap)],
       [0, Math.ceil(maxD / (caso.fc.pr * caso.con.eta))]];
  // Los módulos que no forman parte de la arquitectura quedan fijos en 0.
  if (!arquitectura.wt) lim[0] = [0, 0];
  if (!arquitectura.pv) lim[1] = [0, 0];
  if (!arquitectura.hess) { lim[3] = [0, 0]; lim[4] = [0, 0]; lim[5] = [0, 0]; }
  if (!arquitectura.pv && !arquitectura.hess) lim[2] = [0, 0];
  return lim;
}
