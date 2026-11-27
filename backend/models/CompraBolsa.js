const mongoose = require('mongoose');

// Compra de una bolsa de mensajes de marketing (pago único con Stripe).
//   pendiente → pagada (se suma al saldo una sola vez)   (vencida: no se pagó)
const compraSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  canal:    { type: String, enum: ['whatsapp', 'correo'], required: true },
  cantidad: { type: Number, required: true },
  precio:   { type: Number, required: true },
  moneda:   { type: String, required: true },
  estado:   { type: String, enum: ['pendiente', 'pagada', 'vencida'], default: 'pendiente' },
  stripeSesion: String,
  stripePago:   String,
  usuario:  { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  pagadaEn: Date,
}, { timestamps: true });
compraSchema.index({ empresa: 1, createdAt: -1 });
compraSchema.index({ stripeSesion: 1 }, { partialFilterExpression: { stripeSesion: { $type: 'string' } } });

module.exports = mongoose.model('CompraBolsa', compraSchema, 'compras_bolsa');
