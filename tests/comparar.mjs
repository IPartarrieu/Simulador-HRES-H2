// Compara los métodos de optimización con el mismo presupuesto de simulaciones, en el caso de la tesis.
// Uso: node tests/comparar.mjs [h] [presupuesto] [semillas]
import { readFileSync } from "node:fs";
import { decodificarSerie } from "../assets/codec.js";
import { CATALOGO, ECONOMIA_TESIS, prepararCaso, simular, violacion, limitesPorDefecto } from "../assets/model.js";
import { monteCarlo, correrHA, genetico, shade, aptitud } from "../assets/optimizers.js";

const h = Number(process.argv[2] ?? 0), presupuesto = Number(process.argv[3] ?? 20000), nSemillas = Number(process.argv[4] ?? 5);
const datos = JSON.parse(readFileSync(new URL("../data/huichas_2018.json", import.meta.url)));
datos.demanda_kw = decodificarSerie(datos.demanda_codificada);
const ids = { wt: "gaia133", pv: "cs6u330", con: "conv1", ele: "pem3", ht: "tank03", fc: "pemfc3" };
const equipos = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, CATALOGO[k].find((d) => d.id === id)]));
const caso = prepararCaso({ demanda: datos.demanda_kw, wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, equipos, economia: ECONOMIA_TESIS });
const limites = limitesPorDefecto(caso, { wt: true, pv: true, hess: true }, true);

function evaluador() {
  let n = 0; const cache = new Map();
  const uno = (cfg) => {
    const k = cfg.join(",");
    let e = cache.get(k);
    if (!e) { n++; const r = simular(caso, cfg); e = { cfg: cfg.slice(), lcoe: r.lcoe, lole: r.lole, ens: r.ens, viol: violacion(r, h, caso, false) }; cache.set(k, e); }
    return e;
  };
  return { uno, lote: async (cfgs) => cfgs.map(uno), cuenta: () => n };
}

const metodos = {
  "Monte Carlo": (s) => { const ev = evaluador(); return monteCarlo({ limites, evaluar: ev.lote, muestras: presupuesto, semilla: s, detenido: () => false }).then((r) => ({ ...r, n: ev.cuenta() })); },
  "Híbrido (HA)": async (s) => {
    const ev = evaluador(); let mejor = null; let corrida = 0;
    while (ev.cuenta() < presupuesto) { const r = correrHA({ limites, evaluarUno: ev.uno, iteraciones: 1000, semilla: s * 1000 + corrida++ }); if (!mejor || aptitud(r.mejor) < aptitud(mejor)) mejor = r.mejor; }
    return { mejor, n: ev.cuenta() };
  },
  "Genético (GA)": (s) => { const ev = evaluador(); return genetico({ limites, evaluar: ev.lote, poblacion: 100, generaciones: Math.round(presupuesto / 70), semilla: s, detenido: () => ev.cuenta() >= presupuesto }).then((r) => ({ ...r, n: ev.cuenta() })); },
  "SHADE + pulido": (s) => { const ev = evaluador(); return shade({ limites, evaluar: ev.lote, poblacion: 60, generaciones: Math.round(presupuesto * 0.9 / 60), semilla: s, detenido: () => ev.cuenta() >= presupuesto }).then((r) => ({ ...r, n: ev.cuenta() })); },
};

console.log(`Caso tesis, h = ${h}, presupuesto ≈ ${presupuesto} simulaciones por corrida, ${nSemillas} semillas. Referencia del artículo (h=0, GA): 1,469 USD/kWh`);
for (const [nombre, correr] of Object.entries(metodos)) {
  const t0 = performance.now(); const lcoes = [];
  for (let s = 1; s <= nSemillas; s++) {
    const { mejor } = await correr(s);
    lcoes.push(mejor.viol > 0 ? Infinity : mejor.lcoe);
  }
  const fact = lcoes.filter(Number.isFinite);
  const media = fact.length ? fact.reduce((a, b) => a + b, 0) / fact.length : NaN;
  console.log(`${nombre.padEnd(15)} mejor ${Math.min(...lcoes).toFixed(4)} · media ${media.toFixed(4)} · peor ${Math.max(...lcoes).toFixed(4)} · factibles ${fact.length}/${nSemillas} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
