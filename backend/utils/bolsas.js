const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const CompraBolsa = require('../models/CompraBolsa');
const stripe = require('./pagos/stripe');
const correo = require('./correo/sendgrid');
const empresas = require('./empresas');
const { ErrorApi, paisDe } = require('./contexto');

// ── Compra de bolsas de mensajes de marketing ──────────────────────────────
// Katú define por país los paquetes (múltiplos de 1.000) y su precio en
// Admin → Países. El comercio elige uno, paga con Stripe (pago único) y el
// saldo se suma solo: por el webhook o al volver de Stripe, una sola vez.
const NOMBRE = { whatsapp: 'mensajes de WhatsApp', correo: 'correos' };
const miles = n => Number(n).toLocaleString('es-CO');
const formatoMoneda = (n, moneda) => `${moneda === 'USD' ? 'US$' : '$'}${Number(n).toLocaleString(moneda === 'COP' ? 'es-CO' : 'en-US', { maximumFractionDigits: 2 })} ${moneda}`;

// Validación de los paquetes que guarda Katú en el país
function validarPaquetes(b) {
  if (!b) return;
  if (b.moneda) { try { new Intl.NumberFormat('es', { style: 'currency', currency: b.moneda }); } catch { throw new ErrorApi('Moneda de las bolsas inválida (ISO 4217)'); } }
  for (const p of b.paquetes || []) {
    if (!['whatsapp', 'correo'].includes(p.canal)) throw new ErrorApi('Cada paquete es de WhatsApp o de correo');
    if (!Number.isInteger(Number(p.cantidad)) || Number(p.cantidad) <= 0 || Number(p.cantidad) % 1000 !== 0 || Number(p.cantidad) > 1000000) throw new ErrorApi('Las cantidades de los paquetes son múltiplos de 1.000 (máximo 1.000.000)');
    if (!(Number(p.precio) > 0)) throw new ErrorApi('Cada paquete necesita un precio mayor que 0');
  }
  const claves = (b.paquetes || []).map(p => `${p.canal}-${p.cantidad}`);
  if (new Set(claves).size !== claves.length) throw new ErrorApi('Hay paquetes repetidos (mismo canal y cantidad)');
}

async function catalogo(empresa) {
  const pais = await paisDe(empresa);
  const moneda = pais.bolsas?.moneda || 'USD';
  const paquetes = (pais.bolsas?.paquetes || []).map(p => ({ canal: p.canal, cantidad: p.cantidad, precio: p.precio, moneda, porMensaje: Math.round(p.precio / p.cantidad * 10000) / 10000 })).sort((a, b) => a.canal.localeCompare(b.canal) || a.cantidad - b.cantidad);
  const [e, compras] = await Promise.all([
    Empresa.findById(empresa._id).select('mensajeria').lean(),
    CompraBolsa.find({ empresa: empresa._id }).sort({ createdAt: -1 }).limit(20).populate('usuario', 'nombre').lean(),
  ]);
  return { paquetes, moneda, pagosDisponibles: stripe.disponible(), modoPrueba: stripe.modoPrueba(), saldo: { whatsapp: e.mensajeria?.saldoWhatsapp || 0, correo: e.mensajeria?.saldoCorreo || 0 }, compras };
}

async function comprar(empresa, usuario, { canal, cantidad }) {
  const pais = await paisDe(empresa);
  const p = (pais.bolsas?.paquetes || []).find(x => x.canal === canal && x.cantidad === Number(cantidad));
  if (!p) throw new ErrorApi('Ese paquete no está disponible en tu país', 404);
  if (!stripe.disponible()) throw new ErrorApi('Los pagos no están disponibles en este momento', 503);
  const e = await Empresa.findById(empresa._id).lean();
  const admin = await Usuario.findById(usuario).select('correo').lean();
  const moneda = pais.bolsas?.moneda || 'USD';
  const compra = await CompraBolsa.create({ empresa: e._id, canal, cantidad: p.cantidad, precio: p.precio, moneda, usuario });
  const volver = `${empresas.urlEmpresa(e.slug)}/admin/whatsapp-config.html`;
  const s = await stripe.crearPago({
    nombre: `Katú POS · ${miles(p.cantidad)} ${NOMBRE[canal]} para marketing`, monto: p.precio, moneda,
    correo: admin?.correo || e.correo, cliente: e.suscripcion?.stripeCliente, referencia: compra._id,
    metadata: { tipo: 'bolsa', compra: String(compra._id), empresa: String(e._id), canal, cantidad: String(p.cantidad) },
    exito: `${volver}?compra={CHECKOUT_SESSION_ID}`, cancelar: volver,
  });
  await CompraBolsa.updateOne({ _id: compra._id }, { stripeSesion: s.id });
  return { url: s.url, compra: compra._id };
}

