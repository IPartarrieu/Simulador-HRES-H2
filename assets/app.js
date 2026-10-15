// Página del Simulador HRES-H2: arma el caso con lo que elige la persona, reparte las simulaciones entre
// Web Workers, ejecuta el método de optimización (uno o varios objetivos) y muestra los resultados.
import { CATALOGO, MODULOS, NOMBRES, ECONOMIA_TESIS, FUENTES, OBJETIVOS_MO, potenciaPV, potenciaWT, limitesPorDefecto, flujoCaja, crf, tasaReal } from "./model.js?v=20261015f";
import { monteCarlo, genetico, shade, pso, gwo, woa, eo, nsga2, mopso, aptitud, PENALIZACION } from "./optimizers.js?v=20261015f";
import * as dem from "./demand.js?v=20261015f";
import { svgDiagrama, svgLayout, descargarSVG, descargarPNG, descargar } from "./diagram.js?v=20261015f";
import * as zona from "./zona.js?v=20261015f";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TESIS_MODULOS = ["wt", "pv", "con", "ele", "ht", "fc"];
const TESIS_IDS = { wt: "gaia133", pv: "cs6u330", con: "conv1", ele: "pem3", ht: "tank03", fc: "pemfc3" };
const DEFECTO_IDS = { ...TESIS_IDS, bat: "lfp1", dg: "dg50" };
const ABREV = { wt: "WT", pv: "PV", con: "Conv", ele: "Ele", ht: "Tanq", fc: "FC", bat: "Bat", dg: "DG" };
const MANUAL_DEFECTO = [5, 20000, 150, 200, 10000, 60, 300, 2];
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
  wt: [["pr", "Potencia nominal (kW)"], ["vcin", "V. de arranque (m/s)"], ["vr", "V. nominal (m/s)"], ["vcout", "V. de corte (m/s)"], ["hub", "Altura del buje (m)"], ["rotor", "Diámetro del rotor (m)"], ...COSTOS],
  pv: [["pr", "Potencia nominal (kW)"], ["eff", "Eficiencia (%)"], ["alfa", "Coef. de temperatura (%/°C)"], ["noct", "NOCT (°C)"], ["fpv", "Factor de reducción"], ...COSTOS],
  con: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
  ele: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
  ht: [["cap", "Capacidad (kWh)"], ...COSTOS],
  fc: [["pr", "Potencia (kW)"], ["eta", "Eficiencia (0 a 1)"], ...COSTOS],
  bat: [["cap", "Capacidad (kWh)"], ["etaC", "Eficiencia de carga (0 a 1)"], ["etaD", "Eficiencia de descarga (0 a 1)"], ["socMin", "Estado de carga mínimo (0 a 1)"],
    ["cRate", "Potencia máx. por kWh (tasa C)"], ["autod", "Autodescarga por hora (0 a 1)"], ["ciclos", "Ciclos equivalentes de vida"], ...COSTOS],
  dg: [["pr", "Potencia nominal (kW)"], ["a", "Consumo a (L/kWh)"], ["b", "Consumo b (L/kWh nominal)"], ["cargaMin", "Carga mínima (0 a 1)"],
    ["omKwh", "O&M (USD por kWh generado)"], ["vidaH", "Vida (horas de operación)"], ["ci", "Inversión (USD)"], ["rep", "Reemplazo (USD)"], ["vu", "Vida máxima (años)"]],
};
const FISICOS = { wt: ["pr", "vcin", "vr", "vcout", "hub"], pv: ["pr", "eff", "alfa", "noct", "fpv"] };
const POSITIVOS = ["rotor", "pr", "cap", "eta", "eff", "etaC", "etaD", "cRate", "ciclos", "vidaH", "fpv"];
const HASTA_UNO = ["eta", "etaC", "etaD", "socMin", "cargaMin", "fpv", "autod"];
const UNIDAD = { wt: "kW", pv: "kW", con: "kW", ele: "kW", ht: "kWh", fc: "kW", bat: "kWh", dg: "kW" };
const COLORES = { wt: "#2A9D8F", pv: "#E9A23B", con: "#7F8C9D", ele: "#3E7BD6", ht: "#6C5CE7", fc: "#5BC2B4", bat: "#3FAE6A", dg: "#B5651D" };

const poblacional = (nombre) => [["poblacion", nombre, 50], ["generaciones", "Iteraciones", 200]];
const METODOS = {
  shade: {
    nombre: "Evolución diferencial adaptativa (SHADE) · recomendado",
    desc: "Adapta sus parámetros, usa reglas de factibilidad y termina con una búsqueda local entera. Fue el más estable en las pruebas con el caso de ejemplo.",
    params: [["poblacion", "Población", 60], ["generaciones", "Generaciones", 200]],
    rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: shade,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  pso: {
    nombre: "Enjambre de partículas (PSO)",
    desc: "Cada partícula se mueve según su mejor posición y la mejor del enjambre, con inercia decreciente. Es el método más usado en la literatura de sistemas híbridos.",
    params: poblacional("Partículas"), rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: pso,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  eo: {
    nombre: "Optimizador de equilibrio (EO)",
    desc: "Inspirado en el balance de masa: las partículas se acercan a un «equilibrio» elegido entre las mejores. Superó a GWO y otros tres métodos en Kharrich et al. (2021).",
    params: poblacional("Partículas"), rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: eo,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  gwo: {
    nombre: "Lobo gris (GWO)",
    desc: "Los lobos siguen a los tres mejores de la manada (alfa, beta y delta), pasando de explorar a explotar a lo largo de las iteraciones.",
    params: poblacional("Lobos"), rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: gwo,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  woa: {
    nombre: "Algoritmo de la ballena (WOA)",
    desc: "Cerco de la presa y ataque en espiral. Fue el mejor de cuatro métodos en Diab et al. (2019), pero en el caso de ejemplo sus resultados varían más entre corridas.",
    params: poblacional("Ballenas"), rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: woa,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  ga: {
    nombre: "Algoritmo genético",
    desc: "Al estilo de DEAP: torneo de 3, cruce en dos puntos y mutación entera uniforme. Las soluciones que no cumplen la confiabilidad se penalizan.",
    params: [["poblacion", "Población", 100], ["generaciones", "Generaciones", 150], ["cxpb", "Prob. de cruce", 0.7], ["mutpb", "Prob. de mutación", 0.2], ["indpb", "Prob. por gen", 0.2]],
    rapido: { poblacion: 80, generaciones: 80 }, tesis: { poblacion: 500, generaciones: 1000 }, fn: genetico,
    evals: (p) => Math.round(p.poblacion * (1 + 0.8 * p.generaciones)),
  },
  ha: {
    nombre: "Algoritmo híbrido CS-HS-SA",
    desc: "Búsqueda caótica, armónica y recocido simulado (Zhang et al.), en corridas independientes. Se queda con la mejor corrida.",
    params: [["corridas", "Corridas", 40], ["iteraciones", "Iteraciones por corrida", 1000], ["hmcr", "HMCR", 0.9], ["parMin", "PAR mínimo", 0.1], ["parMax", "PAR máximo", 1.0], ["t0", "Temperatura inicial", 1000], ["s", "Enfriamiento", 0.97]],
    rapido: { corridas: 16, iteraciones: 1000 }, tesis: { corridas: 500, iteraciones: 1000 },
    evals: (p) => p.corridas * (p.iteraciones + 5),
  },
  mc: {
    nombre: "Monte Carlo",
    desc: "Prueba configuraciones al azar dentro de los límites y se queda con la mejor que cumple la confiabilidad.",
    params: [["muestras", "Muestras", 50000]],
    rapido: { muestras: 20000 }, tesis: { muestras: 500000 },
    evals: (p) => p.muestras,
  },
  nsga2: {
    nombre: "NSGA-II · recomendado", mo: true,
    desc: "Algoritmo genético multiobjetivo de Deb et al. (2002): ordena por frentes de no dominancia, mantiene la diversidad con la distancia de apiñamiento y conserva a los mejores (elitismo).",
    params: [["poblacion", "Población", 100], ["generaciones", "Generaciones", 200]],
    rapido: { poblacion: 60, generaciones: 80 }, tesis: null, fn: nsga2,
    evals: (p) => p.poblacion * (p.generaciones + 1),
  },
  mopso: {
    nombre: "Enjambre de partículas multiobjetivo (MOPSO)", mo: true,
    desc: "Guarda las soluciones no dominadas en un archivo y guía a cada partícula hacia las zonas menos pobladas del frente (Coello et al., 2004).",
    params: [["poblacion", "Partículas", 80], ["generaciones", "Iteraciones", 200], ["archivoMax", "Tamaño del archivo", 100]],
    rapido: { poblacion: 50, generaciones: 80 }, tesis: null, fn: mopso,
    evals: (p) => p.poblacion * (p.generaciones + 1),
  },
};

const estado = {
  demanda: null, demandaNombre: "", demandaTipo: "ejemplo",
  recurso: "tesis", clima: null, climaNombre: "",
  arq: { wt: true, pv: true, hess: true, bat: false, dg: false },
  equipos: Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === DEFECTO_IDS[k]))])),
  limites: null, limitesEditados: false,
  resultado: null, pareto: null, corriendo: false,
  zona: null,           // { pts, area (m²), centro, elev }
};
let mapaZona = null, mapaLayout = null, vista3d = null, turno3d = 0;
const cacheLayout = {}, cacheEstela = {}, cacheSombra = {};
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
const musd = (v) => `${fmt(v / 1e6, 2)} MUSD`;

/* ---------- 1. Demanda ---------- */

