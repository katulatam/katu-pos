const mongoose = require('mongoose');

// Stock por sede. `reservado` = comprometido en domicilios sin despachar.
const existenciaSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:     { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  cantidad: { type: Number, default: 0 },
  reservado:{ type: Number, default: 0 },
}, { timestamps: true });
existenciaSchema.index({ sede: 1, producto: 1 }, { unique: true });
existenciaSchema.index({ empresa: 1, producto: 1 });

module.exports = mongoose.model('Existencia', existenciaSchema);
