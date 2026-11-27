const mongoose = require('mongoose');

const promocionSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:   { type: String, required: true, trim: true },
  tipo:     { type: String, enum: ['porcentaje', 'precio', 'nxm'], required: true },
  valor:    { type: Number, default: 0 },
  lleva:    Number,
  paga:     Number,
  alcance:  { type: String, enum: ['todo', 'categoria', 'producto'], default: 'producto' },
  objetivos: [{ type: mongoose.Schema.Types.ObjectId }],
  desde: String, hasta: String, horaDesde: String, horaHasta: String,
  dias: [Number],
  activo: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Promocion', promocionSchema);
