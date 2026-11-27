const Empresa = require('../../models/Empresa');
const Usuario = require('../../models/Usuario');
const NumeroWhatsapp = require('../../models/NumeroWhatsapp');
const twilio = require('./twilio');
const { urls } = require('./index');
const correo = require('../correo/sendgrid');
const empresas = require('../empresas');
const { ErrorApi } = require('../contexto');
const { enPrueba } = require('../prueba');

// ── Números de WhatsApp de Katú ────────────────────────────────────────────
// Katú compra números de EE. UU. en Twilio y los asigna a las empresas con
// plan Pro o Premium (módulo whatsapp). El comercio no hace nada:
//   1. Asignar: el número pasa a la subcuenta de la empresa y a su servicio.
//   2. El equipo Katú registra el remitente de WhatsApp en la consola de Twilio
//      (perfil del negocio; Twilio verifica el número solo y Meta lo aprueba).
//   3. El job lo detecta (o el botón "Verificar"), lo activa, crea las
//      plantillas de avisos y le escribe al cliente "Tu WhatsApp está listo".
const E164 = /^\+1\d{10}$/;
const nota = (accion, empresa, usuario) => ({ fecha: new Date(), accion, ...(empresa && { empresa }), ...(usuario && { usuario }) });

async function listar() {
  const [numeros, sinNumero] = await Promise.all([
    NumeroWhatsapp.find().populate('empresa', 'nombre slug').sort({ estado: 1, createdAt: -1 }).lean(),
    // Empresas que pueden recibir un número: plan con WhatsApp y sin número
    Empresa.find({ estado: true, 'modulos.whatsapp': true }).select('nombre slug pais whatsapp.estado suscripcion').lean(),
  ]);
  const ocupadas = new Set(numeros.filter(n => n.empresa).map(n => String(n.empresa._id)));
  // Las empresas en prueba gratis no reciben número (salvo que se vuelvan Cuenta Katú)
  return { numeros, empresas: sinNumero.filter(e => !ocupadas.has(String(e._id)) && !enPrueba(e)).map(e => ({ _id: e._id, nombre: e.nombre, slug: e.slug, pais: e.pais })), simulado: twilio.simulado() };
}

const buscar = q => twilio.buscarNumeros({ codigoArea: /^\d{3}$/.test(String(q.codigoArea || '')) ? q.codigoArea : undefined });

async function comprar({ numero }, usuario) {
  if (!E164.test(String(numero || ''))) throw new ErrorApi('Elige un número de EE. UU. de la lista (+1…)');
  if (await NumeroWhatsapp.exists({ numero })) throw new ErrorApi('Ese número ya está en el inventario', 409);
  const r = await twilio.comprarNumero(numero);
  return NumeroWhatsapp.create({ numero: r.numero, sid: r.sid, cuenta: r.cuenta, historial: [nota('comprado', null, usuario)] });
}

// Un número que Katú ya compró en la consola de Twilio
async function registrar({ numero }, usuario) {
  numero = String(numero || '').replace(/[^\d+]/g, '');
  if (!E164.test(numero)) throw new ErrorApi('Escribe el número completo de EE. UU. (+1 y 10 dígitos)');
  if (await NumeroWhatsapp.exists({ numero })) throw new ErrorApi('Ese número ya está en el inventario', 409);
  const r = await twilio.buscarComprado(numero);
  if (!r) throw new ErrorApi('Ese número no está en la cuenta de Twilio de Katú', 404);
  return NumeroWhatsapp.create({ numero: r.numero, sid: r.sid, cuenta: r.cuenta, historial: [nota('registrado', null, usuario)] });
}

