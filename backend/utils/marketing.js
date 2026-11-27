const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Cliente = require('../models/Cliente');
const Campana = require('../models/Campana');
const EnvioCampana = require('../models/EnvioCampana');
const Venta = require('../models/Venta');
const gamificacion = require('./gamificacion');
const correo = require('./correo/sendgrid');
const { ErrorApi, paisDe, ahoraDe } = require('./contexto');
const diseno = require('./correoDiseno');
const Motor = require('../../frontend/assets/js/motor');

// ── Marketing: segmentos, campañas, bajas y atribución ─────────────────────
// Solo se escribe a quien autorizó ESE canal (Cliente.marketing.whatsapp /
// .correo). Cada mensaje consume 1 de la bolsa del comercio y, sin saldo, la
// campaña se pausa (nunca queda en negativo, a diferencia de los avisos).
const LOTE = 40;                 // mensajes por campaña en cada pasada del job
const DIAS_ATRIBUCION = 7;       // ventas que se atribuyen a la campaña
const SEGMENTOS = ['todos', 'recientes', 'inactivos', 'frecuentes', 'cumpleanos', 'nivel'];
const base = () => String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const primerNombre = n => String(n || '').trim().split(/\s+/)[0] || '';

// ── Segmentos ──────────────────────────────────────────────────────────────
function filtro(empresa, canal, seg = {}) {
  const f = { empresa: empresa._id, activo: true, [`marketing.${canal}`]: true, ...(canal === 'whatsapp' ? { telefono: { $regex: /\d{7,}/ } } : { correo: { $regex: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ } }) };
  const dias = Math.max(1, Math.min(3650, Number(seg.dias) || 30)), hace = new Date(Date.now() - dias * 86400000);
  if (seg.tipo === 'recientes') f.ultimaCompra = { $gte: hace };
  else if (seg.tipo === 'inactivos') f.$or = [{ ultimaCompra: { $lt: hace } }, { ultimaCompra: null }];
  else if (seg.tipo === 'frecuentes') f.compras = { $gte: Math.max(1, Number(seg.compras) || 5) };
  else if (seg.tipo === 'cumpleanos') f.cumple = { $regex: new RegExp('^' + ahoraDe(empresa).fecha.slice(5, 7) + '-') };
  return f;
}
async function destinatarios(empresa, canal, seg = {}) {
  if (!SEGMENTOS.includes(seg.tipo || 'todos')) throw new ErrorApi('Segmento no válido');
  const l = await Cliente.find(filtro(empresa, canal, seg)).select('nombre telefono correo xp').limit(20000).lean();
  return seg.tipo === 'nivel' ? l.filter(c => gamificacion.nivelDe(empresa, c.xp).actual?.nombre === seg.nivel) : l;
}

// ── Bajas ──────────────────────────────────────────────────────────────────
const firma = (clienteId, canal) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'katu').update(`${clienteId}:${canal}:baja`).digest('hex').slice(0, 32);
const enlaceBaja = clienteId => `${base()}/api/v1/marketing/baja?c=${clienteId}&f=${firma(clienteId, 'correo')}`;
async function bajaCorreo(clienteId, f) {
  if (!/^[a-f\d]{24}$/i.test(String(clienteId)) || !f || f.length !== 32) return null;
  const a = Buffer.from(firma(clienteId, 'correo')), b = Buffer.from(String(f));
  if (!crypto.timingSafeEqual(a, b)) return null;
  const c = await Cliente.findByIdAndUpdate(clienteId, { 'marketing.correo': false, 'marketing.actualizado': new Date(), 'marketing.origen': 'baja_correo' }, { new: true }).select('empresa').lean();
  return c ? Empresa.findById(c.empresa).select('nombre').lean() : null;
}
const PALABRA_BAJA = /^\s*(baja|stop|cancelar|darme de baja|no m[aá]s promociones|no quiero m[aá]s)\s*[.!]*\s*$/i;
async function bajaWhatsapp(empresa, telefonos) {
  const r = await Cliente.updateMany({ empresa: empresa._id, telefono: { $in: telefonos } }, { 'marketing.whatsapp': false, 'marketing.actualizado': new Date(), 'marketing.origen': 'baja_whatsapp' });
  return r.modifiedCount;
}

