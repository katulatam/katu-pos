const mongoose = require('mongoose');

// Intento de cobro por un medio que se confirma solo (QR, datáfono integrado,
// kiosco de efectivo). La venta únicamente lo acepta en estado 'aprobado' y
// queda amarrado a ella (ventaUuid) para que no se use dos veces.
const cobroSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  caja:    { type: mongoose.Schema.Types.ObjectId, ref: 'Caja' },
  pedido:  { type: mongoose.Schema.Types.ObjectId, ref: 'Pedido' },
  dispositivo: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispositivo' },
  referencia: { type: String, required: true, unique: true },
  medio:   { type: String, required: true },
  proveedor: { type: String, required: true },   // katupay_nequi | katupay_tarjeta | simulado | terminal | kiosco
  monto:   { type: Number, required: true },
  recibido: { type: Number, default: 0 },        // kiosco: dinero introducido
  cambio:  { type: Number, default: 0 },
  estado:  { type: String, enum: ['pendiente', 'aprobado', 'rechazado', 'cancelado', 'expirado'], default: 'pendiente' },
  qrBase64: String,
  urlPago:  String,
  autorizacion: String,
  detalle:  String,
  eventos: [{ _id: false, txId: String, tipo: { type: String }, valor: Number, en: { type: Date, default: Date.now } }],
  ventaUuid: String,
  creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  aprobadoEn: Date,
  expiraEn: Date,
}, { timestamps: true });
cobroSchema.index({ empresa: 1, createdAt: -1 });

module.exports = mongoose.model('Cobro', cobroSchema);
