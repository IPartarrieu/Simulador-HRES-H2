// Página del Simulador HRES-H2: arma el caso con lo que elige la persona, reparte las simulaciones entre
// Web Workers, ejecuta el método de optimización y muestra los resultados.
import { CATALOGO, MODULOS, NOMBRES, ECONOMIA_TESIS, potenciaPV, potenciaWT, limitesPorDefecto } from "./model.js";
import { monteCarlo, genetico, shade, aptitud, PENALIZACION } from "./optimizers.js";
import * as dem from "./demand.js";
import { svgDiagrama, descargarSVG, descargarPNG, descargar } from "./diagram.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TESIS_IDS = { wt: "gaia133", pv: "cs6u330", con: "conv1", ele: "pem3", ht: "tank03", fc: "pemfc3" };
const clonar = (o) => JSON.parse(JSON.stringify(o));

// Mejores resultados del artículo por escenario (Tabla 2.3.1).
const REF_TESIS = {
  0: { metodo: "algoritmo genético", lcoe: 1.469, cfg: [11, 37659, 196, 347, 16455, 69] },
  6: { metodo: "algoritmo híbrido", lcoe: 1.364, cfg: [4, 35674, 197, 317, 16318, 69] },
  12: { metodo: "algoritmo genético", lcoe: 1.335, cfg: [6, 35177, 193, 298, 15619, 68] },
  18: { metodo: "algoritmo genético", lcoe: 1.311, cfg: [8, 32106, 193, 275, 15597, 68] },
};

const COSTOS = [["ci", "Inversión (USD)"], ["rep", "Reemplazo (USD)"], ["om", "O&M (USD/año)"], ["vu", "Vida útil (años)"]];
const PARAMS_EQUIPO = {
  wt: [["pr", "Potencia nominal (kW)"], ["vcin", "V. de arranque (m/s)"], ["vr", "V. nominal (m/s)"], ["vcout", "V. de corte (m/s)"], ["hub", "Altura del buje (m)"], ...COSTOS],
  pv: [["pr", "Potencia nominal (kW)"], ["eff", "Eficiencia (%)"], ["alfa", "Coef. de temperatura (%/°C)"], ["noct", "NOCT (°C)"], ["fpv", "Factor de reducción"], ...COSTOS],
  con: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
  ele: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
  ht: [["cap", "Capacidad (kWh)"], ...COSTOS],
  fc: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
};
const FISICOS = { wt: ["pr", "vcin", "vr", "vcout", "hub"], pv: ["pr", "eff", "alfa", "noct", "fpv"] };
const UNIDAD = { wt: "kW", pv: "kW", con: "kW", ele: "kW", ht: "kWh", fc: "kW" };

const METODOS = {
  shade: {
    nombre: "Evolución diferencial adaptativa (SHADE) · recomendado",
    desc: "Método nuevo, más eficiente que los de la tesis: adapta sus parámetros, usa reglas de factibilidad y termina con una búsqueda local entera.",
    params: [["poblacion", "Población", 60], ["generaciones", "Generaciones", 200]],
    rapido: { poblacion: 40, generaciones: 100 }, tesis: null,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  ga: {
    nombre: "Algoritmo genético (tesis)",
    desc: "Como en la tesis (DEAP): torneo de 3, cruce en dos puntos y mutación entera uniforme. Las soluciones que no cumplen el LOLE se penalizan.",
    params: [["poblacion", "Población", 100], ["generaciones", "Generaciones", 150], ["cxpb", "Prob. de cruce", 0.7], ["mutpb", "Prob. de mutación", 0.2], ["indpb", "Prob. por gen", 0.2]],
    rapido: { poblacion: 80, generaciones: 80 }, tesis: { poblacion: 500, generaciones: 1000 },
    evals: (p) => Math.round(p.poblacion * (1 + 0.8 * p.generaciones)),
  },
  ha: {
    nombre: "Algoritmo híbrido CS-HS-SA (tesis)",
    desc: "Búsqueda caótica, armónica y recocido simulado (Zhang et al.), en corridas independientes. Se queda con la mejor corrida.",
    params: [["corridas", "Corridas", 40], ["iteraciones", "Iteraciones por corrida", 1000], ["hmcr", "HMCR", 0.9], ["parMin", "PAR mínimo", 0.1], ["parMax", "PAR máximo", 1.0], ["t0", "Temperatura inicial", 1000], ["s", "Enfriamiento", 0.97]],
    rapido: { corridas: 16, iteraciones: 1000 }, tesis: { corridas: 500, iteraciones: 1000 },
    evals: (p) => p.corridas * (p.iteraciones + 5),
  },
  mc: {
    nombre: "Monte Carlo (tesis)",
    desc: "Prueba configuraciones al azar dentro de los límites y se queda con la de menor LCOE que cumple la confiabilidad.",
    params: [["muestras", "Muestras", 50000]],
    rapido: { muestras: 20000 }, tesis: { muestras: 500000 },
    evals: (p) => p.muestras,
  },
};

const estado = {
  demanda: null, demandaNombre: "", demandaTipo: "huichas",
  recurso: "tesis", clima: null, climaNombre: "",
  arq: { wt: true, pv: true, hess: true },
  equipos: Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === TESIS_IDS[k]))])),
  limites: null, limitesEditados: false,
  resultado: null, corriendo: false,
};
let pool = null, detener = false;
const graficos = {};

/* ---------- Utilidades de interfaz ---------- */

