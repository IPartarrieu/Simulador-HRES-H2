// Zona del proyecto: mapa del centro-sur de Chile (regiones del Maule a la Araucanía) donde se dibuja un
// polígono. Calcula su superficie (geodésica) y su elevación con el modelo Copernicus DEM (90 m) a través de
// la API de elevación de Open-Meteo. Usa Leaflet (global L, en vendor/leaflet).

// ponytail: rectángulo que cubre las cuatro regiones, no su límite exacto; usar un GeoJSON regional si hace falta precisión.
export const REGION = { latMin: -39.7, latMax: -34.6, lonMin: -74.0, lonMax: -70.3 };
export const AREA_MAX_KM2 = 25;          // límite para que la zona sea un terreno, no una comuna entera
import { potenciaWT } from "./model.js?v=20261015e";

const R = 6378137;
const rad = (g) => (g * Math.PI) / 180, grados = (r) => (r * 180) / Math.PI;

export function enRegion([lat, lon]) {
  return lat >= REGION.latMin && lat <= REGION.latMax && lon >= REGION.lonMin && lon <= REGION.lonMax;
}

// Superficie de un polígono sobre la esfera (m²), con vértices [lat, lon].
export function areaM2(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length];
    s += rad(lo2 - lo1) * (2 + Math.sin(rad(la1)) + Math.sin(rad(la2)));
  }
  return Math.abs((s * R * R) / 2);
}

export function dentro([lat, lon], pts) {
  let adentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ya, xa] = pts[i], [yb, xb] = pts[j];
    if (ya > lat !== yb > lat && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) adentro = !adentro;
  }
  return adentro;
}

export function centro(pts) {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

export function distanciaKm([la1, lo1], [la2, lo2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Hasta 100 puntos en una grilla dentro del polígono (más el centro y los vértices si la zona es muy angosta).
export function muestras(pts, n = 100) {
  const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
  const [a0, a1, o0, o1] = [Math.min(...la), Math.max(...la), Math.min(...lo), Math.max(...lo)];
  const k = Math.max(2, Math.floor(Math.sqrt(n)));
  const out = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const p = [a0 + ((i + 0.5) / k) * (a1 - a0), o0 + ((j + 0.5) / k) * (o1 - o0)];
    if (dentro(p, pts)) out.push(p);
  }
  return out.length >= 5 ? out : [...out, centro(pts), ...pts].slice(0, n);
}

export async function elevacion(pts) {
  const m = muestras(pts);
  const q = new URLSearchParams({ latitude: m.map((p) => p[0].toFixed(5)).join(","), longitude: m.map((p) => p[1].toFixed(5)).join(",") });
  const resp = await fetch(`https://api.open-meteo.com/v1/elevation?${q}`);
  const d = await resp.json();
  if (!resp.ok || d.error || !Array.isArray(d.elevation)) throw new Error(d.reason || `Open-Meteo respondió ${resp.status}`);
  const e = d.elevation.filter(Number.isFinite);
  return { min: Math.min(...e), max: Math.max(...e), media: e.reduce((a, b) => a + b, 0) / e.length, n: e.length };
}

/* ---------- Distribución de equipos dentro de la zona ---------- */

// Coordenadas locales en metros (x al este, y al norte) alrededor de un origen; suficiente para zonas de pocos km.
export function proyeccion([lat0, lon0]) {
  const kx = 111320 * Math.cos(rad(lat0)), ky = 110540;
  return { a: ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky], b: ([x, y]) => [lat0 + y / ky, lon0 + x / kx] };
}
function distSegmento([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Aerogeneradores en grilla: separación sx·D en la dirección del viento y sy·D en la transversal, con retiro
// desde el borde. eje: dirección dominante del viento (grados desde el norte; da lo mismo el sentido). Prueba
// filas alineadas y escalonadas con varios desfases y se queda con la que cabe más. Las posiciones vuelven
// ordenadas por fila transversal al viento, desde la más cercana al centro de la zona: con pocos equipos se llena
// primero una fila (sin estelas entre ellos) y quedan cerca del bloque de potencia.
export function distribuirAerogeneradores(pts, { D, sx = 7, sy = 4, retiro = 0, eje = 0, max = 20000 }) {
  const pr = proyeccion(centro(pts)), poli = pts.map(pr.a);
  const u = [Math.sin(rad(eje)), Math.cos(rad(eje))], w = [u[1], -u[0]];     // a lo largo y a lo ancho del viento
  const loc = poli.map(([x, y]) => [x * u[0] + y * u[1], x * w[0] + y * w[1]]);
  const A = loc.map((p) => p[0]), B = loc.map((p) => p[1]);
  const da = sx * D, db = sy * D;
  const [a0, a1, b0, b1] = [Math.min(...A), Math.max(...A), Math.min(...B), Math.max(...B)];
  if (((a1 - a0) / da + 2) * ((b1 - b0) / db + 2) > max) return { posiciones: [], demasiadas: true, celdaM2: da * db };
  const valido = (p) => dentro(p, loc) && loc.every((q, i) => distSegmento(p, q, loc[(i + 1) % loc.length]) >= retiro);
  let mejor = [];
  for (const escalonado of [false, true]) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const out = [];
    for (let a = a0 + (i / 4) * da, f = 0; a <= a1; a += da, f++) {
      for (let b = b0 + (j / 4) * db + (escalonado && f % 2 ? db / 2 : 0); b <= b1; b += db) if (valido([a, b])) out.push([a, b]);
    }
    if (out.length > mejor.length) mejor = out;
  }
  const posiciones = mejor.sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]) || p[0] - q[0] || Math.abs(p[1]) - Math.abs(q[1]))
    .map(([a, b]) => pr.b([a * u[0] + b * w[0], a * u[1] + b * w[1]]));
  return { posiciones, celdaM2: da * db };
}

