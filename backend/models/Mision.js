const mongoose = require('mongoose');

// Reto para clientes. El progreso se cuenta por ciclo (semana, mes o única vez).
const misionSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  nombre:  { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },
  icono:   { type: String, default: 'fa-bolt' },
  tipo:    { type: String, enum: ['compras', 'monto', 'producto', 'categoria', 'domicilios'], required: true },
  objetivo: { type: mongoose.Schema.Types.ObjectId },   // producto o categoría
  meta:    { type: Number, required: true, min: 1 },
  ciclo:   { type: String, enum: ['semana', 'mes', 'unica'], default: 'semana' },
  premioPuntos: { type: Number, default: 0 },
  desde: String, hasta: String,
  activo:  { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Mision', misionSchema, 'misiones');
