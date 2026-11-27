const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Categoria = require('../models/Categoria');
const Producto = require('../models/Producto');
const Existencia = require('../models/Existencia');
const Recompensa = require('../models/Recompensa');
const CuentaCliente = require('../models/CuentaCliente');
const Cliente = require('../models/Cliente');
const Pedido = require('../models/Pedido');
const Venta = require('../models/Venta');
const Sede = require('../models/Sede');
const pedidos = require('../utils/pedidos');
const ventas = require('../utils/ventas');
const gamificacion = require('../utils/gamificacion');
const geo = require('../utils/geo');
const { paisPublico } = require('./configuracion.controller');
const { firmarTokenCliente } = require('../middleware/auth');
const { manejar, ErrorApi, paisPorCodigo, paisDe, mediosDe, ahoraDe, impuestoDe } = require('../utils/contexto');

// Middleware: empresa por slug, con el módulo de domicilios activo
exports.cargarEmpresa = async (req, res, next) => {
  const e = await Empresa.findOne({ slug: String(req.params.slug).toLowerCase(), estado: true, 'modulos.domicilios': true }).lean().catch(() => null);
  if (!e) return res.status(404).json({ success: false, error: 'La tienda no está disponible' });
  req.empresa = e; req.pais = await paisDe(e);
  next();
};

// ── Cuenta ────────────────────────────────────────────────────────────────
const cuentaPublica = c => ({ _id: c._id, nombre: c.nombre, telefono: c.telefono, correo: c.correo, pais: c.pais, codigo: c.codigo, direcciones: c.direcciones || [] });
const tel = t => String(t || '').replace(/\D/g, '');
exports.registro = manejar(async (req, res) => {
  const b = req.body;
  const pais = await paisPorCodigo(String(b.pais || '').toUpperCase()).catch(() => null);
  if (!pais || !pais.activo) throw new ErrorApi('País inválido');
  if (!String(b.nombre || '').trim() || tel(b.telefono).length < 7) throw new ErrorApi('Nombre y celular son obligatorios');
  if (String(b.password || '').length < 8) throw new ErrorApi('La contraseña debe tener al menos 8 caracteres');
  if (!b.aceptaDatos) throw new ErrorApi('Debes aceptar el tratamiento de datos personales');
  if (await CuentaCliente.exists({ pais: pais.codigo, telefono: tel(b.telefono) })) throw new ErrorApi('Ese celular ya tiene una cuenta: inicia sesión', 409);
  const c = await CuentaCliente.create({ pais: pais.codigo, nombre: b.nombre, telefono: tel(b.telefono), correo: b.correo, password: b.password, aceptaDatos: true, codigo: 'KC-' + crypto.randomBytes(5).toString('hex').toUpperCase() });
  res.status(201);
  return { token: firmarTokenCliente(c._id), cuenta: cuentaPublica(c) };
});
exports.login = manejar(async req => {
  const c = await CuentaCliente.findOne({ pais: String(req.body.pais || '').toUpperCase(), telefono: tel(req.body.telefono) }).select('+password');
  if (!c || !c.estado || !(await c.compararPassword(req.body.password))) throw new ErrorApi('Celular o contraseña incorrectos', 401);
  return { token: firmarTokenCliente(c._id), cuenta: cuentaPublica(c) };
});
exports.yo = manejar(async req => cuentaPublica(req.cuenta));
exports.qr = manejar(async req => ({ codigo: req.cuenta.codigo, qr: await require('qrcode').toDataURL(req.cuenta.codigo, { margin: 1, width: 320 }) }));
exports.direcciones = manejar(async req => {
  const lista = (Array.isArray(req.body.direcciones) ? req.body.direcciones : []).slice(0, 10).map(d => {
    if (!geo.puntoValido(d) || !String(d.direccion || '').trim()) throw new ErrorApi('Cada dirección necesita texto y punto en el mapa');
    return { alias: String(d.alias || 'Casa').slice(0, 30), direccion: String(d.direccion).slice(0, 200), detalle: String(d.detalle || '').slice(0, 200), lat: Number(d.lat), lng: Number(d.lng) };
  });
  return cuentaPublica(await CuentaCliente.findByIdAndUpdate(req.cuenta._id, { direcciones: lista }, { new: true }).lean());
});

