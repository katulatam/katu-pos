const Empresa = require('../models/Empresa');
const Cliente = require('../models/Cliente');
const Campana = require('../models/Campana');
const EnvioCampana = require('../models/EnvioCampana');
const mk = require('../utils/marketing');
const promo = require('../utils/promoDia');
const plantillasWa = require('../utils/plantillasWa');
const diseno = require('../utils/correoDiseno');
const wa = require('../utils/whatsapp');
const correo = require('../utils/correo/sendgrid');
const { manejar, ErrorApi } = require('../utils/contexto');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Público: enlace de baja de los correos (página simple, sin sesión)
exports.baja = async (req, res) => {
  const e = await mk.bajaCorreo(req.query.c, req.query.f).catch(() => null);
  res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de promociones</title></head><body style="font-family:Arial,sans-serif;background:#F1F5FA;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;padding:36px 30px;border-radius:16px;max-width:420px;text-align:center;line-height:1.6">${e ? `<h2 style="margin:0 0 10px">Listo</h2><p>Ya no recibirás correos de promociones de <b>${esc(e.nombre)}</b>.</p>` : '<h2 style="margin:0 0 10px">Enlace no válido</h2><p>No pudimos procesar la baja. Escríbele directamente al comercio.</p>'}</div></body></html>`);
};
// Algunos clientes de correo hacen la baja de un clic con POST
exports.bajaPost = async (req, res) => { await mk.bajaCorreo(req.query.c, req.query.f).catch(() => null); res.status(200).end(); };

const vistaCampana = c => ({ ...c, cuerpo: c.cuerpo, programadaPara: c.programadaPara });

exports.resumen = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const f = { empresa: e._id, activo: true };
  const [total, conWhatsapp, conCorreo] = await Promise.all([Cliente.countDocuments(f), Cliente.countDocuments({ ...f, 'marketing.whatsapp': true }), Cliente.countDocuments({ ...f, 'marketing.correo': true })]);
  return {
    clientes: { total, whatsapp: conWhatsapp, correo: conCorreo },
    saldo: { whatsapp: e.mensajeria?.saldoWhatsapp || 0, correo: e.mensajeria?.saldoCorreo || 0 },
    whatsappListo: wa.listo(e), correoListo: correo.disponible(), simuladores: { whatsapp: wa.twilio.simulado(), correo: correo.simulado() },
    plantillas: (e.whatsapp?.plantillasMarketing || []).map(p => ({ _id: p._id, nombre: p.nombre, contentSid: p.contentSid, cuerpo: p.cuerpo, estado: p.estado, motivo: p.motivo, sistema: p.sistema || '' })),
    limiteSemanal: e.marketing?.limiteSemanal ?? 2, color: e.color || '', logoUrl: e.logoUrl || '', tienda: require('../utils/empresas').urlEmpresa(e.slug),
    niveles: (e.gamificacion?.niveles || []).map(n => n.nombre), segmentos: mk.SEGMENTOS,
  };
});

exports.segmento = manejar(async req => {
  const canal = req.body.canal === 'correo' ? 'correo' : 'whatsapp';
  return { total: (await mk.destinatarios(req.empresa, canal, req.body.segmento || {})).length };
});

// ── Plantillas de WhatsApp (aprobación de Meta) ────────────────────────────
exports.plantillas = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const ps = e.whatsapp?.plantillasMarketing || [];
  // Refresca las que siguen en revisión
  for (const p of ps.filter(x => x.estado === 'pendiente' && x.contentSid)) {
    try { const s = await wa.twilio.estadoPlantilla(e.whatsapp.subcuentaSid, p.contentSid); if (s.estado !== 'pendiente') await Empresa.updateOne({ _id: e._id, 'whatsapp.plantillasMarketing._id': p._id }, { 'whatsapp.plantillasMarketing.$.estado': s.estado, 'whatsapp.plantillasMarketing.$.motivo': s.motivo || '' }); }
    catch (err) { console.error('[marketing.plantilla]', err.message); }
  }
  return ((await Empresa.findById(e._id).select('whatsapp.plantillasMarketing').lean()).whatsapp?.plantillasMarketing || []);
});
exports.crearPlantilla = manejar(async (req, res) => {
  const e = await Empresa.findById(req.empresa._id).lean();
  if (!e.whatsapp?.subcuentaSid) throw new ErrorApi('Primero hay que activar el WhatsApp de la empresa');
  const nombre = String(req.body.nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  if (!nombre) throw new ErrorApi('Ponle un nombre interno a la plantilla');
  // Lo que Meta rechaza siempre no se envía (empezar o terminar con variable, acortadores…)
  const rv = plantillasWa.revisar(req.body.cuerpo, { negocio: e.nombre });
  if (rv.errores.length) throw new ErrorApi(rv.errores[0]);
  if ((e.whatsapp.plantillasMarketing || []).some(p => p.nombre === nombre)) throw new ErrorApi('Ya existe una plantilla con ese nombre', 409);
  const cuerpo = rv.cuerpo; // con {{1}} y la forma de darse de baja (la exigen Meta y la ley)
  const r = await wa.twilio.crearPlantilla(e.whatsapp.subcuentaSid, { nombre, cuerpo });
  const estado = wa.twilio.simulado() ? 'aprobada' : 'pendiente';
  await Empresa.updateOne({ _id: e._id }, { $push: { 'whatsapp.plantillasMarketing': { nombre, cuerpo, contentSid: r.contentSid, estado } } });
  res.status(201);
  return { nombre, cuerpo, contentSid: r.contentSid, estado };
});

// Ayuda para crear plantillas: ejemplos, recomendaciones y revisión en vivo
exports.ayudaPlantilla = manejar(async req => {
  const negocio = req.empresa.nombre;
  return { ejemplos: plantillasWa.EJEMPLOS.map(x => ({ ...x, texto: x.texto.replace(/\{negocio\}/g, negocio) })), recomendaciones: plantillasWa.RECOMENDACIONES, negocio };
});
exports.revisarPlantilla = manejar(async req => plantillasWa.revisar(req.body.cuerpo, { negocio: req.empresa.nombre }));

// ── Campañas ───────────────────────────────────────────────────────────────
exports.listar = manejar(async req => (await Campana.find({ empresa: req.empresa._id }).populate('creadaPor', 'nombre').sort({ createdAt: -1 }).limit(200).lean()).map(vistaCampana));

exports.detalle = manejar(async req => {
  const c = await Campana.findOne({ _id: req.params.id, empresa: req.empresa._id }).populate('creadaPor', 'nombre').lean();
  if (!c) throw new ErrorApi('La campaña no existe', 404);
  const porEstado = Object.fromEntries((await EnvioCampana.aggregate([{ $match: { campana: c._id } }, { $group: { _id: '$estado', n: { $sum: 1 } } }])).map(x => [x._id, x.n]));
  return { ...vistaCampana(c), porEstado, atribucion: await mk.atribucion(c) };
});

function datosCampana(req, e) {
  const b = req.body, canal = b.canal === 'correo' ? 'correo' : 'whatsapp';
  const d = { nombre: String(b.nombre || '').trim().slice(0, 100), canal, segmento: { tipo: mk.SEGMENTOS.includes(b.segmento?.tipo) ? b.segmento.tipo : 'todos', dias: Number(b.segmento?.dias) || undefined, compras: Number(b.segmento?.compras) || undefined, nivel: b.segmento?.nivel || undefined } };
  if (!d.nombre) throw new ErrorApi('Ponle un nombre a la campaña');
  if (canal === 'whatsapp') {
    // La plantilla de la promoción del día se usa desde su propia pantalla (lleva la oferta como variable)
    const p = (e.whatsapp?.plantillasMarketing || []).find(x => x.contentSid === b.plantilla && !x.sistema);
    if (!p) throw new ErrorApi('Elige una plantilla de WhatsApp');
    Object.assign(d, { plantilla: p.contentSid, plantillaNombre: p.nombre, cuerpo: p.cuerpo, asunto: undefined });
  } else Object.assign(d, datosCorreo(b));
  return d;
}
// Correo: texto simple, diseño con bloques o HTML propio
function datosCorreo(b) {
  const formato = ['texto', 'diseno', 'html'].includes(b.formato) ? b.formato : 'texto';
  const d = { formato, asunto: String(b.asunto || '').trim().slice(0, 150), preheader: String(b.preheader || '').trim().slice(0, 150), colorCorreo: diseno.colorValido(b.colorCorreo, undefined) };
  if (!d.asunto) throw new ErrorApi('Escribe el asunto del correo');
  if (formato === 'texto') { d.cuerpo = String(b.cuerpo || '').trim().slice(0, 5000); if (d.cuerpo.length < 10) throw new ErrorApi('Escribe el mensaje del correo'); }
  if (formato === 'diseno') { d.bloques = diseno.limpiarBloques(b.bloques); if (!d.bloques.length) throw new ErrorApi('Agrega al menos un bloque al diseño del correo'); d.cuerpo = diseno.aTexto(d.bloques.map(x => x.texto || '').join('\n')).slice(0, 5000); }
  if (formato === 'html') {
    try { d.html = diseno.limpiarHtml(b.html); } catch (x) { throw new ErrorApi(x.message); }
    if (d.html.replace(/<[^>]+>/g, '').trim().length < 10) throw new ErrorApi('Pega el HTML del correo');
    d.cuerpo = diseno.aTexto(d.html).slice(0, 5000);
  }
  return d;
}

// Vista previa del correo tal como llegará (con un cliente de ejemplo)
exports.vistaCorreo = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const d = datosCorreo({ asunto: 'Vista previa', ...req.body });
  const c = { ...d, promo: req.body.promo };
  const r = mk.armarCorreo(e, c, { nombre: 'Valentina' }, c.formato === 'diseno' ? await mk.prepararCorreo(e, c) : {});
  return { asunto: r.asunto, html: r.html };
});

// Productos para los bloques del correo y la promoción del día
exports.productos = manejar(async req => {
  const q = String(req.query.q || '').trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  return require('../models/Producto').find({ empresa: req.empresa._id, activo: true, ...(rx && { $or: [{ nombre: rx }, { codigo: rx }] }) }).select('nombre precio imagenUrl codigo').sort({ nombre: 1 }).limit(20).lean();
});

// ── Promoción del día ──────────────────────────────────────────────────────
exports.promoDia = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  // Refresca en Meta las que siguen en revisión (texto y con imagen)
  const refrescar = async p => {
    if (p?.estado !== 'pendiente' || !p.contentSid || !e.whatsapp?.subcuentaSid) return p;
    try {
      const s = await wa.twilio.estadoPlantilla(e.whatsapp.subcuentaSid, p.contentSid);
      if (s.estado !== 'pendiente') { await Empresa.updateOne({ _id: e._id, 'whatsapp.plantillasMarketing.contentSid': p.contentSid }, { 'whatsapp.plantillasMarketing.$.estado': s.estado, 'whatsapp.plantillasMarketing.$.motivo': s.motivo || '' }); return { ...p, ...s }; }
    } catch (x) { console.error('[marketing.promoDia]', x.message); }
    return p;
  };
  const [p, pi] = [await refrescar(promo.plantillaDe(e)), await refrescar(promo.plantillaDe(e, true))];
  const ultimas = await Campana.find({ empresa: e._id, tipo: 'promo_dia' }).sort({ createdAt: -1 }).limit(10).select('nombre canal estado programadaPara totales promo.texto').lean();
  return {
    plantilla: p && { estado: p.estado, motivo: p.motivo, cuerpo: p.cuerpo }, plantillaImagen: pi && { estado: pi.estado, motivo: pi.motivo },
    whatsappListo: wa.listo(e), correoListo: correo.disponible(),
    limiteSemanal: e.marketing?.limiteSemanal ?? 2, saldo: { whatsapp: e.mensajeria?.saldoWhatsapp || 0, correo: e.mensajeria?.saldoCorreo || 0 }, ultimas,
  };
});
exports.promoPlantilla = manejar(async (req, res) => { res.status(201); return promo.asegurarPlantilla(req.empresa._id, { imagen: !!req.body?.imagen }); });
exports.promoVista = manejar(req => promo.vista(req.empresa, req.body));
exports.promoCrear = manejar(async (req, res) => { res.status(201); return promo.crear(req.empresa, req.usuario._id, req.body); });

// Límite de mensajes de marketing por cliente y canal a la semana (0 = sin límite)
exports.config = manejar(async req => {
  const n = Number(req.body.limiteSemanal);
  if (!Number.isInteger(n) || n < 0 || n > 14) throw new ErrorApi('El límite va de 0 (sin límite) a 14 mensajes por semana');
  await Empresa.updateOne({ _id: req.empresa._id }, { 'marketing.limiteSemanal': n });
  return { limiteSemanal: n };
});
exports.crear = manejar(async (req, res) => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const c = await Campana.create({ ...datosCampana(req, e), empresa: e._id, creadaPor: req.usuario._id });
  res.status(201);
  return c.toObject();
});
exports.actualizar = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const c = await Campana.findOneAndUpdate({ _id: req.params.id, empresa: e._id, estado: { $in: ['borrador', 'programada'] } }, { ...datosCampana(req, e), estado: 'borrador', programadaPara: null }, { new: true }).lean();
  if (!c) throw new ErrorApi('Solo se puede editar una campaña que no ha empezado', 409);
  return c;
});

exports.programar = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const c = await Campana.findOne({ _id: req.params.id, empresa: e._id }).lean();
  if (!c) throw new ErrorApi('La campaña no existe', 404);
  if (!['borrador', 'programada'].includes(c.estado)) throw new ErrorApi('La campaña ya empezó', 409);
  const b = mk.bloqueo(e, c); if (b) throw new ErrorApi(b, 409);
  const cuando = req.body.cuando ? new Date(req.body.cuando) : new Date();
  if (isNaN(cuando) || cuando.getTime() > Date.now() + 60 * 86400000) throw new ErrorApi('Fecha de envío no válida');
  const total = (await mk.destinatarios(e, c.canal, c.segmento)).length;
  if (!total) throw new ErrorApi('El segmento no tiene clientes que hayan autorizado este canal', 409);
  await Campana.updateOne({ _id: c._id }, { estado: 'programada', programadaPara: cuando, 'totales.destinatarios': total });
  const saldo = c.canal === 'whatsapp' ? e.mensajeria?.saldoWhatsapp || 0 : e.mensajeria?.saldoCorreo || 0;
  return { programadaPara: cuando, destinatarios: total, saldo, alcanza: saldo >= total };
});
const cambiar = (desde, hacia, extra = {}) => manejar(async req => {
  const r = await Campana.updateOne({ _id: req.params.id, empresa: req.empresa._id, estado: { $in: desde } }, { estado: hacia, ...extra });
  if (!r.matchedCount) throw new ErrorApi('La campaña no está en un estado que permita esa acción', 409);
  return { estado: hacia };
});
exports.pausar = cambiar(['enviando', 'programada'], 'pausada', { motivoPausa: 'Pausada a mano' });
exports.reanudar = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const c = await Campana.findOne({ _id: req.params.id, empresa: e._id, estado: 'pausada' }).lean();
  if (!c) throw new ErrorApi('La campaña no está pausada', 409);
  const b = mk.bloqueo(e, c); if (b) throw new ErrorApi(b, 409);
  await Campana.updateOne({ _id: c._id }, { estado: c.iniciadaEn ? 'enviando' : 'programada', motivoPausa: '', ...(!c.iniciadaEn && { programadaPara: new Date() }) });
  return { ok: true };
});
exports.cancelar = cambiar(['borrador', 'programada', 'pausada', 'enviando'], 'cancelada');

// Prueba: el comercio se la envía a sí mismo antes de lanzar (consume 1 de la bolsa)
exports.prueba = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean();
  const c = await Campana.findOne({ _id: req.params.id, empresa: e._id }).lean();
  if (!c) throw new ErrorApi('La campaña no existe', 404);
  const b = mk.bloqueo(e, c); if (b) throw new ErrorApi(b, 409);
  const destino = String(req.body.destino || '').trim();
  if (c.canal === 'correo' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) throw new ErrorApi('Escribe un correo válido');
  if (c.canal === 'whatsapp' && destino.replace(/\D/g, '').length < 7) throw new ErrorApi('Escribe un celular válido');
  const r = await mk.enviarUno(e, c, { nombre: req.usuario.nombre, telefono: destino, correo: destino });
  return { enviado: true, destino: r.destino };
});
