const mongoose = require('mongoose');

// Bolsa prepagada de mensajes de cada comercio: recargas (las hace Katú) y
// consumos. Solo consumen las campañas de marketing (WhatsApp y correo);
// atender clientes, el bot y los avisos de pedidos están incluidos en el plan.
const movimientoSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  canal:    { type: String, enum: ['whatsapp', 'correo'], required: true },
  tipo:     { type: String, enum: ['recarga', 'consumo', 'ajuste'], required: true },
  cantidad: { type: Number, required: true },               // + recarga, − consumo
  saldo:    Number,                                         // saldo después del movimiento
  motivo:   String,
  referencia: String,
  usuario:  { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
}, { timestamps: true });
movimientoSchema.index({ empresa: 1, createdAt: -1 });

module.exports = mongoose.model('MovimientoMensajeria', movimientoSchema);
