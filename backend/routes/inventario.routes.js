const r = require('express').Router();
const c = require('../controllers/inventario.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'bodega'));
r.get('/', c.existencias);
r.get('/vencimientos', c.vencimientos);
r.get('/reabastecer', c.reabastecer);
r.get('/kardex/:producto', c.kardex);
r.post('/ajuste', autorizar('admin', 'bodega'), c.ajustar);
r.post('/traslado', autorizar('admin', 'bodega'), c.trasladar);

module.exports = r;
