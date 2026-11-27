const r = require('express').Router();
const c = require('../controllers/ventas.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'cajero'));
r.get('/', c.listar);
r.get('/exportar', autorizar('admin', 'supervisor'), c.exportar);
r.get('/:id', c.detalle);
r.post('/:id/devolver', c.devolver);
r.post('/:id/reintentar-documento', autorizar('admin', 'supervisor'), c.reintentarDocumento);

module.exports = r;