function estadoTexto(sel, texto, clase = "") {
  const el = $(sel); el.textContent = texto; el.className = "status" + (clase ? " " + clase : "");
}
function radio(nombre) { return $(`input[name="${nombre}"]:checked`).value; }
function num(sel) { const v = Number($(sel).value); return Number.isFinite(v) ? v : 0; }
function etiquetasDias() {
  return Array.from({ length: 365 }, (_, d) => { const f = new Date(2018, 0, 1 + d); return `${f.getDate()} ${MESES[f.getMonth()]}`; });
}
function grafico(id, config) {
  if (typeof Chart === "undefined") return;
  graficos[id]?.destroy();
  graficos[id] = new Chart($("#" + id), config);
}
function lineas(id, labels, datasets, yTitulo, extra = {}) {
  grafico(id, {
    type: "line",
    data: { labels, datasets: datasets.map((d) => ({ pointRadius: 0, borderWidth: 1.6, tension: 0.2, fill: false, ...d })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 12 } } } },
      scales: { x: { ticks: { maxTicksLimit: 12, font: { size: 11 } } }, y: { beginAtZero: true, title: { display: !!yTitulo, text: yTitulo }, ticks: { font: { size: 11 } } } },
      ...extra,
    },
  });
}

/* ---------- 1. Demanda ---------- */

async function cargarDemanda() {
  const tipo = radio("demanda");
  estado.demandaTipo = tipo;
  $$("#paso-demanda .subopts").forEach((el) => { el.hidden = el.dataset.para !== tipo; });
  try {
    let r = null;
    if (tipo === "huichas") r = await dem.demandaHuichas();
    else if (tipo === "resstock") r = await dem.demandaResstock({ viviendas: Math.max(1, Math.round(num("#rs-viviendas"))), hemisferioSur: $("#rs-sur").checked });
    else if (tipo === "sintetica") r = await dem.demandaSintetica({ semilla: Math.max(1, Math.round(num("#sin-semilla"))), variabilidad: Math.max(0, num("#sin-var")) / 100, media: Math.max(0.1, num("#sin-media")) });
    else if (tipo === "csv") {
      const f = $("#csv-archivo").files[0];
      if (!f) { estado.demanda = null; estadoTexto("#demanda-estado", "Elige un archivo con la demanda horaria.", "warn"); cambiosGenerales(); return; }
      r = dem.demandaCSV(await f.text(), f.name);
    }
    estado.demanda = r.serie; estado.demandaNombre = r.nombre;
    const s = dem.resumen(r.serie);
    estadoTexto("#demanda-estado", `${r.nombre}: media ${fmt(s.media, 1)} kW · máxima ${fmt(s.max, 1)} kW · mínima ${fmt(s.min, 1)} kW · ${fmt(s.energiaMWh, 0)} MWh al año.`, "ok");
    lineas("graf-demanda", etiquetasDias(), [{ label: "Demanda media diaria (kW)", data: dem.mediasDiarias(r.serie), borderColor: "#1F5FAD", backgroundColor: "rgba(31,95,173,.12)", fill: true }], "kW",
      { plugins: { legend: { display: false } } });
  } catch (err) {
    estado.demanda = null;
    estadoTexto("#demanda-estado", err.message, "err");
  }
  cambiosGenerales();
}

/* ---------- 2. Recurso ---------- */

function recursoListo() { return estado.recurso !== "ubicacion" || !!estado.clima; }

async function climaActual() {
  if (estado.recurso === "era5") return (await dem.datosHuichas()).era5;
  return estado.clima;
}

// Potencia horaria de UNA unidad de aerogenerador y de panel, según el recurso elegido.
async function seriesUnidad() {
  if (estado.recurso === "tesis") { const d = await dem.datosHuichas(); return { wt: Float64Array.from(d.tesis.wt_kw), pv: Float64Array.from(d.tesis.pv_kw) }; }
  const c = await climaActual();
  return { wt: potenciaWT(estado.equipos.wt, c.v10_ms, c.v100_ms, c.temp_c, c.presion_hpa), pv: potenciaPV(estado.equipos.pv, c.gti_wm2, c.temp_c) };
}

async function cambiarRecurso() {
  estado.recurso = radio("recurso");
  $$("#paso-recurso .subopts").forEach((el) => { el.hidden = el.dataset.para !== estado.recurso; });
  if (estado.recurso === "tesis") {
    for (const k of ["wt", "pv"]) if (estado.equipos[k].id !== TESIS_IDS[k]) estado.equipos[k] = clonar(CATALOGO[k].find((d) => d.id === TESIS_IDS[k]));
  }
  renderEquipos();
  await describirRecurso();
  cambiosGenerales();
}

async function describirRecurso() {
  if (!recursoListo()) { estadoTexto("#recurso-estado", "Ingresa la ubicación y el año, y descarga el clima.", "warn"); return; }
  const s = await seriesUnidad();
  const fp = (serie, pr) => (serie.reduce((a, b) => a + Math.min(b, pr), 0) / serie.length / pr) * 100;
  const origen = estado.recurso === "tesis" ? "Serie de la tesis (mediciones in situ, 2018)" : estado.recurso === "era5" ? "ERA5, Las Huichas 2018" : estado.climaNombre;
  estadoTexto("#recurso-estado", `${origen}. Factor de planta con los equipos elegidos: aerogenerador ${fmt(fp(s.wt, estado.equipos.wt.pr), 1)} %, panel ${fmt(fp(s.pv, estado.equipos.pv.pr), 1)} %.`, "ok");
}

async function cargarUbicacion() {
  const lat = num("#ub-lat"), lon = num("#ub-lon"), anio = Math.round(num("#ub-anio"));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { estadoTexto("#recurso-estado", "La latitud va de −90 a 90 y la longitud de −180 a 180.", "err"); return; }
  estadoTexto("#recurso-estado", "Descargando el clima horario desde Open-Meteo…");
  $("#ub-cargar").disabled = true;
  try {
    const r = await dem.climaOpenMeteo({ lat, lon, anio });
    estado.clima = r.clima; estado.climaNombre = r.nombre;
    await describirRecurso();
  } catch (err) {
    estado.clima = null;
    estadoTexto("#recurso-estado", `No se pudo descargar el clima: ${err.message}`, "err");
  }
  $("#ub-cargar").disabled = false;
  cambiosGenerales();
}

