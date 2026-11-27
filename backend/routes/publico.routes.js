// Seguimiento del pedido por su link secreto (sin sesión)
const r = require('express').Router();
const Pedido = require('../models/Pedido');
const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const Sede = require('../models/Sede');
const Cobro = require('../models/Cobro');
const cobros = require('../utils/cobros');
const pedidos = require('../utils/pedidos');
const limitar = require('../middleware/limitar');
const { paisPublico } = require('../controllers/configuracion.controller');
const { manejar, ErrorApi, paisDe, mediosDe } = require('../utils/contexto');

const cargar = async req => {
  if (!/^[a-f0-9]{32}$/.test(req.params.token)) throw new ErrorApi('Pedido no encontrado', 404);
  const p = await Pedido.findOne({ seguimiento: req.params.token }).lean();
  if (!p) throw new ErrorApi('Pedido no encontrado', 404);
  const empresa = await Empresa.findById(p.empresa).lean();
  return { p, empresa, pais: await paisDe(empresa) };
};
const puedePagar = p => p.tipoPago === 'qr' && !p.pagado && !pedidos.porPesar(p) && !['entregado', 'cancelado'].includes(p.estado);

r.get('/seguimiento/:token', limitar({ max: 120 }), manejar(async req => {
  const { p, empresa, pais } = await cargar(req);
  const sede = await Sede.findById(p.sede).select('nombre direccion ubicacion telefono').lean();
  let domiciliario = null;
  if (p.domiciliario && p.estado === 'en_camino') {
    const d = await Usuario.findById(p.domiciliario).select('nombre telefono vehiculo ubicacion').lean();
    domiciliario = d && { nombre: d.nombre, telefono: d.telefono, vehiculo: d.vehiculo, ubicacion: d.ubicacion?.lat ? { lat: d.ubicacion.lat, lng: d.ubicacion.lng, en: d.ubicacion.en } : null };
  }
  return {
    numero: p.numero, estado: p.estado, tipo: p.tipo, historial: p.historial.map(h => ({ estado: h.estado, en: h.en })),
    items: p.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, cantidadReal: i.cantidadReal, unidad: i.unidad, porPeso: i.porPeso, total: i.total })),
    totalProductos: p.totalProductos, descuento: p.descuento, domicilio: p.domicilio, total: p.total,
    entrega: p.entrega && { direccion: p.entrega.direccion, detalle: p.entrega.detalle, lat: p.entrega.lat, lng: p.entrega.lng },
    minutos: p.minutosEstimados, creado: p.createdAt, medioPago: mediosDe(empresa, pais).find(m => m.codigo === p.medioPago)?.nombre || p.medioPago,
    pagado: p.pagado, porPesar: pedidos.porPesar(p), puedePagar: puedePagar(p), motivoCancelacion: p.motivoCancelacion,
    pin: p.tipo === 'domicilio' && ['listo', 'en_camino'].includes(p.estado) ? p.pin : null,
    calificado: !!p.calificacion?.estrellas, domiciliario, sede,
    empresa: { nombre: empresa.nombre, slug: empresa.slug, logoUrl: empresa.logoUrl, color: empresa.color, telefono: empresa.telefono }, pais: paisPublico(pais),
  };
}));
r.post('/seguimiento/:token/pagar', limitar({ max: 10 }), manejar(async req => {
  const { p, empresa, pais } = await cargar(req);
  if (!puedePagar(p)) throw new ErrorApi('Este pedido no tiene pagos por hacer', 409);
  // Reusa el cobro vigente en vez de abrir otro por el mismo pedido
  const previos = await Cobro.find({ pedido: p._id, estado: { $in: ['pendiente', 'aprobado'] } }).sort({ createdAt: -1 }).lean();
  for (const c of previos) {
    const e = await cobros.consultar(empresa._id, c._id);
    if (e.estado === 'aprobado') { await Pedido.updateOne({ _id: p._id, pagado: false }, { pagado: true, cobro: c._id }); return e; }
    if (e.estado === 'pendiente' && c.monto === p.total) return e;
    if (e.estado === 'pendiente') await cobros.cancelar(empresa._id, c._id);
  }
  return cobros.crear({ empresa, pais, medio: p.medioPago, monto: p.total, pedido: p._id, canal: 'domicilio' });
}));
r.get('/seguimiento/:token/pago/:cobro', limitar({ max: 120 }), manejar(async req => {
  const { p, empresa } = await cargar(req);
  const c = await Cobro.findOne({ _id: req.params.cobro, pedido: p._id }).lean();
  if (!c) throw new ErrorApi('Cobro no encontrado', 404);
  const e = await cobros.consultar(empresa._id, c._id);
  if (e.estado === 'aprobado' && c.monto === p.total) await Pedido.updateOne({ _id: p._id, pagado: false }, { pagado: true, cobro: c._id });
  return e;
}));
r.post('/seguimiento/:token/calificar', limitar({ max: 10 }), manejar(async req => {
  const n = Math.round(Number(req.body.estrellas));
  if (!(n >= 1 && n <= 5)) throw new ErrorApi('Elige de 1 a 5 estrellas');
  const { p } = await cargar(req);
  if (p.estado !== 'entregado') throw new ErrorApi('Podrás calificar cuando recibas el pedido');
  await Pedido.updateOne({ _id: p._id, 'calificacion.estrellas': null }, { calificacion: { estrellas: n, comentario: String(req.body.comentario || '').slice(0, 300) } });
  return { gracias: true };
}));

// Imagen de la promoción del día (la descarga WhatsApp al enviar la plantilla con imagen)
r.get('/promo-img/:clave', limitar({ max: 3000 }), async (req, res) => {
  const img = await require('../utils/imagenPromo').obtener(req.params.clave);
  res.set({ 'Content-Type': img.tipo, 'Cache-Control': 'public, max-age=3600' }).send(img.datos);
});

module.exports = r;