// Posición del sol en hora solar (declinación de Cooper): altura y azimut desde el norte (horario), en radianes.
function sol(lat, dia, hora) {
  const d = rad(23.45) * Math.sin((2 * Math.PI * (284 + dia)) / 365), w = rad(15 * (hora - 12)), f = rad(lat);
  const sa = Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(w), alt = Math.asin(sa);
  const az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(d) - sa * Math.sin(f)) / (Math.cos(alt) * Math.cos(f)))));
  return { alt, az: w > 0 ? 2 * Math.PI - az : az };
}
// Radiación de cielo despejado sobre un panel inclinado beta hacia el norte: haz directo (Meinel) y difusa
// isotrópica (10 % del haz). Muestras cada `dd` días y `dh` horas; solo horas con el sol sobre 3°.
function cieloDespejado(lat, beta, dd, dh) {
  const out = [];
  for (let dia = 1; dia <= 365; dia += dd) for (let h = 4 + dh / 2; h < 20; h += dh) {
    const s = sol(lat, dia, h);
    if (s.alt < rad(3)) continue;
    const dni = 1367 * Math.pow(0.7, Math.pow(1 / Math.sin(s.alt), 0.678));
    const cosi = Math.sin(s.alt) * Math.cos(beta) + Math.cos(s.alt) * Math.sin(beta) * Math.cos(s.az);
    const haz = dni * Math.max(0, cosi);
    out.push({ ...s, haz, total: haz + (0.1 * dni * Math.sin(s.alt) * (1 + Math.cos(beta))) / 2 });
  }
  return out;
}
// Ángulo de perfil: altura del sol vista en el plano norte-sur, el que define la sombra de una fila sobre la siguiente.
const perfil = (s) => Math.atan(Math.tan(s.alt) / Math.cos(s.az));

// Pérdida anual por sombra entre filas: fracción del haz directo que cae en la parte sombreada de la mesa
// (1 − (pitch/L)·sen αp / sen(αp + β)), sobre la radiación total de cielo despejado.
// ponytail: cielo despejado y pérdida proporcional al área sombreada; con nubes la pérdida real es menor, y los
// diodos de bypass pueden hacerla algo mayor en mesas en horizontal.
export function sombraFilas(lat, beta, gcr) {
  let perd = 0, tot = 0;
  for (const s of cieloDespejado(lat, beta, 2, 0.5)) {
    tot += s.total;
    if (!s.haz || Math.cos(s.az) <= 0) continue;
    const ap = perfil(s);
    perd += s.haz * Math.max(0, Math.min(1, 1 - Math.sin(ap) / (gcr * Math.sin(ap + beta))));
  }
  return tot ? perd / tot : 0;
}

