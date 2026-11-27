const Empresa = require('../../models/Empresa');
const Conversacion = require('../../models/Conversacion');
const Mensaje = require('../../models/Mensaje');
const Cliente = require('../../models/Cliente');
const CuentaCliente = require('../../models/CuentaCliente');
const MovimientoMensajeria = require('../../models/MovimientoMensajeria');
const twilio = require('./twilio');
const { ErrorApi, paisDe } = require('../contexto');
const Motor = require('../../../frontend/assets/js/motor');

// ── WhatsApp del comercio: conversaciones, envíos, bolsa y avisos ──────────
// Reglas de WhatsApp que esto respeta:
//  - Texto libre solo dentro de las 24 h desde el último mensaje del cliente.
//  - Fuera de esa ventana, solo plantillas aprobadas por Meta.
// La bolsa prepagada del comercio es SOLO para marketing (campañas). Atender
// clientes, el bot y los avisos de pedidos están incluidos en el plan.
const VENTANA_MS = 24 * 3600 * 1000;
const base = () => String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const urls = empresaId => ({ entrante: `${base()}/api/v1/whatsapp/webhook/${empresaId}`, estado: `${base()}/api/v1/whatsapp/estado/${empresaId}` });

const soloDigitos = s => String(s || '').replace(/\D/g, '');
function aE164(pais, tel) {
  const d = soloDigitos(tel), p = pais?.prefijoTelefono || '';
  if (!d) return '';
  return '+' + (String(tel).trim().startsWith('+') || (p && d.startsWith(p) && d.length > 10) ? d : p + d);
}
function aLocal(pais, e164) {
  const d = soloDigitos(e164), p = pais?.prefijoTelefono || '';
  return p && d.startsWith(p) && d.length > p.length + 6 ? d.slice(p.length) : d;
}
const ventanaAbierta = c => !!c?.ultimaEntrante && Date.now() - new Date(c.ultimaEntrante).getTime() < VENTANA_MS;

// ¿Puede la empresa usar WhatsApp ahora? (en el simulador basta con la subcuenta)
const listo = e => !!(e?.modulos?.whatsapp && e.whatsapp?.subcuentaSid && twilio.disponible() && (e.whatsapp.estado === 'activo' || (twilio.simulado() && e.whatsapp.estado === 'subcuenta')));
const remitente = e => ({ subcuentaSid: e.whatsapp.subcuentaSid, servicioSid: e.whatsapp.servicioSid, numero: e.whatsapp.numero });

// ── Bolsa prepagada ────────────────────────────────────────────────────────
// permitirNegativo: los avisos de pedidos nunca se cortan; las campañas sí.
async function consumir(empresaId, { canal = 'whatsapp', cantidad = 1, motivo, referencia, permitirNegativo = false }) {
  const campo = canal === 'correo' ? 'mensajeria.saldoCorreo' : 'mensajeria.saldoWhatsapp';
  const e = await Empresa.findOneAndUpdate({ _id: empresaId, ...(!permitirNegativo && { [campo]: { $gte: cantidad } }) }, { $inc: { [campo]: -cantidad } }, { new: true }).select('mensajeria').lean();
  if (!e) throw new ErrorApi('La bolsa de mensajes está agotada. Pide una recarga al equipo de Katú.', 409, 'SIN_SALDO');
  await MovimientoMensajeria.create({ empresa: empresaId, canal, tipo: 'consumo', cantidad: -cantidad, saldo: canal === 'correo' ? e.mensajeria.saldoCorreo : e.mensajeria.saldoWhatsapp, motivo, referencia });
}
async function recargar(empresaId, { whatsapp = 0, correo = 0, motivo, usuario }) {
  const w = Math.trunc(Number(whatsapp) || 0), c = Math.trunc(Number(correo) || 0);
  if (!w && !c) throw new ErrorApi('Indica cuántos mensajes recargar');
  const e = await Empresa.findByIdAndUpdate(empresaId, { $inc: { 'mensajeria.saldoWhatsapp': w, 'mensajeria.saldoCorreo': c } }, { new: true }).select('mensajeria').lean();
  const tipo = (w < 0 || c < 0) ? 'ajuste' : 'recarga';
  if (w) await MovimientoMensajeria.create({ empresa: empresaId, canal: 'whatsapp', tipo, cantidad: w, saldo: e.mensajeria.saldoWhatsapp, motivo, usuario });
  if (c) await MovimientoMensajeria.create({ empresa: empresaId, canal: 'correo', tipo, cantidad: c, saldo: e.mensajeria.saldoCorreo, motivo, usuario });
  return e.mensajeria;
}

