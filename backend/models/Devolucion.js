const mongoose = require('mongoose');

const devolucionSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:    { type: mongoose.Schema.Types.ObjectId, ref: 'Sede' },
  venta:   { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', required: true },
  turno:   { type: mongoose.Schema.Types.ObjectId, ref: 'Turno' },
  tipo:    { type: String, enum: ['total', 'parcial'] },
  items:   [{ _id: false, item: mongoose.Schema.Types.ObjectId, producto: mongoose.Schema.Types.ObjectId, nombre: String, cantidad: Number, total: Number }],
  monto:   Number,
  medio:   String,       // por dónde se devolvió el dinero
  motivo:  String,
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  documento: {           // nota crédito electrónica
    estado: { type: String, default: 'no_aplica' },
    idProveedor: String, numeroReservado: Number, llave: String, numero: String, error: String,
    codigoUnico: String, observaciones: [String], proveedor: String,
    intentos: { type: Number, default: 0 }, ultimoIntento: Date,
  },
}, { timestamps: true });
devolucionSchema.index({ empresa: 1, createdAt: -1 });
devolucionSchema.index({ 'documento.estado': 1 });

module.exports = mongoose.model('Devolucion', devolucionSchema, 'devoluciones');
