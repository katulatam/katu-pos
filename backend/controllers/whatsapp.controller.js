const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Conversacion = require('../models/Conversacion');
const Mensaje = require('../models/Mensaje');
const Pedido = require('../models/Pedido');
const Producto = require('../models/Producto');
const Existencia = require('../models/Existencia');
const Sede = require('../models/Sede');
const MovimientoMensajeria = require('../models/MovimientoMensajeria');
const wa = require('../utils/whatsapp');
const bot = require('../utils/whatsapp/bot');
const ia = require('../utils/ia/openrouter');
const pedidos = require('../utils/pedidos');
const { manejar, ErrorApi, mediosDe, impuestoDe } = require('../utils/contexto');

const rx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const esId = v => /^[a-f\d]{24}$/i.test(String(v || ''));

// ── Webhooks públicos (los llama Twilio) ───────────────────────────────────
async function verificar(req) {
  const e = esId(req.params.empresa) ? await Empresa.findById(req.params.empresa).lean() : null;
  if (!e?.whatsapp?.subcuentaSid) return null;
  if (!wa.twilio.simulado() && req.body.AccountSid !== e.whatsapp.subcuentaSid) return null;
  const url = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '') + req.originalUrl;
  return (await wa.twilio.firmaValida(e.whatsapp.subcuentaSid, url, req.body, req.headers['x-twilio-signature'])) ? e : null;
}
exports.webhook = async (req, res) => {
  try {
    const e = await verificar(req);
    if (!e) return res.status(403).type('text/xml').send(TWIML);
    if (e.modulos?.whatsapp) await wa.recibir(e, req.body);
  } catch (err) { console.error('[whatsapp.webhook]', err.message); }
  res.type('text/xml').send(TWIML);
};
exports.estado = async (req, res) => {
  try { if (await verificar(req)) await wa.actualizarEstado(req.body); } catch (err) { console.error('[whatsapp.estado]', err.message); }
  res.type('text/xml').send(TWIML);
};

// ── Bandeja del asesor ─────────────────────────────────────────────────────
const vistaConv = c => ({
  _id: c._id, telefono: c.telefono, nombre: c.nombre || c.cliente?.nombre || '', estado: c.estado, sinLeer: c.sinLeer,
  ultimoTexto: c.ultimoTexto, ultimoEn: c.ultimoEn, ventanaAbierta: wa.ventanaAbierta(c),
  asesor: c.asesor ? { _id: c.asesor._id || c.asesor, nombre: c.asesor.nombre } : null,
  cliente: c.cliente ? { _id: c.cliente._id || c.cliente, nombre: c.cliente.nombre, documento: c.cliente.documento, puntos: c.cliente.puntos } : null,
  ubicacion: c.ubicacion?.lat ? c.ubicacion : null,
});
const vistaMsj = m => ({ _id: m._id, direccion: m.direccion, autor: m.autor, usuario: m.usuario?.nombre, texto: m.texto, media: (m.media || []).map((x, i) => ({ tipo: x.tipo, url: `/api/v1/whatsapp/media/${m._id}/${i}` })), ubicacion: m.ubicacion?.lat ? m.ubicacion : null, plantilla: !!m.plantilla, estado: m.estado, error: m.error, en: m.createdAt });

async function convDe(req) {
  const c = await Conversacion.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean();
  if (!c) throw new ErrorApi('La conversación no existe', 404);
  return c;
}

exports.resumen = manejar(async req => {
  const e = req.empresa, f = { empresa: e._id };
  const [enEspera, mias, sinLeer] = await Promise.all([
    Conversacion.countDocuments({ ...f, estado: 'espera' }),
    Conversacion.countDocuments({ ...f, estado: 'asesor', asesor: req.usuario._id }),
    Conversacion.countDocuments({ ...f, estado: { $ne: 'cerrada' }, sinLeer: { $gt: 0 }, $or: [{ estado: 'espera' }, { asesor: req.usuario._id }] }),
  ]);
  return {
    enEspera, mias, sinLeer, listo: wa.listo(e), simulador: wa.twilio.simulado(), bot: bot.activo(e), conBot: await Conversacion.countDocuments({ ...f, estado: 'bot' }),
    numero: e.whatsapp?.numero || '', estado: e.whatsapp?.estado || 'sin_configurar', saldo: e.mensajeria?.saldoWhatsapp || 0,
    medios: mediosDe(e, req.pais, 'domicilio').map(m => ({ codigo: m.codigo, nombre: m.nombre, tipo: m.tipo })),
    sedes: await Sede.find({ empresa: e._id, activo: true }).select('nombre').lean(), recoger: e.domicilios?.recogerEnTienda !== false,
  };
});

