const r = require('express').Router();
const c = require('../controllers/reportes.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor'));
r.get('/dashboard', c.dashboard);
r.get('/ventas', c.ventas);

module.exports = r;
