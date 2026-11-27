const r = require('express').Router();
const c = require('../controllers/whatsapp.controller');
const { proteger, autorizar, soloSuper, requiereEmpresa, requiereModulo } = require('../middleware/auth');

// Públicos: los llama Twilio (se verifica la firma de la subcuenta)
r.post('/webhook/:empresa', c.webhook);
r.post('/estado/:empresa', c.estado);

r.use(proteger, requiereEmpresa);
// Configuración: el comercio ve su estado y su bolsa aunque el módulo esté apagado
r.get('/config', autorizar('admin', 'supervisor'), c.config);
r.put('/config', requiereModulo('whatsapp'), autorizar('admin'), c.guardarConfig);
r.post('/subcuenta', soloSuper, c.crearSubcuenta);
r.put('/numero', soloSuper, c.guardarNumero);
r.post('/bolsa', soloSuper, c.recargar);
r.get('/movimientos', autorizar('admin', 'supervisor'), c.movimientos);

// Bandeja del asesor
r.use(requiereModulo('whatsapp'), autorizar('admin', 'supervisor', 'asesor'));
r.get('/resumen', c.resumen);
r.get('/conversaciones', c.listar);
r.get('/conversaciones/:id', c.detalle);
r.get('/conversaciones/:id/nuevos', c.nuevos);
r.post('/conversaciones/:id/leida', c.leida);
r.post('/conversaciones/:id/tomar', c.tomar);
r.post('/conversaciones/:id/liberar', c.liberar);
r.post('/conversaciones/:id/bot', c.aBot);
r.post('/conversaciones/:id/cerrar', c.cerrar);
r.post('/conversaciones/:id/mensajes', c.responder);
r.post('/conversaciones/:id/pedido', c.crearPedido);
r.get('/productos', c.productos);
r.post('/cotizar', c.cotizar);
r.get('/media/:mensaje/:i', c.media);
r.post('/simular', c.simular);

module.exports = r;
