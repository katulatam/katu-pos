const mongoose = require('mongoose');

// Fiado: cargos (ventas a crédito) y abonos del cliente.
const movCarteraSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  tipo:    { type: String, enum: ['cargo', 'abono', 'devolucion'], required: true },
  monto:   { type: Number, required: true },
  saldo:   Number,
  medio:   String,
  venta:   { type: mongoose.Schema.Types.ObjectId, ref: 'Venta' },
  turno:   { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  notas:   String,
}, { timestamps: true });
movCarteraSchema.index({ empresa: 1, cliente: 1, createdAt: -1 });
movCarteraSchema.index({ turno: 1 });

module.exports = mongoose.model('MovimientoCartera', movCarteraSchema);
