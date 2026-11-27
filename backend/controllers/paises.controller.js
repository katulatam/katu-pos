const Pais = require('../models/Pais');
const Empresa = require('../models/Empresa');
const { manejar, ErrorApi, limpiarCachePaises } = require('../utils/contexto');
const { PROVEEDORES } = require('../utils/facturacion');

const CAMPOS = ['nombre', 'moneda', 'simbolo', 'decimales', 'locale', 'zonaHoraria', 'zonasHorarias', 'prefijoTelefono', 'nombreIdFiscal', 'redondeoEfectivo', 'billetes', 'impuestos', 'impuestoDefecto', 'tiposDocumento', 'consumidorFinal', 'mediosPago', 'facturacion', 'bolsas', 'activo'];
const zonaValida = z => { try { new Intl.DateTimeFormat('es', { timeZone: z }); return !!z; } catch { return false; } };
function validar(d) {
  if (d.zonaHoraria && !zonaValida(d.zonaHoraria)) throw new ErrorApi('Zona horaria inválida');
  if (d.zonasHorarias && !d.zonasHorarias.every(zonaValida)) throw new ErrorApi('Hay una zona horaria inválida en la lista');
  if (d.zonaHoraria && d.zonasHorarias && !d.zonasHorarias.includes(d.zonaHoraria)) d.zonasHorarias.unshift(d.zonaHoraria);
  if (d.decimales !== undefined && ![0, 1, 2, 3, 4].includes(Number(d.decimales))) throw new ErrorApi('Los decimales van de 0 a 4');
  if (d.moneda) { try { new Intl.NumberFormat('es', { style: 'currency', currency: d.moneda }); } catch { throw new ErrorApi('Código de moneda inválido (ISO 4217)'); } }
  if (d.locale) { try { new Intl.NumberFormat(d.locale); } catch { throw new ErrorApi('Configuración regional inválida (ej. es-CO)'); } }
  if (d.impuestos && d.impuestoDefecto && !d.impuestos.some(i => i.codigo === d.impuestoDefecto)) throw new ErrorApi('El impuesto por defecto no está en la lista');
  if (d.facturacion?.proveedor && !PROVEEDORES[d.facturacion.proveedor]) throw new ErrorApi('Proveedor de facturación no soportado');
  if (d.bolsas) { d.bolsas = { moneda: String(d.bolsas.moneda || 'USD').toUpperCase().trim(), paquetes: (d.bolsas.paquetes || []).map(p => ({ canal: p.canal, cantidad: Number(p.cantidad), precio: Number(p.precio) })) }; require('../utils/bolsas').validarPaquetes(d.bolsas); }
  if (d.facturacion?.ofrecida && !d.facturacion.proveedor) throw new ErrorApi('Para ofrecer facturación electrónica en el país elige su proveedor');
}

exports.listar = manejar(async () => {
  const [paises, n] = await Promise.all([Pais.find().sort({ nombre: 1 }).lean(), Empresa.aggregate([{ $group: { _id: '$pais', n: { $sum: 1 } } }])]);
  const m = Object.fromEntries(n.map(x => [x._id, x.n]));
  return { paises: paises.map(p => ({ ...p, empresas: m[p.codigo] || 0 })), proveedores: Object.keys(PROVEEDORES) };
});
exports.crear = manejar(async req => {
  const codigo = String(req.body.codigo || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(codigo)) throw new ErrorApi('El código del país son 2 letras (ISO)');
  const d = Object.fromEntries(CAMPOS.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  validar(d);
  const p = await Pais.create({ ...d, codigo });
  limpiarCachePaises();
  return p;
});
exports.actualizar = manejar(async req => {
  const doc = await Pais.findById(req.params.id);
  if (!doc) throw new ErrorApi('País no encontrado', 404);
  const d = Object.fromEntries(CAMPOS.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  validar(d);
  // Cambiar moneda o decimales con empresas operando descuadraría su historia
  if (((d.moneda && d.moneda !== doc.moneda) || (d.decimales !== undefined && Number(d.decimales) !== doc.decimales)) && await Empresa.exists({ pais: doc.codigo })) {
    throw new ErrorApi('No se puede cambiar la moneda ni los decimales: ya hay empresas en este país', 409);
  }
  doc.set(d);
  await doc.save();
  limpiarCachePaises();
  return doc;
});
