// Edificios detectados en imágenes satelitales (Microsoft y Google, con aprendizaje automático) más los de
// OpenStreetMap, tal como los publica Overture Maps (tema «buildings») en un archivo PMTiles de acceso abierto.
// El archivo pesa ~180 GB: se leen solo el índice y las teselas de la zona con peticiones HTTP por tramos (Range).
// Lector mínimo de PMTiles v3 (directorios y teselas en gzip) y de teselas vectoriales MVT (solo la geometría).

export const URL_EDIFICIOS = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-09-23.1/buildings.pmtiles";
const ZOOM = 14;

async function tramo(url, desde, largo) {
  const r = await fetch(url, { headers: { Range: `bytes=${desde}-${desde + largo - 1}` } });
  if (!r.ok) throw new Error(`Overture respondió ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function gunzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

// Lectura de enteros variables (protobuf / PMTiles), hasta 2^53.
function lector(b) {
  let p = 0;
  const varint = () => { let v = 0, f = 1, x; do { x = b[p++]; v += (x & 0x7f) * f; f *= 128; } while (x & 0x80); return v; };
  return { varint, pos: () => p, ir: (q) => { p = q; }, fin: () => p >= b.length };
}

// Directorio PMTiles: tileId (delta), runLength, length, offset.
function directorio(b) {
  const r = lector(b), n = r.varint(), e = Array.from({ length: n }, () => ({}));
  let id = 0;
  for (const x of e) { id += r.varint(); x.id = id; }
  for (const x of e) x.run = r.varint();
  for (const x of e) x.len = r.varint();
  e.forEach((x, i) => { const v = r.varint(); x.off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1; });
  return e;
}
function buscar(e, id) {
  let a = 0, b = e.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (e[m].id < id) a = m + 1; else if (e[m].id > id) b = m - 1; else return e[m];
  }
  if (b >= 0) { const x = e[b]; if (x.run === 0 || id - x.id < x.run) return x; }
  return null;
}
// zxy → identificador de tesela (curva de Hilbert por nivel, especificación PMTiles v3).
export function tileId(z, x, y) {
  let acc = 0;
  for (let a = 0; a < z; a++) acc += 4 ** a;
  const xy = [x, y];
  let d = 0;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } [xy[0], xy[1]] = [xy[1], xy[0]]; }
  }
  return acc + d;
}

// Cabecera y directorio raíz, una sola vez por archivo (se guarda la promesa: las teselas se piden en paralelo).
const cabeceras = new Map();
function cabecera(url) {
  if (!cabeceras.has(url)) {
    const p = (async () => {
      const h = await tramo(url, 0, 127), dv = new DataView(h.buffer);
      if (String.fromCharCode(...h.slice(0, 7)) !== "PMTiles" || h[7] !== 3) throw new Error("el archivo no es PMTiles v3");
      const u = (o) => Number(dv.getBigUint64(o, true));
      const c = { raiz: [u(8), u(16)], hojas: u(40), datos: u(56) };
      c.dir = directorio(await gunzip(await tramo(url, ...c.raiz)));
      return c;
    })();
    p.catch(() => cabeceras.delete(url));
    cabeceras.set(url, p);
  }
  return cabeceras.get(url);
}
async function tesela(url, z, x, y) {
  const c = await cabecera(url), id = tileId(z, x, y);
  let dir = c.dir;
  for (let nivel = 0; nivel < 4; nivel++) {
    const e = buscar(dir, id);
    if (!e) return null;
    if (e.run > 0) return gunzip(await tramo(url, c.datos + e.off, e.len));
    dir = directorio(await gunzip(await tramo(url, c.hojas + e.off, e.len)));
  }
  return null;
}

function saltar(r, tipo) {
  if (tipo === 0) r.varint();
  else if (tipo === 2) { const l = r.varint(); r.ir(r.pos() + l); }
  else if (tipo === 1) r.ir(r.pos() + 8);
  else if (tipo === 5) r.ir(r.pos() + 4);
}
// Centro de cada edificio de una tesela MVT (promedio de los vértices de su primer anillo), en [lat, lon], con su
// área en m² (fórmula del área de Gauss sobre el anillo).
export function centrosMVT(b, z, x, y) {
  const out = [], n = 2 ** z, r = lector(b);
  while (!r.fin()) {
    const tag = r.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { saltar(r, tag & 7); continue; }   // capas (campo 3)
    const fin = r.varint() + r.pos(), feats = [];
    let extent = 4096;
    while (r.pos() < fin) {
      const t = r.varint();
      if (t >> 3 === 2 && (t & 7) === 2) { const l = r.varint(); feats.push([r.pos(), r.pos() + l]); r.ir(r.pos() + l); }
      else if (t >> 3 === 5 && (t & 7) === 0) extent = r.varint();
      else saltar(r, t & 7);
    }
    for (const [a, f] of feats) {
      r.ir(a);
      let geom = null, tipo = 0;
      while (r.pos() < f) {
        const t = r.varint();
        if (t >> 3 === 3 && (t & 7) === 0) tipo = r.varint();
        else if (t >> 3 === 4 && (t & 7) === 2) { const l = r.varint(); geom = [r.pos(), r.pos() + l]; r.ir(r.pos() + l); }
        else saltar(r, t & 7);
      }
      if (tipo !== 3 || !geom) continue;                  // solo polígonos
      r.ir(geom[0]);
      let cx = 0, cy = 0, px = 0, py = 0, k = 0, area2 = 0, x0 = 0, y0 = 0, qx = 0, qy = 0;
      while (r.pos() < geom[1]) {
        const cmd = r.varint(), id = cmd & 7, cnt = cmd >> 3;
        if (id === 7) break;                              // primer anillo cerrado
        for (let i = 0; i < cnt; i++) {
          const dx = r.varint(), dy = r.varint();
          px += (dx >> 1) ^ -(dx & 1); py += (dy >> 1) ^ -(dy & 1); cx += px; cy += py;
          if (k) area2 += qx * py - px * qy; else { x0 = px; y0 = py; }
          qx = px; qy = py; k++;
        }
      }
      if (!k) continue;
      area2 += qx * y0 - x0 * qy;
      const gx = (x + cx / k / extent) / n, gy = (y + cy / k / extent) / n, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy)));
      const mUnidad = (40075016.7 * Math.cos(lat)) / n / extent;          // metros por unidad de la tesela
      out.push([(lat * 180) / Math.PI, gx * 360 - 180, (Math.abs(area2) / 2) * mUnidad * mUnidad]);
    }
    r.ir(fin);
  }
  return out;
}

// Edificios de al menos `areaMin` m² dentro de la caja [latMin, lonMin, latMax, lonMax], como centros [lat, lon].
// ponytail: no distingue viviendas de galpones o bodegas grandes; se toman todos como receptores (conservador).
export async function edificiosEnCaja([la0, lo0, la1, lo1], { areaMin = 20, url = URL_EDIFICIOS } = {}) {
  const n = 2 ** ZOOM, tx = (lo) => Math.floor(((lo + 180) / 360) * n);
  const ty = (la) => { const s = Math.sin((la * Math.PI) / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n); };
  const pedidos = [];
  for (let x = tx(lo0); x <= tx(lo1); x++) for (let y = ty(la1); y <= ty(la0); y++) pedidos.push([x, y]);
  if (pedidos.length > 64) throw new Error("la zona con su margen es demasiado grande para buscar edificios");
  const res = await Promise.all(pedidos.map(async ([x, y]) => { const b = await tesela(url, ZOOM, x, y); return b ? centrosMVT(b, ZOOM, x, y) : []; }));
  return res.flat().filter(([la, lo, a]) => la >= la0 && la <= la1 && lo >= lo0 && lo <= lo1 && a >= areaMin).map(([la, lo]) => [la, lo]);
}
