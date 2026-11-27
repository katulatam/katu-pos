const mongoose = require('mongoose');

const movPuntosSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  tipo:    { type: String, enum: ['compra', 'redencion', 'mision', 'ruleta', 'devolucion', 'ajuste'] },
  puntos:  Number,
  detalle: String,
  venta:   { type: mongoose.Schema.Types.ObjectId, ref: 'Venta' },
}, { timestamps: true });
movPuntosSchema.index({ cliente: 1, createdAt: -1 });

module.exports = mongoose.model('MovimientoPuntos', movPuntosSchema);