async function cargarDemanda() {
  const tipo = radio("demanda");
  estado.demandaTipo = tipo;
  $$("#paso-demanda .subopts").forEach((el) => { el.hidden = el.dataset.para !== tipo; });
  try {
    let r = null;
    if (tipo === "ejemplo") r = await dem.demandaEjemplo();
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

const RECURSO_CON_CLIMA = ["estacion", "ubicacion", "csv"];
function recursoListo() { return !RECURSO_CON_CLIMA.includes(estado.recurso) || !!estado.clima; }

async function climaActual() {
  if (estado.recurso === "era5") return (await dem.datosEjemplo()).era5;
  return estado.clima;
}
function nombreRecurso() {
  if (estado.recurso === "tesis") return "Series de ejemplo lat. 45°S (2018)";
  if (estado.recurso === "era5") return "ERA5 de ejemplo lat. 45°S (2018)";
  return estado.climaNombre;
}

// Potencia horaria de UNA unidad de aerogenerador y de panel, según el recurso elegido.
async function seriesUnidad() {
  if (estado.recurso === "tesis") { const d = await dem.datosEjemplo(); return { wt: Float64Array.from(d.tesis.wt_kw), pv: Float64Array.from(d.tesis.pv_kw) }; }
  const c = await climaActual();
  return { wt: potenciaWT(estado.equipos.wt, c.v10_ms, c.v100_ms, c.temp_c, c.presion_hpa), pv: potenciaPV(estado.equipos.pv, c.gti_wm2, c.temp_c) };
}

async function cambiarRecurso() {
  estado.recurso = radio("recurso");
  $$("#paso-recurso .subopts").forEach((el) => { el.hidden = el.dataset.para !== estado.recurso; });
  if (estado.recurso === "tesis") {
    for (const k of ["wt", "pv"]) if (estado.equipos[k].id !== TESIS_IDS[k]) estado.equipos[k] = clonar(CATALOGO[k].find((d) => d.id === TESIS_IDS[k]));
  }
  if (RECURSO_CON_CLIMA.includes(estado.recurso)) estado.clima = null;
  renderEquipos();
  if (estado.recurso === "estacion") await cargarEstacion();
  else if (estado.recurso === "csv" && $("#rec-archivo").files[0]) await cargarRecursoCSV();
  else await describirRecurso();
  cambiosGenerales();
}

// El eje del viento de la distribución se toma del recurso cuando este lo trae.
async function describirRecurso() {
  if (!recursoListo()) {
    const falta = { ubicacion: "Ingresa la ubicación y el año, y descarga el clima.", csv: "Elige un archivo con tus series horarias.", estacion: "Cargando la serie…" };
    estadoTexto("#recurso-estado", falta[estado.recurso], "warn"); renderDistribucion(); return;
  }
  const s = await seriesUnidad();
  const c = estado.recurso === "tesis" ? (await dem.datosEjemplo()).era5 : await climaActual();
  if (c && Number.isFinite(c.eje_viento)) {
    $("#lay-eje").value = c.eje_viento;
    $("#lay-eje-nota").textContent = `Eje tomado del recurso (${nombreRecurso()}): ${c.eje_viento}°, con ${fmt(c.concentracion_viento * 100)} % de concentración de la energía del viento en ese eje.`;
  } else $("#lay-eje-nota").textContent = "Tu recurso no trae la dirección del viento: ingresa el eje dominante a mano (0° = norte-sur, 90° = este-oeste).";
  const fp = (serie, pr) => (serie.reduce((a, b) => a + Math.min(b, pr), 0) / serie.length / pr) * 100;
  estadoTexto("#recurso-estado", `${nombreRecurso()}. Factor de planta con los equipos elegidos: aerogenerador ${fmt(fp(s.wt, estado.equipos.wt.pr), 1)} %, panel ${fmt(fp(s.pv, estado.equipos.pv.pr), 1)} %.`, "ok");
  renderDistribucion();
}

async function cargarUbicacion() {
  const lat = num("#ub-lat"), lon = num("#ub-lon"), anio = Math.round(num("#ub-anio"));
  if (!zona.enRegion([lat, lon])) { estadoTexto("#recurso-estado", "El punto debe estar en la región de prueba: latitud −39,7 a −34,6 y longitud −74 a −70,3.", "err"); return; }
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

async function cargarEstacion() {
  try {
    const r = await dem.climaEstacion($("#est-id").value);
    estado.clima = r.clima; estado.climaNombre = r.nombre;
    await describirRecurso();
  } catch (err) {
    estado.clima = null;
    estadoTexto("#recurso-estado", `No se pudo cargar la serie: ${err.message}`, "err");
  }
  cambiosGenerales();
}

async function cargarRecursoCSV() {
  const f = $("#rec-archivo").files[0];
  if (!f) return;
  try {
    const r = dem.climaCSV(await f.text(), f.name, estado.zona?.elev?.media || 0);
    estado.clima = r.clima; estado.climaNombre = `Series propias · ${r.nombre}`;
    await describirRecurso();
  } catch (err) {
    estado.clima = null;
    estadoTexto("#recurso-estado", err.message, "err");
  }
  cambiosGenerales();
}

/* ---------- 3 y 4. Arquitectura y equipos ---------- */

function moduloActivo(k, arq = estado.arq) {
  if (k === "wt") return arq.wt;
  if (k === "pv") return arq.pv;
  if (k === "con") return arq.pv || arq.hess || arq.bat;
  if (k === "bat") return arq.bat;
  if (k === "dg") return arq.dg;
  return arq.hess;
}

function fuenteEquipo(eq) {
  const f = FUENTES[eq.fuente];
  if (!f) return null;
  const p = document.createElement("p"); p.className = "fuente";
  p.append("Fuente: ");
  if (f.url) {
    const a = document.createElement("a"); a.href = f.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = f.texto;
    p.appendChild(a);
  } else p.append(f.texto);
  return p;
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
    const fuente = fuenteEquipo(eq); if (fuente) div.appendChild(fuente);
    if (bloqueado) { const p = document.createElement("p"); p.className = "nota"; p.textContent = "Las series de ejemplo corresponden a este equipo. Para comparar marcas, usa un clima ERA5 o tus propias series."; div.appendChild(p); }
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
        const invalido = !Number.isFinite(v) || v < minimo || (POSITIVOS.includes(campo) && v <= 0) ||
          (HASTA_UNO.includes(campo) && v > 1) || ((campo === "socMin" || campo === "autod") && v >= 1);
        if (invalido) { inp.value = eq[campo]; return; }
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

/* ---------- Zona y distribución ---------- */

function iniciarZona() {
  if (typeof L === "undefined") { estadoTexto("#zona-estado", "No se pudo cargar el mapa.", "err"); return; }
  const botones = (dibujando, n) => {
    $("#zona-cerrar").disabled = !dibujando || n < 3; $("#zona-deshacer").disabled = !dibujando || !n;
    if (dibujando) estadoTexto("#zona-estado", n < 3 ? `Marca al menos 3 vértices (${n} por ahora).` : `${n} vértices. Cierra el polígono para calcular la zona.`);
  };
  mapaZona = zona.crearMapa($("#mapa"), { alCerrar: cerrarZona, alAviso: (t) => estadoTexto("#zona-estado", t, "warn"), alCambiarModo: botones });
  $("#zona-dibujar").addEventListener("click", () => mapaZona.dibujar());
  $("#zona-cerrar").addEventListener("click", () => mapaZona.cerrar());
  $("#zona-deshacer").addEventListener("click", () => mapaZona.deshacer());
  $("#zona-borrar").addEventListener("click", () => mapaZona.borrar());
}

async function cerrarZona(pts) {
  $("#zona-kpis").replaceChildren();
  estado.zona = null;
  if (!pts) { estadoTexto("#zona-estado", "Aún no hay una zona dibujada."); actualizarZona(); return; }
  const area = zona.areaM2(pts), km2 = area / 1e6;
  if (km2 > zona.AREA_MAX_KM2) {
    mapaZona.marcar(false);
    estadoTexto("#zona-estado", `La zona mide ${fmt(km2, 1)} km² y el máximo es ${zona.AREA_MAX_KM2} km². Dibuja un terreno más acotado.`, "err");
    actualizarZona(); return;
  }
  const c = zona.centro(pts);
  const cercana = dem.ESTACIONES.map((e) => ({ ...e, km: zona.distanciaKm(c, [e.lat, e.lon]) })).sort((a, b) => a.km - b.km)[0];
  estado.zona = { pts, area, centro: c, elev: null, cercana };
  $("#est-id").value = cercana.id;
  $("#ub-lat").value = c[0].toFixed(3); $("#ub-lon").value = c[1].toFixed(3);
  estadoTexto("#zona-estado", "Consultando la elevación del terreno…");
  pintarZona(); actualizarZona();
  try {
    estado.zona.elev = await zona.elevacion(pts);
    estadoTexto("#zona-estado", `Zona lista. Para usar su clima, elige en «Recurso» la serie prealmacenada (la más cercana es ${cercana.nombre}, a ${fmt(cercana.km)} km) o «ERA5 en tu zona».`, "ok");
  } catch (err) {
    estadoTexto("#zona-estado", `Zona lista, pero no se pudo obtener la elevación: ${err.message}`, "warn");
  }
  if (estado.zona?.pts === pts) pintarZona();
}

function pintarZona() {
  const z = estado.zona; if (!z) return;
  const e = z.elev;
  $("#zona-kpis").replaceChildren(
    kpi("Superficie", z.area >= 1e6 ? `${fmt(z.area / 1e6, 2)} km²` : `${fmt(z.area / 1e4, 1)} ha`, `${fmt(z.area)} m²`),
    kpi("Elevación media", e ? `${fmt(e.media)} m s.n.m.` : "…", e ? `mín. ${fmt(e.min)} m · máx. ${fmt(e.max)} m (${e.n} puntos)` : "Copernicus DEM"),
    kpi("Centro", `${fmt(-z.centro[0], 3)}° S`, `${fmt(-z.centro[1], 3)}° O`),
    kpi("Serie más cercana", z.cercana.nombre.split(" (")[0], `a ${fmt(z.cercana.km)} km`));
}

function actualizarZona() {
  if (estado.recurso === "estacion") cargarEstacion();
  renderDistribucion(); cambiosGenerales();
}

// Cuántos aerogeneradores y paneles caben en la zona, y el terreno que ocupa cada uno.
function distribucion() {
  const z = estado.zona;
  if (!z) return null;
  const wt = estado.equipos.wt, pv = estado.equipos.pv;
  const op = { D: wt.rotor, sx: Math.max(1, num("#lay-sx")), sy: Math.max(1, num("#lay-sy")), retiro: Math.max(0, num("#lay-retiro")) * (wt.hub + wt.rotor / 2), eje: num("#lay-eje") };
  const clave = JSON.stringify([z.pts, op]);                     // la grilla se recalcula solo si cambia algo
  Object.assign(op, { compartir: $("#lay-compartir").checked, libre: Math.max(0.5, num("#lay-libre")) });
  if (cacheLayout.clave !== clave) Object.assign(cacheLayout, { clave, lay: zona.distribuirAerogeneradores(z.pts, op) });
  const lay = cacheLayout.lay;
  const paneles = zona.distribucionPaneles(z.centro[0], { areaPanelM2: pv.pr / (pv.eff / 100), aprovechamiento: Math.min(1, Math.max(0.1, num("#lay-aprov") / 100)) });
  const estela = cacheEstela.lay === lay && cacheEstela.wt === JSON.stringify(wt) && cacheEstela.fuente === fuenteViento() ? cacheEstela.val : null;
  return {
    ...lay, paneles, op, estela, posiciones: estela ? estela.orden : lay.posiciones,
    nWt: lay.demasiadas ? Math.floor(z.area / lay.celdaM2) : lay.posiciones.length,
    nPv: Math.floor(z.area / paneles.m2PorPanel),
  };
}
// Estelas del parque con la grilla actual y el viento del recurso (se recalcula solo si cambia algo).
const fuenteViento = () => (estado.recurso === "tesis" || estado.recurso === "era5" ? estado.recurso : estado.clima);
async function estelaActual(d) {
  if (!d || d.demasiadas || !d.posiciones.length || !estado.arq.wt) return null;
  const clima = estado.recurso === "tesis" ? (await dem.datosEjemplo()).era5 : await climaActual();
  if (!clima) return null;
  const lay = cacheLayout.lay, wt = JSON.stringify(estado.equipos.wt);
  if (cacheEstela.lay !== lay || cacheEstela.wt !== wt || cacheEstela.fuente !== fuenteViento()) {
    const val = zona.estelaParque(estado.zona.pts, lay.posiciones, { D: d.op.D, wt: estado.equipos.wt, clima, eje: d.op.eje });
    Object.assign(cacheEstela, { lay, wt, fuente: fuenteViento(), val });
  }
  return cacheEstela.val;
}

function terreno() {
  const d = $("#lay-usar").checked ? distribucion() : null;
  return d ? { area: estado.zona.area, aWt: estado.arq.wt ? zona.areaExclusiva(d.op) : 0, aPv: estado.arq.pv ? d.paneles.m2PorPanel : 0, nWt: d.nWt, nPv: d.nPv } : null;
}

function renderDistribucion() {
  const d = distribucion();
  $("#lay-sin-zona").hidden = !!d; $("#lay-contenido").hidden = !d;
  if (!d) return;
  const wt = estado.equipos.wt, pv = estado.equipos.pv, z = estado.zona;
  const r = estado.resultado;
  const usados = r && r.zona === z ? r.cfg[0] : 0;
  if (!mapaLayout && typeof L !== "undefined" && !$("#panel-equipos").hidden) mapaLayout = zona.mapaDistribucion($("#mapa-layout"));
  mapaLayout?.pintar(z.pts, d.posiciones, usados, wt.rotor / 2);
  const p = d.paneles, e = d.estela;
  if (!e && estado.arq.wt) estelaActual(d).then((x) => x && renderDistribucion()).catch((err) => console.error(err));
  const efic = e && [1, 5, 10, 25, e.nMax].filter((n, i, a) => n <= e.nMax && a.indexOf(n) === i)
    .map((n) => `${n} → ${fmt(zona.eficienciaParque(e, n) * 100, 1)} %`).join(" · ");
  $("#lay-kpis").replaceChildren(
    kpi("Aerogeneradores que caben", fmt(d.nWt), `${fmt(d.nWt * wt.pr)} kW · celda de ${fmt(d.celdaM2)} m² c/u${d.demasiadas ? " (estimado, demasiados para dibujar)" : ""}`),
    kpi("Paneles que caben", fmt(d.nPv), `${fmt((d.nPv * pv.pr) / 1000, 2)} MW · ${fmt(p.m2PorPanel, 1)} m² por panel`),
    kpi("Filas de paneles", `${fmt(p.beta)}° de inclinación`, `ocupación ${fmt(p.gcr * 100)} % (GCR); sin sombra de 10 a 14 h en junio (perfil ${fmt(p.alfa, 1)}°); pérdida anual por sombra entre filas ${fmt(p.sombra * 100, 1)} %`),
    ...(e ? [kpi("Eficiencia del parque (estelas)", `${fmt(zona.eficienciaParque(e, Math.min(10, e.nMax)) * 100, 1)} % con ${fmt(Math.min(10, e.nMax))}`, `aerogeneradores → energía respecto de sin estelas: ${efic}${e.conDireccion ? "" : " (rosa estimada con el eje dominante)"}`)] : []));
}

function renderDiagrama() {
  $("#diagrama").innerHTML = svgDiagrama({ arq: estado.arq, equipos: estado.equipos });   // SVG armado por el propio sitio (textos escapados)
}

function nombreArquitectura(arq = estado.arq) {
  const p = [];
  if (arq.pv) p.push("PV");
  if (arq.wt) p.push("WT");
  if (arq.hess) p.push("HESS");
  if (arq.bat) p.push("BESS");
  if (arq.dg) p.push("DG");
  return p.join("-") || "sin generación";
}

/* ---------- 5. Criterios ---------- */

function leerEconomia() {
  return { dn: num("#eco-dn") / 100, ie: num("#eco-ie") / 100, anios: Math.min(50, Math.max(1, Math.round(num("#eco-anios")))),
    reserva: Math.max(0, num("#eco-reserva")) / 100, diesel: Math.max(0, num("#eco-diesel")) };
}
function objetivosMO() { return $$("#obj-mo input:checked").map((i) => i.value); }
function leerCriterio() {
  const tipo = $("#conf-tipo").value, modo = radio("modo");
  return {
    tipo, modo, h: Math.max(0, Math.round(num("#conf-h"))), usarEnergia: tipo === "lole" && $("#conf-energia").checked,
    lpspMax: Math.min(1, Math.max(0, num("#conf-lpsp") / 100)),
    objetivo: modo === "uno" ? $("#obj-unico").value : "lcoe",
    pen: { excedentes: Math.max(0, num("#pen-exc")), h2: Math.max(0, num("#pen-h2")) },
    mo: modo === "mo" ? objetivosMO() : [],
  };
}
const hayPenalizacion = (c) => c.pen.excedentes > 0 || c.pen.h2 > 0;
function textoConfiabilidad(c) { return c.tipo === "lpsp" ? `LPSP ≤ ${fmt(c.lpspMax * 100, 2)} %` : `LOLE ≤ ${fmt(c.h)} h${c.usarEnergia ? " y energía no suministrada ≤ h × demanda media" : ""}`; }
function nombreObjetivo(c) {
  const base = { lcoe: "LCOE", npc: "costo presente neto", capex: "inversión inicial" }[c.objetivo];
  return hayPenalizacion(c) ? `${base} con penalizaciones` : base;
}
function valorObjetivo(c, v) { return c.objetivo === "lcoe" ? `${fmt(v, 4)} USD/kWh` : musd(v); }

function renderCriterios() {
  const c = leerCriterio();
  $$("[data-conf]").forEach((el) => { el.hidden = el.dataset.conf !== c.tipo; });
  $$("[data-modo]").forEach((el) => { el.hidden = el.dataset.modo !== c.modo; });
  const sel = $("#metodo"), previo = sel.value;
  if (sel.dataset.modo !== c.modo) {
    const lista = Object.entries(METODOS).filter(([, m]) => !!m.mo === (c.modo === "mo"));
    sel.replaceChildren();
    for (const [k, m] of lista) { const o = document.createElement("option"); o.value = k; o.textContent = m.nombre; sel.appendChild(o); }
    sel.value = lista.some(([k]) => k === previo) ? previo : lista[0][0];
    sel.dataset.modo = c.modo;
    renderMetodo();
  }
  $("#opt-sub").textContent = c.modo === "mo"
    ? `Busca el frente de Pareto entre ${c.mo.map((k) => OBJETIVOS_MO[k].nombre).join(", ") || "los objetivos elegidos"}, con ${textoConfiabilidad(c)}.`
    : `Busca la cantidad de equipos de cada módulo que minimiza ${c.objetivo === "capex" ? "la" : "el"} ${nombreObjetivo(c)}, con ${textoConfiabilidad(c)}.`;
}

function esCasoTesis() {
  const e = leerEconomia(), a = estado.arq;
  return estado.demandaTipo === "ejemplo" && estado.recurso === "tesis" && a.wt && a.pv && a.hess && !a.bat && !a.dg &&
    TESIS_MODULOS.every((k) => estado.equipos[k].id === TESIS_IDS[k] && !estado.equipos[k].nombre.includes("(editado)")) &&
    Math.abs(e.dn - ECONOMIA_TESIS.dn) < 1e-9 && Math.abs(e.ie - ECONOMIA_TESIS.ie) < 1e-9 && e.anios === ECONOMIA_TESIS.anios && Math.abs(e.reserva - ECONOMIA_TESIS.reserva) < 1e-9;
}

/* ---------- 6. Optimización ---------- */

function renderMetodo() {
  const m = METODOS[$("#metodo").value];
  if (!m) return;
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
  for (const k of ["poblacion", "generaciones", "corridas", "iteraciones", "muestras", "archivoMax"]) if (k in p) p[k] = Math.max(k === "poblacion" ? 4 : 1, Math.round(p[k]));
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
  const m = METODOS[$("#metodo").value];
  if (!m) return;
  const c = leerCriterio();
  if (c.modo === "mo" && (c.mo.length < 2 || c.mo.length > 4)) { estadoTexto("#opt-estimado", "Elige de 2 a 4 objetivos para el frente de Pareto (paso 5).", "err"); return; }
  const n = m.evals(leerParams());
  const seg = n / (7000 * hilos());
  const t = seg < 90 ? `${Math.max(1, Math.round(seg))} s` : seg < 5400 ? `${Math.round(seg / 60)} min` : `${fmt(seg / 3600, 1)} h`;
  estadoTexto("#opt-estimado", `≈ ${fmt(n)} simulaciones anuales · tiempo estimado ≈ ${t} con ${hilos()} hilos (depende de tu computador).`, seg > 900 ? "warn" : "");
}

// Límites: se calculan con la demanda y los equipos; la persona puede editarlos.
function limitesAutomaticos() {
  if (!estado.demanda) return null;
  const e = leerEconomia();
  let maxD = 0; for (const v of estado.demanda) if (v > maxD) maxD = v;
  const q = estado.equipos;
  const caso = { maxD: maxD * (1 + e.reserva), wtPr: q.wt.pr, pvPr: q.pv.pr, con: q.con, ele: q.ele, ht: q.ht, fc: q.fc, bat: q.bat, dg: q.dg };
  const lim = limitesPorDefecto(caso, estado.arq, esCasoTesis());
  const t = terreno();
  if (t) { lim[0][1] = Math.min(lim[0][1], t.nWt); lim[1][1] = Math.min(lim[1][1], t.nPv); }
  return lim;
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
  const base = estado.resultado?.cfg || (esCasoTesis() ? REF_TESIS[0].cfg : MANUAL_DEFECTO);
  MODULOS.forEach((k, i) => {
    const lab = document.createElement("label"); lab.textContent = NOMBRES[k];
    const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.dataset.k = k;
    inp.value = moduloActivo(k) ? (previos[k] && previos[k] !== "0" ? previos[k] : base[i] || MANUAL_DEFECTO[i]) : 0;
    inp.disabled = !moduloActivo(k) || estado.corriendo;
    lab.appendChild(inp); cont.appendChild(lab);
  });
}

function cambiosGenerales() {
  estado.arq = { wt: $("#arq-wt").checked, pv: $("#arq-pv").checked, hess: $("#arq-hess").checked, bat: $("#arq-bat").checked, dg: $("#arq-dg").checked };
  const valida = estado.arq.wt || estado.arq.pv || estado.arq.dg;
  estadoTexto("#arq-estado", valida ? `Arquitectura ${nombreArquitectura()}.` : "Elige al menos una fuente de generación: aerogeneradores, paneles o diésel.", valida ? "" : "err");
  renderCriterios(); renderDiagrama(); renderLimites(); renderManual(); estimar();
  const c = leerCriterio();
  const moValido = c.modo !== "mo" || (c.mo.length >= 2 && c.mo.length <= 4);
  const listo = !estado.corriendo && valida && !!estado.demanda && recursoListo();
  $("#btn-optimizar").disabled = !listo || !moValido;
  $("#btn-manual").disabled = !listo;
}

/* ---------- Hilos de cálculo ---------- */

class Pool {
  constructor(n) {
    this.pend = new Map(); this.id = 0;
    this.workers = Array.from({ length: n }, () => {
      const w = new Worker(new URL("./worker.js?v=20261015f", import.meta.url), { type: "module" });
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
  init(caso, crit) { return Promise.all(this.workers.map((_, i) => this.enviar(i, { tipo: "init", caso, crit }))); }
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
  const t = terreno(), d = t && distribucion();
  const est = d && (await estelaActual(d));
  const fPv = d ? 1 - d.paneles.sombra : 1;                     // sombra entre filas
  let sombraWt = null;                                          // sombra de los aerogeneradores sobre los paneles
  if (est && estado.arq.pv) {
    const op = { ...d.op, hub: estado.equipos.wt.hub, beta: d.paneles.beta, nMax: est.nMax }, clave = JSON.stringify([op, estado.zona.pts]);
    if (cacheSombra.orden !== d.posiciones || cacheSombra.clave !== clave) Object.assign(cacheSombra, { orden: d.posiciones, clave, val: zona.interaccionPV(estado.zona.pts, d.posiciones, op) });
    sombraWt = { ...cacheSombra.val, m2Panel: d.paneles.m2PorPanel };
  }
  return { demanda: Array.from(estado.demanda), wtKw: Array.from(s.wt), pvKw: Array.from(s.pv, (x) => x * fPv), equipos: clonar(estado.equipos), economia: leerEconomia(),
    terreno: t && { area: t.area, aWt: t.aWt, aPv: t.aPv }, estela: est && { eta: est.eta, sec: est.sec, S: est.S, nMax: est.nMax }, sombraWt };
}

let ultimoGrafico = 0;
function mostrarProgreso(p, t0, evaluador, crit) {
  $("#progreso-barra").style.width = `${Math.round(Math.min(1, p.fraccion) * 100)}%`;
  const evals = p.evaluaciones ?? (evaluador ? evaluador.cuenta() : 0);
  const avance = p.frente ? `${fmt(p.frente.length)} soluciones en el frente`
    : p.mejor && p.mejor.viol === 0 ? `mejor ${nombreObjetivo(crit)}: ${valorObjetivo(crit, p.mejor.obj)}` : "aún sin una configuración que cumpla la confiabilidad";
  $("#progreso-texto").textContent = `${p.etiqueta.split(" · ")[0]} · ${avance} · ${fmt(evals)} simulaciones · ${fmt((performance.now() - t0) / 1000, 1)} s`;
  const ahora = performance.now();
  if (ahora - ultimoGrafico < 250 && p.fraccion < 1) return;
  ultimoGrafico = ahora;
  if (p.frente) {
    $("#conv-vacio").hidden = p.frente.length > 0;
    const [a, b] = crit.mo.map((k) => OBJETIVOS_MO[k]);
    grafico("graf-convergencia", {
      type: "scatter",
      data: { datasets: [{ label: "Frente de Pareto actual", data: p.frente.map((e) => ({ x: e.objs[0], y: e.objs[1] })), backgroundColor: "#1F5FAD", pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: `${a.nombre} (${a.unidad})` } }, y: { title: { display: true, text: `${b.nombre} (${b.unidad})` } } } },
    });
    return;
  }
  const datos = p.historial.map((v) => (v < PENALIZACION ? v : null));
  $("#conv-vacio").hidden = datos.some((v) => v !== null);
  const m = $("#metodo").value, unidad = crit.objetivo === "lcoe" ? "USD/kWh" : "USD";
  lineas("graf-convergencia", datos.map((_, i) => i + 1), [{ label: `Mejor ${nombreObjetivo(crit)} encontrado (${unidad})`, data: datos, borderColor: "#1F5FAD", spanGaps: true }], unidad,
    { scales: { x: { title: { display: true, text: m === "ha" ? "Corridas" : m === "mc" ? "Lotes de muestras" : m === "ga" ? "Generaciones" : "Iteraciones y pulido" }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: false, title: { display: true, text: unidad } } } });
}

function bloquear(corriendo) {
  estado.corriendo = corriendo;
  $("#btn-detener").disabled = !corriendo;
  $$("#paso-demanda input, #paso-demanda button, #paso-recurso input, #paso-recurso button, #paso-recurso select, #paso-distribucion input, #paso-zona button, #paso-arquitectura input, #paso-criterios input, #paso-criterios select, #metodo, #opt-semilla, #opt-hilos, #btn-tesis, #preset-rapido, #preset-tesis, #limites-auto")
    .forEach((el) => { el.disabled = corriendo; });
  renderEquipos(); renderMetodo(); cambiosGenerales();
}

// Solución de compromiso del frente: la más cercana al punto ideal, con cada objetivo normalizado entre su mínimo y su máximo.
function compromiso(frente) {
  const m = frente[0].objs.length;
  const min = Array.from({ length: m }, (_, k) => Math.min(...frente.map((e) => e.objs[k])));
  const max = Array.from({ length: m }, (_, k) => Math.max(...frente.map((e) => e.objs[k])));
  let mejor = 0, dMejor = Infinity;
  frente.forEach((e, i) => {
    const d = Math.hypot(...e.objs.map((v, k) => (max[k] > min[k] ? (v - min[k]) / (max[k] - min[k]) : 0)));
    if (d < dMejor) { dMejor = d; mejor = i; }
  });
  return mejor;
}

async function optimizar() {
  if (!estado.demanda || !recursoListo()) return;
  const clave = $("#metodo").value, metodo = METODOS[clave], params = leerParams(), semilla = Math.max(1, Math.round(num("#opt-semilla")));
  const crit = leerCriterio();
  const limites = clonar(estado.limites);
  bloquear(true); detener = false;
  $("#progreso").hidden = false; $("#progreso-barra").style.width = "0%"; $("#progreso-texto").textContent = "Preparando el caso…";
  const t0 = performance.now();
  try {
    const caso = await armarCaso();
    pool = new Pool(hilos());
    await pool.init(caso, crit);
    const evaluador = crearEvaluador(pool);
    const comun = { limites, evaluar: evaluador.evaluar, semilla, alProgresar: (p) => mostrarProgreso(p, t0, evaluador, crit), detenido: () => detener };
    const snap = { equipos: clonar(estado.equipos), arq: clonar(estado.arq), economia: leerEconomia(), terreno: caso.terreno, zona: estado.zona, dist: distribucion() };
    const meta = { metodo: metodo.nombre.replace(" · recomendado", ""), params, semilla, crit, snap, detenido: false };
    $("#pareto").hidden = true;
    if (metodo.mo) {
      const r = await metodo.fn({ ...comun, ...params });
      if (!r.frente.length) throw new Error(`ninguna configuración cumplió la confiabilidad pedida (${textoConfiabilidad(crit)}). Amplía ese límite o los límites de búsqueda, o usa más generaciones.`);
      const seg = (performance.now() - t0) / 1000;
      Object.assign(meta, { segundos: seg, simulaciones: evaluador.cuenta(), detenido: detener });
      const ideal = compromiso(r.frente);
      estado.pareto = { frente: r.frente, crit, caso, meta, sel: ideal, ideal };
      renderPareto();
      const completo = await pool.enviar(0, { tipo: "completo", cfg: r.frente[ideal].cfg });
      mostrarResultados(r.frente[ideal].cfg, completo.res, { ...meta, metodo: `${meta.metodo} · solución de compromiso` }, "#pareto");
      $("#progreso-texto").textContent = `Listo en ${fmt(seg, 1)} s: ${fmt(r.frente.length)} soluciones en el frente de Pareto.`;
    } else {
      estado.pareto = null;
      let r;
      if (clave === "ha") r = await haEnPool(pool, limites, params, semilla, (p) => mostrarProgreso(p, t0, null, crit));
      else if (clave === "mc") r = await monteCarlo({ ...comun, muestras: params.muestras });
      else r = await metodo.fn({ ...comun, ...params });
      if (!r.mejor) throw new Error("no se evaluó ninguna configuración.");
      const completo = await pool.enviar(0, { tipo: "completo", cfg: r.mejor.cfg });
      const seg = (performance.now() - t0) / 1000;
      mostrarResultados(r.mejor.cfg, completo.res, { ...meta, obj: r.mejor.obj, segundos: seg, simulaciones: clave === "ha" ? r.evaluaciones : evaluador.cuenta(), detenido: detener });
      $("#progreso-texto").textContent = `Listo en ${fmt(seg, 1)} s.`;
    }
    $("#progreso-barra").style.width = "100%";
  } catch (err) {
    $("#progreso-texto").textContent = detener ? "Optimización detenida." : `No se pudo completar la optimización: ${err.message}`;
  } finally {
    pool?.terminar(); pool = null;
    bloquear(false);
  }
}

// Simula una configuración con un caso ya armado (a mano o elegida en el frente de Pareto).
async function simularCon(caso, crit, cfg, meta, destino) {
  bloquear(true);
  try {
    pool = new Pool(1);
    await pool.init(caso, crit);
    const completo = await pool.enviar(0, { tipo: "completo", cfg });
    mostrarResultados(cfg, completo.res, meta, destino);
  } catch (err) {
    estadoTexto("#opt-estimado", `No se pudo simular: ${err.message}`, "err");
  } finally {
    pool?.terminar(); pool = null;
    bloquear(false);
  }
}

async function simularManual() {
  if (!estado.demanda || !recursoListo()) return;
  const cfg = $$("#manual input").map((i) => Math.max(0, Math.round(Number(i.value) || 0)));
  const crit = { ...leerCriterio(), modo: "uno", mo: [] };
  const caso = await armarCaso();
  const snap = { equipos: clonar(estado.equipos), arq: clonar(estado.arq), economia: leerEconomia(), terreno: caso.terreno, zona: estado.zona, dist: distribucion() };
  await simularCon(caso, crit, cfg, { metodo: "Configuración ingresada a mano", crit, snap, manual: true });
}

/* ---------- Frente de Pareto ---------- */

function renderPareto() {
  const P = estado.pareto; if (!P) return;
  const objs = P.crit.mo.map((k) => OBJETIVOS_MO[k]);
  $("#pareto").hidden = false;
  $("#pareto-sub").textContent = `${P.meta.metodo} · ${fmt(P.frente.length)} soluciones · ${textoConfiabilidad(P.crit)} · ${fmt(P.meta.simulaciones)} simulaciones en ${fmt(P.meta.segundos, 1)} s${P.meta.detenido ? " · detenido antes de terminar" : ""}`;
  for (const [id, def] of [["#pareto-x", 0], ["#pareto-y", 1]]) {
    const sel = $(id);
    if (sel.dataset.clave !== P.crit.mo.join(",")) {
      sel.replaceChildren();
      objs.forEach((o, i) => { const op = document.createElement("option"); op.value = i; op.textContent = `${o.nombre} (${o.unidad})`; sel.appendChild(op); });
      sel.value = def; sel.dataset.clave = P.crit.mo.join(",");
    }
  }
  const ix = Number($("#pareto-x").value), iy = Number($("#pareto-y").value);
  const color = P.frente.map((_, i) => (i === P.sel ? "#C0392B" : i === P.ideal ? "#E9A23B" : "#1F5FAD"));
  grafico("graf-pareto", {
    type: "scatter",
    data: { datasets: [{ label: "Soluciones del frente", data: P.frente.map((e) => ({ x: e.objs[ix], y: e.objs[iy] })),
      backgroundColor: color, borderColor: color, pointRadius: P.frente.map((_, i) => (i === P.sel || i === P.ideal ? 7 : 4)), pointHoverRadius: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      onClick: (_, el) => { if (el.length) elegirPareto(el[0].index); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `#${c.dataIndex + 1}: ${fmt(c.raw.x, objs[ix].dec)} · ${fmt(c.raw.y, objs[iy].dec)}${c.dataIndex === P.ideal ? " (compromiso)" : ""}` } } },
      scales: { x: { title: { display: true, text: `${objs[ix].nombre} (${objs[ix].unidad})` } }, y: { title: { display: true, text: `${objs[iy].nombre} (${objs[iy].unidad})` } } },
    },
  });
  const t = $("#tabla-pareto"); t.replaceChildren();
  const activos = MODULOS.map((k, i) => [k, i]).filter(([k]) => moduloActivo(k, P.meta.snap.arq));
  const head = t.createTHead().insertRow();
  for (const c of ["#", ...objs.map((o) => `${o.nombre} (${o.unidad})`), ...activos.map(([k]) => ABREV[k])]) { const th = document.createElement("th"); th.textContent = c; head.appendChild(th); }
  const tb = t.createTBody();
  P.frente.forEach((e, i) => {
    const row = tb.insertRow();
    row.tabIndex = 0;
    if (i === P.sel) row.className = "sel";
    row.insertCell().textContent = `${i + 1}${i === P.ideal ? " ★" : ""}`;
    e.objs.forEach((v, k) => { row.insertCell().textContent = fmt(v, objs[k].dec); });
    activos.forEach(([, j]) => { row.insertCell().textContent = fmt(e.cfg[j]); });
    row.addEventListener("click", () => elegirPareto(i));
    row.addEventListener("keydown", (ev) => { if (ev.key === "Enter") elegirPareto(i); });
  });
}

async function elegirPareto(i) {
  const P = estado.pareto;
  if (!P || estado.corriendo) return;
  P.sel = i; renderPareto();
  await simularCon(P.caso, P.crit, P.frente[i].cfg, { ...P.meta, metodo: `${P.meta.metodo} · solución ${i + 1} de ${P.frente.length}${i === P.ideal ? " (compromiso)" : ""}` }, null);
}

function descargarPareto() {
  const P = estado.pareto; if (!P) return;
  const objs = P.crit.mo.map((k) => OBJETIVOS_MO[k]);
  const filas = [["solucion", ...P.crit.mo.map((k, i) => `${k}_${objs[i].unidad.replace(/[^\w]+/g, "_")}`), ...MODULOS.map((k) => `n_${k}`)].join(",")];
  P.frente.forEach((e, i) => filas.push([i + 1, ...e.objs.map((v) => Number(v.toPrecision(8))), ...e.cfg].join(",")));
  descargar(new Blob([filas.join("\n")], { type: "text/csv" }), "hres-h2_frente_pareto.csv");
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
function capacidad(k, n, equipos) {
  const v = n * (k === "ht" || k === "bat" ? equipos[k].cap : equipos[k].pr);
  return v >= 1000 ? `${fmt(v / 1000, 2)} ${UNIDAD[k] === "kWh" ? "MWh" : "MW"}` : `${fmt(v, 1)} ${UNIDAD[k]}`;
}
function sumasDiarias(serie) {
  const out = [];
  for (let d = 0; d < serie.length / 24; d++) { let s = 0; for (let hh = 0; hh < 24; hh++) s += serie[d * 24 + hh]; out.push(s); }
  return out;
}
function npcModulo(i, cfg, r) { return i < 6 ? cfg[i] * r.npcU[i] : i === 6 ? r.npcBat : r.npcDg; }
function tituloDiagrama(r, meta) { return `LCOE ${fmt(r.lcoe, 4)} USD/kWh · LOLE ${fmt(r.lole)} h · LPSP ${fmt(r.lpsp * 100, 2)} % · ${meta.metodo}`; }

function mostrarResultados(cfg, r, meta, desplazarA = "#resultados") {
  const crit = meta.crit, cumple = r.viol === 0;
  const { equipos, arq, economia } = meta.snap;
  const bloquearCSV = estado.demandaTipo === "ejemplo" || estado.demandaTipo === "sintetica";
  $("#dl-csv").disabled = bloquearCSV;
  $("#dl-csv").title = bloquearCSV ? "La demanda de la localidad remota es de terceros: sus series horarias no se descargan." : "";
  $("#dl-csv-nota").hidden = !bloquearCSV;
  estado.resultado = { cfg, r, meta, arq, equipos, economia, demandaNombre: estado.demandaNombre, demandaTipo: estado.demandaTipo,
    recurso: nombreRecurso(), zona: meta.snap.zona };
  $("#resultados").hidden = false;
  const unaSolucion = meta.metodo.includes("solución ");
  $("#res-subtitulo").textContent = [meta.metodo, meta.segundos && !unaSolucion ? `${fmt(meta.segundos, 1)} s` : "",
    meta.simulaciones && !unaSolucion ? `${fmt(meta.simulaciones)} simulaciones` : "",
    meta.detenido ? "detenido antes de terminar" : "", nombreArquitectura(arq), estado.demandaNombre].filter(Boolean).join(" · ");

  const lole = crit.tipo === "lole", pen = hayPenalizacion(crit);
  const insignia = cumple ? ["Cumple", "ok"] : ["No cumple", "err"];
  const tarjetas = [
    kpi("LCOE", `${fmt(r.lcoe, 4)} USD/kWh`, "Costo nivelado de energía", "main"),
    kpi("Costo presente neto", musd(r.npc), `en ${economia.anios} años`),
    kpi("Inversión inicial", musd(r.capex)),
    kpi("Horas con déficit (LOLE)", `${fmt(r.lole)} h`, lole ? `permitidas: ${fmt(crit.h)} h` : "", "", lole ? insignia : null),
    kpi("LPSP", `${fmt(r.lpsp * 100, 3)} %`, lole ? "energía no suministrada / demanda" : `máxima: ${fmt(crit.lpspMax * 100, 2)} %`, "", lole ? null : insignia),
    kpi("Energía no suministrada", `${fmt(r.ens, 1)} kWh`, "al año"),
    kpi("Energía suministrada", `${fmt(r.eSum / 1000, 1)} MWh/año`, "incluye la reserva operativa"),
    kpi("Excedentes perdidos", `${fmt(r.perdida / 1000, 1)} MWh/año`, "energía que no se pudo aprovechar ni guardar"),
  ];
  if (arq.hess || r.h2Entra > 0) tarjetas.push(kpi("Hidrógeno", `${fmt(r.h2Entra / 1000, 1)} MWh`, `guardados en el año; ${fmt(r.h2Sale / 1000, 1)} MWh extraídos; ${fmt(r.h2Min, 0)} kWh nunca se usaron`));
  if (cfg[6] > 0) tarjetas.push(kpi("Baterías", `${fmt(r.ciclosBat, 0)} ciclos/año`, `vida estimada ${fmt(r.vidaBat, 1)} años; ${fmt(r.batSale / 1000, 1)} MWh entregados`));
  if (cfg[7] > 0) {
    tarjetas.push(
      kpi("Diésel", `${fmt(r.litros)} L/año`, `${fmt(r.dgE / 1000, 1)} MWh generados; ${fmt(r.horasDg)} horas-unidad; vida ${fmt(r.vidaDg, 1)} años`),
      kpi("Costo del diésel", `${fmt(r.costoDieselAnual)} USD/año`, "combustible y mantención"),
      kpi("Emisiones", `${fmt(r.co2 / 1000, 1)} t CO₂/año`, `fracción renovable ${fmt(r.fraccionRenovable * 100, 1)} %`));
  }
  const ter = meta.snap.terreno;
  if (ter) {
    const usado = cfg[0] * ter.aWt + cfg[1] * ter.aPv;
    tarjetas.push(kpi("Terreno usado", `${fmt(usado / 1e4, 1)} ha`, `de ${fmt(ter.area / 1e4, 1)} ha (${fmt((usado / ter.area) * 100)} %)`, "", usado <= ter.area * 1.000001 ? ["Cabe", "ok"] : ["No cabe", "err"]));
  }
  if (pen && meta.obj !== undefined) { const n = nombreObjetivo(crit); tarjetas.push(kpi(n[0].toUpperCase() + n.slice(1), valorObjetivo(crit, meta.obj), "valor que se minimizó")); }
  $("#kpis").replaceChildren(...tarjetas);

  const aviso = $("#aviso");
  aviso.hidden = cumple;
  if (!cumple) {
    aviso.textContent = meta.manual
      ? `Esta configuración no cumple la confiabilidad pedida (${textoConfiabilidad(crit)}) o no cabe en la zona: tiene ${fmt(r.lole)} horas con déficit y una LPSP de ${fmt(r.lpsp * 100, 3)} %.`
      : `El método no encontró una configuración que cumpla la confiabilidad pedida (${textoConfiabilidad(crit)}). Se muestra la más cercana. Prueba con más generaciones, corridas o muestras, o amplía los límites de búsqueda.`;
  }

  const t = $("#tabla-equipos"); t.replaceChildren();
  const thead = t.createTHead().insertRow();
  for (const c of ["Módulo", "Cantidad", "Capacidad total", "Inversión (USD)", "Costo presente neto (USD)"]) { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); }
  const tb = t.createTBody();
  let totCi = 0, totNpc = 0;
  MODULOS.forEach((m, i) => {
    if (!cfg[i] && !moduloActivo(m, arq)) return;
    const ci = cfg[i] * equipos[m].ci, npc = npcModulo(i, cfg, r);
    totCi += ci; totNpc += npc;
    const row = tb.insertRow();
    row.insertCell().textContent = `${NOMBRES[m]} · ${equipos[m].nombre}${m === "dg" && cfg[i] ? " (incluye combustible y mantención)" : ""}`;
    row.insertCell().textContent = fmt(cfg[i]); row.insertCell().textContent = capacidad(m, cfg[i], equipos);
    row.insertCell().textContent = fmt(ci); row.insertCell().textContent = fmt(npc);
  });
  const tf = t.createTFoot().insertRow();
  tf.insertCell().textContent = "Total"; tf.insertCell(); tf.insertCell(); tf.insertCell().textContent = fmt(totCi); tf.insertCell().textContent = fmt(totNpc);

  $("#diagrama-res").innerHTML = svgDiagrama({ arq, equipos, cfg, titulo: tituloDiagrama(r, meta) });

  const dias = etiquetasDias(), s = r.series;
  lineas("graf-energia", dias, [
    { label: "Demanda con reserva", data: dem.mediasDiarias(s.d), borderColor: "#1E2530" },
    { label: "Suministro", data: dem.mediasDiarias(s.sum), borderColor: "#1F5FAD", borderDash: [5, 3] },
  ], "kW");
  lineas("graf-produccion", dias, [
    ...(arq.wt ? [{ label: "Eólica", data: dem.mediasDiarias(s.wt), borderColor: COLORES.wt }] : []),
    ...(arq.pv ? [{ label: "Fotovoltaica", data: dem.mediasDiarias(s.pv), borderColor: COLORES.pv }] : []),
    ...(arq.dg ? [{ label: "Diésel", data: dem.mediasDiarias(s.dg), borderColor: COLORES.dg }] : []),
    { label: "Demanda con reserva", data: dem.mediasDiarias(s.d), borderColor: "#1E2530", borderWidth: 1.2 },
  ], "kW");
  lineas("graf-h2", dias, [
    ...(arq.hess || !arq.bat ? [{ label: "Hidrógeno en los tanques (media diaria)", data: dem.mediasDiarias(s.str), borderColor: COLORES.ht, backgroundColor: "rgba(108,92,231,.12)", fill: true }] : []),
    ...(arq.bat ? [{ label: "Baterías (media diaria)", data: dem.mediasDiarias(s.soc), borderColor: COLORES.bat, backgroundColor: "rgba(63,174,106,.12)", fill: true }] : []),
  ], "kWh");
  grafico("graf-perdidas", {
    type: "bar",
    data: { labels: dias, datasets: [
      { label: "Energía no suministrada", data: sumasDiarias(s.def).map((v) => (v > 0 ? v : null)), backgroundColor: "#C0392B" },
      { label: "Excedentes perdidos", data: sumasDiarias(s.loss).map((v) => (v > 0 ? v : null)), backgroundColor: "#8E9AAF" },
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 12 } } },
      scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { type: "logarithmic", title: { display: true, text: "kWh por día (escala logarítmica)" } } } },
  });
  graficoFlujo();
  grafico("graf-costos", {
    type: "doughnut",
    data: { labels: MODULOS.map((m) => NOMBRES[m]), datasets: [{ data: MODULOS.map((m, i) => npcModulo(i, cfg, r)), backgroundColor: MODULOS.map((m) => COLORES[m]) }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: "right", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${musd(c.raw)} (${fmt((c.raw / r.npc) * 100, 1)} %)` } } } },
  });
  renderLayoutResultado(cfg, r, meta);
  renderDistribucion();
  if (desplazarA) $(desplazarA).scrollIntoView({ behavior: "smooth", block: "start" });
}

// Figura con la ubicación de los equipos del resultado dentro de la zona.
function renderLayoutResultado(cfg, r, meta) {
  const { zona: z, dist, equipos, arq } = meta.snap;
  estado.resultado.layoutSvg = null;
  $("#res-layout").hidden = false;
  $$("[data-layout]").forEach((btn) => { btn.disabled = !z || !dist; });
  $$("#res-layout .btns button[id^='v3-']").forEach((btn) => { btn.disabled = !z || !dist; });
  if (!z || !dist) {
    turno3d++; vista3d?.destruir(); vista3d = null;
    $("#layout-3d").replaceChildren(); $("#leyenda-3d").replaceChildren(); $("#layout-3d-estado").textContent = "";
    $("#layout-res").replaceChildren();
    $("#layout-nota").textContent = "Para ver dónde quedan los equipos, dibuja una zona en la pestaña 1 (Zona) y vuelve a simular. El caso de ejemplo (lat. 45°S) no tiene zona en el mapa.";
    return;
  }
  const pv = equipos.pv, areaMod = pv.pr / (pv.eff / 100), p = dist.paneles;
  const pitch = (2 * Math.sqrt(areaMod * 1.75)) / p.gcr;          // mesas de 2 paneles en vertical
  const geo = zona.layoutResultado(z.pts, { posiciones: dist.posiciones, ...dist.op, nWt: Math.min(cfg[0], dist.posiciones.length), areaPv: cfg[1] * p.m2PorPanel, hub: equipos.wt.hub, beta: p.beta });
  const bloque = ["con", "ele", "ht", "fc", "bat", "dg"].map((k) => [k, MODULOS.indexOf(k)]).filter(([, i]) => cfg[i] > 0)
    .map(([k, i]) => `${NOMBRES[k][0].toLowerCase()}${NOMBRES[k].slice(1)} ${capacidad(k, cfg[i], equipos)}`);
  const leyenda = [["zona", `Zona: ${fmt(z.area / 1e4, 1)} ha`]];
  if (cfg[0]) leyenda.push(["wt", `${fmt(cfg[0])} aerogeneradores ${equipos.wt.nombre} · rotor de ${fmt(dist.op.D, 1)} m · separación ${fmt(dist.op.sx, 1)}D × ${fmt(dist.op.sy, 1)}D`]);
  if (cfg[1]) leyenda.push(["pv", `${fmt(cfg[1])} paneles (${capacidad("pv", cfg[1], equipos)}) en ${fmt((cfg[1] * p.m2PorPanel) / 1e4, 1)} ha · mesas a ${fmt(p.beta)}° hacia el norte, filas cada ${fmt(pitch, 1)} m`]);
  if (bloque.length) leyenda.push(["bloque", `Bloque de potencia: ${bloque.join(" · ")}`]);
  const svg = svgLayout(geo, { titulo: `Layout del sistema ${nombreArquitectura(arq)} · LCOE ${fmt(r.lcoe, 4)} USD/kWh`, eje: dist.op.eje, pitchM: pitch, leyenda });
  estado.resultado.layoutSvg = svg;
  $("#layout-res").innerHTML = svg;      // SVG armado por el propio sitio (textos escapados)
  mostrar3D({ pts: z.pts, geo, eje: dist.op.eje, cfg, equipos, pitchM: pitch, beta: p.beta, largoMesa: 2 * Math.sqrt(areaMod * 1.75) });
  const notas = [];
  if (dist.demasiadas && cfg[0]) notas.push("Hay demasiadas posiciones posibles para dibujar los aerogeneradores: aumenta la separación o reduce la zona.");
  else if (cfg[0] > dist.posiciones.length) notas.push(`Solo caben ${fmt(dist.posiciones.length)} de los ${fmt(cfg[0])} aerogeneradores.`);
  if (!geo.completo) notas.push("El campo fotovoltaico no cabe completo en el terreno que dejan libre los aerogeneradores.");
  const perd = [];
  if (cfg[0] && dist.estela) perd.push(`estelas entre aerogeneradores ${fmt((1 - zona.eficienciaParque(dist.estela, cfg[0])) * 100, 1)} % de la energía eólica`);
  if (cfg[1]) perd.push(`sombra entre filas ${fmt(p.sombra * 100, 1)} %`);
  if (cfg[0] && cfg[1]) perd.push(`sombra de los aerogeneradores sobre los paneles ${fmt(geo.sombraPv * 100, 2)} %`);
  if (perd.length) notas.push(`Pérdidas descontadas en la simulación: ${perd.join("; ")}.`);
  notas.push(`Los aerogeneradores están en las posiciones que más energía dan con las estelas de la rosa de vientos; los paneles se agrupan alrededor del bloque de potencia${dist.op.compartir ? ", también entre los aerogeneradores," : ""} y evitan su sombra mientras haya terreno sin ella. Es un anteproyecto: el trazado final requiere topografía, accesos y un estudio de viento en terreno.`);
  $("#layout-nota").textContent = notas.join(" ");
}

// Mapa de recurso sobre el terreno de la vista 3D (se calcula una vez por vista y capa).
let datosMapa = null;
const CAPAS = {
  viento: { titulo: "Viento medio anual a la altura del buje (m/s), con las estelas de los aerogeneradores", unidad: "m/s", dec: 2,
    nota: "Velocidad media a la altura del buje según la serie de viento y su rosa de vientos, menos el déficit de las estelas (Jensen). No incluye el efecto del relieve sobre el viento: la serie es de un solo punto." },
  solar: { titulo: "Radiación solar anual sobre el suelo (kWh/m²·año)", unidad: "kWh/m²", dec: 0,
    nota: "Según la pendiente y orientación del terreno (las laderas al norte reciben más), la sombra del relieve cercano y de los aerogeneradores, con la nubosidad de la serie. Los paneles, inclinados en la latitud, reciben más que el suelo." },
};
function capa3d() {
  const tipo = $("#v3-capa").value, d = datosMapa, v = vista3d;
  $("#v3-escala").hidden = true;
  if (!v || !d) return;
  if (!tipo || !d.clima) {
    v.capa(null);
    if (tipo) { $("#v3-escala-titulo").textContent = "El recurso elegido no tiene series de viento y radiación para el mapa."; $("#v3-escala").hidden = false; }
    return;
  }
  const wt = d.equipos.wt;
  const rej = tipo === "viento" ? { ...v.rejilla, n: 160 } : v.rejilla;    // el viento, más fino: las estelas son angostas
  d.mapas[tipo] ??= tipo === "viento"
    ? zona.mapaViento(rej, { turb: d.geo.turb, D: wt.rotor, hub: wt.hub, clima: d.clima, eje: d.eje })
    : zona.mapaSolar(rej, { lat: zona.centro(d.pts)[0], beta: d.beta, gti: d.clima.gti_wm2, turb: d.geo.turb, hub: wt.hub, D: wt.rotor });
  const r = v.capa(d.mapas[tipo], tipo, zona.rangoEnZona(rej, d.mapas[tipo], d.geo.poli)), c = CAPAS[tipo];
  $("#v3-escala-titulo").textContent = `${c.titulo}. Escala dentro de la zona:`;
  $("#v3-min").textContent = `${fmt(r.min, c.dec)} ${c.unidad}`; $("#v3-max").textContent = `${fmt(r.max, c.dec)} ${c.unidad}`;
  $("#v3-barra").style.background = `linear-gradient(90deg, ${v.paletas[tipo].join(", ")})`;
  $("#v3-escala-nota").textContent = c.nota; $("#v3-escala-nota").className = "fine";
  $("#v3-escala").hidden = false;
}

// Vista 3D animada (three.js se carga solo cuando hace falta).
async function mostrar3D(op) {
  const turno = ++turno3d;
  vista3d?.destruir(); vista3d = null;
  const estado3d = (t) => { if (turno === turno3d) $("#layout-3d-estado").textContent = t; };
  const ley = $("#leyenda-3d"); ley.replaceChildren();
  const chip = (color, texto) => { const s = document.createElement("span"), i = document.createElement("i"); i.style.background = color; s.append(i, texto); ley.appendChild(s); };
  try {
    const m = await import("./escena3d.js?v=20261015f");
    chip("#FF8A3D", "Zona");
    if (op.cfg[0]) chip("#F7F8FA", `Aerogeneradores (${fmt(op.cfg[0])})`);
    if (op.cfg[1]) chip("#2456A6", `Paneles (${fmt(op.cfg[1])})`);
    [["con", 2], ["ele", 3], ["ht", 4], ["fc", 5], ["bat", 6], ["dg", 7]].forEach(([k, i]) => { if (op.cfg[i]) chip(m.COLORES_BLOQUE[k], NOMBRES[k]); });
    const v = await m.crearVista3D($("#layout-3d"), { ...op, alEstado: estado3d });
    if (turno !== turno3d) { v.destruir(); return; }
    vista3d = v; vista3d.paletas = m.PALETAS;
    datosMapa = { ...op, clima: estado.recurso === "tesis" ? (await dem.datosEjemplo()).era5 : await climaActual(), mapas: {} };
    $("#v3-girar").textContent = "Pausar giro";
    capa3d();
  } catch (err) {
    estado3d(`No se pudo armar la vista 3D: ${err.message}. Revisa el plano 2D más abajo.`);
  }
}

// Flujo de caja del sistema por año y categoría (como el Cash Flow de HOMER): costos negativos, residual positivo.
const CATEGORIAS_FC = [["capital", "Capital", "#1F5FAD"], ["reemplazo", "Reemplazo", "#E9A23B"], ["om", "O&M", "#7F8C9D"],
  ["combustible", "Combustible", "#B5651D"], ["residual", "Residual", "#3FAE6A"]];
function flujoSistema(cfg, r, equipos, economia) {
  const N = economia.anios, total = Object.fromEntries(CATEGORIAS_FC.map(([c]) => [c, new Float64Array(N + 1)]));
  MODULOS.forEach((k, i) => {
    if (!cfg[i]) return;
    let dev = equipos[k], anual = 0;
    if (k === "bat") dev = { ...dev, vu: r.vidaBat ?? dev.vu };
    if (k === "dg") { dev = { ci: dev.ci, rep: dev.rep, om: 0, vu: r.vidaDg ?? dev.vu }; anual = r.costoDieselAnual / cfg[i]; }
    const f = flujoCaja(dev, N, anual);
    for (const [c] of CATEGORIAS_FC) for (let y = 0; y <= N; y++) total[c][y] += f[c][y] * cfg[i];
  });
  return { total, df: crf(tasaReal(economia.dn, economia.ie), N).df, N };
}
function graficoFlujo() {
  const res = estado.resultado; if (!res) return;
  const { total, df, N } = flujoSistema(res.cfg, res.r, res.equipos, res.economia);
  const desc = $("#fc-modo").value === "descontado", factor = (y) => (desc ? (y ? df[y] : 1) : 1);
  grafico("graf-flujo", {
    type: "bar",
    data: { labels: Array.from({ length: N + 1 }, (_, y) => y), datasets: CATEGORIAS_FC.map(([c, nombre, color]) => ({
      label: nombre, backgroundColor: color, data: Array.from(total[c], (v, y) => (c === "residual" ? 1 : -1) * v * factor(y)) })) },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 12 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)} USD` } } },
      scales: { x: { stacked: true, title: { display: true, text: "Año del proyecto" } }, y: { stacked: true, title: { display: true, text: `USD ${desc ? "descontados al año 0" : "nominales (de hoy)"}` } } } },
  });
}

function descargarCSV() {
  const res = estado.resultado;
  if (!res || res.demandaTipo === "ejemplo" || res.demandaTipo === "sintetica") return;
  const s = res.r.series, filas = ["fecha_hora,demanda_con_reserva_kw,eolica_kw,fotovoltaica_kw,diesel_kw,suministro_kw,deficit_kw,excedente_perdido_kw,h2_almacenado_kwh,bateria_kwh"];
  const base = Date.UTC(2018, 0, 1);
  for (let t = 0; t < s.d.length; t++) {
    const f = new Date(base + t * 3600e3).toISOString().slice(0, 16);
    filas.push(f + "," + [s.d[t], s.wt[t], s.pv[t], s.dg[t], s.sum[t], Math.max(0, s.def[t]), s.loss[t], s.str[t], s.soc[t]].map((v) => Number(v).toFixed(3)).join(","));
  }
  descargar(new Blob([filas.join("\n")], { type: "text/csv" }), "hres-h2_series_horarias.csv");
}
function descargarJSON() {
  const res = estado.resultado; if (!res) return;
  const { series, ...r } = res.r;
  const c = res.meta.crit;
  const salida = {
    simulador: "Simulador HRES-H2", fecha: new Date().toISOString(),
    demanda: res.demandaNombre, recurso: res.recurso, arquitectura: res.arq, equipos: res.equipos, economia: res.economia,
    criterio: { confiabilidad: c.tipo, lole_max_h: c.tipo === "lole" ? c.h : null, limitar_energia: c.usarEnergia, lpsp_max: c.tipo === "lpsp" ? c.lpspMax : null,
      modo: c.modo, objetivo: c.modo === "mo" ? c.mo : c.objetivo, penalizaciones_usd_kwh: c.pen },
    metodo: res.meta.metodo, parametros: res.meta.params || null, semilla: res.meta.semilla || null,
    resultado: { cantidades: Object.fromEntries(MODULOS.map((m, i) => [m, res.cfg[i]])), lcoe_usd_kwh: r.lcoe, npc_usd: r.npc, inversion_usd: r.capex,
      lole_h: r.lole, lpsp: r.lpsp, ens_kwh: r.ens, energia_suministrada_kwh: r.eSum, excedentes_perdidos_kwh: r.perdida,
      h2_guardado_kwh: r.h2Entra, h2_extraido_kwh: r.h2Sale, h2_sin_usar_kwh: r.h2Min,
      bateria: res.cfg[6] ? { ciclos_anuales: r.ciclosBat, vida_anios: r.vidaBat, npc_usd: r.npcBat } : null,
      diesel: res.cfg[7] ? { litros_anuales: r.litros, energia_kwh: r.dgE, horas_unidad: r.horasDg, vida_anios: r.vidaDg, costo_anual_usd: r.costoDieselAnual, npc_usd: r.npcDg, co2_kg: r.co2 } : null,
      fraccion_renovable: r.fraccionRenovable },
  };
  descargar(new Blob([JSON.stringify(salida, null, 2)], { type: "application/json" }), "hres-h2_resumen.json");
}

/* ---------- Caso de ejemplo ---------- */

async function cargarCasoTesis() {
  $('input[name="demanda"][value="ejemplo"]').checked = true;
  $('input[name="recurso"][value="tesis"]').checked = true;
  $("#arq-wt").checked = $("#arq-pv").checked = $("#arq-hess").checked = true;
  $("#arq-bat").checked = $("#arq-dg").checked = false;
  estado.equipos = Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === DEFECTO_IDS[k]))]));
  $("#eco-dn").value = 8; $("#eco-ie").value = 3; $("#eco-anios").value = 20; $("#eco-reserva").value = 10; $("#eco-diesel").value = 1;
  $("#conf-tipo").value = "lole"; $("#conf-h").value = 0; $("#conf-energia").checked = false;
  $('input[name="modo"][value="uno"]').checked = true; $("#obj-unico").value = "lcoe";
  $("#pen-exc").value = 0; $("#pen-h2").value = 0;
  $("#lay-usar").checked = false;          // el caso de ejemplo está en lat. 45°S, fuera de la región del mapa
  estado.limitesEditados = false;
  await cambiarRecurso();
  await cargarDemanda();
  abrirPestana("optimizacion");
}

