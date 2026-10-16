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
  tesis: { texto: "Caso de ejemplo del simulador (ver «Acerca del simulador»)", url: "" },
  diab2019: { texto: "Diab et al. (2019), IEEE Access 7", url: "https://doi.org/10.1109/ACCESS.2019.2936656" },
  kharrich2021: { texto: "Kharrich et al. (2021), IEEE Access 9", url: "https://doi.org/10.1109/ACCESS.2021.3051573" },
  energies2022: { texto: "Energies 15(10):3579 (2022)", url: "https://doi.org/10.3390/en15103579" },
  processes2020: { texto: "Processes 8(11):1381 (2020)", url: "https://doi.org/10.3390/pr8111381" },
  energies2023: { texto: "Energies 16(9):3893 (2023)", url: "https://doi.org/10.3390/en16093893" },
  yue2021: { texto: "Yue et al. (2021), Renew. Sustain. Energy Rev. 146:111180", url: "https://doi.org/10.1016/j.rser.2021.111180" },
  ficha: { texto: "Ficha técnica del fabricante; costos referenciales", url: "" },
  kalantari2020: { texto: "Kalantari et al. (2020), Energies 13(23):6365, Tabla 2", url: "https://doi.org/10.3390/en13236365" },
  amoussou2023: { texto: "Amoussou et al. (2023), Sustainability 15(15):11510, Tabla A1", url: "https://doi.org/10.3390/su151511510" },
  dehouche2023: { texto: "Dehouche y Garner (2023), Energies 16(21):7363, Tablas 2 y 3 (EUR a USD con 1 EUR = 1,08 USD)", url: "https://doi.org/10.3390/en16217363" },
  swcc2022: { texto: "ICC-SWCC, informe SWCC-10-12 (2022): curva de potencia certificada del Bergey Excel 10", url: "https://smallwindcertification.org/wp-content/uploads/2022/04/SWCC-10-12-Summary-Report-20220406.pdf" },
  nps2020: { texto: "Northern Power, ficha NPS 100C-24 (ed. 2020): curva de potencia", url: "https://www.northernpower.com/wpd2/wp-content/uploads/2025/11/brochure-NPS-100C-24_ed2020_light_ENG.pdf" },
  ref: { texto: "Valores referenciales: revisar antes de usar", url: "" },
};

/* ---------- Catálogo de equipos ---------- */

