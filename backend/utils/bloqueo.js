const crypto = require('crypto');
const mongoose = require('mongoose');

// ── Bloqueos distribuidos en MongoDB ───────────────────────────────────────
// Con varios contenedores detrás del balanceador, las tareas programadas
// (facturación, campañas, cobros) deben correr en UNO solo a la vez. Cada
// bloqueo vence solo (si el contenedor muere, otro lo toma al vencer).
const Bloqueo = mongoose.models.Bloqueo || mongoose.model('Bloqueo', new mongoose.Schema({
  _id: String, hasta: Date, dueno: String,
}, { versionKey: false, collection: 'bloqueos' }));

const YO = `${require('os').hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

async function tomar(nombre, ms) {
  const ahora = new Date();
  try {
    const r = await Bloqueo.findOneAndUpdate(
      { _id: nombre, hasta: { $lt: ahora } }, // solo si está libre o vencido (tampoco se reentra en el mismo contenedor)
      { hasta: new Date(ahora.getTime() + ms), dueno: YO },
      { upsert: true, new: true }).lean();
    return r?.dueno === YO;
  } catch (e) {
    if (e.code === 11000) return false; // lo tiene otro contenedor y no ha vencido
    throw e;
  }
}
const soltar = nombre => Bloqueo.deleteOne({ _id: nombre, dueno: YO }).catch(() => {});

// Ejecuta fn solo si este contenedor obtiene el bloqueo
async function conBloqueo(nombre, ms, fn) {
  if (!(await tomar(nombre, ms))) return false;
  try { await fn(); } finally { await soltar(nombre); }
  return true;
}

module.exports = { tomar, soltar, conBloqueo, YO };
