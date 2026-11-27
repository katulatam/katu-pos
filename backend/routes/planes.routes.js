const r = require('express').Router();
const Plan = require('../models/Plan');
const Registro = require('../models/Registro');
const Empresa = require('../models/Empresa');
const sus = require('../utils/suscripciones');
const prueba = require('../utils/prueba');
const stripe = require('../utils/pagos/stripe');
const { proteger, autorizar, soloSuper, requiereEmpresa } = require('../middleware/auth');
const { manejar, ErrorApi } = require('../utils/contexto');

r.use(proteger);

// El comercio: su plan y el portal de Stripe (tarjeta, facturas, cambio o cancelación)
r.get('/suscripcion', requiereEmpresa, autorizar('admin'), manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).lean(), s = e.suscripcion || {};
  const plan = s.plan ? await Plan.findOne({ codigo: s.plan }).lean() : null;
  const enPrueba = prueba.enPrueba(e);
  return {
    administradaPorKatu: !s.stripeCliente && !enPrueba, estado: s.estado || 'activa', periodo: s.periodo, actualHasta: s.actualHasta, moraDesde: s.moraDesde, diasGracia: sus.DIAS_GRACIA, plan: plan && sus.planPublico(plan), modulos: e.modulos,
    // Prueba gratis: días que quedan y los planes para elegir
    enPrueba, pruebaHasta: s.pruebaHasta, diasRestantes: prueba.diasRestantes(e), vencida: prueba.pruebaVencida(e),
    ...((enPrueba || s.estado === 'cancelada') && { planes: await sus.planesActivos(), modoPrueba: stripe.modoPrueba() }),
  };
}));
r.post('/suscripcion/portal', requiereEmpresa, autorizar('admin'), manejar(req => sus.portal(req.empresa)));
r.post('/suscripcion/checkout', requiereEmpresa, autorizar('admin'), manejar(req => sus.checkoutEmpresa(req.empresa, req.body)));
r.post('/suscripcion/confirmar', requiereEmpresa, autorizar('admin'), manejar(req => sus.confirmarPago(req.empresa, req.body.sesion)));

// Bolsas de mensajes de marketing: paquetes del país y compra con Stripe
const bolsas = require('../utils/bolsas');
r.get('/bolsas', requiereEmpresa, autorizar('admin', 'supervisor'), manejar(req => bolsas.catalogo(req.empresa)));
r.post('/bolsas/comprar', requiereEmpresa, autorizar('admin'), manejar(req => bolsas.comprar(req.empresa, req.usuario._id, req.body)));
r.post('/bolsas/confirmar', requiereEmpresa, autorizar('admin'), manejar(req => bolsas.confirmar(req.empresa, req.body.sesion)));

// Equipo Katú: planes y registros de la landing
const CAMPOS = ['nombre', 'descripcion', 'moneda', 'precioMensual', 'precioAnual', 'modulos', 'caracteristicas', 'destacado', 'diasPrueba', 'orden', 'activo'];
const tomar = b => {
  const d = Object.fromEntries(CAMPOS.filter(k => b[k] !== undefined).map(k => [k, b[k]]));
  if (d.modulos) d.modulos = Object.fromEntries(sus.MODULOS.map(k => [k, !!d.modulos[k]]));
  if (typeof d.caracteristicas === 'string') d.caracteristicas = d.caracteristicas.split('\n').map(x => x.trim()).filter(Boolean);
  for (const k of ['precioMensual', 'precioAnual']) if (d[k] !== undefined && !(Number(d[k]) >= 0)) throw new ErrorApi('Precio inválido');
  return d;
};
r.get('/planes', soloSuper, manejar(() => Plan.find().sort({ orden: 1 }).lean()));
r.post('/planes', soloSuper, manejar(async (req, res) => { const codigo = String(req.body.codigo || '').toLowerCase().trim(); if (!/^[a-z0-9-]{2,30}$/.test(codigo)) throw new ErrorApi('Código inválido'); const p = await Plan.create({ ...tomar(req.body), codigo }); res.status(201); return p; }));
r.put('/planes/:id', soloSuper, manejar(async req => { const p = await Plan.findByIdAndUpdate(req.params.id, tomar(req.body), { new: true, runValidators: true }).lean(); if (!p) throw new ErrorApi('El plan no existe', 404); return p; }));
r.get('/registros', soloSuper, manejar(() => Registro.find().sort({ createdAt: -1 }).limit(300).lean()));
r.post('/registros/:id/reenviar', soloSuper, manejar(req => sus.reenviarBienvenida(req.params.id)));
r.post('/registros/:id/reintentar', soloSuper, manejar(async req => {
  const g = await Registro.findOneAndUpdate({ _id: req.params.id, estado: 'error' }, { estado: 'pendiente' }, { new: true }).lean();
  if (!g) throw new ErrorApi('Solo se reintentan registros con error', 409);
  return sus.provisionar(g._id, { cliente: g.stripeCliente, suscripcion: g.stripeSuscripcion });
}));

module.exports = r;