// Cada equipo indica su fuente. Los costos que no vienen de un artículo son referenciales y editables.
export const CATALOGO = {
  wt: [
    { id: "gaia133", nombre: "Gaia-Wind 133 · 11 kW (caso de ejemplo)", pr: 11, vcin: 3.5, vr: 9.5, vcout: 25, hub: 18, rotor: 13,
      ci: 80000, rep: 66000, om: 1600, vu: 20, fuente: "tesis" },
    { id: "eolica2", nombre: "Eolica · 2 kW (Energies 2022)", pr: 2, vcin: 2, vr: 9, vcout: 20, hub: 20, rotor: 3.2,
      ci: 4000, rep: 4000, om: 80, vu: 24, fuente: "energies2022" },
    { id: "bergey10", nombre: "Bergey Excel 10 · 10 kW", pr: 10, vcin: 3.4, vr: 11, vcout: 20, hub: 24, rotor: 7,
      ci: 65000, rep: 50000, om: 1300, vu: 20, fuente: "ficha",
      lw: 89.5,   // potencia acústica, dB(A): nivel certificado de 42,9 dB(A) a 60 m (AWEA 9.1, informe SWCC-10-12)
      // Curva certificada a 1,225 kg/m³ (W → kW; la potencia negativa de consumo propio bajo 2 m/s se toma como 0).
      curvaReal: { fuente: "swcc2022", v: [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5],
        p: [0, 0.039, 0.102, 0.229, 0.399, 0.596, 0.848, 1.151, 1.51, 1.938, 2.403, 2.949, 3.602, 4.306, 5.071, 5.96, 6.856, 7.849, 8.863, 9.928, 10.885, 11.619, 12.019, 12.276, 12.395, 12.449, 12.495, 12.508, 12.546, 12.555, 12.503, 12.528, 12.442, 12.396, 12.208, 11.878, 11.989, 11.495] } },
    { id: "eocycle22", nombre: "Eocycle EOX S-16 · 22 kW", pr: 22, vcin: 2.75, vr: 11, vcout: 25, hub: 24, rotor: 16,
      ci: 150000, rep: 120000, om: 3000, vu: 20, fuente: "ficha" },
    { id: "nps100", nombre: "Northern Power NPS 100C-24 · 95 kW", pr: 95, vcin: 3, vr: 12, vcout: 25, hub: 37, rotor: 24.4,
      ci: 450000, rep: 380000, om: 9000, vu: 20, fuente: "ficha",
      lw: 95,     // potencia acústica, dB(A): 50 dB(A) a 50 m de la góndola (ficha 2020)
      // Curva del fabricante a 1,225 kg/m³, de 1 a 25 m/s (la potencia negativa bajo 3 m/s se toma como 0).
      curvaReal: { fuente: "nps2020", v: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], p: [0, 0, 1.2, 7.2, 14.5, 24.7, 37.9, 58.7, 74.8, 85.1, 90.2, 94.7, 95.3, 95.1, 94.2, 92.9, 91.2, 88.9, 87.1, 84.1, 81.3, 78.6, 76.1, 74.3, 71.7] } },
    // Gran escala (3 MW); el rotor de 150 m sale del nombre del modelo (GW 150).
    { id: "gw150", nombre: "Goldwind GW 150 · 3 MW (Amoussou et al. 2023)", pr: 3000, vcin: 2.5, vr: 9, vcout: 18, hub: 95, rotor: 150,
      ci: 4372500, rep: 4372500, om: 131175, vu: 20, fuente: "amoussou2023" },
  ],
  pv: [
    { id: "cs6u330", nombre: "Canadian Solar CS6U-330P · 330 W (caso de ejemplo)", pr: 0.33, eff: 16.97, alfa: -0.41, noct: 45, fpv: 0.8,
      ci: 206.67, rep: 206.67, om: 0, vu: 25, fuente: "tesis" },
    { id: "spr327", nombre: "SunPower SPR-E20-327 · 327 W (Processes 2020)", pr: 0.327, eff: 20.4, alfa: -0.35, noct: 45, fpv: 0.8,
      ci: 1046.4, rep: 1046.4, om: 6.54, vu: 25, fuente: "processes2020" },
    { id: "jinko440", nombre: "JinkoSolar Tiger Neo · 440 W", pr: 0.44, eff: 22.5, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 275.6, rep: 275.6, om: 0, vu: 30, fuente: "ficha" },
    { id: "longi430", nombre: "LONGi Hi-MO 6 · 430 W", pr: 0.43, eff: 22.0, alfa: -0.29, noct: 45, fpv: 0.8,
      ci: 269.3, rep: 269.3, om: 0, vu: 30, fuente: "ficha" },
    { id: "trina405", nombre: "Trina Vertex S · 405 W", pr: 0.405, eff: 21.1, alfa: -0.34, noct: 43, fpv: 0.8,
      ci: 253.6, rep: 253.6, om: 0, vu: 30, fuente: "ficha" },
    { id: "longi450", nombre: "LONGi LR4-72HPH-450M · 450 W (Amoussou et al. 2023)", pr: 0.45, eff: 20.7, alfa: -0.35, noct: 45, fpv: 0.95,
      ci: 424.2, rep: 424.2, om: 4.24, vu: 25, fuente: "amoussou2023" },
    { id: "pv400d", nombre: "Panel 400 W, 20 % (Dehouche y Garner 2023)", pr: 0.4, eff: 20, alfa: -0.3, noct: 42, fpv: 0.8,
      ci: 1080, rep: 1080, om: 12.96, vu: 20, fuente: "dehouche2023" },
  ],
  con: [
    { id: "conv1", nombre: "Conversor genérico · 1 kW, 95 % (caso de ejemplo)", pr: 1, eta: 0.95, ci: 300, rep: 300, om: 0, vu: 15, fuente: "tesis" },
    { id: "conv5", nombre: "Inversor bidireccional · 5 kW, 97 %", pr: 5, eta: 0.97, ci: 1750, rep: 1750, om: 0, vu: 15, fuente: "ref" },
    { id: "conv5k", nombre: "Conversor · 5 kW, 95 % (Kalantari et al. 2020)", pr: 5, eta: 0.95, ci: 1500, rep: 1500, om: 0, vu: 15, fuente: "kalantari2020" },
  ],
  ele: [
    { id: "pem3", nombre: "PEM · 3 kW, 74 % (Zhang et al.)", pr: 3, eta: 0.74, ci: 4500, rep: 700, om: 0, vu: 5, fuente: "tesis" },
    { id: "ael5", nombre: "Alcalino (AEL) · 5 kW, 68 % (Yue et al. 2021)", pr: 5, eta: 0.68, ci: 5000, rep: 1750, om: 50, vu: 10, fuente: "yue2021" },
    { id: "pem5", nombre: "PEM actual · 5 kW, 60 % (Yue et al. 2021)", pr: 5, eta: 0.60, ci: 7000, rep: 2100, om: 70, vu: 10, fuente: "yue2021" },
    { id: "pem5k", nombre: "PEM · 5 kW, 75 % (Kalantari et al. 2020)", pr: 5, eta: 0.75, ci: 5500, rep: 4125, om: 0, vu: 10, fuente: "kalantari2020" },
    { id: "ele5a", nombre: "Electrolizador · 5 kW, 77 % (Amoussou et al. 2023)", pr: 5, eta: 0.77, ci: 5000, rep: 5000, om: 72.4, vu: 20, fuente: "amoussou2023" },
    { id: "aem5", nombre: "AEM · 5 kW, 68 % (Dehouche y Garner 2023)", pr: 5, eta: 0.68, ci: 8100, rep: 8100, om: 75.6, vu: 20, fuente: "dehouche2023" },
  ],
  ht: [
    { id: "tank03", nombre: "Tanque de H₂ · 0,3 kWh (Zhang et al.)", cap: 0.3, ci: 600, rep: 0, om: 5, vu: 20, fuente: "tesis" },
    { id: "tank1", nombre: "Tanque de H₂ tipo IV · 1 kWh", cap: 1, ci: 1500, rep: 0, om: 10, vu: 20, fuente: "ref" },
    { id: "tank1kg", nombre: "Tanque de H₂ · 1 kg = 33,3 kWh (Amoussou et al. 2023)", cap: 33.33, ci: 414.04, rep: 414.04, om: 8.28, vu: 25, fuente: "amoussou2023" },
    { id: "vaso1", nombre: "Recipiente de H₂ · 1 kWh (Dehouche y Garner 2023)", cap: 1, ci: 32.4, rep: 32.4, om: 0, vu: 20, fuente: "dehouche2023" },
  ],
  fc: [
    { id: "pemfc3", nombre: "Celda PEM · 3 kW, 50 % (Zhang et al.)", pr: 3, eta: 0.50, ci: 600, rep: 700, om: 0, vu: 5, fuente: "tesis" },
    { id: "pemfc5", nombre: "Celda estacionaria gran escala · 5 kW, 55 % (Yue et al. 2021)", pr: 5, eta: 0.55, ci: 7500, rep: 3000, om: 50, vu: 10, fuente: "yue2021" },
    { id: "sofc5", nombre: "Celda de óxido sólido (SOFC) · 5 kW, 60 %", pr: 5, eta: 0.60, ci: 15000, rep: 5000, om: 150, vu: 6, fuente: "ref" },
    { id: "fc5k", nombre: "Celda · 5 kW, 50 % (Kalantari et al. 2020)", pr: 5, eta: 0.50, ci: 6720, rep: 5350, om: 0, vu: 5, fuente: "kalantari2020" },
    { id: "fc5a", nombre: "Celda · 5 kW, 60 % (Amoussou et al. 2023)", pr: 5, eta: 0.60, ci: 3000, rep: 3000, om: 67.15, vu: 10, fuente: "amoussou2023" },
    { id: "pemfc5d", nombre: "Celda PEM · 5 kW, 46 % (Dehouche y Garner 2023)", pr: 5, eta: 0.46, ci: 6480, rep: 6480, om: 70.2, vu: 20, fuente: "dehouche2023" },
  ],
  // Baterías (bus DC). etaC · etaD = eficiencia de ida y vuelta; socMin = 1 − profundidad de descarga;
  // cRate: potencia máxima por kWh; ciclos: ciclos equivalentes completos hasta el reemplazo; autod: autodescarga por hora.
  bat: [
    { id: "lfp1", nombre: "Litio LFP · 1 kWh, 95 % ida y vuelta", cap: 1, etaC: 0.975, etaD: 0.975, socMin: 0.1, cRate: 0.5, autod: 0.00005,
      ciclos: 6000, ci: 400, rep: 300, om: 5, vu: 15, fuente: "energies2023" },
    // Profundidad de descarga, tasa C y autodescarga no vienen en el artículo: se usan las del LFP anterior.
    { id: "lfp1d", nombre: "Litio LFP · 1 kWh, 95 %, 8000 ciclos (Dehouche y Garner 2023)", cap: 1, etaC: 0.9747, etaD: 0.9747, socMin: 0.1, cRate: 0.5, autod: 0.00005,
      ciclos: 8000, ci: 354.24, rep: 354.24, om: 5.4, vu: 10, fuente: "dehouche2023" },
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
// curva entre la velocidad de arranque y la nominal, y corrección por densidad del aire. La curva es lineal, como en
// la tesis; cúbica (wt.curva = "cubica"): P = Pr · (v³ − v_arr³) / (v_nom³ − v_arr³); o la tabla del fabricante
// (wt.curva = "fabricante" y wt.curvaReal), interpolada. Sin tabla, "fabricante" usa la lineal. Ninguna forma genérica
// sirve para todos: a 7 m/s el Bergey Excel 10 certificado da 2,4 kW (lineal 4,7; cúbica 2,35) y el NPS 100C da
// 37,9 kW (lineal 42,2; cúbica 17,6).
// Potencia máxima de una unidad: la nominal, o el máximo de la tabla del fabricante (puede superar la nominal).
export const topeWT = (wt) => (wt.curva === "fabricante" && wt.curvaReal ? Math.max(...wt.curvaReal.p) : wt.pr);
function interpolar({ v, p }, x) {
  if (x <= v[0]) return x === v[0] ? p[0] : 0;
  for (let i = 1; i < v.length; i++) if (x <= v[i]) return p[i - 1] + ((p[i] - p[i - 1]) * (x - v[i - 1])) / (v[i] - v[i - 1]);
  return p[p.length - 1];
}

// Viento a la altura del buje en la hora t (ley potencial con el exponente de esa hora).
export function vientoBuje(hub, v10, v100, t) {
  let a = 1 / 7;
  if (v10[t] > 0.5 && v100[t] > 0.5) a = Math.min(0.6, Math.max(0, Math.log(v100[t] / v10[t]) / Math.log(10)));
  return v10[t] > 0 ? v10[t] * Math.pow(hub / 10, a) : 0;
}

// f: fracción del viento que llega (1 − déficit por estela).
export function potenciaWT(wt, v10, v100, tempC, presionHpa, f = 1) {
  const out = new Float64Array(v10.length), tabla = wt.curva === "fabricante" && wt.curvaReal, tope = topeWT(wt);
  for (let t = 0; t < v10.length; t++) {
    const v = f * vientoBuje(wt.hub, v10, v100, t);
    let p = 0;
    if (tabla) p = v < wt.vcout ? interpolar(tabla, v) : 0;
    else if (v > wt.vcin && v < wt.vr) p = wt.curva === "cubica" ? (wt.pr * (v ** 3 - wt.vcin ** 3)) / (wt.vr ** 3 - wt.vcin ** 3) : (wt.pr * (v - wt.vcin)) / (wt.vr - wt.vcin);
    else if (v >= wt.vr && v < wt.vcout) p = wt.pr;
    const rho = (presionHpa[t] * 100) / (287.05 * (tempC[t] + 273.15));
    out[t] = Math.min(p * rho / 1.225, tope);
  }
  return out;
}

// Aerogenerador detenido por frío extremo (bajo su temperatura mínima de operación) o con hielo en las palas. El hielo
// se forma en horas con T ≤ 0 °C y humedad relativa ≥ 95 % (criterio de engelamiento meteorológico de la IEA Wind
// Task 19) y queda en las palas hasta que la temperatura sube de +1 °C. Sin humedad en la serie, solo el frío.
// ponytail: detención total con hielo; los equipos con calefacción de palas pierden menos.
export function factorFrio(clima, { tMin = -20, hielo = true } = {}) {
  const T = clima.temp_c, H = clima.hr_pct, f = new Float64Array(T.length).fill(1);
  let conHielo = false, horasHielo = 0, horasFrio = 0;
  for (let t = 0; t < T.length; t++) {
    if (hielo && H) { if (T[t] <= 0 && H[t] >= 95) conHielo = true; else if (T[t] > 1) conHielo = false; }
    if (T[t] < tMin) { f[t] = 0; horasFrio++; } else if (hielo && conHielo) { f[t] = 0; horasHielo++; }
  }
  return { f, horasHielo, horasFrio, conHumedad: !!H };
}

// Radiación sobre el plano de los paneles (W/m²) desde la global, la directa normal y la difusa (ERA5), con el modelo de
// cielo de Hay-Davies (difusa circunsolar + isotrópica) y reflejo del suelo (albedo 0,2). Cada valor horario es el
// promedio de la hora anterior: el sol se calcula a la media hora, en hora UTC = local + utcLocal (Open-Meteo usa un
// desfase fijo; en Chile, 3 h). Montajes:
// - "fija": inclinación beta hacia el ecuador;
// - "seguidor": eje horizontal norte-sur que gira de este a oeste (hasta ±55°) siguiendo al sol, con retroceso
//   (backtracking) para no sombrear la fila vecina según su ocupación gcr (Marion y Dobos, 2013; como pvlib).
export function radiacionPanel(clima, { montaje = "fija", beta = 30, gcr = 0.35, albedo = 0.2 } = {}) {
  const { ghi_wm2: G, dni_wm2: B, dhi_wm2: Dh } = clima, n = G.length, out = new Float64Array(n);
  const lat = clima.lat, lon = clima.lon, utc = clima.utcLocal ?? 3, f = (lat * Math.PI) / 180, sur = lat < 0;
  const b = (beta * Math.PI) / 180, nFija = [0, sur ? Math.sin(b) : -Math.sin(b), Math.cos(b)], rMax = (55 * Math.PI) / 180;
  for (let t = 0; t < n; t++) {
    const u = t + utc - 0.5, dia = (Math.floor(u / 24) % 365) + 1, h = ((u % 24) + 24) % 24;
    const Bq = (2 * Math.PI * (dia - 81)) / 364, eot = 9.87 * Math.sin(2 * Bq) - 7.53 * Math.cos(Bq) - 1.5 * Math.sin(Bq);
    const w = ((h + lon / 15 + eot / 60 - 12) * 15 * Math.PI) / 180, dec = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dia)) / 365);
    const cz = Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(w);
    // Vector al sol (este, norte, arriba)
    const sE = -Math.cos(dec) * Math.sin(w), sN = Math.cos(f) * Math.sin(dec) - Math.sin(f) * Math.cos(dec) * Math.cos(w), sU = cz;
    let nv = nFija;
    if (montaje === "seguidor") {
      let R = Math.atan2(sE, Math.max(sU, 1e-6));
      const tmp = Math.min(1, Math.abs(Math.cos(R)) / gcr);
      R -= Math.sign(R) * Math.acos(tmp);                       // retroceso
      R = Math.max(-rMax, Math.min(rMax, R));
      nv = [Math.sin(R), 0, Math.cos(R)];
    }
    const cosi = nv[0] * sE + nv[1] * sN + nv[2] * sU, cb = nv[2];
    const ai = cz > 0 ? Math.min(1, B[t] / (1367 * (1 + 0.033 * Math.cos((2 * Math.PI * dia) / 365)))) : 0;
    const rb = cz > 0.087 ? Math.max(0, cosi) / cz : 0;
    out[t] = Math.max(0, (cz > 0 ? B[t] * Math.max(0, cosi) : 0) + Dh[t] * (ai * rb + (1 - ai) * (1 + cb) / 2) + G[t] * albedo * (1 - cb) / 2);
  }
  return out;
}
// Inclinación fija (hacia el ecuador, 0-60°) que da más radiación anual sobre el panel.
export function inclinacionOptima(clima) {
  let mejor = 0, eMax = -1;
  for (let beta = 0; beta <= 60; beta += 1) {
    const e = radiacionPanel(clima, { montaje: "fija", beta }).reduce((a, x) => a + x, 0);
    if (e > eMax) { eMax = e; mejor = beta; }
  }
  return mejor;
}

