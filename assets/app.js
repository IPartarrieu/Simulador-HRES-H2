// Página del Simulador HRES-H2: arma el caso con lo que elige la persona, reparte las simulaciones entre
// Web Workers, ejecuta el método de optimización (uno o varios objetivos) y muestra los resultados.
import { CATALOGO, MODULOS, NOMBRES, ECONOMIA_TESIS, FUENTES, OBJETIVOS_MO, potenciaPV, potenciaWT, limitesPorDefecto } from "./model.js";
import { monteCarlo, genetico, shade, pso, gwo, woa, eo, nsga2, mopso, aptitud, PENALIZACION } from "./optimizers.js";
import * as dem from "./demand.js";
import { svgDiagrama, descargarSVG, descargarPNG, descargar } from "./diagram.js";

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
  wt: [["pr", "Potencia nominal (kW)"], ["vcin", "V. de arranque (m/s)"], ["vr", "V. nominal (m/s)"], ["vcout", "V. de corte (m/s)"], ["hub", "Altura del buje (m)"], ...COSTOS],
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
const POSITIVOS = ["pr", "cap", "eta", "eff", "etaC", "etaD", "cRate", "ciclos", "vidaH", "fpv"];
const HASTA_UNO = ["eta", "etaC", "etaD", "socMin", "cargaMin", "fpv", "autod"];
const UNIDAD = { wt: "kW", pv: "kW", con: "kW", ele: "kW", ht: "kWh", fc: "kW", bat: "kWh", dg: "kW" };
const COLORES = { wt: "#2A9D8F", pv: "#E9A23B", con: "#7F8C9D", ele: "#3E7BD6", ht: "#6C5CE7", fc: "#5BC2B4", bat: "#3FAE6A", dg: "#B5651D" };

