const dns = require('dns').promises;
const net = require('net');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// ── Imagen de la promoción del día para WhatsApp ───────────────────────────
// La plantilla con imagen apunta a un dominio fijo (el de Katú) y solo cambia
// el final: /api/v1/publico/promo-img/<empresa>-<producto>. Aquí se busca la
// foto del producto y se entrega tal cual. WhatsApp solo acepta JPG y PNG de
// hasta 5 MB: si no cumple, o para la muestra que revisa Meta, va el logo de Katú.
const MAX = 5 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/jpg', 'image/png'];
const RESPALDO = path.join(__dirname, '../../frontend/assets/img/logo.png');
const respaldo = () => ({ datos: fs.readFileSync(RESPALDO), tipo: 'image/png' });
const clave = (empresaId, productoId) => `${empresaId}-${productoId}`;
const urlBase = () => `${String(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/api/v1/publico/promo-img/`;

// No se descargan direcciones internas (la foto la escribe el comercio)
function ipPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && ipPrivada(x.slice(7));
}
async function descargarSegura(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Solo https');
  const ips = await dns.lookup(u.hostname, { all: true });
  if (!ips.length || ips.some(x => ipPrivada(x.address))) throw new Error('Dirección no permitida');
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX, maxRedirects: 0, validateStatus: s => s === 200 });
  const tipo = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TIPOS.includes(tipo)) throw new Error('Formato no soportado por WhatsApp');
  return { datos: Buffer.from(r.data), tipo: tipo === 'image/jpg' ? 'image/jpeg' : tipo };
}

// Pequeña caché en memoria: WhatsApp descarga la misma foto para cada destinatario
const cache = new Map();
async function obtener(c) {
  const m = String(c || '').replace(/\.(jpe?g|png)$/i, '').match(/^([a-f\d]{24})-([a-f\d]{24})$/i);
  if (!m) return respaldo();
  const g = cache.get(m[0]);
  if (g && g.hasta > Date.now()) return g.img;
  let img;
  try {
    const p = await require('../models/Producto').findOne({ _id: m[2], empresa: m[1] }).select('imagenUrl').lean();
    // Foto subida desde el panel: se lee directo de la base de datos (ya es JPG)
    const propia = require('./imagenes').idDeUrl(p?.imagenUrl);
    img = propia ? (await require('./imagenes').leer(propia)) || respaldo() : p?.imagenUrl ? await descargarSegura(p.imagenUrl) : respaldo();
  } catch { img = respaldo(); }
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(m[0], { img, hasta: Date.now() + 30 * 60000 });
  return img;
}

module.exports = { obtener, clave, urlBase, ipPrivada, TIPOS };
