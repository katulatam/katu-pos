const Usuario = require('../models/Usuario');
const { manejar, ErrorApi } = require('../utils/contexto');

const ROLES = ['admin', 'supervisor', 'cajero', 'bodega', 'domiciliario', 'asesor'];
const publico = u => { const o = { ...u }; delete o.password; o.tienePin = !!o.pin; delete o.pin; delete o.ubicacion; return o; };

exports.listar = manejar(async req => (await Usuario.find({ empresa: req.empresa._id, oculto: { $ne: true }, ...(req.query.rol && { rol: req.query.rol }) }).select('+pin').sort({ nombre: 1 }).lean()).map(publico));

exports.crear = manejar(async (req, res) => {
  const b = req.body;
  if (!ROLES.includes(b.rol)) throw new ErrorApi('Rol inválido');
  if (!b.password || b.password.length < 8) throw new ErrorApi('La contraseña debe tener al menos 8 caracteres');
  if (b.pin && !/^\d{4,6}$/.test(b.pin)) throw new ErrorApi('El PIN son 4 a 6 dígitos');
  const u = await Usuario.create({ nombre: b.nombre, correo: b.correo, password: b.password, pin: b.pin || undefined, rol: b.rol, sede: b.sede || undefined, telefono: b.telefono, vehiculo: b.vehiculo, empresa: req.empresa._id });
  res.status(201);
  return publico(u.toObject());
});

exports.actualizar = manejar(async req => {
  const u = await Usuario.findOne({ _id: req.params.id, empresa: req.empresa._id, oculto: { $ne: true } });
  if (!u) throw new ErrorApi('Usuario no encontrado', 404);
  const b = req.body;
  if (b.rol && !ROLES.includes(b.rol)) throw new ErrorApi('Rol inválido');
  const pierdeAdmin = u.rol === 'admin' && ((b.rol && b.rol !== 'admin') || b.estado === false);
  if (pierdeAdmin && await Usuario.countDocuments({ empresa: req.empresa._id, rol: 'admin', estado: true, oculto: { $ne: true } }) <= 1) throw new ErrorApi('Debe quedar al menos un administrador activo', 409);
  ['nombre', 'correo', 'rol', 'telefono', 'vehiculo', 'estado'].forEach(k => { if (b[k] !== undefined) u[k] = b[k]; });
  if (b.sede !== undefined) u.sede = b.sede || undefined;
  if (b.password) { if (b.password.length < 8) throw new ErrorApi('La contraseña debe tener al menos 8 caracteres'); u.password = b.password; }
  if (b.pin) { if (!/^\d{4,6}$/.test(b.pin)) throw new ErrorApi('El PIN son 4 a 6 dígitos'); u.pin = b.pin; }
  await u.save();
  return publico(u.toObject());
});
