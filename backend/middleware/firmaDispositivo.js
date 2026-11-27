const crypto = require('crypto');
const Dispositivo = require('../models/Dispositivo');
const Empresa = require('../models/Empresa');
const Nonce = require('../models/Nonce');
const { paisDe } = require('../utils/contexto');

// Firma HMAC por dispositivo — mismo contrato que los kioscos de recarga Katú:
//   X-Device-Id, X-Timestamp (segundos), X-Nonce, X-Signature
//   mensaje = timestamp \n nonce \n METODO \n ruta \n cuerpo (bytes exactos)
const VENTANA_S = 300;

const firmar = (secretHex, { timestamp, nonce, metodo, ruta, cuerpo }) =>
  crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${timestamp}\n${nonce}\n${metodo}\n${ruta}\n${cuerpo}`).digest('hex');

const firmaDispositivo = tipo => async (req, res, next) => {
  const no = motivo => res.status(401).json({ success: false, error: motivo });
  try {
    const deviceId = String(req.headers['x-device-id'] || '').toUpperCase();
    const timestamp = String(req.headers['x-timestamp'] || '');
    const nonce = String(req.headers['x-nonce'] || '');
    const firma = String(req.headers['x-signature'] || '');
    if (!deviceId || !/^\d+$/.test(timestamp) || !/^[0-9a-f]{32}$/i.test(nonce) || !/^[0-9a-f]{64}$/i.test(firma)) return no('Firma incompleta');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > VENTANA_S) return no('Reloj fuera de rango');

    const d = await Dispositivo.findOne({ deviceId, activo: true, tipo }).select('+secret').lean();
    if (!d) return no('Dispositivo no autorizado');
    const esperada = firmar(d.secret, { timestamp, nonce, metodo: req.method, ruta: req.originalUrl.split('?')[0], cuerpo: req.rawBody || '' });
    if (!crypto.timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(firma, 'hex'))) return no('Firma inválida');

    try { await Nonce.create({ _id: `${deviceId}:${nonce}` }); }
    catch (e) { if (e.code === 11000) return no('Petición repetida'); throw e; }

    const empresa = await Empresa.findById(d.empresa).lean();
    if (!empresa || !empresa.estado) return no('Empresa inactiva');
    delete d.secret;
    req.dispositivo = d; req.empresa = empresa; req.pais = await paisDe(empresa);
    Dispositivo.updateOne({ _id: d._id }, { ultimaConexion: new Date() }).catch(() => {});
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { firmaDispositivo, firmar };
