const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { capitalizarNombre } = require('../utils/texto');

// Cuenta de la app / tienda en línea. Sirve para varias empresas del mismo
// país: en cada una se enlaza a un Cliente. El enlace con un cliente que YA
// existe en la tienda se hace en la caja leyendo el QR de la app (`codigo`),
// nunca por coincidencia de teléfono o documento (evita robo de puntos).
const cuentaSchema = new mongoose.Schema({
  pais:     { type: String, required: true, uppercase: true },
  nombre:   { type: String, required: true, trim: true, set: capitalizarNombre },
  telefono: { type: String, required: true, trim: true },
  correo:   { type: String, trim: true, lowercase: true, default: '' },
  password: { type: String, required: true, select: false },
  codigo:   { type: String, unique: true },
  direcciones: [{ alias: String, direccion: String, detalle: String, lat: Number, lng: Number }],
  aceptaDatos: { type: Boolean, default: false },
  estado:   { type: Boolean, default: true },
}, { timestamps: true });
cuentaSchema.index({ pais: 1, telefono: 1 }, { unique: true });
cuentaSchema.pre('save', async function (next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
  next();
});
cuentaSchema.methods.compararPassword = function (c) { return bcrypt.compare(String(c || ''), this.password); };

module.exports = mongoose.model('CuentaCliente', cuentaSchema);
