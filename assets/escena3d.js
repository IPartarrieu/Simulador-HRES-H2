// Vista 3D animada del layout de un resultado: terreno con su relieve (Terrain Tiles de AWS) cubierto
// con la imagen satelital (Esri), y encima los aerogeneradores (con las aspas girando), las filas de paneles y
// el bloque de potencia, en las posiciones de layoutResultado (zona.js). Sobre el terreno se puede pintar un mapa
// (recurso eólico o solar, calculado en zona.js con la grilla `rejilla`). Usa three.js (vendor/three).
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { relieve, mosaico, nivelTesela as nivel, N_RELIEVE as N } from "./zona.js?v=20261016f";

const cacheTerreno = new Map();
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Datos del terreno ---------- */

// Imagen satelital (Esri) de la caja, con la zona resaltada: afuera queda más oscuro.
async function satelite(caja, ptsZona) {
  const m = await mosaico((z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, caja, nivel(caja, 1400, 18));
  const { lienzo, ctx } = m, poli = ptsZona.map(m.px);
  const trazo = () => poli.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.beginPath(); ctx.rect(0, 0, lienzo.width, lienzo.height); trazo(); ctx.closePath();
  ctx.fillStyle = "rgba(10, 20, 35, 0.45)"; ctx.fill("evenodd");
  ctx.beginPath(); trazo(); ctx.closePath();
  ctx.lineWidth = Math.max(3, lienzo.width / 300); ctx.strokeStyle = "#FF8A3D"; ctx.stroke();
  return lienzo;
}

// Relieve (zona.js) e imagen satelital de la misma caja.
async function terreno(pts) {
  const clave = JSON.stringify(pts);
  if (cacheTerreno.has(clave)) return cacheTerreno.get(clave);
  const rel = await relieve(pts);
  const t = { ...rel, imagen: await satelite(rel.caja, pts).catch(() => null) };
  cacheTerreno.set(clave, t);
  return t;
}

// Paletas de los mapas de recurso (de menos a más).
export const PALETAS = {
  viento: ["#2C7BB6", "#00A6CA", "#00CCBC", "#90EB9D", "#FFFF8C", "#F9D057", "#F29E2E", "#E76818", "#D7191C"],
  solar: ["#1B0C41", "#4A0C6B", "#781C6D", "#A52C60", "#CF4446", "#ED6925", "#FB9B06", "#F7D13D", "#FCFFA4"],
};
function colorEn(paleta, u) {
  const x = lim(u, 0, 1) * (paleta.length - 1), i = Math.min(paleta.length - 2, Math.floor(x));
  return new THREE.Color(paleta[i]).lerp(new THREE.Color(paleta[i + 1]), x - i);
}

/* ---------- Modelos ---------- */

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...extra });

function aerogenerador(D, hub, blanco) {
  const g = new THREE.Group();
  const torre = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.018 + 0.15, D * 0.03 + 0.3, hub, 10), blanco);
  torre.position.y = hub / 2; g.add(torre);
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(D * 0.07, D * 0.07, D * 0.16), blanco);
  gondola.position.set(0, hub, -D * 0.04); g.add(gondola);
  const rotor = new THREE.Group(); rotor.position.set(0, hub, D * 0.05);
  rotor.add(new THREE.Mesh(new THREE.SphereGeometry(D * 0.045, 12, 8), blanco));
  const pala = new THREE.BoxGeometry(D * 0.045, D * 0.48, D * 0.012); pala.translate(0, D * 0.25, 0);
  for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(pala, blanco); p.rotation.z = (k * 2 * Math.PI) / 3; rotor.add(p); }
  g.add(rotor);
  g.traverse((o) => { o.castShadow = true; });
  return { g, rotor };
}

