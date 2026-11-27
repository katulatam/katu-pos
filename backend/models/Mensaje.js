const mongoose = require('mongoose');

// Mensaje de WhatsApp. `sid` es el id del proveedor: llega en los avisos de
// estado (enviado → entregado → leído) y evita guardar dos veces un entrante.
const mensajeSchema = new mongoose.Schema({
  empresa:      { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  conversacion: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversacion', required: true },
  direccion:    { type: String, enum: ['entrante', 'saliente'], required: true },
  autor:        { type: String, enum: ['cliente', 'asesor', 'bot', 'sistema'], required: true },
  usuario:      { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  texto:        { type: String, default: '' },
  media:        [{ _id: false, url: String, tipo: String }],
  ubicacion:    { lat: Number, lng: Number, direccion: String },
  plantilla:    String,                                    // contentSid si se envió con plantilla
  sid:          String,
  estado:       { type: String, enum: ['recibido', 'enviando', 'enviado', 'entregado', 'leido', 'fallido'], default: 'enviando' },
  error:        String,
}, { timestamps: true });
mensajeSchema.index({ conversacion: 1, createdAt: 1 });
mensajeSchema.index({ sid: 1 }, { unique: true, partialFilterExpression: { sid: { $type: 'string' } } });

module.exports = mongoose.model('Mensaje', mensajeSchema);