// Paneles en filas orientadas al norte, inclinados en β, separados para no sombrearse entre las 10 y las 14 h
// solares del solsticio de invierno (criterio usual de diseño). GCR = largo de la mesa / distancia entre filas.
// aprovechamiento: fracción del terreno libre que queda para las mesas (caminos, inversores, bordes).
export function distribucionPaneles(lat, { areaPanelM2, aprovechamiento = 0.85 }) {
  const beta = Math.min(60, Math.round(Math.abs(lat)));
  const alfa = Math.max(5, grados(perfil(sol(lat, 172, 10))));            // 21 de junio, 10 h solares
  const gcr = 1 / (Math.cos(rad(beta)) + Math.sin(rad(beta)) / Math.tan(rad(alfa)));
  return { beta, alfa, gcr, m2PorPanel: areaPanelM2 / (gcr * aprovechamiento), sombra: sombraFilas(lat, rad(beta), gcr) };
}

// Sombra de UN aerogenerador sobre las celdas del campo solar: fracción anual de la radiación de cada celda que
// tapa. La torre tapa la franja que cubre y el rotor, al girar, solo su solidez (~6 % del área barrida). Sombra
// proyectada sobre el suelo; la de varios aerogeneradores se suma. Devuelve [[celda, pérdida], …] (solo las > 0).
const SOLIDEZ = 0.06;
function sombraDe([tx, ty], celdas, soles, { hub, D, lado }) {
  const R = D / 2, ancho = Math.max(0.3, hub / 30), alcance = hub / Math.tan(rad(8)) + R + lado;
  const fTorre = Math.min(1, ancho / lado), fRotor = SOLIDEZ * Math.min(1, (Math.PI * R * R) / (lado * lado));
  const out = [];
  celdas.forEach(([x, y], i) => {
    const px = x - tx, py = y - ty;
    if (Math.hypot(px, py) >= alcance) return;
    let perd = 0;
    for (const s of soles) {
      const sx = s.ux * hub, sy = s.uy * hub;                // sombra del buje
      let f = 0;
      if (distSegmento([px, py], [0, 0], [sx, sy]) < lado / 2) f += fTorre;
      if (Math.hypot(px - sx, py - sy) < R + lado / 2) f += fRotor;
      perd += s.haz * Math.min(1, f);
    }
    if (perd) out.push([i, perd]);
  });
  return out;
}
// Soles para la sombra de los aerogeneradores (cada 10 días y 1 h; basta para un promedio anual). Bajo 8° de
// altura el haz directo es débil y las sombras, muy largas: se omiten.
function solesSombra(lat, beta) {
  const todos = cieloDespejado(lat, beta, 10, 1), tot = todos.reduce((a, s) => a + s.total, 0);
  return todos.filter((s) => s.haz && s.alt >= rad(8)).map((s) => ({ haz: s.haz / tot, ux: -Math.sin(s.az) / Math.tan(s.alt), uy: -Math.cos(s.az) / Math.tan(s.alt) }));
}

// Celdas cuadradas (hasta ~3000) dentro de la zona, en metros locales, para armar el campo solar.
function celdasZona(pts) {
  const pr = proyeccion(centro(pts)), poli = pts.map(pr.a);
  const X = poli.map((p) => p[0]), Y = poli.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...X), Math.max(...X), Math.min(...Y), Math.max(...Y)];
  const lado = Math.max(5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000));
  const poliYX = poli.map(([x, y]) => [y, x]), celdas = [];
  for (let x = x0 + lado / 2; x < x1; x += lado) for (let y = y0 + lado / 2; y < y1; y += lado) if (dentro([y, x], poliYX)) celdas.push([x, y]);
  return { pr, poli, lado, celdas, c: pr.a(centro(pts)) };
}

// Terreno que cada aerogenerador quita a los paneles. Sin compartir: toda su celda de separación (sx·D × sy·D).
// Compartiendo: solo un círculo de radio libre·D alrededor de la torre (fundación, plataforma de grúa, acceso);
// los paneles pueden ir entre los aerogeneradores, pero ahí reciben su sombra.
function ocupaCeldas([tx, ty], celdas, { D, sx, sy, eje, compartir, libre }) {
  const u = [Math.sin(rad(eje)), Math.cos(rad(eje))], w = [u[1], -u[0]], out = [];
  celdas.forEach(([x, y], i) => {
    const dx = x - tx, dy = y - ty;
    if (compartir ? Math.hypot(dx, dy) < libre * D : Math.abs(dx * u[0] + dy * u[1]) < (sx * D) / 2 && Math.abs(dx * w[0] + dy * w[1]) < (sy * D) / 2) out.push(i);
  });
  return out;
}
export const areaExclusiva = ({ D, sx, sy, compartir, libre }) => (compartir ? Math.PI * (libre * D) ** 2 : sx * D * sy * D);

