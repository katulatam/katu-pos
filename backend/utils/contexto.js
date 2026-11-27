const Pais = require('../models/Pais');
const Motor = require('../../frontend/assets/js/motor');

// País de una empresa, con caché corta (cambia muy poco y se lee en cada petición)
const cache = new Map();
async function paisPorCodigo(codigo) {
  const c = cache.get(codigo);
  if (c && c.hasta > Date.now()) return c.pais;
  const pais = await Pais.findOne({ codigo }).lean();
  if (!pais) throw new Error(`El país ${codigo} no está configurado`);
  cache.set(codigo, { pais, hasta: Date.now() + 30000 });
  return pais;
}
const paisDe = empresa => paisPorCodigo(empresa.pais);
const limpiarCachePaises = () => cache.clear();

const ahoraDe = (empresa, sede, fecha) => Motor.ahoraEnZona((sede && sede.zonaHoraria) || empresa.zonaHoraria, fecha);

// Límites UTC [desde, hasta) de un rango de fechas locales de la empresa
function rangoUtc(empresa, desde, hasta) {
  const { DateTime } = require('luxon');
  const zone = empresa.zonaHoraria;
  const hoy = DateTime.now().setZone(zone).toISODate();
  const ini = DateTime.fromISO(desde || hoy, { zone }).startOf('day');
  const fin = DateTime.fromISO(hasta || desde || hoy, { zone }).plus({ days: 1 }).startOf('day');
  if (!ini.isValid || !fin.isValid) throw Object.assign(new Error('Rango de fechas inválido'), { status: 400 });
  return { $gte: ini.toJSDate(), $lt: fin.toJSDate() };
}

// Impuesto de un producto según el catálogo del país
function impuestoDe(pais, codigo) {
  const i = (pais.impuestos || []).find(x => x.codigo === codigo)
    || (pais.impuestos || []).find(x => x.codigo === pais.impuestoDefecto)
    || { codigo: '', tipo: 'excluido', pct: 0 };
  return { impuestoCodigo: i.codigo, impuestoTipo: i.tipo, impuestoPct: i.pct };
}

// Medios de pago activos de la empresa, en orden y con los datos del país
function mediosDe(empresa, pais, canal) {
  const cfg = new Map((empresa.mediosPago || []).map(m => [m.codigo, m]));
  return (pais.mediosPago || []).map((m, i) => {
    const c = cfg.get(m.codigo);
    return { ...m, activo: c ? c.activo : true, canales: c && c.canales && c.canales.length ? c.canales : ['caja', 'domicilio', 'kiosco'], orden: c?.orden ?? i };
  }).filter(m => !canal || (m.activo && m.canales.includes(canal) && (m.tipo !== 'fiado' || (empresa.modulos?.fiado && canal === 'caja'))))
    .sort((a, b) => a.orden - b.orden);
}

// Error de negocio con código HTTP
class ErrorApi extends Error { constructor(mensaje, status = 400, codigo) { super(mensaje); this.status = status; this.codigo = codigo; } }

// Envuelve un controlador: { success, data } o error con su código
const manejar = fn => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, error: 'Ya existe un registro con ese dato (código, documento, correo o tag repetido)' });
    if (error.name === 'CastError') return res.status(400).json({ success: false, error: 'Identificador o dato inválido' });
    if (error.name === 'ValidationError') return res.status(400).json({ success: false, error: Object.values(error.errors || {})[0]?.message || error.message });
    if (!error.status) console.error(`[${req.method} ${req.originalUrl}]`, error);
    res.status(error.status || 500).json({ success: false, error: error.message, ...(error.codigo && { codigo: error.codigo }) });
  }
};

module.exports = { paisDe, paisPorCodigo, limpiarCachePaises, ahoraDe, rangoUtc, impuestoDe, mediosDe, ErrorApi, manejar };
