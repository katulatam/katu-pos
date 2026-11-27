const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const Cobro = require('../models/Cobro');
const Empresa = require('../models/Empresa');
const Dispositivo = require('../models/Dispositivo');
const { ErrorApi, mediosDe } = require('./contexto');
const Motor = require('../../frontend/assets/js/motor');

// Cobros que se confirman solos. Cada proveedor implementa crear/consultar/
// cancelar; agregar uno nuevo (otro país, otro adquirente) es una entrada más
// en PROVEEDORES sin tocar la caja ni las ventas.
const MINUTOS = 5;
const ESTADOS = { aprobado: 'aprobado', aprobada: 'aprobado', rechazado: 'rechazado', rechazada: 'rechazado', cancelado: 'cancelado', cancelada: 'cancelado' };
const modoDemo = () => process.env.MODO_DEMO === 'true' && process.env.NODE_ENV !== 'production';

async function _credenciales(empresaId) {
  const e = await Empresa.findById(empresaId).select('+katuPay.secret').lean();
  const k = e?.katuPay || {};
  return { url: (k.url || process.env.KATUPAY_URL || 'https://api.katupay.dev').replace(/\/+$/, ''), clientId: k.clientId, secret: k.secret, subdominio: k.subdominio };
}
async function _login(c) {
  if (!c.clientId || !c.secret) throw new ErrorApi('La pasarela de pagos no está configurada para esta empresa', 400);
  const { data } = await axios.post(`${c.url}/auth/api/login`, { username: c.clientId, password: c.secret }, { timeout: 15000 });
  if (!data?.token) throw new ErrorApi('La pasarela de pagos no autorizó la conexión', 502);
  return { headers: { 'x-token': data.token }, timeout: 20000 };
}
const _qr = async texto => QRCode.toDataURL(texto, { margin: 1, width: 420, errorCorrectionLevel: 'M' });
const _imagen = b => (!b ? '' : b.startsWith('data:') ? b : `data:image/png;base64,${b}`);

const PROVEEDORES = {
  // Contratos Katú Pay ya usados por el POS y el kiosco de katu_school
  katupay_nequi: {
    async crear(cobro) {
      const c = await _credenciales(cobro.empresa);
      const { data } = await axios.post(`${c.url}/payment/nequi/pos`, { idCajero: String(cobro.caja || cobro.pedido || cobro._id), refPago: cobro.referencia, valor: cobro.monto }, await _login(c));
      const url = data?.url_qrpago || data?.data?.url_qrpago || '';
      return { urlPago: url, qrBase64: _imagen(data?.qr_base64) || (url ? await _qr(url) : '') };
    },
    async consultar(cobro) {
      const c = await _credenciales(cobro.empresa);
      const { data } = await axios.get(`${c.url}/payment/nequi/pos/estado/${encodeURIComponent(cobro.referencia)}`, { timeout: 15000 });
      return { estado: ESTADOS[String(data?.estado || '').toLowerCase()] || 'pendiente', autorizacion: data?.numeroAutorizacion || '' };
    },
    async cancelar(cobro) {
      const c = await _credenciales(cobro.empresa);
      await axios.post(`${c.url}/payment/nequi/pos/cancelar`, { refPago: cobro.referencia }, await _login(c));
    },
  },
  katupay_tarjeta: {
    async crear(cobro) {
      const c = await _credenciales(cobro.empresa);
      if (!c.subdominio) throw new ErrorApi('Falta el subdominio de la pasarela en la configuración de la empresa');
      const { data } = await axios.post(`${c.url}/payment/kiosko/tarjeta`, { subdominio: c.subdominio, refPago: cobro.referencia, idKiosko: String(cobro.caja || cobro.pedido || cobro._id), valor: cobro.monto }, await _login(c));
      if (!data?.estado || !data?.url_qrpago) throw new ErrorApi('No se pudo generar el pago con tarjeta', 502);
      return { urlPago: data.url_qrpago, qrBase64: await _qr(data.url_qrpago) };
    },
    async consultar(cobro) {
      const c = await _credenciales(cobro.empresa);
      const { data } = await axios.get(`${c.url}/payment/tarjeta/kiosko/status/${encodeURIComponent(cobro.referencia)}`, { timeout: 15000 });
      return { estado: ESTADOS[String(data?.estado || '').toLowerCase()] || 'pendiente', autorizacion: data?.numeroAutorizacion || '' };
    },
    async cancelar() { /* la pasarela no ofrece cancelación: se deja de consultar */ },
  },
  // Datáfono / kiosco de efectivo: el equipo consulta y responde firmado (routes/dispositivo)
  terminal: { async crear() { return {}; }, async consultar(c) { return { estado: c.estado }; }, async cancelar() {} },
  kiosco:   { async crear() { return {}; }, async consultar(c) { return { estado: c.estado }; }, async cancelar() {} },
  // Pruebas: se aprueba solo a los 5 segundos. Solo con MODO_DEMO fuera de producción.
  simulado: {
    async crear(c) { const u = `https://katu.me/demo/${c.referencia}`; return { urlPago: u, qrBase64: await _qr(u) }; },
    async consultar(c) { return { estado: Date.now() - new Date(c.createdAt) > 5000 ? 'aprobado' : 'pendiente', autorizacion: 'DEMO' }; },
    async cancelar() {},
  },
};

