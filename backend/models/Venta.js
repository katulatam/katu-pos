const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  categoria: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria' },
  nombre: String, codigo: String, unidad: String, porPeso: Boolean,
  cantidad: Number, factor: { type: Number, default: 1 }, presentacion: String,
  precioUnitario: Number, bruto: Number, descuento: Number, promocion: String,
  impuestoCodigo: String, impuestoTipo: String, impuestoPct: Number,
  base: Number, impuesto: Number, total: Number, costo: Number,
  cantidadDevuelta: { type: Number, default: 0 },
});

// Documento electrónico: lo llena utils/facturacion según el proveedor del país
const documentoSchema = new mongoose.Schema({
  _id: false,
  // no_aplica | pendiente | emitida | aceptada | observaciones | validacion | rechazada | error | omitida
  estado: { type: String, default: 'no_aplica' },
  proveedor: String, idProveedor: String, numeroReservado: Number, llave: String,
  numero: String, codigoUnico: String, urlConsulta: String, observaciones: [String], error: String,
  intentos: { type: Number, default: 0 }, ultimoIntento: Date,
});

const ventaSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:    { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  caja:    { type: mongoose.Schema.Types.ObjectId, ref: 'Caja' },
  turno:   { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
  cajero:  { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  uuid:    { type: String, required: true },          // idempotencia (lo genera la caja)
  numero:  { type: String, required: true },
  origen:  { type: String, enum: ['caja', 'domicilio', 'kiosco'], default: 'caja' },
  pedido:  { type: mongoose.Schema.Types.ObjectId, ref: 'Pedido' },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  clienteNombre: String,
  // Factura a nombre de alguien (vacío = consumidor final del país)
  adquiriente: { tipoDocumento: String, documento: String, nombre: String, correo: String },
  // Moneda congelada: la venta conserva la del país con que se hizo
  moneda: String, decimales: Number,
  items: [itemSchema],
  subtotal: Number, descuento: Number, base: Number, impuesto: Number, domicilio: { type: Number, default: 0 }, total: Number,
  redondeo: { type: Number, default: 0 },             // diferencia por redondeo del efectivo
  pagos: [{ _id: false, medio: String, nombre: String, tipo: { type: String }, monto: Number, recibido: Number, cambio: Number, referencia: String, cobro: { type: mongoose.Schema.Types.ObjectId, ref: 'Cobro' } }],
  estado: { type: String, enum: ['completada', 'devuelta_parcial', 'anulada'], default: 'completada' },
  puntosGanados: { type: Number, default: 0 },
  puntosRedimidos: { type: Number, default: 0 },
  puntosAplicados: { type: Boolean, default: false },
  giro: { disponible: { type: Boolean, default: false }, premio: String, puntos: Number, en: Date },
  documento: { type: documentoSchema, default: () => ({}) },
  offline: { type: Boolean, default: false },
  diferenciaPrecio: { type: Boolean, default: false }, // sin conexión se cobró un precio distinto al vigente
  autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  fecha: { type: Date, default: Date.now },            // momento real de la venta (caja)
}, { timestamps: true });
ventaSchema.index({ empresa: 1, uuid: 1 }, { unique: true });
ventaSchema.index({ empresa: 1, numero: 1 }, { unique: true });
ventaSchema.index({ empresa: 1, fecha: -1 });
ventaSchema.index({ turno: 1 });
ventaSchema.index({ cliente: 1, fecha: -1 });
ventaSchema.index({ 'documento.estado': 1, 'documento.ultimoIntento': 1 });
ventaSchema.index({ 'documento.idProveedor': 1 });

module.exports = mongoose.model('Venta', ventaSchema);
