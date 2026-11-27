const Turno = require('../models/Turno');
const Caja = require('../models/Caja');
const { resumen } = require('../utils/turnos');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');
const Motor = require('../../frontend/assets/js/motor');

const propio = async (req) => {
  const t = await Turno.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!t) throw new ErrorApi('Turno no encontrado', 404);
  if (req.usuario.rol === 'cajero' && String(t.cajero) !== String(req.usuario._id)) throw new ErrorApi('Ese turno es de otro cajero', 403);
  return t;
};

exports.listar = manejar(async req => Turno.find({ empresa: req.empresa._id, abiertoEn: rangoUtc(req.empresa, req.query.desde, req.query.hasta) })
  .populate('cajero', 'nombre').populate('caja', 'nombre').populate('sede', 'nombre').sort({ abiertoEn: -1 }).limit(500).lean());

exports.abrir = manejar(async req => {
  const caja = await Caja.findOne({ _id: req.body.caja, empresa: req.empresa._id, activo: true }).lean();
  if (!caja) throw new ErrorApi('La caja no existe', 404);
  const base = Motor.redondear(req.body.base, req.pais.decimales);
  if (base < 0) throw new ErrorApi('La base no puede ser negativa');
  try { return await Turno.create({ empresa: req.empresa._id, sede: caja.sede, caja: caja._id, cajero: req.usuario._id, base }); }
  catch (e) { if (e.code === 11000) throw new ErrorApi('La caja ya tiene un turno abierto', 409); throw e; }
});

exports.movimiento = manejar(async req => {
  const t = await propio(req);
  const monto = Motor.redondear(req.body.monto, req.pais.decimales);
  if (!['ingreso', 'egreso'].includes(req.body.tipo) || !(monto > 0) || !String(req.body.concepto || '').trim()) throw new ErrorApi('Tipo, valor y concepto son obligatorios');
  const n = await Turno.findOneAndUpdate({ _id: t._id, estado: 'abierto' }, { $push: { movimientos: { tipo: req.body.tipo, monto, concepto: String(req.body.concepto).trim(), usuario: req.usuario._id } } }, { new: true }).lean();
  if (!n) throw new ErrorApi('El turno ya está cerrado', 409);
  return n;
});

exports.resumen = manejar(async req => {
  const t = await propio(req);
  const r = await resumen(t, req.pais);
  // Arqueo ciego: el cajero cuenta sin ver cuánto espera el sistema
  if (req.usuario.rol === 'cajero' && req.empresa.pos?.arqueoCiego && t.estado === 'abierto') {
    return { turno: t, ciego: true, medios: Object.keys(r.esperado), ventas: r.ventas, base: r.base, movimientos: r.movimientos };
  }
  return { turno: t, ...r };
});

exports.cerrar = manejar(async req => {
  const t = await propio(req);
  if (t.estado !== 'abierto') throw new ErrorApi('El turno ya está cerrado', 409);
  const r = await resumen(t, req.pais);
  const contado = {}, diferencia = {};
  let total = 0;
  for (const k of new Set([...Object.keys(r.esperado), ...Object.keys(req.body.contado || {})])) {
    contado[k] = Motor.redondear(req.body.contado?.[k], req.pais.decimales);
    diferencia[k] = Motor.redondear(contado[k] - (r.esperado[k] || 0), req.pais.decimales);
    total = Motor.redondear(total + diferencia[k], req.pais.decimales);
  }
  const n = await Turno.findOneAndUpdate({ _id: t._id, estado: 'abierto' }, {
    estado: 'cerrado', cerradoEn: new Date(),
    arqueo: { contado, esperado: r.esperado, diferencia, diferenciaTotal: total, ventas: r.ventas, total: r.total, notas: String(req.body.notas || '').slice(0, 500), cerradoPor: req.usuario._id },
  }, { new: true }).lean();
  if (!n) throw new ErrorApi('El turno ya está cerrado', 409);
  return n;
});
