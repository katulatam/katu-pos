const Empresa = require('../models/Empresa');
const Plan = require('../models/Plan');
const Registro = require('../models/Registro');
const empresas = require('./empresas');
const stripe = require('./pagos/stripe');
const correo = require('./correo/sendgrid');
const { ErrorApi, paisPorCodigo } = require('./contexto');
const Pais = require('../models/Pais');
const { proveedorDe } = require('./facturacion');
const prueba = require('./prueba');

// ── Suscripciones: planes, alta automática y ciclo de cobro con Stripe ─────
// Landing → Checkout de Stripe → webhook "checkout.session.completed" → se crea
// la empresa con los módulos del plan + administrador + correo de bienvenida.
// Cobro fallido → mora con periodo de gracia → suspensión. Pago → reactivación.
const DIAS_GRACIA = Number(process.env.DIAS_GRACIA_SUSCRIPCION) || 7;
const RESERVA_MIN = 60;
const LANDING = () => String(process.env.LANDING_URL || 'https://www.katupos.com').replace(/\/+$/, '');
const MODULOS = ['facturacion', 'domicilios', 'gamificacion', 'fiado', 'kiosco', 'whatsapp', 'marketing'];
const fechaLarga = (d, zona) => new Date(d).toLocaleDateString('es', { timeZone: zona || 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
const limpio = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Planes de ejemplo (precios editables en Admin > Planes)
const PLANES_EJEMPLO = [
  { codigo: 'basico', nombre: 'Básico', orden: 1, moneda: 'USD', precioMensual: 29, precioAnual: 290, descripcion: 'Para empezar a vender rápido y en regla.',
    modulos: { facturacion: true, fiado: true, domicilios: false, gamificacion: false, kiosco: false, whatsapp: false, marketing: false },
    caracteristicas: ['POS rápido con lector y báscula', 'Inventario, compras y vencimientos', 'Factura electrónica (según tu país)', 'Fiado y cartera de clientes', 'Informes con IA y arqueos de turno', 'Funciona sin internet'] },
  { codigo: 'pro', nombre: 'Pro', orden: 2, destacado: true, moneda: 'USD', precioMensual: 59, precioAnual: 590, descripcion: 'Vende también a domicilio y por WhatsApp.',
    modulos: { facturacion: true, fiado: true, domicilios: true, gamificacion: true, kiosco: false, whatsapp: true, marketing: false },
    caracteristicas: ['Todo lo del plan Básico', 'Tienda en línea con tu subdominio', 'Domicilios con seguimiento y PIN', 'WhatsApp con asistente de IA y asesores', 'Puntos, niveles y misiones para clientes'] },
  { codigo: 'premium', nombre: 'Premium', orden: 3, moneda: 'USD', precioMensual: 99, precioAnual: 990, descripcion: 'La experiencia completa para crecer.',
    modulos: { facturacion: true, fiado: true, domicilios: true, gamificacion: true, kiosco: true, whatsapp: true, marketing: true },
    caracteristicas: ['Todo lo del plan Pro', 'Software de autopago (el kiosco se cotiza aparte)', 'Campañas por WhatsApp y correo', 'Ventas atribuidas a cada campaña', 'Soporte prioritario'] },
];
async function sembrarPlanes() {
  if (await Plan.exists({})) return;
  await Plan.insertMany(PLANES_EJEMPLO);
}
const planPublico = p => ({ codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, moneda: p.moneda, precioMensual: p.precioMensual, precioAnual: p.precioAnual, caracteristicas: p.caracteristicas, destacado: !!p.destacado, diasPrueba: p.diasPrueba || 0, modulos: p.modulos });
const planesActivos = async () => (await Plan.find({ activo: true }).sort({ orden: 1 }).lean()).map(planPublico);
// Prueba gratis que anuncia la landing (null si está apagada o su plan no existe)
async function infoPrueba() {
  const dias = prueba.DIAS();
  if (!dias) return null;
  const plan = await Plan.findOne({ codigo: prueba.PLAN(), activo: true }).lean();
  return plan ? { dias, plan: plan.codigo, nombrePlan: plan.nombre } : null;
}
const modulosDe = (plan, pais) => Object.fromEntries(MODULOS.map(k => [k, !!plan?.modulos?.[k] && (k !== 'facturacion' || ofreceFacturacion(pais))]));
// Países donde alguien se puede registrar y si allí Katú ofrece la facturación electrónica
const ofreceFacturacion = p => !!(p?.facturacion?.ofrecida && proveedorDe(p));
const paisesRegistro = async () => (await Pais.find({ activo: true }).sort({ nombre: 1 }).lean()).map(p => ({
  codigo: p.codigo, nombre: p.nombre, moneda: p.moneda, zonasHorarias: p.zonasHorarias || [],
  facturacion: { ofrecida: ofreceFacturacion(p), nombreDocumento: p.facturacion?.nombreDocumento || '', entidad: p.facturacion?.entidad || '' },
}));

// ── Registro desde la landing ──────────────────────────────────────────────
async function subdominioDisponible(s) {
  const slug = empresas.normalizarSlug(s);
  if (!empresas.slugValido(slug)) return { subdominio: slug, disponible: false, motivo: 'Usa de 3 a 40 letras, números o guiones (no palabras reservadas)' };
  const ocupado = await Empresa.exists({ slug }) || await Registro.exists({ subdominio: slug, estado: { $in: ['pendiente', 'pagado'] }, expira: { $gt: new Date() } });
  return { subdominio: slug, disponible: !ocupado, ...(ocupado && { motivo: 'Ese subdominio ya está en uso' }) };
}

// Datos comunes del registro (pago o prueba)
async function validarRegistro(b) {
  const negocio = String(b.negocio || '').trim(), nombre = String(b.nombre || '').trim(), mail = String(b.correo || '').toLowerCase().trim();
  if (negocio.length < 2 || nombre.length < 3) throw new ErrorApi('Escribe el nombre del negocio y tu nombre');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new ErrorApi('Escribe un correo válido');
  const pais = await paisPorCodigo(String(b.pais || 'CO').toUpperCase()).catch(() => null);
  if (!pais?.activo) throw new ErrorApi('País no disponible');
  if (await require('../models/Usuario').exists({ correo: mail })) throw new ErrorApi('Ese correo ya tiene una cuenta en Katú POS. Inicia sesión o usa otro correo.', 409, 'CORREO_EN_USO');
  const sub = await subdominioDisponible(b.subdominio || negocio);
  if (!sub.disponible) throw new ErrorApi(sub.motivo, 409, 'SUBDOMINIO');
  const telefono = String(b.telefono || '').trim();
  return { negocio, nombre, correo: mail, telefono, telefonoNorm: telefono.replace(/\D/g, ''), pais: pais.codigo, subdominio: sub.subdominio };
}

async function iniciar(b) {
  const plan = await Plan.findOne({ codigo: String(b.plan || ''), activo: true }).lean();
  if (!plan) throw new ErrorApi('Elige un plan');
  const periodo = b.periodo === 'anual' ? 'anual' : 'mensual';
  const d = await validarRegistro(b);
  if (!stripe.disponible()) throw new ErrorApi('Los pagos no están disponibles en este momento', 503);
  const reg = await Registro.create({ ...d, plan: plan.codigo, periodo, expira: new Date(Date.now() + RESERVA_MIN * 60000) });
  const mail = d.correo;
  const s = await stripe.crearCheckout({ plan, periodo, correo: mail, registroId: reg._id, exito: `${LANDING()}/bienvenida.html?r=${reg._id}`, cancelar: `${LANDING()}/#planes` });
  await Registro.updateOne({ _id: reg._id }, { stripeSesion: s.id });
  return { url: s.url, registro: reg._id };
}

// Prueba gratis sin tarjeta: el negocio se crea al instante con el plan de prueba.
// Una sola prueba por correo (ya hay cuenta) y por celular.
async function iniciarPrueba(b) {
  const info = await infoPrueba();
  if (!info) throw new ErrorApi('La prueba gratis no está disponible en este momento', 409);
  const d = await validarRegistro(b);
  if (d.telefonoNorm.length < 7) throw new ErrorApi('Escribe tu celular: lo usamos para ayudarte durante la prueba');
  if (await Registro.exists({ tipo: 'prueba', telefonoNorm: d.telefonoNorm, estado: { $ne: 'error' } })) {
    throw new ErrorApi('Ese celular ya usó su prueba gratis. Elige un plan para continuar o escríbenos si necesitas más tiempo.', 409, 'PRUEBA_USADA');
  }
  const reg = await Registro.create({ ...d, tipo: 'prueba', plan: info.plan, periodo: 'mensual', expira: new Date(Date.now() + RESERVA_MIN * 60000) });
  await provisionar(reg._id).catch(() => null); // si falla queda en "error" para el equipo Katú
  return { registro: reg._id };
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
  return { estado: r.estado, negocio: r.negocio, correo: r.correo, prueba: r.tipo === 'prueba', ...(r.tipo === 'prueba' && { diasPrueba: prueba.DIAS() }), ...(r.estado === 'listo' && { url: `${empresas.urlEmpresa(r.subdominio)}/admin/` }) };
}

// ── Alta automática ────────────────────────────────────────────────────────
async function correoBienvenida(reg, empresa, usuario, token) {
  const url = empresas.urlEmpresa(empresa.slug), activar = `${url}/admin/activar.html?t=${token}`;
  const hasta = empresa.suscripcion?.pruebaHasta && fechaLarga(empresa.suscripcion.pruebaHasta, empresa.zonaHoraria);
  const nombrePlan = hasta ? (await Plan.findOne({ codigo: empresa.suscripcion.plan }).lean())?.nombre || empresa.suscripcion.plan : '';
  const notaPrueba = hasta ? `Tu prueba gratis de ${prueba.DIAS()} días con todo el plan ${nombrePlan} va hasta el ${hasta}. No necesitas tarjeta: elige tu plan cuando quieras desde "Mi suscripción".` : '';
  const texto = `Hola ${reg.nombre.split(' ')[0]}:\n\n¡Bienvenido a Katú POS! Tu negocio ${empresa.nombre} ya está listo.${notaPrueba ? `\n\n${notaPrueba}` : ''}\n\n1. Crea tu contraseña (el enlace vence en 72 horas):\n${activar}\n\n2. Tu panel: ${url}/admin/\n3. Tu caja: ${url}/pos/\n4. Tu tienda en línea: ${url}/\n\nTu usuario es ${usuario.correo}.\n\n— Equipo Katú POS`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif;color:#0B1729"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#05C3DD,#7C6CFF);padding:28px;color:#fff;font-size:24px;font-weight:bold">Katú POS</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.6"><p style="margin:0 0 14px">Hola ${reg.nombre.split(' ')[0].replace(/[<>&]/g, '')}:</p><p style="margin:0 0 14px">¡Bienvenido! <b>${empresa.nombre.replace(/[<>&]/g, '')}</b> ya está listo en <b>${url.replace(/^https?:\/\//, '')}</b>.</p>${notaPrueba ? `<p style="margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#E6F8FB">${notaPrueba}</p>` : ''}
<p style="margin:22px 0"><a href="${activar}" style="background:#0391A6;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:bold;display:inline-block">Crear mi contraseña</a></p>
<p style="margin:0 0 6px;color:#51637F;font-size:13px">El enlace vence en 72 horas. Tu usuario es ${usuario.correo}.</p>
<p style="margin:18px 0 0">Panel: <a href="${url}/admin/">${url}/admin/</a><br>Caja: <a href="${url}/pos/">${url}/pos/</a><br>Tienda en línea: <a href="${url}/">${url}/</a></p></td></tr></table></td></tr></table></body></html>`;
  const asunto = `¡${empresa.nombre} ya está en Katú POS!`;
  const plantilla = String(process.env.SENDGRID_TEMPLATE_BIENVENIDA || '').trim();
  // Con plantilla de SendGrid (se edita en su panel); sin ella, el diseño de aquí
  const envio = plantilla
    ? correo.enviarPlantilla({ a: usuario.correo, plantilla, nombreRemitente: 'Katú POS', etiquetas: { tipo: 'bienvenida', empresa: empresa._id },
        datos: { asunto, nombre: reg.nombre.split(' ')[0], negocio: empresa.nombre, dominio: url.replace(/^https?:\/\//, ''), usuario: usuario.correo, horas: 72,
          url_activar: activar, url_panel: `${url}/admin/`, url_caja: `${url}/pos/`, url_tienda: `${url}/`, anio: new Date().getFullYear(),
          prueba: !!notaPrueba, nota_prueba: notaPrueba, dias_prueba: prueba.DIAS(), prueba_hasta: hasta || '' } })
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
    const [plan, pais] = await Promise.all([Plan.findOne({ codigo: reg.plan }).lean(), paisPorCodigo(reg.pais).catch(() => null)]);
    // Si el subdominio se ocupó mientras pagaba, se busca uno libre
    let slug = reg.subdominio;
    for (let i = 2; await Empresa.exists({ slug }); i++) slug = `${reg.subdominio.slice(0, 36)}-${i}`;
    const esPrueba = reg.tipo === 'prueba';
    const { empresa, usuario } = await empresas.crearEmpresa({
      nombre: reg.negocio, slug, pais: reg.pais, correo: reg.correo, telefono: reg.telefono,
      // La facturación del plan solo se activa si Katú la ofrece en el país del negocio
      modulos: modulosDe(plan, pais),
      suscripcion: esPrueba
        ? { plan: reg.plan, periodo: reg.periodo, estado: 'prueba', pruebaHasta: new Date(Date.now() + prueba.DIAS() * 86400000), avisosPrueba: [] }
        : { plan: reg.plan, periodo: reg.periodo, estado: plan?.diasPrueba > 0 ? 'prueba' : 'activa', stripeCliente: cliente, stripeSuscripcion: suscripcion },
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
    // Pro y Premium incluyen el número de WhatsApp: se asigna solo (la prueba gratis no lo recibe)
    if (!esPrueba) await require('./whatsapp/numeros').asignarAlSuscribirse(empresa._id);
    return { ...reg, estado: 'listo', empresa: empresa._id, subdominio: slug };
  } catch (e) {
    console.error('[suscripcion.provisionar]', reg._id, e.message);
    await Registro.updateOne({ _id: reg._id }, { estado: 'error', error: String(e.message).slice(0, 300) });
    throw e;
  }
}

// ── Empresa que ya existe y se suscribe (fin de la prueba gratis) ──────────
async function checkoutEmpresa(empresa, b) {
  const e = await Empresa.findById(empresa._id).lean();
  if (e.suscripcion?.stripeSuscripcion && e.suscripcion.estado !== 'cancelada') throw new ErrorApi('Ya tienes una suscripción: cambia tu plan desde "Administrar pagos y plan"', 409);
  const plan = await Plan.findOne({ codigo: String(b.plan || ''), activo: true }).lean();
  if (!plan) throw new ErrorApi('Elige un plan');
  if (!stripe.disponible()) throw new ErrorApi('Los pagos no están disponibles en este momento', 503);
  const Usuario = require('../models/Usuario');
  const admin = await Usuario.findOne({ empresa: e._id, rol: 'admin', estado: true }).sort({ createdAt: 1 }).lean();
  const volver = `${empresas.volverA(b.origen, e.slug)}/admin/suscripcion.html`;
  const s = await stripe.crearCheckout({ plan, periodo: b.periodo === 'anual' ? 'anual' : 'mensual', correo: admin?.correo || e.correo, empresaId: e._id,
    exito: `${volver}?sesion={CHECKOUT_SESSION_ID}`, cancelar: volver });
  return { url: s.url };
}

// Idempotente: lo llaman el webhook y la vuelta desde Stripe (lo que llegue primero)
async function activarEmpresa(empresaId, { plan: codigo, periodo, cliente, suscripcion }) {
  const e = await Empresa.findById(empresaId).lean();
  if (!e) return null;
  if (e.suscripcion?.stripeSuscripcion === suscripcion) return e;
  const [plan, pais] = await Promise.all([Plan.findOne({ codigo }).lean(), paisPorCodigo(e.pais).catch(() => null)]);
  if (!plan) throw new Error(`El plan ${codigo} no existe`);
  let fin = null, estado = 'activa';
  try {
    const s = await stripe.llamar('get', `/subscriptions/${encodeURIComponent(suscripcion)}`);
    fin = s.current_period_end || s.items?.data?.[0]?.current_period_end;
    estado = { active: 'activa', trialing: 'prueba', past_due: 'mora', unpaid: 'mora' }[s.status] || 'activa';
  } catch (x) { console.error('[suscripcion.activar]', x.message); }
  await Empresa.updateOne({ _id: e._id }, {
    $set: { estado: true, modulos: modulosDe(plan, pais), 'suscripcion.plan': plan.codigo, 'suscripcion.periodo': periodo === 'anual' ? 'anual' : 'mensual', 'suscripcion.estado': estado,
      'suscripcion.stripeCliente': cliente, 'suscripcion.stripeSuscripcion': suscripcion, ...(fin && { 'suscripcion.actualHasta': new Date(fin * 1000) }) },
    $unset: { 'suscripcion.pruebaHasta': 1, 'suscripcion.avisosPrueba': 1, 'suscripcion.moraDesde': 1 },
  });
  console.log(`[suscripcion] ${e.slug} se suscribió al plan ${plan.codigo} (${periodo})`);
  await require('./whatsapp/numeros').asignarAlSuscribirse(e._id);
  return Empresa.findById(e._id).lean();
}
const activarDesdeSesion = (s, empresaId = s.metadata?.empresa) => activarEmpresa(empresaId, { plan: s.metadata?.plan, periodo: s.metadata?.periodo, cliente: s.customer, suscripcion: s.subscription });

// Al volver de Stripe: no espera al webhook para desbloquear la cuenta
async function confirmarPago(empresa, sesionId) {
  if (!/^cs_[\w]+$/.test(String(sesionId || ''))) throw new ErrorApi('Sesión de pago inválida');
  const s = await stripe.sesion(sesionId);
  if (String(s.metadata?.empresa) !== String(empresa._id)) throw new ErrorApi('Ese pago no corresponde a tu negocio', 403);
  if (s.status !== 'complete' || s.mode !== 'subscription') return { activa: false };
  await activarDesdeSesion(s, empresa._id);
  return { activa: true };
}

// ── Recordatorios y fin de la prueba gratis (job cada hora) ────────────────
const AVISOS = {
  d5: (n, dias) => ({ asunto: `Te quedan ${dias} días de prueba en Katú POS`, titulo: `Te quedan ${dias} días de prueba`, cuerpo: `Esperamos que ${n} esté vendiendo con Katú POS. Elige tu plan antes de que termine la prueba y sigue sin interrupciones: tus productos, clientes y ventas se quedan tal cual.` }),
  d1: n => ({ asunto: 'Mañana termina tu prueba de Katú POS', titulo: 'Mañana termina tu prueba', cuerpo: `Para que la caja y la tienda en línea de ${n} sigan funcionando, elige tu plan hoy. Toma un minuto y pagas de forma segura con tarjeta.` }),
  fin: n => ({ asunto: 'Tu prueba de Katú POS terminó: tus datos te esperan', titulo: 'Tu prueba terminó', cuerpo: `La caja y la tienda en línea de ${n} quedaron en pausa. No perdiste nada: tus productos, clientes y ventas siguen guardados. Elige tu plan y todo vuelve a funcionar al instante.` }),
};
async function correoPrueba(e, tipo) {
  const Usuario = require('../models/Usuario');
  const admin = await Usuario.findOne({ empresa: e._id, rol: 'admin', estado: true }).sort({ createdAt: 1 }).lean();
  if (!admin) return false;
  const url = `${empresas.urlEmpresa(e.slug)}/admin/suscripcion.html`;
  const a = AVISOS[tipo](e.nombre, prueba.diasRestantes(e));
  const hasta = fechaLarga(e.suscripcion.pruebaHasta, e.zonaHoraria);
  const texto = `Hola ${admin.nombre.split(' ')[0]}:\n\n${a.cuerpo}\n\n${tipo === 'fin' ? 'Terminó' : 'Termina'} el ${hasta}.\n\nElegir mi plan: ${url}\n\n— Equipo Katú POS`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif;color:#0B1729"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#05C3DD,#7C6CFF);padding:28px;color:#fff;font-size:24px;font-weight:bold">Katú POS</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.6"><h1 style="margin:0 0 14px;font-size:22px">${limpio(a.titulo)}</h1><p style="margin:0 0 14px">Hola ${limpio(admin.nombre.split(' ')[0])}:</p><p style="margin:0 0 14px">${limpio(a.cuerpo)}</p><p style="margin:0 0 6px;color:#51637F;font-size:13px">${tipo === 'fin' ? 'Terminó' : 'Termina'} el ${limpio(hasta)}.</p>
<p style="margin:22px 0"><a href="${url}" style="background:#0391A6;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:bold;display:inline-block">Elegir mi plan</a></p></td></tr></table></td></tr></table></body></html>`;
  try {
    await correo.enviar({ a: admin.correo, asunto: a.asunto, html, texto, nombreRemitente: 'Katú POS' });
    return true;
  } catch (x) { console.error(`[correo] aviso de prueba ${tipo} NO enviado a ${admin.correo}: ${x.message}`); return false; }
}
async function revisarPruebas(ahora = Date.now()) {
  const lista = await Empresa.find({ 'suscripcion.estado': { $in: ['prueba', 'vencida'] }, 'suscripcion.pruebaHasta': { $exists: true }, 'suscripcion.stripeSuscripcion': { $in: [null, ''] } }).lean();
  let enviados = 0;
  for (const e of lista) {
    if (!prueba.enPrueba(e)) continue;
    const ya = e.suscripcion.avisosPrueba || [], dias = prueba.diasRestantes(e, ahora);
    const tipo = prueba.pruebaVencida(e, ahora) ? 'fin' : dias <= 1 ? 'd1' : dias <= 5 ? 'd5' : null;
    if (tipo === 'fin' && e.suscripcion.estado !== 'vencida') await Empresa.updateOne({ _id: e._id }, { 'suscripcion.estado': 'vencida' });
    if (!tipo || ya.includes(tipo)) continue;
    // Se marca antes de enviar: con varios contenedores nunca sale dos veces
    const r = await Empresa.updateOne({ _id: e._id, 'suscripcion.avisosPrueba': { $ne: tipo } }, { $addToSet: { 'suscripcion.avisosPrueba': tipo } });
    if (r.modifiedCount && await correoPrueba(e, tipo)) enviados++;
  }
  return enviados;
}

// ── Eventos de Stripe ──────────────────────────────────────────────────────
const porSuscripcion = id => Empresa.findOne({ 'suscripcion.stripeSuscripcion': id });
async function procesarEvento(ev) {
  const o = ev.data?.object || {};
  switch (ev.type) {
    case 'checkout.session.completed': {
      // Pago único de una bolsa de mensajes de marketing
      if (o.mode === 'payment' && o.metadata?.tipo === 'bolsa') { await require('./bolsas').acreditarDesdeSesion(o); break; }
      if (o.mode !== 'subscription') break;
      if (o.metadata?.empresa) { await activarDesdeSesion(o); break; }
      const id = o.metadata?.registro || o.client_reference_id;
      if (id) await provisionar(id, { cliente: o.customer, suscripcion: o.subscription });
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

module.exports = { reenviarBienvenida, PLANES_EJEMPLO, MODULOS, sembrarPlanes, planesActivos, planPublico, paisesRegistro, ofreceFacturacion, subdominioDisponible, iniciar, iniciarPrueba, infoPrueba, checkoutEmpresa, activarEmpresa, confirmarPago, revisarPruebas, estadoRegistro, provisionar, procesarEvento, suspenderVencidas, portal, DIAS_GRACIA };