/* ---------- Economía (params.py y funciones.py) ---------- */

export function tasaReal(dn, ie) { return (dn - ie) / (1 + ie); }

export function crf(i, anios) {
  const coef = (i * Math.pow(1 + i, anios)) / (Math.pow(1 + i, anios) - 1);
  const df = [];
  for (let j = 0; j <= anios; j++) df.push(1 / Math.pow(1 + i, j));
  return { coef, df };
}

// Flujo de caja nominal (en dólares de hoy) de una unidad, año a año, como en HOMER Pro
// (net_present_cost.html, salvage_value.html):
// - capital: inversión en el año 0;
// - reemplazo: costo de reemplazo cada `vu` años mientras t ≤ N (el año se redondea si `vu` no es entero);
// - om: operación y mantenimiento al final de cada año (y `anual`, p. ej. combustible, en la misma fecha);
// - residual (ingreso, año N): S = C_rep · R_rem / R_comp, con R_rep = R_comp · INT(N / R_comp) y
//   R_rem = R_comp − (N − R_rep): depreciación lineal de la última unidad instalada.
export function flujoCaja(dev, anios, anual = 0) {
  const vu = Math.max(1, dev.vu), N = anios;
  const f = { capital: new Float64Array(N + 1), reemplazo: new Float64Array(N + 1), om: new Float64Array(N + 1), combustible: new Float64Array(N + 1), residual: new Float64Array(N + 1) };
  f.capital[0] = dev.ci;
  for (let k = 1; k * vu <= N + 1e-9; k++) f.reemplazo[Math.min(N, Math.max(1, Math.round(k * vu)))] += dev.rep;
  for (let y = 1; y <= N; y++) { f.om[y] = dev.om || 0; f.combustible[y] = anual; }
  const rRep = vu * Math.floor(N / vu + 1e-9), rRem = vu - (N - rRep);
  f.residual[N] = dev.rep * (rRem / vu);
  return f;
}