/* ---------- 3 y 4. Arquitectura y equipos ---------- */

function moduloActivo(k) {
  const a = estado.arq;
  if (k === "wt") return a.wt;
  if (k === "pv") return a.pv;
  if (k === "con") return a.pv || a.hess;
  return a.hess;
}

function renderEquipos() {
  const cont = $("#equipos");
  cont.replaceChildren();
  for (const k of MODULOS) {
    const eq = estado.equipos[k], activo = moduloActivo(k);
    const bloqueado = estado.recurso === "tesis" && (k === "wt" || k === "pv");
    const div = document.createElement("div");
    div.className = "equipo" + (activo ? "" : " off");
    const h3 = document.createElement("h3"); h3.textContent = NOMBRES[k]; div.appendChild(h3);
    const sel = document.createElement("select");
    sel.disabled = !activo || bloqueado || estado.corriendo;
    sel.setAttribute("aria-label", NOMBRES[k]);
    for (const d of CATALOGO[k]) { const o = document.createElement("option"); o.value = d.id; o.textContent = d.nombre; o.selected = d.id === eq.id; sel.appendChild(o); }
    sel.addEventListener("change", async () => {
      estado.equipos[k] = clonar(CATALOGO[k].find((d) => d.id === sel.value));
      renderEquipos(); await describirRecurso(); cambiosGenerales();
    });
    div.appendChild(sel);
    if (bloqueado) { const p = document.createElement("p"); p.className = "nota"; p.textContent = "La serie de la tesis corresponde a este equipo. Para comparar marcas, usa el clima ERA5."; div.appendChild(p); }
    const det = document.createElement("details");
    const sum = document.createElement("summary"); sum.textContent = "Parámetros"; det.appendChild(sum);
    const grid = document.createElement("div"); grid.className = "params";
    for (const [campo, etiqueta] of PARAMS_EQUIPO[k]) {
      const lab = document.createElement("label"); lab.textContent = etiqueta;
      const inp = document.createElement("input"); inp.type = "number"; inp.step = "any"; inp.value = eq[campo];
      inp.disabled = !activo || estado.corriendo || (bloqueado && FISICOS[k].includes(campo));
      inp.addEventListener("change", async () => {
        const v = Number(inp.value);
        const minimo = campo === "alfa" ? -5 : campo === "vu" ? 1 : 0;
        if (!Number.isFinite(v) || v < minimo || (["pr", "cap", "eta", "eff"].includes(campo) && v <= 0)) { inp.value = eq[campo]; return; }
        eq[campo] = campo === "vu" ? Math.round(v) : v;
        inp.value = eq[campo];
        if (!eq.nombre.includes("(editado)")) eq.nombre += " (editado)";
        await describirRecurso(); cambiosGenerales();
      });
      lab.appendChild(inp); grid.appendChild(lab);
    }
    det.appendChild(grid); div.appendChild(det);
    cont.appendChild(div);
  }
}

function renderDiagrama() {
  $("#diagrama").innerHTML = svgDiagrama({ arq: estado.arq, equipos: estado.equipos });   // SVG armado por el propio sitio (textos escapados)
}

function nombreArquitectura() {
  const p = [];
  if (estado.arq.pv) p.push("PV");
  if (estado.arq.wt) p.push("WT");
  if (estado.arq.hess) p.push("HESS");
  return p.join("-") || "sin generación";
}

/* ---------- 5. Criterios ---------- */

function leerEconomia() {
  return { dn: num("#eco-dn") / 100, ie: num("#eco-ie") / 100, anios: Math.min(50, Math.max(1, Math.round(num("#eco-anios")))), reserva: Math.max(0, num("#eco-reserva")) / 100 };
}
function leerConfiabilidad() { return { h: Math.max(0, Math.round(num("#conf-h"))), usarEnergia: $("#conf-energia").checked }; }

function esCasoTesis() {
  const e = leerEconomia();
  return estado.demandaTipo === "huichas" && estado.recurso === "tesis" && estado.arq.wt && estado.arq.pv && estado.arq.hess &&
    MODULOS.every((k) => estado.equipos[k].id === TESIS_IDS[k] && !estado.equipos[k].nombre.includes("(editado)")) &&
    Math.abs(e.dn - ECONOMIA_TESIS.dn) < 1e-9 && Math.abs(e.ie - ECONOMIA_TESIS.ie) < 1e-9 && e.anios === ECONOMIA_TESIS.anios && Math.abs(e.reserva - ECONOMIA_TESIS.reserva) < 1e-9;
}

/* ---------- 6. Optimización ---------- */

