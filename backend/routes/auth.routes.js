const r = require('express').Router();
const c = require('../controllers/auth.controller');
const { proteger, requiereEmpresa } = require('../middleware/auth');
const limitar = require('../middleware/limitar');

r.post('/login', limitar({ max: 10, clave: req => `${req.ip}|${String(req.body?.correo || '').toLowerCase()}` }), c.login);
r.get('/yo', proteger, c.yo);
r.post('/crear-clave', limitar({ max: 10 }), c.crearClave);
r.post('/olvide', limitar({ max: 5, ventanaMs: 15 * 60000, clave: req => req.ip }), c.olvide);
r.put('/cambiar-password', proteger, limitar({ max: 6, clave: req => req.usuario._id }), c.cambiarPassword);
r.post('/autorizar-pin', proteger, requiereEmpresa, limitar({ max: 6, clave: req => `${req.empresa._id}|${req.usuario._id}` }), c.autorizarPin);

module.exports = r;
