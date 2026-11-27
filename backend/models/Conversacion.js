const mongoose = require('mongoose');

// Conversación de WhatsApp entre un cliente final y el comercio. Hay una por
// teléfono y empresa: si se cerró y el cliente vuelve a escribir, se reabre.
//  - espera:  nadie la ha tomado (cola de la bandeja)
//  - asesor:  la atiende un asesor humano
//  - bot:     la atiende el agente de IA (fase 2)
//  - cerrada: atendida
const conversacionSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  telefono: { type: String, required: true },              // E.164: +573001112233
  nombre:   { type: String, default: '' },                 // nombre de perfil de WhatsApp
  cliente:  { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  cuenta:   { type: mongoose.Schema.Types.ObjectId, ref: 'CuentaCliente' },
  estado:   { type: String, enum: ['espera', 'asesor', 'bot', 'cerrada'], default: 'espera' },
  asesor:   { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  ultimoTexto: { type: String, default: '' },
  ultimoEn:    { type: Date, default: Date.now },
  ultimaEntrante: Date,                                    // abre la ventana de 24 h de WhatsApp
  sinLeer:  { type: Number, default: 0 },
  ubicacion: { lat: Number, lng: Number, direccion: String, en: Date }, // última compartida por el cliente
  pedidos:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pedido' }],
  // Estado del bot: historial en formato del modelo, carrito y hasta qué mensaje leyó.
  // Se reinicia cuando la conversación se reabre.
  ia: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  cerradaEn: Date,
}, { timestamps: true });
conversacionSchema.index({ empresa: 1, telefono: 1 }, { unique: true });
conversacionSchema.index({ empresa: 1, estado: 1, ultimoEn: -1 });

module.exports = mongoose.model('Conversacion', conversacionSchema);