/* ---------- Pestañas ---------- */

function abrirPestana(nombre) {
  $$('[role="tab"]').forEach((b) => { const si = b.dataset.tab === nombre; b.setAttribute("aria-selected", si); b.tabIndex = si ? 0 : -1; });
  $$(".panel").forEach((p) => { p.hidden = p.id !== `panel-${nombre}`; });
  if (nombre === "zona") mapaZona?.mapa.invalidateSize();
  if (nombre === "equipos") { renderDistribucion(); mapaLayout?.mapa.invalidateSize(); renderDistribucion(); }
  $(".tabs").scrollIntoView({ block: "start" });
}

/* ---------- Inicio ---------- */

function iniciar() {
  const objCont = $("#obj-mo");
  for (const [k, o] of Object.entries(OBJETIVOS_MO)) {
    const lab = document.createElement("label"); lab.className = "check";
    const inp = document.createElement("input"); inp.type = "checkbox"; inp.value = k; inp.checked = k === "lcoe" || k === "lpsp";
    inp.addEventListener("change", cambiosGenerales);
    lab.append(inp, ` ${o.nombre} (${o.unidad})`); objCont.appendChild(lab);
  }
  $("#opt-hilos").value = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  $("#metodo").addEventListener("change", renderMetodo);
  $("#opt-hilos").addEventListener("input", estimar);
  $("#preset-rapido").addEventListener("click", () => aplicarPreset("rapido"));
  $("#preset-tesis").addEventListener("click", () => aplicarPreset("tesis"));

  $$('input[name="demanda"]').forEach((r) => r.addEventListener("change", cargarDemanda));
  ["#rs-viviendas", "#rs-sur", "#sin-media", "#sin-var", "#sin-semilla", "#csv-archivo"].forEach((s) => $(s).addEventListener("change", cargarDemanda));
  $("#sin-otra").addEventListener("click", () => { $("#sin-semilla").value = Math.round(num("#sin-semilla")) + 1; cargarDemanda(); });
  $$('input[name="recurso"]').forEach((r) => r.addEventListener("change", cambiarRecurso));
  $("#ub-cargar").addEventListener("click", cargarUbicacion);
  ["#arq-wt", "#arq-pv", "#arq-hess", "#arq-bat", "#arq-dg"].forEach((s) => $(s).addEventListener("change", () => { cambiosGenerales(); renderEquipos(); }));
  ["#eco-dn", "#eco-ie", "#eco-anios", "#eco-reserva", "#eco-diesel", "#conf-tipo", "#conf-h", "#conf-lpsp", "#conf-energia", "#obj-unico", "#pen-exc", "#pen-h2"]
    .forEach((s) => $(s).addEventListener("change", cambiosGenerales));
  $$('input[name="modo"]').forEach((r) => r.addEventListener("change", cambiosGenerales));
  $("#limites-auto").addEventListener("click", () => { estado.limitesEditados = false; renderLimites(); });
  $("#btn-optimizar").addEventListener("click", optimizar);
  $("#btn-detener").addEventListener("click", () => { detener = true; if ($("#metodo").value === "ha") pool?.terminar(); });
  $("#btn-manual").addEventListener("click", simularManual);
  $("#btn-tesis").addEventListener("click", cargarCasoTesis);
  ["#pareto-x", "#pareto-y"].forEach((s) => $(s).addEventListener("change", renderPareto));
  $("#dl-pareto").addEventListener("click", descargarPareto);
  $$("[data-descargar]").forEach((b) => b.addEventListener("click", () => {
    const svg = svgDiagrama({ arq: estado.arq, equipos: estado.equipos, titulo: `Arquitectura ${nombreArquitectura()}` });
    if (b.dataset.descargar === "svg") descargarSVG(svg, `diagrama_${nombreArquitectura()}.svg`); else descargarPNG(svg, `diagrama_${nombreArquitectura()}.png`);
  }));
  $$("[data-descargar-res]").forEach((b) => b.addEventListener("click", () => {
    const res = estado.resultado; if (!res) return;
    const svg = svgDiagrama({ arq: res.arq, equipos: res.equipos, cfg: res.cfg, titulo: tituloDiagrama(res.r, res.meta) });
    if (b.dataset.descargarRes === "svg") descargarSVG(svg, "diagrama_resultado.svg"); else descargarPNG(svg, "diagrama_resultado.png");
  }));
  $("#v3-repetir").addEventListener("click", () => vista3d?.repetir());
  $("#v3-capa").addEventListener("change", capa3d);
  $("#v3-superior").addEventListener("click", () => vista3d?.superior());
  $("#v3-girar").addEventListener("click", (e) => {
    if (!vista3d) return;
    const pausar = e.target.textContent.startsWith("Pausar");
    vista3d.girar(!pausar); e.target.textContent = pausar ? "Reanudar giro" : "Pausar giro";
  });
  $("#v3-video").addEventListener("click", (e) => {
    if (!vista3d || typeof MediaRecorder === "undefined") return;
    const b = e.target; b.disabled = true; b.textContent = "Grabando (14 s)…";
    vista3d.grabar(14, (blob) => { descargar(blob, "layout_3d.webm"); b.disabled = false; b.textContent = "Grabar video (WebM)"; });
  });
  $$("[data-layout]").forEach((b) => b.addEventListener("click", () => {
    const svg = estado.resultado?.layoutSvg; if (!svg) return;
    if (b.dataset.layout === "svg") descargarSVG(svg, "layout_resultado.svg"); else descargarPNG(svg, "layout_resultado.png");
  }));
  $("#fc-modo").addEventListener("change", graficoFlujo);
  // Biblioteca: filtra los términos por texto (sin tildes ni mayúsculas) y abre los que coinciden.
  const normal = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  $("#bib-buscar").addEventListener("input", (e) => {
    const q = normal(e.target.value.trim());
    let n = 0;
    $$("#biblioteca .termino").forEach((d) => { const si = !q || normal(d.textContent).includes(q); d.hidden = !si; d.open = !!q && si; n += si; });
    $$("#biblioteca .bib-grupo").forEach((g) => { g.hidden = !g.querySelector(".termino:not([hidden])"); });
    $("#bib-vacio").hidden = n > 0;
  });
  $("#dl-csv").addEventListener("click", descargarCSV);
  $("#dl-json").addEventListener("click", descargarJSON);

  for (const e of dem.ESTACIONES) { const o = document.createElement("option"); o.value = e.id; o.textContent = e.nombre; $("#est-id").appendChild(o); }
  $("#est-id").addEventListener("change", cargarEstacion);
  $("#rec-archivo").addEventListener("change", cargarRecursoCSV);
  ["#lay-usar", "#lay-eje", "#lay-sx", "#lay-sy", "#lay-retiro", "#lay-aprov", "#lay-libre", "#lay-compartir"].forEach((s) => $(s).addEventListener("change", () => { renderDistribucion(); cambiosGenerales(); }));
  $$('[role="tab"]').forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.tab)));
  $(".tabs-in").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$('[role="tab"]'), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const sig = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    sig.focus(); abrirPestana(sig.dataset.tab);
  });
  $$("[data-ir]").forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.ir)));

  renderEquipos(); renderCriterios();
  iniciarZona();
  cambiarRecurso().then(cargarDemanda);
}

iniciar();
