// Series de entrada: demanda horaria (8760 h) y recurso meteorológico.
import { rng } from "./optimizers.js?v=20261016a";
import { decodificarSerie } from "./codec.js?v=20261016a";

export const HORAS = 8760;

let cacheEjemplo = null, cacheResstock = null;
export async function datosEjemplo() {
  if (!cacheEjemplo) {
    cacheEjemplo = await (await fetch("data/ejemplo_45s_2018.json")).json();
    cacheEjemplo.demanda_kw = decodificarSerie(cacheEjemplo.demanda_codificada);   // datos de terceros: solo dentro del simulador
  }
  return cacheEjemplo;
}
async function datosResstock() {
  if (!cacheResstock) cacheResstock = await (await fetch("data/resstock_maine_2018.json")).json();
  return cacheResstock;
}

/* ---------- Demanda ---------- */

export async function demandaEjemplo() {
  const d = await datosEjemplo();
  return { serie: Float64Array.from(d.demanda_kw), nombre: "Localidad remota · 840 habitantes (2018)" };
}

// Perfil residencial público de NREL (ResStock, Maine 2018): promedio por vivienda × número de viviendas.
// Opcionalmente se desplaza medio año (182 días) para que el invierno caiga en junio-agosto, como en Chile.
export async function demandaResstock({ viviendas = 125, hemisferioSur = true }) {
  const d = await datosResstock();
  const base = d.kw_por_vivienda, n = HORAS, corr = hemisferioSur ? 182 * 24 : 0;
  const serie = new Float64Array(n);
  for (let t = 0; t < n; t++) serie[t] = base[(t + corr) % n] * viviendas;
  return { serie, nombre: `NREL ResStock, Maine 2018 · ${viviendas} viviendas${hemisferioSur ? " (estaciones del hemisferio sur)" : ""}` };
}

// Serie sintética a partir de la localidad remota de ejemplo: cada día toma el perfil de un día real cercano en el año (±10 días),
// lo multiplica por un factor diario aleatorio y agrega ruido horario. Conserva la estacionalidad y el ciclo diario.
export async function demandaSintetica({ semilla = 7, variabilidad = 0.15, media = 112.1 }) {
  const base = (await datosEjemplo()).demanda_kw, dias = HORAS / 24, r = rng(semilla);
  const serie = new Float64Array(HORAS);
  for (let d = 0; d < dias; d++) {
    const fuente = ((d + r.int(-10, 10)) % dias + dias) % dias;
    const factor = Math.exp(variabilidad * r.normal() - variabilidad * variabilidad / 2);
    for (let hh = 0; hh < 24; hh++) {
      const ruido = 1 + (variabilidad / 3) * r.normal();
      serie[d * 24 + hh] = Math.max(0, base[fuente * 24 + hh] * factor * ruido);
    }
  }
  const m = serie.reduce((a, b) => a + b, 0) / HORAS;
  for (let t = 0; t < HORAS; t++) serie[t] *= media / m;
  return { serie, nombre: `Sintética a partir de la localidad remota · semilla ${semilla}, variabilidad ${Math.round(variabilidad * 100)} %` };
}

// Archivo del usuario: una columna de valores horarios en kW (o la última columna numérica de cada fila).
// Acepta 8760 valores, u 8784 de un año bisiesto (se quita el 29 de febrero).
export function demandaCSV(texto, nombreArchivo = "archivo propio") {
  const valores = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const campos = linea.split(/[;,\t]/).map((c) => c.trim()).filter(Boolean);
    for (let i = campos.length - 1; i >= 0; i--) {
      const v = Number(campos[i].replace(/\s/g, ""));
      if (Number.isFinite(v)) { valores.push(v); break; }
    }
  }
  if (valores.length === 8784) valores.splice(59 * 24, 24);
  if (valores.length < HORAS) throw new Error(`El archivo tiene ${valores.length} valores numéricos. Se necesitan 8760 (un año, de enero a diciembre, hora a hora).`);
  if (valores.length > HORAS) valores.length = HORAS;
  if (valores.some((v) => v < 0)) throw new Error("La demanda no puede tener valores negativos.");
  return { serie: Float64Array.from(valores), nombre: nombreArchivo };
}

/* ---------- Recurso meteorológico ---------- */

// ERA5 (reanálisis de Copernicus/ECMWF) vía Open-Meteo, para cualquier punto y año. Panel inclinado en la
// latitud y orientado hacia el ecuador.
export async function climaOpenMeteo({ lat, lon, anio }) {
  const inclinacion = Math.min(60, Math.round(Math.abs(lat)));
  const params = new URLSearchParams({
    latitude: lat, longitude: lon, start_date: `${anio}-01-01`, end_date: `${anio}-12-31`,
    hourly: "temperature_2m,surface_pressure,wind_speed_10m,wind_speed_100m,wind_direction_100m,global_tilted_irradiance",
    tilt: inclinacion, azimuth: lat < 0 ? 180 : 0, wind_speed_unit: "ms", timezone: "auto",
  });
  const resp = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  const d = await resp.json();
  if (!resp.ok || d.error) throw new Error(d.reason || `Open-Meteo respondió ${resp.status}`);
  const h = d.hourly;
  const quitar29 = h.time.length === 8784;
  const limpiar = (a) => { const c = a.map((v) => (v == null ? 0 : v)); if (quitar29) c.splice(59 * 24, 24); return c.slice(0, HORAS); };
  const clima = {
    temp_c: limpiar(h.temperature_2m), presion_hpa: limpiar(h.surface_pressure),
    v10_ms: limpiar(h.wind_speed_10m), v100_ms: limpiar(h.wind_speed_100m), gti_wm2: limpiar(h.global_tilted_irradiance),
    dir100_deg: limpiar(h.wind_direction_100m),
  };
  if (clima.gti_wm2.length < HORAS) throw new Error("Open-Meteo no entregó un año completo para ese punto.");
  Object.assign(clima, ejeViento(h.wind_speed_100m, h.wind_direction_100m));
  return { clima, nombre: `ERA5 · ${lat.toFixed(2)}°, ${lon.toFixed(2)}° · ${anio}`, punto: [d.latitude, d.longitude] };
}

