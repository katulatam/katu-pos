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
  // normal | promo_dia (promoción del día: plantilla reutilizable con la oferta como variable)
  tipo:     { type: String, enum: ['normal', 'promo_dia'], default: 'normal' },
  grupo:    String,                          // las campañas de WhatsApp y correo de una misma promoción
  plantilla: String,                         // WhatsApp: contentSid (HX…)
  plantillaNombre: String,
  variables: { type: mongoose.Schema.Types.Mixed, default: undefined }, // WhatsApp: {{2}}, {{3}}… ({{1}} = nombre)
  promo: {                                   // promoción del día: lo que se ofrece
    texto: String, enlace: String,
    items: [{ _id: false, producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' }, nombre: String, precio: Number, precioAntes: Number }],
    promociones: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Promocion' }], // descuentos creados en el POS
  },
  asunto:   String,                          // correo
  preheader: String,                         // correo: texto corto que se ve junto al asunto
  formato:  { type: String, enum: ['texto', 'diseno', 'html'], default: 'texto' }, // correo
  bloques:  { type: [mongoose.Schema.Types.Mixed], default: undefined },           // correo con diseño
  html:     String,                          // correo con HTML propio (ya limpio)
  colorCorreo: String,                       // correo con diseño: color principal (por defecto el de la empresa)
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