// Orden en que se llena el campo solar: la celda libre más cercana al centro es para el bloque de potencia; luego,
// desde el centro hacia afuera, las que la sombra de los aerogeneradores tapa menos de 0,5 % al año, y al final las
// demás, de menos a más sombra.
function ordenCeldas(celdas, c, ocupada, perd) {
  const d2 = (i) => (celdas[i][0] - c[0]) ** 2 + (celdas[i][1] - c[1]) ** 2;
  const libres = [];
  for (let i = 0; i < celdas.length; i++) if (!ocupada[i]) libres.push(i);
  if (!libres.length) return { bloque: -1, orden: [] };
  let bloque = libres[0];
  for (const i of libres) if (d2(i) < d2(bloque)) bloque = i;
  const malo = (i) => perd[i] > 0.005;
  const orden = libres.filter((i) => i !== bloque).sort((i, j) => malo(i) - malo(j) || (malo(i) ? perd[i] - perd[j] : d2(i) - d2(j)));
  return { bloque, orden };
}

// Interacción paneles-aerogeneradores para el optimizador: pérdida media por sombra de los aerogeneradores en las
// primeras k celdas del campo solar, con los primeros n aerogeneradores (n = 0..nMax, k = 1..K).
// tabla[n·K + k − 1]; si k pasa de las celdas libres, se repite la última.
export function interaccionPV(pts, posiciones, op) {
  const z = celdasZona(pts), K = z.celdas.length, nMax = Math.min(posiciones.length, op.nMax);
  const soles = solesSombra(centro(pts)[0], rad(op.beta));
  const perd = new Float64Array(K), ocupada = new Uint8Array(K), tabla = new Float32Array((nMax + 1) * K);
  for (let n = 0; n <= nMax; n++) {
    if (n) {
      const t = z.pr.a(posiciones[n - 1]);
      for (const [i, p] of sombraDe(t, z.celdas, soles, { ...op, lado: z.lado })) perd[i] += p;
      for (const i of ocupaCeldas(t, z.celdas, op)) ocupada[i] = 1;
    }
    const { orden } = ordenCeldas(z.celdas, z.c, ocupada, perd);
    let suma = 0;
    for (let k = 0; k < K; k++) {
      if (k < orden.length) suma += Math.min(1, perd[orden[k]]);
      tabla[n * K + k] = orden.length ? suma / Math.min(k + 1, orden.length) : 0;
    }
  }
  return { tabla, K, nMax, m2Celda: z.lado * z.lado };
}

/* ---------- Estelas entre aerogeneradores (modelo de Jensen/Katić) ---------- */

const NSEC = 36, NDEF = 61, PASO_DEF = 0.01;     // rosa de 10°; potencia tabulada para déficits de 0 a 60 %
const CT = 0.8, K_ESTELA = 0.075;                  // coef. de empuje y expansión de la estela (terreno abierto)
const MAX_CAND = 600, MAX_PARQUE = 150, ALCANCE = 50;   // posiciones evaluadas, parque más grande, alcance en D