function renderMetodo() {
  const m = METODOS[$("#metodo").value];
  $("#metodo-desc").textContent = m.desc;
  const previos = Object.fromEntries($$("#metodo-params input").map((i) => [i.dataset.param, i.value]));
  const cont = $("#metodo-params"); cont.replaceChildren();
  for (const [k, etiqueta, v] of m.params) {
    const lab = document.createElement("label"); lab.textContent = etiqueta;
    const inp = document.createElement("input"); inp.type = "number"; inp.step = "any"; inp.min = "0"; inp.dataset.param = k;
    inp.value = cont.dataset.metodo === $("#metodo").value && previos[k] !== undefined ? previos[k] : v;
    inp.disabled = estado.corriendo;
    inp.addEventListener("input", estimar);
    lab.appendChild(inp); cont.appendChild(lab);
  }
  cont.dataset.metodo = $("#metodo").value;
  $("#preset-tesis").disabled = !m.tesis || estado.corriendo;
  estimar();
}
function leerParams() {
  const p = {};
  $$("#metodo-params input").forEach((i) => { p[i.dataset.param] = Number(i.value) || 0; });
  for (const k of ["poblacion", "generaciones", "corridas", "iteraciones", "muestras"]) if (k in p) p[k] = Math.max(k === "poblacion" ? 4 : 1, Math.round(p[k]));
  return p;
}
function aplicarPreset(tipo) {
  const valores = METODOS[$("#metodo").value][tipo];
  if (!valores) return;
  $$("#metodo-params input").forEach((i) => { if (i.dataset.param in valores) i.value = valores[i.dataset.param]; });
  estimar();
}
function hilos() { return Math.max(1, Math.min(32, Math.round(num("#opt-hilos")))); }
function estimar() {
  const n = METODOS[$("#metodo").value].evals(leerParams());
  const seg = n / (7000 * hilos());
  const t = seg < 90 ? `${Math.max(1, Math.round(seg))} s` : seg < 5400 ? `${Math.round(seg / 60)} min` : `${fmt(seg / 3600, 1)} h`;
  estadoTexto("#opt-estimado", `≈ ${fmt(n)} simulaciones anuales · tiempo estimado ≈ ${t} con ${hilos()} hilos (depende de tu computador).`, seg > 900 ? "warn" : "");
}

// Límites: se calculan con la demanda y los equipos; la persona puede editarlos.
function limitesAutomaticos() {
  if (!estado.demanda) return null;
  const e = leerEconomia();
  let maxD = 0; for (const v of estado.demanda) if (v > maxD) maxD = v;
  const caso = { maxD: maxD * (1 + e.reserva), wtPr: estado.equipos.wt.pr, pvPr: estado.equipos.pv.pr,
    con: estado.equipos.con, ele: estado.equipos.ele, ht: estado.equipos.ht, fc: estado.equipos.fc };
  return limitesPorDefecto(caso, estado.arq, esCasoTesis());
}
function renderLimites() {
  if (!estado.limitesEditados) estado.limites = limitesAutomaticos();
  else if (estado.limites) {                          // los módulos apagados siguen fijos en cero
    const auto = limitesAutomaticos();
    MODULOS.forEach((k, i) => { if (!moduloActivo(k)) estado.limites[i] = [0, 0]; else if (estado.limites[i][1] === 0 && auto) estado.limites[i] = auto[i]; });
  }
  const cont = $("#limites"); cont.replaceChildren();
  if (!estado.limites) return;
  for (const t of ["Módulo", "Mínimo", "Máximo"]) { const s = document.createElement("span"); s.className = "h"; s.textContent = t; cont.appendChild(s); }
  MODULOS.forEach((k, i) => {
    const s = document.createElement("span"); s.textContent = NOMBRES[k]; cont.appendChild(s);
    for (const j of [0, 1]) {
      const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.value = estado.limites[i][j];
      inp.disabled = !moduloActivo(k) || estado.corriendo;
      inp.setAttribute("aria-label", `${NOMBRES[k]}, ${j ? "máximo" : "mínimo"}`);
      inp.addEventListener("change", () => {
        const v = Math.max(0, Math.round(Number(inp.value) || 0));
        estado.limites[i][j] = v;
        if (estado.limites[i][0] > estado.limites[i][1]) estado.limites[i][1 - j] = v;
        estado.limitesEditados = true; renderLimites();
      });
      cont.appendChild(inp);
    }
  });
}
function renderManual() {
  const cont = $("#manual");
  const previos = Object.fromEntries($$("#manual input").map((i) => [i.dataset.k, i.value]));
  cont.replaceChildren();
  const base = estado.resultado?.cfg || (esCasoTesis() ? REF_TESIS[0].cfg : [5, 20000, 150, 200, 10000, 60]);
  MODULOS.forEach((k, i) => {
    const lab = document.createElement("label"); lab.textContent = NOMBRES[k];
    const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.dataset.k = k;
    inp.value = moduloActivo(k) ? (previos[k] && previos[k] !== "0" ? previos[k] : base[i]) : 0;
    inp.disabled = !moduloActivo(k) || estado.corriendo;
    lab.appendChild(inp); cont.appendChild(lab);
  });
}

function cambiosGenerales() {
  estado.arq = { wt: $("#arq-wt").checked, pv: $("#arq-pv").checked, hess: $("#arq-hess").checked };
  const valida = estado.arq.wt || estado.arq.pv;
  estadoTexto("#arq-estado", valida ? `Arquitectura ${nombreArquitectura()}.` : "Elige al menos una fuente de generación: aerogeneradores o paneles.", valida ? "" : "err");
  renderDiagrama(); renderLimites(); renderManual(); estimar();
  const listo = !estado.corriendo && valida && !!estado.demanda && recursoListo();
  $("#btn-optimizar").disabled = !listo;
  $("#btn-manual").disabled = !listo;
}

/* ---------- Hilos de cálculo ---------- */

