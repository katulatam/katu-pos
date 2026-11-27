const { DateTime } = require('luxon');
const Existencia = require('../models/Existencia');
const Producto = require('../models/Producto');
const Sede = require('../models/Sede');
const Lote = require('../models/Lote');
const Venta = require('../models/Venta');
const MovimientoInventario = require('../models/MovimientoInventario');
const Proveedor = require('../models/Proveedor');
const inventario = require('../utils/inventario');
const { manejar, ErrorApi } = require('../utils/contexto');
const { r3, redondear } = require('../../frontend/assets/js/motor');

const sedeDe = async (req, id) => {
  const s = await Sede.findOne({ _id: id, empresa: req.empresa._id }).lean();
  if (!s) throw new ErrorApi('La sede no existe', 404);
  return s;
};
const productoDe = async (req, id) => {
  const p = await Producto.findOne({ _id: id, empresa: req.empresa._id }).lean();
  if (!p) throw new ErrorApi('El producto no existe', 404);
  if (!p.manejaInventario) throw new ErrorApi(`${p.nombre} no maneja inventario`);
  return p;
};

exports.existencias = manejar(async req => {
  const f = { empresa: req.empresa._id, manejaInventario: true, activo: true };
  const [prods, ex] = await Promise.all([
    Producto.find(f).select('nombre codigo plu unidad costo precio minimo categoria').populate('categoria', 'nombre color').sort({ nombre: 1 }).lean(),
    Existencia.find({ empresa: req.empresa._id, ...(req.query.sede && { sede: req.query.sede }) }).lean(),
  ]);
  const m = new Map();
  ex.forEach(e => { const k = String(e.producto); const v = m.get(k) || { cantidad: 0, reservado: 0 }; v.cantidad = r3(v.cantidad + e.cantidad); v.reservado = r3(v.reservado + e.reservado); m.set(k, v); });
  return prods.map(p => { const v = m.get(String(p._id)) || { cantidad: 0, reservado: 0 }; return { ...p, ...v, disponible: r3(v.cantidad - v.reservado), valor: redondear(Math.max(0, v.cantidad) * (p.costo || 0), req.pais.decimales), bajo: v.cantidad <= (p.minimo || 0) }; });
});

exports.kardex = manejar(async req => MovimientoInventario.find({ empresa: req.empresa._id, producto: req.params.producto, ...(req.query.sede && { sede: req.query.sede }) })
  .populate('usuario', 'nombre').populate('sede', 'nombre').sort({ createdAt: -1 }).limit(300).lean());

// Ajuste: por conteo físico (contado) o por diferencia (cantidad ±)
exports.ajustar = manejar(async req => {
  const sede = await sedeDe(req, req.body.sede), p = await productoDe(req, req.body.producto);
  const tipo = req.body.tipo === 'merma' ? 'merma' : req.body.tipo === 'inicial' ? 'inicial' : 'ajuste';
  if (!String(req.body.motivo || '').trim()) throw new ErrorApi('El motivo es obligatorio');
  let q;
  if (req.body.contado !== undefined && req.body.contado !== '') {
    const ex = await Existencia.findOne({ sede: sede._id, producto: p._id }).lean();
    q = r3(Number(req.body.contado) - (ex?.cantidad || 0));
  } else q = r3(tipo === 'merma' ? -Math.abs(req.body.cantidad) : req.body.cantidad);
  if (!Number.isFinite(q) || !q) throw new ErrorApi('No hay diferencia por ajustar');
  const [m] = await inventario.mover({ empresa: req.empresa._id, sede: sede._id, lineas: [{ producto: p._id, nombre: p.nombre, cantidad: q, costo: p.costo, vencimiento: p.manejaVencimiento }], tipo, motivo: String(req.body.motivo).trim(), usuario: req.usuario._id });
  return { saldo: m.saldo, diferencia: q };
});

exports.trasladar = manejar(async req => {
  const [o, d] = [await sedeDe(req, req.body.origen), await sedeDe(req, req.body.destino)];
  if (String(o._id) === String(d._id)) throw new ErrorApi('Elige dos sedes distintas');
  const lineas = [];
  for (const i of req.body.items || []) { const p = await productoDe(req, i.producto); const q = r3(i.cantidad); if (!(q > 0)) throw new ErrorApi('Cantidad inválida'); lineas.push({ producto: p._id, nombre: p.nombre, cantidad: q, costo: p.costo }); }
  if (!lineas.length) throw new ErrorApi('Agrega productos al traslado');
  const ref = `${o.nombre} → ${d.nombre}`;
  await inventario.mover({ empresa: req.empresa._id, sede: o._id, lineas: lineas.map(l => ({ ...l, cantidad: -l.cantidad })), tipo: 'traslado', referencia: ref, usuario: req.usuario._id, permitirNegativo: false });
  await inventario.mover({ empresa: req.empresa._id, sede: d._id, lineas, tipo: 'traslado', referencia: ref, usuario: req.usuario._id });
  return { trasladados: lineas.length };
});