// Rosa de vientos y potencia de una unidad con su viento reducido en δ: g[s][k] = Σ horas del sector s de
// P(v·(1 − k·0,01)). Con dirección horaria (ERA5 a 100 m) cada hora cae en su sector; sin ella, la rosa son dos
// lóbulos opuestos (von Mises en ángulos dobles) centrados en el eje dominante, con su concentración.
function tablaEstela(wt, clima, eje) {
  const n = clima.v10_ms.length, dir = clima.dir100_deg;
  const sec = dir && dir.length >= n ? Uint8Array.from({ length: n }, (_, t) => Math.floor((((dir[t] + 5) % 360) + 360) % 360 / 10) % NSEC) : null;
  let w = null;
  if (!sec) {
    const c = Math.min(0.99, clima.concentracion_viento ?? 0.5);
    const k = c < 0.53 ? 2 * c + c ** 3 + (5 * c ** 5) / 6 : c < 0.85 ? -0.4 + 1.39 * c + 0.43 / (1 - c) : 1 / (c ** 3 - 4 * c * c + 3 * c);
    w = Array.from({ length: NSEC }, (_, s) => Math.exp(k * Math.cos(2 * rad(10 * s - eje))));
    const sw = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / sw);
  }
  const g = new Float64Array(NSEC * NDEF);
  for (let k = 0; k < NDEF; k++) {
    const p = potenciaWT(wt, clima.v10_ms, clima.v100_ms, clima.temp_c, clima.presion_hpa, 1 - k * PASO_DEF);
    if (sec) for (let t = 0; t < n; t++) g[sec[t] * NDEF + k] += p[t];
    else { let tot = 0; for (const x of p) tot += x; for (let s = 0; s < NSEC; s++) g[s * NDEF + k] = w[s] * tot; }
  }
  return { sec, g };
}
function solape(r1, r2, d) {                       // área común de dos círculos
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return Math.PI * Math.min(r1, r2) ** 2;
  return r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) + r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
    - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
}

// Ordena las posiciones de la grilla para que los primeros n aerogeneradores produzcan lo más posible: en cada paso
// agrega el que más energía suma al parque (su producción con las estelas que recibe, menos lo que su estela quita a
// los ya puestos), con la rosa de vientos y la curva de potencia de la serie. Déficit de Jensen:
// δ = (1 − √(1 − Ct))·(R/(R + k·x))²·(área del rotor dentro de la estela), sumados en cuadratura.
// Devuelve el orden y la eficiencia del parque por sector (columna NSEC: promedio anual) para n = 0..nMax.
// ponytail: Ct constante y terreno plano; con separaciones ≥ 4D un modelo más fino (Bastankhah, Ct(v)) cambia poco.
export function estelaParque(pts, posiciones, { D, wt, clima, eje }) {
  const { sec, g } = tablaEstela(wt, clima, eje);
  const pr = proyeccion(centro(pts)), todos = posiciones.map(pr.a);
  const idx = todos.map((_, i) => i).sort((a, b) => Math.hypot(...todos[a]) - Math.hypot(...todos[b])).slice(0, MAX_CAND);
  const P = idx.length, pos = idx.map((i) => todos[i]), R = D / 2, A = 1 - Math.sqrt(1 - CT);
  const vec = Array.from({ length: P }, () => []);          // vec[j]: {k, dout: déficit que j causa en k por sector}
  for (let i = 0; i < P; i++) for (let j = i + 1; j < P; j++) {
    const dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
    if (Math.hypot(dx, dy) > ALCANCE * D) continue;
    const ij = new Float32Array(NSEC), ji = new Float32Array(NSEC);
    for (let s = 0; s < NSEC; s++) for (const o of [-1 / 3, 0, 1 / 3]) {   // tres direcciones dentro del sector
      const th = rad(10 * (s + o)), fx = -Math.sin(th), fy = -Math.cos(th);  // el viento viene de th
      const x = dx * fx + dy * fy, r = Math.abs(dx * fy - dy * fx), rw = R + K_ESTELA * Math.abs(x);
      const d = (A * (R / rw) ** 2 * solape(R, rw, r)) / (Math.PI * R * R) / 3;
      if (x > 0) ij[s] += d; else if (x < 0) ji[s] += d;
    }
    vec[i].push({ k: j, dout: ij }); vec[j].push({ k: i, dout: ji });
  }
  const gd = (s, d2) => {
    const x = Math.min(NDEF - 1, Math.sqrt(d2) / PASO_DEF), i = Math.min(NDEF - 2, Math.floor(x)), f = x - i;
    return g[s * NDEF + i] * (1 - f) + g[s * NDEF + i + 1] * f;
  };
  let g0 = 0; for (let s = 0; s < NSEC; s++) g0 += g[s * NDEF];
  const nMax = Math.min(P, MAX_PARQUE), S1 = NSEC + 1, pen = (g0 * 1e-7) / D;   // pen: a igual energía, más cerca del centro
  const def2 = new Float64Array(P * NSEC), elegido = new Uint8Array(P), gan = new Float64Array(P);
  const calcular = (c) => {
    let v = 0;
    for (let s = 0; s < NSEC; s++) v += gd(s, def2[c * NSEC + s]);
    for (const { k, dout } of vec[c]) if (elegido[k]) for (let s = 0; s < NSEC; s++) if (dout[s]) {
      const b = def2[k * NSEC + s]; v += gd(s, b + dout[s] * dout[s]) - gd(s, b);
    }
    return v - pen * Math.hypot(...pos[c]);
  };
  for (let c = 0; c < P; c++) gan[c] = calcular(c);
  const orden = [], eta = new Float32Array((nMax + 1) * S1).fill(1);
  for (let n = 1; n <= nMax; n++) {
    let c = -1;
    for (let i = 0; i < P; i++) if (!elegido[i] && (c < 0 || gan[i] > gan[c])) c = i;
    elegido[c] = 1; orden.push(c);
    const cambia = new Set();
    for (const { k, dout } of vec[c]) {
      for (let s = 0; s < NSEC; s++) def2[k * NSEC + s] += dout[s] * dout[s];
      cambia.add(k);
      if (elegido[k]) for (const v of vec[k]) cambia.add(v.k);    // cambió lo que otros le quitarían a k
    }
    for (const v of vec[c]) cambia.add(v.k);
    for (const k of cambia) if (!elegido[k]) gan[k] = calcular(k);
    let tot = 0;
    for (let s = 0; s < NSEC; s++) {
      let e = 0; for (const i of orden) e += gd(s, def2[i * NSEC + s]);
      tot += e; eta[n * S1 + s] = g[s * NDEF] ? e / (n * g[s * NDEF]) : 1;
    }
    eta[n * S1 + NSEC] = g0 ? tot / (n * g0) : 1;
  }
  const usados = new Set(orden.map((c) => idx[c]));
  return {
    orden: [...orden.map((c) => posiciones[idx[c]]), ...posiciones.filter((_, i) => !usados.has(i))],
    eta, S: NSEC, nMax, sec, conDireccion: !!sec,
  };
}
// Eficiencia anual del parque (energía con estelas / sin estelas) con los primeros n aerogeneradores.
export const eficienciaParque = (e, n) => e.eta[Math.min(n, e.nMax) * (e.S + 1) + e.S];

