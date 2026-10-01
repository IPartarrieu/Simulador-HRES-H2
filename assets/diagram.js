// Diagrama de la arquitectura HRES en SVG (al estilo de la figura del sistema de la tesis) y su descarga.
// Solo dibuja los módulos elegidos. Si hay resultados, agrega bajo cada equipo la cantidad y la potencia.

const TINTA = "#1E2530", FLECHA = "#3A4250";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Caja con ícono y nombre. `detalle`: hasta dos líneas de texto bajo la caja (o sobre ella si `arriba`).
function caja(x, y, w, h, etiqueta, icono, detalle, arriba = false) {
  const lineas = (Array.isArray(detalle) ? detalle : detalle ? [detalle] : []).filter(Boolean);
  const y0 = arriba ? y - 8 - 14 * (lineas.length - 1) : y + h + 16;
  const textos = lineas.map((l, i) => `<text x="${x + w / 2}" y="${y0 + 14 * i}" text-anchor="middle" font-size="11.5" fill="#465466">${esc(l)}</text>`).join("");
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#FFFFFF" stroke="${TINTA}" stroke-width="2.2"/>` +
    (icono ? `<g transform="translate(${x + w / 2} ${y + (h - 22) / 2 + 2})">${icono}</g>` : "") +
    (etiqueta ? `<text x="${x + w / 2}" y="${y + h - 10}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${TINTA}">${esc(etiqueta)}</text>` : "") + textos + `</g>`;
}
const flecha = (x1, y1, x2, y2, doble = false) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${FLECHA}" stroke-width="3" marker-end="url(#pf)"${doble ? ' marker-start="url(#pi)"' : ""}/>`;

const ICONOS = {
  pv: `<rect x="-34" y="-26" width="68" height="40" rx="3" fill="#2446A8" stroke="${TINTA}" stroke-width="2"/>` +
      `<path d="M-11 -26V14M12 -26V14M-34 -6H34" stroke="#0F1E4D" stroke-width="2.5"/>` +
      `<path d="M-22 14V24M22 14V24M-30 24H30" stroke="${TINTA}" stroke-width="2.5"/>`,
  wt: `<rect x="-38" y="16" width="76" height="8" rx="4" fill="#7BC96F"/>` +
      `<path d="M-2 18L-1 -6H1L2 18Z" fill="#B8C4D2" stroke="${TINTA}" stroke-width="1.5"/>` +
      `<g transform="translate(0 -8)" fill="#E6EDF5" stroke="${TINTA}" stroke-width="1.5">` +
      `<path d="M0 0C-4 -10 -2 -24 0 -30C2 -24 4 -10 0 0Z"/><path d="M0 0C-4 -10 -2 -24 0 -30C2 -24 4 -10 0 0Z" transform="rotate(120)"/>` +
      `<path d="M0 0C-4 -10 -2 -24 0 -30C2 -24 4 -10 0 0Z" transform="rotate(240)"/><circle r="5" fill="#8C6BC8"/></g>` +
      `<path d="M-38 -4H-24M-34 4H-22M26 -2H38M24 6H36" stroke="${TINTA}" stroke-width="2" stroke-linecap="round"/>`,
  ele: `<rect x="-20" y="-24" width="40" height="24" rx="3" fill="#FFFFFF" stroke="${TINTA}" stroke-width="2"/>` +
       `<path d="M-12 -30V-24M12 -30V-24M-14 -12H-6M6 -12H14M10 -16V-8" stroke="${TINTA}" stroke-width="2"/>` +
       `<path d="M-24 6q6 -5 12 0t12 0t12 0t12 0M-24 14q6 -5 12 0t12 0t12 0t12 0" fill="none" stroke="#3E7BD6" stroke-width="2.4"/>`,
  ht: `<g fill="#EEF4FB" stroke="#4E78B5" stroke-width="2"><rect x="-24" y="-24" width="20" height="44" rx="8"/><rect x="4" y="-24" width="20" height="44" rx="8"/></g>` +
      `<circle cx="0" cy="-30" r="6" fill="#FFFFFF" stroke="#4E78B5" stroke-width="2"/><path d="M-14 -24V-30H14V-24" fill="none" stroke="#4E78B5" stroke-width="2"/>`,
  fc: `<rect x="-30" y="-22" width="60" height="42" rx="3" fill="#BFD7F2" stroke="${TINTA}" stroke-width="2"/>` +
      `<rect x="-24" y="-14" width="22" height="28" fill="#6AA5E0"/><rect x="2" y="-14" width="22" height="28" fill="#5BC2B4"/>` +
      `<path d="M14 -10L8 1H13L9 11L17 -2H12Z" fill="#F2C94C"/><rect x="-10" y="-30" width="30" height="8" fill="#E8C66A" stroke="${TINTA}" stroke-width="1.5"/>`,
  bat: `<rect x="-30" y="-20" width="56" height="36" rx="4" fill="#FFFFFF" stroke="${TINTA}" stroke-width="2.2"/>` +
       `<rect x="26" y="-8" width="6" height="12" rx="1.5" fill="${TINTA}"/>` +
       `<g fill="#3FAE6A"><rect x="-25" y="-15" width="10" height="26" rx="1.5"/><rect x="-12" y="-15" width="10" height="26" rx="1.5"/><rect x="1" y="-15" width="10" height="26" rx="1.5"/></g>` +
       `<path d="M17 -12L12 -1H16L13 9L20 -4H16Z" fill="#F2C94C" stroke="${TINTA}" stroke-width=".8"/>`,
  dg: `<rect x="-32" y="-18" width="56" height="34" rx="3" fill="#E3A33B" stroke="${TINTA}" stroke-width="2"/>` +
      `<path d="M-26 -10H-2M-26 -3H-2M-26 4H-2" stroke="#8A5A12" stroke-width="2.4"/>` +
      `<circle cx="11" cy="-1" r="8" fill="#FFFFFF" stroke="${TINTA}" stroke-width="1.8"/><path d="M11 -1L15 -5" stroke="${TINTA}" stroke-width="1.8"/>` +
      `<rect x="16" y="-30" width="6" height="12" fill="#7F8C9D" stroke="${TINTA}" stroke-width="1.4"/>` +
      `<path d="M-34 16H28M-28 16V22M20 16V22" stroke="${TINTA}" stroke-width="2.4"/>` +
      `<circle cx="28" cy="-34" r="3" fill="#B8C4D2"/><circle cx="33" cy="-40" r="2.3" fill="#D0D8E2"/>`,
  load: `<g stroke="${TINTA}" stroke-width="1.5"><path d="M-30 -2L-12 -22L6 -2V20H-30Z" fill="#C9D3DE"/><path d="M-34 0L-12 -26L10 0" fill="none" stroke="#E0554A" stroke-width="4"/>` +
        `<path d="M0 6L16 -12L32 6V24H0Z" fill="#AEBBC9"/><path d="M-4 8L16 -16L36 8" fill="none" stroke="#E0554A" stroke-width="4"/>` +
        `<rect x="-18" y="6" width="9" height="14" fill="#E8894A"/><rect x="12" y="12" width="8" height="12" fill="#E8894A"/></g>`,
};

const fmt = (n, dec = 0) => Number(n).toLocaleString("es-CL", { maximumFractionDigits: dec, minimumFractionDigits: dec });
function potencia(kw) { return kw >= 1000 ? `${fmt(kw / 1000, 2)} MW` : `${fmt(kw, kw < 10 ? 1 : 0)} kW`; }
function energia(kwh) { return kwh >= 1000 ? `${fmt(kwh / 1000, 2)} MWh` : `${fmt(kwh, 1)} kWh`; }

// arq: {wt, pv, hess, bat, dg}; equipos: módulos elegidos; cfg: cantidades (opcional); titulo: texto al pie.
export function svgDiagrama({ arq, equipos, cfg, titulo }) {
  const hayDC = arq.pv || arq.hess || arq.bat;
  const partes = [];
  const extra = arq.bat || arq.dg ? 70 : 0;            // la batería y el diésel van bajo el conversor y la carga
  const X_DC = 320, X_AC = 580, Y0 = 30, Y1 = 404 + extra;
  const det = (n, unidad, total) => (cfg ? [`${fmt(n)} × ${unidad}`, total ? `= ${total}` : ""] : null);
  if (hayDC) {
    partes.push(`<line x1="${X_DC}" y1="${Y0}" x2="${X_DC}" y2="${Y1}" stroke="${TINTA}" stroke-width="5"/>`,
      `<text x="${X_DC}" y="${Y1 + 26}" text-anchor="middle" font-size="15" fill="${TINTA}">Bus DC</text>`,
      caja(405, 262, 100, 46, "", "", det(cfg?.[2], potencia(equipos.con.pr), cfg && potencia(cfg[2] * equipos.con.pr))),
      `<text x="455" y="291" text-anchor="middle" font-size="17" font-weight="600" fill="${TINTA}">DC/AC</text>`,
      flecha(X_DC + 4, 285, 401, 285, true), flecha(509, 285, X_AC - 4, 285, true));
  }
  partes.push(`<line x1="${X_AC}" y1="${Y0}" x2="${X_AC}" y2="${Y1}" stroke="${TINTA}" stroke-width="5"/>`,
    `<text x="${X_AC}" y="${Y1 + 26}" text-anchor="middle" font-size="15" fill="${TINTA}">Bus AC</text>`);
  if (arq.pv) partes.push(caja(150, Y0, 110, 110, "Fotovoltaico", ICONOS.pv, det(cfg?.[1], `${fmt(equipos.pv.pr * 1000)} W`, cfg && potencia(cfg[1] * equipos.pv.pr))), flecha(260, 85, X_DC - 4, 85));
  if (arq.wt) partes.push(caja(400, Y0, 110, 110, "Aerogenerador", ICONOS.wt, det(cfg?.[0], potencia(equipos.wt.pr), cfg && potencia(cfg[0] * equipos.wt.pr))), flecha(510, 85, X_AC - 4, 85));
  partes.push(caja(640, 170, 112, 106, "Carga", ICONOS.load, null), flecha(X_AC + 2, 223, 636, 223));
  if (arq.bat) {
    partes.push(caja(405, 360, 100, 80, "Baterías", ICONOS.bat, det(cfg?.[6], energia(equipos.bat.cap), cfg && energia(cfg[6] * equipos.bat.cap))),
      flecha(X_DC + 4, 400, 401, 400, true));
  }
  if (arq.dg) {
    partes.push(caja(640, 330, 112, 96, "Diésel", ICONOS.dg, det(cfg?.[7], potencia(equipos.dg.pr), cfg && potencia(cfg[7] * equipos.dg.pr))),
      flecha(636, 378, X_AC + 4, 378));
  }
  if (arq.hess) {
    partes.push(
      caja(190, 196, 94, 84, "Electrolizador", ICONOS.ele, det(cfg?.[3], potencia(equipos.ele.pr), cfg && potencia(cfg[3] * equipos.ele.pr))),
      flecha(X_DC - 2, 238, 288, 238),
      caja(40, 196, 92, 84, "Tanques H₂", ICONOS.ht, det(cfg?.[4], energia(equipos.ht.cap), cfg && energia(cfg[4] * equipos.ht.cap)), true),
      flecha(190, 238, 136, 238),
      `<path d="M86 280 V372 H146" fill="none" stroke="${FLECHA}" stroke-width="3" marker-end="url(#pf)"/>`,
      caja(150, 332, 96, 80, "Celda de comb.", ICONOS.fc, det(cfg?.[5], potencia(equipos.fc.pr), cfg && potencia(cfg[5] * equipos.fc.pr))),
      flecha(246, 372, X_DC - 4, 372));
  }
  const minX = hayDC ? 20 : 370, maxX = 770;
  const ancho = maxX - minX, alto = (titulo ? 480 : 452) + extra;
  const pie = titulo ? `<text x="${minX + 12}" y="${Y0 - 20 + alto - 12}" font-size="12" fill="#6B7788">${esc(titulo)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${Y0 - 20} ${ancho} ${alto}" width="${Math.round(ancho * 1.25)}" height="${Math.round(alto * 1.25)}" font-family="Inter, 'Segoe UI', Arial, sans-serif">` +
    `<defs><marker id="pf" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${FLECHA}"/></marker>` +
    `<marker id="pi" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M10 0L0 5L10 10Z" fill="${FLECHA}"/></marker></defs>` +
    `<rect x="${minX}" y="${Y0 - 20}" width="${ancho}" height="${alto}" fill="#FFFFFF"/>` + partes.join("") + pie + `</svg>`;
}

export function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function descargarSVG(svg, nombre) { descargar(new Blob([svg], { type: "image/svg+xml" }), nombre); }

export function descargarPNG(svg, nombre, escala = 2) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width * escala; c.height = img.height * escala;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => descargar(b, nombre), "image/png");
  };
  img.src = url;
}
