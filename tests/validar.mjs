// 1) Despacho: compara la simulación horaria con el código Python de la tesis (funciones.py) en varias
//    configuraciones (LOLE, energía no suministrada, suministrada, pérdidas, H₂ final).
// 2) Costos: el NPC sigue el flujo de caja de HOMER Pro; se revisa con sus ecuaciones y ejemplos numéricos.
// Uso: node tests/validar.mjs
import { readFileSync } from "node:fs";
import { decodificarSerie } from "../assets/codec.js";
import { CATALOGO, ECONOMIA_TESIS, prepararCaso, simular, crf, tasaReal, npcUnidad, potenciaWT, radiacionPanel } from "../assets/model.js";
import { factoresRelieve, ctEfectivo, estelaParque, eficienciaParque, distribucionPaneles, sombraFilas, proyeccion, interaccionPV, distribuirAerogeneradores, factorCeldasFV } from "../assets/zona.js";

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

// 3) Estelas (Jensen) y sombras. Viento siempre del norte a 8 m/s; dos aerogeneradores Gaia (D = 13 m) a 7D en
//    línea norte-sur: el de atrás recibe δ = (1 − √(1 − Ct))·(1/(1 + 0,075·14))², con el Ct de la curva de potencia.
const wt = equipos.wt, D = wt.rotor, h = 8760;
const clima = { v10_ms: Array(h).fill(8), v100_ms: Array(h).fill(8 * 10 ** (1 / 7)), temp_c: Array(h).fill(15), presion_hpa: Array(h).fill(1013.25), dir100_deg: Array(h).fill(0) };
const pr = proyeccion([-37, -72]), cuadro = [[-37.01, -72.01], [-37.01, -71.99], [-36.99, -71.99], [-36.99, -72.01]];
const P = (f) => potenciaWT(wt, [8], [clima.v100_ms[0]], [15], [1013.25], f)[0];
const dJ = (1 - Math.sqrt(1 - ctEfectivo(wt, clima))) / (1 + 2 * 0.075 * 7) ** 2;
const enLinea = estelaParque(cuadro, [pr.b([0, 3.5 * D]), pr.b([0, -3.5 * D])], { D, wt, clima, eje: 0 });
const lado = estelaParque(cuadro, [pr.b([0, 0]), pr.b([0, -7 * D]), pr.b([4 * D, 0])], { D, wt, clima, eje: 0 });
const seg = pr.a(lado.orden[1]);
const sp = distribucionPaneles(-37, { areaPanelM2: 2 }), b = (sp.beta * Math.PI) / 180;
const otros = [
  ["estela: 2 en línea con el viento (±0,1 % por el ancho del sector de 10°)", eficienciaParque(enLinea, 2), (P(1) + P(1 - dJ)) / (2 * P(1)), 1e-3],
  ["estela: el 2.º se pone al lado, no detrás (x del 2.º, m)", seg[0], 4 * D, 1e-6],
  ["estela: 1 aerogenerador no pierde nada", eficienciaParque(lado, 1), 1, 1e-9],
  ["sombra entre filas a −37°: entre 0,5 y 4 %", +(sp.sombra > 0.005 && sp.sombra < 0.04), 1, 0],
  ["sombra entre filas: con la mitad de separación, más pérdida", +(sombraFilas(-37, b, sp.gcr * 1.5) > sp.sombra), 1, 0],
];
// Interacción paneles-aerogeneradores: sin aerogeneradores no hay sombra; con la zona chica llena de ellos,
// el campo solar que comparte el terreno sí la recibe, y la simulación la descuenta de la energía FV.
const chica = [[-37.003, -72.003], [-37.003, -71.997], [-36.997, -71.997], [-36.997, -72.003]];
const opI = { D, sx: 7, sy: 4, eje: 0, compartir: true, libre: 1, hub: wt.hub, beta: 37, nMax: 150 };
const posI = distribuirAerogeneradores(chica, opI).posiciones, inter = interaccionPV(chica, posI, { ...opI, gcr: 0.5 }, null);
const filaN = (n, k) => inter.tabla[n * inter.K + k - 1];
const casoI = prepararCaso({ demanda: datos.demanda_kw, wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, equipos, economia: ECONOMIA_TESIS,
  campoFV: { ...inter, m2Panel: inter.m2Celda } });
