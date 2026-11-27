const r = require('express').Router();
const c = require('../controllers/cartera.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, requiereModulo('fiado'), autorizar('admin', 'supervisor', 'cajero'));
r.get('/', c.listar);
r.get('/:cliente', c.movimientos);
r.post('/:cliente/abonos', c.abonar);

module.exports = r;