exports.vencimientos = manejar(async req => {
  const hoy = DateTime.now().setZone(req.empresa.zonaHoraria).startOf('day');
  const lotes = await Lote.find({ empresa: req.empresa._id, restante: { $gt: 0 }, vence: { $lte: hoy.plus({ days: Number(req.query.dias) || 30 }).toISODate() } }).sort({ vence: 1 }).limit(500).populate('producto', 'nombre codigo unidad costo').populate('sede', 'nombre').lean();
  return lotes.filter(l => l.producto).map(l => ({ ...l, dias: Math.round(DateTime.fromISO(l.vence, { zone: req.empresa.zonaHoraria }).diff(hoy, 'days').days), valor: redondear(l.restante * (l.producto.costo || 0), req.pais.decimales) }));
});

// Reabastecimiento inteligente: ritmo de venta de los últimos 28 días (las dos
// semanas recientes pesan el doble), días de entrega del proveedor y cobertura.
exports.reabastecer = manejar(async req => {
  const cobertura = Math.min(60, Math.max(3, Number(req.query.cobertura) || 10));
  const ahora = Date.now();
  const match = { empresa: req.empresa._id, fecha: { $gte: new Date(ahora - 28 * 86400000) }, estado: { $ne: 'anulada' } };
  if (req.query.sede) match.sede = (await sedeDe(req, req.query.sede))._id;
  const vendidos = await Venta.aggregate([
    { $match: match }, { $unwind: '$items' },
    { $project: { p: '$items.producto', q: { $multiply: [{ $subtract: ['$items.cantidad', '$items.cantidadDevuelta'] }, { $ifNull: ['$items.factor', 1] }] }, rec: { $gte: ['$fecha', new Date(ahora - 14 * 86400000)] } } },
    { $group: { _id: '$p', reciente: { $sum: { $cond: ['$rec', '$q', 0] } }, anterior: { $sum: { $cond: ['$rec', 0, '$q'] } } } },
  ]);
  const v = new Map(vendidos.map(x => [String(x._id), x]));
  const ex = new Map((await Existencia.aggregate([{ $match: { empresa: req.empresa._id, ...(match.sede && { sede: match.sede }) } }, { $group: { _id: '$producto', n: { $sum: { $subtract: ['$cantidad', '$reservado'] } } } }])).map(e => [String(e._id), e.n]));
  const [prods, provs] = await Promise.all([
    Producto.find({ empresa: req.empresa._id, activo: true, manejaInventario: true }).select('nombre codigo unidad costo minimo proveedor').lean(),
    Proveedor.find({ empresa: req.empresa._id }).lean(),
  ]);
  const prov = new Map(provs.map(p => [String(p._id), p]));
  return prods.map(p => {
    const x = v.get(String(p._id));
    const ritmo = x ? (x.reciente * 2 + x.anterior) / 42 : 0;          // unidades por día
    const tendencia = x && x.anterior > 0 ? Math.round((x.reciente - x.anterior) * 100 / x.anterior) : null;
    const disponible = r3(ex.get(String(p._id)) || 0);
    const pr = prov.get(String(p.proveedor));
    const entrega = pr?.diasEntrega ?? 3;
    const objetivo = Math.max(ritmo * (cobertura + entrega), p.minimo || 0);
    let pedir = Math.max(0, objetivo - Math.max(0, disponible));
    pedir = p.unidad === 'und' ? Math.ceil(pedir - 0.0001) : r3(pedir);
    const dias = ritmo > 0 ? Math.max(0, disponible / ritmo) : null;
    return { _id: p._id, nombre: p.nombre, codigo: p.codigo, unidad: p.unidad, disponible, ritmo: r3(ritmo), tendencia, dias: dias === null ? null : Math.round(dias * 10) / 10, pedir, costo: redondear(pedir * (p.costo || 0), req.pais.decimales), proveedor: pr?.nombre || '', proveedorId: pr?._id, urgente: dias !== null && dias <= entrega };
  }).filter(x => x.pedir > 0).sort((a, b) => Number(b.urgente) - Number(a.urgente) || (a.dias ?? 999) - (b.dias ?? 999));
});
