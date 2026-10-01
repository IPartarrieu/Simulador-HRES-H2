// Motor del Simulador HRES-H2.
//
// Reproduce el algoritmo de la tesis de Ignacio Partarrieu (Magíster en Geofísica, UdeC, 2026):
// despacho horario de un sistema PV-WT-HESS (funciones.py) y su evaluación económica (NPC, CRF, LCOE).
// Suma baterías (bus DC) y generadores diésel (bus AC) con modelos de la literatura, y calcula la
// potencia de cualquier aerogenerador o panel del catálogo a partir de datos meteorológicos (ec. 2.2.1 a 2.2.6).
// Sin baterías ni diésel, los resultados son idénticos a los del código Python de la tesis (tests/validar.mjs).
//
// Se usa igual en el navegador (página y Web Workers) y en Node (pruebas).

/* ---------- Fuentes del catálogo ---------- */

export const FUENTES = {
  tesis: { texto: "Partarrieu (2026), tesis de Magíster en Geofísica, UdeC (Tablas 2.2.3 y 2.2.5)", url: "" },
  diab2019: { texto: "Diab et al. (2019), IEEE Access 7", url: "https://doi.org/10.1109/ACCESS.2019.2936656" },
  kharrich2021: { texto: "Kharrich et al. (2021), IEEE Access 9", url: "https://doi.org/10.1109/ACCESS.2021.3051573" },
  energies2022: { texto: "Energies 15(10):3579 (2022)", url: "https://doi.org/10.3390/en15103579" },
  processes2020: { texto: "Processes 8(11):1381 (2020)", url: "https://doi.org/10.3390/pr8111381" },
  energies2023: { texto: "Energies 16(9):3893 (2023)", url: "https://doi.org/10.3390/en16093893" },
  yue2021: { texto: "Yue et al. (2021), Renew. Sustain. Energy Rev. 146:111180", url: "https://doi.org/10.1016/j.rser.2021.111180" },
  ficha: { texto: "Ficha técnica del fabricante; costos referenciales", url: "" },
  ref: { texto: "Valores referenciales: revisar antes de usar", url: "" },
};

/* ---------- Catálogo de equipos ---------- */

