const r = require('express').Router();
const c = require('../controllers/usuarios.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa);
r.get('/', autorizar('admin', 'supervisor'), c.listar);
r.post('/', autorizar('admin'), c.crear);
r.put('/:id', autorizar('admin'), c.actualizar);

module.exports = r;
