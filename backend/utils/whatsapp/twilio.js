const crypto = require('crypto');
const axios = require('axios');

// ── Twilio (WhatsApp) — modelo de subcuentas ───────────────────────────────
// Katú tiene UNA cuenta maestra (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en el
// .env) y crea una subcuenta por comercio con su número. El token de cada
// subcuenta se consulta con la maestra y vive solo en memoria: nunca en la BD.
// Sin credenciales y fuera de producción funciona un SIMULADOR (no envía nada)
// para desarrollar y probar.
const API = 'https://api.twilio.com/2010-04-01';
const MSG = 'https://messaging.twilio.com/v1';

const maestra = () => ({ sid: String(process.env.TWILIO_ACCOUNT_SID || '').trim(), token: String(process.env.TWILIO_AUTH_TOKEN || '').trim() });
const simulado = () => !maestra().sid && process.env.NODE_ENV !== 'production';
const disponible = () => !!maestra().sid || simulado();

class ErrorTwilio extends Error {
  constructor(m, status = 502) { super(m); this.status = status; }
}

async function llamar(cred, metodo, url, datos) {
  try {
    const { data } = await axios({
      method: metodo, url, timeout: 20000, auth: { username: cred.sid, password: cred.token },
      ...(datos && { data: new URLSearchParams(Object.entries(datos).filter(([, v]) => v != null && v !== '')).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    });
    return data;
  } catch (e) {
    const d = e.response?.data;
    throw new ErrorTwilio(`WhatsApp (${e.response?.status || 'sin respuesta'}): ${d?.message || e.message}${d?.code ? ` [${d.code}]` : ''}`, e.response?.status >= 400 && e.response?.status < 500 ? 400 : 502);
  }
}

// Token de la subcuenta, en memoria por 1 hora
const tokens = new Map();
async function credSub(subSid) {
  if (simulado()) return { sid: subSid, token: 'simulado' };
  const c = tokens.get(subSid);
  if (c && c.hasta > Date.now()) return c.cred;
  const a = await llamar(maestra(), 'get', `${API}/Accounts/${subSid}.json`);
  if (!a?.auth_token) throw new ErrorTwilio('No se pudo leer la subcuenta de WhatsApp');
  const cred = { sid: subSid, token: a.auth_token };
  tokens.set(subSid, { cred, hasta: Date.now() + 3600000 });
  return cred;
}

// Alta: subcuenta + Messaging Service que apunta a nuestros webhooks
async function crearSubcuenta(nombre, { entrante, estado }) {
  if (simulado()) return { subcuentaSid: 'ACsim' + crypto.randomBytes(15).toString('hex'), servicioSid: 'MGsim' + crypto.randomBytes(15).toString('hex') };
  const a = await llamar(maestra(), 'post', `${API}/Accounts.json`, { FriendlyName: `Katú · ${nombre}`.slice(0, 64) });
  const cred = { sid: a.sid, token: a.auth_token };
  tokens.set(a.sid, { cred, hasta: Date.now() + 3600000 });
  const s = await llamar(cred, 'post', `${MSG}/Services`, { FriendlyName: `WhatsApp ${nombre}`.slice(0, 64), InboundRequestUrl: entrante, InboundMethod: 'POST', StatusCallback: estado, UseInboundWebhookOnNumber: 'false' });
  return { subcuentaSid: a.sid, servicioSid: s.sid };
}
// Revisa que el número ya esté agregado al servicio (el registro del remitente
// de WhatsApp lo aprueba Meta y se hace en la consola de Twilio)
async function verificarNumero(subSid, servicioSid, numero) {
  if (simulado()) return true;
  const cred = await credSub(subSid);
  const r = await llamar(cred, 'get', `${MSG}/Services/${servicioSid}/PhoneNumbers?PageSize=50`).catch(() => null);
  const s = await llamar(cred, 'get', `${MSG}/Services/${servicioSid}/ChannelSenders?PageSize=50`).catch(() => null);
  const lista = [...(r?.phone_numbers || []).map(x => x.phone_number), ...(s?.senders || []).map(x => String(x.sender || '').replace(/^whatsapp:/, ''))];
  return lista.includes(numero);
}

// Más estricto: el número ya es REMITENTE DE WHATSAPP en el servicio (no basta con
// que el número de teléfono esté agregado). Lo usa la activación de los números de Katú.
async function esRemitenteWhatsapp(subSid, servicioSid, numero) {
  if (simulado()) return true;
  const cred = await credSub(subSid);
  const s = await llamar(cred, 'get', `${MSG}/Services/${servicioSid}/ChannelSenders?PageSize=50`).catch(() => null);
  return (s?.senders || []).some(x => String(x.sender || '') === `whatsapp:${numero}`);
}

async function enviar({ subcuentaSid, servicioSid, numero }, { a, texto, plantilla, variables, aviso }) {
  if (simulado()) return { sid: 'SMsim' + crypto.randomBytes(15).toString('hex'), estado: 'entregado' };
  const cred = await credSub(subcuentaSid);
  const d = await llamar(cred, 'post', `${API}/Accounts/${subcuentaSid}/Messages.json`, {
    // Remitente explícito (si hay número): no depende de que el servicio elija bien del
    // Sender Pool (evita el error 63007). El servicio sigue aplicando su configuración.
    To: `whatsapp:${a}`, ...(servicioSid && { MessagingServiceSid: servicioSid }), ...((numero || !servicioSid) && { From: `whatsapp:${numero}` }),
    ...(plantilla ? { ContentSid: plantilla, ContentVariables: JSON.stringify(variables || {}) } : { Body: texto }),
    StatusCallback: aviso,
  });
  return { sid: d.sid, estado: d.status === 'failed' ? 'fallido' : 'enviado' };
}

// Firma X-Twilio-Signature: HMAC-SHA1 de la URL + parámetros ordenados, con el token de la subcuenta
async function firmaValida(subSid, url, params, firma) {
  if (simulado()) return true;
  if (!firma) return false;
  const { token } = await credSub(subSid);
  const base = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const esperada = crypto.createHmac('sha1', token).update(Buffer.from(base, 'utf8')).digest('base64');
  const a = Buffer.from(esperada), b = Buffer.from(String(firma));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Las imágenes que manda el cliente se descargan con las credenciales de la subcuenta
async function descargar(subSid, url) {
  if (!/^https:\/\/api\.twilio\.com\//.test(url)) throw new ErrorTwilio('Archivo no válido', 400);
  const cred = await credSub(subSid);
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 16 * 1024 * 1024, auth: { username: cred.sid, password: cred.token } });
  return { datos: r.data, tipo: r.headers['content-type'] || 'application/octet-stream' };
}

// ── Plantillas (Content API) y aprobación de Meta ──────────────────────────
const CONTENT = 'https://content.twilio.com/v1';
async function llamarJSON(cred, metodo, url, datos) {
  try {
    const { data } = await axios({ method: metodo, url, timeout: 20000, auth: { username: cred.sid, password: cred.token }, ...(datos && { data: datos, headers: { 'Content-Type': 'application/json' } }) });
    return data;
  } catch (e) {
    const d = e.response?.data;
    throw new ErrorTwilio(`WhatsApp (${e.response?.status || 'sin respuesta'}): ${d?.message || e.message}${d?.code ? ` [${d.code}]` : ''}`, e.response?.status >= 400 && e.response?.status < 500 ? 400 : 502);
  }
}
// cuerpo con {{1}} = nombre del cliente. nombre: identificador en minúsculas y guiones bajos.
// Marketing (campañas) por defecto; los avisos de pedidos van como UTILITY.
// media: dirección de la imagen con dominio fijo y la parte variable al final
// (p. ej. https://app.katupos.com/api/v1/publico/promo-img/{{4}}): así lo exige WhatsApp.
async function crearPlantilla(subSid, { nombre, cuerpo, categoria = 'MARKETING', variables = { 1: 'Cliente' }, media }) {
  if (simulado()) return { contentSid: 'HX' + crypto.randomBytes(16).toString('hex') };
  const cred = await credSub(subSid);
  const types = media ? { 'twilio/media': { body: cuerpo, media: [media] } } : { 'twilio/text': { body: cuerpo } };
  const c = await llamarJSON(cred, 'post', `${CONTENT}/Content`, { friendly_name: nombre, language: 'es', variables, types });
  await llamarJSON(cred, 'post', `${CONTENT}/Content/${c.sid}/ApprovalRequests/whatsapp`, { name: nombre, category: categoria });
  return { contentSid: c.sid };
}

// ── Números de Katú (inventario) ───────────────────────────────────────────
// Se compran en la cuenta maestra y se pasan a la subcuenta de cada empresa.
const simNumero = () => `+1305555${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
// Números de EE. UU. disponibles para comprar (con SMS: Twilio verifica solo el remitente de WhatsApp)
async function buscarNumeros({ pais = 'US', codigoArea } = {}) {
  if (simulado()) return Array.from({ length: 5 }, () => ({ numero: simNumero(), zona: 'Miami, FL' }));
  const q = new URLSearchParams({ SmsEnabled: 'true', PageSize: '10', ...(codigoArea && { AreaCode: String(codigoArea) }) });
  const r = await llamar(maestra(), 'get', `${API}/Accounts/${maestra().sid}/AvailablePhoneNumbers/${pais}/Local.json?${q}`);
  return (r.available_phone_numbers || []).map(x => ({ numero: x.phone_number, zona: [x.locality, x.region].filter(Boolean).join(', ') }));
}
async function comprarNumero(numero, etiqueta = 'Katú POS · WhatsApp') {
  if (simulado()) return { sid: 'PNsim' + crypto.randomBytes(15).toString('hex'), numero, cuenta: 'ACsimmaestra' };
  const r = await llamar(maestra(), 'post', `${API}/Accounts/${maestra().sid}/IncomingPhoneNumbers.json`, { PhoneNumber: numero, FriendlyName: etiqueta });
  return { sid: r.sid, numero: r.phone_number, cuenta: r.account_sid };
}
// Un número que ya está en la cuenta maestra (comprado desde la consola)
async function buscarComprado(numero) {
  if (simulado()) return { sid: 'PNsim' + crypto.randomBytes(15).toString('hex'), numero, cuenta: 'ACsimmaestra' };
  const r = await llamar(maestra(), 'get', `${API}/Accounts/${maestra().sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(numero)}`);
  const x = (r.incoming_phone_numbers || [])[0];
  return x ? { sid: x.sid, numero: x.phone_number, cuenta: x.account_sid } : null;
}
// Pasa el número de una cuenta a otra (maestra ↔ subcuentas de la misma maestra)
async function moverNumero(sid, desde, hacia) {
  if (simulado()) return;
  await llamar(maestra(), 'post', `${API}/Accounts/${desde}/IncomingPhoneNumbers/${sid}.json`, { AccountSid: hacia });
}
async function agregarAServicio(subSid, servicioSid, numeroSid) {
  if (simulado()) return;
  const cred = await credSub(subSid);
  await llamar(cred, 'post', `${MSG}/Services/${servicioSid}/PhoneNumbers`, { PhoneNumberSid: numeroSid }).catch(e => { if (!/21710|already/i.test(e.message)) throw e; });
}
async function quitarDeServicio(subSid, servicioSid, numeroSid) {
  if (simulado()) return;
  const cred = await credSub(subSid);
  await llamar(cred, 'delete', `${MSG}/Services/${servicioSid}/PhoneNumbers/${numeroSid}`).catch(() => null);
}
// Irreversible: Twilio deja de cobrarlo y el número se pierde
async function darDeBaja(sid, cuenta) {
  if (simulado()) return;
  await llamar(maestra(), 'delete', `${API}/Accounts/${cuenta || maestra().sid}/IncomingPhoneNumbers/${sid}.json`);
}
const sidMaestra = () => (simulado() ? 'ACsimmaestra' : maestra().sid);
// → { estado: aprobada | pendiente | rechazada, motivo }
async function estadoPlantilla(subSid, contentSid) {
  if (simulado()) return { estado: 'aprobada' };
  const cred = await credSub(subSid);
  const r = await llamarJSON(cred, 'get', `${CONTENT}/Content/${contentSid}/ApprovalRequests`);
  const s = String(r?.whatsapp?.status || '').toLowerCase();
  return { estado: s === 'approved' ? 'aprobada' : ['rejected', 'paused', 'disabled'].includes(s) ? 'rechazada' : 'pendiente', motivo: r?.whatsapp?.rejection_reason || '' };
}

module.exports = { disponible, simulado, crearSubcuenta, verificarNumero, esRemitenteWhatsapp, enviar, firmaValida, descargar, crearPlantilla, estadoPlantilla,
  buscarNumeros, comprarNumero, buscarComprado, moverNumero, agregarAServicio, quitarDeServicio, darDeBaja, sidMaestra, ErrorTwilio };
