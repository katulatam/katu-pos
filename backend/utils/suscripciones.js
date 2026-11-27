const Empresa = require('../models/Empresa');
const Plan = require('../models/Plan');
const Registro = require('../models/Registro');
const empresas = require('./empresas');
const stripe = require('./pagos/stripe');
const correo = require('./correo/sendgrid');
const { ErrorApi, paisPorCodigo } = require('./contexto');

// ── Suscripciones: planes, alta automática y ciclo de cobro con Stripe ─────
// Landing → Checkout de Stripe → webhook "checkout.session.completed" → se crea
// la empresa con los módulos del plan + administrador + correo de bienvenida.
// Cobro fallido → mora con periodo de gracia → suspensión. Pago → reactivación.
const DIAS_GRACIA = Number(process.env.DIAS_GRACIA_SUSCRIPCION) || 7;
const RESERVA_MIN = 60;
const LANDING = () => String(process.env.LANDING_URL || 'https://www.katupos.com').replace(/\/+$/, '');
const MODULOS = ['facturacion', 'domicilios', 'gamificacion', 'fiado', 'kiosco', 'whatsapp', 'marketing'];

// Planes de ejemplo (precios editables en Admin > Planes)
const PLANES_EJEMPLO = [
  { codigo: 'basico', nombre: 'Básico', orden: 1, moneda: 'COP', precioMensual: 89000, precioAnual: 890000, descripcion: 'Para empezar a vender rápido y en regla.',
    modulos: { facturacion: true, fiado: true, domicilios: false, gamificacion: false, kiosco: false, whatsapp: false, marketing: false },
    caracteristicas: ['Caja rápida con lector y báscula', 'Inventario, compras y vencimientos', 'Factura electrónica DIAN', 'Fiado y cartera de clientes', 'Informes y arqueos de turno', 'Funciona sin internet'] },
  { codigo: 'pro', nombre: 'Pro', orden: 2, destacado: true, moneda: 'COP', precioMensual: 179000, precioAnual: 1790000, descripcion: 'Vende también a domicilio y por WhatsApp.',
    modulos: { facturacion: true, fiado: true, domicilios: true, gamificacion: true, kiosco: false, whatsapp: true, marketing: false },
    caracteristicas: ['Todo lo del plan Básico', 'Tienda en línea con tu subdominio', 'Domicilios con seguimiento y PIN', 'WhatsApp con asistente de IA y asesores', 'Puntos, niveles y misiones para clientes'] },
  { codigo: 'premium', nombre: 'Premium', orden: 3, moneda: 'COP', precioMensual: 299000, precioAnual: 2990000, descripcion: 'La experiencia completa para crecer.',
    modulos: { facturacion: true, fiado: true, domicilios: true, gamificacion: true, kiosco: true, whatsapp: true, marketing: true },
    caracteristicas: ['Todo lo del plan Pro', 'Kiosco de autopago', 'Campañas por WhatsApp y correo', 'Ventas atribuidas a cada campaña', 'Soporte prioritario'] },
];
async function sembrarPlanes() {
  if (await Plan.exists({})) return;
  await Plan.insertMany(PLANES_EJEMPLO);
}
const planPublico = p => ({ codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, moneda: p.moneda, precioMensual: p.precioMensual, precioAnual: p.precioAnual, caracteristicas: p.caracteristicas, destacado: !!p.destacado, diasPrueba: p.diasPrueba || 0, modulos: p.modulos });
const planesActivos = async () => (await Plan.find({ activo: true }).sort({ orden: 1 }).lean()).map(planPublico);

// ── Registro desde la landing ──────────────────────────────────────────────
async function subdominioDisponible(s) {
  const slug = empresas.normalizarSlug(s);
  if (!empresas.slugValido(slug)) return { subdominio: slug, disponible: false, motivo: 'Usa de 3 a 40 letras, números o guiones (no palabras reservadas)' };
  const ocupado = await Empresa.exists({ slug }) || await Registro.exists({ subdominio: slug, estado: { $in: ['pendiente', 'pagado'] }, expira: { $gt: new Date() } });
  return { subdominio: slug, disponible: !ocupado, ...(ocupado && { motivo: 'Ese subdominio ya está en uso' }) };
}

