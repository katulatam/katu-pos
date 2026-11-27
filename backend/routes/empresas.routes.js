const r = require('express').Router();
const c = require('../controllers/empresas.controller');
const { proteger, soloSuper } = require('../middleware/auth');

r.use(proteger, soloSuper);
r.get('/', c.listar);
r.post('/', c.crear);
r.put('/:id', c.actualizar);

module.exports = r;
