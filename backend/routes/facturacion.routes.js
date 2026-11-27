const r = require('express').Router();
const c = require('../controllers/facturacion.controller');
const { proteger, autorizar, soloSuper, requiereEmpresa, requiereModulo } = require('../middleware/auth');

r.post('/webhook/:empresa', c.webhook);
r.use(proteger, requiereEmpresa, requiereModulo('facturacion'), autorizar('admin', 'supervisor'));
r.get('/', c.estado);
r.get('/resumen', c.resumen);
r.get('/resoluciones', autorizar('admin'), c.resoluciones);
r.put('/resolucion', autorizar('admin'), c.guardarResolucion);
r.put('/activar', soloSuper, c.activar);
r.get('/emisores', soloSuper, c.emisores);
r.post('/emisores', soloSuper, c.crearEmisor);
r.put('/emisores', soloSuper, c.vincular);
r.get('/emisor', soloSuper, c.estadoEmisor);
r.post('/habilitar', soloSuper, c.habilitar);
r.post('/registrar-webhook', soloSuper, c.registrarWebhook);
r.get('/tabla/:tabla', soloSuper, c.tabla);

module.exports = r;