// Costo presente neto de una unidad: valor presente de los costos menos el del valor residual.
export function npcUnidad(dev, df, anios, anual = 0) {
  const f = flujoCaja(dev, anios, anual);
  let npc = f.capital[0];
  for (let y = 1; y <= anios; y++) npc += (f.reemplazo[y] + f.om[y] + f.combustible[y] - f.residual[y]) * df[y];
  return npc;
}

/* ---------- Preparación del caso ---------- */

// Arma todo lo que necesita la simulación: series por unidad, capacidades y costos por unidad.
// `demanda`: kW horarios; `wtKw`, `pvKw`: potencia de UNA unidad en cada hora.
// `estela` (opcional, de zona.estelaParque): eficiencia del parque por sector y sector de cada hora.
// `campoFV` (opcional, de zona.interaccionPV): factor de producción FV del campo solar (relieve, sombra entre filas y
// de los aerogeneradores) con n aerogeneradores y k celdas, con `m2Panel` (terreno por panel) para pasar a celdas.
// `perdidas` (opcional): factores que multiplican la producción ya recortada a la potencia nominal (disponibilidad
// de cada tecnología y degradación media de los paneles en la vida del proyecto). Sin ellos, igual que la tesis.
// `h2` (opcional): operación real del hidrógeno (fracciones): electrolizador {cargaMin, aux}, compresión `comp`
// (kWh eléctricos por kWh de H₂ guardado) y celda {cargaMin, aux}. Con todo en 0 se usa el despacho de la tesis.
// `candidatos` (opcional): otros equipos que el optimizador puede elegir en cada módulo. La configuración pasa a tener
// 16 valores: las 8 cantidades y el índice del equipo de cada módulo (0 = el elegido en la página). Por módulo:
// wt: [{ eq, wtKw, estela, campoFV, terreno: { aWt, nWtMax } }], pv: [{ eq, pvKw, terreno: { aPv }, m2Panel }],
// con, ele, ht, fc, bat, dg: [{ eq }]. La posición 0 de cada lista es la del caso base (puede ir vacía).
export function prepararCaso({ demanda, wtKw, pvKw, equipos, economia, terreno = null, estela = null, campoFV = null, perdidas = null, h2 = null, candidatos = null }) {
  const eq = { bat: CATALOGO.bat[0], dg: CATALOGO.dg[0], ...equipos };
  const eco = { ...ECONOMIA_TESIS, ...economia };
  // Varios años de clima: las series de potencia traen N × 8760 horas y la demanda (un año) se repite.
  const nD = demanda.length, n = Math.max(nD, wtKw?.length || 0, pvKw?.length || 0), anosClima = Math.round(n / nD);
  const D = new Float64Array(n), WT = new Float64Array(n), PV = new Float64Array(n);
  let sumaD = 0, maxD = 0;
  const fWt = perdidas?.wt ?? 1, fPv = perdidas?.pv ?? 1;
  for (let t = 0; t < n; t++) {
    D[t] = demanda[t % nD] * (1 + eco.reserva);
    WT[t] = wtKw ? Math.min(wtKw[t], topeWT(eq.wt)) * fWt : 0;     // la tesis recorta a la potencia nominal
    PV[t] = pvKw ? Math.min(pvKw[t], eq.pv.pr) * fPv : 0;
    sumaD += D[t]; if (D[t] > maxD) maxD = D[t];
  }
  const i = tasaReal(eco.dn, eco.ie);
  const { coef, df } = crf(i, eco.anios);
  let sumaDF = 0;
  for (let y = 1; y <= eco.anios; y++) sumaDF += df[y];
  const npcU = ["wt", "pv", "con", "ele", "ht", "fc"].map((k) => npcUnidad(eq[k], df, eco.anios));
  return {
    n, D, WT, PV, mediaD: sumaD / n, maxD, sumaD: sumaD / anosClima, anosClima, horasAnio: nD,
    wtPr: eq.wt.pr, pvPr: eq.pv.pr,
    con: { pr: eq.con.pr, eta: eq.con.eta },
    ele: { pr: eq.ele.pr, eta: eq.ele.eta },
    ht: { cap: eq.ht.cap },
    fc: { pr: eq.fc.pr, eta: eq.fc.eta },
    bat: { ...eq.bat }, dg: { ...eq.dg },
    crf: coef, df, sumaDF, anios: eco.anios, precioDiesel: eco.diesel,
    npcU, ciU: MODULOS.map((k) => eq[k].ci), terreno,
    estela: estela && { eta: Float32Array.from(estela.eta), sec: estela.sec && Uint8Array.from(estela.sec), S: estela.S, nMax: estela.nMax },
    campoFV: campoFV && { ...campoFV, tabla: Float32Array.from(campoFV.tabla) },
    h2: h2 && (h2.ele.cargaMin || h2.ele.aux || h2.comp || h2.fc.cargaMin || h2.fc.aux) ? h2 : null,
    mods: candidatos && armarModelos(candidatos, { df, anios: eco.anios, perdidas, n }),
  };
}

