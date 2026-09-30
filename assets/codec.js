// Codificación de la demanda de Las Huichas. Esos datos son de terceros: se pueden usar dentro del simulador,
// pero no se distribuyen como un archivo legible. No es un cifrado real (la clave viaja con el sitio):
// solo evita que la serie se lea o descargue directamente. Conserva cada valor exacto (float64).

const CLAVE = "HRES-H2 · Las Huichas · uso exclusivo del simulador";

function flujo(n) {
  let s = 0;
  for (let i = 0; i < CLAVE.length; i++) s = (Math.imul(s, 31) + CLAVE.charCodeAt(i)) >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export function codificarSerie(valores) {
  const bytes = new Uint8Array(Float64Array.from(valores).buffer);
  const f = flujo(bytes.length);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ f[i]);
  return btoa(bin);
}

export function decodificarSerie(texto) {
  const bin = atob(texto), f = flujo(bin.length), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ f[i];
  return new Float64Array(bytes.buffer);
}
