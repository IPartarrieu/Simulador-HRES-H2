// Vista 3D animada del layout de un resultado: terreno con su relieve (Terrain Tiles de AWS) cubierto
// con la imagen satelital (Esri), y encima los aerogeneradores (con las aspas girando), las filas de paneles y
// el bloque de potencia, en las posiciones de layoutResultado (zona.js). Sobre el terreno se puede pintar un mapa
// (recurso eólico o solar, calculado en zona.js con la grilla `rejilla`). Usa three.js (vendor/three).
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { proyeccion, centro } from "./zona.js?v=20261015f";

const N = 64;                                  // grilla de elevación N × N
const cacheTerreno = new Map();
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Datos del terreno ---------- */

// Mosaico de teselas web (Mercator) que cubre la caja [norte, sur, oeste, este] al nivel z.
// Devuelve el lienzo y la función que pasa de [lat, lon] a píxeles del lienzo.
async function mosaico(url, { norte, sur, oeste, este }, z) {
  const merc = ([la, lo]) => {
    const s = Math.sin((la * Math.PI) / 180), n = 256 * 2 ** z;
    return [((lo + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  const [x0, y0] = merc([norte, oeste]), [x1, y1] = merc([sur, este]);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(x1 - x0)); lienzo.height = Math.max(1, Math.round(y1 - y0));
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  const tareas = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) {
    tareas.push(new Promise((ok, mal) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0); ok(); };
      img.onerror = () => mal(new Error("no se pudo descargar una tesela"));
      img.src = url(z, tx, ty);
    }));
  }
  await Promise.all(tareas);
  return { lienzo, ctx, px: (p) => { const [x, y] = merc(p); return [x - x0, y - y0]; } };
}
const nivel = (caja, pixeles, max) => lim(Math.floor(Math.log2((156543.03 * Math.cos((((caja.norte + caja.sur) / 2) * Math.PI) / 180) * pixeles) / caja.anchoM)), 3, max);

// Elevación de las Terrain Tiles de AWS (formato Terrarium: h = R·256 + G + B/256 − 32768 m).
async function elevaciones(puntos, caja) {
  const m = await mosaico((z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, caja, nivel(caja, 512, 14));
  const { data, width, height } = m.ctx.getImageData(0, 0, m.lienzo.width, m.lienzo.height);
  const h = puntos.map((p) => {
    const [x, y] = m.px(p), k = (lim(Math.round(y), 0, height - 1) * width + lim(Math.round(x), 0, width - 1)) * 4;
    return data[k + 3] < 255 ? NaN : data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
  });
  // Píxeles sin dato (fuera de una tesela o con valores imposibles en Chile) → mediana de la grilla.
  const validos = h.filter((v) => v > -500 && v < 7000).sort((a, b) => a - b);
  const mediana = validos.length ? validos[Math.floor(validos.length / 2)] : 0;
  const e = h.map((v) => (v > -500 && v < 7000 ? v : mediana));
  // Picos aislados (píxeles erróneos en el borde de una tesela): más de 150 m sobre o bajo la mediana de sus vecinos.
  return e.map((v, k) => {
    const i = Math.floor(k / N), j = k % N, vec = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && i + a >= 0 && i + a < N && j + b >= 0 && j + b < N) vec.push(e[(i + a) * N + j + b]);
    vec.sort((x, y) => x - y);
    const med = vec[Math.floor(vec.length / 2)];
    return Math.abs(v - med) > 150 ? med : v;
  });
}

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

