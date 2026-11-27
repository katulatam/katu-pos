// API de los EQUIPOS de cobro (firma HMAC): datáfonos integrados y kioscos de
// efectivo. El equipo pregunta si hay un cobro para él y reporta el resultado.
const express = require('express');
const Cobro = require('../models/Cobro');
const { firmaDispositivo } = require('../middleware/firmaDispositivo');
const { manejar, ErrorApi } = require('../utils/contexto');
const Motor = require('../../frontend/assets/js/motor');

const r = express.Router();
r.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

const pendiente = manejar(async req => {
  const c = await Cobro.findOne({ dispositivo: req.dispositivo._id, estado: 'pendiente', expiraEn: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
  return c ? { cobro: c._id, referencia: c.referencia, monto: c.monto, recibido: c.recibido, moneda: req.pais.moneda, decimales: req.pais.decimales } : null;
});
const suyo = async req => {
  const c = await Cobro.findOne({ _id: req.params.id, dispositivo: req.dispositivo._id }).lean();
  if (!c) throw new ErrorApi('Cobro no encontrado', 404);
  return c;
};

// Datáfono: { estado: 'aprobado'|'rechazado', autorizacion, franquicia, ultimos4 }
r.get('/terminal/pendiente', firmaDispositivo('terminal'), pendiente);
r.post('/terminal/cobros/:id/resultado', firmaDispositivo('terminal'), manejar(async req => {
  const c = await suyo(req);
  const { estado, autorizacion, franquicia, ultimos4 } = req.body;
  if (!['aprobado', 'rechazado'].includes(estado)) throw new ErrorApi('Estado inválido');
  const n = await Cobro.findOneAndUpdate({ _id: c._id, estado: 'pendiente' }, { estado, autorizacion: String(autorizacion || '').slice(0, 40), detalle: [franquicia, ultimos4 && `****${ultimos4}`].filter(Boolean).join(' '), ...(estado === 'aprobado' && { aprobadoEn: new Date() }) }, { new: true }).lean();
  return { estado: (n || await suyo(req)).estado };
}));

// Kiosco: cada billete/moneda llega con un txId único. Idempotente: el mismo
// txId nunca suma dos veces. Al completar el valor queda aprobado con su cambio.
r.get('/kiosco/pendiente', firmaDispositivo('kiosco_efectivo'), pendiente);
r.post('/kiosco/cobros/:id/dinero', firmaDispositivo('kiosco_efectivo'), manejar(async req => {
  const c = await suyo(req);
  const txId = String(req.body.txId || '').trim();
  const valor = Motor.redondear(req.body.denominacion, req.pais.decimales);
  if (!txId || !(valor > 0)) throw new ErrorApi('txId y denominacion son obligatorios');
  await Cobro.updateOne({ _id: c._id, estado: 'pendiente', 'eventos.txId': { $ne: txId } }, {
    $push: { eventos: { txId, tipo: String(req.body.tipo || 'billete'), valor } }, $inc: { recibido: valor },
    $set: { expiraEn: new Date(Date.now() + 5 * 60000) },
  });
  let n = await Cobro.findById(c._id).lean();
  if (n.estado === 'pendiente' && n.recibido >= n.monto) {
    await Cobro.updateOne({ _id: c._id, estado: 'pendiente' }, { estado: 'aprobado', aprobadoEn: new Date(), cambio: Motor.redondear(n.recibido - n.monto, req.pais.decimales) });
    n = await Cobro.findById(c._id).lean();
  }
  return { estado: n.estado, recibido: n.recibido, falta: Math.max(0, Motor.redondear(n.monto - n.recibido, req.pais.decimales)), cambio: n.cambio };
}));
// El kiosco devolvió el dinero (cliente se arrepintió o expiró)
r.post('/kiosco/cobros/:id/devuelto', firmaDispositivo('kiosco_efectivo'), manejar(async req => {
  const c = await suyo(req);
  const n = await Cobro.findOneAndUpdate({ _id: c._id, estado: 'pendiente' }, { estado: 'cancelado', recibido: 0, detalle: `Devuelto ${c.recibido}` }, { new: true }).lean();
  return { estado: (n || c).estado };
}));

module.exports = r;
