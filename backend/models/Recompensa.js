const mongoose = require('mongoose');

// Premio que se canjea con puntos por un producto gratis o un descuento.
const recompensaSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:  { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },
  icono:   { type: String, default: 'fa-gift' },
  puntos:  { type: Number, required: true, min: 1 },
  descuento: { type: Number, required: true, min: 0 },  // dinero que descuenta de la venta
  nivelMinimo: { type: String, default: '' },
  activo:  { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Recompensa', recompensaSchema);
