const Pedido = require('../models/Pedido');
const Usuario = require('../models/Usuario');
const Turno = require('../models/Turno');
const pedidos = require('../utils/pedidos');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');
const Motor = require('../../frontend/assets/js/motor');

const uno = async req => {
  const p = await Pedido.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!p) throw new ErrorApi('Pedido no encontrado', 404);
  return p;
};
const vista = p => ({ ...p, pin: undefined, porPesar: pedidos.porPesar(p) });

exports.tablero = manejar(async req => {
  const f = { empresa: req.empresa._id, estado: { $in: pedidos.ACTIVOS }, ...(req.query.sede && { sede: req.query.sede }) };
  const [activos, hoy, repartidores] = await Promise.all([
    Pedido.find(f).populate('domiciliario', 'nombre telefono').populate('sede', 'nombre').sort({ createdAt: 1 }).lean(),
    Pedido.aggregate([{ $match: { empresa: req.empresa._id, createdAt: rangoUtc(req.empresa) } }, { $group: { _id: '$estado', n: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Usuario.find({ empresa: req.empresa._id, rol: 'domiciliario', estado: true }).select('nombre telefono vehiculo disponible ubicacion').lean(),
  ]);
  const carga = {};
  activos.filter(p => p.estado === 'en_camino').forEach(p => { carga[p.domiciliario?._id] = (carga[p.domiciliario?._id] || 0) + 1; });
  return { pedidos: activos.map(vista), hoy, domiciliarios: repartidores.map(d => ({ ...d, ubicacion: carga[d._id] ? d.ubicacion : null, enRuta: carga[d._id] || 0 })) };
});
exports.listar = manejar(async req => (await Pedido.find({ empresa: req.empresa._id, createdAt: rangoUtc(req.empresa, req.query.desde, req.query.hasta), ...(req.query.estado && { estado: req.query.estado }) }).populate('domiciliario', 'nombre').populate('sede', 'nombre').sort({ createdAt: -1 }).limit(500).lean()).map(vista));
exports.detalle = manejar(async req => vista(await uno(req)));
exports.crear = manejar(async (req, res) => { const p = await pedidos.crear({ empresa: req.empresa, pais: req.pais, body: req.body, canal: 'telefono', usuario: req.usuario }); res.status(201); return vista(p); });
exports.cotizar = manejar(req => pedidos.cotizar(req.empresa, req.pais, req.body, Number(req.body.total) || 0));
exports.alistar = manejar(async req => {
  const p = await pedidos.alistar({ empresa: req.empresa, pais: req.pais, pedido: await uno(req), items: req.body.items });
  if (!p) throw new ErrorApi('El pedido cambió: recarga', 409);
  return vista(p);
});
exports.estado = manejar(async req => {
  const p = await uno(req);
  const datos = { motivo: req.body.motivo, pin: req.body.pin, referencia: req.body.referencia, domiciliario: req.body.domiciliario };
  if (datos.domiciliario && !(await Usuario.exists({ _id: datos.domiciliario, empresa: req.empresa._id, rol: 'domiciliario', estado: true }))) throw new ErrorApi('El domiciliario no existe');
  if (req.body.turno) {
    const t = await Turno.findOne({ _id: req.body.turno, empresa: req.empresa._id, estado: 'abierto' }).lean();
    if (!t) throw new ErrorApi('El turno no está abierto', 409);
    datos.turno = t; datos.caja = { _id: t.caja };
  }
  return vista(await pedidos.cambiarEstado({ empresa: req.empresa, pais: req.pais, pedido: p, estado: req.body.estado, usuario: req.usuario, datos }));
});
// Efectivo de domicilios que el domiciliario entrega en la caja
exports.porLiquidar = manejar(async req => {
  const filas = await Pedido.find({ empresa: req.empresa._id, estado: 'entregado', liquidado: false, tipoPago: 'efectivo' }).populate('domiciliario', 'nombre').select('numero total domiciliario updatedAt').lean();
  const m = new Map();
  filas.forEach(p => { const k = String(p.domiciliario?._id || ''); const x = m.get(k) || { domiciliario: p.domiciliario, total: 0, pedidos: [] }; x.total = Motor.redondear(x.total + p.total, req.pais.decimales); x.pedidos.push({ numero: p.numero, total: p.total }); m.set(k, x); });
  return [...m.values()];
});
exports.liquidar = manejar(async req => {
  const t = await Turno.findOne({ _id: req.body.turno, empresa: req.empresa._id, estado: 'abierto' }).lean();
  if (!t) throw new ErrorApi('Abre un turno para recibir el dinero', 409);
  const rep = await Usuario.findOne({ _id: req.body.domiciliario, empresa: req.empresa._id }).lean();
  if (!rep) throw new ErrorApi('El domiciliario no existe', 404);
  let total = 0, n = 0;
  for (const p of await Pedido.find({ empresa: req.empresa._id, domiciliario: rep._id, estado: 'entregado', liquidado: false, tipoPago: 'efectivo' }).lean()) {
    const r = await Pedido.updateOne({ _id: p._id, liquidado: false }, { liquidado: true });
    if (r.modifiedCount) { total = Motor.redondear(total + p.total, req.pais.decimales); n++; }
  }
  if (!n) throw new ErrorApi('No hay domicilios por liquidar', 409);
  await Turno.updateOne({ _id: t._id }, { $push: { movimientos: { tipo: 'ingreso', monto: total, concepto: `Liquidación de ${n} domicilio${n > 1 ? 's' : ''} — ${rep.nombre}`, usuario: req.usuario._id } } });
  return { total, pedidos: n };
});
