const crypto = require('crypto');
const axios = require('axios');
const Empresa = require('../../models/Empresa');
const Venta = require('../../models/Venta');
const Devolucion = require('../../models/Devolucion');
const { ahoraDe } = require('../contexto');

// ── Colombia — factura electrónica de venta (DIAN) ─────────────────────────
// Adaptación multiempresa de la integración ya probada en katu_school. Modelo
// reseller: Katú tiene UNA cuenta con token maestro (.env) y cada comercio es
// una empresa asociada. El token nunca se guarda en la BD ni sale en respuestas.
//  - El número lo asigna Katú (reserva atómica dentro de la resolución).
//  - Número e Idempotency-Key se fijan una vez por documento y se reusan en
//    los reintentos: un timeout nunca produce dos facturas.
//  - Los mensajes que ve el comercio no nombran al proveedor.
const URL_PRODUCCION = 'https://api.alegra.com/e-provider/col/v1';
const URL_SANDBOX = 'https://sandbox-api.alegra.com/e-provider/col/v1';
const CONSUMIDOR_FINAL = { name: 'Consumidor Final', organizationType: 2, identificationType: '13', identificationNumber: '222222222222' };
const MEDIO = { efectivo: '10', datafono: '48', qr: '47', manual: '47', fiado: 'ZZZ' };
const UNIDAD = { und: '94', kg: 'KGM', lt: 'LTR', m: 'MTR' };
const TRIBUTO = { iva: '01', inc: '04' };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function config() {
  const token = String(process.env.ALANUBE_TOKEN || '').trim();
  const url = (String(process.env.ALANUBE_API_URL || '').trim() || URL_PRODUCCION).replace(/\/+$/, '');
  return { token, url, sandbox: url === URL_SANDBOX };
}
const disponible = () => !!config().token;

class ErrorProveedor extends Error {
  // definitivo = rechazó la petición (4xx): no se emitió nada y hace falta llave nueva
  constructor(m, { status = 0, definitivo = false } = {}) { super(m); this.codigoHttp = status; this.definitivo = definitivo; this.status = definitivo ? 400 : 502; }
}
// Regla DIAN 90: ese número ya se usó → hay que reservar otro
const numeroYaUsado = d => /Regla:\s*90\b|rule 90\b/i.test(d || '');
const mensaje = data => {
  const l = Array.isArray(data) ? data : data?.errors;
  if (Array.isArray(l) && l.length) return l.map(e => [e.code, e.message].filter(Boolean).join(': ')).join(' | ');
  return data?.message || (data ? JSON.stringify(data).slice(0, 400) : '');
};

async function llamar(metodo, ruta, body, llave) {
  const { token, url } = config();
  if (!token) throw new ErrorProveedor('La facturación electrónica no está configurada en el servidor');
  try {
    const { data } = await axios({ method: metodo, url: url + ruta, data: body, timeout: 60000, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(llave && { 'Idempotency-Key': llave }) } });
    return data;
  } catch (e) {
    if (!e.response) throw new ErrorProveedor(`El proveedor de facturación no respondió: ${e.message}`);
    const s = e.response.status;
    throw new ErrorProveedor(`Proveedor de facturación (${s}): ${mensaje(e.response.data) || e.message}`, { status: s, definitivo: s >= 400 && s < 500 && s !== 409 && s !== 429 });
  }
}

