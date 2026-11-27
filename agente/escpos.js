// Tiquete (lista de líneas de la caja) → bytes ESC/POS. Codificación CP850.
const CP850 = { 'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A, 'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, '¿': 0xA8, '¡': 0xAD, '°': 0xF8, '·': 0xFA, 'ç': 0x87, 'Ç': 0x80, 'ã': 0xC6, 'õ': 0xE4, 'â': 0x83, 'ê': 0x88, 'ô': 0x93, 'à': 0x85 };
const limpiar = s => String(s ?? '').replace(/[   ]/g, ' ').replace(/[–—−]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/×/g, 'x');
const codificar = s => Buffer.from([...limpiar(s)].map(c => { const k = c.codePointAt(0); return k >= 32 && k < 127 ? k : CP850[c] ?? 63; }));

// Parte un texto largo en renglones sin cortar palabras (salvo que no quepan)
function partir(s, ancho) {
  const out = []; let r = '';
  for (let p of limpiar(s).split(' ')) {
    while (p.length > ancho) { if (r) { out.push(r); r = ''; } out.push(p.slice(0, ancho)); p = p.slice(ancho); }
    if ((r ? r.length + 1 : 0) + p.length > ancho) { out.push(r); r = p; } else r = r ? r + ' ' + p : p;
  }
  if (r || !out.length) out.push(r);
  return out;
}
function dosColumnas(izq, der, ancho) {
  izq = limpiar(izq); der = limpiar(der);
  if (izq.length + der.length + 1 <= ancho) return [izq + ' '.repeat(ancho - izq.length - der.length) + der];
  const l = partir(izq, ancho);
  const ult = l[l.length - 1];
  if (ult.length + der.length + 1 <= ancho) l[l.length - 1] = ult + ' '.repeat(ancho - ult.length - der.length) + der;
  else l.push(' '.repeat(Math.max(0, ancho - der.length)) + der);
  return l;
}

const CAJON = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
function tiquete(lineas, { columnas = 48, cajon = false } = {}) {
  const b = [Buffer.from([0x1B, 0x40, 0x1B, 0x74, 0x02])];          // reiniciar, página de códigos 850
  if (cajon) b.push(CAJON);
  const txt = s => b.push(codificar(s), Buffer.from([0x0A]));
  for (const l of lineas || []) {
    if (l.hr) { txt('-'.repeat(columnas)); continue; }
    if (l.qr) continue;                                             // las imágenes solo salen por navegador
    const cols = l.g ? Math.floor(columnas / 2) : columnas;
    b.push(Buffer.from([0x1B, 0x61, l.al === 'c' ? 1 : l.al === 'r' ? 2 : 0, 0x1B, 0x45, l.b ? 1 : 0, 0x1D, 0x21, l.g ? 0x11 : 0x00]));
    (l.d !== undefined ? dosColumnas(l.d, l.v, cols) : partir(l.tx, cols)).forEach(txt);
  }
  b.push(Buffer.from([0x1B, 0x61, 0, 0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00])); // avance y corte
  return Buffer.concat(b);
}

module.exports = { tiquete, codificar, partir, dosColumnas, CAJON };
