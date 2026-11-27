const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Producto = require('../models/Producto');
const Promocion = require('../models/Promocion');
const Campana = require('../models/Campana');
const mk = require('./marketing');
const Motor = require('../../frontend/assets/js/motor');
const { ErrorApi, paisDe, ahoraDe } = require('./contexto');

// ── Promoción del día ──────────────────────────────────────────────────────
// WhatsApp exige plantillas aprobadas por Meta: en vez de aprobar una cada día,
// cada negocio tiene UNA plantilla de marketing reutilizable con la oferta como
// variable. El comercio elige productos y precio de hoy; Katú arma el texto,
// (opcional) crea el descuento en el POS y la tienda solo por ese día, y lanza
// la campaña por WhatsApp y/o correo con el límite semanal por cliente.
//   {{1}} nombre del cliente · {{2}} la oferta · {{3}} enlace a la tienda
const SISTEMA = 'promo_dia';
const SISTEMA_IMG = 'promo_dia_img';   // misma plantilla con la foto del producto arriba ({{4}} = clave de la imagen)
const MAX_ITEMS = 4;
const nombreSeguro = e => String(e.nombre || '').replace(/[{}\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const cuerpoPlantilla = e => `Hola {{1}}, hoy en ${nombreSeguro(e)} tenemos esta promoción para ti: {{2}}. Pide respondiendo este mensaje o en {{3}} ¡Válida solo por hoy!\n\nResponde BAJA para no recibir más promociones.`;
const plantillaDe = (e, imagen = false) => (e.whatsapp?.plantillasMarketing || []).find(p => p.sistema === (imagen ? SISTEMA_IMG : SISTEMA)) || null;
const aprobada = p => p?.estado === 'aprobada';

// Crea (una vez) la plantilla del negocio y la manda a aprobación de Meta.
// imagen: la versión con la foto del producto (la imagen la sirve Katú desde su dominio).
async function asegurarPlantilla(empresaId, { imagen = false } = {}) {
  const e = await Empresa.findById(empresaId).lean();
  const ya = plantillaDe(e, imagen);
  if (ya) return ya;
  if (!e.whatsapp?.subcuentaSid) throw new ErrorApi('Primero hay que activar el WhatsApp de la empresa', 409);
  const twilio = require('./whatsapp/twilio'), img = require('./imagenPromo');
  if (imagen && !twilio.simulado() && !/^https:\/\//.test(img.urlBase())) throw new ErrorApi('Define PUBLIC_URL (https) en el servidor: WhatsApp descarga la imagen de ahí', 409);
  const cuerpo = cuerpoPlantilla(e), nombre = `promo_dia${imagen ? '_img' : ''}_${String(e._id).slice(-6)}`;
  const r = await twilio.crearPlantilla(e.whatsapp.subcuentaSid, {
    nombre, cuerpo, categoria: 'MARKETING',
    variables: { 1: 'Ana', 2: 'Leche 1 L a $4.200 (antes $4.800) y pan tajado a $5.000', 3: 'https://tienda.katupos.com', ...(imagen && { 4: 'muestra' }) },
    ...(imagen && { media: `${img.urlBase()}{{4}}` }),
  });
  const p = { nombre, cuerpo, contentSid: r.contentSid, estado: twilio.simulado() ? 'aprobada' : 'pendiente', sistema: imagen ? SISTEMA_IMG : SISTEMA };
  await Empresa.updateOne({ _id: e._id }, { $push: { 'whatsapp.plantillasMarketing': p } });
  return p;
}
// ¿Con cuál plantilla sale? Con foto si está aprobada y el primer producto tiene foto; si no, la de texto
function elegirPlantilla(e, a) {
  const conFoto = plantillaDe(e, true), texto = plantillaDe(e);
  if (aprobada(conFoto) && a.items[0]?.imagenUrl) return { p: conFoto, imagen: require('./imagenPromo').clave(e._id, a.items[0].producto) };
  if (aprobada(texto)) return { p: texto, imagen: null };
  return { p: null, imagen: null };
}

// Productos y precio de hoy → texto de la oferta (una sola línea: así lo exige WhatsApp en las variables)
async function armar(empresa, items) {
  if (!Array.isArray(items) || !items.length) throw new ErrorApi('Elige al menos un producto');
  if (items.length > MAX_ITEMS) throw new ErrorApi(`Máximo ${MAX_ITEMS} productos por promoción`);
  const pais = await paisDe(empresa), dec = pais.decimales ?? 2, red = n => Math.round(n * 10 ** dec) / 10 ** dec;
  const ids = items.map(i => String(i.producto || ''));
  if (ids.some(id => !/^[a-f\d]{24}$/i.test(id)) || new Set(ids).size !== ids.length) throw new ErrorApi('Productos no válidos');
  const prods = new Map((await Producto.find({ _id: { $in: ids }, empresa: empresa._id, activo: true }).select('nombre precio imagenUrl').lean()).map(p => [String(p._id), p]));
  const lista = items.map(i => {
    const p = prods.get(String(i.producto));
    if (!p) throw new ErrorApi('Uno de los productos no existe o está inactivo', 404);
    const v = Number(i.valor);
    const precio = i.tipo === 'porcentaje' ? red(p.precio * (1 - v / 100)) : red(v);
    if (!(v > 0) || (i.tipo === 'porcentaje' && v >= 100)) throw new ErrorApi(`Revisa el descuento de ${p.nombre}`);
    if (!(precio > 0) || precio >= p.precio) throw new ErrorApi(`El precio de hoy de ${p.nombre} debe ser menor que el normal (${Motor.dinero(p.precio, pais)})`);
    return { producto: p._id, nombre: p.nombre, precio, precioAntes: p.precio, imagenUrl: p.imagenUrl };
  });
  const partes = lista.map(x => `${x.nombre} a ${Motor.dinero(x.precio, pais)} (antes ${Motor.dinero(x.precioAntes, pais)})`);
  const texto = (partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]).replace(/[\n\r\t]/g, ' ').replace(/ {2,}/g, ' ').slice(0, 300);
  return { items: lista, texto, enlace: require('./empresas').urlEmpresa(empresa.slug), pais };
}

// Correo con diseño armado solo: título, saludo, tarjetas de productos y botón
function bloquesCorreo(empresa, a) {
  return [
    { tipo: 'titulo', texto: '¡Promoción del día!', tamano: 34, alinear: 'center' },
    { tipo: 'texto', texto: `Hola {nombre}, solo por hoy en *${nombreSeguro(empresa)}* tenemos estos precios para ti:`, alinear: 'center' },
    { tipo: 'productos', productos: a.items.map(x => String(x.producto)), columnas: a.items.length === 1 ? 1 : 2 },
    { tipo: 'boton', texto: 'Comprar ahora', enlace: a.enlace, alinear: 'center' },
    { tipo: 'texto', texto: '_Válido solo por hoy o hasta agotar existencias._', alinear: 'center' },
  ];
}

const canalesDe = c => [...new Set((Array.isArray(c) ? c : [c]).filter(x => ['whatsapp', 'correo'].includes(x)))];

// Vista previa: el mensaje como lo verá el cliente y a cuántos llega por canal
async function vista(empresa, b) {
  const e = await Empresa.findById(empresa._id).lean();
  const a = await armar(e, b.items);
  const { p, imagen } = elegirPlantilla(e, a);
  const seg = b.segmento || {};
  const destinatarios = {};
  for (const canal of ['whatsapp', 'correo']) destinatarios[canal] = (await mk.destinatarios(e, canal, seg)).length;
  // El correo tal como llegará (cliente de ejemplo)
  const c = { formato: 'diseno', bloques: bloquesCorreo(e, a), promo: { items: a.items }, asunto: String(b.asunto || '').trim() || `{nombre}, la promoción de hoy en ${nombreSeguro(e)}`, preheader: a.texto.slice(0, 140) };
  const correo = mk.armarCorreo(e, c, { nombre: 'Valentina' }, await mk.prepararCorreo(e, c));
  return {
    texto: a.texto, enlace: a.enlace, items: a.items, destinatarios, limiteSemanal: e.marketing?.limiteSemanal ?? 2, correo: { asunto: correo.asunto, html: correo.html },
    whatsapp: p ? p.cuerpo.replace('{{1}}', 'Valentina').replace('{{2}}', a.texto).replace('{{3}}', a.enlace) : null,
    whatsappImagen: imagen ? a.items[0].imagenUrl : null,
    sinFoto: !a.items[0]?.imagenUrl,
    saldo: { whatsapp: e.mensajeria?.saldoWhatsapp || 0, correo: e.mensajeria?.saldoCorreo || 0 },
  };
}

// Crea las campañas (una por canal), el descuento del día si se pidió, y las programa
async function crear(empresa, usuario, b) {
  const e = await Empresa.findById(empresa._id).lean();
  const canales = canalesDe(b.canales);
  if (!canales.length) throw new ErrorApi('Elige por dónde enviarla: WhatsApp, correo o ambos');
  const cuando = b.cuando ? new Date(b.cuando) : new Date();
  if (isNaN(cuando) || cuando.getTime() > Date.now() + 14 * 86400000) throw new ErrorApi('Fecha de envío no válida (máximo 14 días)');
  const a = await armar(e, b.items);
  const fecha = ahoraDe(e, null, cuando).fecha;
  const seg = { tipo: mk.SEGMENTOS.includes(b.segmento?.tipo) ? b.segmento.tipo : 'todos', dias: Number(b.segmento?.dias) || undefined, compras: Number(b.segmento?.compras) || undefined, nivel: b.segmento?.nivel || undefined };
  const { p, imagen } = elegirPlantilla(e, a);
  const nombre = String(b.nombre || '').trim().slice(0, 100) || `Promoción del día ${fecha}`;
  const asunto = String(b.asunto || '').trim().slice(0, 150) || `{nombre}, la promoción de hoy en ${nombreSeguro(e)}`;

  // Validar todo antes de crear nada
  const borradores = canales.map(canal => canal === 'whatsapp'
    ? { canal, plantilla: p?.contentSid, plantillaNombre: p?.nombre, cuerpo: p?.cuerpo, variables: { 2: a.texto, 3: a.enlace, ...(imagen && { 4: imagen }) } }
    : { canal, asunto, preheader: a.texto.slice(0, 140), formato: 'diseno', bloques: bloquesCorreo(e, a) });
  for (const d of borradores) {
    if (d.canal === 'whatsapp' && !p) throw new ErrorApi('Falta una plantilla aprobada de la promoción del día: créala y espera la aprobación de Meta', 409);
    const bl = mk.bloqueo(e, { canal: d.canal, plantilla: d.plantilla });
    if (bl) throw new ErrorApi(`${d.canal === 'whatsapp' ? 'WhatsApp' : 'Correo'}: ${bl}`, 409);
  }
  const totales = {};
  for (const d of borradores) {
    totales[d.canal] = (await mk.destinatarios(e, d.canal, seg)).length;
    if (!totales[d.canal]) throw new ErrorApi(`Ningún cliente del segmento autorizó promociones por ${d.canal === 'whatsapp' ? 'WhatsApp' : 'correo'}`, 409);
  }

  // Descuento real en el POS y la tienda, solo ese día: el precio del mensaje es el que se cobra
  const promociones = [];
  if (b.crearDescuento !== false) {
    for (const x of a.items) {
      const pr = await Promocion.create({ empresa: e._id, nombre: `Promo del día ${fecha}: ${x.nombre}`.slice(0, 120), tipo: 'precio', valor: x.precio, alcance: 'producto', objetivos: [x.producto], desde: fecha, hasta: fecha, activo: true });
      promociones.push(pr._id);
    }
  }
  const grupo = crypto.randomUUID();
  const promo = { texto: a.texto, enlace: a.enlace, items: a.items.map(({ producto, nombre: n, precio, precioAntes }) => ({ producto, nombre: n, precio, precioAntes })), promociones };
  const creadas = [];
  for (const d of borradores) {
    const c = await Campana.create({ ...d, empresa: e._id, nombre: `${nombre}${canales.length > 1 ? ` · ${d.canal === 'whatsapp' ? 'WhatsApp' : 'Correo'}` : ''}`, tipo: SISTEMA, grupo, segmento: seg, promo, estado: 'programada', programadaPara: cuando, totales: { destinatarios: totales[d.canal] }, creadaPor: usuario });
    creadas.push({ _id: c._id, canal: d.canal, destinatarios: totales[d.canal], saldo: d.canal === 'whatsapp' ? e.mensajeria?.saldoWhatsapp || 0 : e.mensajeria?.saldoCorreo || 0 });
  }
  return { texto: a.texto, programadaPara: cuando, descuentos: promociones.length, campanas: creadas };
}

module.exports = { SISTEMA, SISTEMA_IMG, cuerpoPlantilla, plantillaDe, elegirPlantilla, asegurarPlantilla, armar, bloquesCorreo, vista, crear };