// Cada equipo indica su fuente. Los costos que no vienen de un artículo son referenciales y editables.
export const CATALOGO = {
  wt: [
    { id: "gaia133", nombre: "Gaia-Wind 133 · 11 kW (tesis)", pr: 11, vcin: 3.5, vr: 9.5, vcout: 25, hub: 18,
      ci: 80000, rep: 66000, om: 1600, vu: 20, fuente: "tesis" },
    { id: "eolica2", nombre: "Eolica · 2 kW (Energies 2022)", pr: 2, vcin: 2, vr: 9, vcout: 20, hub: 20,
      ci: 4000, rep: 4000, om: 80, vu: 24, fuente: "energies2022" },
    { id: "bergey10", nombre: "Bergey Excel 10 · 10 kW", pr: 10, vcin: 3.4, vr: 11, vcout: 20, hub: 24,
      ci: 65000, rep: 50000, om: 1300, vu: 20, fuente: "ficha" },
    { id: "eocycle22", nombre: "Eocycle EOX S-16 · 22 kW", pr: 22, vcin: 2.75, vr: 11, vcout: 25, hub: 24,
      ci: 150000, rep: 120000, om: 3000, vu: 20, fuente: "ficha" },
    { id: "nps100", nombre: "Northern Power NPS 100C-24 · 95 kW", pr: 95, vcin: 3, vr: 12, vcout: 25, hub: 37,
      ci: 450000, rep: 380000, om: 9000, vu: 20, fuente: "ficha" },
  ],
  pv: [
    { id: "cs6u330", nombre: "Canadian Solar CS6U-330P · 330 W (tesis)", pr: 0.33, eff: 16.97, alfa: -0.41, noct: 45, fpv: 0.8,
      ci: 206.67, rep: 206.67, om: 0, vu: 25, fuente: "tesis" },
    { id: "spr327", nombre: "SunPower SPR-E20-327 · 327 W (Processes 2020)", pr: 0.327, eff: 20.4, alfa: -0.35, noct: 45, fpv: 0.8,
      ci: 1046.4, rep: 1046.4, om: 6.54, vu: 25, fuente: "processes2020" },
    { id: "jinko440", nombre: "JinkoSolar Tiger Neo · 440 W", pr: 0.44, eff: 22.5, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 275.6, rep: 275.6, om: 0, vu: 30, fuente: "ficha" },
    { id: "longi430", nombre: "LONGi Hi-MO 6 · 430 W", pr: 0.43, eff: 22.0, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 269.3, rep: 269.3, om: 0, vu: 30, fuente: "ficha" },
    { id: "trina405", nombre: "Trina Vertex S · 405 W", pr: 0.405, eff: 21.1, alfa: -0.34, noct: 43, fpv: 0.8,
      ci: 253.6, rep: 253.6, om: 0, vu: 30, fuente: "ficha" },
  ],
  con: [
    { id: "conv1", nombre: "Conversor genérico · 1 kW, 95 % (tesis)", pr: 1, eta: 0.95, ci: 300, rep: 300, om: 0, vu: 15, fuente: "tesis" },
    { id: "conv5", nombre: "Inversor bidireccional · 5 kW, 97 %", pr: 5, eta: 0.97, ci: 1750, rep: 1750, om: 0, vu: 15, fuente: "ref" },
  ],
  ele: [
    { id: "pem3", nombre: "PEM · 3 kW, 74 % (tesis, Zhang et al.)", pr: 3, eta: 0.74, ci: 4500, rep: 700, om: 0, vu: 5, fuente: "tesis" },
    { id: "ael5", nombre: "Alcalino (AEL) · 5 kW, 68 % (Yue et al. 2021)", pr: 5, eta: 0.68, ci: 5000, rep: 1750, om: 50, vu: 10, fuente: "yue2021" },
    { id: "pem5", nombre: "PEM actual · 5 kW, 60 % (Yue et al. 2021)", pr: 5, eta: 0.60, ci: 7000, rep: 2100, om: 70, vu: 10, fuente: "yue2021" },
  ],
  ht: [
    { id: "tank03", nombre: "Tanque de H₂ · 0,3 kWh (tesis, Zhang et al.)", cap: 0.3, ci: 600, rep: 0, om: 5, vu: 20, fuente: "tesis" },
    { id: "tank1", nombre: "Tanque de H₂ tipo IV · 1 kWh", cap: 1, ci: 1500, rep: 0, om: 10, vu: 20, fuente: "ref" },
  ],
  fc: [
    { id: "pemfc3", nombre: "Celda PEM · 3 kW, 50 % (tesis, Zhang et al.)", pr: 3, eta: 0.50, ci: 600, rep: 700, om: 0, vu: 5, fuente: "tesis" },
    { id: "pemfc5", nombre: "Celda estacionaria gran escala · 5 kW, 55 % (Yue et al. 2021)", pr: 5, eta: 0.55, ci: 7500, rep: 3000, om: 50, vu: 10, fuente: "yue2021" },
    { id: "sofc5", nombre: "Celda de óxido sólido (SOFC) · 5 kW, 60 %", pr: 5, eta: 0.60, ci: 15000, rep: 5000, om: 150, vu: 6, fuente: "ref" },
  ],
  // Baterías (bus DC). etaC · etaD = eficiencia de ida y vuelta; socMin = 1 − profundidad de descarga;
  // cRate: potencia máxima por kWh; ciclos: ciclos equivalentes completos hasta el reemplazo; autod: autodescarga por hora.
  bat: [
    { id: "lfp1", nombre: "Litio LFP · 1 kWh, 95 % ida y vuelta", cap: 1, etaC: 0.975, etaD: 0.975, socMin: 0.1, cRate: 0.5, autod: 0.00005,
      ciclos: 6000, ci: 400, rep: 300, om: 5, vu: 15, fuente: "energies2023" },
    { id: "nmc1", nombre: "Litio NMC · 1 kWh, 95 % ida y vuelta", cap: 1, etaC: 0.975, etaD: 0.975, socMin: 0.2, cRate: 1, autod: 0.0001,
      ciclos: 3500, ci: 350, rep: 280, om: 5, vu: 12, fuente: "energies2023" },
    { id: "plomo1", nombre: "Plomo-ácido · 1 kWh, 85 %, descarga 70 % (Energies 2022)", cap: 1, etaC: 0.922, etaD: 0.922, socMin: 0.3, cRate: 0.2, autod: 0.0001,
      ciclos: 1500, ci: 220, rep: 220, om: 3, vu: 5, fuente: "energies2022" },
  ],
  // Generadores diésel (bus AC). Consumo F = a · P + b · P_nominal (L/h); omKwh en USD por kWh generado;
  // vidaH: horas de operación hasta el reemplazo; cargaMin: fracción mínima de la potencia nominal.
  dg: [
    { id: "dg10", nombre: "Generador diésel · 10 kW", pr: 10, a: 0.246, b: 0.08145, cargaMin: 0.3, omKwh: 0.04, vidaH: 24000,
      ci: 10000, rep: 10000, vu: 20, fuente: "diab2019" },
    { id: "dg50", nombre: "Generador diésel · 50 kW", pr: 50, a: 0.246, b: 0.08145, cargaMin: 0.3, omKwh: 0.04, vidaH: 24000,
      ci: 50000, rep: 50000, vu: 20, fuente: "diab2019" },
    { id: "dg100", nombre: "Generador diésel · 100 kW", pr: 100, a: 0.246, b: 0.08145, cargaMin: 0.3, omKwh: 0.04, vidaH: 24000,
      ci: 100000, rep: 100000, vu: 20, fuente: "diab2019" },
  ],
};

