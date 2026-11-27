const Caja = require('../models/Caja');
const Sede = require('../models/Sede');
const Turno = require('../models/Turno');
const Categoria = require('../models/Categoria');
const Producto = require('../models/Producto');
const Existencia = require('../models/Existencia');
const Recompensa = require('../models/Recompensa');
const Dispositivo = require('../models/Dispositivo');
const Cliente = require('../models/Cliente');
const Venta = require('../models/Venta');
const ventas = require('../utils/ventas');
const gamificacion = require('../utils/gamificacion');
const { paisPublico } = require('./configuracion.controller');
const { manejar, ErrorApi, mediosDe, impuestoDe, rangoUtc } = require('../utils/contexto');
const { modoDemo } = require('../utils/cobros');

exports.cajas = manejar(async req => {
  const cajas = await Caja.find({ empresa: req.empresa._id, activo: true }).populate('sede', 'nombre activo').sort({ nombre: 1 }).lean();
  const turnos = await Turno.find({ empresa: req.empresa._id, estado: 'abierto' }).populate('cajero', 'nombre').lean();
  return cajas.filter(c => c.sede?.activo && (!req.usuario.sede || String(req.usuario.sede) === String(c.sede._id))).map(c => {
    const t = turnos.find(x => String(x.caja) === String(c._id));
    return { _id: c._id, nombre: c.nombre, tipo: c.tipo || 'caja', sede: c.sede.nombre, turno: t ? { _id: t._id, cajero: t.cajero?.nombre, mio: String(t.cajero?._id) === String(req.usuario._id), abiertoEn: t.abiertoEn } : null };
  });
});

// Todo lo que la caja necesita para trabajar, también sin internet
exports.arranque = manejar(async req => {
  const caja = await Caja.findOne({ _id: req.params.caja, empresa: req.empresa._id, activo: true }).lean();
  if (!caja) throw new ErrorApi('La caja no existe', 404);
  const autopago = caja.tipo === 'autopago';
  if (autopago && !req.empresa.modulos?.kiosco) throw new ErrorApi('El autopago no está activo para tu empresa', 403);
  const e = req.empresa._id;
  const [sede, turno, categorias, productos, existencias, promociones, recompensas, equipos] = await Promise.all([
    Sede.findById(caja.sede).lean(),
    Turno.findOne({ caja: caja._id, estado: 'abierto' }).populate('cajero', 'nombre').lean(),
    Categoria.find({ empresa: e, activo: true }).sort({ orden: 1, nombre: 1 }).lean(),
    Producto.find({ empresa: e, activo: true }).select('-empresa -componentes -descripcion -createdAt -updatedAt').sort({ nombre: 1 }).lean(),
    Existencia.find({ sede: caja.sede }).select('producto cantidad reservado').lean(),
    ventas.promosVigentes(req.empresa),
    req.empresa.modulos?.gamificacion ? Recompensa.find({ empresa: e, activo: true }).sort({ puntos: 1 }).lean() : [],
    Dispositivo.find({ empresa: e, caja: caja._id, activo: true }).select('nombre tipo').lean(),
  ]);
  const ex = new Map(existencias.map(x => [String(x.producto), x.cantidad - x.reservado]));
  const em = req.empresa;
  return {
    empresa: { _id: em._id, nombre: em.nombre, razonSocial: em.razonSocial, idFiscal: em.idFiscal, direccion: em.direccion, ciudad: em.ciudad, telefono: em.telefono, logoUrl: em.logoUrl, color: em.color, zonaHoraria: em.zonaHoraria, pos: em.pos, modulos: em.modulos, gamificacion: em.gamificacion },
    pais: paisPublico(req.pais), medios: mediosDe(em, req.pais, autopago ? 'kiosco' : 'caja'), sede, caja, turno, equipos, modoDemo: modoDemo(),
    usuario: { _id: req.usuario._id, nombre: req.usuario.nombre, rol: req.usuario.rol },
    categorias, promociones, recompensas,
    productos: productos.map(p => ({ ...p, ...impuestoDe(req.pais, p.impuesto), stock: p.manejaInventario ? (ex.get(String(p._id)) ?? 0) : null })),
    servidor: new Date(),
  };
});

exports.vender = manejar(async (req, res) => {
  const b = req.body;
  const turno = await Turno.findOne({ _id: b.turno, empresa: req.empresa._id }).lean();
  if (!turno) throw new ErrorApi('El turno no existe', 404);
  // Una venta hecha sin internet puede sincronizar después del cierre del turno
  if (turno.estado !== 'abierto' && !b.offline) throw new ErrorApi('El turno está cerrado', 409, 'TURNO_CERRADO');
  if (req.usuario.rol === 'cajero' && String(turno.cajero) !== String(req.usuario._id)) throw new ErrorApi('El turno es de otro cajero', 403);
  const [sede, caja] = await Promise.all([Sede.findById(turno.sede).lean(), Caja.findById(turno.caja).lean()]);
  const r = await ventas.crear({ empresa: req.empresa, pais: req.pais, sede, caja, turno, cajero: req.usuario, body: b, origen: caja?.tipo === 'autopago' ? 'kiosco' : 'caja' });
  if (!r.repetida) res.status(201);
  return r;
});

exports.clienteJuego = manejar(async req => {
  const c = await Cliente.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!c) throw new ErrorApi('Cliente no encontrado', 404);
  return { cliente: c, juego: await gamificacion.estadoCliente(req.empresa, c) };
});
exports.girar = manejar(async req => gamificacion.girar(req.empresa, { _id: req.params.venta }));

// Estado de la factura para el tiquete (se consulta unos segundos tras vender)
exports.documento = manejar(async req => {
  const v = await Venta.findOne({ _id: req.params.venta, empresa: req.empresa._id }).select('numero documento').lean();
  if (!v) throw new ErrorApi('Venta no encontrada', 404);
  return { numero: v.numero, estado: v.documento?.estado, documento: v.documento?.numero, codigoUnico: v.documento?.codigoUnico, urlConsulta: v.documento?.urlConsulta };
});

// Liga de cajeros del día
exports.liga = manejar(async req => {
  const filas = await Venta.aggregate([
    { $match: { empresa: req.empresa._id, origen: 'caja', estado: { $ne: 'anulada' }, fecha: rangoUtc(req.empresa) } },
    { $group: { _id: '$cajero', ventas: { $sum: 1 }, total: { $sum: '$total' }, articulos: { $sum: { $size: '$items' } }, conCliente: { $sum: { $cond: [{ $ifNull: ['$cliente', false] }, 1, 0] } } } },
    { $lookup: { from: 'usuarios', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: { ventas: 1, total: 1, articulos: 1, conCliente: 1, nombre: { $first: '$u.nombre' } } }, { $sort: { total: -1 } },
  ]);
  const meta = req.empresa.gamificacion?.metaDiariaCajero || 0;
  return { meta, filas: filas.map(f => ({ ...f, yo: String(f._id) === String(req.usuario._id), avance: meta ? Math.min(100, Math.round(f.total * 100 / meta)) : null })) };
});