const poblacional = (nombre) => [["poblacion", nombre, 50], ["generaciones", "Iteraciones", 200]];
const METODOS = {
  shade: {
    nombre: "Evolución diferencial adaptativa (SHADE) · recomendado",
    desc: "Adapta sus parámetros, usa reglas de factibilidad y termina con una búsqueda local entera. Fue el más estable en las pruebas con el caso de la tesis.",
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
    desc: "Cerco de la presa y ataque en espiral. Fue el mejor de cuatro métodos en Diab et al. (2019), pero en el caso de la tesis sus resultados varían más entre corridas.",
    params: poblacional("Ballenas"), rapido: { poblacion: 40, generaciones: 100 }, tesis: null, fn: woa,
    evals: (p) => p.poblacion * (p.generaciones + 1) + 400,
  },
  ga: {
    nombre: "Algoritmo genético (tesis)",
    desc: "Como en la tesis (DEAP): torneo de 3, cruce en dos puntos y mutación entera uniforme. Las soluciones que no cumplen la confiabilidad se penalizan.",
    params: [["poblacion", "Población", 100], ["generaciones", "Generaciones", 150], ["cxpb", "Prob. de cruce", 0.7], ["mutpb", "Prob. de mutación", 0.2], ["indpb", "Prob. por gen", 0.2]],
    rapido: { poblacion: 80, generaciones: 80 }, tesis: { poblacion: 500, generaciones: 1000 }, fn: genetico,
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
  demanda: null, demandaNombre: "", demandaTipo: "huichas",
  recurso: "tesis", clima: null, climaNombre: "",
  arq: { wt: true, pv: true, hess: true, bat: false, dg: false },
  equipos: Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === DEFECTO_IDS[k]))])),
  limites: null, limitesEditados: false,
  resultado: null, pareto: null, corriendo: false,
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
const musd = (v) => `${fmt(v / 1e6, 2)} MUSD`;

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
  return estado.demandaTipo === "huichas" && estado.recurso === "tesis" && a.wt && a.pv && a.hess && !a.bat && !a.dg &&
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
  return { demanda: Array.from(estado.demanda), wtKw: Array.from(s.wt), pvKw: Array.from(s.pv), equipos: clonar(estado.equipos), economia: leerEconomia() };
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
  $$("#paso-demanda input, #paso-demanda button, #paso-recurso input, #paso-recurso button, #paso-arquitectura input, #paso-criterios input, #paso-criterios select, #metodo, #opt-semilla, #opt-hilos, #btn-tesis, #preset-rapido, #preset-tesis, #limites-auto")
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
    const snap = { equipos: clonar(estado.equipos), arq: clonar(estado.arq), economia: leerEconomia() };
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
  const snap = { equipos: clonar(estado.equipos), arq: clonar(estado.arq), economia: leerEconomia() };
  await simularCon(await armarCaso(), crit, cfg, { metodo: "Configuración ingresada a mano", crit, snap, manual: true });
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
  const bloquearCSV = estado.demandaTipo === "huichas" || estado.demandaTipo === "sintetica";
  $("#dl-csv").disabled = bloquearCSV;
  $("#dl-csv").title = bloquearCSV ? "La demanda de Las Huichas es de terceros: sus series horarias no se descargan." : "";
  $("#dl-csv-nota").hidden = !bloquearCSV;
  estado.resultado = { cfg, r, meta, arq, equipos, economia, demandaNombre: estado.demandaNombre, demandaTipo: estado.demandaTipo,
    recurso: estado.recurso === "tesis" ? "Serie de la tesis (Las Huichas 2018)" : estado.recurso === "era5" ? "ERA5, Las Huichas 2018" : estado.climaNombre };
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
  if (pen && meta.obj !== undefined) { const n = nombreObjetivo(crit); tarjetas.push(kpi(n[0].toUpperCase() + n.slice(1), valorObjetivo(crit, meta.obj), "valor que se minimizó")); }
  $("#kpis").replaceChildren(...tarjetas);

  const aviso = $("#aviso");
  aviso.hidden = cumple;
  if (!cumple) {
    aviso.textContent = meta.manual
      ? `Esta configuración no cumple la confiabilidad pedida (${textoConfiabilidad(crit)}): tiene ${fmt(r.lole)} horas con déficit y una LPSP de ${fmt(r.lpsp * 100, 3)} %.`
      : `El método no encontró una configuración que cumpla la confiabilidad pedida (${textoConfiabilidad(crit)}). Se muestra la más cercana. Prueba con más generaciones, corridas o muestras, o amplía los límites de búsqueda.`;
  }

  const ref = REF_TESIS[crit.h], box = $("#referencia");
  if (esCasoTesis() && ref && lole && !crit.usarEnergia && crit.objetivo === "lcoe" && !pen && crit.modo !== "mo" && !cfg[6] && !cfg[7]) {
    const dif = ((r.lcoe - ref.lcoe) / ref.lcoe) * 100;
    box.hidden = false;
    box.textContent = `Referencia del artículo para h = ${crit.h}: LCOE ${fmt(ref.lcoe, 3)} USD/kWh con el ${ref.metodo} (${ref.cfg.map((v) => fmt(v)).join(" · ")}). ` +
      `Este resultado: ${fmt(r.lcoe, 4)} USD/kWh, ${Math.abs(dif) < 0.005 ? "igual" : dif < 0 ? `${fmt(-dif, 2)} % menor` : `${fmt(dif, 2)} % mayor`}.`;
  } else box.hidden = true;

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
  grafico("graf-costos", {
    type: "doughnut",
    data: { labels: MODULOS.map((m) => NOMBRES[m]), datasets: [{ data: MODULOS.map((m, i) => npcModulo(i, cfg, r)), backgroundColor: MODULOS.map((m) => COLORES[m]) }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: "right", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${musd(c.raw)} (${fmt((c.raw / r.npc) * 100, 1)} %)` } } } },
  });
  if (desplazarA) $(desplazarA).scrollIntoView({ behavior: "smooth", block: "start" });
}

function descargarCSV() {
  const res = estado.resultado;
  if (!res || res.demandaTipo === "huichas" || res.demandaTipo === "sintetica") return;
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

/* ---------- Caso de la tesis ---------- */

async function cargarCasoTesis() {
  $('input[name="demanda"][value="huichas"]').checked = true;
  $('input[name="recurso"][value="tesis"]').checked = true;
  $("#arq-wt").checked = $("#arq-pv").checked = $("#arq-hess").checked = true;
  $("#arq-bat").checked = $("#arq-dg").checked = false;
  estado.equipos = Object.fromEntries(MODULOS.map((k) => [k, clonar(CATALOGO[k].find((d) => d.id === DEFECTO_IDS[k]))]));
  $("#eco-dn").value = 8; $("#eco-ie").value = 3; $("#eco-anios").value = 20; $("#eco-reserva").value = 10; $("#eco-diesel").value = 1;
  $("#conf-tipo").value = "lole"; $("#conf-h").value = 0; $("#conf-energia").checked = false;
  $('input[name="modo"][value="uno"]').checked = true; $("#obj-unico").value = "lcoe";
  $("#pen-exc").value = 0; $("#pen-h2").value = 0;
  estado.limitesEditados = false;
  await cambiarRecurso();
  await cargarDemanda();
  $("#paso-optimizacion").scrollIntoView({ behavior: "smooth", block: "start" });
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
  $("#dl-csv").addEventListener("click", descargarCSV);
  $("#dl-json").addEventListener("click", descargarJSON);

  renderEquipos(); renderCriterios();
  cambiarRecurso().then(cargarDemanda);
}

iniciar();