export const MODULOS = ["wt", "pv", "con", "ele", "ht", "fc", "bat", "dg"];
export const NOMBRES = { wt: "Aerogeneradores", pv: "Paneles fotovoltaicos", con: "Conversores DC/AC", ele: "Electrolizadores",
  ht: "Tanques de H₂", fc: "Celdas de combustible", bat: "Baterías", dg: "Generadores diésel" };

export const ECONOMIA_TESIS = { dn: 0.08, ie: 0.03, anios: 20, reserva: 0.10, diesel: 1.0 };
export const CO2_POR_LITRO = 2.68;       // kg de CO₂ por litro de diésel quemado

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
// `vu` puede no ser entero (baterías y diésel, cuya vida depende del uso): el reemplazo se ubica en el año más cercano.
export function npcUnidad(dev, df, anios) {
  const vu = Math.max(1, dev.vu);
  let npc = dev.ci;
  for (let k = 1; k * vu <= anios + 1e-9; k++) npc += dev.rep * df[Math.min(anios, Math.max(1, Math.round(k * vu)))];
  for (let y = 1; y <= anios; y++) npc += (dev.om || 0) * df[y];
  const resto = anios - vu * Math.floor(anios / vu + 1e-9);
  npc -= dev.rep * (resto / vu) * df[anios];
  return npc;
}

/* ---------- Preparación del caso ---------- */

// Arma todo lo que necesita la simulación: series por unidad, capacidades y costos por unidad.
// `demanda`: kW horarios; `wtKw`, `pvKw`: potencia de UNA unidad en cada hora.
export function prepararCaso({ demanda, wtKw, pvKw, equipos, economia }) {
  const eq = { bat: CATALOGO.bat[0], dg: CATALOGO.dg[0], ...equipos };
  const eco = { ...ECONOMIA_TESIS, ...economia };
  const n = demanda.length;
  const D = new Float64Array(n), WT = new Float64Array(n), PV = new Float64Array(n);
  let sumaD = 0, maxD = 0;
  for (let t = 0; t < n; t++) {
    D[t] = demanda[t] * (1 + eco.reserva);
    WT[t] = wtKw ? Math.min(wtKw[t], eq.wt.pr) : 0;     // la tesis recorta a la potencia nominal
    PV[t] = pvKw ? Math.min(pvKw[t], eq.pv.pr) : 0;
    sumaD += D[t]; if (D[t] > maxD) maxD = D[t];
  }
  const i = tasaReal(eco.dn, eco.ie);
  const { coef, df } = crf(i, eco.anios);
  let sumaDF = 0;
  for (let y = 1; y <= eco.anios; y++) sumaDF += df[y];
  const npcU = ["wt", "pv", "con", "ele", "ht", "fc"].map((k) => npcUnidad(eq[k], df, eco.anios));
  return {
    n, D, WT, PV, mediaD: sumaD / n, maxD, sumaD,
    wtPr: eq.wt.pr, pvPr: eq.pv.pr,
    con: { pr: eq.con.pr, eta: eq.con.eta },
    ele: { pr: eq.ele.pr, eta: eq.ele.eta },
    ht: { cap: eq.ht.cap },
    fc: { pr: eq.fc.pr, eta: eq.fc.eta },
    bat: { ...eq.bat }, dg: { ...eq.dg },
    crf: coef, df, sumaDF, anios: eco.anios, precioDiesel: eco.diesel,
    npcU, ciU: MODULOS.map((k) => eq[k].ci),
  };
}

/* ---------- Simulación horaria (HRES de funciones.py + baterías y diésel) ---------- */

