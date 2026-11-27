const { DateTime } = require('luxon');
const Venta = require('../models/Venta');
const Pedido = require('../models/Pedido');
const Producto = require('../models/Producto');
const Existencia = require('../models/Existencia');
const Lote = require('../models/Lote');
const Cliente = require('../models/Cliente');
const { manejar, rangoUtc } = require('../utils/contexto');
const { redondear } = require('../../frontend/assets/js/motor');

const NO_ANULADA = { estado: { $ne: 'anulada' } };
const suma = async (empresa, rango) => {
  const [x] = await Venta.aggregate([
    { $match: { empresa, fecha: rango, ...NO_ANULADA } },
    { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' }, impuesto: { $sum: '$impuesto' }, base: { $sum: '$base' }, descuento: { $sum: '$descuento' }, costo: { $sum: { $sum: '$items.costo' } }, conCliente: { $sum: { $cond: [{ $ifNull: ['$cliente', false] }, 1, 0] } } } },
  ]);
  return x || { n: 0, total: 0, impuesto: 0, base: 0, descuento: 0, costo: 0, conCliente: 0 };
};

exports.dashboard = manejar(async req => {
  const e = req.empresa._id, tz = req.empresa.zonaHoraria, dec = req.pais.decimales;
  const hoy = DateTime.now().setZone(tz), f = d => d.toISODate();
  const semanaPasada = hoy.minus({ days: 7 });
  // Comparación justa: el mismo día de la semana pasada hasta esta misma hora
  const rangoPrev = { $gte: semanaPasada.startOf('day').toJSDate(), $lt: semanaPasada.toJSDate() };
  const [act, prev, serie, horas, medios, top, pedidosHoy, agotados, vencen, docs, recientes, clientesNuevos] = await Promise.all([
    suma(e, rangoUtc(req.empresa)), suma(e, rangoPrev),
    Venta.aggregate([{ $match: { empresa: e, ...NO_ANULADA, fecha: rangoUtc(req.empresa, f(hoy.minus({ days: 13 })), f(hoy)) } }, { $group: { _id: { $dateToString: { date: '$fecha', format: '%Y-%m-%d', timezone: tz } }, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Venta.aggregate([{ $match: { empresa: e, ...NO_ANULADA, fecha: rangoUtc(req.empresa) } }, { $group: { _id: { $hour: { date: '$fecha', timezone: tz } }, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Venta.aggregate([{ $match: { empresa: e, ...NO_ANULADA, fecha: rangoUtc(req.empresa) } }, { $unwind: '$pagos' }, { $group: { _id: '$pagos.nombre', total: { $sum: '$pagos.monto' } } }, { $sort: { total: -1 } }]),
    Venta.aggregate([{ $match: { empresa: e, ...NO_ANULADA, fecha: rangoUtc(req.empresa, f(hoy.minus({ days: 6 })), f(hoy)) } }, { $unwind: '$items' }, { $group: { _id: '$items.producto', nombre: { $first: '$items.nombre' }, cantidad: { $sum: '$items.cantidad' }, total: { $sum: '$items.total' } } }, { $sort: { total: -1 } }, { $limit: 8 }]),
    Pedido.aggregate([{ $match: { empresa: e, createdAt: rangoUtc(req.empresa) } }, { $group: { _id: '$estado', n: { $sum: 1 } } }]),
    Producto.aggregate([{ $match: { empresa: e, activo: true, manejaInventario: true } }, { $lookup: { from: Existencia.collection.name, localField: '_id', foreignField: 'producto', as: 'ex' } }, { $project: { minimo: 1, n: { $sum: '$ex.cantidad' } } }, { $match: { $expr: { $lte: ['$n', '$minimo'] } } }, { $count: 'n' }]),
    Lote.countDocuments({ empresa: e, restante: { $gt: 0 }, vence: { $lte: f(hoy.plus({ days: 15 })) } }),
    Venta.aggregate([{ $match: { empresa: e, 'documento.estado': { $in: ['error', 'rechazada'] }, fecha: { $gte: hoy.minus({ days: 30 }).toJSDate() } } }, { $count: 'n' }]),
    Venta.find({ empresa: e }).sort({ fecha: -1 }).limit(8).select('numero total fecha origen clienteNombre pagos estado').lean(),
    Cliente.countDocuments({ empresa: e, createdAt: rangoUtc(req.empresa) }),
  ]);
  const m = Object.fromEntries(serie.map(s => [s._id, s]));
  const h = Object.fromEntries(horas.map(x => [x._id, x]));
  const util = redondear(act.base - act.costo, dec);
  return {
    hoy: { ...act, total: redondear(act.total, dec), utilidad: util, margen: act.base > 0 ? Math.round(util * 1000 / act.base) / 10 : 0, ticket: act.n ? redondear(act.total / act.n, dec) : 0 },
    comparacion: prev.total > 0 ? Math.round((act.total - prev.total) * 100 / prev.total) : null,
    serie: Array.from({ length: 14 }, (_, i) => { const d = f(hoy.minus({ days: 13 - i })); return { fecha: d, total: m[d]?.total || 0, n: m[d]?.n || 0 }; }),
    horas: Array.from({ length: 24 }, (_, i) => ({ hora: i, total: h[i]?.total || 0, n: h[i]?.n || 0 })),
    medios, top, pedidos: Object.fromEntries(pedidosHoy.map(p => [p._id, p.n])), alertas: { agotados: agotados[0]?.n || 0, vencen, documentos: docs[0]?.n || 0 }, recientes, clientesNuevos,
  };
});

exports.ventas = manejar(async req => {
  const e = req.empresa._id, tz = req.empresa.zonaHoraria;
  const match = { empresa: e, ...NO_ANULADA, fecha: rangoUtc(req.empresa, req.query.desde, req.query.hasta) };
  const g = (id, extra = {}) => Venta.aggregate([{ $match: match }, ...(extra.antes || []), { $group: { _id: id, n: { $sum: 1 }, total: { $sum: extra.total || '$total' }, ...(extra.acc || {}) } }, { $sort: extra.orden || { total: -1 } }]);
  const it = { antes: [{ $unwind: '$items' }], total: '$items.total', acc: { cantidad: { $sum: '$items.cantidad' }, base: { $sum: '$items.base' }, costo: { $sum: '$items.costo' }, impuesto: { $sum: '$items.impuesto' }, nombre: { $first: '$items.nombre' } } };
  const [resumen, dias, productos, categorias, cajeros, medios, impuestos, sedes, origen] = await Promise.all([
    suma(e, match.fecha),
    g({ $dateToString: { date: '$fecha', format: '%Y-%m-%d', timezone: tz } }, { orden: { _id: 1 }, acc: { impuesto: { $sum: '$impuesto' } } }),
    g('$items.producto', it), g('$items.categoria', it),
    g('$cajero'), g('$pagos.nombre', { antes: [{ $unwind: '$pagos' }], total: '$pagos.monto' }),
    g({ tipo: '$items.impuestoTipo', pct: '$items.impuestoPct' }, it), g('$sede'), g('$origen'),
  ]);
  const nombres = async (Modelo, ids) => Object.fromEntries((await Modelo.find({ _id: { $in: ids.filter(Boolean) } }).select('nombre color').lean()).map(x => [String(x._id), x.nombre]));
  const [nc, nu, ns] = await Promise.all([nombres(require('../models/Categoria'), categorias.map(x => x._id)), nombres(require('../models/Usuario'), cajeros.map(x => x._id)), nombres(require('../models/Sede'), sedes.map(x => x._id))]);
  return { resumen, dias, productos: productos.slice(0, 200), categorias: categorias.map(x => ({ ...x, nombre: nc[x._id] || 'Sin categoría' })), cajeros: cajeros.map(x => ({ ...x, nombre: nu[x._id] || 'Domicilio' })), medios, impuestos, sedes: sedes.map(x => ({ ...x, nombre: ns[x._id] })), origen };
});
