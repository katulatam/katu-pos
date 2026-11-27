const r = require('express').Router();
const sus = require('../utils/suscripciones');
const stripe = require('../utils/pagos/stripe');
const limitar = require('../middleware/limitar');
const { manejar } = require('../utils/contexto');

// Público: lo usa la landing www.katupos.com
r.get('/planes', manejar(async () => ({ planes: await sus.planesActivos(), modoPrueba: stripe.modoPrueba(), prueba: await sus.infoPrueba() })));
r.post('/prueba', limitar({ max: 5, ventanaMs: 60 * 60000 }), manejar(req => sus.iniciarPrueba(req.body)));
r.get('/paises', manejar(() => sus.paisesRegistro()));
r.get('/subdominio/:s', limitar({ max: 60 }), manejar(req => sus.subdominioDisponible(req.params.s)));
r.post('/checkout', limitar({ max: 8, ventanaMs: 10 * 60000 }), manejar(req => sus.iniciar(req.body)));
r.get('/estado/:id', limitar({ max: 120 }), manejar(req => sus.estadoRegistro(req.params.id)));

// Webhook de Stripe: va montado ANTES de express.json() (la firma usa el cuerpo crudo)
async function webhook(req, res) {
  let ev;
  try { ev = stripe.verificarEvento(req.body.toString('utf8'), req.headers['stripe-signature']); }
  catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  try { await sus.procesarEvento(ev); res.json({ received: true }); }
  catch (e) { console.error('[stripe.webhook]', ev.type, e.message); res.status(500).json({ success: false, error: 'No se pudo procesar' }); } // Stripe reintenta
}

module.exports = { rutas: r, webhook };
