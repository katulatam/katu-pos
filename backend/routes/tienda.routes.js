const r = require('express').Router();
const c = require('../controllers/tienda.controller');
const { protegerCliente, clienteOpcional } = require('../middleware/auth');
const limitar = require('../middleware/limitar');

const acceso = limitar({ max: 10, clave: req => `${req.ip}|${req.body?.telefono || ''}` });
r.post('/cuenta/registro', limitar({ max: 8, ventanaMs: 600000 }), c.registro);
r.post('/cuenta/login', acceso, c.login);
r.get('/cuenta/yo', protegerCliente, c.yo);
r.get('/cuenta/qr', protegerCliente, c.qr);
r.put('/cuenta/direcciones', protegerCliente, c.direcciones);
r.get('/cuenta/pedidos', protegerCliente, c.misPedidos);
r.get('/paises', c.paises);
r.get('/cercanas', limitar({ max: 60 }), c.cercanas);

r.get('/t/:slug/catalogo', c.cargarEmpresa, c.catalogo);
r.post('/t/:slug/cotizar', limitar({ max: 60 }), c.cargarEmpresa, c.cotizar);
r.post('/t/:slug/pedidos', limitar({ max: 8 }), c.cargarEmpresa, clienteOpcional, c.crearPedido);
r.get('/t/:slug/juego', protegerCliente, c.cargarEmpresa, c.juego);
r.post('/t/:slug/girar/:venta', protegerCliente, c.cargarEmpresa, c.girar);

module.exports = r;