class Pool {
  constructor(n) {
    this.pend = new Map(); this.id = 0;
    this.workers = Array.from({ length: n }, () => {
      const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        const p = this.pend.get(e.data.id);
        if (!p) return;
        if (e.data.parcial) { p.parcial?.(e.data); return; }
        this.pend.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
      };
      w.onerror = (e) => { for (const p of this.pend.values()) p.reject(new Error(e.message || "Error en un hilo de cálculo")); this.pend.clear(); };
      return w;
    });
  }
  enviar(i, msg, parcial) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pend.set(id, { resolve, reject, parcial }); this.workers[i].postMessage({ ...msg, id }); });
  }
  init(caso, h, usarEnergia) { return Promise.all(this.workers.map((_, i) => this.enviar(i, { tipo: "init", caso, h, usarEnergia }))); }
  async lote(cfgs) {
    const n = this.workers.length, trozo = Math.ceil(cfgs.length / n), tareas = [];
    for (let i = 0; i < n && i * trozo < cfgs.length; i++) tareas.push(this.enviar(i, { tipo: "lote", cfgs: cfgs.slice(i * trozo, (i + 1) * trozo) }));
    return (await Promise.all(tareas)).flatMap((r) => r.res);
  }
  terminar() { this.workers.forEach((w) => w.terminate()); for (const p of this.pend.values()) p.reject(new Error("detenido")); this.pend.clear(); }
}

// Evaluación por lotes con memoria: una configuración repetida no se vuelve a simular.
function crearEvaluador(p) {
  const cache = new Map();
  return {
    cuenta: () => cache.size,
    evaluar: async (cfgs) => {
      const faltan = new Map();
      for (const c of cfgs) { const k = c.join(","); if (!cache.has(k) && !faltan.has(k)) faltan.set(k, c); }
      if (faltan.size) (await p.lote([...faltan.values()])).forEach((e) => cache.set(e.cfg.join(","), e));
      return cfgs.map((c) => cache.get(c.join(",")));
    },
  };
}

// Algoritmo híbrido: cada worker ejecuta corridas completas; se juntan las mejores.
function haEnPool(p, limites, params, semilla, alProgresar) {
  const n = p.workers.length, total = params.corridas;
  const semillas = Array.from({ length: n }, () => []);
  for (let c = 0; c < total; c++) semillas[c % n].push(semilla * 100000 + c);
  let hechas = 0, mejor = null, evaluaciones = 0;
  const historial = [];
  const parcial = (d) => {
    hechas++; evaluaciones += d.historial.length + 5;
    if (!mejor || aptitud(d.mejor) < aptitud(mejor)) mejor = d.mejor;
    historial.push(aptitud(mejor));
    alProgresar({ fraccion: hechas / total, mejor, historial, etiqueta: `Corrida ${hechas} de ${total}`, evaluaciones });
  };
  const hParams = { iteraciones: params.iteraciones, hmcr: params.hmcr, parMin: params.parMin, parMax: params.parMax, t0: params.t0, s: params.s };
  return Promise.all(semillas.map((ss, i) => (ss.length ? p.enviar(i, { tipo: "ha", limites, params: hParams, semillas: ss }, parcial) : null)))
    .then(() => ({ mejor, historial, evaluaciones }));
}

async function armarCaso() {
  const s = await seriesUnidad();
  return { demanda: Array.from(estado.demanda), wtKw: Array.from(s.wt), pvKw: Array.from(s.pv), equipos: clonar(estado.equipos), economia: leerEconomia() };
}

let ultimoGrafico = 0;
function mostrarProgreso(p, t0, evaluador) {
  $("#progreso-barra").style.width = `${Math.round(Math.min(1, p.fraccion) * 100)}%`;
  const evals = p.evaluaciones ?? (evaluador ? evaluador.cuenta() : 0);
  const mejor = p.mejor && p.mejor.viol === 0 ? `mejor LCOE ${fmt(p.mejor.lcoe, 4)} USD/kWh` : "aún sin una configuración que cumpla la confiabilidad";
  $("#progreso-texto").textContent = `${p.etiqueta} · ${mejor} · ${fmt(evals)} simulaciones · ${fmt((performance.now() - t0) / 1000, 1)} s`;
  const ahora = performance.now();
  if (ahora - ultimoGrafico > 250 || p.fraccion >= 1) {
    ultimoGrafico = ahora;
    const datos = p.historial.map((v) => (v < PENALIZACION ? v : null));
    $("#conv-vacio").hidden = datos.some((v) => v !== null);
    const m = $("#metodo").value;
    lineas("graf-convergencia", datos.map((_, i) => i + 1), [{ label: "Mejor LCOE encontrado (USD/kWh)", data: datos, borderColor: "#1F5FAD", spanGaps: true }], "USD/kWh",
      { scales: { x: { title: { display: true, text: m === "ha" ? "Corridas" : m === "mc" ? "Lotes de muestras" : "Generaciones y pulido" }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: false, title: { display: true, text: "USD/kWh" } } } });
  }
}

function bloquear(corriendo) {
  estado.corriendo = corriendo;
  $("#btn-detener").disabled = !corriendo;
  $$("#paso-demanda input, #paso-demanda button, #paso-recurso input, #paso-recurso button, #paso-arquitectura input, #paso-criterios input, #metodo, #opt-semilla, #opt-hilos, #btn-tesis, #preset-rapido, #preset-tesis, #limites-auto")
    .forEach((el) => { el.disabled = corriendo; });
  renderEquipos(); renderMetodo(); cambiosGenerales();
}

