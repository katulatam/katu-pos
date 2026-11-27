const Venta = require('../../models/Venta');
const Devolucion = require('../../models/Devolucion');
const Empresa = require('../../models/Empresa');
const { paisDe } = require('../contexto');
const { enPrueba } = require('../prueba');

// ── Despachador de facturación electrónica por PAÍS ────────────────────────
// Pais.facturacion.proveedor decide quién emite. Agregar un país es escribir
// su archivo con el mismo contrato y registrarlo aquí:
//   disponible()                                  → ¿credenciales en el .env?
//   emitir(venta, empresa, pais)                  → resultado (o lanza)
//   notaCredito(devolucion, venta, empresa, pais) → resultado (o lanza)
//   consultar(idProveedor)                        → resultado
// resultado: { idProveedor, numero, codigoUnico, urlConsulta, estado, observaciones }
const PROVEEDORES = { alanube_co: require('./alanubeCo') };

const proveedorDe = pais => PROVEEDORES[pais?.facturacion?.proveedor] || null;
// Durante la prueba gratis se configura todo, pero no se emiten documentos reales:
// nadie factura gratis y no quedan facturas a medias si no se suscribe.
const activa = (empresa, pais) => !!(empresa.modulos?.facturacion && empresa.facturacion?.activa && empresa.facturacion?.empresaProveedorId && proveedorDe(pais) && !enPrueba(empresa));

function estadoInicial(empresa, pais, adquiriente) {
  if (!activa(empresa, pais)) return 'no_aplica';
  if (!adquiriente && empresa.facturacion.facturarConsumidorFinal === false) return 'omitida';
  return 'pendiente';
}

const LIBERACION_MS = 90000; // un intento en curso no se repite antes de esto

async function _guardarVenta(id, r) {
  await Venta.updateOne({ _id: id }, { $set: {
    'documento.estado': r.estado, 'documento.error': '', 'documento.proveedor': r.proveedor,
    ...(r.idProveedor && { 'documento.idProveedor': r.idProveedor }),
    ...(r.numero && { 'documento.numero': r.numero }),
    ...(r.codigoUnico && { 'documento.codigoUnico': r.codigoUnico }),
    ...(r.urlConsulta && { 'documento.urlConsulta': r.urlConsulta }),
    ...(r.observaciones && { 'documento.observaciones': r.observaciones }),
  } });
}

// Nunca lanza por fallas del proveedor: deja el error en la venta y el job lo
// reintenta. Siempre es seguro reintentar (número y llave quedan fijos).
async function procesarVenta(id) {
  const limite = new Date(Date.now() - LIBERACION_MS);
  const venta = await Venta.findOneAndUpdate({
    _id: id, 'documento.estado': { $in: ['pendiente', 'error', 'rechazada'] },
    $or: [{ 'documento.ultimoIntento': null }, { 'documento.ultimoIntento': { $lt: limite } }],
  }, { $set: { 'documento.ultimoIntento': new Date() }, $inc: { 'documento.intentos': 1 } }, { new: true }).lean();
  if (!venta) return null;
  try {
    const empresa = await Empresa.findById(venta.empresa).select('+facturacion.resolucion.claveTecnica').lean();
    const pais = await paisDe(empresa);
    const prov = proveedorDe(pais);
    if (!activa(empresa, pais) || !prov.disponible()) throw new Error('La facturación electrónica no está disponible en el servidor');
    const r = await prov.emitir(venta, empresa, pais);
    await _guardarVenta(venta._id, { ...r, proveedor: pais.facturacion.proveedor });
    if (r.estado === 'rechazada') await Venta.updateOne({ _id: id }, { 'documento.error': r.error || 'Documento rechazado' });
    return r;
  } catch (e) {
    console.error(`[facturacion] ${venta.numero}:`, e.message);
    await Venta.updateOne({ _id: id }, { 'documento.estado': 'error', 'documento.error': e.message });
    return null;
  }
}

async function _guardarDevolucion(id, r) {
  await Devolucion.updateOne({ _id: id }, { $set: {
    'documento.estado': r.estado, 'documento.error': '', 'documento.proveedor': r.proveedor,
    ...(r.idProveedor && { 'documento.idProveedor': r.idProveedor }),
    ...(r.numero && { 'documento.numero': r.numero }),
    ...(r.codigoUnico && { 'documento.codigoUnico': r.codigoUnico }),
    ...(r.observaciones && { 'documento.observaciones': r.observaciones }),
  } });
}

