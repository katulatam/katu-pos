const crypto = require('crypto');
const axios = require('axios');

// ── Stripe (suscripciones de Katú POS), por HTTP sin SDK ───────────────────
// La API de Stripe recibe parámetros form-encoded con claves anidadas
// (line_items[0][price_data][currency]=cop). La firma de los webhooks se
// verifica con STRIPE_WEBHOOK_SECRET. STRIPE_URL solo existe para las pruebas.
const config = () => ({
  clave: String(process.env.STRIPE_SECRET_KEY || '').trim(),
  secretoWebhook: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  url: (String(process.env.STRIPE_URL || '').trim() || 'https://api.stripe.com/v1').replace(/\/+$/, ''),
});
const disponible = () => !!config().clave;
const modoPrueba = () => config().clave.startsWith('sk_test_');

function aplanar(obj, prefijo = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (typeof v === 'object' && !(v instanceof Date)) aplanar(v, clave, out);
    else out.push([clave, String(v)]);
  }
  return out;
}

async function llamar(metodo, ruta, datos, llave) {
  const { clave, url } = config();
  if (!clave) throw new Error('Stripe no está configurado en el servidor (STRIPE_SECRET_KEY)');
  try {
    const { data } = await axios({
      method: metodo, url: url + ruta, timeout: 20000,
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(llave && { 'Idempotency-Key': llave }) },
      ...(datos && { data: new URLSearchParams(aplanar(datos)).toString() }),
    });
    return data;
  } catch (e) {
    const d = e.response?.data?.error;
    throw new Error(`Stripe (${e.response?.status || 'sin respuesta'}): ${d?.message || e.message}`);
  }
}

// Precios inline: el monto sale del Plan de Katú. Monedas de 2 decimales → centavos.
const SIN_DECIMALES = ['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'];
const centavos = (monto, moneda) => Math.round(Number(monto) * (SIN_DECIMALES.includes(String(moneda).toLowerCase()) ? 1 : 100));

// Registro nuevo (registroId) o empresa que ya existe y se suscribe (empresaId, p. ej. al
// terminar la prueba gratis: a esa no se le vuelve a dar la prueba de Stripe del plan).
function crearCheckout({ plan, periodo, correo, registroId, empresaId, exito, cancelar }) {
  const moneda = String(plan.moneda || 'COP').toLowerCase();
  const meta = { ...(registroId && { registro: String(registroId) }), ...(empresaId && { empresa: String(empresaId) }), plan: plan.codigo, periodo };
  return llamar('post', '/checkout/sessions', {
    mode: 'subscription', customer_email: correo, client_reference_id: String(registroId || `empresa-${empresaId}`),
    success_url: exito, cancel_url: cancelar, locale: 'es', billing_address_collection: 'auto', allow_promotion_codes: 'true',
    line_items: [{ quantity: 1, price_data: { currency: moneda, unit_amount: centavos(periodo === 'anual' ? plan.precioAnual : plan.precioMensual, moneda), recurring: { interval: periodo === 'anual' ? 'year' : 'month' }, product_data: { name: `Katú POS · Plan ${plan.nombre} (${periodo})` } } }],
    metadata: meta,
    subscription_data: { metadata: meta, ...(!empresaId && plan.diasPrueba > 0 && { trial_period_days: plan.diasPrueba }) },
  }, registroId ? `checkout-${registroId}` : `checkout-empresa-${empresaId}-${crypto.randomUUID()}`);
}
const sesion = id => llamar('get', `/checkout/sessions/${encodeURIComponent(id)}`);
const portal = (cliente, volver) => llamar('post', '/billing_portal/sessions', { customer: cliente, return_url: volver });

// Firma "Stripe-Signature: t=…,v1=…": HMAC-SHA256 de "t.cuerpo", tolerancia 5 min
function verificarEvento(cuerpoCrudo, cabecera) {
  const { secretoWebhook } = config();
  if (!secretoWebhook) throw new Error('Falta STRIPE_WEBHOOK_SECRET');
  const partes = String(cabecera || '').split(',').map(x => x.split('='));
  const t = partes.find(p => p[0] === 't')?.[1];
  const firmas = partes.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !firmas.length) throw new Error('Firma ausente');
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error('Firma vencida');
  const esperada = crypto.createHmac('sha256', secretoWebhook).update(`${t}.${cuerpoCrudo}`).digest('hex');
  const a = Buffer.from(esperada);
  if (!firmas.some(f => { const b = Buffer.from(f); return a.length === b.length && crypto.timingSafeEqual(a, b); })) throw new Error('Firma inválida');
  return JSON.parse(cuerpoCrudo);
}

module.exports = { disponible, modoPrueba, crearCheckout, sesion, portal, verificarEvento, llamar, centavos, _interno: { aplanar } };