async function optimizar() {
  if (!estado.demanda || !recursoListo()) return;
  const metodo = $("#metodo").value, params = leerParams(), semilla = Math.max(1, Math.round(num("#opt-semilla")));
  const { h, usarEnergia } = leerConfiabilidad();
  const limites = clonar(estado.limites);
  bloquear(true); detener = false;
  $("#progreso").hidden = false; $("#progreso-barra").style.width = "0%"; $("#progreso-texto").textContent = "Preparando el caso…";
  const t0 = performance.now();
  try {
    const caso = await armarCaso();
    pool = new Pool(hilos());
    await pool.init(caso, h, usarEnergia);
    const evaluador = crearEvaluador(pool);
    const comun = { limites, evaluar: evaluador.evaluar, semilla, alProgresar: (p) => mostrarProgreso(p, t0, evaluador), detenido: () => detener };
    let r;
    if (metodo === "ha") r = await haEnPool(pool, limites, params, semilla, (p) => mostrarProgreso(p, t0));
    else if (metodo === "ga") r = await genetico({ ...comun, ...params });
    else if (metodo === "mc") r = await monteCarlo({ ...comun, muestras: params.muestras });
    else r = await shade({ ...comun, ...params });
    if (!r.mejor) throw new Error("No se evaluó ninguna configuración.");
    const completo = await pool.enviar(0, { tipo: "completo", cfg: r.mejor.cfg });
    const seg = (performance.now() - t0) / 1000;
    mostrarResultados(r.mejor.cfg, completo.res, { metodo: METODOS[metodo].nombre, params, semilla, h, usarEnergia, segundos: seg,
      simulaciones: metodo === "ha" ? r.evaluaciones : evaluador.cuenta(), detenido: detener });
    $("#progreso-barra").style.width = "100%";
    $("#progreso-texto").textContent = `Listo en ${fmt(seg, 1)} s.`;
  } catch (err) {
    $("#progreso-texto").textContent = detener ? "Optimización detenida." : `No se pudo completar la optimización: ${err.message}`;
  } finally {
    pool?.terminar(); pool = null;
    bloquear(false);
  }
}

async function simularManual() {
  if (!estado.demanda || !recursoListo()) return;
  const cfg = $$("#manual input").map((i) => Math.max(0, Math.round(Number(i.value) || 0)));
  const { h, usarEnergia } = leerConfiabilidad();
  bloquear(true);
  try {
    pool = new Pool(1);
    await pool.init(await armarCaso(), h, usarEnergia);
    const completo = await pool.enviar(0, { tipo: "completo", cfg });
    mostrarResultados(cfg, completo.res, { metodo: "Configuración ingresada a mano", h, usarEnergia });
  } catch (err) {
    estadoTexto("#opt-estimado", `No se pudo simular: ${err.message}`, "err");
  } finally {
    pool?.terminar(); pool = null;
    bloquear(false);
  }
}

/* ---------- 7. Resultados ---------- */

function kpi(k, v, s = "", clase = "", badge = null) {
  const d = document.createElement("div"); d.className = "kpi" + (clase ? " " + clase : "");
  const a = document.createElement("div"); a.className = "k"; a.textContent = k;
  const b = document.createElement("div"); b.className = "v"; b.textContent = v;
  d.append(a, b);
  if (s) { const c = document.createElement("div"); c.className = "s"; c.textContent = s; d.appendChild(c); }
  if (badge) { const e = document.createElement("span"); e.className = "badge " + badge[1]; e.textContent = badge[0]; d.appendChild(e); }
  return d;
}
const musd = (v) => `${fmt(v / 1e6, 2)} MUSD`;
function capacidad(k, n, equipos) {
  const v = n * (k === "ht" ? equipos.ht.cap : equipos[k].pr);
  return v >= 1000 ? `${fmt(v / 1000, 2)} ${UNIDAD[k] === "kWh" ? "MWh" : "MW"}` : `${fmt(v, 1)} ${UNIDAD[k]}`;
}
function sumasDiarias(serie) {
  const out = [];
  for (let d = 0; d < serie.length / 24; d++) { let s = 0; for (let hh = 0; hh < 24; hh++) s += serie[d * 24 + hh]; out.push(s); }
  return out;
}

