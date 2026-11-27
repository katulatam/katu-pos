const router = require('express').Router;
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

// Rutas estándar de un CRUD: leer (cualquier rol de panel) y escribir (roles)
module.exports = (ctrl, { roles = ['admin'], modulo } = {}) => {
  const r = router();
  r.use(proteger, requiereEmpresa);
  if (modulo) r.use(requiereModulo(modulo));
  r.get('/', ctrl.listar);
  r.post('/', autorizar(...roles), ctrl.crear);
  r.put('/:id', autorizar(...roles), ctrl.actualizar);
  r.delete('/:id', autorizar(...roles), ctrl.eliminar);
  return r;
};
