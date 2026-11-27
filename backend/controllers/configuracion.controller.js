const Empresa = require('../models/Empresa');
const { manejar, ErrorApi, mediosDe, paisPorCodigo } = require('../utils/contexto');
const { modoDemo } = require('../utils/cobros');
const { proveedorDe } = require('../utils/facturacion');

const paisPublico = p => ({ codigo: p.codigo, nombre: p.nombre, moneda: p.moneda, simbolo: p.simbolo, decimales: p.decimales, locale: p.locale, zonaHoraria: p.zonaHoraria, zonasHorarias: p.zonasHorarias, prefijoTelefono: p.prefijoTelefono, nombreIdFiscal: p.nombreIdFiscal, redondeoEfectivo: p.redondeoEfectivo, billetes: p.billetes, impuestos: p.impuestos, impuestoDefecto: p.impuestoDefecto, tiposDocumento: p.tiposDocumento, consumidorFinal: p.consumidorFinal, facturacion: { disponible: !!proveedorDe(p), nombreDocumento: p.facturacion?.nombreDocumento, entidad: p.facturacion?.entidad, codigoUnico: p.facturacion?.codigoUnico } });
exports.paisPublico = paisPublico;

exports.obtener = manejar(async req => {
  if (!req.empresa) return { empresa: null, pais: null };
  return { empresa: req.empresa, pais: paisPublico(req.pais), medios: mediosDe(req.empresa, req.pais), modoDemo: modoDemo() };
});

// Lo que puede cambiar el administrador de la empresa (nunca módulos, país ni slug)
const CAMPOS = ['nombre', 'razonSocial', 'idFiscal', 'correo', 'telefono', 'direccion', 'ciudad', 'logoUrl', 'color', 'zonaHoraria'];
const GRUPOS = {
  pos: ['permitirStockNegativo', 'descuentoMaxCajero', 'redondearEfectivo', 'prefijosBascula', 'contenidoEtiqueta', 'pieTicket', 'arqueoCiego'],
  domicilios: ['recogerEnTienda', 'minutosPreparacion', 'mensajeCerrado'],
  gamificacion: ['montoPorPunto', 'valorPunto', 'minimoRedimir', 'maxPctRedimir', 'niveles', 'ruleta', 'metaDiariaCajero'],
  facturacion: ['facturarConsumidorFinal'],
};
exports.actualizar = manejar(async req => {
  const set = {};
  CAMPOS.forEach(k => { if (req.body[k] !== undefined) set[k] = req.body[k]; });
  if (set.zonaHoraria && !req.pais.zonasHorarias.includes(set.zonaHoraria)) throw new ErrorApi('La zona horaria no corresponde al país');
  if (set.logoUrl && !/^https:\/\//i.test(set.logoUrl)) throw new ErrorApi('El logo debe ser una dirección https');
  if (set.color && !/^#[0-9a-f]{6}$/i.test(set.color)) throw new ErrorApi('Color inválido');
  Object.entries(GRUPOS).forEach(([g, campos]) => campos.forEach(k => { if (req.body[g]?.[k] !== undefined) set[`${g}.${k}`] = req.body[g][k]; }));
  return Empresa.findOneAndUpdate({ _id: req.empresa._id }, { $set: set }, { new: true, runValidators: true }).lean();
});

exports.mediosPago = manejar(async req => {
  const validos = new Set(req.pais.mediosPago.map(m => m.codigo));
  const lista = (Array.isArray(req.body.medios) ? req.body.medios : []).filter(m => validos.has(m.codigo)).map((m, i) => ({
    codigo: m.codigo, activo: !!m.activo, orden: i, canales: (m.canales || []).filter(c => ['caja', 'domicilio', 'kiosco'].includes(c)),
  }));
  const e = await Empresa.findOneAndUpdate({ _id: req.empresa._id }, { mediosPago: lista }, { new: true }).lean();
  return mediosDe(e, req.pais);
});

// Credenciales de la pasarela: solo Katú. El secreto se escribe, nunca se lee.
exports.pasarela = manejar(async req => {
  const { url, clientId, secret, subdominio } = req.body;
  if (url && !/^https?:\/\//i.test(url)) throw new ErrorApi('URL inválida');
  const set = { 'katuPay.url': url || '', 'katuPay.clientId': clientId || '', 'katuPay.subdominio': subdominio || '' };
  if (secret) set['katuPay.secret'] = secret;
  await Empresa.updateOne({ _id: req.empresa._id }, { $set: set });
  return { guardado: true };
});
exports.verPasarela = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).select('+katuPay.secret').lean();
  return { url: e.katuPay?.url, clientId: e.katuPay?.clientId, subdominio: e.katuPay?.subdominio, secretoConfigurado: !!e.katuPay?.secret };
});

exports.paisDeCodigo = manejar(async req => paisPublico(await paisPorCodigo(String(req.params.codigo).toUpperCase())));
