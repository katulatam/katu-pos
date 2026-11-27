const mongoose = require('mongoose');

const compraSchema = new mongoose.Schema({
  empresa:   { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:      { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  proveedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor' },
  numero:    String,
  factura:   { type: String, trim: true, default: '' },
  items: [{ _id: false, producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' }, nombre: String, cantidad: Number, costo: Number, total: Number, vence: String, lote: String }],
  total:     Number,
  usuario:   { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  notas:     String,
}, { timestamps: true });
compraSchema.index({ empresa: 1, createdAt: -1 });

module.exports = mongoose.model('Compra', compraSchema);
