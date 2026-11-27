const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const Empresa = require('../models/Empresa');
const CuentaCliente = require('../models/CuentaCliente');
const { paisDe } = require('../utils/contexto');
const { pruebaVencida } = require('../utils/prueba');

// Con la prueba vencida solo se puede cargar el panel, ver la sesión y suscribirse
const permitidoSinPlan = req => {
  const ruta = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return ruta.startsWith('/api/v1/cuenta/suscripcion') || ruta.startsWith('/api/v1/auth/') || (req.method === 'GET' && ruta === '/api/v1/configuracion');
};

// Dos mundos de autenticación que no se mezclan:
//  - `proteger`:        personal de la empresa (Usuario). Token sin audience.
//  - `protegerCliente`: app / tienda en línea (CuentaCliente). Audience 'cliente'.
const AUD_CLIENTE = 'cliente';
const AUD_AUTORIZACION = 'autorizacion';

const firmarToken = id => jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
const firmarTokenCliente = id => jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { audience: AUD_CLIENTE, expiresIn: '90d' });
// Autorización puntual de un supervisor (PIN) para la caja: 5 minutos
const firmarAutorizacion = (usuario, empresa) => jwt.sign({ id: String(usuario), empresa: String(empresa) }, process.env.JWT_SECRET, { audience: AUD_AUTORIZACION, expiresIn: '5m' });
const leerAutorizacion = (token, empresa) => {
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET, { audience: AUD_AUTORIZACION });
    return d.empresa === String(empresa) ? d.id : null;
  } catch { return null; }
};

const tokenDe = req => {
  const auth = req.headers.authorization;
  return auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
};

// Deja req.usuario, req.empresa y req.pais (lean)
const proteger = async (req, res, next) => {
  const token = tokenDe(req);
  if (!token) return res.status(401).json({ success: false, error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.aud) return res.status(401).json({ success: false, error: 'Token inválido' });
    req.usuario = await Usuario.findById(decoded.id).lean();
    if (!req.usuario || !req.usuario.estado) return res.status(401).json({ success: false, error: 'Usuario inactivo o no encontrado' });

    const empresaId = req.usuario.rol === 'super' ? req.headers['x-empresa'] : req.usuario.empresa;
    req.empresa = null;
    if (empresaId && /^[a-f\d]{24}$/i.test(String(empresaId))) req.empresa = await Empresa.findById(empresaId).lean();
    if (req.usuario.rol !== 'super' && (!req.empresa || !req.empresa.estado)) {
      return res.status(403).json({ success: false, error: 'La empresa asociada a esta cuenta está inactiva', codigo: 'EMPRESA_INACTIVA' });
    }
    // Prueba gratis vencida: la cuenta queda en pausa (sin borrar nada). Solo se puede
    // entrar al panel para elegir un plan en "Mi suscripción".
    if (req.usuario.rol !== 'super' && pruebaVencida(req.empresa) && !permitidoSinPlan(req)) {
      return res.status(402).json({ success: false, error: 'La prueba gratis de tu negocio terminó. El administrador puede elegir un plan en el panel → Mi suscripción, y todo vuelve a funcionar al instante.', codigo: 'PRUEBA_VENCIDA' });
    }
    if (req.empresa) req.pais = await paisDe(req.empresa);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }
};

const autorizar = (...roles) => (req, res, next) =>
  (req.usuario.rol === 'super' || roles.includes(req.usuario.rol))
    ? next()
    : res.status(403).json({ success: false, error: 'Sin permisos para esta acción' });

const soloSuper = (req, res, next) =>
  req.usuario.rol === 'super' ? next() : res.status(403).json({ success: false, error: 'Exclusivo del equipo Katú' });

const requiereEmpresa = (req, res, next) =>
  req.empresa ? next() : res.status(400).json({ success: false, error: 'Selecciona una empresa', codigo: 'SIN_EMPRESA' });

const requiereModulo = modulo => (req, res, next) =>
  req.empresa?.modulos?.[modulo]
    ? next()
    : res.status(403).json({ success: false, error: 'Este módulo no está habilitado para tu empresa. Comunícate con el equipo de Katú.', codigo: 'MODULO_INACTIVO' });

const _cuenta = async req => {
  const token = tokenDe(req);
  if (!token) return null;
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET, { audience: AUD_CLIENTE });
    const c = await CuentaCliente.findById(d.id).lean();
    return c && c.estado ? c : null;
  } catch { return null; }
};
const protegerCliente = async (req, res, next) => {
  req.cuenta = await _cuenta(req);
  return req.cuenta ? next() : res.status(401).json({ success: false, error: 'Inicia sesión para continuar' });
};
const clienteOpcional = async (req, res, next) => { req.cuenta = await _cuenta(req); next(); };

module.exports = { proteger, autorizar, soloSuper, requiereEmpresa, requiereModulo, protegerCliente, clienteOpcional, firmarToken, firmarTokenCliente, firmarAutorizacion, leerAutorizacion };
