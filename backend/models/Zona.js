const mongoose = require('mongoose');

// Geocerca de domicilios de una sede: radio alrededor de un punto o polígono.
const punto = { lat: Number, lng: Number };
const zonaSchema = new mongoose.Schema({
  empresa:   { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  sede:      { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  nombre:    { type: String, required: true, trim: true },
  tipo:      { type: String, enum: ['radio', 'poligono'], default: 'radio' },
  centro:    punto,
  radioM:    { type: Number, default: 2000 },
  poligono:  [{ _id: false, ...punto }],
  color:     { type: String, default: '#05C3DD' },
  tarifaBase:   { type: Number, default: 0 },
  kmIncluidos:  { type: Number, default: 0 },
  tarifaKm:     { type: Number, default: 0 },
  gratisDesde:  { type: Number, default: 0 },
  pedidoMinimo: { type: Number, default: 0 },
  minutos:      { type: Number, default: 40 },
  dias: [Number], horaDesde: String, horaHasta: String,
  prioridad: { type: Number, default: 0 },
  activo:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Zona', zonaSchema);