// Ubicación de los equipos de un resultado, en metros locales (x al este, y al norte):
// - los primeros nWt aerogeneradores de la lista (ordenada por energía con estelas);
// - el bloque de potencia (conversores, H₂, baterías, diésel) en la celda libre más cercana al centro;
// - el campo fotovoltaico en las celdas que deja libres el terreno de los aerogeneradores, en el orden de
//   ordenCeldas, hasta cubrir el terreno que necesitan los paneles (areaPv, m²).
// ponytail: el campo FV se arma con celdas de hasta ~3000 por zona; para un trazado fino de mesas, usar un CAD.
export function layoutResultado(pts, { posiciones, nWt, areaPv, hub = 0, beta = 0, ...op }) {
  const z = celdasZona(pts), K = z.celdas.length;
  const turb = posiciones.slice(0, nWt).map(z.pr.a);
  const perd = new Float64Array(K), ocupada = new Uint8Array(K);
  const soles = turb.length && areaPv ? solesSombra(centro(pts)[0], rad(beta)) : [];
  for (const t of turb) {
    if (soles.length) for (const [i, p] of sombraDe(t, z.celdas, soles, { hub, D: op.D, lado: z.lado })) perd[i] += p;
    for (const i of ocupaCeldas(t, z.celdas, op)) ocupada[i] = 1;
  }
  const { bloque, orden } = ordenCeldas(z.celdas, z.c, ocupada, perd);
  const elegidas = orden.slice(0, Math.ceil(areaPv / (z.lado * z.lado) - 1e-9));
  const sombraPv = elegidas.length ? elegidas.reduce((a, i) => a + Math.min(1, perd[i]), 0) / elegidas.length : 0;
  return { poli: z.poli, turb, pv: elegidas.map((i) => z.celdas[i]), lado: z.lado, bloque: bloque >= 0 ? z.celdas[bloque] : z.c, D: op.D, sombraPv,
    completo: elegidas.length * z.lado * z.lado >= areaPv - 1e-6 };
}