// Bloque de potencia: contenedores (conversores, electrolizadores, celdas, baterías, diésel) y tanques de H₂.
export const COLORES_BLOQUE = { con: "#8A96A8", ele: "#F4F6F8", fc: "#2BB3A3", bat: "#3FAE6A", dg: "#B5651D", ht: "#C9D3DD" };
function bloquePotencia(cfg, equipos) {
  const g = new THREE.Group();
  const tipos = [["con", 2, (n) => (n * equipos.con.pr) / 1000], ["ele", 3, (n) => (n * equipos.ele.pr) / 1000],
    ["fc", 5, (n) => (n * equipos.fc.pr) / 500], ["bat", 6, (n) => (n * equipos.bat.cap) / 2000], ["dg", 7, (n) => (n * equipos.dg.pr) / 500]];
  let fila = 0;
  for (const [k, i, cuantos] of tipos) {
    if (!cfg[i]) continue;
    const m = lim(Math.ceil(cuantos(cfg[i])), 1, 6), material = mat(COLORES_BLOQUE[k]);
    for (let c = 0; c < m; c++) {
      const caja = new THREE.Mesh(new THREE.BoxGeometry(12.2, 2.6, 2.45), material);
      caja.position.set(-20 + c * 13.5, 1.3, -14 + fila * 5); caja.castShadow = caja.receiveShadow = true; g.add(caja);
    }
    fila++;
  }
  if (cfg[4]) {
    const n = lim(Math.ceil((cfg[4] * equipos.ht.cap) / 1000), 1, 8), material = mat(COLORES_BLOQUE.ht, { metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < n; i++) {
      const tq = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 9, 6, 14), material);
      tq.rotation.z = Math.PI / 2; tq.position.set(-20 + (i % 4) * 13.5, 1.6, 6 + Math.floor(i / 4) * 4.5); tq.castShadow = true; g.add(tq);
    }
  }
  return g;
}

/* ---------- Escena ---------- */

