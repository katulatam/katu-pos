const mongoose = require('mongoose');
const { capitalizarNombre } = require('../utils/texto');

// Cliente final de UNA empresa. Los tipos de documento salen del país.
const clienteSchema = new mongoose.Schema({
  empresa:   { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  nombre:    { type: String, required: true, trim: true, set: capitalizarNombre },
  tipoDocumento: { type: String, default: '' },
  documento: { type: String, trim: true, default: '' },
  correo:    { type: String, trim: true, lowercase: true, default: '' },
  telefono:  { type: String, trim: true, default: '' },
  cumple:    { type: String, default: '' },              // MM-DD
  cuenta:    { type: mongoose.Schema.Types.ObjectId, ref: 'CuentaCliente' }, // app / tienda en línea
  // Gamificación
  puntos:    { type: Number, default: 0 },               // saldo redimible
  xp:        { type: Number, default: 0 },               // acumulado histórico: define el nivel
  racha:     { semanas: { type: Number, default: 0 }, mejor: { type: Number, default: 0 }, ultimaSemana: { type: String, default: '' } },
  insignias: [{ _id: false, codigo: String, nombre: String, icono: String, en: Date }],
  compras:   { type: Number, default: 0 },
  totalComprado: { type: Number, default: 0 },
  ultimaCompra: Date,
  // Fiado
  cupo:      { type: Number, default: 0 },
  deuda:     { type: Number, default: 0 },
  aceptaDatos: { type: Boolean, default: false },        // tratamiento de datos personales
  // Autorización de marketing (Ley 1581): aparte de la de datos y por canal. La baja
  // (responder BAJA o el enlace del correo) la apaga y queda registrada.
  marketing: {
    whatsapp: { type: Boolean, default: false },
    correo:   { type: Boolean, default: false },
    actualizado: Date,
    origen:   String,                                    // caja, admin, tienda, baja_whatsapp, baja_correo
  },
  activo:    { type: Boolean, default: true },
}, { timestamps: true });
clienteSchema.index({ empresa: 1, documento: 1 }, { unique: true, partialFilterExpression: { documento: { $gt: '' } } });
clienteSchema.index({ empresa: 1, cuenta: 1 }, { unique: true, partialFilterExpression: { cuenta: { $type: 'objectId' } } });
clienteSchema.index({ empresa: 1, telefono: 1 });

module.exports = mongoose.model('Cliente', clienteSchema);
