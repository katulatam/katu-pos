const mongoose = require('mongoose');

// Lotes con vencimiento. Se consumen del que vence primero (FEFO).
const loteSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:     { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  codigo:   { type: String, trim: true, default: '' },
  vence:    { type: String, required: true },     // YYYY-MM-DD
  cantidad: { type: Number, required: true },
  restante: { type: Number, required: true },
  compra:   { type: mongoose.Schema.Types.ObjectId, ref: 'Compra' },
}, { timestamps: true });
loteSchema.index({ empresa: 1, sede: 1, producto: 1, vence: 1 });
loteSchema.index({ empresa: 1, vence: 1 });

module.exports = mongoose.model('Lote', loteSchema);