async function iniciar(b) {
  const plan = await Plan.findOne({ codigo: String(b.plan || ''), activo: true }).lean();
  if (!plan) throw new ErrorApi('Elige un plan');
  const periodo = b.periodo === 'anual' ? 'anual' : 'mensual';
  const negocio = String(b.negocio || '').trim(), nombre = String(b.nombre || '').trim(), mail = String(b.correo || '').toLowerCase().trim();
  if (negocio.length < 2 || nombre.length < 3) throw new ErrorApi('Escribe el nombre del negocio y tu nombre');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new ErrorApi('Escribe un correo válido');
  const pais = await paisPorCodigo(String(b.pais || 'CO').toUpperCase()).catch(() => null);
  if (!pais?.activo) throw new ErrorApi('País no disponible');
  if (await require('../models/Usuario').exists({ correo: mail })) throw new ErrorApi('Ese correo ya tiene una cuenta en Katú POS. Inicia sesión o usa otro correo.', 409, 'CORREO_EN_USO');
  const sub = await subdominioDisponible(b.subdominio || negocio);
  if (!sub.disponible) throw new ErrorApi(sub.motivo, 409, 'SUBDOMINIO');
  if (!stripe.disponible()) throw new ErrorApi('Los pagos no están disponibles en este momento', 503);
  const reg = await Registro.create({ plan: plan.codigo, periodo, negocio, nombre, correo: mail, telefono: String(b.telefono || '').trim(), pais: pais.codigo, subdominio: sub.subdominio, expira: new Date(Date.now() + RESERVA_MIN * 60000) });
  const s = await stripe.crearCheckout({ plan, periodo, correo: mail, registroId: reg._id, exito: `${LANDING()}/bienvenida.html?r=${reg._id}`, cancelar: `${LANDING()}/#planes` });
  await Registro.updateOne({ _id: reg._id }, { stripeSesion: s.id });
  return { url: s.url, registro: reg._id };
}

// Lo consulta la página de bienvenida mientras se crea la cuenta
async function estadoRegistro(id) {
  let r = /^[a-f\d]{24}$/i.test(String(id)) ? await Registro.findById(id).lean() : null;
  if (!r) throw new ErrorApi('No encontramos tu registro', 404);
  // Respaldo si el webhook se demora o se pierde: se le pregunta a Stripe por la sesión
  if (['pendiente', 'vencido'].includes(r.estado) && r.stripeSesion && stripe.disponible()) {
    try {
      const s = await stripe.sesion(r.stripeSesion);
      if (s.status === 'complete' && s.mode === 'subscription') r = await provisionar(r._id, { cliente: s.customer, suscripcion: s.subscription }) || r;
    } catch (e) { console.error('[suscripcion.estado]', e.message); }
  }
  return { estado: r.estado, negocio: r.negocio, correo: r.correo, ...(r.estado === 'listo' && { url: `${empresas.urlEmpresa(r.subdominio)}/admin/` }) };
}