// round(x, 2) de Python: redondea el valor binario exacto y, en empates exactos, al par más cercano.
// Solo se usa el camino lento en las horas con déficit visible.
function redondear2(x) {
  if (Math.abs(x) < 0.004) return 0;
  const c = x * 100, f = c - Math.floor(c);
  if (Math.abs(f - 0.5) > 1e-6) return Math.round(c) / 100;        // lejos de un empate: el camino rápido da lo mismo
  const doble = x * 200;
  if (Number.isInteger(doble) && Math.abs(doble % 2) === 1) {      // empate exacto (…,xx5)
    const abajo = Math.floor(c);
    return (abajo % 2 === 0 ? abajo : abajo + 1) / 100;
  }
  return Number(x.toFixed(2));
}

// cfg = [n_wt, n_pv, n_con, n_ele, n_ht, n_fc, n_bat, n_dg] (los dos últimos son opcionales).
// Despacho: los excedentes cargan primero la batería y luego el electrolizador; los déficits se cubren primero
// con la batería, luego con el hidrógeno y, al final, con el diésel (seguimiento de carga).
export function simular(caso, cfg, completo = false) {
  const nWt = cfg[0] || 0, nPv = cfg[1] || 0, nCon = cfg[2] || 0, nEle = cfg[3] || 0, nHt = cfg[4] || 0, nFc = cfg[5] || 0;
  const nBat = cfg[6] || 0, nDg = cfg[7] || 0;
  const { n, D, WT: wt1, PV: pv1 } = caso;
  const etaCon = caso.con.eta, capCon = nCon * caso.con.pr;
  const etaEle = caso.ele.eta, capEle = nEle * caso.ele.pr;
  const capHt = nHt * caso.ht.cap;
  const etaFc = caso.fc.eta, capFc = nFc * caso.fc.pr;
  const B = caso.bat, capBat = nBat * B.cap, socMin = capBat * B.socMin, pBat = capBat * B.cRate;
  const G = caso.dg, prDg = G.pr;

  let eStr = capHt; const eStrMax = capHt, eStrMin = 0;   // los tanques parten llenos
  let soc = capBat;                                        // la batería parte llena
  let eSum = 0, perdida = 0, ens = 0, lole = 0, h2Entra = 0, h2Sale = 0, h2Min = capHt;
  let batEntra = 0, batSale = 0, dgE = 0, litros = 0, horasDg = 0;
  let sWt, sPv, sSum, sStr, sLoss, sDef, sSoc, sDg;
  if (completo) {
    sWt = new Float64Array(n); sPv = new Float64Array(n); sSum = new Float64Array(n); sStr = new Float64Array(n);
    sLoss = new Float64Array(n); sDef = new Float64Array(n); sSoc = new Float64Array(n); sDg = new Float64Array(n);
  }

  for (let t = 0; t < n; t++) {
    const WT = wt1[t] * nWt, PV = pv1[t] * nPv, d = D[t];
    let sum = 0, exc = 0, necStr = 0;
    let lossAcDc = 0, lossEle = 0, lossStr = 0, lossFc = 0, lossDg = 0;

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

    if (exc > 0 && capBat > 0) {                     // excedente: primero a la batería
      const carga = Math.min(exc, pBat, (capBat - soc) / B.etaC);
      if (carga > 0) { soc += carga * B.etaC; exc -= carga; batEntra += carga; }
    }
    if (exc > 0) {                                   // luego al electrolizador y a los tanques
      const A = exc * etaEle;
      const eEleHt = Math.min(A, capEle);
      lossEle = Math.max(A - capEle, 0);
      let E;
      if (eEleHt + eStr > eStrMax) { E = eStrMax - eStr; lossStr = eEleHt - E; }
      else { E = eEleHt; }
      eStr += E; h2Entra += E;
    }

    if (necStr > 0) {                                // déficit en el bus DC
      let batOut = 0, eFcSys = 0;
      if (capBat > 0) {                              // primero la batería
        batOut = Math.min(necStr, pBat, Math.max(0, soc - socMin) * B.etaD);
        if (batOut > 0) { soc -= batOut / B.etaD; necStr -= batOut; batSale += batOut; }
      }
      if (necStr > 0) {                              // luego los tanques y las celdas de combustible
        const X = necStr / etaFc;
        const eHtFc = Math.min(X, eStr - eStrMin, capHt);
        eStr -= eHtFc; h2Sale += eHtFc;
        const A = eHtFc * etaFc;
        eFcSys = Math.min(A, capFc);
        lossFc = Math.max(A - capFc, 0);
      }
      sum += (eFcSys + batOut + PV) * etaCon;
    }

    let dgOut = 0;
    if (nDg > 0 && d - sum > 1e-9) {                 // al final, el diésel (bus AC), con carga mínima por unidad
      const req = Math.min(d - sum, nDg * prDg);
      const k = Math.min(nDg, Math.ceil(req / prDg - 1e-9));
      const prod = Math.max(req, k * prDg * G.cargaMin);
      dgOut = req; lossDg = prod - req;
      litros += G.a * prod + G.b * prDg * k;
      horasDg += k; dgE += prod; sum += req;
    }
    if (capBat > 0 && B.autod > 0) soc -= soc * B.autod;   // autodescarga horaria

    const loss = lossAcDc + lossEle + lossStr + lossFc + lossDg;
    const def = redondear2(d - sum);                 // igual que round(D - E_sys_D, 2) en Python
    eSum += sum; perdida += loss; ens += def;
    if (def > 0.01) lole++;
    if (eStr < h2Min) h2Min = eStr;
    if (completo) { sWt[t] = WT; sPv[t] = PV; sSum[t] = sum; sStr[t] = eStr; sLoss[t] = loss; sDef[t] = def; sSoc[t] = soc; sDg[t] = dgOut; }
  }

  // Costos: módulos de la tesis con su NPC por unidad; batería y diésel dependen de cómo se usaron.
  let npc = 0, capex = 0;
  for (let k = 0; k < 6; k++) { npc += (cfg[k] || 0) * caso.npcU[k]; capex += (cfg[k] || 0) * caso.ciU[k]; }
  let vidaBat = null, ciclosBat = 0, vidaDg = null, npcBat = 0, npcDg = 0, costoDieselAnual = 0;
  if (nBat > 0) {
    ciclosBat = batSale / Math.max(1e-9, capBat * (1 - B.socMin));          // ciclos equivalentes completos al año
    vidaBat = Math.min(B.vu, ciclosBat > 0 ? B.ciclos / ciclosBat : B.vu);
    npcBat = nBat * npcUnidad({ ...B, vu: vidaBat }, caso.df, caso.anios);
    npc += npcBat; capex += nBat * B.ci;
  }
  if (nDg > 0) {
    const horasPorUnidad = horasDg / nDg;
    vidaDg = Math.min(G.vu, horasPorUnidad > 0 ? G.vidaH / horasPorUnidad : G.vu);
    costoDieselAnual = litros * caso.precioDiesel + G.omKwh * dgE;        // combustible y mantención dependen del uso
    npcDg = nDg * npcUnidad({ ci: G.ci, rep: G.rep, om: 0, vu: vidaDg }, caso.df, caso.anios) + costoDieselAnual * caso.sumaDF;
    npc += npcDg; capex += nDg * G.ci;
  }
  const lcoe = eSum > 0 ? Math.round((caso.crf * npc / eSum) * 1e4) / 1e4 : Infinity;
  const lpsp = Math.max(0, ens) / caso.sumaD;
  const r = { lcoe, lole, ens, lpsp, eSum, perdida, npc, capex, h2Entra, h2Sale, h2Min, eStrFinal: eStr,
    batEntra, batSale, ciclosBat, vidaBat, npcBat, dgE, litros, horasDg, vidaDg, npcDg, costoDieselAnual,
    co2: litros * CO2_POR_LITRO, fraccionRenovable: eSum > 0 ? 1 - dgE / eSum : 0 };
  if (completo) r.series = { wt: sWt, pv: sPv, sum: sSum, str: sStr, loss: sLoss, def: sDef, d: D, soc: sSoc, dg: sDg };
  return r;
}