// Idempotente: la suma al saldo pasa una sola vez aunque lleguen webhook y vuelta a la vez
async function acreditar(compraId, { pago } = {}) {
  const c = await CompraBolsa.findOneAndUpdate({ _id: compraId, estado: 'pendiente' }, { estado: 'pagada', pagadaEn: new Date(), ...(pago && { stripePago: pago }) }, { new: true }).lean();
  if (!c) return CompraBolsa.findById(compraId).lean();
  const wa = require('./whatsapp');
  await wa.recargar(c.empresa, { [c.canal]: c.cantidad, motivo: `Compra de ${miles(c.cantidad)} ${NOMBRE[c.canal]} (${formatoMoneda(c.precio, c.moneda)})`, usuario: c.usuario });
  await correoCompra(c).catch(x => console.error('[correo] compra de bolsa', x.message));
  console.log(`[bolsas] ${c.empresa} compró ${c.cantidad} ${c.canal}`);
  return { ...c, estado: 'pagada' };
}
async function acreditarDesdeSesion(s) {
  if (s?.metadata?.tipo !== 'bolsa' || s.payment_status !== 'paid' || !/^[a-f\d]{24}$/i.test(String(s.metadata.compra || ''))) return null;
  return acreditar(s.metadata.compra, { pago: s.payment_intent });
}
// Al volver de Stripe: no espera al webhook
async function confirmar(empresa, sesionId) {
  if (!/^cs_[\w]+$/.test(String(sesionId || ''))) throw new ErrorApi('Sesión de pago inválida');
  const s = await stripe.sesion(sesionId);
  if (String(s.metadata?.empresa) !== String(empresa._id) || s.metadata?.tipo !== 'bolsa') throw new ErrorApi('Ese pago no corresponde a tu negocio', 403);
  const c = await acreditarDesdeSesion(s);
  return { pagada: c?.estado === 'pagada', canal: s.metadata.canal, cantidad: Number(s.metadata.cantidad) };
}

async function correoCompra(c) {
  const e = await Empresa.findById(c.empresa).lean();
  const u = c.usuario ? await Usuario.findById(c.usuario).select('nombre correo').lean() : await Usuario.findOne({ empresa: e._id, rol: 'admin', estado: true }).lean();
  if (!u?.correo) return;
  const saldo = c.canal === 'whatsapp' ? e.mensajeria?.saldoWhatsapp : e.mensajeria?.saldoCorreo;
  const texto = `Hola ${u.nombre.split(' ')[0]}:\n\nRecibimos tu pago de ${formatoMoneda(c.precio, c.moneda)} y sumamos ${miles(c.cantidad)} ${NOMBRE[c.canal]} a la bolsa de ${e.nombre}.\nSaldo disponible: ${miles(saldo || 0)}.\n\nYa puedes enviar tus campañas desde Marketing.\n\n— Equipo Katú POS`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0B1729;max-width:560px">${texto.split('\n').map(l => `<p style="margin:0 0 8px">${l.replace(/[<>&]/g, x => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[x])) || '&nbsp;'}</p>`).join('')}</div>`;
  await correo.enviar({ a: u.correo, asunto: `Recarga confirmada: ${miles(c.cantidad)} ${NOMBRE[c.canal]}`, html, texto, nombreRemitente: 'Katú POS' });
}

module.exports = { validarPaquetes, catalogo, comprar, acreditar, acreditarDesdeSesion, confirmar };
