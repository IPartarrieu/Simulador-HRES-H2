// Series de entrada: demanda horaria (8760 h) y recurso meteorológico.
import { rng } from "./optimizers.js";
import { decodificarSerie } from "./codec.js";

export const HORAS = 8760;

let cacheHuichas = null, cacheResstock = null;
export async function datosHuichas() {
  if (!cacheHuichas) {
    cacheHuichas = await (await fetch("data/huichas_2018.json")).json();
    cacheHuichas.demanda_kw = decodificarSerie(cacheHuichas.demanda_codificada);   // datos de terceros: solo dentro del simulador
  }
  return cacheHuichas;
}
async function datosResstock() {
  if (!cacheResstock) cacheResstock = await (await fetch("data/resstock_maine_2018.json")).json();
  return cacheResstock;
}

/* ---------- Demanda ---------- */

export async function demandaHuichas() {
  const d = await datosHuichas();
  return { serie: Float64Array.from(d.demanda_kw), nombre: "Isla Las Huichas, 2018 (tesis)" };
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

// Serie sintética a partir de Las Huichas: cada día toma el perfil de un día real cercano en el año (±10 días),
// lo multiplica por un factor diario aleatorio y agrega ruido horario. Conserva la estacionalidad y el ciclo diario.
export async function demandaSintetica({ semilla = 7, variabilidad = 0.15, media = 112.1 }) {
  const base = (await datosHuichas()).demanda_kw, dias = HORAS / 24, r = rng(semilla);
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
  return { serie, nombre: `Sintética a partir de Las Huichas · semilla ${semilla}, variabilidad ${Math.round(variabilidad * 100)} %` };
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
    hourly: "temperature_2m,surface_pressure,wind_speed_10m,wind_speed_100m,global_tilted_irradiance",
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
  };
  if (clima.gti_wm2.length < HORAS) throw new Error("Open-Meteo no entregó un año completo para ese punto.");
  return { clima, nombre: `ERA5 · ${lat.toFixed(2)}°, ${lon.toFixed(2)}° · ${anio}`, punto: [d.latitude, d.longitude] };
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