/* ---------- Criterios de optimización ---------- */

// Confiabilidad: LOLE ≤ h (horas con déficit) o LPSP ≤ límite, y opcionalmente ENS ≤ h · demanda media
// (ec. 2.2.18 y 2.2.19). Devuelve 0 si se cumple; si no, cuánto falta (para las reglas de factibilidad).
export function violacion(res, crit, caso) {
  if (crit.tipo === "lpsp") return Math.max(0, res.lpsp - crit.lpspMax) * 100;
  let v = Math.max(0, res.lole - crit.h);
  if (crit.usarEnergia) v += Math.max(0, res.ens - crit.h * caso.mediaD) / Math.max(caso.mediaD, 1e-9);
  return v;
}

// Penalizaciones en USD por año: excedentes perdidos (USD/kWh) e hidrógeno que nunca se usó en el año (USD/kWh).
export function penalizacionAnual(res, pen) {
  return ((pen && pen.excedentes) || 0) * res.perdida + ((pen && pen.h2) || 0) * res.h2Min;
}

// Valor del objetivo único que se minimiza. Sin penalizaciones, para «lcoe» es el LCOE de la tesis.
export function objetivo(res, crit, caso) {
  const pen = penalizacionAnual(res, crit.pen);
  if (crit.objetivo === "npc") return res.npc + pen * caso.sumaDF;
  if (crit.objetivo === "capex") return res.capex + pen * caso.sumaDF;
  if (!pen) return res.lcoe;
  return res.eSum > 0 ? (caso.crf * res.npc + pen) / res.eSum : Infinity;
}