// op: { pts, geo (layoutResultado), eje, cfg, equipos, pitchM, beta, largoMesa, alEstado(texto) }
export async function crearVista3D(contenedor, op) {
  op.alEstado?.("Cargando el relieve y la imagen satelital…");
  const t = await terreno(op.pts);
  const ancho = t.x1 - t.x0, alto = t.y1 - t.y0, ext = Math.max(ancho, alto);
  let eMin = Infinity, eMax = -Infinity;
  for (const v of t.elev) { eMin = Math.min(eMin, v); eMax = Math.max(eMax, v); }
  // Exageración vertical: hasta ×2. Los equipos se dibujan a su tamaño (o ×kEq) y con más exageración las
  // pendientes se vuelven imposibles para apoyarlos (mesas y contenedores enterrados o flotando).
  const exag = Math.round(lim((0.1 * ext) / Math.max(eMax - eMin, 1), 1, 2) * 2) / 2;
  // Encuadre final: alrededor de los equipos (no de toda la zona), para que se vean de cerca.
  const ptsEq = [...op.geo.turb, ...op.geo.pv, op.geo.bloque];
  const ce = [ptsEq.reduce((a, p) => a + p[0], 0) / ptsEq.length, ptsEq.reduce((a, p) => a + p[1], 0) / ptsEq.length];
  const radioEq = Math.max(...ptsEq.map((p) => Math.hypot(p[0] - ce[0], p[1] - ce[1]))) + op.geo.lado;
  const R = lim(2.6 * radioEq, 180, ext);
  const kEq = Math.round(lim(R / 700, 1, 4) * 2) / 2;                                    // escala visual de los equipos
  const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
  // Explanada: el terreno bajo el bloque de potencia (con su escala visual) se nivela a su altura media, como el corte y
  // relleno de una obra; incluye una celda de grilla de margen para que toda la huella quede plana.
  const bloque = bloquePotencia(op.cfg, op.equipos);
  const caja = new THREE.Box3().setFromObject(bloque), cB = caja.getCenter(new THREE.Vector3()), tB = caja.getSize(new THREE.Vector3());
  const el = Float64Array.from(t.elev), paso = Math.max(ancho, alto) / (N - 1);
  {
    const [bx, by] = op.geo.bloque, px = bx + cB.x * kEq, py = by - cB.z * kEq;
    const hx = (tB.x / 2 + 2) * kEq, hy = (tB.z / 2 + 2) * kEq, pad = [], borde = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = t.x0 + (j / (N - 1)) * ancho, y = t.y1 - (i / (N - 1)) * alto, ex = Math.abs(x - px) - hx, ey = Math.abs(y - py) - hy;
      if (ex <= paso && ey <= paso) pad.push(i * N + j);                     // vértices de las celdas que toca la huella
      else if (ex <= 2 * paso && ey <= 2 * paso) borde.push(i * N + j);      // talud: a medio camino
    }
    if (pad.length) {
      const m = pad.reduce((a, k) => a + el[k], 0) / pad.length;
      for (const k of pad) el[k] = m;
      for (const k of borde) el[k] = (el[k] + m) / 2;
    }
  }
  // Altura de la superficie tal como la dibuja la malla (x al este, y al norte, metros locales): dos triángulos por
  // celda, los mismos de PlaneGeometry (a-b-d y b-c-d), para que los equipos queden apoyados en lo que se ve.
  const altura = (x, y) => {
    const fj = lim(((x - t.x0) / ancho) * (N - 1), 0, N - 1), fi = lim(((t.y1 - y) / alto) * (N - 1), 0, N - 1);
    const j = Math.min(N - 2, Math.floor(fj)), i = Math.min(N - 2, Math.floor(fi)), u = fj - j, w = fi - i;
    const e = (r, c) => (el[r * N + c] - eMin) * exag, a = e(i, j), b = e(i + 1, j), c = e(i + 1, j + 1), d = e(i, j + 1);
    return u + w <= 1 ? a + u * (d - a) + w * (b - a) : c + (1 - u) * (b - c) + (1 - w) * (d - c);
  };
  // Altura mínima y máxima de la superficie bajo un rectángulo (centro y medios lados este-oeste y norte-sur).
  const bajo = (x, y, hx, hy) => {
    let mn = Infinity, mx = -Infinity;
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) { const h = altura(x + a * hx, y + b * hy); mn = Math.min(mn, h); mx = Math.max(mx, h); }
    return [mn, mx];
  };
  const v3 = (x, y, dy = 0) => new THREE.Vector3(x - cx, altura(x, y) + dy, -(y - cy));

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  contenedor.replaceChildren(renderer.domElement);
  const escena = new THREE.Scene();
  escena.background = new THREE.Color("#BFD6EE");
  escena.fog = new THREE.Fog("#BFD6EE", ext * 1.4, ext * 4);
  const camara = new THREE.PerspectiveCamera(42, 1, ext / 2000, ext * 10);

  // Luz: cielo y sol del mediodía desde el norte (hemisferio sur).
  escena.add(new THREE.HemisphereLight("#E6F0FF", "#5B4A33", 0.9));
  const sol = new THREE.DirectionalLight("#FFF4E0", 2.2);
  sol.position.set(ext * 0.3, ext * 0.9, -ext * 0.8); sol.castShadow = true;
  Object.assign(sol.shadow.camera, { left: -ext * 0.6, right: ext * 0.6, top: ext * 0.6, bottom: -ext * 0.6, near: 1, far: ext * 3 });
  sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0005;
  escena.add(sol);

  // Terreno: los vértices de PlaneGeometry van de norte a sur y de oeste a este, igual que la grilla.
  const geoT = new THREE.PlaneGeometry(ancho, alto, N - 1, N - 1);
  geoT.rotateX(-Math.PI / 2);
  const pos = geoT.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, (el[k] - eMin) * exag);
  geoT.computeVertexNormals();
  let matT;
  if (t.imagen) { const tex = new THREE.CanvasTexture(t.imagen); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; matT = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }); }
  else matT = new THREE.MeshStandardMaterial({ color: "#8FA86B", roughness: 0.95 });
  const suelo = new THREE.Mesh(geoT, matT); suelo.receiveShadow = true; escena.add(suelo);
  const base = new THREE.Mesh(new THREE.BoxGeometry(ancho, ext * 0.03, alto), mat("#6B5A43"));   // costado de la maqueta
  base.position.y = -ext * 0.015; escena.add(base);

  // Cerco de la zona, siguiendo el relieve
  const borde = [];
  op.geo.poli.forEach((p, i) => {
    const q = op.geo.poli[(i + 1) % op.geo.poli.length];
    for (let s = 0; s < 20; s++) borde.push(v3(p[0] + ((q[0] - p[0]) * s) / 20, p[1] + ((q[1] - p[1]) * s) / 20, 1.5));
  });
  const cerco = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(borde), new THREE.LineBasicMaterial({ color: "#FF8A3D" }));
  escena.add(cerco);

  // Paneles: filas inclinadas en β mirando al norte, partidas en mesas de hasta 10 m (InstancedMesh). Cada mesa sigue
  // la pendiente este-oeste del terreno en su centro (como las mesas reales, que se adaptan al terreno a lo largo de la
  // fila) y conserva su inclinación β respecto de la horizontal; su borde más bajo queda a 0,6 m del suelo bajo él.
  // Con seguidores (op.seguidor) las filas van de norte a sur, con las mesas en la posición del mediodía (horizontales)
  // siguiendo la pendiente norte-sur, y el eje a 1,6 m del suelo.
  const ns = !!op.seguidor, filas = [], lado = op.geo.lado, nf = Math.max(1, Math.round(lado / op.pitchM));
  for (const [x, y] of op.geo.pv) for (let f = 0; f < nf; f++) filas.push(ns ? [x - lado / 2 + (f + 0.5) * (lado / nf), y] : [x, y - lado / 2 + (f + 0.5) * (lado / nf)]);
  const grupoPv = new THREE.Group(); escena.add(grupoPv);
  if (filas.length) {
    const beta = ns ? 0 : (op.beta * Math.PI) / 180, fondo = (op.largoMesa * Math.cos(beta)) / 2, subida = (op.largoMesa / 2) * Math.sin(beta);
    const nSeg = Math.max(1, Math.min(Math.ceil(lado / 10), Math.floor(30000 / filas.length))), lSeg = lado / nSeg;
    const mesas = [], dx = Math.min(lSeg / 2, paso / 4);
    for (const [x, y] of filas) for (let k = 0; k < nSeg; k++) {
      if (ns) {
        const ys = y - lado / 2 + (k + 0.5) * lSeg, h0 = altura(x, ys);
        const pend = (altura(x, ys + dx) - altura(x, ys - dx)) / (2 * dx);                  // pendiente norte-sur
        mesas.push([x, ys, Math.max(altura(x - fondo, ys), h0, altura(x + fondo, ys)) + 1.6, h0, 0, Math.atan(pend)]);
        continue;
      }
      const xs = x - lado / 2 + (k + 0.5) * lSeg, h0 = altura(xs, y);
      const pend = (altura(xs + dx, y) - altura(xs - dx, y)) / (2 * dx);                   // pendiente este-oeste
      const base = Math.max(altura(xs, y - fondo), h0, altura(xs, y + fondo)) + 0.6;        // norte-sur: sobre lo más alto
      mesas.push([xs, y, base, h0, Math.atan(pend), -beta]);
    }
    const pv = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat("#2456A6", { metalness: 0.5, roughness: 0.22 }), mesas.length);
    const postes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), mat("#9AA3AD", { metalness: 0.6 }), mesas.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q0 = new THREE.Quaternion(), giro = new THREE.Euler(0, 0, 0, "ZXY");
    mesas.forEach(([x, y, base, suelo, rol, rx], i) => {
      giro.set(rx, 0, rol); q.setFromEuler(giro);
      const s = ns ? new THREE.Vector3(op.largoMesa, 0.12, (lSeg * 0.97) / Math.cos(rx))            // largo a lo largo de la pendiente
        : new THREE.Vector3((lSeg * 0.97) / Math.cos(rol), 0.12, op.largoMesa);
      pv.setMatrixAt(i, m4.compose(new THREE.Vector3(x - cx, base + subida, -(y - cy)), q, s));
      const largo = base + subida - suelo;
      postes.setMatrixAt(i, m4.compose(new THREE.Vector3(x - cx, suelo + largo / 2, -(y - cy)), q0, new THREE.Vector3(1, largo, 1)));
    });
    pv.castShadow = pv.receiveShadow = true; postes.castShadow = true; grupoPv.add(pv, postes);
  }

  // Aerogeneradores (×kEq para que se vean), con el rotor de frente al eje del viento
  const blanco = mat("#F7F8FA", { roughness: 0.4 });
  const giroY = Math.PI - (op.eje * Math.PI) / 180;
  const turbinas = op.geo.turb.slice(0, 400).map(([x, y]) => {
    const { g, rotor } = aerogenerador(op.equipos.wt.rotor * kEq, op.equipos.wt.hub * kEq, blanco);
    const r = op.equipos.wt.rotor * kEq * 0.03 + 0.3;                    // radio de la base de la torre
    g.position.copy(v3(x, y)); g.position.y = bajo(x, y, r, r)[0];      // la base entra en el terreno, no flota
    g.rotation.y = giroY; g.scale.setScalar(0.001); escena.add(g);
    return { g, rotor };
  });

  // Bloque de potencia sobre la explanada, con una losa de hormigón.
  const losa = new THREE.Mesh(new THREE.BoxGeometry(tB.x + 4, 0.4, tB.z + 4), mat("#A9A39A", { roughness: 0.9 }));
  losa.position.set(cB.x, 0.15, cB.z); losa.receiveShadow = true; bloque.add(losa);
  bloque.position.copy(v3(op.geo.bloque[0], op.geo.bloque[1], 0.05)); bloque.scale.setScalar(0.001);
  escena.add(bloque);

  // Cámara y controles
  const controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true; controles.autoRotate = true; controles.autoRotateSpeed = 0.7;
  controles.maxPolarAngle = Math.PI * 0.47; controles.minDistance = ext * 0.08; controles.maxDistance = ext * 3;
  const alto0 = ext * 1.35, foco = v3(ce[0], ce[1]);
  const final = foco.clone().add(new THREE.Vector3(0.55, 0.5, 0.75).multiplyScalar(R * 0.75));
  camara.position.set(0, alto0, ext * 0.05); camara.lookAt(0, 0, 0);

  // Animación: el terreno se levanta, luego los paneles, el bloque y los aerogeneradores uno a uno,
  // mientras la cámara baja de la vista cenital a una oblicua y empieza a girar.
  let t0 = performance.now(), visible = true, raf = 0, intro = true;
  const suave = (u) => { u = lim(u, 0, 1); return u * u * (3 - 2 * u); };
  const ajustar = () => {
    const w = contenedor.clientWidth || 800, h = Math.round(w * 0.6);
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "auto";
    camara.aspect = w / h; camara.updateProjectionMatrix();
  };
  const obs = new ResizeObserver(ajustar); obs.observe(contenedor); ajustar();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(renderer.domElement);
  const cuadro = (ahora) => {
    raf = requestAnimationFrame(cuadro);
    if (!visible) return;
    const s = (ahora - t0) / 1000;
    suelo.scale.y = base.scale.y = Math.max(0.001, suave(s / 1.6));
    cerco.visible = s > 1.4;
    grupoPv.scale.y = Math.max(0.001, suave((s - 1.4) / 1.2));
    bloque.scale.setScalar(kEq * Math.max(0.001, suave((s - 2.2) / 0.8)));
    turbinas.forEach(({ g, rotor }, i) => {
      g.scale.setScalar(Math.max(0.001, suave((s - 2.8 - Math.min(i, 60) * 0.06) / 0.7)));
      rotor.rotation.z -= 0.035;
    });
    if (intro) {                                          // vuelo de la vista cenital a los equipos, según el tiempo
      const u = suave((s - 0.6) / 3.4);
      camara.position.set(final.x * u, alto0 + (final.y - alto0) * u, ext * 0.05 + (final.z - ext * 0.05) * u);
      const mira = foco.clone().multiplyScalar(u);
      camara.lookAt(mira);
      if (u >= 1) { intro = false; controles.target.copy(foco); }
    } else controles.update();
    renderer.render(escena, camara);
  };
  raf = requestAnimationFrame(cuadro);
  op.alEstado?.(`Relieve con exageración vertical ×${exag}${kEq > 1 ? `; aerogeneradores y bloque de potencia dibujados ×${kEq} para que se vean` : ""}. Arrastra para girar y usa la rueda para acercar.`);

  // Mapa sobre el terreno: la grilla de valores se pinta suavizada y semitransparente sobre la imagen satelital.
  const mapaOriginal = matT.map;
  const api = {
    rejilla: { x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1, n: N, elev: t.elev },
    capa(valores, paleta, rango = null) {
      if (matT.map !== mapaOriginal) matT.map.dispose();
      if (!valores) { matT.map = mapaOriginal; matT.color.set(mapaOriginal ? "#FFFFFF" : "#8FA86B"); matT.needsUpdate = true; return null; }
      let { min, max } = rango || { min: Infinity, max: -Infinity };
      if (!rango) for (const v of valores) { min = Math.min(min, v); max = Math.max(max, v); }
      if (max - min < 1e-6 * Math.max(1, Math.abs(max))) { min -= 0.5; max += 0.5; }
      const n = Math.round(Math.sqrt(valores.length));
      const chico = document.createElement("canvas"); chico.width = chico.height = n;
      const cc = chico.getContext("2d"), img = cc.createImageData(n, n);
      valores.forEach((v, k) => {
        const c = colorEn(PALETAS[paleta], (v - min) / (max - min));
        img.data.set([c.r * 255, c.g * 255, c.b * 255, 255], k * 4);
      });
      cc.putImageData(img, 0, 0);
      const lienzo = document.createElement("canvas");
      lienzo.width = t.imagen?.width || 1024; lienzo.height = t.imagen?.height || 1024;
      const ctx = lienzo.getContext("2d");
      if (t.imagen) ctx.drawImage(t.imagen, 0, 0);
      ctx.globalAlpha = t.imagen ? 0.72 : 1; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(chico, 0, 0, lienzo.width, lienzo.height);
      const tex = new THREE.CanvasTexture(lienzo); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      matT.map = tex; matT.color.set("#FFFFFF"); matT.needsUpdate = true;
      return { min, max };
    },
    repetir() { t0 = performance.now(); intro = true; },
    girar(si) { controles.autoRotate = si; },
    superior() { intro = false; camara.position.set(foco.x, foco.y + R * 1.3, foco.z + 0.01); controles.target.copy(foco); controles.update(); },
    // Graba la animación (armado y una vuelta) en WebM.
    grabar(segundos, alTerminar) {
      const tipo = ["video/webm;codecs=vp9", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(renderer.domElement.captureStream(30), { mimeType: tipo, videoBitsPerSecond: 8e6 }), partes = [];
      rec.ondataavailable = (e) => partes.push(e.data);
      rec.onstop = () => { controles.autoRotateSpeed = 0.7; alTerminar(new Blob(partes, { type: "video/webm" })); };
      api.repetir(); controles.autoRotate = true; controles.autoRotateSpeed = 3; rec.start();
      setTimeout(() => rec.stop(), segundos * 1000);
    },
    destruir() {
      cancelAnimationFrame(raf); obs.disconnect(); io.disconnect(); controles.dispose();
      escena.traverse((o) => o.geometry?.dispose()); renderer.dispose();
    },
  };
  return api;
}
