const mongoose = require('mongoose');

// Inventario de números de WhatsApp de Katú (comprados en Twilio, de EE. UU.).
// Katú los asigna a las empresas con plan Pro o Premium: el comercio no hace nada.
//   disponible → asignado (en la subcuenta de la empresa, esperando el registro
//   de WhatsApp en Twilio/Meta) → activo (verificado) → liberado vuelve a disponible
const numeroSchema = new mongoose.Schema({
  numero:  { type: String, required: true, unique: true, trim: true },   // E.164: +13055550123
  sid:     { type: String, required: true },                             // PN… en Twilio
  cuenta:  { type: String, default: '' },                                // cuenta de Twilio donde está hoy (maestra o subcuenta)
  pais:    { type: String, default: 'US' },
  zona:    { type: String, default: '' },                                // ciudad / estado que informa Twilio
  estado:  { type: String, enum: ['disponible', 'asignado', 'activo'], default: 'disponible' },
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null },
  asignadoEn: Date,
  activadoEn: Date,
  historial: [{ _id: false, fecha: { type: Date, default: Date.now }, accion: String, empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa' }, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } }],
}, { timestamps: true });
numeroSchema.index({ estado: 1 });
numeroSchema.index({ empresa: 1 });

module.exports = mongoose.model('NumeroWhatsapp', numeroSchema, 'numeros_whatsapp');