async function terreno(pts) {
  const clave = JSON.stringify(pts);
  if (cacheTerreno.has(clave)) return cacheTerreno.get(clave);
  const pr = proyeccion(centro(pts)), loc = pts.map(pr.a);
  const X = loc.map((p) => p[0]), Y = loc.map((p) => p[1]);
  const marg = 0.18 * Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y));
  const [x0, x1, y0, y1] = [Math.min(...X) - marg, Math.max(...X) + marg, Math.min(...Y) - marg, Math.max(...Y) + marg];
  const puntos = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) puntos.push(pr.b([x0 + (j / (N - 1)) * (x1 - x0), y1 - (i / (N - 1)) * (y1 - y0)]));
  const [no, oe] = pr.b([x0, y1]), [su, es] = pr.b([x1, y0]);
  const caja = { norte: no, sur: su, oeste: oe, este: es, anchoM: x1 - x0 };
  const [elev, imagen] = await Promise.all([elevaciones(puntos, caja), satelite(caja, pts).catch(() => null)]);
  const t = { x0, x1, y0, y1, elev, imagen };
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
  const exag = Math.round(lim((0.1 * ext) / Math.max(eMax - eMin, 1), 1, 5) * 2) / 2;   // exageración vertical
  // Encuadre final: alrededor de los equipos (no de toda la zona), para que se vean de cerca.
  const ptsEq = [...op.geo.turb, ...op.geo.pv, op.geo.bloque];
  const ce = [ptsEq.reduce((a, p) => a + p[0], 0) / ptsEq.length, ptsEq.reduce((a, p) => a + p[1], 0) / ptsEq.length];
  const radioEq = Math.max(...ptsEq.map((p) => Math.hypot(p[0] - ce[0], p[1] - ce[1]))) + op.geo.lado;
  const R = lim(2.6 * radioEq, 180, ext);
  const kEq = Math.round(lim(R / 700, 1, 4) * 2) / 2;                                    // escala visual de los equipos
  const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
  const altura = (x, y) => {                              // x al este, y al norte (metros locales) → altura en la escena
    const fj = lim(((x - t.x0) / ancho) * (N - 1), 0, N - 1.001), fi = lim(((t.y1 - y) / alto) * (N - 1), 0, N - 1.001);
    const j = Math.floor(fj), i = Math.floor(fi), a = fj - j, b = fi - i, e = (r, c) => t.elev[r * N + c];
    return ((e(i, j) * (1 - a) + e(i, j + 1) * a) * (1 - b) + (e(i + 1, j) * (1 - a) + e(i + 1, j + 1) * a) * b - eMin) * exag;
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
  for (let k = 0; k < pos.count; k++) pos.setY(k, (t.elev[k] - eMin) * exag);
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

  // Paneles: filas inclinadas en β mirando al norte (InstancedMesh)
  const filas = [], lado = op.geo.lado, nf = Math.max(1, Math.round(lado / op.pitchM));
  for (const [x, y] of op.geo.pv) for (let f = 0; f < nf; f++) filas.push([x, y - lado / 2 + (f + 0.5) * (lado / nf)]);
  const grupoPv = new THREE.Group(); escena.add(grupoPv);
  if (filas.length) {
    const beta = (op.beta * Math.PI) / 180;
    const pv = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat("#2456A6", { metalness: 0.5, roughness: 0.22 }), filas.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-beta, 0, 0)), s = new THREE.Vector3(lado * 1.01, 0.12, op.largoMesa);
    filas.forEach(([x, y], i) => pv.setMatrixAt(i, m4.compose(v3(x, y, 1.2 + (op.largoMesa / 2) * Math.sin(beta)), q, s)));
    pv.castShadow = pv.receiveShadow = true; grupoPv.add(pv);
  }

  // Aerogeneradores (×kEq para que se vean), con el rotor de frente al eje del viento
  const blanco = mat("#F7F8FA", { roughness: 0.4 });
  const giroY = Math.PI - (op.eje * Math.PI) / 180;
  const turbinas = op.geo.turb.slice(0, 400).map(([x, y]) => {
    const { g, rotor } = aerogenerador(op.equipos.wt.rotor * kEq, op.equipos.wt.hub * kEq, blanco);
    g.position.copy(v3(x, y)); g.rotation.y = giroY; g.scale.setScalar(0.001); escena.add(g);
    return { g, rotor };
  });

  const bloque = bloquePotencia(op.cfg, op.equipos);
  bloque.position.copy(v3(op.geo.bloque[0], op.geo.bloque[1])); bloque.scale.setScalar(0.001);
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
