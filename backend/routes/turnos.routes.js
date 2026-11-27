const r = require('express').Router();
const c = require('../controllers/turnos.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'cajero'));
r.get('/', autorizar('admin', 'supervisor'), c.listar);
r.post('/', c.abrir);
r.get('/:id/resumen', c.resumen);
r.post('/:id/movimientos', c.movimiento);
r.post('/:id/cerrar', c.cerrar);

module.exports = r;
