const mongoose = require('mongoose');

// Solicitud de suscripción desde la landing. Reserva el subdominio mientras el
// cliente paga en Stripe; al confirmarse el pago se crea la empresa (una sola vez).
//   pendiente → pagado → listo   (error: requiere revisión del equipo Katú)
// tipo prueba: sin pago, la empresa se crea al instante con la prueba gratis.
const registroSchema = new mongoose.Schema({
  tipo:       { type: String, enum: ['pago', 'prueba'], default: 'pago' },
  estado:     { type: String, enum: ['pendiente', 'pagado', 'listo', 'error', 'vencido'], default: 'pendiente' },
  plan:       { type: String, required: true },
  periodo:    { type: String, enum: ['mensual', 'anual'], default: 'mensual' },
  negocio:    { type: String, required: true, trim: true },
  nombre:     { type: String, required: true, trim: true },
  correo:     { type: String, required: true, lowercase: true, trim: true },
  telefono:   { type: String, default: '' },
  telefonoNorm: { type: String, default: '' },          // solo dígitos: una prueba por celular
  pais:       { type: String, required: true },
  subdominio: { type: String, required: true, lowercase: true, trim: true },
  stripeSesion: String,
  stripeCliente: String,
  stripeSuscripcion: String,
  empresa:    { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa' },
  error:      String,
  expira:     { type: Date, required: true },          // reserva del subdominio
}, { timestamps: true });
registroSchema.index({ subdominio: 1, estado: 1 });
registroSchema.index({ tipo: 1, telefonoNorm: 1 });
registroSchema.index({ stripeSesion: 1 }, { partialFilterExpression: { stripeSesion: { $type: 'string' } } });

module.exports = mongoose.model('Registro', registroSchema);
