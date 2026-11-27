const r = require('express').Router();
const c = require('../controllers/pedidos.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, requiereModulo('domicilios'), autorizar('admin', 'supervisor', 'cajero', 'bodega'));
r.get('/', c.listar);
r.get('/tablero', c.tablero);
r.get('/por-liquidar', c.porLiquidar);
r.post('/liquidar', autorizar('admin', 'supervisor', 'cajero'), c.liquidar);
r.post('/cotizar', c.cotizar);
r.post('/', c.crear);
r.get('/:id', c.detalle);
r.put('/:id/alistar', c.alistar);
r.put('/:id/estado', c.estado);

module.exports = r;
