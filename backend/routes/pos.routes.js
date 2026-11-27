const r = require('express').Router();
const c = require('../controllers/pos.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'cajero'));
r.get('/cajas', c.cajas);
r.get('/arranque/:caja', c.arranque);
r.get('/liga', c.liga);
r.get('/clientes/:id', c.clienteJuego);
r.post('/ventas', c.vender);
r.get('/ventas/:venta/documento', c.documento);
r.post('/ventas/:venta/girar', requiereModulo('gamificacion'), c.girar);

module.exports = r;