async function procesarDevolucion(id) {
  const limite = new Date(Date.now() - LIBERACION_MS);
  const dev = await Devolucion.findOneAndUpdate({
    _id: id, 'documento.estado': { $in: ['pendiente', 'error'] },
    $or: [{ 'documento.ultimoIntento': null }, { 'documento.ultimoIntento': { $lt: limite } }],
  }, { $set: { 'documento.ultimoIntento': new Date() }, $inc: { 'documento.intentos': 1 } }, { new: true }).lean();
  if (!dev) return null;
  const venta = await Venta.findById(dev.venta).lean();
  try {
    const empresa = await Empresa.findById(dev.empresa).lean();
    const pais = await paisDe(empresa);
    const prov = proveedorDe(pais);
    if (!prov?.disponible()) throw new Error('La facturación electrónica no está disponible en el servidor');
    if (!venta.documento?.idProveedor || !['aceptada', 'observaciones', 'emitida'].includes(venta.documento.estado)) {
      throw new Error('La factura de la venta aún no está validada');
    }
    const r = await prov.notaCredito(dev, venta, empresa, pais);
    await _guardarDevolucion(id, { ...r, proveedor: pais.facturacion.proveedor });
    return r;
  } catch (e) {
    await Devolucion.updateOne({ _id: id }, { 'documento.estado': 'error', 'documento.error': e.message });
    return null;
  }
}

// Job: reintentos con espera creciente y refresco de lo que quedó en validación
async function mantenimiento() {
  const desde = new Date(Date.now() - 5 * 86400000);
  const listos = d => Date.now() - new Date(d.documento.ultimoIntento || 0).getTime() > Math.min(360, 2 ** Math.min(d.documento.intentos, 8)) * 60000;
  const ventas = await Venta.find({ 'documento.estado': { $in: ['pendiente', 'error', 'rechazada'] }, createdAt: { $gt: desde } }).select('documento').limit(300).lean();
  for (const v of ventas.filter(listos)) await procesarVenta(v._id);
  const espera = await Venta.find({ 'documento.estado': 'validacion', createdAt: { $gt: desde } }).select('empresa documento').limit(200).lean();
  for (const v of espera) {
    const prov = PROVEEDORES[v.documento.proveedor];
    if (!prov?.disponible()) continue;
    try { await actualizarPorResultado(v.documento.idProveedor, await prov.consultar(v.documento.idProveedor), v.documento.proveedor); }
    catch (e) { console.error('[facturacion.consultar]', e.message); }
  }
  const devs = await Devolucion.find({ 'documento.estado': { $in: ['pendiente', 'error'] }, createdAt: { $gt: desde } }).select('documento').limit(200).lean();
  for (const d of devs.filter(listos)) await procesarDevolucion(d._id);
  const notas = await Devolucion.find({ 'documento.estado': 'validacion', createdAt: { $gt: desde } }).select('documento').limit(200).lean();
  for (const d of notas) {
    const prov = PROVEEDORES[d.documento.proveedor];
    if (!prov?.disponible() || !prov.consultarNota) continue;
    try { await actualizarNota(d.documento.idProveedor, await prov.consultarNota(d.documento.idProveedor), d.documento.proveedor); }
    catch (e) { console.error('[facturacion.consultarNota]', e.message); }
  }
}

// Una nota crédito rechazada después de enviada vuelve a 'error' con llave
// nueva para que el job la reenvíe (la venta ya quedó devuelta en el POS).
async function actualizarNota(idProveedor, r, proveedor) {
  const dev = await Devolucion.findOne({ 'documento.idProveedor': idProveedor }).lean();
  if (!dev || !r) return;
  if (r.estado === 'rechazada') {
    await Devolucion.updateOne({ _id: dev._id }, { $set: { 'documento.estado': 'error', 'documento.error': r.error || 'Documento rechazado', 'documento.idProveedor': '', 'documento.llave': '', ...(r.numeroUsado && { 'documento.numeroReservado': null }) } });
  } else await _guardarDevolucion(dev._id, { ...r, proveedor });
}

// Resultado que llega por webhook o por consulta
async function actualizarPorResultado(idProveedor, r, proveedor) {
  const venta = await Venta.findOne({ 'documento.idProveedor': idProveedor }).lean();
  if (!venta || !r) return;
  if (r.estado === 'rechazada') {
    // El documento no vale: se libera para reintentar con llave nueva
    await Venta.updateOne({ _id: venta._id }, { $set: { 'documento.estado': 'rechazada', 'documento.error': r.error || 'Documento rechazado', 'documento.idProveedor': '', 'documento.llave': '', ...(r.numeroUsado && { 'documento.numeroReservado': null }) } });
  } else await _guardarVenta(venta._id, { ...r, proveedor });
}

module.exports = { PROVEEDORES, proveedorDe, activa, estadoInicial, procesarVenta, procesarDevolucion, mantenimiento, actualizarPorResultado, actualizarNota };