// ── Entrantes ──────────────────────────────────────────────────────────────
async function vincular(empresa, pais, telefono) {
  const local = aLocal(pais, telefono);
  const [cliente, cuenta] = await Promise.all([
    Cliente.findOne({ empresa: empresa._id, telefono: { $in: [local, telefono] } }).select('_id').lean(),
    CuentaCliente.findOne({ pais: empresa.pais, telefono: { $in: [local, telefono] } }).select('_id').lean(),
  ]);
  return { ...(cliente && { cliente: cliente._id }), ...(cuenta && { cuenta: cuenta._id }) };
}

// Chat de prueba del asistente (empresas sin número todavía, p. ej. en la prueba gratis):
// un "cliente" ficticio con un teléfono que no existe; nada sale por WhatsApp.
const telPrueba = pais => `+${pais?.prefijoTelefono || '1'}0000000000`;

// p: parámetros del webhook de Twilio (From, Body, ProfileName, MessageSid, NumMedia, MediaUrl0…, Latitude…)
async function recibir(empresa, p, { prueba = false } = {}) {
  const telefono = '+' + soloDigitos(String(p.From || '').replace(/^whatsapp:/, ''));
  if (telefono.length < 8) return null;
  if (p.MessageSid && await Mensaje.exists({ sid: p.MessageSid })) return null; // Twilio reintentó
  const pais = await paisDe(empresa);
  const media = Array.from({ length: Math.min(10, Number(p.NumMedia) || 0) }, (_, i) => ({ url: p[`MediaUrl${i}`], tipo: p[`MediaContentType${i}`] })).filter(m => m.url);
  const ubicacion = p.Latitude && p.Longitude ? { lat: Number(p.Latitude), lng: Number(p.Longitude), direccion: String(p.Address || p.Label || '').slice(0, 200) } : null;
  const texto = String(p.Body || '').slice(0, 4096);
  const resumen = texto || (ubicacion ? '📍 Ubicación compartida' : media.length ? '📎 Archivo' : '');

  const antes = await Conversacion.findOne({ empresa: empresa._id, telefono }).lean();
  const nueva = !antes || antes.estado === 'cerrada';
  const bot = require('./bot');
  // En el chat de prueba el asistente atiende siempre que el servidor tenga IA
  const conBot = nueva && (prueba ? require('../ia/openrouter').disponible() : bot.activo(empresa));
  const conv = await Conversacion.findOneAndUpdate({ empresa: empresa._id, telefono }, {
    $set: { ultimoTexto: resumen.slice(0, 160), ultimoEn: new Date(), ultimaEntrante: new Date(), ...(p.ProfileName && { nombre: String(p.ProfileName).slice(0, 80) }), ...(prueba && { prueba: true }),
      ...(ubicacion && { ubicacion: { ...ubicacion, en: new Date() } }), ...(nueva && { estado: conBot ? 'bot' : 'espera', asesor: null, cerradaEn: null, ia: {} }),
      ...(!antes && await vincular(empresa, pais, telefono)) },
    $inc: { sinLeer: 1 },
  }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  try {
    await Mensaje.create({ empresa: empresa._id, conversacion: conv._id, direccion: 'entrante', autor: 'cliente', texto, media, ...(ubicacion && { ubicacion }), sid: p.MessageSid || undefined, estado: 'recibido' });
  } catch (e) { if (e.code !== 11000) throw e; return conv; }
  // Respuesta automática al abrir (o reabrir) la conversación
  // "BAJA": deja de recibir promociones por WhatsApp (Ley 1581 y reglas de Meta)
  const mk = require('../marketing');
  if (mk.PALABRA_BAJA.test(texto)) {
    await mk.bajaWhatsapp(empresa, [aLocal(pais, telefono), telefono]);
    await enviarTexto({ empresa, conversacion: conv, texto: `Listo, no te enviaremos más promociones de ${empresa.nombre} por WhatsApp. Si quieres volver a recibirlas, escríbenos.`, autor: 'sistema' }).catch(e => console.error('[whatsapp.baja]', e.message));
    if (nueva) await Conversacion.updateOne({ _id: conv._id }, { estado: 'cerrada', cerradaEn: new Date(), sinLeer: 0 });
    return conv;
  }
  if (conv.estado === 'bot') { bot.programar(empresa._id, conv._id); return conv; }
  if (nueva && empresa.whatsapp?.bienvenida) await enviarTexto({ empresa, conversacion: conv, texto: empresa.whatsapp.bienvenida, autor: 'sistema' }).catch(e => console.error('[whatsapp.bienvenida]', e.message));
  return conv;
}

const ORDEN = { enviando: 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 };
const ESTADOS = { queued: 'enviando', accepted: 'enviando', sending: 'enviando', sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido', undelivered: 'fallido' };
async function actualizarEstado(p) {
  const estado = ESTADOS[p.MessageStatus]; if (!p.MessageSid || !estado) return;
  const m = await Mensaje.findOne({ sid: p.MessageSid }).select('estado').lean();
  if (!m || (ORDEN[estado] < ORDEN[m.estado] && estado !== 'fallido')) return; // los avisos llegan desordenados
  await Mensaje.updateOne({ _id: m._id }, { estado, ...(estado === 'fallido' && { error: `Código ${p.ErrorCode || '?'}${p.ErrorMessage ? ': ' + p.ErrorMessage : ''}` }) });
  await require('../marketing').estadoEnvio(p.MessageSid, estado).catch(() => {});
}

// ── Salientes ──────────────────────────────────────────────────────────────
async function _registrar(empresa, conv, datos, envio) {
  const m = await Mensaje.create({ empresa: empresa._id, conversacion: conv._id, direccion: 'saliente', estado: 'enviando', ...datos });
  try {
    const r = await envio();
    await Mensaje.updateOne({ _id: m._id }, { sid: r.sid, estado: r.estado });
    await Conversacion.updateOne({ _id: conv._id }, { ultimoTexto: String(datos.texto || '').slice(0, 160), ultimoEn: new Date() });
    return { ...m.toObject(), sid: r.sid, estado: r.estado };
  } catch (e) {
    await Mensaje.updateOne({ _id: m._id }, { estado: 'fallido', error: e.message });
    throw e;
  }
}
// Texto libre: solo dentro de la ventana de 24 h. Gratis y nunca se corta por saldo.
async function enviarTexto({ empresa, conversacion, texto, usuario, autor = 'asesor' }) {
  const conv = await Conversacion.findById(conversacion._id).lean();
  // Chat de prueba: se guarda en la bandeja y no sale por WhatsApp
  if (!conv?.prueba && !listo(empresa)) throw new ErrorApi('El WhatsApp de la empresa no está activo', 409, 'WHATSAPP_INACTIVO');
  texto = String(texto || '').trim().slice(0, 4096);
  if (!texto) throw new ErrorApi('Escribe un mensaje');
  if (!ventanaAbierta(conv)) throw new ErrorApi('Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada', 409, 'VENTANA_CERRADA');
  const envio = conv.prueba ? async () => ({ sid: 'prueba' + require('crypto').randomBytes(12).toString('hex'), estado: 'entregado' }) : () => twilio.enviar(remitente(empresa), { a: conv.telefono, texto, aviso: urls(empresa._id).estado });
  return _registrar(empresa, conv, { autor, usuario, texto }, envio);
}
// Plantilla aprobada (inicia el comercio). Solo las campañas de marketing consumen
// la bolsa prepagada; los avisos de pedidos van incluidos en el plan (Katú asume
// su costo y lo ve en mensajeria.avisosIncluidos).
async function enviarPlantilla({ empresa, telefono, plantilla, variables, texto, tipo = 'servicio', referencia }) {
  if (!listo(empresa)) throw new ErrorApi('El WhatsApp de la empresa no está activo', 409, 'WHATSAPP_INACTIVO');
  const conv = await Conversacion.findOneAndUpdate({ empresa: empresa._id, telefono }, { $setOnInsert: { estado: 'cerrada', ultimoEn: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  if (tipo === 'marketing') await consumir(empresa._id, { motivo: 'Campaña', referencia });
  else await Empresa.updateOne({ _id: empresa._id }, { $inc: { 'mensajeria.avisosIncluidos': 1 } });
  return _registrar(empresa, conv, { autor: 'sistema', texto, plantilla }, () => twilio.enviar(remitente(empresa), { a: telefono, plantilla, variables, aviso: urls(empresa._id).estado }));
}

// ── Avisos de pedidos de domicilio ─────────────────────────────────────────
function textoPedido(p, pais, empresa) {
  const link = `${base()}/seguimiento/${p.seguimiento}`, $ = n => Motor.dinero(n, pais);
  const nombre = String(p.contacto?.nombre || '').split(' ')[0];
  return {
    recibido: `Hola ${nombre}, recibimos tu pedido ${p.numero} en ${empresa.nombre} por ${$(p.total)}. Puedes seguirlo aquí: ${link}`,
    preparando: `Estamos preparando tu pedido ${p.numero}. Te avisamos cuando salga.`,
    listo: p.tipo === 'recoger' ? `Tu pedido ${p.numero} está listo para recoger. Total: ${$(p.total)}.` : null,
    en_camino: `Tu pedido ${p.numero} va en camino. Total: ${$(p.total)}. Al recibirlo, dale al domiciliario tu PIN de entrega: ${p.pin}. Síguelo aquí: ${link}`,
    entregado: `Entregamos tu pedido ${p.numero}. ¡Gracias por comprar en ${empresa.nombre}!`,
    cancelado: `Tu pedido ${p.numero} fue cancelado${p.motivoCancelacion ? `: ${p.motivoCancelacion}` : ''}. Escríbenos si necesitas ayuda.`,
  }[p.estado] || null;
}
// Nunca lanza: un aviso fallido no puede frenar el pedido
async function notificarPedido(empresaId, pedido) {
  try {
    const empresa = await Empresa.findById(empresaId).lean();
    if (!empresa || empresa.whatsapp?.notificarPedidos === false || !pedido?.contacto?.telefono) return;
    const pais = await paisDe(empresa);
    const texto = textoPedido(pedido, pais, empresa); if (!texto) return;
    const telefono = aE164(pais, pedido.contacto.telefono);
    const conv = await Conversacion.findOne({ empresa: empresa._id, telefono }).lean();
    // El chat de prueba también recibe los avisos (sin salir por WhatsApp)
    if (conv?.prueba) { if (ventanaAbierta(conv)) await enviarTexto({ empresa, conversacion: conv, texto, autor: 'sistema' }); return; }
    if (!listo(empresa)) return;
    if (ventanaAbierta(conv)) return void await enviarTexto({ empresa, conversacion: conv, texto, autor: 'sistema' });
    const plantilla = empresa.whatsapp.plantillas?.[pedido.estado];
    if (!plantilla) return; // sin plantilla aprobada no se puede escribir fuera de la ventana
    await enviarPlantilla({ empresa, telefono, plantilla, texto, variables: { 1: String(pedido.contacto.nombre || '').split(' ')[0], 2: pedido.numero, 3: `${base()}/seguimiento/${pedido.seguimiento}` }, referencia: pedido.numero });
  } catch (e) { console.error('[whatsapp.aviso]', pedido?.numero, e.message); }
}

module.exports = { urls, aE164, aLocal, telPrueba, ventanaAbierta, listo, consumir, recargar, recibir, actualizarEstado, enviarTexto, enviarPlantilla, notificarPedido, twilio };
