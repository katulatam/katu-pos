// ── Prueba gratis sin tarjeta ──────────────────────────────────────────────
// Desde la landing, sin pagar: la empresa nace con el plan de prueba (Premium)
// en estado "prueba" y una fecha límite. Al vencer queda bloqueada (no se borra)
// hasta que el administrador elija un plan y pague en "Mi suscripción".
// Sin dependencias: lo usan el middleware de autenticación, la tienda y la facturación.
const num = (v, def) => (v === undefined || String(v).trim() === '' ? def : Number(v));
const DIAS = () => Math.max(0, num(process.env.DIAS_PRUEBA_GRATIS, 15) || 0); // 0 = prueba desactivada
const PLAN = () => String(process.env.PLAN_PRUEBA || 'premium').trim().toLowerCase();

// La prueba sin tarjeta no tiene suscripción de Stripe (la prueba con tarjeta de Stripe sí)
const enPrueba = e => !!(e?.suscripcion?.pruebaHasta && !e.suscripcion.stripeSuscripcion && ['prueba', 'vencida'].includes(e.suscripcion.estado));
const pruebaVencida = (e, ahora = Date.now()) => enPrueba(e) && new Date(e.suscripcion.pruebaHasta).getTime() <= ahora;
const diasRestantes = (e, ahora = Date.now()) => (enPrueba(e) ? Math.max(0, Math.ceil((new Date(e.suscripcion.pruebaHasta).getTime() - ahora) / 86400000)) : null);

module.exports = { DIAS, PLAN, enPrueba, pruebaVencida, diasRestantes };
