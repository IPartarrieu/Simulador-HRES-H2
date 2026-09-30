// Compara el motor en JavaScript con el código Python de la tesis (funciones.py) en varias configuraciones.
// Uso: node tests/validar.mjs
import { readFileSync } from "node:fs";
import { decodificarSerie } from "../assets/codec.js";
import { CATALOGO, ECONOMIA_TESIS, prepararCaso, simular } from "../assets/model.js";

const datos = JSON.parse(readFileSync(new URL("../data/huichas_2018.json", import.meta.url)));
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
    ["LCOE", js.lcoe, r.LCOE, 1e-9], ["LOLE", js.lole, r.LOLE, 0], ["ENS", js.ens, r.ENS, 1e-6],
    ["E suministrada", js.eSum, r.Esum, 1e-6], ["Pérdidas", js.perdida, r.loss, 1e-6], ["H₂ final", js.eStrFinal, r.str_final, 1e-6],
  ];
  const malos = checks.filter(([, a, b, tol]) => !cerca(a, b, tol));
  fallas += malos.length;
  console.log(`${malos.length ? "✗" : "✓"} ${nombre.padEnd(7)} LCOE ${js.lcoe} (Python ${r.LCOE}) · LOLE ${js.lole} (${r.LOLE})` +
    (malos.length ? "  → difiere: " + malos.map(([k, a, b]) => `${k} ${a} vs ${b}`).join(", ") : ""));
}

// Rendimiento: simulaciones anuales por segundo.
const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < 1000) { simular(caso, [11, 37659, 196, 347, 16455, 69]); k++; }
console.log(`Rendimiento: ${k} simulaciones anuales por segundo en un núcleo`);
process.exit(fallas ? 1 : 0);
