const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const Sede = require('../models/Sede');
const Caja = require('../models/Caja');
const { ErrorApi, paisPorCodigo } = require('./contexto');

// ── Alta de empresas (la usan el admin de Katú y la suscripción automática) ──
// El identificador web (slug) es también el subdominio: <slug>.katupos.com
const RESERVADOS = ['www', 'app', 'api', 'admin', 'panel', 'pos', 'mail', 'correo', 'smtp', 'ftp', 'soporte', 'ayuda', 'help', 'status', 'blog', 'katu', 'katupos', 'static', 'cdn', 'portainer', 'dev', 'staging', 'test', 'demo'];
const slugValido = s => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVADOS.includes(s);
const normalizarSlug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// admin.password vacío → contraseña aleatoria; el administrador crea la suya con el enlace
async function crearEmpresa(b, { admin: a = {} } = {}) {
  const pais = await paisPorCodigo(String(b.pais || '').toUpperCase()).catch(() => null);
  if (!pais || !pais.activo) throw new ErrorApi('Elige un país válido');
  const slug = String(b.slug || '').toLowerCase().trim();
  if (!slugValido(slug)) throw new ErrorApi('El identificador web solo lleva letras, números y guiones (3 a 40) y no puede ser una palabra reservada');
  if (await Empresa.exists({ slug })) throw new ErrorApi('Ese identificador web ya está en uso', 409);
  const sinClave = !a.password;
  if (!a.nombre || !a.correo || (!sinClave && a.password.length < 8)) throw new ErrorApi('El administrador necesita nombre, correo y contraseña de al menos 8 caracteres');
  if (await Usuario.exists({ correo: String(a.correo).toLowerCase().trim() })) throw new ErrorApi('El correo del administrador ya está en uso', 409);
  const zona = b.zonaHoraria || pais.zonaHoraria;
  if (!pais.zonasHorarias.includes(zona)) throw new ErrorApi('La zona horaria no corresponde al país');
  const empresa = await Empresa.create({ nombre: b.nombre, razonSocial: b.razonSocial, idFiscal: b.idFiscal, slug, pais: pais.codigo, zonaHoraria: zona, correo: b.correo, telefono: b.telefono, direccion: b.direccion, ciudad: b.ciudad, modulos: b.modulos, ...(b.suscripcion && { suscripcion: b.suscripcion }) });
  let usuario;
  try {
    const sede = await Sede.create({ empresa: empresa._id, nombre: 'Principal', direccion: b.direccion, ciudad: b.ciudad });
    await Caja.create({ empresa: empresa._id, sede: sede._id, nombre: 'Caja 1' });
    usuario = await Usuario.create({ nombre: a.nombre, correo: a.correo, telefono: a.telefono || '', password: sinClave ? crypto.randomBytes(24).toString('base64url') : a.password, rol: 'admin', empresa: empresa._id });
  } catch (e) {
    await Promise.all([Sede.deleteMany({ empresa: empresa._id }), Caja.deleteMany({ empresa: empresa._id }), Empresa.deleteOne({ _id: empresa._id })]);
    throw e;
  }
  return { empresa: empresa.toObject(), usuario };
}

// Enlace para crear o recuperar la contraseña: se guarda solo el hash del token
async function enlaceClave(usuarioId, { horas = 72 } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await Usuario.updateOne({ _id: usuarioId }, { claveToken: crypto.createHash('sha256').update(token).digest('hex'), claveVence: new Date(Date.now() + horas * 3600000) });
  return token;
}
async function usarEnlaceClave(token, password) {
  if (!token || String(password || '').length < 8) throw new ErrorApi('La contraseña debe tener al menos 8 caracteres');
  const u = await Usuario.findOne({ claveToken: crypto.createHash('sha256').update(String(token)).digest('hex'), claveVence: { $gt: new Date() }, estado: true }).select('+claveToken');
  if (!u) throw new ErrorApi('El enlace no es válido o ya venció. Pide uno nuevo.', 400, 'ENLACE_INVALIDO');
  u.password = password; u.claveToken = undefined; u.claveVence = undefined;
  await u.save();
  return u;
}

// https://<slug>.katupos.com (o PUBLIC_URL si no hay dominio base, en desarrollo)
const urlEmpresa = slug => { const d = String(process.env.DOMINIO_BASE || '').trim(); return d ? `https://${slug}.${d}` : String(process.env.PUBLIC_URL || 'http://localhost:3008').replace(/\/+$/, ''); };

module.exports = { crearEmpresa, slugValido, normalizarSlug, RESERVADOS, enlaceClave, usarEnlaceClave, urlEmpresa };