// ── Correo con la marca del comercio ───────────────────────────────────────
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const personalizar = (t, cliente) => String(t || '').replace(/\{nombre\}/gi, primerNombre(cliente?.nombre) || 'cliente');
// ctx: { productos: Map id → producto con precio del día, dinero } (lo arma prepararCorreo una vez por campaña)
function armarCorreo(empresa, campana, cliente, ctx = {}) {
  const { asunto, cuerpo } = campana;
  const color = diseno.colorValido(campana.colorCorreo, diseno.colorValido(empresa.color, '#05C3DD'));
  if (campana.formato === 'diseno' || campana.formato === 'html') {
    const baja = cliente?._id ? enlaceBaja(cliente._id) : '#', nombre = primerNombre(cliente?.nombre) || 'cliente';
    const html = campana.formato === 'html'
      ? diseno.htmlPropio(empresa, campana.html, { baja, nombre })
      : diseno.envolver(empresa, diseno.htmlBloques(campana.bloques || [], { color, nombre, productos: ctx.productos || new Map(), dinero: ctx.dinero }), { baja, color, preheader: personalizar(campana.preheader, cliente) });
    return { asunto: personalizar(asunto, cliente).slice(0, 150), html, texto: `${diseno.aTexto(html)}\n\nPara no recibir más correos: ${baja}`, baja };
  }
  const texto = personalizar(cuerpo, cliente);
  const parrafos = texto.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.6">${escHtml(p).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`).join('');
  const baja = cliente?._id ? enlaceBaja(cliente._id) : '#';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F1F5FA;font-family:Arial,Helvetica,sans-serif;color:#0B1729">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5FA;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${color};padding:22px 28px;color:#fff;font-size:20px;font-weight:bold">${empresa.logoUrl ? `<img src="${escHtml(empresa.logoUrl)}" alt="${escHtml(empresa.nombre)}" height="40" style="display:block;max-height:40px">` : escHtml(empresa.nombre)}</td></tr>
<tr><td style="padding:28px;font-size:15px">${parrafos}</td></tr>
<tr><td style="padding:18px 28px;background:#F7FAFD;font-size:12px;color:#51637F;line-height:1.5">${escHtml(empresa.nombre)}${empresa.direccion ? ' · ' + escHtml(empresa.direccion) : ''}${empresa.ciudad ? ', ' + escHtml(empresa.ciudad) : ''}<br>Recibes este correo porque autorizaste recibir promociones de ${escHtml(empresa.nombre)}. <a href="${escHtml(baja)}" style="color:#51637F">Darme de baja</a></td></tr>
</table></td></tr></table></body></html>`;
  return { asunto: personalizar(asunto, cliente).slice(0, 150), html, texto: `${texto}\n\n—\n${empresa.nombre}\nPara no recibir más correos: ${baja}`, baja };
}

// Productos de los bloques: nombre, foto, precio (y precio antes si están en la promoción del día)
async function prepararCorreo(empresa, campana) {
  const pais = await paisDe(empresa);
  const dinero = n => Motor.dinero(n, pais);
  const ids = [...new Set((campana.bloques || []).filter(b => b.tipo === 'productos').flatMap(b => b.productos || []))];
  const productos = new Map();
  if (ids.length) {
    const tienda = require('./empresas').urlEmpresa(empresa.slug);
    const promo = new Map((campana.promo?.items || []).map(i => [String(i.producto), i]));
    for (const p of await require('../models/Producto').find({ _id: { $in: ids }, empresa: empresa._id }).select('nombre imagenUrl precio').lean()) {
      const pr = promo.get(String(p._id));
      productos.set(String(p._id), { nombre: p.nombre, imagenUrl: p.imagenUrl, precio: pr ? pr.precio : p.precio, precioAntes: pr ? pr.precioAntes : null, enlace: tienda });
    }
  }
  return { productos, dinero };
}

// Límite de marketing por cliente: N por canal en 7 días y una promoción del día por día
async function omitirPorLimite(empresa, campana, clienteId) {
  const limite = empresa.marketing?.limiteSemanal ?? 2;
  const base = { cliente: clienteId, canal: campana.canal, estado: { $in: ['enviado', 'entregado', 'leido'] } };
  if (campana.tipo === 'promo_dia' && await EnvioCampana.exists({ ...base, tipo: 'promo_dia', enviadoEn: { $gte: new Date(Date.now() - 20 * 3600000) } })) return 'Ya recibió la promoción del día';
  if (limite > 0 && await EnvioCampana.countDocuments({ ...base, enviadoEn: { $gte: new Date(Date.now() - 7 * 86400000) } }) >= limite) return `Límite de ${limite} mensajes por semana`;
  return null;
}

// ── Envío de un destinatario ───────────────────────────────────────────────
async function enviarUno(empresa, campana, cliente, ctx) {
  if (campana.canal === 'whatsapp') {
    const wa = require('./whatsapp');
    const pais = await paisDe(empresa);
    const telefono = wa.aE164(pais, cliente.telefono);
    // {{1}} = nombre del cliente; {{2}}, {{3}}… = variables de la campaña (p. ej. la oferta del día)
    const variables = { ...(campana.variables || {}), 1: primerNombre(cliente.nombre) || 'cliente' };
    const texto = String(campana.cuerpo || '').replace(/\{\{(\d+)\}\}/g, (m, n) => variables[n] ?? m);
    const m = await wa.enviarPlantilla({ empresa, telefono, plantilla: campana.plantilla, variables, texto, tipo: 'marketing', referencia: campana.nombre });
    return { destino: telefono, sid: m.sid, estado: m.estado === 'entregado' ? 'entregado' : 'enviado' }; // el simulador entrega al instante
  }
  const wa = require('./whatsapp');
  await wa.consumir(empresa._id, { canal: 'correo', motivo: 'Campaña', referencia: campana.nombre });
  const c = armarCorreo(empresa, campana, cliente, ctx || (campana.formato === 'diseno' ? await prepararCorreo(empresa, campana) : {}));
  const r = await correo.enviar({ a: cliente.correo, asunto: c.asunto, html: c.html, texto: c.texto, nombreRemitente: empresa.nombre, responderA: empresa.correo || undefined, baja: c.baja, datos: { campana: campana._id } });
  return { destino: cliente.correo, sid: r.id || undefined };
}

// Lo que impide enviar una campaña ahora (null = se puede)
function bloqueo(empresa, campana) {
  if (!empresa.modulos?.marketing) return 'El módulo de marketing no está activo';
  if (campana.canal === 'whatsapp') {
    if (!require('./whatsapp').listo(empresa)) return 'El WhatsApp de la empresa no está activo';
    if (!(empresa.whatsapp?.plantillasMarketing || []).some(p => p.contentSid === campana.plantilla && p.estado === 'aprobada')) return 'La plantilla no está aprobada por Meta';
    if ((empresa.mensajeria?.saldoWhatsapp || 0) <= 0) return 'Bolsa de WhatsApp agotada';
  } else {
    if (!correo.disponible()) return 'El correo no está configurado en el servidor';
    if ((empresa.mensajeria?.saldoCorreo || 0) <= 0) return 'Bolsa de correos agotada';
  }
  return null;
}

// ── Job: arranca las programadas y envía por lotes ─────────────────────────
let ocupado = false;
async function procesar() {
  if (ocupado) return; ocupado = true;
  try {
    const vencidas = await Campana.find({ estado: 'programada', programadaPara: { $lte: new Date() } }).limit(10).lean();
    for (const c of vencidas) {
      const tomada = await Campana.findOneAndUpdate({ _id: c._id, estado: 'programada' }, { estado: 'enviando', iniciadaEn: new Date() }, { new: true }).lean();
      if (!tomada) continue;
      const empresa = await Empresa.findById(c.empresa).lean();
      const lista = await destinatarios(empresa, c.canal, c.segmento);
      if (lista.length) await EnvioCampana.insertMany(lista.map(x => ({ empresa: c.empresa, campana: c._id, cliente: x._id, canal: c.canal, tipo: c.tipo || 'normal' })), { ordered: false }).catch(e => { if (e.code !== 11000 && !e.writeErrors) throw e; });
      await Campana.updateOne({ _id: c._id }, { 'totales.destinatarios': await EnvioCampana.countDocuments({ campana: c._id }) });
    }
    const activas = await Campana.find({ estado: 'enviando' }).limit(10).lean();
    for (const c of activas) {
      const empresa = await Empresa.findById(c.empresa).lean();
      const b = bloqueo(empresa, c);
      if (b) { await Campana.updateOne({ _id: c._id, estado: 'enviando' }, { estado: 'pausada', motivoPausa: b }); continue; }
      const pendientes = await EnvioCampana.find({ campana: c._id, estado: 'pendiente' }).populate('cliente', 'nombre telefono correo marketing activo').limit(LOTE).lean();
      if (!pendientes.length) { await Campana.updateOne({ _id: c._id, estado: 'enviando' }, { estado: 'enviada', terminadaEn: new Date() }); continue; }
      const ctx = c.canal === 'correo' && c.formato === 'diseno' ? await prepararCorreo(empresa, c) : undefined;
      for (const e of pendientes) {
        // Se revisa la autorización justo antes de enviar: pudo darse de baja
        if (!e.cliente?.activo || !e.cliente?.marketing?.[c.canal]) { await EnvioCampana.updateOne({ _id: e._id }, { estado: 'omitido', motivo: 'Se dio de baja' }); await Campana.updateOne({ _id: c._id }, { $inc: { 'totales.omitidos': 1 } }); continue; }
        // No saturar al cliente: límite semanal por canal y una promoción del día por día
        const limite = await omitirPorLimite(empresa, c, e.cliente._id);
        if (limite) { await EnvioCampana.updateOne({ _id: e._id }, { estado: 'omitido', motivo: limite }); await Campana.updateOne({ _id: c._id }, { $inc: { 'totales.omitidos': 1 } }); continue; }
        try {
          const r = await enviarUno(empresa, c, e.cliente, ctx);
          await EnvioCampana.updateOne({ _id: e._id }, { estado: r.estado || 'enviado', destino: r.destino, sid: r.sid, enviadoEn: new Date() });
          await Campana.updateOne({ _id: c._id }, { $inc: { 'totales.enviados': 1 } });
        } catch (err) {
          if (err.codigo === 'SIN_SALDO') { await Campana.updateOne({ _id: c._id, estado: 'enviando' }, { estado: 'pausada', motivoPausa: 'Bolsa agotada: recarga para continuar' }); break; }
          await EnvioCampana.updateOne({ _id: e._id }, { estado: 'fallido', error: String(err.message).slice(0, 300) });
          await Campana.updateOne({ _id: c._id }, { $inc: { 'totales.fallidos': 1 } });
        }
      }
    }
  } catch (e) { console.error('[marketing.procesar]', e.message); }
  finally { ocupado = false; }
}

// Estado de entrega de WhatsApp (llega por el webhook de estados)
const ORDEN = { pendiente: 0, enviado: 1, entregado: 2, leido: 3 };
async function estadoEnvio(sid, estado) {
  if (!sid || !['entregado', 'leido', 'fallido'].includes(estado)) return;
  const e = await EnvioCampana.findOne({ sid }).select('estado campana').lean();
  if (!e || e.estado === 'fallido' || (estado !== 'fallido' && ORDEN[estado] <= ORDEN[e.estado])) return;
  await EnvioCampana.updateOne({ _id: e._id }, { estado });
}

// Ventas de los destinatarios dentro de los días siguientes a su envío
async function atribucion(campana) {
  const env = await EnvioCampana.find({ campana: campana._id, enviadoEn: { $ne: null } }).select('cliente enviadoEn').lean();
  if (!env.length) return { ventas: 0, compradores: 0, total: 0, dias: DIAS_ATRIBUCION };
  const por = new Map(env.map(e => [String(e.cliente), new Date(e.enviadoEn).getTime()]));
  const min = Math.min(...por.values()), max = Math.max(...por.values()) + DIAS_ATRIBUCION * 86400000;
  const vs = await Venta.find({ empresa: campana.empresa, cliente: { $in: env.map(e => e.cliente) }, fecha: { $gte: new Date(min), $lte: new Date(max) }, estado: { $ne: 'anulada' } }).select('cliente fecha total').lean();
  const ok = vs.filter(v => { const t = new Date(v.fecha).getTime(), d = por.get(String(v.cliente)); return t >= d && t <= d + DIAS_ATRIBUCION * 86400000; });
  return { ventas: ok.length, compradores: new Set(ok.map(v => String(v.cliente))).size, total: ok.reduce((a, v) => a + (v.total || 0), 0), dias: DIAS_ATRIBUCION };
}

module.exports = { SEGMENTOS, destinatarios, armarCorreo, prepararCorreo, omitirPorLimite, enviarUno, bloqueo, procesar, estadoEnvio, atribucion, bajaCorreo, bajaWhatsapp, PALABRA_BAJA, enlaceBaja, personalizar };
