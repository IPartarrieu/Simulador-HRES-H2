// Revisa los métodos multiobjetivo en el caso de Las Huichas con baterías y diésel: el frente debe tener
// solo configuraciones factibles, sin repetidas y no dominadas entre sí, y sus objetivos deben coincidir con
// una simulación nueva de cada configuración.
// Uso: node tests/multiobjetivo.mjs
import { readFileSync } from "node:fs";
import { decodificarSerie } from "../assets/codec.js";
import { CATALOGO, ECONOMIA_TESIS, prepararCaso, evaluacion, limitesPorDefecto } from "../assets/model.js";
import { nsga2, mopso, domina } from "../assets/optimizers.js";

const datos = JSON.parse(readFileSync(new URL("../data/huichas_2018.json", import.meta.url)));
const equipos = Object.fromEntries(Object.keys(CATALOGO).map((k) => [k, CATALOGO[k][0]]));
equipos.dg = CATALOGO.dg.find((d) => d.id === "dg50");
const caso = prepararCaso({ demanda: decodificarSerie(datos.demanda_codificada), wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, equipos, economia: ECONOMIA_TESIS });
const limites = limitesPorDefecto(caso, { wt: true, pv: true, hess: true, bat: true, dg: true }, false);

let fallas = 0;
const revisar = (ok, texto) => { if (!ok) fallas++; console.log(`${ok ? "✓" : "✗"} ${texto}`); };

for (const [nombre, metodo, mo] of [["NSGA-II", nsga2, ["lcoe", "lpsp"]], ["MOPSO", mopso, ["lcoe", "lpsp"]], ["NSGA-II", nsga2, ["npc", "capex", "co2"]]]) {
  const crit = { tipo: "lpsp", lpspMax: 0.05, objetivo: "lcoe", mo };
  const evaluar = async (cfgs) => cfgs.map((c) => evaluacion(caso, c, crit));
  const t0 = performance.now();
  const { frente } = await metodo({ limites, evaluar, poblacion: 60, generaciones: 60, semilla: 3, detenido: () => false });
  const seg = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n${nombre} (${mo.join(", ")}): ${frente.length} soluciones en ${seg} s`);
  revisar(frente.length >= 5, "el frente tiene al menos 5 soluciones");
  revisar(frente.every((e) => e.viol === 0), "todas cumplen LPSP ≤ 5 %");
  revisar(new Set(frente.map((e) => e.cfg.join(","))).size === frente.length, "sin configuraciones repetidas");
  revisar(!frente.some((a) => frente.some((b) => b !== a && domina(b, a))), "ninguna está dominada por otra del frente");
  revisar(frente.every((e) => evaluacion(caso, e.cfg, crit).objs.every((v, k) => v === e.objs[k])), "los objetivos coinciden con una simulación nueva");
  const a = frente[0], b = frente[frente.length - 1];
  console.log(`  extremos: ${mo.map((k, i) => `${k} ${a.objs[i].toPrecision(4)} → ${b.objs[i].toPrecision(4)}`).join(" · ")}`);
}
console.log(fallas ? `\n${fallas} revisiones fallaron` : "\nTodo bien");
process.exit(fallas ? 1 : 0);