// Mapa de solo lectura con la zona y la distribución de los aerogeneradores (usados en relleno, libres en blanco).
export function mapaDistribucion(el) {
  const mapa = L.map(el, { preferCanvas: true, zoomSnap: 0.5 });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  const capa = L.layerGroup().addTo(mapa);
  let encuadre = "";
  return {
    mapa,
    pintar(pts, posiciones, usados, radioM) {
      capa.clearLayers();
      if (!pts) return;
      const pol = L.polygon(pts, { color: "#E9A23B", weight: 2, fillColor: "#E9A23B", fillOpacity: 0.18 }).addTo(capa);
      posiciones.slice(0, 3000).forEach((p, i) => L.circle(p, { radius: radioM, color: "#FFFFFF", weight: 1.5,
        fillColor: i < usados ? "#2A9D8F" : "#FFFFFF", fillOpacity: i < usados ? 0.95 : 0.35 }).addTo(capa));
      const clave = JSON.stringify(pts);
      if (clave !== encuadre) { encuadre = clave; mapa.fitBounds(pol.getBounds(), { padding: [20, 20] }); }
    },
  };
}

// Mapa con dibujo de polígonos: clic agrega un vértice; clic en el primero, doble clic o cerrar() termina la zona.
// alCerrar(pts) recibe los vértices (o null al borrar); alAviso(texto) informa un vértice rechazado.
export function crearMapa(el, { alCerrar, alAviso, alCambiarModo }) {
  const limites = L.latLngBounds([REGION.latMin, REGION.lonMin], [REGION.latMax, REGION.lonMax]);
  const mapa = L.map(el, { maxBounds: limites.pad(0.15), minZoom: 6, zoomSnap: 0.5 }).fitBounds(limites);
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© colaboradores de OpenStreetMap" });
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap, SRTM · estilo © OpenTopoMap (CC BY-SA)" });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" });
  topo.addTo(mapa);
  L.control.layers({ "Relieve (OpenTopoMap)": topo, "Calles (OpenStreetMap)": osm, "Satélite (Esri)": sat }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  L.rectangle(limites, { color: "#1F5FAD", weight: 1.5, dashArray: "6 4", fill: false, interactive: false }).addTo(mapa);

  let pts = [], dibujando = false;
  const capa = L.layerGroup().addTo(mapa);
  const pintar = (cerrado, color = "#C2410C") => {
    capa.clearLayers();
    if (cerrado && pts.length >= 3) L.polygon(pts, { color, weight: 2, fillOpacity: 0.25 }).addTo(capa);
    else if (pts.length) L.polyline(pts, { color, weight: 2, dashArray: "4 4" }).addTo(capa);
    if (!cerrado) pts.forEach((p, i) => {
      const v = L.circleMarker(p, { radius: i ? 4 : 7, color, fillColor: "#FFFFFF", fillOpacity: 1, weight: 2 }).addTo(capa);
      if (i === 0) v.on("click", (e) => { L.DomEvent.stop(e); api.cerrar(); });
    });
  };
  const modo = (v) => {
    dibujando = v;
    el.classList.toggle("dibujando", v);
    if (v) mapa.doubleClickZoom.disable(); else mapa.doubleClickZoom.enable();
    alCambiarModo?.(v, pts.length);
  };
  mapa.on("click", (e) => {
    if (!dibujando) return;
    const p = [e.latlng.lat, e.latlng.lng];
    if (!enRegion(p)) { alAviso?.("Ese punto está fuera de la región de prueba (Maule a la Araucanía, rectángulo punteado)."); return; }
    const ult = pts[pts.length - 1];                // el doble clic también llega como dos clics: no duplicar el vértice
    if (ult && mapa.latLngToContainerPoint(ult).distanceTo(e.containerPoint) < 6) return;
    pts.push(p); pintar(false); alCambiarModo?.(true, pts.length);
  });
  mapa.on("dblclick", () => { if (dibujando) api.cerrar(); });

  const api = {
    mapa,
    dibujar() { pts = []; capa.clearLayers(); modo(true); },
    deshacer() { if (dibujando) { pts.pop(); pintar(false); alCambiarModo?.(true, pts.length); } },
    borrar() { pts = []; capa.clearLayers(); modo(false); alCerrar(null); },
    cerrar() {
      if (!dibujando || pts.length < 3) return;
      modo(false); pintar(true);
      mapa.fitBounds(L.polygon(pts).getBounds(), { maxZoom: 15, padding: [30, 30] });
      alCerrar(pts.slice());
    },
    marcar(valida) { pintar(true, valida ? "#C2410C" : "#9B2C2C"); },
  };
  return api;
}