// Series prealmacenadas de la región de prueba (ERA5 2023, data/clima/<id>.json), del Maule a la Araucanía.
export const ESTACIONES = [
  { id: "constitucion", nombre: "Constitución (costa, Maule)", lat: -35.33, lon: -72.41 },
  { id: "talca", nombre: "Talca (valle, Maule)", lat: -35.43, lon: -71.66 },
  { id: "chillan", nombre: "Chillán (valle, Ñuble)", lat: -36.61, lon: -72.10 },
  { id: "concepcion", nombre: "Concepción (costa, Biobío)", lat: -36.83, lon: -73.05 },
  { id: "los_angeles", nombre: "Los Ángeles (valle, Biobío)", lat: -37.47, lon: -72.35 },
  { id: "antuco", nombre: "Antuco (precordillera, Biobío)", lat: -37.33, lon: -71.68 },
  { id: "lebu", nombre: "Lebu (costa, Biobío)", lat: -37.61, lon: -73.65 },
  { id: "temuco", nombre: "Temuco (valle, Araucanía)", lat: -38.74, lon: -72.60 },
  { id: "saavedra", nombre: "Puerto Saavedra (costa, Araucanía)", lat: -38.78, lon: -73.40 },
  { id: "lonquimay", nombre: "Lonquimay (cordillera, Araucanía)", lat: -38.45, lon: -71.37 },
];
const cacheEstaciones = {};
export async function climaEstacion(id) {
  cacheEstaciones[id] ??= await (await fetch(`data/clima/${id}.json`)).json();
  const d = cacheEstaciones[id];
  return { clima: d, nombre: `ERA5 ${d.anio} · ${d.nombre} · ${d.elevacion_m} m s.n.m.` };
}

// Series propias: columnas temperatura (°C), viento a 10 m (m/s), radiación sobre el panel (W/m²) y, si están,
// viento a 100 m (m/s), presión (hPa) y dirección del viento (°, desde donde sopla). Sin viento a 100 m se usa el perfil 1/7; sin presión, la atmósfera
// estándar a la elevación dada.
export function climaCSV(texto, nombreArchivo = "series propias", elevacionM = 0) {
  const filas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const v = linea.split(/[;,\t]/).map((c) => Number(c.trim()));
    if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) filas.push(v);
  }
  if (filas.length === 8784) filas.splice(59 * 24, 24);
  if (filas.length < HORAS) throw new Error(`El archivo tiene ${filas.length} filas válidas. Se necesitan 8760 (un año, hora a hora) con al menos temperatura, viento y radiación.`);
  filas.length = HORAS;
  const p0 = 1013.25 * Math.pow(1 - 2.25577e-5 * elevacionM, 5.25588);
  const clima = {
    temp_c: filas.map((f) => f[0]), v10_ms: filas.map((f) => Math.max(0, f[1])), gti_wm2: filas.map((f) => Math.max(0, f[2])),
    v100_ms: filas.map((f) => (Number.isFinite(f[3]) ? Math.max(0, f[3]) : Math.max(0, f[1]) * Math.pow(10, 1 / 7))),
    presion_hpa: filas.map((f) => (Number.isFinite(f[4]) && f[4] > 300 ? f[4] : p0)),
  };
  if (filas.every((f) => Number.isFinite(f[5]))) Object.assign(clima, { dir100_deg: filas.map((f) => ((f[5] % 360) + 360) % 360) }, ejeViento(clima.v100_ms, filas.map((f) => f[5])));
  return { clima, nombre: nombreArchivo };
}

// Eje dominante del viento ponderado por la energía (v³), con ángulos dobles: 0° y 180° cuentan igual.
// concentracion: 1 si todo el viento sopla en ese eje, 0 si llega parejo de todas las direcciones.
export function ejeViento(v, dir) {
  let C = 0, S = 0, E = 0;
  v.forEach((x, i) => {
    if (x == null || dir[i] == null) return;
    const e = x ** 3, a = (2 * dir[i] * Math.PI) / 180;
    C += e * Math.cos(a); S += e * Math.sin(a); E += e;
  });
  return { eje_viento: (Math.round((Math.atan2(S, C) * 90) / Math.PI) + 180) % 180, concentracion_viento: E ? Math.round((Math.hypot(C, S) / E) * 100) / 100 : 0 };
}

/* ---------- Estadísticas ---------- */

export function resumen(serie) {
  let s = 0, mx = -Infinity, mn = Infinity;
  for (const v of serie) { s += v; if (v > mx) mx = v; if (v < mn) mn = v; }
  return { media: s / serie.length, max: mx, min: mn, energiaMWh: s / 1000 };
}

export function mediasDiarias(serie) {
  const out = [];
  for (let d = 0; d < serie.length / 24; d++) {
    let s = 0; for (let hh = 0; hh < 24; hh++) s += serie[d * 24 + hh];
    out.push(s / 24);
  }
  return out;
}
