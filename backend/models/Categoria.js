const mongoose = require('mongoose');

const categoriaSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:  { type: String, required: true, trim: true },
  color:   { type: String, default: '#05C3DD' },
  icono:   { type: String, default: 'fa-box' },
  orden:   { type: Number, default: 0 },
  enLinea: { type: Boolean, default: true },
  activo:  { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Categoria', categoriaSchema);