// Objetivos disponibles para el frente de Pareto.
export const OBJETIVOS_MO = {
  lcoe: { nombre: "LCOE", unidad: "USD/kWh", dec: 4, valor: (r) => (Number.isFinite(r.lcoe) ? r.lcoe : 1e6) },
  lpsp: { nombre: "LPSP", unidad: "%", dec: 3, valor: (r) => r.lpsp * 100 },
  npc: { nombre: "Costo presente neto", unidad: "USD", dec: 0, valor: (r) => r.npc },
  capex: { nombre: "Inversión inicial", unidad: "USD", dec: 0, valor: (r) => r.capex },
  excedentes: { nombre: "Excedentes perdidos", unidad: "kWh/año", dec: 0, valor: (r) => r.perdida },
  h2: { nombre: "H₂ sin usar", unidad: "kWh", dec: 0, valor: (r) => r.h2Min },
  co2: { nombre: "Emisiones de CO₂", unidad: "t/año", dec: 1, valor: (r) => r.co2 / 1000 },
};

// Resumen de una simulación para los optimizadores. `crit`: { tipo: "lole"|"lpsp", h, usarEnergia, lpspMax,
// objetivo: "lcoe"|"npc"|"capex", pen: { excedentes, h2 }, mo: [claves de OBJETIVOS_MO] }.
export function evaluacion(caso, cfg, crit) {
  const r = simular(caso, cfg);
  const e = { cfg: cfg.slice(), lcoe: r.lcoe, lole: r.lole, ens: r.ens, lpsp: r.lpsp, npc: r.npc, capex: r.capex,
    perdida: r.perdida, h2Min: r.h2Min, co2: r.co2, viol: violacion(r, crit, caso), obj: objetivo(r, crit, caso) };
  if (crit.mo && crit.mo.length) e.objs = crit.mo.map((k) => OBJETIVOS_MO[k].valor(r));
  return e;
}

// Límites de búsqueda. Para el caso de la tesis se usan los del artículo; si no, escalan con la demanda.
export function limitesPorDefecto(caso, arquitectura, tesis) {
  const maxD = caso.maxD;
  const lim = tesis
    ? [[0, 20], [0, 50000], [0, Math.ceil(maxD / caso.con.pr)], [0, 500], [0, 50000], [0, Math.ceil(maxD / (caso.fc.pr * caso.con.eta))]]
    : [[0, Math.ceil(2.5 * maxD / caso.wtPr)], [0, Math.ceil(90 * maxD / caso.pvPr)],
       [0, Math.ceil(maxD / caso.con.pr)], [0, Math.ceil(8 * maxD / caso.ele.pr)], [0, Math.ceil(80 * maxD / caso.ht.cap)],
       [0, Math.ceil(maxD / (caso.fc.pr * caso.con.eta))]];
  lim.push([0, Math.ceil(24 * maxD / ((caso.bat && caso.bat.cap) || 1))]);   // baterías: hasta 24 h de la demanda máxima
  lim.push([0, Math.ceil(1.2 * maxD / ((caso.dg && caso.dg.pr) || 10))]);   // diésel: hasta 1,2 veces la demanda máxima
  // Los módulos que no forman parte de la arquitectura quedan fijos en 0.
  if (!arquitectura.wt) lim[0] = [0, 0];
  if (!arquitectura.pv) lim[1] = [0, 0];
  if (!arquitectura.hess) { lim[3] = [0, 0]; lim[4] = [0, 0]; lim[5] = [0, 0]; }
  if (!arquitectura.pv && !arquitectura.hess && !arquitectura.bat) lim[2] = [0, 0];
  if (!arquitectura.bat) lim[6] = [0, 0];
  if (!arquitectura.dg) lim[7] = [0, 0];
  return lim;
}
