const mongoose = require('mongoose');

const progresoSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  mision:  { type: mongoose.Schema.Types.ObjectId, ref: 'Mision', required: true },
  ciclo:   { type: String, required: true },     // 2026-S48, 2026-11, unica
  avance:  { type: Number, default: 0 },
  completada: { type: Boolean, default: false },
  completadaEn: Date,
}, { timestamps: true });
progresoSchema.index({ cliente: 1, mision: 1, ciclo: 1 }, { unique: true });

module.exports = mongoose.model('ProgresoMision', progresoSchema);
