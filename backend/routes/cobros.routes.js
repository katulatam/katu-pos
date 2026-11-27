const r = require('express').Router();
const Caja = require('../models/Caja');
const cobros = require('../utils/cobros');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');
const { manejar, ErrorApi } = require('../utils/contexto');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor', 'cajero'));
r.post('/', manejar(async req => {
  const caja = await Caja.findOne({ _id: req.body.caja, empresa: req.empresa._id }).lean();
  if (!caja) throw new ErrorApi('La caja no existe', 404);
  return cobros.crear({ empresa: req.empresa, pais: req.pais, medio: req.body.medio, monto: req.body.monto, caja, usuario: req.usuario._id, canal: caja.tipo === 'autopago' ? 'kiosco' : 'caja' });
}));
r.get('/:id', manejar(req => cobros.consultar(req.empresa._id, req.params.id)));
r.post('/:id/cancelar', manejar(req => cobros.cancelar(req.empresa._id, req.params.id)));

module.exports = r;
