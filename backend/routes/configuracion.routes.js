const r = require('express').Router();
const c = require('../controllers/configuracion.controller');
const { proteger, autorizar, soloSuper, requiereEmpresa } = require('../middleware/auth');

r.use(proteger);
r.get('/', c.obtener);
r.put('/', requiereEmpresa, autorizar('admin'), c.actualizar);
r.put('/medios-pago', requiereEmpresa, autorizar('admin'), c.mediosPago);
r.get('/pasarela', requiereEmpresa, soloSuper, c.verPasarela);
r.put('/pasarela', requiereEmpresa, soloSuper, c.pasarela);

module.exports = r;