const pvTotal = (c) => simular(c, [inter.nMax, inter.K, 0, 0, 0, 0], true).series.pv.reduce((x, y) => x + y, 0);
const pvSin = pvTotal(caso), pvCon = pvTotal(casoI);
otros.push(
  ["campo FV sin relieve ni aerogeneradores: solo la sombra entre filas", filaN(0, inter.K), 1 - sombraFilas(-37, b, 0.5), 2e-3],
  ["interacción: zona llena, la sombra de los aerogeneradores baja el factor", +(filaN(inter.nMax, inter.K) < filaN(0, inter.K)), 1, 0],
  ["interacción: la simulación aplica el factor del campo FV", pvCon / pvSin, filaN(inter.nMax, inter.K), 1e-6],
);
// Ladera de 10 % (5,7°): al norte las filas se sombrean menos que en plano; al sur, más.
const ladera = (k) => ({ x0: -500, x1: 500, y0: -500, y1: 500, n: 64, elev: Array.from({ length: 64 * 64 }, (_, q) => k * (500 - (Math.floor(q / 64) / 63) * 1000)) });
const fl = (rel) => factorCeldasFV([[0, 0]], rel, { lat: -37, beta: 37, gcr: 0.5 })[0];
otros.push(
  ["ladera al norte rinde más que el plano", +(fl(ladera(-0.1)) > fl(null)), 1, 0],
  ["ladera al sur rinde menos que el plano", +(fl(ladera(0.1)) < fl(null)), 1, 0],
);
// Hidrógeno en operación real: con carga mínima, auxiliares y compresión entra menos H₂ que con el despacho ideal,
// y con todo en cero el resultado es idéntico.
const cfgH = [11, 37659, 196, 347, 16455, 69];
const casoH = (h2) => prepararCaso({ demanda: datos.demanda_kw, wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, equipos, economia: ECONOMIA_TESIS, h2 });
const cero = { ele: { cargaMin: 0, aux: 0 }, comp: 0, fc: { cargaMin: 0, aux: 0 } }, real = { ele: { cargaMin: 0.1, aux: 0.03 }, comp: 2.5 / 33.33, fc: { cargaMin: 0.05, aux: 0.03 } };
const rIdeal = simular(caso, cfgH), rCero = simular(casoH(cero), cfgH), rReal = simular(casoH(real), cfgH);
const soloComp = simular(casoH({ ...cero, comp: 2.5 / 33.33 }), cfgH);
otros.push(
  ["H₂ con parámetros en cero = tesis (LCOE)", rCero.lcoe, rIdeal.lcoe, 0],
  ["H₂ real: más energía no suministrada", +(rReal.ens > rIdeal.ens), 1, 0],
  ["electrolizador real (sin cambiar la celda): entra menos hidrógeno", +(simular(casoH({ ...real, fc: cero.fc }), cfgH).h2Entra < rIdeal.h2Entra), 1, 0],
  ["H₂ real: no mejora la confiabilidad", +(rReal.lole >= rIdeal.lole), 1, 0],
  ["compresión sola: menos H₂ que el ideal", +(soloComp.h2Entra < rIdeal.h2Entra), 1, 0],
);
// Varios años: el mismo año repetido dos veces da casi la misma energía anual; los gráficos traen un año.
const doble = (x) => [...x, ...x];
const caso2 = prepararCaso({ demanda: datos.demanda_kw, wtKw: doble(datos.tesis.wt_kw), pvKw: doble(datos.tesis.pv_kw), equipos, economia: ECONOMIA_TESIS });
const r1 = simular(caso, cfgH), r2 = simular(caso2, cfgH, true);
otros.push(
  ["2 años iguales: energía anual ≈ la de 1 año", r2.eSum / r1.eSum, 1, 0.01],
  ["2 años: las series de los gráficos son de un año", r2.series.d.length, 8760, 0],
);
// Curvas del fabricante (1,225 kg/m³): la simulación debe devolver los valores de la tabla.
const curva = (id, v) => potenciaWT({ ...CATALOGO.wt.find((x) => x.id === id), curva: "fabricante" }, [v], [v], [15], [1013.25])[0];
otros.push(
  ["Bergey Excel 10 certificado a 7 m/s (kW)", curva("bergey10", 7), 2.403, 1e-3],
  ["Bergey Excel 10 a 16,5 m/s: 12,6 kW, sobre la nominal", curva("bergey10", 16.5), 12.555, 1e-3],
  ["NPS 100C-24 a 8,5 m/s, interpolada (kW)", curva("nps100", 8.5), (58.7 + 74.8) / 2, 1e-3],
);
// Radiación sobre el panel (Hay-Davies) contra la radiación inclinada de ERA5 en Talca (panel a 35° al norte).
const talca = JSON.parse(readFileSync(new URL("../data/clima/talca.json", import.meta.url)));
const poaT = radiacionPanel(talca, { montaje: "fija", beta: talca.inclinacion }), gtiT = talca.gti_wm2;
const suma = (x) => x.reduce((p, q) => p + q, 0), mx = suma(poaT) / 8760, my = suma(gtiT) / 8760;
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < 8760; i++) { sxy += (poaT[i] - mx) * (gtiT[i] - my); sxx += (poaT[i] - mx) ** 2; syy += (gtiT[i] - my) ** 2; }
otros.push(
  ["panel fijo: correlación horaria con ERA5 > 0,99", +(sxy / Math.sqrt(sxx * syy) > 0.99), 1, 0],
  ["panel fijo: energía anual como ERA5 (±5 %)", suma(poaT) / suma(gtiT), 1, 0.05],
  ["seguidor: 10-30 % más que fijo", +(suma(radiacionPanel(talca, { montaje: "seguidor" })) / suma(poaT) - 1 > 0.1 && suma(radiacionPanel(talca, { montaje: "seguidor" })) / suma(poaT) - 1 < 0.3), 1, 0],
);
// Viento sobre el relieve (modelo simplificado): en plano no cambia nada; en una loma aislada, la cima recibe más
// viento que el llano (en promedio de los sectores) y el promedio del área se mantiene.
const loma = (h) => ({ x0: -3000, x1: 3000, y0: -3000, y1: 3000, n: 64, elev: Array.from({ length: 64 * 64 }, (_, q) => {
  const x = -3000 + ((q % 64) / 63) * 6000, y = 3000 - (Math.floor(q / 64) / 63) * 6000; return h * Math.exp(-(x * x + y * y) / (2 * 400 ** 2)); }) });
