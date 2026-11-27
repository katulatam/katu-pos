const r = require('express').Router();
const c = require('../controllers/dispositivos.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin'));
r.get('/', c.listar);
r.post('/', c.crear);
r.put('/:id', c.actualizar);
r.post('/:id/regenerar', c.regenerar);

module.exports = r;
