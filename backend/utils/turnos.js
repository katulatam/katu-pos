const Turno = require('../models/Turno');
const Venta = require('../models/Venta');
const Devolucion = require('../models/Devolucion');
const MovimientoCartera = require('../models/MovimientoCartera');
const Motor = require('../../frontend/assets/js/motor');

// Cuánto debería haber en la caja por cada medio de pago
async function resumen(turno, pais) {
  const id = turno._id;
  const [pagos, n, devs, abonos] = await Promise.all([
    Venta.aggregate([{ $match: { turno: id } }, { $unwind: '$pagos' }, { $group: { _id: '$pagos.medio', tipo: { $first: '$pagos.tipo' }, nombre: { $first: '$pagos.nombre' }, monto: { $sum: '$pagos.monto' }, n: { $sum: 1 } } }]),
    Venta.aggregate([{ $match: { turno: id } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' }, descuento: { $sum: '$descuento' } } }]),
    Devolucion.aggregate([{ $match: { turno: id } }, { $group: { _id: '$medio', monto: { $sum: '$monto' }, n: { $sum: 1 } } }]),
    MovimientoCartera.aggregate([{ $match: { turno: id, tipo: 'abono' } }, { $group: { _id: '$medio', monto: { $sum: '$monto' } } }]),
  ]);
  const r = v => Motor.redondear(v, pais.decimales);
  const esperado = {};
  const sumar = (k, v) => { esperado[k] = r((esperado[k] || 0) + v); };
  sumar('efectivo', turno.base || 0);
  pagos.forEach(p => { if (p.tipo !== 'fiado') sumar(p._id, p.monto); });
  devs.forEach(d => { if (d._id !== 'fiado') sumar(d._id, -d.monto); });
  abonos.forEach(a => sumar(a._id || 'efectivo', a.monto));
  (turno.movimientos || []).forEach(m => sumar('efectivo', m.tipo === 'ingreso' ? m.monto : -m.monto));
  return {
    esperado, pagos: pagos.map(p => ({ medio: p._id, nombre: p.nombre, monto: r(p.monto), n: p.n })), devoluciones: devs, abonos,
    ventas: n[0]?.n || 0, total: r(n[0]?.total || 0), descuento: r(n[0]?.descuento || 0), base: turno.base || 0, movimientos: turno.movimientos || [],
  };
}
const abierto = (empresa, caja) => Turno.findOne({ empresa, caja, estado: 'abierto' }).lean();

module.exports = { resumen, abierto };
