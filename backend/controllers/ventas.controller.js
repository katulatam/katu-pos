const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const Venta = require('../models/Venta');
const Devolucion = require('../models/Devolucion');
const Turno = require('../models/Turno');
const ventas = require('../utils/ventas');
const facturacion = require('../utils/facturacion');
const { leerAutorizacion } = require('../middleware/auth');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');

function filtro(req) {
  const q = req.query, f = { empresa: req.empresa._id, fecha: rangoUtc(req.empresa, q.desde, q.hasta) };
  if (q.sede) f.sede = q.sede;
  if (q.cajero) f.cajero = q.cajero;
  if (q.estado) f.estado = q.estado;
  if (q.origen) f.origen = q.origen;
  if (q.medio) f['pagos.medio'] = q.medio;
  if (q.documento) f['documento.estado'] = q.documento;
  if (q.q) { delete f.fecha; const t = String(q.q).trim(); f.$or = [{ numero: t.toUpperCase() }, { 'documento.numero': t.toUpperCase() }, { clienteNombre: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }]; }
  return f;
}
exports.listar = manejar(async req => {
  const f = filtro(req), pagina = Math.max(1, Number(req.query.pagina) || 1), lim = 50;
  const [items, n] = await Promise.all([
    Venta.find(f).sort({ fecha: -1 }).skip((pagina - 1) * lim).limit(lim).populate('cajero', 'nombre').populate('sede', 'nombre').populate('caja', 'nombre').select('-items').lean(),
    Venta.aggregate([{ $match: Venta.find().cast(Venta, { ...f }) }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: { $cond: [{ $eq: ['$estado', 'anulada'] }, 0, '$total'] } } } }]),
  ]);
  return { items, total: n[0]?.n || 0, suma: n[0]?.total || 0 };
});
exports.detalle = manejar(async req => {
  const v = await Venta.findOne({ _id: req.params.id, empresa: req.empresa._id }).populate('cajero', 'nombre').populate('sede', 'nombre').populate('caja', 'nombre').populate('autorizadoPor', 'nombre').lean();
  if (!v) throw new ErrorApi('Venta no encontrada', 404);
  return { venta: v, devoluciones: await Devolucion.find({ venta: v._id }).populate('usuario', 'nombre').sort({ createdAt: -1 }).lean() };
});
// Cajero: necesita autorización de supervisor (PIN) y su turno abierto
exports.devolver = manejar(async req => {
  let usuario = req.usuario;
  if (usuario.rol === 'cajero') {
    const sup = leerAutorizacion(req.body.autorizacion, req.empresa._id);
    if (!sup) throw new ErrorApi('La devolución requiere autorización de un supervisor', 403, 'REQUIERE_AUTORIZACION');
    usuario = { _id: sup };
  }
  let turno = null;
  if (req.body.turno) { turno = await Turno.findOne({ _id: req.body.turno, empresa: req.empresa._id, estado: 'abierto' }).lean(); if (!turno) throw new ErrorApi('El turno no está abierto', 409); }
  return ventas.devolver({ empresa: req.empresa, pais: req.pais, ventaId: req.params.id, items: req.body.items, motivo: req.body.motivo, medio: req.body.medio, usuario, turno });
});
exports.reintentarDocumento = manejar(async req => {
  const v = await Venta.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!v) throw new ErrorApi('Venta no encontrada', 404);
  if (!['pendiente', 'error', 'rechazada'].includes(v.documento?.estado)) throw new ErrorApi('La venta no tiene un documento por emitir', 409);
  await Venta.updateOne({ _id: v._id, 'documento.ultimoIntento': { $lt: new Date(Date.now() - 90000) } }, { 'documento.ultimoIntento': null });
  await facturacion.procesarVenta(v._id);
  return (await Venta.findById(v._id).select('documento').lean()).documento;
});
exports.exportar = manejar(async (req, res) => {
  const lista = await Venta.find(filtro(req)).sort({ fecha: -1 }).limit(20000).populate('cajero', 'nombre').populate('sede', 'nombre').lean();
  const filas = lista.map(v => ({ Número: v.numero, Fecha: DateTime.fromJSDate(v.fecha).setZone(req.empresa.zonaHoraria).toFormat('yyyy-MM-dd HH:mm'), Sede: v.sede?.nombre, Cajero: v.cajero?.nombre, Cliente: v.clienteNombre || '', Origen: v.origen, Subtotal: v.subtotal, Descuento: v.descuento, Base: v.base, Impuesto: v.impuesto, Domicilio: v.domicilio, Total: v.total, Moneda: v.moneda, Pagos: v.pagos.map(p => p.nombre).join(', '), Estado: v.estado, Documento: v.documento?.numero || '', 'Estado documento': v.documento?.estado || '', Observación: v.documento?.error || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Ventas');
  res.setHeader('Content-Disposition', 'attachment; filename="ventas.xlsx"');
  res.type('xlsx').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});