async function crear({ empresa, pais, medio, monto, caja, pedido, dispositivo, usuario, canal = 'caja' }) {
  const m = mediosDe(empresa, pais, canal).find(x => x.codigo === medio);
  if (!m) throw new ErrorApi('El medio de pago no está activo');
  const valor = Motor.redondear(monto, pais.decimales);
  if (!(valor > 0)) throw new ErrorApi('El valor a cobrar no es válido');

  let proveedor = m.proveedor || '';
  let equipo = null;
  if (m.tipo === 'datafono' || m.tipo === 'efectivo') {
    proveedor = m.tipo === 'datafono' ? 'terminal' : 'kiosco';
    const filtro = { empresa: empresa._id, tipo: m.tipo === 'datafono' ? 'terminal' : 'kiosco_efectivo', activo: true };
    equipo = await Dispositivo.findOne(dispositivo ? { ...filtro, _id: dispositivo } : { ...filtro, caja: caja?._id || caja }).lean();
    if (!equipo) throw new ErrorApi('Esta caja no tiene un equipo de cobro asociado');
    // Un equipo atiende un cobro a la vez
    await Cobro.updateMany({ dispositivo: equipo._id, estado: 'pendiente', expiraEn: { $lt: new Date() } }, { estado: 'expirado' });
    if (await Cobro.exists({ dispositivo: equipo._id, estado: 'pendiente' })) throw new ErrorApi('El equipo está atendiendo otro cobro', 409);
  } else if (m.tipo !== 'qr') throw new ErrorApi('Este medio de pago no genera cobro automático');
  if (proveedor.startsWith('katupay')) {
    const c = await _credenciales(empresa._id);
    if ((!c.clientId || !c.secret) && modoDemo()) proveedor = 'simulado';
  }
  const impl = PROVEEDORES[proveedor];
  if (!impl) throw new ErrorApi('El medio de pago no tiene un proveedor configurado');

  const cobro = await Cobro.create({
    empresa: empresa._id, caja: caja?._id || caja, pedido, dispositivo: equipo?._id, medio, proveedor, monto: valor, creadoPor: usuario,
    referencia: `KP${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`.toUpperCase(),
    expiraEn: new Date(Date.now() + MINUTOS * 60000),
  });
  try {
    const r = await impl.crear(cobro);
    if (r && Object.keys(r).length) { Object.assign(cobro, r); await cobro.save(); }
  } catch (e) {
    await Cobro.updateOne({ _id: cobro._id }, { estado: 'rechazado', detalle: e.message });
    console.error('[cobros.crear]', proveedor, e.response?.status || '', e.message);
    if (e instanceof ErrorApi) throw e;
    throw new ErrorApi('La pasarela de pagos no respondió. Intenta de nuevo o usa otro medio.', 502);
  }
  return publico(cobro);
}

// Consulta al proveedor y guarda el estado final. Un cobro vencido se consulta
// una última vez antes de darlo por expirado (pago justo al límite).
async function consultar(empresaId, id) {
  const cobro = await Cobro.findOne({ _id: id, empresa: empresaId }).lean();
  if (!cobro) throw new ErrorApi('Cobro no encontrado', 404);
  if (cobro.estado !== 'pendiente') return publico(cobro);
  let r = { estado: 'pendiente' };
  try { r = await PROVEEDORES[cobro.proveedor].consultar(cobro); }
  catch (e) { console.error('[cobros.consultar]', cobro.proveedor, e.message); return publico(cobro); }
  let estado = r.estado;
  if (estado === 'pendiente' && cobro.expiraEn < new Date() && !cobro.recibido) estado = 'expirado';
  if (estado === 'pendiente') return publico(cobro);
  const nuevo = await Cobro.findOneAndUpdate({ _id: cobro._id, estado: 'pendiente' }, { estado, autorizacion: r.autorizacion || '', ...(estado === 'aprobado' && { aprobadoEn: new Date() }) }, { new: true }).lean();
  return publico(nuevo || await Cobro.findById(id).lean());
}

async function cancelar(empresaId, id) {
  const cobro = await Cobro.findOne({ _id: id, empresa: empresaId }).lean();
  if (!cobro) throw new ErrorApi('Cobro no encontrado', 404);
  if (cobro.estado !== 'pendiente') return publico(cobro);
  if (cobro.recibido > 0) throw new ErrorApi('El kiosco ya recibió dinero: primero debe devolverlo', 409);
  const actual = await consultar(empresaId, id);       // pudo aprobarse en este instante
  if (actual.estado !== 'pendiente') return actual;
  try { await PROVEEDORES[cobro.proveedor].cancelar(cobro); } catch (e) { console.error('[cobros.cancelar]', e.message); }
  const nuevo = await Cobro.findOneAndUpdate({ _id: id, estado: 'pendiente' }, { estado: 'cancelado' }, { new: true }).lean();
  return publico(nuevo || await Cobro.findById(id).lean());
}

const publico = c => ({ _id: c._id, referencia: c.referencia, medio: c.medio, proveedor: c.proveedor.startsWith('katupay') ? 'pasarela' : c.proveedor, monto: c.monto, recibido: c.recibido, cambio: c.cambio, estado: c.estado, qrBase64: c.qrBase64, urlPago: c.urlPago, autorizacion: c.autorizacion, detalle: c.detalle, expiraEn: c.expiraEn, usado: !!c.ventaUuid });

module.exports = { crear, consultar, cancelar, publico, modoDemo };
