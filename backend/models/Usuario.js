const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { capitalizarNombre } = require('../utils/texto');

// Cuentas del personal.
//  - super:        equipo Katú. Sin empresa: entra a cualquiera (header x-empresa).
//  - admin:        dueño/administrador de la empresa.
//  - supervisor:   ventas, anulaciones, autoriza descuentos con su PIN.
//  - cajero:       solo la caja.
//  - bodega:       inventario y compras.
//  - domiciliario: app/web de entregas.
const usuarioSchema = new mongoose.Schema({
  nombre:   { type: String, required: true, trim: true, set: capitalizarNombre },
  correo:   { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  pin:      { type: String, select: false },              // 4–6 dígitos (hash): autorizaciones en caja
  rol:      { type: String, enum: ['super', 'admin', 'supervisor', 'cajero', 'bodega', 'domiciliario', 'asesor'], default: 'cajero' },
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', index: true },
  sede:     { type: mongoose.Schema.Types.ObjectId, ref: 'Sede' },
  telefono: { type: String, trim: true, default: '' },
  vehiculo: { type: String, trim: true, default: '' },    // domiciliario: moto, bici… placa
  disponible: { type: Boolean, default: false },          // domiciliario en turno
  // Solo la ÚLTIMA posición, y solo mientras lleva un pedido (nunca historial)
  ubicacion: { lat: Number, lng: Number, en: Date },
  oculto:   { type: Boolean, default: false },            // soporte Katú: nunca aparece en listados
  ultimoAcceso: Date,
  // Enlace para crear o recuperar la contraseña (se guarda solo el hash, vence)
  claveToken: { type: String, select: false },
  claveVence: { type: Date, select: false },
  estado:   { type: Boolean, default: true },
}, { timestamps: true });

usuarioSchema.pre('save', async function (next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
  if (this.isModified('pin') && this.pin) this.pin = await bcrypt.hash(this.pin, 10);
  next();
});
usuarioSchema.methods.compararPassword = function (c) { return bcrypt.compare(String(c || ''), this.password); };

module.exports = mongoose.model('Usuario', usuarioSchema);
