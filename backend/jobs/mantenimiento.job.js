const cron = require('node-cron');
const facturacion = require('../utils/facturacion');
const Cobro = require('../models/Cobro');
const Pedido = require('../models/Pedido');
const cobros = require('../utils/cobros');
const marketing = require('../utils/marketing');
const suscripciones = require('../utils/suscripciones');
const { conBloqueo } = require('../utils/bloqueo');

// Con varios contenedores, cada tarea corre en uno solo a la vez (bloqueo en MongoDB)
const tarea = (nombre, ms, fn) => () => conBloqueo(nombre, ms, fn).catch(e => console.error(`[job.${nombre}]`, e.message));

module.exports = () => {
  // Cada 2 minutos: documentos electrónicos por emitir o en validación
  cron.schedule('*/2 * * * *', tarea('facturacion', 10 * 60000, () => facturacion.mantenimiento()));
  // Cada minuto: campañas de marketing programadas y en envío (por lotes)
  cron.schedule('* * * * *', tarea('marketing', 5 * 60000, () => marketing.procesar()));
  // Cada minuto: cobros de domicilios pendientes (el cliente pudo cerrar la página)
  cron.schedule('* * * * *', tarea('cobros', 5 * 60000, async () => {
    const lista = await Cobro.find({ estado: 'pendiente', createdAt: { $gt: new Date(Date.now() - 3600000) } }).limit(100).lean();
    for (const c of lista) {
      const r = await cobros.consultar(c.empresa, c._id);
      if (r.estado === 'aprobado' && c.pedido) await Pedido.updateOne({ _id: c.pedido, pagado: false, total: c.monto, estado: { $nin: ['entregado', 'cancelado'] } }, { pagado: true, cobro: c._id });
    }
  }));
  // Cada hora: suscripciones en mora que agotaron el periodo de gracia
  cron.schedule('17 * * * *', tarea('suscripciones', 10 * 60000, () => suscripciones.suspenderVencidas()));
  // Cada hora: recordatorios de la prueba gratis (5 días, 1 día) y fin de la prueba
  cron.schedule('23 * * * *', tarea('pruebas', 10 * 60000, () => suscripciones.revisarPruebas()));
};
