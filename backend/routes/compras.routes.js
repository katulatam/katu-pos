const r = require('express').Router();
const c = require('../controllers/compras.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'bodega'));
r.get('/', c.listar);
r.post('/', c.crear);

module.exports = r;
