const Cliente = require('../models/Cliente');
const CuentaCliente = require('../models/CuentaCliente');
const Venta = require('../models/Venta');
const MovimientoPuntos = require('../models/MovimientoPuntos');
const gamificacion = require('../utils/gamificacion');
const { manejar, ErrorApi } = require('../utils/contexto');

const rx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CAMPOS = ['nombre', 'tipoDocumento', 'documento', 'correo', 'telefono', 'cumple', 'aceptaDatos', 'activo'];

function tomar(req) {
  const d = Object.fromEntries(CAMPOS.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  if (d.tipoDocumento && !req.pais.tiposDocumento.some(t => t.codigo === d.tipoDocumento)) throw new ErrorApi('El tipo de documento no corresponde al país');
  // Autorización de marketing, aparte de la de datos personales
  if (req.body.marketing && typeof req.body.marketing === 'object') {
    const m = req.body.marketing;
    if ((m.whatsapp || m.correo) && !(req.body.aceptaDatos ?? true)) throw new ErrorApi('Para autorizar promociones el cliente debe aceptar el tratamiento de datos');
    d.marketing = { whatsapp: !!m.whatsapp, correo: !!m.correo, actualizado: new Date(), origen: req.usuario.rol === 'cajero' ? 'caja' : 'admin' };
  }
  // El cupo de fiado lo define solo administración
  if (req.body.cupo !== undefined && ['admin', 'supervisor', 'super'].includes(req.usuario.rol)) d.cupo = Math.max(0, Number(req.body.cupo) || 0);
  return d;
}

exports.listar = manejar(async req => {
  const { q, orden = 'nombre', pagina = 1 } = req.query;
  const f = { empresa: req.empresa._id };
  if (q) f.$or = [{ nombre: new RegExp(rx(q), 'i') }, { documento: new RegExp('^' + rx(q)) }, { telefono: new RegExp(rx(q)) }];
  const s = { nombre: { nombre: 1 }, puntos: { puntos: -1 }, compras: { totalComprado: -1 }, reciente: { ultimaCompra: -1 } }[orden] || { nombre: 1 };
  const [items, total] = await Promise.all([Cliente.find(f).sort(s).skip((Math.max(1, Number(pagina)) - 1) * 50).limit(50).lean(), Cliente.countDocuments(f)]);
  return { items: items.map(c => ({ ...c, nivel: gamificacion.nivelDe(req.empresa, c.xp).actual })), total };
});

// Búsqueda de la caja: texto o QR de la app (KC-…)
exports.buscar = manejar(async req => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return [];
  if (/^KC-/i.test(q)) {
    const cuenta = await CuentaCliente.findOne({ codigo: q.toUpperCase(), pais: req.empresa.pais, estado: true }).lean();
    if (!cuenta) return [];
    const { clienteDeCuenta } = require('../utils/pedidos');
    return [await clienteDeCuenta(req.empresa, cuenta)];
  }
  return Cliente.find({ empresa: req.empresa._id, activo: true, $or: [{ nombre: new RegExp(rx(q), 'i') }, { documento: new RegExp('^' + rx(q)) }, { telefono: new RegExp(rx(q)) }] }).sort({ ultimaCompra: -1 }).limit(12).lean();
});

exports.crear = manejar(async (req, res) => { const c = await Cliente.create({ ...tomar(req), empresa: req.empresa._id }); res.status(201); return c; });
exports.actualizar = manejar(async req => {
  const c = await Cliente.findOne({ _id: req.params.id, empresa: req.empresa._id });
  if (!c) throw new ErrorApi('Cliente no encontrado', 404);
  c.set(tomar(req));
  await c.save();
  return c;
});
// Enlaza la app del cliente con su ficha: presencial, leyendo el QR de la app
exports.vincularApp = manejar(async req => {
  const cuenta = await CuentaCliente.findOne({ codigo: String(req.body.codigo || '').toUpperCase(), pais: req.empresa.pais }).lean();
  if (!cuenta) throw new ErrorApi('El código de la app no es válido', 404);
  const otro = await Cliente.findOne({ empresa: req.empresa._id, cuenta: cuenta._id }).lean();
  if (otro && String(otro._id) !== req.params.id) {
    if (otro.compras > 0) throw new ErrorApi('Esa app ya está enlazada a otro cliente con compras', 409);
    await Cliente.updateOne({ _id: otro._id }, { $unset: { cuenta: 1 }, activo: false });
  }
  const c = await Cliente.findOneAndUpdate({ _id: req.params.id, empresa: req.empresa._id }, { cuenta: cuenta._id }, { new: true }).lean();
  if (!c) throw new ErrorApi('Cliente no encontrado', 404);
  return c;
});
exports.detalle = manejar(async req => {
  const c = await Cliente.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!c) throw new ErrorApi('Cliente no encontrado', 404);
  const [ventas, puntos, estado] = await Promise.all([
    Venta.find({ cliente: c._id }).select('numero fecha total estado origen giro puntosGanados').sort({ fecha: -1 }).limit(20).lean(),
    MovimientoPuntos.find({ cliente: c._id }).sort({ createdAt: -1 }).limit(20).lean(),
    gamificacion.estadoCliente(req.empresa, c),
  ]);
  return { cliente: c, ventas, puntos, juego: estado };
});
exports.ajustarPuntos = manejar(async req => {
  const n = Math.trunc(Number(req.body.puntos));
  if (!n || !String(req.body.motivo || '').trim()) throw new ErrorApi('Puntos y motivo son obligatorios');
  const c = await Cliente.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!c) throw new ErrorApi('Cliente no encontrado', 404);
  if (c.puntos + n < 0) throw new ErrorApi('El cliente no tiene tantos puntos');
  await gamificacion.sumarPuntos({ empresa: req.empresa._id, cliente: c._id, puntos: n, tipo: 'ajuste', detalle: String(req.body.motivo).trim() });
  return { puntos: c.puntos + n };
});
