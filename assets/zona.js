// Zona del proyecto: mapa del centro-sur de Chile (regiones del Maule a la Araucanía) donde se dibuja un
// polígono. Calcula su superficie (geodésica) y su elevación con el modelo Copernicus DEM (90 m) a través de
// la API de elevación de Open-Meteo. Usa Leaflet (global L, en vendor/leaflet).

// ponytail: rectángulo que cubre las cuatro regiones, no su límite exacto; usar un GeoJSON regional si hace falta precisión.
export const REGION = { latMin: -39.7, latMax: -34.6, lonMin: -74.0, lonMax: -70.3 };
export const AREA_MAX_KM2 = 25;          // límite para que la zona sea un terreno, no una comuna entera
const R = 6378137;
const rad = (g) => (g * Math.PI) / 180;

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
function proyeccion([lat0, lon0]) {
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

// Paneles en filas orientadas al norte, inclinados en β, separados para no sombrearse al mediodía del solsticio
// de invierno. GCR = largo de la mesa / distancia entre filas. aprovechamiento: fracción del terreno libre
// que queda para las mesas (caminos, inversores, bordes).
export function distribucionPaneles(lat, { areaPanelM2, aprovechamiento = 0.85 }) {
  const beta = Math.min(60, Math.round(Math.abs(lat)));
  const alfa = Math.max(5, 90 - Math.abs(lat) - 23.45);                      // altura del sol a mediodía en junio
  const gcr = 1 / (Math.cos(rad(beta)) + Math.sin(rad(beta)) / Math.tan(rad(alfa)));
  return { beta, alfa, gcr, m2PorPanel: areaPanelM2 / (gcr * aprovechamiento) };
}

// Ubicación de los equipos de un resultado, en metros locales (x al este, y al norte):
// - los primeros nWt aerogeneradores de la grilla, cada uno dueño de su celda de separación;
// - el campo fotovoltaico en celdas cuadradas libres de esas celdas, desde el bloque de potencia hacia afuera,
//   hasta cubrir el terreno que necesitan los paneles (areaPv, m²);
// - el bloque de potencia (conversores, H₂, baterías, diésel) en el punto libre más cercano al centro.
// ponytail: el campo FV se arma con celdas de hasta ~3000 por zona; para un trazado fino de mesas, usar un CAD.
export function layoutResultado(pts, { posiciones, D, sx, sy, eje, nWt, areaPv }) {
  const pr = proyeccion(centro(pts)), poli = pts.map(pr.a);
  const u = [Math.sin(rad(eje)), Math.cos(rad(eje))], w = [u[1], -u[0]];
  const turb = posiciones.slice(0, nWt).map(pr.a);
  const enCeldaWt = ([x, y]) => turb.some(([tx, ty]) => {
    const dx = x - tx, dy = y - ty;
    return Math.abs(dx * u[0] + dy * u[1]) < (sx * D) / 2 && Math.abs(dx * w[0] + dy * w[1]) < (sy * D) / 2;
  });
  const X = poli.map((p) => p[0]), Y = poli.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...X), Math.max(...X), Math.min(...Y), Math.max(...Y)];
  const lado = Math.max(5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000));
  const poliYX = poli.map(([x, y]) => [y, x]), libres = [];
  for (let x = x0 + lado / 2; x < x1; x += lado) for (let y = y0 + lado / 2; y < y1; y += lado) {
    if (dentro([y, x], poliYX) && !enCeldaWt([x, y])) libres.push([x, y]);
  }
  const c = pr.a(centro(pts));
  const d2 = (p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
  libres.sort((p, q) => d2(p) - d2(q));
  const bloque = libres[0] || c;
  const pv = [];
  for (let i = 1, a = 0; i < libres.length && a < areaPv; i++, a += lado * lado) pv.push(libres[i]);
  return { poli, turb, pv, lado, bloque, D, completo: pv.length * lado * lado >= areaPv - 1e-6 };
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
