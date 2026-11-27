const mongoose = require('mongoose');
const { ErrorApi } = require('./contexto');

// ── Fotos de productos ─────────────────────────────────────────────────────
// El navegador prepara la foto antes de subirla (cuadrada 800×800 sobre fondo
// blanco, JPG ~100 KB, sin datos de ubicación) y una miniatura de 320 px para
// los botones de la caja. Aquí se valida y se guarda en la misma base de datos
// (GridFS, colección "imagenes"), aparte del producto: el producto solo guarda
// la dirección, así el catálogo de la caja sigue siendo liviano.
// Para crecer se puede pasar a un almacenamiento de objetos sin tocar los productos.
const REGLAS = {
  grande: { maxBytes: 800 * 1024, min: 400, max: 1200 },
  mini:   { maxBytes: 150 * 1024, min: 120, max: 400 },
};
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'imagenes' });
const base = () => `${String(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/api/v1/publico/img/`;
const url = id => `${base()}${id}.jpg`;
// ¿La dirección es de una foto guardada por Katú? → su id
const idDeUrl = u => (String(u || '').match(/\/api\/v1\/publico\/img\/([a-f\d]{24})\.jpg(?:$|\?)/i) || [])[1] || null;

// Medidas de un JPG leyendo sus marcadores (sin librerías)
function medidasJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const largo = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 (menos DHT 0xC4, JPG 0xC8, DAC 0xCC): alto y ancho
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    i += 2 + largo;
  }
  return null;
}
function validar(buf, tipo) {
  const r = REGLAS[tipo];
  if (!buf?.length) throw new ErrorApi(`Falta la imagen ${tipo === 'mini' ? 'pequeña' : ''}`.trim());
  if (buf.length > r.maxBytes) throw new ErrorApi('La imagen pesa demasiado: vuelve a subirla desde el panel');
  const m = medidasJpeg(buf);
  if (!m) throw new ErrorApi('La imagen debe llegar en formato JPG (súbela desde el panel)');
  if (m.ancho < r.min || m.alto < r.min || m.ancho > r.max || m.alto > r.max || Math.abs(m.ancho - m.alto) > 2) throw new ErrorApi('La imagen debe ser cuadrada y de buen tamaño: súbela desde el panel');
  return m;
}

function guardarUno(buf, metadata) {
  return new Promise((ok, mal) => {
    const s = bucket().openUploadStream(`${metadata.producto}-${metadata.tipo}.jpg`, { metadata: { ...metadata, contentType: 'image/jpeg' } });
    s.once('error', mal).once('finish', () => ok(s.id));
    s.end(buf);
  });
}
async function borrar(ids = []) {
  for (const id of ids.filter(Boolean)) await bucket().delete(new mongoose.Types.ObjectId(String(id))).catch(() => null);
}
async function leer(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) return null;
  const _id = new mongoose.Types.ObjectId(String(id));
  const [f] = await bucket().find({ _id }).limit(1).toArray();
  if (!f) return null;
  const partes = [];
  for await (const c of bucket().openDownloadStream(_id)) partes.push(c);
  return { datos: Buffer.concat(partes), tipo: f.metadata?.contentType || 'image/jpeg' };
}

// Sube la foto (grande + miniatura) de un producto y borra la anterior
async function asignar(producto, grande, mini) {
  validar(grande, 'grande'); validar(mini, 'mini');
  const meta = { empresa: producto.empresa, producto: producto._id };
  const [g, p] = [await guardarUno(grande, { ...meta, tipo: 'grande' }), await guardarUno(mini, { ...meta, tipo: 'mini' })];
  const Producto = require('../models/Producto');
  const antes = await Producto.findByIdAndUpdate(producto._id, { imagenUrl: url(g), imagenMini: url(p), imagenArchivos: [g, p] }).select('+imagenArchivos').lean();
  await borrar(antes?.imagenArchivos);
  return { imagenUrl: url(g), imagenMini: url(p) };
}
async function quitar(producto) {
  const Producto = require('../models/Producto');
  const antes = await Producto.findByIdAndUpdate(producto._id, { imagenUrl: '', imagenMini: '', imagenArchivos: [] }).select('+imagenArchivos').lean();
  await borrar(antes?.imagenArchivos);
}

module.exports = { REGLAS, medidasJpeg, validar, asignar, quitar, borrar, leer, url, idDeUrl };