exports.listar = manejar(async req => {
  const { filtro = 'activas', q } = req.query, f = { empresa: req.empresa._id };
  if (filtro === 'espera') f.estado = 'espera';
  else if (filtro === 'bot') f.estado = 'bot';
  else if (filtro === 'mias') Object.assign(f, { estado: 'asesor', asesor: req.usuario._id });
  else if (filtro === 'cerradas') f.estado = 'cerrada';
  else f.estado = { $ne: 'cerrada' };
  if (q) f.$or = [{ nombre: new RegExp(rx(q), 'i') }, { telefono: new RegExp(rx(String(q).replace(/\D/g, '') || q)) }];
  const l = await Conversacion.find(f).populate('asesor', 'nombre').populate('cliente', 'nombre documento puntos').sort({ ultimoEn: -1 }).limit(100).lean();
  return l.map(vistaConv);
});

exports.detalle = manejar(async req => {
  const c = await Conversacion.findOne({ _id: req.params.id, empresa: req.empresa._id }).populate('asesor', 'nombre').populate('cliente', 'nombre documento puntos').lean();
  if (!c) throw new ErrorApi('La conversación no existe', 404);
  const [mensajes, peds] = await Promise.all([
    Mensaje.find({ conversacion: c._id }).populate('usuario', 'nombre').sort({ createdAt: -1 }).limit(150).lean(),
    Pedido.find({ empresa: req.empresa._id, 'contacto.telefono': { $in: [wa.aLocal(req.pais, c.telefono), c.telefono] } }).select('numero estado total createdAt seguimiento').sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  return { ...vistaConv(c), mensajes: mensajes.reverse().map(vistaMsj), pedidos: peds, telefonoLocal: wa.aLocal(req.pais, c.telefono) };
});

// Mensajes nuevos desde una fecha (la bandeja consulta cada pocos segundos)
exports.nuevos = manejar(async req => {
  const c = await convDe(req);
  const desde = new Date(req.query.desde || 0);
  const l = await Mensaje.find({ conversacion: c._id, $or: [{ createdAt: { $gt: desde } }, { updatedAt: { $gt: desde } }] }).populate('usuario', 'nombre').sort({ createdAt: 1 }).limit(200).lean();
  return { mensajes: l.map(vistaMsj), estado: c.estado, ventanaAbierta: wa.ventanaAbierta(c), asesor: c.asesor };
});

exports.leida = manejar(async req => { await Conversacion.updateOne({ _id: req.params.id, empresa: req.empresa._id }, { sinLeer: 0 }); return { ok: true }; });

exports.tomar = manejar(async req => {
  const c = await Conversacion.findOneAndUpdate({ _id: req.params.id, empresa: req.empresa._id, $or: [{ estado: { $in: ['espera', 'bot', 'cerrada'] } }, { asesor: req.usuario._id }] }, { estado: 'asesor', asesor: req.usuario._id, sinLeer: 0, cerradaEn: null }, { new: true }).lean();
  if (!c) throw new ErrorApi('Otro asesor ya tomó esta conversación', 409);
  return { ok: true };
});
// El asesor devuelve la conversación al bot (empieza con el historial limpio)
exports.aBot = manejar(async req => {
  if (!bot.activo(req.empresa)) throw new ErrorApi('El asistente de IA no está activo para la empresa');
  const r = await Conversacion.updateOne({ _id: req.params.id, empresa: req.empresa._id, estado: { $ne: 'cerrada' } }, { estado: 'bot', asesor: null, ia: {} });
  if (!r.matchedCount) throw new ErrorApi('La conversación está cerrada', 409);
  return { ok: true };
});
exports.liberar = manejar(async req => {
  const puedeTodo = ['admin', 'supervisor', 'super'].includes(req.usuario.rol);
  const r = await Conversacion.updateOne({ _id: req.params.id, empresa: req.empresa._id, estado: 'asesor', ...(!puedeTodo && { asesor: req.usuario._id }) }, { estado: 'espera', asesor: null });
  if (!r.matchedCount) throw new ErrorApi('Solo quien atiende la conversación puede liberarla', 403);
  return { ok: true };
});
exports.cerrar = manejar(async req => {
  const puedeTodo = ['admin', 'supervisor', 'super'].includes(req.usuario.rol);
  const r = await Conversacion.updateOne({ _id: req.params.id, empresa: req.empresa._id, estado: { $ne: 'cerrada' }, ...(!puedeTodo && { $or: [{ asesor: req.usuario._id }, { estado: 'espera' }] }) }, { estado: 'cerrada', sinLeer: 0, cerradaEn: new Date() });
  if (!r.matchedCount) throw new ErrorApi('No puedes cerrar esta conversación', 403);
  return { ok: true };
});

exports.responder = manejar(async req => {
  const c = await convDe(req);
  if (c.estado === 'asesor' && String(c.asesor) !== String(req.usuario._id) && !['admin', 'supervisor', 'super'].includes(req.usuario.rol)) throw new ErrorApi('Esta conversación la atiende otro asesor', 403);
  // Responder la toma automáticamente
  if (c.estado !== 'asesor') await Conversacion.updateOne({ _id: c._id }, { estado: 'asesor', asesor: req.usuario._id, cerradaEn: null });
  const m = await wa.enviarTexto({ empresa: req.empresa, conversacion: c, texto: req.body.texto, usuario: req.usuario._id });
  await Conversacion.updateOne({ _id: c._id }, { sinLeer: 0 });
  return vistaMsj({ ...m, usuario: { nombre: req.usuario.nombre } });
});

// Catálogo para armar el pedido desde el chat
exports.productos = manejar(async req => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return [];
  const ps = await Producto.find({ empresa: req.empresa._id, activo: true, enLinea: true, $or: [{ nombre: new RegExp(rx(q), 'i') }, { codigo: q }, { plu: q }] }).select('nombre precio tipo unidad impuesto imagenUrl manejaInventario').sort({ nombre: 1 }).limit(15).lean();
  const ex = new Map((await Existencia.aggregate([{ $match: { empresa: req.empresa._id, producto: { $in: ps.map(p => p._id) } } }, { $group: { _id: '$producto', n: { $sum: { $subtract: ['$cantidad', '$reservado'] } } } }])).map(x => [String(x._id), x.n]));
  return ps.map(p => ({ _id: p._id, nombre: p.nombre, precio: p.precio, tipo: p.tipo, unidad: p.unidad, imagenUrl: p.imagenUrl, stock: p.manejaInventario ? (ex.get(String(p._id)) ?? 0) : null, ...impuestoDe(req.pais, p.impuesto) }));
});
exports.cotizar = manejar(req => pedidos.cotizar(req.empresa, req.pais, req.body, Number(req.body.total) || 0));

// El asesor crea el pedido de domicilio: entra al mismo flujo de la tienda en línea
exports.crearPedido = manejar(async (req, res) => {
  const c = await convDe(req);
  const b = req.body;
  const p = await pedidos.crear({
    empresa: req.empresa, pais: req.pais, canal: 'whatsapp', usuario: req.usuario,
    body: { ...b, uuid: b.uuid || crypto.randomUUID(), cliente: c.cliente, contacto: { nombre: String(b.nombre || c.nombre || '').trim(), telefono: wa.aLocal(req.pais, c.telefono) } },
  });
  await Conversacion.updateOne({ _id: c._id }, { $addToSet: { pedidos: p._id }, ...(c.estado !== 'asesor' && { estado: 'asesor', asesor: req.usuario._id }) });
  res.status(201);
  return { _id: p._id, numero: p.numero, total: p.total, seguimiento: p.seguimiento };
});

// Imágenes que mandó el cliente (se descargan con la subcuenta: nunca se expone la URL de Twilio)
exports.media = async (req, res) => {
  try {
    const m = esId(req.params.mensaje) ? await Mensaje.findOne({ _id: req.params.mensaje, empresa: req.empresa._id }).lean() : null;
    const x = m?.media?.[Number(req.params.i)];
    if (!x) return res.status(404).json({ success: false, error: 'No existe' });
    const r = await wa.twilio.descargar(req.empresa.whatsapp.subcuentaSid, x.url);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type(r.tipo).send(Buffer.from(r.datos));
  } catch (e) { res.status(e.status || 502).json({ success: false, error: e.message }); }
};

// Solo con el simulador: un "cliente" escribe, para probar la bandeja sin Twilio
exports.simular = manejar(async req => {
  if (!wa.twilio.simulado()) throw new ErrorApi('El simulador solo existe sin credenciales de Twilio', 403);
  const b = req.body;
  const tel = wa.aE164(req.pais, b.telefono || '3000000000');
  const conv = await wa.recibir(req.empresa, { From: `whatsapp:${tel}`, Body: b.texto || '', ProfileName: b.nombre || '', MessageSid: 'SMsim' + crypto.randomBytes(15).toString('hex'), ...(b.lat && { Latitude: b.lat, Longitude: b.lng, Address: b.direccion || '' }) });
  return { conversacion: conv?._id };
});

// ── Configuración ──────────────────────────────────────────────────────────
const vistaConfig = e => ({
  modulo: !!e.modulos?.whatsapp, estado: e.whatsapp?.estado || 'sin_configurar', numero: e.whatsapp?.numero || '',
  subcuenta: !!e.whatsapp?.subcuentaSid, servicioSid: e.whatsapp?.servicioSid || '', bienvenida: e.whatsapp?.bienvenida || '',
  notificarPedidos: e.whatsapp?.notificarPedidos !== false, plantillas: e.whatsapp?.plantillas || {},
  bot: { activo: !!e.whatsapp?.bot?.activo, instrucciones: e.whatsapp?.bot?.instrucciones || '' }, iaDisponible: ia.disponible(), modeloIA: ia.config().modelo,
  saldoWhatsapp: e.mensajeria?.saldoWhatsapp || 0, saldoCorreo: e.mensajeria?.saldoCorreo || 0,
  simulador: wa.twilio.simulado(), servidorListo: wa.twilio.disponible(), webhooks: wa.urls(e._id),
});
exports.config = manejar(async req => vistaConfig(await Empresa.findById(req.empresa._id).lean()));
// Lo que ajusta el comercio
exports.guardarConfig = manejar(async req => {
  const b = req.body, s = {};
  if (b.bienvenida !== undefined) s['whatsapp.bienvenida'] = String(b.bienvenida || '').slice(0, 1000);
  if (b.notificarPedidos !== undefined) s['whatsapp.notificarPedidos'] = !!b.notificarPedidos;
  if (b.bot?.activo !== undefined) { if (b.bot.activo && !ia.disponible()) throw new ErrorApi('El servidor no tiene configurada la IA (OPENROUTER_API_KEY)'); s['whatsapp.bot.activo'] = !!b.bot.activo; }
  if (b.bot?.instrucciones !== undefined) s['whatsapp.bot.instrucciones'] = String(b.bot.instrucciones || '').slice(0, 2000);
  return vistaConfig(await Empresa.findByIdAndUpdate(req.empresa._id, s, { new: true }).lean());
});
// Exclusivo de Katú: crear la subcuenta y su servicio de mensajería
exports.crearSubcuenta = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  if (e.whatsapp?.subcuentaSid) throw new ErrorApi('La empresa ya tiene subcuenta de WhatsApp');
  if (!wa.twilio.disponible()) throw new ErrorApi('Faltan las credenciales de Twilio de Katú en el servidor');
  if (!wa.twilio.simulado() && !/^https:\/\//.test(process.env.PUBLIC_URL || '')) throw new ErrorApi('Define PUBLIC_URL (https) en el servidor: Twilio necesita llamar a los webhooks');
  const r = await wa.twilio.crearSubcuenta(e.nombre, wa.urls(e._id));
  return vistaConfig(await Empresa.findByIdAndUpdate(e._id, { 'whatsapp.subcuentaSid': r.subcuentaSid, 'whatsapp.servicioSid': r.servicioSid, 'whatsapp.estado': 'subcuenta' }, { new: true }).lean());
});
// Exclusivo de Katú: número aprobado por Meta y plantillas
exports.guardarNumero = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean(), b = req.body, s = {};
  if (!e.whatsapp?.subcuentaSid) throw new ErrorApi('Primero crea la subcuenta');
  if (b.plantillas) for (const k of ['recibido', 'en_camino', 'listo', 'entregado', 'cancelado']) if (b.plantillas[k] !== undefined) {
    const v = String(b.plantillas[k] || '').trim();
    if (v && !/^HX[0-9a-f]{32}$/i.test(v)) throw new ErrorApi(`La plantilla "${k}" debe ser un Content SID (HX…)`);
    s[`whatsapp.plantillas.${k}`] = v;
  }
  if (b.numero !== undefined) {
    const numero = wa.aE164(req.pais, b.numero);
    if (!/^\+\d{8,15}$/.test(numero)) throw new ErrorApi('Número inválido');
    if (await Empresa.exists({ _id: { $ne: e._id }, 'whatsapp.numero': numero })) throw new ErrorApi('Ese número ya está asignado a otra empresa', 409);
    if (!(await wa.twilio.verificarNumero(e.whatsapp.subcuentaSid, e.whatsapp.servicioSid, numero))) throw new ErrorApi('Ese número aún no está registrado como remitente de WhatsApp en el servicio de la subcuenta. Complétalo en la consola de Twilio (requiere aprobación de Meta).', 409);
    Object.assign(s, { 'whatsapp.numero': numero, 'whatsapp.estado': 'activo' });
  }
  return vistaConfig(await Empresa.findByIdAndUpdate(e._id, s, { new: true }).lean());
});
exports.recargar = manejar(async req => {
  await wa.recargar(req.empresa._id, { whatsapp: req.body.whatsapp, correo: req.body.correo, motivo: String(req.body.motivo || '').slice(0, 200), usuario: req.usuario._id });
  return vistaConfig(await Empresa.findById(req.empresa._id).lean());
});
exports.movimientos = manejar(async req => MovimientoMensajeria.find({ empresa: req.empresa._id }).populate('usuario', 'nombre').sort({ createdAt: -1 }).limit(200).lean());
