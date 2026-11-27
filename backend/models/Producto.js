const mongoose = require('mongoose');

// `codigos` junta TODO lo que se puede escanear para llegar al producto (código
// de barras propio y los de sus presentaciones). Único por empresa.
const productoSchema = new mongoose.Schema({
  empresa:     { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  nombre:      { type: String, required: true, trim: true },
  descripcion: { type: String, trim: true, default: '' },
  categoria:   { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria' },
  marca:       { type: String, trim: true, default: '' },
  tipo:        { type: String, enum: ['unidad', 'peso', 'combo', 'servicio'], default: 'unidad' },
  unidad:      { type: String, enum: ['und', 'kg', 'lt', 'm'], default: 'und' },
  codigo:      { type: String, trim: true, default: '' },      // código de barras principal
  plu:         { type: String, trim: true, default: '' },      // 5 dígitos: báscula etiquetadora / tecla rápida
  codigos:     { type: [String], default: undefined },
  precio:      { type: Number, required: true, min: 0 },       // con impuesto incluido (por kg si es por peso)
  costo:       { type: Number, default: 0 },                   // promedio ponderado
  impuesto:    { type: String, default: '' },                  // código de Pais.impuestos
  presentaciones: [{ nombre: String, codigo: String, factor: { type: Number, default: 1 }, precio: Number }], // six-pack, caja…
  componentes: [{ _id: false, producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' }, cantidad: Number }],
  imagenUrl:   { type: String, default: '' },
  manejaInventario: { type: Boolean, default: true },
  manejaVencimiento: { type: Boolean, default: false },
  minimo:      { type: Number, default: 0 },
  proveedor:   { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor' },
  favorito:    { type: Boolean, default: false },              // tecla rápida en la caja
  enLinea:     { type: Boolean, default: true },               // visible en domicilios
  activo:      { type: Boolean, default: true },
}, { timestamps: true });

productoSchema.pre('validate', function (next) {
  const c = [this.codigo, ...(this.presentaciones || []).map(p => p.codigo)].map(x => String(x || '').trim()).filter(Boolean);
  const unicos = [...new Set(c)];
  if (unicos.length !== c.length) return next(new Error('Hay códigos de barras repetidos en el mismo producto'));
  this.codigos = unicos.length ? unicos : undefined;   // sin códigos no entra al índice
  if (this.tipo === 'peso' && this.unidad === 'und') this.unidad = 'kg';
  if (['servicio', 'combo'].includes(this.tipo)) this.manejaInventario = false;
  next();
});
productoSchema.index({ empresa: 1, codigos: 1 }, { unique: true, partialFilterExpression: { codigos: { $type: 'string' } } });
productoSchema.index({ empresa: 1, plu: 1 }, { unique: true, partialFilterExpression: { plu: { $gt: '' } } });
productoSchema.index({ empresa: 1, activo: 1, nombre: 1 });

module.exports = mongoose.model('Producto', productoSchema);