function mostrarResultados(cfg, r, meta) {
  const cumple = r.viol === 0, equipos = clonar(estado.equipos), arq = clonar(estado.arq), economia = leerEconomia();
  const bloquearCSV = estado.demandaTipo === "huichas" || estado.demandaTipo === "sintetica";
  $("#dl-csv").disabled = bloquearCSV;
  $("#dl-csv").title = bloquearCSV ? "La demanda de Las Huichas es de terceros: sus series horarias no se descargan." : "";
  $("#dl-csv-nota").hidden = !bloquearCSV;
  estado.resultado = { cfg, r, meta, arq, equipos, economia, demandaNombre: estado.demandaNombre, demandaTipo: estado.demandaTipo,
    recurso: estado.recurso === "tesis" ? "Serie de la tesis (Las Huichas 2018)" : estado.recurso === "era5" ? "ERA5, Las Huichas 2018" : estado.climaNombre };
  $("#resultados").hidden = false;
  $("#res-subtitulo").textContent = [meta.metodo, meta.segundos ? `${fmt(meta.segundos, 1)} s` : "", meta.simulaciones ? `${fmt(meta.simulaciones)} simulaciones` : "",
    meta.detenido ? "detenido antes de terminar" : "", nombreArquitectura(), estado.demandaNombre].filter(Boolean).join(" · ");

  $("#kpis").replaceChildren(
    kpi("LCOE", `${fmt(r.lcoe, 4)} USD/kWh`, "Costo nivelado de energía", "main"),
    kpi("Costo presente neto", musd(r.npc), `en ${economia.anios} años`),
    kpi("Inversión inicial", musd(r.capex)),
    kpi("Horas con déficit (LOLE)", `${fmt(r.lole)} h`, `permitidas: ${fmt(meta.h)} h`, "", cumple ? ["Cumple", "ok"] : ["No cumple", "err"]),
    kpi("Energía no suministrada", `${fmt(r.ens, 1)} kWh`, `${fmt((r.ens / Math.max(1e-9, r.eSum + r.ens)) * 100, 3)} % de la demanda`),
    kpi("Energía suministrada", `${fmt(r.eSum / 1000, 1)} MWh/año`, "incluye la reserva operativa"),
    kpi("Excedentes perdidos", `${fmt(r.perdida / 1000, 1)} MWh/año`, "energía que no se pudo aprovechar ni guardar"),
    kpi("Hidrógeno", `${fmt(r.h2Entra / 1000, 1)} MWh`, `guardados en el año; ${fmt(r.h2Sale / 1000, 1)} MWh extraídos`),
  );

  const aviso = $("#aviso");
  aviso.hidden = cumple;
  if (!cumple) {
    aviso.textContent = meta.metodo.includes("a mano")
      ? `Esta configuración no cumple la confiabilidad pedida: tiene ${fmt(r.lole)} horas con déficit y se permiten ${fmt(meta.h)}.`
      : `El método no encontró una configuración que cumpla la confiabilidad pedida (${fmt(meta.h)} h con déficit como máximo). Se muestra la más cercana. Prueba con más generaciones, corridas o muestras, o amplía los límites de búsqueda.`;
  }

  const ref = REF_TESIS[meta.h], box = $("#referencia");
  if (esCasoTesis() && ref && !meta.usarEnergia) {
    const dif = ((r.lcoe - ref.lcoe) / ref.lcoe) * 100;
    box.hidden = false;
    box.textContent = `Referencia del artículo para h = ${meta.h}: LCOE ${fmt(ref.lcoe, 3)} USD/kWh con el ${ref.metodo} (${ref.cfg.map((v) => fmt(v)).join(" · ")}). ` +
      `Este resultado: ${fmt(r.lcoe, 4)} USD/kWh, ${Math.abs(dif) < 0.005 ? "igual" : dif < 0 ? `${fmt(-dif, 2)} % menor` : `${fmt(dif, 2)} % mayor`}.`;
  } else box.hidden = true;

  const t = $("#tabla-equipos"); t.replaceChildren();
  const thead = t.createTHead().insertRow();
  for (const c of ["Módulo", "Cantidad", "Capacidad total", "Inversión (USD)", "Costo presente neto (USD)"]) { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); }
  const tb = t.createTBody();
  let totCi = 0, totNpc = 0;
  MODULOS.forEach((m, i) => {
    if (!cfg[i] && !moduloActivo(m)) return;
    const ci = cfg[i] * equipos[m].ci, npc = cfg[i] * r.npcU[i];
    totCi += ci; totNpc += npc;
    const row = tb.insertRow();
    row.insertCell().textContent = `${NOMBRES[m]} · ${equipos[m].nombre}`;
    row.insertCell().textContent = fmt(cfg[i]); row.insertCell().textContent = capacidad(m, cfg[i], equipos);
    row.insertCell().textContent = fmt(ci); row.insertCell().textContent = fmt(npc);
  });
  const tf = t.createTFoot().insertRow();
  tf.insertCell().textContent = "Total"; tf.insertCell(); tf.insertCell(); tf.insertCell().textContent = fmt(totCi); tf.insertCell().textContent = fmt(totNpc);

  $("#diagrama-res").innerHTML = svgDiagrama({ arq, equipos, cfg, titulo: `LCOE ${fmt(r.lcoe, 4)} USD/kWh · LOLE ${fmt(r.lole)} h · ${meta.metodo}` });

  const dias = etiquetasDias(), s = r.series;
  lineas("graf-energia", dias, [
    { label: "Demanda con reserva", data: dem.mediasDiarias(s.d), borderColor: "#1E2530" },
    { label: "Suministro", data: dem.mediasDiarias(s.sum), borderColor: "#1F5FAD", borderDash: [5, 3] },
  ], "kW");
  lineas("graf-produccion", dias, [
    ...(arq.wt ? [{ label: "Eólica", data: dem.mediasDiarias(s.wt), borderColor: "#2A9D8F" }] : []),
    ...(arq.pv ? [{ label: "Fotovoltaica", data: dem.mediasDiarias(s.pv), borderColor: "#E9A23B" }] : []),
    { label: "Demanda con reserva", data: dem.mediasDiarias(s.d), borderColor: "#1E2530", borderWidth: 1.2 },
  ], "kW");
  lineas("graf-h2", dias, [{ label: "Energía en los tanques (media diaria)", data: dem.mediasDiarias(s.str), borderColor: "#6C5CE7", backgroundColor: "rgba(108,92,231,.12)", fill: true }], "kWh");
  grafico("graf-perdidas", {
    type: "bar",
    data: { labels: dias, datasets: [
      { label: "Energía no suministrada", data: sumasDiarias(s.def).map((v) => (v > 0 ? v : null)), backgroundColor: "#C0392B" },
      { label: "Excedentes perdidos", data: sumasDiarias(s.loss).map((v) => (v > 0 ? v : null)), backgroundColor: "#8E9AAF" },
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 12 } } },
      scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { type: "logarithmic", title: { display: true, text: "kWh por día (escala logarítmica)" } } } },
  });
  grafico("graf-costos", {
    type: "doughnut",
    data: { labels: MODULOS.map((m) => NOMBRES[m]), datasets: [{ data: MODULOS.map((m, i) => cfg[i] * r.npcU[i]), backgroundColor: ["#2A9D8F", "#E9A23B", "#7F8C9D", "#3E7BD6", "#6C5CE7", "#5BC2B4"] }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: "right", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${musd(c.raw)} (${fmt((c.raw / r.npc) * 100, 1)} %)` } } } },
  });
  $("#resultados").scrollIntoView({ behavior: "smooth", block: "start" });
}

function descargarCSV() {
  const res = estado.resultado;
  if (!res || res.demandaTipo === "huichas" || res.demandaTipo === "sintetica") return;
  const s = res.r.series, filas = ["fecha_hora,demanda_con_reserva_kw,eolica_kw,fotovoltaica_kw,suministro_kw,deficit_kw,excedente_perdido_kw,h2_almacenado_kwh"];
  const base = Date.UTC(2018, 0, 1);
  for (let t = 0; t < s.d.length; t++) {
    const f = new Date(base + t * 3600e3).toISOString().slice(0, 16);
    filas.push([s.d[t], s.wt[t], s.pv[t], s.sum[t], Math.max(0, s.def[t]), s.loss[t], s.str[t]].map((v) => Number(v).toFixed(3)).join(",").replace(/^/, f + ","));
  }
  descargar(new Blob([filas.join("\n")], { type: "text/csv" }), "hres-h2_series_horarias.csv");
}
function descargarJSON() {
  const res = estado.resultado; if (!res) return;
  const { series, ...r } = res.r;
  const salida = {
    simulador: "Simulador HRES-H2", fecha: new Date().toISOString(),
    demanda: res.demandaNombre, recurso: res.recurso, arquitectura: res.arq, equipos: res.equipos, economia: res.economia,
    confiabilidad: { h: res.meta.h, limitar_energia: res.meta.usarEnergia }, metodo: res.meta.metodo, parametros: res.meta.params || null, semilla: res.meta.semilla || null,
    resultado: { cantidades: Object.fromEntries(MODULOS.map((m, i) => [m, res.cfg[i]])), lcoe_usd_kwh: r.lcoe, npc_usd: r.npc, inversion_usd: r.capex,
      lole_h: r.lole, ens_kwh: r.ens, energia_suministrada_kwh: r.eSum, excedentes_perdidos_kwh: r.perdida, h2_guardado_kwh: r.h2Entra, h2_extraido_kwh: r.h2Sale },
  };
  descargar(new Blob([JSON.stringify(salida, null, 2)], { type: "application/json" }), "hres-h2_resumen.json");
}

/* ---------- Caso de la tesis ---------- */

async function cargarCasoTesis() {
  $('input[name="demanda"][value="huichas"]').checked = true;
  $('input[name="recurso"][value="tesis"]').checked = true;
  $("#arq-wt").checked = $("#arq-pv").checked = $("#arq-hess").checked = true;
  estado.equipos = Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === TESIS_IDS[k]))]));
  $("#eco-dn").value = 8; $("#eco-ie").value = 3; $("#eco-anios").value = 20; $("#eco-reserva").value = 10;
  $("#conf-h").value = 0; $("#conf-energia").checked = false;
  estado.limitesEditados = false;
  await cambiarRecurso();
  await cargarDemanda();
  $("#paso-optimizacion").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Inicio ---------- */

function iniciar() {
  const sel = $("#metodo");
  for (const [k, m] of Object.entries(METODOS)) { const o = document.createElement("option"); o.value = k; o.textContent = m.nombre; sel.appendChild(o); }
  $("#opt-hilos").value = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  sel.addEventListener("change", renderMetodo);
  $("#opt-hilos").addEventListener("input", estimar);
  $("#preset-rapido").addEventListener("click", () => aplicarPreset("rapido"));
  $("#preset-tesis").addEventListener("click", () => aplicarPreset("tesis"));

  $$('input[name="demanda"]').forEach((r) => r.addEventListener("change", cargarDemanda));
  ["#rs-viviendas", "#rs-sur", "#sin-media", "#sin-var", "#sin-semilla", "#csv-archivo"].forEach((s) => $(s).addEventListener("change", cargarDemanda));
  $("#sin-otra").addEventListener("click", () => { $("#sin-semilla").value = Math.round(num("#sin-semilla")) + 1; cargarDemanda(); });
  $$('input[name="recurso"]').forEach((r) => r.addEventListener("change", cambiarRecurso));
  $("#ub-cargar").addEventListener("click", cargarUbicacion);
  ["#arq-wt", "#arq-pv", "#arq-hess"].forEach((s) => $(s).addEventListener("change", () => { cambiosGenerales(); renderEquipos(); }));
  ["#eco-dn", "#eco-ie", "#eco-anios", "#eco-reserva", "#conf-h", "#conf-energia"].forEach((s) => $(s).addEventListener("change", cambiosGenerales));
  $("#limites-auto").addEventListener("click", () => { estado.limitesEditados = false; renderLimites(); });
  $("#btn-optimizar").addEventListener("click", optimizar);
  $("#btn-detener").addEventListener("click", () => { detener = true; if ($("#metodo").value === "ha") pool?.terminar(); });
  $("#btn-manual").addEventListener("click", simularManual);
  $("#btn-tesis").addEventListener("click", cargarCasoTesis);
  $$("[data-descargar]").forEach((b) => b.addEventListener("click", () => {
    const svg = svgDiagrama({ arq: estado.arq, equipos: estado.equipos, titulo: `Arquitectura ${nombreArquitectura()}` });
    if (b.dataset.descargar === "svg") descargarSVG(svg, `diagrama_${nombreArquitectura()}.svg`); else descargarPNG(svg, `diagrama_${nombreArquitectura()}.png`);
  }));
  $$("[data-descargar-res]").forEach((b) => b.addEventListener("click", () => {
    const res = estado.resultado; if (!res) return;
    const svg = svgDiagrama({ arq: res.arq, equipos: res.equipos, cfg: res.cfg, titulo: `LCOE ${fmt(res.r.lcoe, 4)} USD/kWh · LOLE ${fmt(res.r.lole)} h · ${res.meta.metodo}` });
    if (b.dataset.descargarRes === "svg") descargarSVG(svg, "diagrama_resultado.svg"); else descargarPNG(svg, "diagrama_resultado.png");
  }));
  $("#dl-csv").addEventListener("click", descargarCSV);
  $("#dl-json").addEventListener("click", descargarJSON);

  renderEquipos(); renderMetodo();
  cambiarRecurso().then(cargarDemanda);
}

iniciar();
