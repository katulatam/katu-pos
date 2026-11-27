const mongoose = require('mongoose');

// País: define moneda, zona horaria, decimales, impuestos, documentos, medios
// de pago y con qué proveedor se emite la facturación electrónica. Toda
// empresa (cliente de Katú) pertenece a un país. Lo administra solo Katú.
const paisSchema = new mongoose.Schema({
  codigo:          { type: String, required: true, unique: true, uppercase: true, trim: true }, // ISO 3166-1
  nombre:          { type: String, required: true, trim: true },
  moneda:          { type: String, required: true, uppercase: true, trim: true },               // ISO 4217
  simbolo:         { type: String, default: '$' },
  decimales:       { type: Number, default: 2, min: 0, max: 4 },
  locale:          { type: String, default: 'es-CO' },
  zonaHoraria:     { type: String, required: true },   // por defecto para las empresas nuevas
  zonasHorarias:   [String],                           // las que puede elegir una empresa o sede
  prefijoTelefono: { type: String, default: '' },
  nombreIdFiscal:  { type: String, default: 'Identificación fiscal' },
  redondeoEfectivo:{ type: Number, default: 0 },       // moneda más pequeña en uso
  billetes:        [Number],
  impuestos: [{ _id: false, codigo: String, nombre: String, tipo: { type: String }, pct: Number }],
  impuestoDefecto: { type: String, default: '' },
  tiposDocumento: [{ _id: false, codigo: String, nombre: String, empresa: Boolean }],
  consumidorFinal: { tipoDocumento: String, documento: String, nombre: String },
  mediosPago: [{ _id: false, codigo: String, nombre: String, tipo: { type: String }, proveedor: String, icono: String }],
  facturacion: {
    proveedor:       { type: String, default: '' },    // '' = el país no emite facturación electrónica desde Katú
    // Decisión comercial de Katú: se activa a las empresas nuevas del país y se anuncia en la
    // landing. Requiere proveedor. Apagarlo no corta a las empresas que ya facturan.
    ofrecida:        { type: Boolean, default: false },
    nombreDocumento: { type: String, default: 'Factura' },
    entidad:         { type: String, default: '' },
    codigoUnico:     { type: String, default: '' },
  },
  // Bolsas de mensajes para marketing que los comercios del país compran con Stripe.
  // Las cantidades son múltiplos de 1.000; los precios los define Katú en Admin → Países.
  bolsas: {
    moneda:   { type: String, default: 'USD', uppercase: true, trim: true },
    paquetes: [{ _id: false, canal: { type: String, enum: ['whatsapp', 'correo'] }, cantidad: Number, precio: Number }],
  },
  activo: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Pais', paisSchema, 'paises');
