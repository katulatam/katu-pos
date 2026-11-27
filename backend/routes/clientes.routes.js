const r = require('express').Router();
const c = require('../controllers/clientes.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'cajero'));
r.get('/', c.listar);
r.get('/buscar', c.buscar);
r.get('/:id', c.detalle);
r.post('/', c.crear);
r.put('/:id', c.actualizar);
r.post('/:id/vincular-app', c.vincularApp);
r.post('/:id/puntos', requiereModulo('gamificacion'), autorizar('admin'), c.ajustarPuntos);

module.exports = r;