// Piezas del caso que cambian con el equipo de cada módulo (índice ≥ 1; la 0 es el caso base).
const POS = { wt: 0, pv: 1, con: 2, ele: 3, ht: 4, fc: 5, bat: 6, dg: 7 };
function armarModelos(cand, { df, anios, perdidas, n }) {
  const mods = {};
  for (const k of MODULOS) {
    mods[k] = (cand[k] || []).map((c, i) => {
      if (!i || !c) return null;
      const eq = c.eq, p = { ci: eq.ci, npc: POS[k] < 6 ? npcUnidad(eq, df, anios) : 0, campos: {} };
      if (k === "wt") {
        const WT = new Float64Array(n), f = perdidas?.wt ?? 1, tope = topeWT(eq);
        for (let t = 0; t < n; t++) WT[t] = Math.min(c.wtKw[t % c.wtKw.length], tope) * f;
        Object.assign(p.campos, { WT, wtPr: eq.pr });
        p.estela = c.estela && { eta: Float32Array.from(c.estela.eta), sec: c.estela.sec && Uint8Array.from(c.estela.sec), S: c.estela.S, nMax: c.estela.nMax };
        p.campoFV = c.campoFV && { ...c.campoFV, tabla: Float32Array.from(c.campoFV.tabla) };
        p.terreno = c.terreno;
      } else if (k === "pv") {
        const PV = new Float64Array(n), f = perdidas?.pv ?? 1;
        for (let t = 0; t < n; t++) PV[t] = Math.min(c.pvKw[t % c.pvKw.length], eq.pr) * f;
        Object.assign(p.campos, { PV, pvPr: eq.pr });
        p.terreno = c.terreno; p.m2Panel = c.m2Panel;
      } else if (k === "con" || k === "ele" || k === "fc") p.campos[k] = { pr: eq.pr, eta: eq.eta };
      else if (k === "ht") p.campos.ht = { cap: eq.cap };
      else p.campos[k] = { ...eq };
      return p;
    });
  }
  return mods;
}

