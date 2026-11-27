const mongoose = require('mongoose');

// Un destinatario de una campaña. La lista se congela al empezar el envío y
// cada uno se envía una sola vez (índice único campaña + cliente).
const envioSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  campana:  { type: mongoose.Schema.Types.ObjectId, ref: 'Campana', required: true },
  cliente:  { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  destino:  String,                          // E.164 o correo
  canal:    String,                          // whatsapp | correo (para el límite por cliente)
  tipo:     String,                          // normal | promo_dia
  estado:   { type: String, enum: ['pendiente', 'enviado', 'entregado', 'leido', 'fallido', 'omitido'], default: 'pendiente' },
  motivo:   String,                          // por qué se omitió (se dio de baja, límite semanal…)
  sid:      String,                          // id del proveedor (para los avisos de estado)
  error:    String,
  enviadoEn: Date,
}, { timestamps: true });
envioSchema.index({ campana: 1, cliente: 1 }, { unique: true });
envioSchema.index({ campana: 1, estado: 1 });
envioSchema.index({ cliente: 1, canal: 1, enviadoEn: -1 });   // límite de mensajes por cliente
envioSchema.index({ sid: 1 }, { partialFilterExpression: { sid: { $type: 'string' } } });

module.exports = mongoose.model('EnvioCampana', envioSchema);
