const mongoose = require('mongoose');

const sedeSchema = new mongoose.Schema({
  empresa:     { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:      { type: String, required: true, trim: true },
  direccion:   { type: String, trim: true, default: '' },
  ciudad:      { type: String, trim: true, default: '' },
  telefono:    { type: String, trim: true, default: '' },
  zonaHoraria: { type: String, default: '' },     // vacío = la de la empresa
  ubicacion:   { lat: Number, lng: Number },
  atiendeDomicilios: { type: Boolean, default: true },
  activo:      { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Sede', sedeSchema);