// Un clic: crea la subcuenta si falta, toma un número libre (o compra uno) y lo conecta
async function asignar({ empresa: empresaId, numero: numeroId, comprarSiFalta }, usuario) {
  let e = await Empresa.findById(empresaId).lean();
  if (!e) throw new ErrorApi('Empresa no encontrada', 404);
  if (!e.modulos?.whatsapp) throw new ErrorApi('El plan de esta empresa no incluye WhatsApp (solo Pro y Premium)', 409);
  if (enPrueba(e)) throw new ErrorApi('La empresa está en prueba gratis: el número se asigna al suscribirse. Para una demo, conviértela en Cuenta Katú.', 409);
  if (await NumeroWhatsapp.exists({ empresa: e._id })) throw new ErrorApi('Esta empresa ya tiene un número asignado', 409);
  if (!twilio.disponible()) throw new ErrorApi('Faltan las credenciales de Twilio de Katú en el servidor', 503);
  if (!e.whatsapp?.subcuentaSid) {
    if (!twilio.simulado() && !/^https:\/\//.test(process.env.PUBLIC_URL || '')) throw new ErrorApi('Define PUBLIC_URL (https) en el servidor: Twilio necesita llamar a los webhooks');
    const s = await twilio.crearSubcuenta(e.nombre, urls(e._id));
    e = await Empresa.findByIdAndUpdate(e._id, { 'whatsapp.subcuentaSid': s.subcuentaSid, 'whatsapp.servicioSid': s.servicioSid, 'whatsapp.estado': 'subcuenta' }, { new: true }).lean();
  }
  // Se reserva el número de forma atómica: dos asignaciones a la vez no toman el mismo
  let n = await NumeroWhatsapp.findOneAndUpdate({ ...(numeroId ? { _id: numeroId } : {}), estado: 'disponible' }, { estado: 'asignado', empresa: e._id, asignadoEn: new Date() }, { new: true, sort: { createdAt: 1 } });
  if (!n && !numeroId && comprarSiFalta) {
    const [libre] = await twilio.buscarNumeros();
    if (!libre) throw new ErrorApi('Twilio no tiene números disponibles ahora; intenta más tarde', 503);
    await comprar({ numero: libre.numero }, usuario);
    n = await NumeroWhatsapp.findOneAndUpdate({ numero: libre.numero, estado: 'disponible' }, { estado: 'asignado', empresa: e._id, asignadoEn: new Date() }, { new: true });
  }
  if (!n) throw new ErrorApi(numeroId ? 'Ese número ya no está disponible' : 'No hay números disponibles en el inventario', 409);
  try {
    if (n.cuenta !== e.whatsapp.subcuentaSid) await twilio.moverNumero(n.sid, n.cuenta || twilio.sidMaestra(), e.whatsapp.subcuentaSid);
    await twilio.agregarAServicio(e.whatsapp.subcuentaSid, e.whatsapp.servicioSid, n.sid);
  } catch (x) {
    await NumeroWhatsapp.updateOne({ _id: n._id }, { estado: 'disponible', empresa: null, $unset: { asignadoEn: 1 } });
    throw x;
  }
  await NumeroWhatsapp.updateOne({ _id: n._id }, { cuenta: e.whatsapp.subcuentaSid, $push: { historial: nota('asignado', e._id, usuario) } });
  return { numero: n.numero, guia: guia(e, n.numero) };
}

// Datos para registrar el remitente de WhatsApp en la consola de Twilio
function guia(e, numero) {
  const url = empresas.urlEmpresa(e.slug);
  return {
    subcuenta: `Katú · ${e.nombre}`.slice(0, 64), subcuentaSid: e.whatsapp?.subcuentaSid, numero,
    nombreVisible: e.nombre, descripcion: `Pedidos y atención de ${e.nombre}. Compra en línea en ${url.replace(/^https?:\/\//, '')}`.slice(0, 256),
    sitioWeb: url, direccion: [e.direccion, e.ciudad].filter(Boolean).join(', '), correo: e.correo || '', logo: e.logoUrl || '',
  };
}

// Plantillas de avisos (UTILITY). {{1}} nombre, {{2}} pedido, {{3}} enlace de seguimiento.
// No empiezan ni terminan con una variable (regla de Meta).
const AVISOS = {
  recibido: 'Hola {{1}}, recibimos tu pedido {{2}}. Puedes seguirlo aquí: {{3}} ¡Gracias por tu compra!',
  listo: 'Hola {{1}}, tu pedido {{2}} está listo. Consulta los detalles aquí: {{3}} Te esperamos.',
  en_camino: 'Hola {{1}}, tu pedido {{2}} va en camino. Síguelo y consulta tu PIN de entrega aquí: {{3}} Gracias.',
  entregado: 'Hola {{1}}, entregamos tu pedido {{2}}. Puedes ver el detalle aquí: {{3}} ¡Gracias por comprar con nosotros!',
  cancelado: 'Hola {{1}}, tu pedido {{2}} fue cancelado. Más información aquí: {{3}} Escríbenos si necesitas ayuda.',
};
async function crearPlantillasAvisos(e) {
  const hechas = new Set((e.whatsapp?.plantillasAuto || []).map(p => p.evento));
  const nuevas = [];
  for (const [evento, cuerpo] of Object.entries(AVISOS)) {
    if (hechas.has(evento) || e.whatsapp?.plantillas?.[evento]) continue;
    try {
      const r = await twilio.crearPlantilla(e.whatsapp.subcuentaSid, { nombre: `aviso_${evento}_${String(e._id).slice(-6)}`, cuerpo, categoria: 'UTILITY', variables: { 1: 'Ana', 2: 'D-00001', 3: 'https://katupos.com' } });
      nuevas.push({ evento, contentSid: r.contentSid, estado: 'pendiente' });
    } catch (x) { console.error('[whatsapp.plantillas]', e.slug, evento, x.message); }
  }
  if (nuevas.length) await Empresa.updateOne({ _id: e._id }, { $push: { 'whatsapp.plantillasAuto': { $each: nuevas } } });
}
// Las aprobadas pasan a whatsapp.plantillas, que es lo que usan los avisos
async function revisarPlantillas(e) {
  for (const p of (e.whatsapp?.plantillasAuto || []).filter(x => x.estado === 'pendiente')) {
    const r = await twilio.estadoPlantilla(e.whatsapp.subcuentaSid, p.contentSid).catch(() => null);
    if (!r || r.estado === 'pendiente') continue;
    await Empresa.updateOne({ _id: e._id, 'whatsapp.plantillasAuto.contentSid': p.contentSid }, {
      $set: { 'whatsapp.plantillasAuto.$.estado': r.estado, 'whatsapp.plantillasAuto.$.motivo': r.motivo || '', ...(r.estado === 'aprobada' && { [`whatsapp.plantillas.${p.evento}`]: p.contentSid }) },
    });
  }
}

async function correoListo(e, numero) {
  const admin = await Usuario.findOne({ empresa: e._id, rol: 'admin', estado: true }).sort({ createdAt: 1 }).lean();
  if (!admin) return;
  const url = `${empresas.urlEmpresa(e.slug)}/admin/whatsapp.html`;
  const limpio = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const texto = `Hola ${admin.nombre.split(' ')[0]}:\n\nEl WhatsApp de ${e.nombre} ya está listo: ${numero}.\n\nCompártelo con tus clientes: el asistente de IA los atiende, arma los pedidos con tu catálogo y te pasa las conversaciones que necesiten a una persona.\n\nTu bandeja de conversaciones: ${url}\n\n— Equipo Katú POS`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif;color:#0B1729"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#25D366,#05C3DD);padding:28px;color:#fff;font-size:24px;font-weight:bold">Katú POS · WhatsApp</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.6"><h1 style="margin:0 0 14px;font-size:22px">Tu WhatsApp ya está listo</h1><p style="margin:0 0 14px">Hola ${limpio(admin.nombre.split(' ')[0])}:</p><p style="margin:0 0 14px">El WhatsApp de <b>${limpio(e.nombre)}</b> ya recibe mensajes en el número:</p>
<p style="margin:0 0 18px;font-size:26px;font-weight:bold;color:#0A8F63">${limpio(numero)}</p><p style="margin:0 0 14px">Compártelo con tus clientes: el asistente de IA los atiende, arma los pedidos con tu catálogo y te pasa las conversaciones que necesiten a una persona.</p>
<p style="margin:22px 0"><a href="${url}" style="background:#0391A6;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:bold;display:inline-block">Ver mis conversaciones</a></p></td></tr></table></td></tr></table></body></html>`;
  try { await correo.enviar({ a: admin.correo, asunto: `El WhatsApp de ${e.nombre} ya está listo`, html, texto, nombreRemitente: 'Katú POS' }); }
  catch (x) { console.error(`[correo] WhatsApp listo NO enviado a ${admin.correo}: ${x.message}`); }
}

// ¿Ya quedó registrado en WhatsApp? Si sí: activa, deja el bot listo, plantillas y correo
async function verificar(numeroId, usuario) {
  const n = await NumeroWhatsapp.findById(numeroId).lean();
  if (!n || !n.empresa) throw new ErrorApi('Número no asignado', 404);
  if (n.estado === 'activo') return { activo: true, numero: n.numero };
  const e = await Empresa.findById(n.empresa).lean();
  if (!(await twilio.esRemitenteWhatsapp(e.whatsapp.subcuentaSid, e.whatsapp.servicioSid, n.numero).catch(() => false))) return { activo: false, numero: n.numero };
  if (await Empresa.exists({ _id: { $ne: e._id }, 'whatsapp.numero': n.numero })) throw new ErrorApi('Ese número ya está activo en otra empresa', 409);
  const r = await NumeroWhatsapp.updateOne({ _id: n._id, estado: 'asignado' }, { estado: 'activo', activadoEn: new Date(), $push: { historial: nota('activado', e._id, usuario) } });
  if (!r.modifiedCount) return { activo: true, numero: n.numero }; // otro proceso ya lo activó
  const ia = require('../ia/openrouter');
  await Empresa.updateOne({ _id: e._id }, {
    'whatsapp.numero': n.numero, 'whatsapp.estado': 'activo',
    // Listo para usar: el asistente atiende (si hay IA) y saludo por defecto
    ...(ia.disponible() && !e.whatsapp?.bot?.activo && { 'whatsapp.bot.activo': true }),
    ...(!e.whatsapp?.bienvenida && { 'whatsapp.bienvenida': `¡Hola! Gracias por escribir a ${e.nombre}. ¿En qué te podemos ayudar?` }),
  });
  const activa = await Empresa.findById(e._id).lean();
  await crearPlantillasAvisos(activa);
  await correoListo(activa, n.numero);
  return { activo: true, numero: n.numero };
}

// Quita el número a la empresa (cancelación o cambio) y vuelve al inventario
async function liberar(numeroId, usuario) {
  const n = await NumeroWhatsapp.findById(numeroId).lean();
  if (!n || !n.empresa) throw new ErrorApi('Ese número no está asignado', 409);
  const e = await Empresa.findById(n.empresa).lean();
  if (e?.whatsapp?.subcuentaSid) {
    await twilio.quitarDeServicio(e.whatsapp.subcuentaSid, e.whatsapp.servicioSid, n.sid);
    await twilio.moverNumero(n.sid, n.cuenta || e.whatsapp.subcuentaSid, twilio.sidMaestra());
    if (e.whatsapp.numero === n.numero) await Empresa.updateOne({ _id: e._id }, { 'whatsapp.numero': '', 'whatsapp.estado': 'subcuenta' });
  }
  await NumeroWhatsapp.updateOne({ _id: n._id }, { estado: 'disponible', empresa: null, cuenta: twilio.sidMaestra(), $unset: { asignadoEn: 1, activadoEn: 1 }, $push: { historial: nota('liberado', n.empresa, usuario) } });
  return { ok: true };
}

// Irreversible: deja de pagarse en Twilio y el número se pierde
async function darDeBaja(numeroId) {
  const n = await NumeroWhatsapp.findById(numeroId).lean();
  if (!n) throw new ErrorApi('Número no encontrado', 404);
  if (n.empresa) throw new ErrorApi('Primero libera el número de la empresa', 409);
  await twilio.darDeBaja(n.sid, n.cuenta);
  await NumeroWhatsapp.deleteOne({ _id: n._id });
  return { ok: true };
}

// Job: activa los números ya registrados y revisa la aprobación de plantillas
async function revisar() {
  let activados = 0;
  for (const n of await NumeroWhatsapp.find({ estado: 'asignado' }).lean()) {
    try { if ((await verificar(n._id)).activo) activados++; } catch (x) { console.error('[whatsapp.numeros]', n.numero, x.message); }
  }
  for (const e of await Empresa.find({ 'whatsapp.plantillasAuto.estado': 'pendiente' }).lean()) await revisarPlantillas(e).catch(x => console.error('[whatsapp.plantillas]', e.slug, x.message));
  return activados;
}

// Correo interno al equipo Katú (KATU_AVISOS_CORREO o, si falta, KATU_ADMIN_EMAIL)
async function avisarEquipo(asunto, lineas) {
  const a = String(process.env.KATU_AVISOS_CORREO || process.env.KATU_ADMIN_EMAIL || '').trim();
  if (!a) return;
  const texto = lineas.join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0B1729">${lineas.map(l => `<p style="margin:0 0 8px">${String(l).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`).join('')}</div>`;
  try { await correo.enviar({ a, asunto: `[Katú POS] ${asunto}`, html, texto, nombreRemitente: 'Katú POS' }); }
  catch (x) { console.error('[correo] aviso al equipo NO enviado:', x.message); }
}

// Al suscribirse a Pro o Premium: número del inventario (o comprado) y aviso al
// equipo para registrarlo en WhatsApp. Nunca lanza: no puede frenar el alta.
async function asignarAlSuscribirse(empresaId) {
  const e = await Empresa.findById(empresaId).lean().catch(() => null);
  if (!e?.modulos?.whatsapp || e.whatsapp?.numero || enPrueba(e) || await NumeroWhatsapp.exists({ empresa: e._id })) return null;
  const admin = `${String(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/admin/numeros.html`;
  try {
    const r = await asignar({ empresa: e._id, comprarSiFalta: true });
    await avisarEquipo(`Registrar el WhatsApp de ${e.nombre}`, [
      `${e.nombre} (${e.slug}) se suscribió a un plan con WhatsApp y se le asignó el número ${r.numero}.`,
      `Falta registrarlo como remitente de WhatsApp en la consola de Twilio, subcuenta "${r.guia.subcuenta}".`,
      `La guía con los datos del perfil está en Katú → Números de WhatsApp: ${admin}`,
      'Cuando Meta lo apruebe, Katú POS lo activa solo y le avisa al cliente.',
    ]);
    return r;
  } catch (x) {
    console.error('[whatsapp.numeros] asignación automática', e.slug, x.message);
    await avisarEquipo(`Asignar a mano el WhatsApp de ${e.nombre}`, [`${e.nombre} (${e.slug}) se suscribió a un plan con WhatsApp, pero no se pudo asignar el número solo: ${x.message}`, `Asígnalo en Katú → Números de WhatsApp: ${admin}`]);
    return null;
  }
}

module.exports = { listar, buscar, comprar, registrar, asignar, asignarAlSuscribirse, guia, verificar, liberar, darDeBaja, revisar, AVISOS };