const media36 = (f, k) => { let m = 0; for (let s = 0; s < 36; s++) m += f[k * 36 + s]; return m / 36; };
const fPlano = factoresRelieve(loma(0), [[0, 0]]), fLoma = factoresRelieve(loma(100), [[0, 0], [2500, 0]]);
otros.push(
  ["relieve plano: factor 1", media36(fPlano, 0), 1, 1e-9],
  ["loma de 100 m: la cima recibe más viento que el llano", +(media36(fLoma, 0) > 1.1 && media36(fLoma, 0) > media36(fLoma, 1)), 1, 0],
);
// Equipo como variable: elegir el índice 1 da lo mismo que armar el caso con ese equipo directamente.
const fcCaro = { ...equipos.fc, ci: equipos.fc.ci * 2, rep: equipos.fc.rep * 2 }, eleOtro = CATALOGO.ele.find((x) => x.id === "ael5");
const base = { demanda: datos.demanda_kw, wtKw: datos.tesis.wt_kw, pvKw: datos.tesis.pv_kw, economia: ECONOMIA_TESIS };
const conCand = prepararCaso({ ...base, equipos, candidatos: { fc: [null, { eq: fcCaro }], ele: [null, { eq: eleOtro }] } });
const directo = prepararCaso({ ...base, equipos: { ...equipos, fc: fcCaro, ele: eleOtro } });
const c16 = [...cfgH, 0, 0, 0, 0, 0, 0, 0, 0], c16b = [...cfgH, 0, 0, 0, 0, 0, 0, 0, 0];
c16b[8 + 3] = 1; c16b[8 + 5] = 1;
otros.push(
  ["equipo variable: índices en 0 = caso base", simular(conCand, c16).lcoe, simular(caso, cfgH).lcoe, 0],
  ["equipo variable: índices 1 = caso con esos equipos", simular(conCand, c16b).lcoe, simular(directo, cfgH).lcoe, 0],
  ["equipo variable: misma confiabilidad", simular(conCand, c16b).lole, simular(directo, cfgH).lole, 0],
);
for (const [nombre, a, e, tol] of otros) {
  const ok = cerca(a, e, tol); fallas += ok ? 0 : 1;
  console.log(`${ok ? "✓" : "✗"} ${nombre} → ${a.toFixed(4)} (esperado ${e.toFixed(4)})`);
}

// Rendimiento: simulaciones anuales por segundo.
const t0 = performance.now(); let k = 0;
while (performance.now() - t0 < 1000) { simular(caso, [11, 37659, 196, 347, 16455, 69]); k++; }
console.log(`Rendimiento: ${k} simulaciones anuales por segundo en un núcleo`);
process.exit(fallas ? 1 : 0);