// ── Alta automática ────────────────────────────────────────────────────────
async function correoBienvenida(reg, empresa, usuario, token) {
  const url = empresas.urlEmpresa(empresa.slug), activar = `${url}/admin/activar.html?t=${token}`;
  const texto = `Hola ${reg.nombre.split(' ')[0]}:\n\n¡Bienvenido a Katú POS! Tu negocio ${empresa.nombre} ya está listo.\n\n1. Crea tu contraseña (el enlace vence en 72 horas):\n${activar}\n\n2. Tu panel: ${url}/admin/\n3. Tu caja: ${url}/pos/\n4. Tu tienda en línea: ${url}/\n\nTu usuario es ${usuario.correo}.\n\n— Equipo Katú POS`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif;color:#0B1729"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#05C3DD,#7C6CFF);padding:28px;color:#fff;font-size:24px;font-weight:bold">Katú POS</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.6"><p style="margin:0 0 14px">Hola ${reg.nombre.split(' ')[0].replace(/[<>&]/g, '')}:</p><p style="margin:0 0 14px">¡Bienvenido! <b>${empresa.nombre.replace(/[<>&]/g, '')}</b> ya está listo en <b>${url.replace(/^https?:\/\//, '')}</b>.</p>
<p style="margin:22px 0"><a href="${activar}" style="background:#0391A6;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:bold;display:inline-block">Crear mi contraseña</a></p>
<p style="margin:0 0 6px;color:#51637F;font-size:13px">El enlace vence en 72 horas. Tu usuario es ${usuario.correo}.</p>
<p style="margin:18px 0 0">Panel: <a href="${url}/admin/">${url}/admin/</a><br>Caja: <a href="${url}/pos/">${url}/pos/</a><br>Tienda en línea: <a href="${url}/">${url}/</a></p></td></tr></table></td></tr></table></body></html>`;
  const asunto = `¡${empresa.nombre} ya está en Katú POS!`;
  const plantilla = String(process.env.SENDGRID_TEMPLATE_BIENVENIDA || '').trim();
  // Con plantilla de SendGrid (se edita en su panel); sin ella, el diseño de aquí
  const envio = plantilla
    ? correo.enviarPlantilla({ a: usuario.correo, plantilla, nombreRemitente: 'Katú POS', etiquetas: { tipo: 'bienvenida', empresa: empresa._id },
        datos: { asunto, nombre: reg.nombre.split(' ')[0], negocio: empresa.nombre, dominio: url.replace(/^https?:\/\//, ''), usuario: usuario.correo, horas: 72,
          url_activar: activar, url_panel: `${url}/admin/`, url_caja: `${url}/pos/`, url_tienda: `${url}/`, anio: new Date().getFullYear() } })
    : correo.enviar({ a: usuario.correo, asunto, html, texto, nombreRemitente: 'Katú POS' });
  try {
    const r = await envio;
    console.log(`[correo] bienvenida enviada a ${usuario.correo}${plantilla ? ' (plantilla)' : ''} id=${r.id || '-'}`);
    return { activar, enviado: true };
  } catch (e) {
    console.error(`[correo] bienvenida NO enviada a ${usuario.correo}: ${e.message}`);
    return { activar, enviado: false, error: e.message };
  }
}

// Reenvío desde el admin de Katú: enlace nuevo de 72 h (el anterior deja de servir)
async function reenviarBienvenida(registroId) {
  const Usuario = require('../models/Usuario');
  const reg = /^[a-f\d]{24}$/i.test(String(registroId)) ? await Registro.findById(registroId).lean() : null;
  if (!reg || reg.estado !== 'listo' || !reg.empresa) throw new ErrorApi('Solo se reenvía a registros con la cuenta ya creada', 409);
  const empresa = await Empresa.findById(reg.empresa).lean();
  const usuario = await Usuario.findOne({ empresa: reg.empresa, rol: 'admin', correo: reg.correo }).lean() || await Usuario.findOne({ empresa: reg.empresa, rol: 'admin' }).lean();
  if (!empresa || !usuario) throw new ErrorApi('No se encontró la empresa o su administrador', 404);
  return correoBienvenida(reg, empresa, usuario, await empresas.enlaceClave(usuario._id));
}

// Idempotente: Stripe puede reenviar el mismo evento
async function provisionar(registroId, { cliente, suscripcion } = {}) {
  const reg = await Registro.findOneAndUpdate({ _id: registroId, estado: { $in: ['pendiente', 'vencido'] } }, { estado: 'pagado', stripeCliente: cliente, stripeSuscripcion: suscripcion }, { new: true }).lean();
  if (!reg) return Registro.findById(registroId).lean();
  try {
    const plan = await Plan.findOne({ codigo: reg.plan }).lean();
    // Si el subdominio se ocupó mientras pagaba, se busca uno libre
    let slug = reg.subdominio;
    for (let i = 2; await Empresa.exists({ slug }); i++) slug = `${reg.subdominio.slice(0, 36)}-${i}`;
    const { empresa, usuario } = await empresas.crearEmpresa({
      nombre: reg.negocio, slug, pais: reg.pais, correo: reg.correo, telefono: reg.telefono,
      modulos: Object.fromEntries(MODULOS.map(k => [k, !!plan?.modulos?.[k]])),
      suscripcion: { plan: reg.plan, periodo: reg.periodo, estado: plan?.diasPrueba > 0 ? 'prueba' : 'activa', stripeCliente: cliente, stripeSuscripcion: suscripcion },
    }, { admin: { nombre: reg.nombre, correo: reg.correo, telefono: reg.telefono } });
    // Stripe no garantiza el orden de los eventos: invoice.paid puede llegar antes que este.
    // Se consulta la suscripción para dejar bien el estado y el fin del periodo pagado.
    if (suscripcion && stripe.disponible()) {
      try {
        const s = await stripe.llamar('get', `/subscriptions/${encodeURIComponent(suscripcion)}`);
        const fin = s.current_period_end || s.items?.data?.[0]?.current_period_end;
        const estado = { active: 'activa', trialing: 'prueba', past_due: 'mora', unpaid: 'mora', canceled: 'cancelada' }[s.status];
        await Empresa.updateOne({ _id: empresa._id }, { ...(fin && { 'suscripcion.actualHasta': new Date(fin * 1000) }), ...(estado && { 'suscripcion.estado': estado }) });
      } catch (e) { console.error('[suscripcion.periodo]', e.message); }
    }
    const token = await empresas.enlaceClave(usuario._id);
    await Registro.updateOne({ _id: reg._id }, { estado: 'listo', empresa: empresa._id, subdominio: slug, error: '' });
    await correoBienvenida(reg, empresa, usuario, token);
    return { ...reg, estado: 'listo', empresa: empresa._id, subdominio: slug };
  } catch (e) {
    console.error('[suscripcion.provisionar]', reg._id, e.message);
    await Registro.updateOne({ _id: reg._id }, { estado: 'error', error: String(e.message).slice(0, 300) });
    throw e;
  }
}

// ── Eventos de Stripe ──────────────────────────────────────────────────────
const porSuscripcion = id => Empresa.findOne({ 'suscripcion.stripeSuscripcion': id });
async function procesarEvento(ev) {
  const o = ev.data?.object || {};
  switch (ev.type) {
    case 'checkout.session.completed': {
      const id = o.metadata?.registro || o.client_reference_id;
      if (o.mode === 'subscription' && id) await provisionar(id, { cliente: o.customer, suscripcion: o.subscription });
      break;
    }
    case 'invoice.paid': case 'invoice.payment_succeeded': {
      const fin = o.lines?.data?.[0]?.period?.end;
      await Empresa.updateOne({ 'suscripcion.stripeSuscripcion': o.subscription }, { $set: { estado: true, 'suscripcion.estado': 'activa', ...(fin && { 'suscripcion.actualHasta': new Date(fin * 1000) }) }, $unset: { 'suscripcion.moraDesde': 1 } });
      break;
    }
    case 'invoice.payment_failed': {
      const e = await porSuscripcion(o.subscription);
      if (e && e.suscripcion?.estado !== 'cancelada') await Empresa.updateOne({ _id: e._id }, { 'suscripcion.estado': 'mora', ...(!e.suscripcion?.moraDesde && { 'suscripcion.moraDesde': new Date() }) });
      break;
    }
    case 'customer.subscription.updated': {
      const estado = { active: 'activa', trialing: 'prueba', past_due: 'mora', unpaid: 'mora', canceled: 'cancelada' }[o.status];
      if (estado) await Empresa.updateOne({ 'suscripcion.stripeSuscripcion': o.id }, { 'suscripcion.estado': estado, ...(o.status === 'unpaid' && { estado: false }), ...(o.current_period_end && { 'suscripcion.actualHasta': new Date(o.current_period_end * 1000) }) });
      break;
    }
    case 'customer.subscription.deleted':
      await Empresa.updateOne({ 'suscripcion.stripeSuscripcion': o.id }, { estado: false, 'suscripcion.estado': 'cancelada' });
      break;
    default: break;
  }
}

// Job: mora más allá del periodo de gracia → empresa suspendida (vuelve sola al pagar)
async function suspenderVencidas() {
  const r = await Empresa.updateMany({ estado: true, 'suscripcion.estado': 'mora', 'suscripcion.moraDesde': { $lt: new Date(Date.now() - DIAS_GRACIA * 86400000) } }, { estado: false });
  await Registro.updateMany({ estado: 'pendiente', expira: { $lt: new Date() } }, { estado: 'vencido' });
  return r.modifiedCount;
}

async function portal(empresa) {
  if (!empresa.suscripcion?.stripeCliente) throw new ErrorApi('Tu cuenta la administra el equipo de Katú: escríbenos para cambios en tu plan');
  const s = await stripe.portal(empresa.suscripcion.stripeCliente, `${empresas.urlEmpresa(empresa.slug)}/admin/suscripcion.html`);
  return { url: s.url };
}

module.exports = { reenviarBienvenida, PLANES_EJEMPLO, MODULOS, sembrarPlanes, planesActivos, planPublico, subdominioDisponible, iniciar, estadoRegistro, provisionar, procesarEvento, suspenderVencidas, portal, DIAS_GRACIA };