function calcularDV(nit) {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const suma = String(nit).replace(/\D/g, '').split('').reverse().reduce((a, d, i) => a + Number(d) * pesos[i], 0);
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

function adquiriente(a) {
  if (!a?.documento || a.documento === CONSUMIDOR_FINAL.identificationNumber) return { ...CONSUMIDOR_FINAL };
  const tipo = ['13', '31', '22', '41'].includes(a.tipoDocumento) ? a.tipoDocumento : '13';
  const [num, dv] = String(a.documento).split('-').map(s => s.trim());
  const c = { name: a.nombre, organizationType: tipo === '31' ? 1 : 2, identificationType: tipo, identificationNumber: num.replace(/[^\dA-Za-z]/g, '') };
  if (tipo === '31') c.dv = dv || calcularDV(c.identificationNumber);
  if (a.correo) c.email = a.correo;
  return c;
}

// Línea ya descontada: price = base/cantidad, así cuadra con lo cobrado
function linea({ codigo, nombre, cantidad, unidad, total, base, impuesto, tipo, pct }) {
  const l = { code: String(codigo || 'SIN').slice(0, 50), description: String(nombre).slice(0, 300), price: r2(base / cantidad), quantity: cantidad, unitCode: UNIDAD[unidad] || '94', subtotal: r2(base), taxAmount: r2(impuesto), total: r2(total) };
  if (TRIBUTO[tipo]) l.taxes = [{ taxCode: TRIBUTO[tipo], taxAmount: r2(impuesto), taxPercentage: Number(pct || 0).toFixed(2), taxableAmount: r2(base) }];
  return l;
}
function lineasVenta(v) {
  const out = v.items.filter(i => i.total > 0).map(i => linea({ codigo: i.codigo || i.producto, nombre: i.nombre, cantidad: i.cantidad, unidad: i.unidad, total: i.total, base: i.base, impuesto: i.impuesto, tipo: i.impuestoTipo, pct: i.impuestoPct }));
  if (v.domicilio > 0) out.push(linea({ codigo: 'DOMICILIO', nombre: 'Servicio de domicilio', cantidad: 1, unidad: 'und', total: v.domicilio, base: v.domicilio, impuesto: 0, tipo: 'excluido', pct: 0 }));
  return out;
}
function totales(items) {
  const s = f => r2(items.reduce((a, i) => a + f(i), 0));
  const bruto = s(i => i.subtotal), imp = s(i => i.taxAmount);
  return { grossTotal: bruto, taxableTotal: s(i => (i.taxes ? i.subtotal : 0)), taxTotal: imp, discountTotal: 0, chargeTotal: 0, advanceTotal: 0, payableTotal: r2(bruto + imp), currencyCode: 'COP' };
}
function pagos(v) {
  const vence = new Date(new Date(v.fecha).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const m = new Map();
  (v.pagos || []).forEach(p => m.set(`${p.tipo === 'fiado' ? 2 : 1}${MEDIO[p.tipo] || 'ZZZ'}`, p.tipo === 'fiado'
    ? { paymentForm: '2', paymentMethod: 'ZZZ', paymentDueDate: vence } : { paymentForm: '1', paymentMethod: MEDIO[p.tipo] || 'ZZZ' }));
  return m.size ? [...m.values()] : [{ paymentForm: '1', paymentMethod: 'ZZZ' }];
}

async function reservarNumero(empresa) {
  const res = empresa.facturacion.resolucion;
  if (!res?.numero || !res.hasta) throw new ErrorProveedor('No hay resolución de numeración registrada', { definitivo: true });
  const hoy = ahoraDe(empresa).fecha;
  if (res.fechaFin && hoy > res.fechaFin) throw new ErrorProveedor(`La resolución ${res.numero} venció el ${res.fechaFin}`, { definitivo: true });
  const antes = await Empresa.findOneAndUpdate(
    { _id: empresa._id, 'facturacion.siguienteNumero': { $gte: res.desde, $lte: res.hasta } },
    { $inc: { 'facturacion.siguienteNumero': 1 } }, { new: false }).select('facturacion.siguienteNumero').lean();
  if (!antes) throw new ErrorProveedor(`Se agotó el rango de la resolución ${res.numero}`, { definitivo: true });
  return antes.facturacion.siguienteNumero;
}

const ESTADO = { ACCEPTED: 'aceptada', ACCEPTED_WITH_OBSERVATIONS: 'observaciones', REJECTED: 'rechazada' };
function resultado(f) {
  if (!f?.id) throw new ErrorProveedor('El proveedor de facturación no devolvió el documento');
  const detalle = [f.governmentResponse?.message, ...(f.governmentResponse?.errorMessages || []), mensaje(f.errors)].filter(Boolean).join(' | ');
  const estado = f.status === 'FAILED' ? 'rechazada' : ESTADO[f.legalStatus] || (['REGISTERED', 'WAITING_RESPONSE'].includes(f.status) || !(f.cufe || f.cude) ? 'validacion' : 'emitida');
  const numero = f.fullNumber || (f.number ? `${f.prefix || ''}${f.number}` : '');
  return {
    idProveedor: f.id, estado, numero, codigoUnico: f.cufe || f.cude || '',
    urlConsulta: f.cufe ? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${f.cufe}` : '',
    observaciones: f.governmentResponse ? (f.governmentResponse.errorMessages || []).map(x => String(x).trim()).filter(Boolean) : undefined,
    error: estado === 'rechazada' ? `La DIAN rechazó el documento: ${detalle || f.legalStatus || f.status}` : '',
    numeroUsado: numeroYaUsado(detalle),
  };
}

async function emitir(venta, empresa) {
  const items = lineasVenta(venta);
  if (!items.length) throw new ErrorProveedor('La venta no tiene valores por facturar', { definitivo: true });
  let numero = venta.documento.numeroReservado, llave = venta.documento.llave;
  if (!numero) {
    const n = await reservarNumero(empresa);
    const v = await Venta.findOneAndUpdate({ _id: venta._id, 'documento.numeroReservado': null }, { 'documento.numeroReservado': n, 'documento.llave': crypto.randomUUID() }, { new: true }).lean()
      || await Venta.findById(venta._id).lean();
    numero = v.documento.numeroReservado; llave = v.documento.llave;
  }
  if (!llave) { llave = crypto.randomUUID(); await Venta.updateOne({ _id: venta._id }, { 'documento.llave': llave }); }
  const res = empresa.facturacion.resolucion;
  const body = {
    documentType: '01', number: numero, note: [`Venta ${venta.numero}`],
    resolution: { resolutionNumber: res.numero, ...(res.prefijo && { prefix: res.prefijo }), minNumber: res.desde, maxNumber: res.hasta, startDate: res.fechaInicio, endDate: res.fechaFin, technicalKey: res.claveTecnica },
    company: { id: empresa.facturacion.empresaProveedorId },
    customer: adquiriente(venta.adquiriente), items, payments: pagos(venta), totalAmounts: totales(items),
  };
  const liberar = usado => Venta.updateOne({ _id: venta._id }, { 'documento.llave': '', ...(usado && { 'documento.numeroReservado': null }) });
  let r;
  try { r = resultado((await llamar('post', '/invoices', body, llave))?.invoice); }
  catch (e) { if (e.definitivo) await liberar(numeroYaUsado(e.message)); throw e; }
  if (r.estado === 'rechazada') { await liberar(r.numeroUsado); r.idProveedor = ''; }
  return r;
}

async function notaCredito(dev, venta, empresa) {
  const items = dev.items.map(d => {
    const it = venta.items.find(i => String(i._id) === String(d.item));
    const base = it.impuestoPct > 0 && it.impuestoTipo !== 'excluido' ? Math.round(d.total * 100 / (100 + it.impuestoPct)) : d.total;
    return linea({ codigo: it.codigo || it.producto, nombre: it.nombre, cantidad: d.cantidad, unidad: it.unidad, total: d.total, base, impuesto: d.total - base, tipo: it.impuestoTipo, pct: it.impuestoPct });
  }).filter(i => i.total > 0);
  if (dev.tipo === 'total' && venta.domicilio > 0) items.push(linea({ codigo: 'DOMICILIO', nombre: 'Servicio de domicilio', cantidad: 1, unidad: 'und', total: venta.domicilio, base: venta.domicilio, impuesto: 0, tipo: 'excluido' }));
  const original = (await llamar('get', `/invoices/${venta.documento.idProveedor}`))?.invoice;
  if (!original?.cufe) throw new ErrorProveedor('La factura original aún no tiene código de validación');
  let { numeroReservado: numero, llave } = dev.documento;
  if (!numero) {
    const e = await Empresa.findOneAndUpdate({ _id: empresa._id }, { $inc: { 'facturacion.siguienteNotaCredito': 1 } }, { new: false }).select('facturacion.siguienteNotaCredito').lean();
    numero = e.facturacion.siguienteNotaCredito || 1;
  }
  if (!llave) llave = crypto.randomUUID();
  await Devolucion.updateOne({ _id: dev._id }, { 'documento.numeroReservado': numero, 'documento.llave': llave });
  const body = {
    documentType: '91', prefix: empresa.facturacion.prefijoNotaCredito || 'NC', number: numero,
    conceptCode: dev.tipo === 'total' ? '2' : '1', note: [`${dev.tipo === 'total' ? 'Anulación' : 'Devolución'} venta ${venta.numero} — ${dev.motivo}`],
    associatedDocuments: [{ date: String(original.date || '').slice(0, 10), documentType: '01', number: original.number, ...(original.prefix && { prefix: original.prefix }), uuid: original.cufe }],
    company: { id: empresa.facturacion.empresaProveedorId }, customer: adquiriente(venta.adquiriente), items, totalAmounts: totales(items), payments: pagos(venta),
  };
  const liberar = usado => Devolucion.updateOne({ _id: dev._id }, { 'documento.llave': '', ...(usado && { 'documento.numeroReservado': null }) });
  let r;
  try { r = resultado((await llamar('post', '/credit-notes', body, llave))?.creditNote); }
  catch (e) { if (e.definitivo) await liberar(numeroYaUsado(e.message)); throw e; }
  if (r.estado === 'rechazada') { await liberar(r.numeroUsado); throw new ErrorProveedor(r.error, { definitivo: true }); }
  return r;
}

const consultar = async id => { const d = await llamar('get', `/invoices/${id}`); return resultado(d?.invoice || d); };
const consultarNota = async id => { const d = await llamar('get', `/credit-notes/${id}`); return resultado(d?.creditNote || d); };

// ── Alta y habilitación (exclusivo de Katú) ────────────────────────────────
const resumen = e => ({ id: e.id, nombre: e.name, idFiscal: e.identification, dv: e.dv, habilitada: e.governmentStatus?.invoices === 'AUTHORIZED', estado: e.governmentStatus?.invoices || '', webhook: e.webhooks?.invoices?.emissionFinished?.status === 'active' });
const guardarEmpresa = (empresaId, e) => Empresa.updateOne({ _id: empresaId }, { 'facturacion.empresaProveedorId': e.id, 'facturacion.idFiscal': e.identification || '', 'facturacion.razonSocial': e.name || '', 'facturacion.estadoHabilitacion': e.governmentStatus?.invoices || '' });

const listarEmpresas = async () => ((await llamar('get', '/companies?limit=30'))?.companies || []).map(resumen);
async function vincular(empresa, id) {
  if (await Empresa.exists({ _id: { $ne: empresa._id }, 'facturacion.empresaProveedorId': id })) throw new ErrorProveedor('Ese emisor ya está vinculado a otra empresa', { definitivo: true });
  const e = (await llamar('get', `/companies/${encodeURIComponent(id)}`))?.company;
  if (!e) throw new ErrorProveedor('El emisor no existe', { definitivo: true });
  await guardarEmpresa(empresa._id, e);
  return resumen(e);
}
async function crearEmpresa(empresa, d) {
  if (empresa.facturacion?.empresaProveedorId) throw new ErrorProveedor('La empresa ya está vinculada a un emisor', { definitivo: true });
  const nit = String(d.idFiscal || '').split('-')[0].replace(/\D/g, '');
  if (!nit || !d.nombre || !d.correo || !d.direccion || !d.ciudad || !d.departamento) throw new ErrorProveedor('NIT, razón social, correo, dirección, departamento y ciudad son obligatorios', { definitivo: true });
  const natural = d.tipoPersona === 'natural';
  const e = (await llamar('post', '/companies', {
    name: d.nombre, ...(d.nombreComercial && { tradeName: d.nombreComercial }), identification: nit, dv: String(d.dv || '').trim() || calcularDV(nit),
    type: 'associated', useAlegraCertificate: true, notificationByEmail: { enabled: true },
    organizationType: natural ? 2 : 1, identificationType: natural ? '13' : '31', regimeCode: d.regimen || 'R-99-PN', taxCode: { id: d.tributo || '01' },
    email: d.correo, ...(d.telefono && { phone: d.telefono }), address: { address: d.direccion, city: String(d.ciudad), department: String(d.departamento), country: 'CO' },
  }))?.company;
  if (!e?.id) throw new ErrorProveedor('El proveedor no devolvió la empresa creada');
  await guardarEmpresa(empresa._id, e);
  return resumen(e);
}
async function estadoEmpresa(empresa) {
  if (!empresa.facturacion?.empresaProveedorId) return null;
  const e = (await llamar('get', `/companies/${empresa.facturacion.empresaProveedorId}`))?.company;
  if (!e) return null;
  await guardarEmpresa(empresa._id, e);
  return resumen(e);
}
async function habilitar(empresa, testSetId) {
  if (!empresa.facturacion?.empresaProveedorId) throw new ErrorProveedor('Primero crea o vincula el emisor', { definitivo: true });
  let s;
  try { s = (await llamar('post', '/test-sets', { company: { id: empresa.facturacion.empresaProveedorId }, type: 'invoices', governmentId: String(testSetId || '').trim() }))?.testSet; }
  catch (e) { if (!/AEP4001/.test(e.message)) throw e; s = { status: 'IN_PROCESS' }; } // ya enviado: sigue en validación
  return { estado: s?.status || '', errores: (s?.errors || []).map(x => x.message || JSON.stringify(x)), empresa: await estadoEmpresa(empresa) };
}
async function resoluciones(empresa) {
  if (!empresa.facturacion?.idFiscal) throw new ErrorProveedor('La facturación electrónica aún no está activa para tu empresa', { definitivo: true });
  try { return (await llamar('get', `/resolutions/${empresa.facturacion.idFiscal}`))?.resolutions || []; }
  catch (e) { if (/AEP9006/.test(e.message)) throw new ErrorProveedor('La consulta de resoluciones solo existe en producción: digítala a mano', { definitivo: true }); throw e; }
}
async function registrarWebhook(empresa, url) {
  const e = await Empresa.findById(empresa._id).select('+facturacion.webhookSecreto').lean();
  const secreto = e.facturacion.webhookSecreto || crypto.randomBytes(24).toString('hex');
  const hook = { url, headers: { 'x-api-key': secreto }, status: 'active' };
  await llamar('patch', `/companies/${e.facturacion.empresaProveedorId}`, { webhooks: { invoices: { emissionFinished: hook }, creditNotes: { emissionFinished: hook } } });
  await Empresa.updateOne({ _id: empresa._id }, { 'facturacion.webhookSecreto': secreto });
  return { url };
}
const tablas = {};
async function tabla(nombre) {
  if (!['departments', 'municipalities'].includes(nombre)) throw new ErrorProveedor('Tabla no soportada', { definitivo: true });
  return (tablas[nombre] = tablas[nombre] || (await llamar('get', `/dian/${nombre}`))?.[nombre] || []);
}

module.exports = { disponible, config, emitir, notaCredito, consultar, consultarNota, resultado, calcularDV, listarEmpresas, vincular, crearEmpresa, estadoEmpresa, habilitar, resoluciones, registrarWebhook, tabla, _interno: { lineasVenta, totales, pagos, adquiriente } };
