const mongoose = require('mongoose');

// Plan de suscripción de Katú POS. Los precios se editan en el admin (equipo
// Katú) y Stripe cobra exactamente lo que diga aquí al momento de suscribirse:
// no hace falta crear precios en el panel de Stripe.
const planSchema = new mongoose.Schema({
  codigo:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  nombre:      { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },
  moneda:      { type: String, default: 'COP', uppercase: true },
  precioMensual: { type: Number, required: true, min: 0 },
  precioAnual:   { type: Number, required: true, min: 0 },
  // Módulos que se activan al suscribirse (mismos nombres que Empresa.modulos)
  modulos: {
    facturacion: Boolean, domicilios: Boolean, gamificacion: Boolean, fiado: Boolean,
    kiosco: Boolean, whatsapp: Boolean, marketing: Boolean,
  },
  caracteristicas: [String],          // lo que se muestra en la landing
  destacado: { type: Boolean, default: false },
  diasPrueba: { type: Number, default: 0 },
  orden:     { type: Number, default: 0 },
  activo:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
