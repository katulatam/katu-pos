const crypto = require('crypto');
const Dispositivo = require('../models/Dispositivo');
const Caja = require('../models/Caja');
const { manejar, ErrorApi } = require('../utils/contexto');

exports.listar = manejar(async req => Dispositivo.find({ empresa: req.empresa._id }).populate('caja', 'nombre').sort({ nombre: 1 }).lean());
// El secreto se muestra UNA sola vez (al crear o regenerar)
exports.crear = manejar(async req => {
  const { nombre, tipo, caja } = req.body;
  const c = caja ? await Caja.findOne({ _id: caja, empresa: req.empresa._id }).lean() : null;
  if (caja && !c) throw new ErrorApi('La caja no existe');
  const secret = crypto.randomBytes(32).toString('hex');
  const d = await Dispositivo.create({ empresa: req.empresa._id, nombre, tipo, caja: c?._id, sede: c?.sede, secret, deviceId: `${tipo === 'terminal' ? 'TRM' : 'KSK'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}` });
  return { _id: d._id, deviceId: d.deviceId, secret };
});
exports.actualizar = manejar(async req => {
  const d = await Dispositivo.findOne({ _id: req.params.id, empresa: req.empresa._id });
  if (!d) throw new ErrorApi('Equipo no encontrado', 404);
  if (req.body.nombre) d.nombre = req.body.nombre;
  if (req.body.activo !== undefined) d.activo = !!req.body.activo;
  if (req.body.caja !== undefined) {
    const c = req.body.caja ? await Caja.findOne({ _id: req.body.caja, empresa: req.empresa._id }).lean() : null;
    d.caja = c?._id; d.sede = c?.sede;
  }
  await d.save();
  const o = d.toObject(); delete o.secret;
  return o;
});
exports.regenerar = manejar(async req => {
  const secret = crypto.randomBytes(32).toString('hex');
  const d = await Dispositivo.findOneAndUpdate({ _id: req.params.id, empresa: req.empresa._id }, { secret }, { new: true }).lean();
  if (!d) throw new ErrorApi('Equipo no encontrado', 404);
  return { _id: d._id, deviceId: d.deviceId, secret };
});
