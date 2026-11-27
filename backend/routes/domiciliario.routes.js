const r = require('express').Router();
const Pedido = require('../models/Pedido');
const Usuario = require('../models/Usuario');
const Sede = require('../models/Sede');
const pedidos = require('../utils/pedidos');
const geo = require('../utils/geo');
const { paisPublico } = require('../controllers/configuracion.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');
const limitar = require('../middleware/limitar');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');

r.use(proteger, requiereEmpresa, requiereModulo('domicilios'), autorizar('domiciliario'));
const vista = p => ({ _id: p._id, numero: p.numero, estado: p.estado, contacto: p.contacto, entrega: p.entrega, items: p.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidadReal ?? i.cantidad, unidad: i.unidad })), total: p.total, medioPago: p.medioPago, tipoPago: p.tipoPago, pagado: p.pagado, pagaCon: p.pagaCon, sede: p.sede, createdAt: p.createdAt });

r.get('/inicio', manejar(async req => {
  const yo = req.usuario._id;
  const [asignados, libres, hoy] = await Promise.all([
    Pedido.find({ empresa: req.empresa._id, domiciliario: yo, estado: { $in: ['listo', 'en_camino'] } }).sort({ createdAt: 1 }).populate('sede', 'nombre direccion ubicacion').lean(),
    Pedido.find({ empresa: req.empresa._id, tipo: 'domicilio', domiciliario: null, estado: 'listo', ...(req.usuario.sede && { sede: req.usuario.sede }) }).sort({ createdAt: 1 }).populate('sede', 'nombre direccion ubicacion').lean(),
    Pedido.aggregate([{ $match: { empresa: req.empresa._id, domiciliario: yo, estado: 'entregado', updatedAt: rangoUtc(req.empresa) } }, { $group: { _id: null, n: { $sum: 1 }, domicilios: { $sum: '$domicilio' }, estrellas: { $avg: '$calificacion.estrellas' } } }]),
  ]);
  const efectivo = await Pedido.aggregate([{ $match: { empresa: req.empresa._id, domiciliario: yo, estado: 'entregado', liquidado: false, tipoPago: 'efectivo' } }, { $group: { _id: null, t: { $sum: '$total' } } }]);
  // De los pedidos libres no se entrega el contacto del cliente hasta tomarlos
  return { usuario: { nombre: req.usuario.nombre, disponible: req.usuario.disponible }, empresa: req.empresa.nombre, pais: paisPublico(req.pais), asignados: asignados.map(vista), libres: libres.map(p => ({ ...vista(p), contacto: undefined, items: undefined, entrega: { distanciaM: p.entrega?.distanciaM } })), hoy: hoy[0] || { n: 0, domicilios: 0 }, porEntregar: efectivo[0]?.t || 0 };
}));
r.put('/disponible', manejar(async req => { await Usuario.updateOne({ _id: req.usuario._id }, { disponible: !!req.body.disponible }); return { disponible: !!req.body.disponible }; }));
r.post('/pedidos/:id/tomar', manejar(async req => {
  const p = await Pedido.findOneAndUpdate({ _id: req.params.id, empresa: req.empresa._id, estado: 'listo', tipo: 'domicilio', domiciliario: null }, { domiciliario: req.usuario._id }, { new: true }).lean();
  if (!p) throw new ErrorApi('Otro domiciliario ya tomó este pedido', 409);
  return vista(p);
}));
const mio = async req => {
  const p = await Pedido.findOne({ _id: req.params.id, empresa: req.empresa._id, domiciliario: req.usuario._id }).lean();
  if (!p) throw new ErrorApi('El pedido no está asignado a ti', 404);
  return p;
};
r.post('/pedidos/:id/salir', manejar(async req => vista(await pedidos.cambiarEstado({ empresa: req.empresa, pais: req.pais, pedido: await mio(req), estado: 'en_camino', usuario: req.usuario, datos: { domiciliario: req.usuario._id } }))));
r.post('/pedidos/:id/entregar', limitar({ max: 10, clave: req => `${req.usuario._id}|${req.params.id}` }), manejar(async req => {
  const p = await pedidos.cambiarEstado({ empresa: req.empresa, pais: req.pais, pedido: await mio(req), estado: 'entregado', usuario: req.usuario, datos: { pin: req.body.pin, referencia: req.body.referencia } });
  if (!(await Pedido.exists({ domiciliario: req.usuario._id, estado: 'en_camino' }))) await Usuario.updateOne({ _id: req.usuario._id }, { $unset: { ubicacion: 1 } });
  return vista(p);
}));
// Ubicación: se guarda solo la última y solo si lleva un pedido
r.post('/ubicacion', manejar(async req => {
  if (!geo.puntoValido(req.body)) throw new ErrorApi('Ubicación inválida');
  const activo = await Pedido.exists({ domiciliario: req.usuario._id, estado: 'en_camino' });
  if (activo) await Usuario.updateOne({ _id: req.usuario._id }, { ubicacion: { lat: Number(req.body.lat), lng: Number(req.body.lng), en: new Date() } });
  return { enRuta: !!activo };
}));

module.exports = r;
