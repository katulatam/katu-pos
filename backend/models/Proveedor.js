const mongoose = require('mongoose');
const { capitalizarNombre } = require('../utils/texto');

const proveedorSchema = new mongoose.Schema({
  empresa:   { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:    { type: String, required: true, trim: true, set: capitalizarNombre },
  documento: { type: String, trim: true, default: '' },
  contacto:  { type: String, trim: true, default: '', set: capitalizarNombre },
  telefono:  { type: String, trim: true, default: '' },
  correo:    { type: String, trim: true, lowercase: true, default: '' },
  diasEntrega: { type: Number, default: 3 },
  activo:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Proveedor', proveedorSchema);