// ── Descubrir tiendas (app) ───────────────────────────────────────────────
exports.cercanas = manejar(async req => {
  const punto = { lat: req.query.lat, lng: req.query.lng };
  const pais = String(req.query.pais || '').toUpperCase();
  const empresas = await Empresa.find({ estado: true, 'modulos.domicilios': true, ...(pais && { pais }) }).select('nombre slug logoUrl color pais zonaHoraria domicilios ciudad').limit(300).lean();
  const out = [];
  for (const e of empresas) {
    const p = await paisDe(e);
    const c = geo.puntoValido(punto) ? await pedidos.cotizar(e, p, punto, 0) : { cubre: false };
    out.push({ nombre: e.nombre, slug: e.slug, logoUrl: e.logoUrl, color: e.color, ciudad: e.ciudad, recoger: e.domicilios?.recogerEnTienda !== false, cobertura: c, moneda: p.moneda });
  }
  return out.sort((a, b) => Number(!!b.cobertura.cubre) - Number(!!a.cobertura.cubre) || (a.cobertura.distancia || 0) - (b.cobertura.distancia || 0));
});
exports.paises = manejar(async () => {
  const Pais = require('../models/Pais');
  return (await Pais.find({ activo: true }).sort({ nombre: 1 }).lean()).map(p => ({ codigo: p.codigo, nombre: p.nombre, prefijoTelefono: p.prefijoTelefono, moneda: p.moneda, decimales: p.decimales, locale: p.locale }));
});

// ── Catálogo de una tienda ────────────────────────────────────────────────
exports.catalogo = manejar(async req => {
  const e = req.empresa;
  const [cats, prods, promociones, sedes] = await Promise.all([
    Categoria.find({ empresa: e._id, activo: true, enLinea: true }).select('nombre color icono').sort({ orden: 1, nombre: 1 }).lean(),
    Producto.find({ empresa: e._id, activo: true, enLinea: true }).select('nombre descripcion categoria marca tipo unidad precio impuesto imagenUrl manejaInventario favorito').sort({ nombre: 1 }).lean(),
    ventas.promosVigentes(e),
    Sede.find({ empresa: e._id, activo: true }).select('nombre direccion ciudad ubicacion').lean(),
  ]);
  const ex = new Map((await Existencia.aggregate([{ $match: { empresa: e._id } }, { $group: { _id: '$producto', n: { $sum: { $subtract: ['$cantidad', '$reservado'] } } } }])).map(x => [String(x._id), x.n]));
  const negativo = e.pos?.permitirStockNegativo !== false;
  return {
    empresa: { nombre: e.nombre, slug: e.slug, logoUrl: e.logoUrl, color: e.color, telefono: e.telefono, zonaHoraria: e.zonaHoraria, recoger: e.domicilios?.recogerEnTienda !== false, gamificacion: !!e.modulos?.gamificacion },
    pais: paisPublico(req.pais), medios: mediosDe(e, req.pais, 'domicilio').map(m => ({ codigo: m.codigo, nombre: m.nombre, tipo: m.tipo, icono: m.icono })), sedes, categorias: cats, promociones,
    productos: prods.map(p => ({ ...p, ...impuestoDe(req.pais, p.impuesto), agotado: !negativo && p.manejaInventario && (ex.get(String(p._id)) || 0) <= 0 })),
  };
});
exports.cotizar = manejar(req => pedidos.cotizar(req.empresa, req.pais, req.body, Number(req.body.total) || 0));
exports.crearPedido = manejar(async (req, res) => {
  const p = await pedidos.crear({ empresa: req.empresa, pais: req.pais, body: req.body, cuenta: req.cuenta, canal: req.body.canal === 'app' ? 'app' : 'web' });
  res.status(201);
  return { _id: p._id, numero: p.numero, seguimiento: p.seguimiento, total: p.total };
});
exports.misPedidos = manejar(async req => {
  const lista = await Pedido.find({ cuenta: req.cuenta._id }).sort({ createdAt: -1 }).limit(40).populate('empresa', 'nombre slug logoUrl color').lean();
  return lista.map(p => ({ numero: p.numero, seguimiento: p.seguimiento, estado: p.estado, total: p.total, moneda: p.moneda, decimales: p.decimales, empresa: p.empresa, articulos: p.items.length, createdAt: p.createdAt }));
});
// Puntos, nivel y misiones del cliente en esta tienda
exports.juego = manejar(async req => {
  if (!req.empresa.modulos?.gamificacion) return null;
  const c = await pedidos.clienteDeCuenta(req.empresa, req.cuenta);
  const [estado, recompensas, giros] = await Promise.all([
    gamificacion.estadoCliente(req.empresa, c),
    Recompensa.find({ empresa: req.empresa._id, activo: true }).sort({ puntos: 1 }).lean(),
    Venta.find({ cliente: c._id, 'giro.disponible': true }).select('numero total fecha').sort({ fecha: -1 }).limit(10).lean(),
  ]);
  return { ...estado, recompensas, giros, ruleta: req.empresa.gamificacion?.ruleta, niveles: req.empresa.gamificacion?.niveles };
});
exports.girar = manejar(async req => {
  const c = await Cliente.findOne({ empresa: req.empresa._id, cuenta: req.cuenta._id }).lean();
  if (!c) throw new ErrorApi('No tienes giros disponibles', 409);
  return gamificacion.girar(req.empresa, { _id: req.params.venta, cliente: c._id });
});