// El caso con los equipos que indica una configuración de 16 valores (se guarda: hay pocas combinaciones distintas).
export function vista(caso, cfg) {
  if (!caso.mods || !cfg || cfg.length <= 8) return caso;
  const idx = cfg.slice(8, 16), clave = idx.join(",");
  caso._vistas ??= new Map();
  let v = caso._vistas.get(clave);
  if (v) return v;
  v = { ...caso, npcU: caso.npcU.slice(), ciU: caso.ciU.slice(), terreno: caso.terreno && { ...caso.terreno } };
  MODULOS.forEach((k, i) => {
    const p = idx[i] ? caso.mods[k][idx[i]] : null;
    if (!p) return;
    Object.assign(v, p.campos);
    if (i < 6) v.npcU[i] = p.npc;
    v.ciU[i] = p.ci;
    if (v.terreno && p.terreno) Object.assign(v.terreno, p.terreno);
    if (k === "wt") { v.estela = p.estela; if (p.campoFV) v.campoFV = { ...p.campoFV, m2Panel: v.campoFV?.m2Panel ?? p.campoFV.m2Panel }; }
    if (k === "pv" && v.campoFV && p.m2Panel) v.campoFV = { ...v.campoFV, m2Panel: p.m2Panel };
  });
  // El m² por panel del panel elegido vale aunque la tabla venga del aerogenerador elegido.
  const pPv = idx[1] ? caso.mods.pv[idx[1]] : null;
  if (pPv?.m2Panel && v.campoFV) v.campoFV = { ...v.campoFV, m2Panel: pPv.m2Panel };
  caso._vistas.set(clave, v);
  return v;
}

