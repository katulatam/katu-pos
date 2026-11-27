const mongoose = require('mongoose');

// Kardex. `saldo` es la existencia de la sede justo después del movimiento.
const movimientoSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:     { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  tipo:     { type: String, enum: ['venta', 'compra', 'ajuste', 'merma', 'traslado', 'devolucion', 'inicial'], required: true },
  cantidad: { type: Number, required: true },   // + entra, − sale
  saldo:    Number,
  costo:    Number,
  referencia: String,
  motivo:   String,
  usuario:  { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
}, { timestamps: true });
movimientoSchema.index({ empresa: 1, producto: 1, createdAt: -1 });
movimientoSchema.index({ empresa: 1, createdAt: -1 });

module.exports = mongoose.model('MovimientoInventario', movimientoSchema);
