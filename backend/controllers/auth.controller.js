const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const Empresa = require('../models/Empresa');
const { firmarToken, firmarAutorizacion } = require('../middleware/auth');
const { manejar, ErrorApi } = require('../utils/contexto');

const usuarioPublico = u => ({ id: u._id, nombre: u.nombre, correo: u.correo, rol: u.rol, empresa: u.empresa, sede: u.sede });

exports.login = manejar(async req => {
  const { correo, password } = req.body;
  if (!correo || !password) throw new ErrorApi('Correo y contraseña son requeridos');
  const usuario = await Usuario.findOne({ correo: String(correo).toLowerCase().trim() }).select('+password');
  if (!usuario || !usuario.estado || !(await usuario.compararPassword(password))) throw new ErrorApi('Credenciales inválidas', 401);
  let empresa = null;
  if (usuario.rol !== 'super') {
    empresa = await Empresa.findById(usuario.empresa).lean();
    if (!empresa) throw new ErrorApi('La empresa asociada a esta cuenta está inactiva', 403);
    if (req.tenant && empresa.slug !== req.tenant) throw new ErrorApi('Esta cuenta no pertenece a este negocio. Entra desde la dirección de tu negocio.', 403, 'OTRO_NEGOCIO');
    if (!empresa.estado) throw new ErrorApi(['mora', 'cancelada'].includes(empresa.suscripcion?.estado) ? 'Tu suscripción está suspendida por falta de pago. Revisa el correo de cobro de Stripe para actualizar tu tarjeta, o escríbenos a soporte.' : 'La empresa asociada a esta cuenta está inactiva', 403, 'EMPRESA_INACTIVA');
  }
  await Usuario.updateOne({ _id: usuario._id }, { ultimoAcceso: new Date() });
  return { token: firmarToken(usuario._id), user: usuarioPublico(usuario), empresa: empresa && { _id: empresa._id, nombre: empresa.nombre, slug: empresa.slug } };
});

// Crear la contraseña (bienvenida) o recuperarla con el enlace del correo
exports.crearClave = manejar(async req => {
  const u = await require('../utils/empresas').usarEnlaceClave(req.body.token, req.body.password);
  return { correo: u.correo };
});
// Siempre responde lo mismo: no revela si el correo existe
exports.olvide = manejar(async req => {
  const correo = String(req.body.correo || '').toLowerCase().trim();
  const u = correo && await Usuario.findOne({ correo, estado: true, rol: { $ne: 'super' } }).lean();
  if (u) {
    const emp = require('../utils/empresas');
    const e = await Empresa.findById(u.empresa).lean();
    if (e) {
      const token = await emp.enlaceClave(u._id, { horas: 2 });
      const url = `${emp.urlEmpresa(e.slug)}/admin/activar.html?t=${token}&r=1`;
      await require('../utils/correo/sendgrid').enviar({ a: u.correo, asunto: 'Recupera tu contraseña de Katú POS', nombreRemitente: 'Katú POS', texto: `Hola ${u.nombre.split(' ')[0]}:\n\nPara crear una contraseña nueva entra aquí (vence en 2 horas):\n${url}\n\nSi no la pediste, ignora este correo.`, html: `<p>Hola ${u.nombre.split(' ')[0].replace(/[<>&]/g, '')}:</p><p>Para crear una contraseña nueva entra aquí (vence en 2 horas):</p><p><a href="${url}">Crear contraseña nueva</a></p><p style="color:#51637F">Si no la pediste, ignora este correo.</p>` }).catch(err => console.error('[auth.olvide]', err.message));
    }
  }
  return { ok: true };
});

exports.yo = manejar(async req => ({ user: usuarioPublico(req.usuario) }));

exports.cambiarPassword = manejar(async req => {
  const { passwordActual, passwordNuevo } = req.body;
  if (!passwordNuevo || passwordNuevo.length < 8) throw new ErrorApi('La nueva contraseña debe tener al menos 8 caracteres');
  const usuario = await Usuario.findById(req.usuario._id).select('+password');
  if (!(await usuario.compararPassword(passwordActual))) throw new ErrorApi('Contraseña actual incorrecta');
  usuario.password = passwordNuevo;
  await usuario.save();
  return { cambiada: true };
});

// PIN de supervisor/admin en la caja → autorización de 5 minutos
exports.autorizarPin = manejar(async req => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new ErrorApi('PIN inválido');
  const lista = await Usuario.find({ empresa: req.empresa._id, estado: true, rol: { $in: ['admin', 'supervisor'] }, pin: { $exists: true, $ne: '' } }).select('+pin nombre').lean();
  for (const u of lista) if (await bcrypt.compare(pin, u.pin)) return { token: firmarAutorizacion(u._id, req.empresa._id), nombre: u.nombre };
  throw new ErrorApi('PIN incorrecto', 403);
});