// Factor de producción del campo solar con nWt aerogeneradores y nPv paneles (1 sin datos de la zona).
export function factorCampoFV(caso, nWt, nPv) {
  const s = caso.campoFV;
  if (!s || !nPv || !s.K) return 1;
  const k = Math.min(s.K, Math.max(1, Math.ceil((nPv * s.m2Panel) / s.m2Celda - 1e-9)));
  return s.tabla[Math.min(nWt, s.nMax) * s.K + k - 1];
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
  caso = vista(caso, cfg);
  const nWt = cfg[0] || 0, nPv = cfg[1] || 0, nCon = cfg[2] || 0, nEle = cfg[3] || 0, nHt = cfg[4] || 0, nFc = cfg[5] || 0;
  const nBat = cfg[6] || 0, nDg = cfg[7] || 0;
  const { n, D, WT: wt1, PV: pv1 } = caso;
  const etaCon = caso.con.eta, capCon = nCon * caso.con.pr;
  const etaEle = caso.ele.eta, capEle = nEle * caso.ele.pr;
  const capHt = nHt * caso.ht.cap;
  const etaFc = caso.fc.eta, capFc = nFc * caso.fc.pr;
  const H2 = caso.h2, etaEleComp = H2 ? etaEle / (1 + H2.comp * etaEle) : etaEle;   // con la compresión
  const B = caso.bat, capBat = nBat * B.cap, socMin = capBat * B.socMin, pBat = capBat * B.cRate;
  const G = caso.dg, prDg = G.pr;

  let eStr = capHt; const eStrMax = capHt, eStrMin = 0;   // los tanques parten llenos
  let soc = capBat;                                        // la batería parte llena
  let eSum = 0, perdida = 0, ens = 0, lole = 0, h2Entra = 0, h2Sale = 0, h2Min = capHt;
  let batEntra = 0, batSale = 0, dgE = 0, litros = 0, horasDg = 0;
  const N = caso.anosClima || 1, horasAnio = caso.horasAnio || n, loleAnio = new Int32Array(N), ensAnio = new Float64Array(N);
  let sWt, sPv, sSum, sStr, sLoss, sDef, sSoc, sDg;
  if (completo) {
    sWt = new Float64Array(n); sPv = new Float64Array(n); sSum = new Float64Array(n); sStr = new Float64Array(n);
    sLoss = new Float64Array(n); sDef = new Float64Array(n); sSoc = new Float64Array(n); sDg = new Float64Array(n);
  }

  const est = caso.estela, filaE = est ? Math.min(nWt, est.nMax) * (est.S + 1) : 0;   // estelas: eficiencia del parque
  const fPv = factorCampoFV(caso, nWt, nPv);
  for (let t = 0; t < n; t++) {
    const WT = wt1[t] * nWt * (est ? est.eta[filaE + (est.sec ? est.sec[t] : est.S)] : 1), PV = pv1[t] * nPv * fPv, d = D[t];
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
    if (exc > 0 && H2 && nEle > 0) {                 // electrolizador real: por unidad, con carga mínima y auxiliares
      const unIn = caso.ele.pr / etaEle;             // potencia eléctrica nominal de una unidad
      let x = Math.min(exc, nEle * unIn), k = Math.floor(x / unIn + 1e-9);
      const r = x - k * unIn;
      if (r > 1e-9 && r >= H2.ele.cargaMin * unIn) k++; else x -= r;   // bajo la carga mínima, el resto no se usa
      const H = Math.max(0, x - H2.ele.aux * unIn * k) * etaEleComp;
      const E = Math.min(H, eStrMax - eStr);
      lossEle = (exc - x) * etaEle; lossStr = H - E;
      eStr += E; h2Entra += E;
    } else if (exc > 0) {                            // luego al electrolizador y a los tanques
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
      if (necStr > 0 && H2) {                        // celda real: por unidad, con carga mínima y auxiliares
        const prF = caso.fc.pr, disp = Math.min(eStr - eStrMin, capHt);
        let P = Math.min(necStr, capFc);
        const k = Math.ceil(P / prF - 1e-9), aux = H2.fc.aux * prF * k;
        let prod = Math.max(P, k * prF * H2.fc.cargaMin), H = k ? (prod + aux) / etaFc : 0;
        if (H > disp) { P = prod = Math.max(0, disp * etaFc - aux); H = P > 0 ? (P + aux) / etaFc : 0; }
        eStr -= H; h2Sale += H;
        eFcSys = P; lossFc = prod - P;
      } else if (necStr > 0) {                       // luego los tanques y las celdas de combustible
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
    if (def > 0.01) { lole++; loleAnio[(t / horasAnio) | 0]++; }
    ensAnio[(t / horasAnio) | 0] += def;
    if (eStr < h2Min) h2Min = eStr;
    if (completo) { sWt[t] = WT; sPv[t] = PV; sSum[t] = sum; sStr[t] = eStr; sLoss[t] = loss; sDef[t] = def; sSoc[t] = soc; sDg[t] = dgOut; }
  }

  // Varios años: los totales pasan a promedio anual y la confiabilidad es la del peor año (más horas con déficit;
  // a igual número, más energía no suministrada). Con un año no cambia nada.
  let peor = 0;
  for (let a = 1; a < N; a++) if (loleAnio[a] > loleAnio[peor] || (loleAnio[a] === loleAnio[peor] && ensAnio[a] > ensAnio[peor])) peor = a;
  const loleMedia = lole / N;
  if (N > 1) {
    lole = loleAnio[peor]; ens = ensAnio[peor];
    eSum /= N; perdida /= N; h2Entra /= N; h2Sale /= N; batEntra /= N; batSale /= N; dgE /= N; litros /= N; horasDg /= N;
  }

  // Costos: módulos de la tesis con su NPC por unidad; batería y diésel dependen de cómo se usaron.
  let npc = 0, capex = 0;
  for (let k = 0; k < 6; k++) { npc += (cfg[k] || 0) * caso.npcU[k]; capex += (cfg[k] || 0) * caso.ciU[k]; }
  let vidaBat = null, ciclosBat = 0, vidaDg = null, npcBat = 0, npcDg = 0, costoDieselAnual = 0;
  if (nBat > 0) {
    ciclosBat = batSale / Math.max(1e-9, capBat * (1 - B.socMin));          // ciclos equivalentes completos al año
    // Desgaste por calendario y por ciclos a la vez: cada año se pierde 1/vu de la vida por tiempo y ciclos/ciclosVida
    // por uso, y la batería se reemplaza cuando la suma llega a 1.
    vidaBat = 1 / (1 / B.vu + ciclosBat / B.ciclos);
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
  const r = { lcoe, lole, ens, lpsp, loleMedia, anosClima: N, anioPeor: peor, eSum, perdida, npc, capex, h2Entra, h2Sale, h2Min, eStrFinal: eStr,
    batEntra, batSale, ciclosBat, vidaBat, npcBat, dgE, litros, horasDg, vidaDg, npcDg, costoDieselAnual,
    co2: litros * CO2_POR_LITRO, fraccionRenovable: eSum > 0 ? 1 - dgE / eSum : 0 };
  if (completo) {
    r.series = { wt: sWt, pv: sPv, sum: sSum, str: sStr, loss: sLoss, def: sDef, d: D, soc: sSoc, dg: sDg };
    if (N > 1) for (const k in r.series) r.series[k] = r.series[k].slice(peor * horasAnio, (peor + 1) * horasAnio);   // el peor año
  }
  return r;
}

/* ---------- Criterios de optimización ---------- */

// Confiabilidad: LOLE ≤ h (horas con déficit) o LPSP ≤ límite, y opcionalmente ENS ≤ h · demanda media
// (ec. 2.2.18 y 2.2.19). Devuelve 0 si se cumple; si no, cuánto falta (para las reglas de factibilidad).
export function violacion(res, crit, caso, cfg) {
  let v = 0;
  if (crit.tipo === "lpsp") v = Math.max(0, res.lpsp - crit.lpspMax) * 100;
  else {
    v = Math.max(0, res.lole - crit.h);
    if (crit.usarEnergia) v += Math.max(0, res.ens - crit.h * caso.mediaD) / Math.max(caso.mediaD, 1e-9);
  }
  return v + excesoTerreno(caso, cfg);
}

// Zona del proyecto: los aerogeneradores (su celda de separación o, si comparten el terreno con los paneles, su
// círculo libre) y los paneles (con el espacio entre filas) no pueden ocupar más que la superficie disponible.
// Sin zona no se aplica.
export function excesoTerreno(caso, cfg) {
  const t = vista(caso, cfg).terreno;
  if (!t || !cfg) return 0;
  // Además, no caben más aerogeneradores que las posiciones de su grilla (depende del rotor del equipo elegido).
  const sobra = t.nWtMax != null && cfg[0] > t.nWtMax ? ((cfg[0] - t.nWtMax) / Math.max(1, t.nWtMax)) * 100 : 0;
  return Math.max(0, (cfg[0] * t.aWt + cfg[1] * t.aPv - t.area) / t.area) * 100 + sobra;
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
    perdida: r.perdida, h2Min: r.h2Min, co2: r.co2, viol: violacion(r, crit, caso, cfg), obj: objetivo(r, crit, caso) };
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
