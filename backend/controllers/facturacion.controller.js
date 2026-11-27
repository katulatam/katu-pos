const crypto = require('crypto');
const Empresa = require('../models/Empresa');
const Venta = require('../models/Venta');
const Devolucion = require('../models/Devolucion');
const facturacion = require('../utils/facturacion');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');

// Proveedor del país de la empresa (o error claro si el país no tiene)
const prov = req => {
  const p = facturacion.proveedorDe(req.pais);
  if (!p) throw new ErrorApi(`La facturación electrónica de ${req.pais.nombre} no está disponible`, 409, 'PAIS_SIN_PROVEEDOR');
  return p;
};

exports.estado = manejar(async req => {
  const e = await Empresa.findById(req.empresa._id).select('+facturacion.resolucion.claveTecnica').lean();
  const p = facturacion.proveedorDe(req.pais), f = e.facturacion || {}, r = f.resolucion || {};
  const usados = r.hasta ? Math.round((f.siguienteNumero - r.desde) * 100 / (r.hasta - r.desde + 1)) : 0;
  return {
    paisDisponible: !!p, servidorListo: !!p?.disponible(), enPrueba: require('../utils/prueba').enPrueba(e), sandbox: !!p?.config?.().sandbox, activa: !!f.activa, vinculada: !!f.empresaProveedorId,
    idFiscal: f.idFiscal, razonSocial: f.razonSocial, estadoHabilitacion: f.estadoHabilitacion, facturarConsumidorFinal: f.facturarConsumidorFinal !== false,
    resolucion: r.numero ? { numero: r.numero, prefijo: r.prefijo, desde: r.desde, hasta: r.hasta, fechaInicio: r.fechaInicio, fechaFin: r.fechaFin, claveConfigurada: !!r.claveTecnica } : null,
    siguienteNumero: f.siguienteNumero, porcentajeUsado: usados, prefijoNotaCredito: f.prefijoNotaCredito, siguienteNotaCredito: f.siguienteNotaCredito,
  };
});
exports.resumen = manejar(async req => {
  const f = { empresa: req.empresa._id, fecha: rangoUtc(req.empresa, req.query.desde, req.query.hasta) };
  return Venta.aggregate([{ $match: f }, { $group: { _id: '$documento.estado', n: { $sum: 1 }, total: { $sum: '$total' } } }]);
});
// La resolución la registra el comercio (es su trámite). Dentro de la misma
// resolución el consecutivo solo avanza: retroceder reusaría números emitidos.
exports.guardarResolucion = manejar(async req => {
  prov(req);
  const b = req.body.resolucion || {};
  const e = await Empresa.findById(req.empresa._id).select('+facturacion.resolucion.claveTecnica').lean();
  const previa = e.facturacion?.resolucion || {};
  const res = { numero: String(b.numero || '').trim(), prefijo: String(b.prefijo || '').trim().toUpperCase(), desde: Number(b.desde), hasta: Number(b.hasta), fechaInicio: String(b.fechaInicio || '').slice(0, 10), fechaFin: String(b.fechaFin || '').slice(0, 10), claveTecnica: String(b.claveTecnica || '').trim() || (previa.numero === String(b.numero || '').trim() ? previa.claveTecnica : '') };
  if (!res.numero || !(res.desde > 0) || !(res.hasta >= res.desde) || !res.fechaInicio || !res.fechaFin || !res.claveTecnica) throw new ErrorApi('Completa número, rango, fechas y clave técnica de la resolución');
  const misma = previa.numero === res.numero && (previa.prefijo || '') === res.prefijo;
  const dado = req.body.siguienteNumero;
  const hayNumero = dado !== undefined && dado !== null && dado !== '';
  const siguiente = hayNumero ? Number(dado) : misma ? (e.facturacion.siguienteNumero || res.desde) : res.desde;
  if (!Number.isInteger(siguiente) || siguiente < res.desde || siguiente > res.hasta) throw new ErrorApi(`El siguiente número debe estar entre ${res.desde} y ${res.hasta}`);
  const filtro = { _id: req.empresa._id };
  if (misma && hayNumero) filtro['facturacion.siguienteNumero'] = { $lte: siguiente };
  const ok = await Empresa.findOneAndUpdate(filtro, { 'facturacion.resolucion': res, ...((!misma || hayNumero) && { 'facturacion.siguienteNumero': siguiente }) }, { new: true }).lean();
  if (!ok) throw new ErrorApi('El consecutivo no se puede retroceder dentro de la misma resolución', 409);
  return { guardada: true, siguienteNumero: ok.facturacion.siguienteNumero };
});
exports.resoluciones = manejar(req => prov(req).resoluciones(req.empresa));

// ── Exclusivo Katú ────────────────────────────────────────────────────────
exports.activar = manejar(async req => {
  prov(req);
  const e = await Empresa.findById(req.empresa._id).lean();
  if (req.body.activa && !e.facturacion?.empresaProveedorId) throw new ErrorApi('Primero crea o vincula el emisor');
  await Empresa.updateOne({ _id: e._id }, { 'facturacion.activa': !!req.body.activa, ...(req.body.prefijoNotaCredito && { 'facturacion.prefijoNotaCredito': String(req.body.prefijoNotaCredito).toUpperCase() }), ...(Number(req.body.siguienteNotaCredito) > 0 && { 'facturacion.siguienteNotaCredito': Number(req.body.siguienteNotaCredito) }) });
  return { activa: !!req.body.activa };
});
exports.emisores = manejar(req => prov(req).listarEmpresas());
exports.vincular = manejar(req => prov(req).vincular(req.empresa, String(req.body.id || '')));
exports.crearEmisor = manejar(req => prov(req).crearEmpresa(req.empresa, req.body));
exports.estadoEmisor = manejar(req => prov(req).estadoEmpresa(req.empresa));
exports.habilitar = manejar(req => prov(req).habilitar(req.empresa, req.body.testSetId));
exports.tabla = manejar(req => prov(req).tabla(req.params.tabla));
exports.registrarWebhook = manejar(async req => {
  const base = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new ErrorApi('Define PUBLIC_URL (https) en el servidor');
  return prov(req).registrarWebhook(req.empresa, `${base}/api/v1/facturacion/webhook/${req.empresa._id}`);
});
// Público: lo llama el proveedor; se autentica con el secreto de la empresa
exports.webhook = async (req, res) => {
  try {
    const e = /^[a-f\d]{24}$/i.test(req.params.empresa) ? await Empresa.findById(req.params.empresa).select('+facturacion.webhookSecreto').lean() : null;
    const esperado = Buffer.from(e?.facturacion?.webhookSecreto || ''), recibido = Buffer.from(String(req.headers['x-api-key'] || ''));
    if (!esperado.length || esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) return res.status(401).json({ success: false, error: 'No autorizado' });
    const f = req.body?.invoice;
    if (f?.id && f.type !== 'event' && await Venta.exists({ empresa: e._id, 'documento.idProveedor': f.id })) {
      await facturacion.actualizarPorResultado(f.id, facturacion.PROVEEDORES.alanube_co.resultado(f), 'alanube_co');
    }
    const n = req.body?.creditNote;
    if (n?.id && n.type !== 'event' && await Devolucion.exists({ empresa: e._id, 'documento.idProveedor': n.id })) {
      await facturacion.actualizarNota(n.id, facturacion.PROVEEDORES.alanube_co.resultado(n), 'alanube_co');
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[facturacion.webhook]', err.message);
    res.json({ success: true }); // el job de mantenimiento es el respaldo
  }
};
