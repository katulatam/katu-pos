const crypto = require('crypto');
const axios = require('axios');

// ── Correo por SendGrid (igual que katu_school), por HTTP sin SDK ──────────
// Remitente: el dominio verificado de Katú (SENDGRID_FROM) con el nombre del
// comercio; las respuestas van al correo del comercio (reply-to). Sin API key
// y fuera de producción funciona un simulador que no envía nada.
const config = () => ({
  apiKey: String(process.env.SENDGRID_API_KEY || '').trim(),
  from: String(process.env.SENDGRID_FROM || '').trim(),
  url: (String(process.env.SENDGRID_URL || '').trim() || 'https://api.sendgrid.com/v3').replace(/\/+$/, ''),
});
const simulado = () => !config().apiKey && process.env.NODE_ENV !== 'production';
const disponible = () => (!!config().apiKey && !!config().from) || simulado();

// a: correo; nombreRemitente: nombre del comercio; html y texto ya armados
async function enviar({ a, asunto, html, texto, nombreRemitente, responderA, baja, datos }) {
  if (simulado()) return { id: 'sgsim' + crypto.randomBytes(12).toString('hex') };
  const { apiKey, from, url } = config();
  if (!apiKey || !from) throw new Error('El correo no está configurado en el servidor (SENDGRID_API_KEY / SENDGRID_FROM)');
  try {
    const r = await axios.post(`${url}/mail/send`, {
      personalizations: [{ to: [{ email: a }] }],
      from: { email: from, name: String(nombreRemitente || 'Katú').slice(0, 60) },
      ...(responderA && { reply_to: { email: responderA } }),
      subject: asunto,
      content: [{ type: 'text/plain', value: texto }, { type: 'text/html', value: html }],
      ...(baja && { headers: { 'List-Unsubscribe': `<${baja}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      ...(datos && { custom_args: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])) }),
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return { id: r.headers['x-message-id'] || '' };
  } catch (e) {
    const d = e.response?.data;
    const err = new Error(`Correo (${e.response?.status || 'sin respuesta'}): ${d?.errors?.map(x => x.message).join('; ') || e.message}`);
    err.definitivo = e.response?.status >= 400 && e.response?.status < 500 && e.response?.status !== 429;
    throw err;
  }
}

// Plantilla dinámica de SendGrid (d-…), como en katu_school: el diseño y los textos
// se editan en el panel de SendGrid; aquí solo van los datos. El asunto de la
// plantilla debe usar la variable {{asunto}}.
async function enviarPlantilla({ a, plantilla, datos, nombreRemitente, responderA, etiquetas }) {
  if (simulado()) return { id: 'sgsim' + crypto.randomBytes(12).toString('hex') };
  const { apiKey, from, url } = config();
  if (!apiKey || !from) throw new Error('El correo no está configurado en el servidor (SENDGRID_API_KEY / SENDGRID_FROM)');
  try {
    const r = await axios.post(`${url}/mail/send`, {
      personalizations: [{ to: [{ email: a }], dynamic_template_data: datos }],
      from: { email: from, name: String(nombreRemitente || 'Katú POS').slice(0, 60) },
      ...(responderA && { reply_to: { email: responderA } }),
      template_id: plantilla,
      ...(etiquetas && { custom_args: Object.fromEntries(Object.entries(etiquetas).map(([k, v]) => [k, String(v)])) }),
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return { id: r.headers['x-message-id'] || '' };
  } catch (e) {
    const d = e.response?.data;
    throw new Error(`Correo (${e.response?.status || 'sin respuesta'}): ${d?.errors?.map(x => x.message).join('; ') || e.message}`);
  }
}

module.exports = { enviar, enviarPlantilla, disponible, simulado };
