// 1) Despacho: compara la simulación horaria con el código Python de la tesis (funciones.py) en varias
//    configuraciones (LOLE, energía no suministrada, suministrada, pérdidas, H₂ final).
// 2) Costos: el NPC sigue el flujo de caja de HOMER Pro; se revisa con sus ecuaciones y ejemplos numéricos.
// Uso: node tests/validar.mjs
import { readFileSync } from "node:fs";
import { decodificarSerie } from "../assets/codec.js";
import { CATALOGO, ECONOMIA_TESIS, prepararCaso, simular, crf, tasaReal, npcUnidad } from "../assets/model.js";

const datos = JSON.parse(readFileSync(new URL("../data/ejemplo_45s_2018.json", import.meta.url)));
datos.demanda_kw = decodificarSerie(datos.demanda_codificada);
const ref = JSON.parse(readFileSync(new URL("./referencia_python.json", import.meta.url)));
const ids = { wt: "gaia133", pv: "cs6u330", con: "conv1", ele: "pem3", ht: "tank03", fc: "pemfc3" };
const equipos = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, CATALOGO[k].find((d) => d.id === id)]));
const caso = prepararCaso({ demanda: datos.demanda_kw, wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, equipos, economia: ECONOMIA_TESIS });

let fallas = 0;
const cerca = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
for (const [nombre, r] of Object.entries(ref)) {
  const js = simular(caso, r.config);
  const checks = [
    ["LOLE", js.lole, r.LOLE, 0], ["ENS", js.ens, r.ENS, 1e-6],
    ["E suministrada", js.eSum, r.Esum, 1e-6], ["Pérdidas", js.perdida, r.loss, 1e-6], ["H₂ final", js.eStrFinal, r.str_final, 1e-6],
  ];
  const malos = checks.filter(([, a, b, tol]) => !cerca(a, b, tol));
  fallas += malos.length;
  console.log(`${malos.length ? "✗" : "✓"} ${nombre.padEnd(7)} despacho · LOLE ${js.lole} (Python ${r.LOLE}) · ENS ${js.ens.toFixed(2)} (${r.ENS.toFixed(2)}) · LCOE HOMER ${js.lcoe}` +
    (malos.length ? "  → difiere: " + malos.map(([k, a, b]) => `${k} ${a} vs ${b}`).join(", ") : ""));
}

// Costos con las ecuaciones de HOMER (ejemplos de real_discount_rate, discount_factor y capital_recovery_factor).
const homer = [
  ["tasa real 8 % y 3,5 %", tasaReal(0.08, 0.035), 0.0435, 1e-3],
  ["factor de descuento 5 %, 12 años", crf(0.05, 12).df[12], 0.557, 1e-3],
  ["CRF 7 %, 5 años", crf(0.07, 5).coef, 0.2439, 1e-3],
];
const { df } = crf(0.05, 20);
const u = { ci: 1000, rep: 800, om: 10 }, om = [...Array(20).keys()].reduce((a, k) => a + 10 * df[k + 1], 0);
homer.push(
  ["vida = proyecto: el reemplazo del año 20 se anula con su residual", npcUnidad({ ...u, vu: 20 }, df, 20), 1000 + om, 1e-9],
  ["vida 25 > 20: residual 5/25", npcUnidad({ ...u, vu: 25 }, df, 20), 1000 + om - 800 * (5 / 25) * df[20], 1e-9],
  ["vida 15: reemplazo año 15, residual 10/15", npcUnidad({ ...u, vu: 15 }, df, 20), 1000 + om + 800 * df[15] - 800 * (10 / 15) * df[20], 1e-9],
);
for (const [nombre, a, b, tol] of homer) {
  const ok = cerca(a, b, tol); fallas += ok ? 0 : 1;
  console.log(`${ok ? "✓" : "✗"} HOMER: ${nombre} → ${a.toFixed(4)} (esperado ${b.toFixed(4)})`);
}

// Rendimiento: simulaciones anuales por segundo.
const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < 1000) { simular(caso, [11, 37659, 196, 347, 16455, 69]); k++; }
console.log(`Rendimiento: ${k} simulaciones anuales por segundo en un núcleo`);
process.exit(fallas ? 1 : 0);
