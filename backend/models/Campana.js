const mongoose = require('mongoose');

// Campaña de marketing de un comercio, por WhatsApp (plantilla aprobada por
// Meta) o por correo. Solo llega a clientes que autorizaron ese canal.
//   borrador → programada → enviando → enviada   (pausada: sin saldo o a mano; cancelada)
const campanaSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  nombre:   { type: String, required: true, trim: true },
  canal:    { type: String, enum: ['whatsapp', 'correo'], required: true },
  // Segmento: todos | recientes (dias) | inactivos (dias) | frecuentes (compras) | cumpleanos | nivel (nivel)
  segmento: { tipo: { type: String, default: 'todos' }, dias: Number, compras: Number, nivel: String },
  plantilla: String,                         // WhatsApp: contentSid (HX…)
  plantillaNombre: String,
  asunto:   String,                          // correo
  cuerpo:   String,                          // correo: texto; WhatsApp: vista previa de la plantilla
  estado:   { type: String, enum: ['borrador', 'programada', 'enviando', 'enviada', 'pausada', 'cancelada'], default: 'borrador' },
  motivoPausa: String,
  programadaPara: Date,
  iniciadaEn: Date,
  terminadaEn: Date,
  totales:  { destinatarios: { type: Number, default: 0 }, enviados: { type: Number, default: 0 }, fallidos: { type: Number, default: 0 }, omitidos: { type: Number, default: 0 } },
  creadaPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
}, { timestamps: true });
campanaSchema.index({ empresa: 1, createdAt: -1 });
campanaSchema.index({ estado: 1, programadaPara: 1 });

module.exports = mongoose.model('Campana', campanaSchema);
