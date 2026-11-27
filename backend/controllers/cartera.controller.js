const Cliente = require('../models/Cliente');
const MovimientoCartera = require('../models/MovimientoCartera');
const Turno = require('../models/Turno');
const { manejar, ErrorApi, mediosDe } = require('../utils/contexto');
const Motor = require('../../frontend/assets/js/motor');

exports.listar = manejar(async req => Cliente.find({ empresa: req.empresa._id, $or: [{ deuda: { $gt: 0 } }, { cupo: { $gt: 0 } }] }).select('nombre telefono documento cupo deuda ultimaCompra').sort({ deuda: -1 }).lean());
exports.movimientos = manejar(async req => MovimientoCartera.find({ empresa: req.empresa._id, cliente: req.params.cliente }).populate('usuario', 'nombre').populate('venta', 'numero').sort({ createdAt: -1 }).limit(200).lean());
exports.abonar = manejar(async req => {
  const monto = Motor.redondear(req.body.monto, req.pais.decimales);
  if (!(monto > 0)) throw new ErrorApi('El abono debe ser mayor a cero');
  const medio = mediosDe(req.empresa, req.pais).find(m => m.codigo === (req.body.medio || 'efectivo') && m.tipo !== 'fiado' && m.tipo !== 'qr');
  if (!medio) throw new ErrorApi('Medio de pago inválido para abonos');
  let turno = null;
  if (req.body.turno) { turno = await Turno.findOne({ _id: req.body.turno, empresa: req.empresa._id, estado: 'abierto' }).lean(); if (!turno) throw new ErrorApi('El turno no está abierto', 409); }
  else if (req.usuario.rol === 'cajero') throw new ErrorApi('Abre un turno para recibir abonos');
  const c = await Cliente.findOneAndUpdate({ _id: req.params.cliente, empresa: req.empresa._id, deuda: { $gte: monto - 1e-9 } }, [{ $set: { deuda: { $round: [{ $subtract: ['$deuda', monto] }, req.pais.decimales] } } }], { new: true }).lean();
  if (!c) throw new ErrorApi('El abono supera la deuda del cliente', 409);
  await MovimientoCartera.create({ empresa: req.empresa._id, cliente: c._id, tipo: 'abono', monto, saldo: c.deuda, medio: medio.codigo, turno: turno?._id, usuario: req.usuario._id, notas: req.body.notas });
  return { deuda: c.deuda };
});
