const mongoose = require('mongoose');

// Domicilio (o recogida en tienda). La venta —y su factura— se crea al entregar.
const pedidoSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:    { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  zona:    { type: mongoose.Schema.Types.ObjectId, ref: 'Zona' },
  uuid:    { type: String, required: true },
  numero:  { type: String, required: true },
  seguimiento: { type: String, required: true, unique: true }, // token del link público
  canal:   { type: String, enum: ['web', 'app', 'caja', 'telefono', 'whatsapp'], default: 'web' },
  tipo:    { type: String, enum: ['domicilio', 'recoger'], default: 'domicilio' },
  cuenta:  { type: mongoose.Schema.Types.ObjectId, ref: 'CuentaCliente' },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  contacto: { nombre: String, telefono: String },
  entrega: { direccion: String, detalle: String, lat: Number, lng: Number, distanciaM: Number, notas: String },
  adquiriente: { tipoDocumento: String, documento: String, nombre: String, correo: String },
  items: [{
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
    nombre: String, porPeso: Boolean, unidad: String, imagenUrl: String,
    cantidad: Number,          // lo pedido
    cantidadReal: Number,      // lo alistado (peso real de báscula); null = sin alistar
    precioUnitario: Number, descuento: Number, total: Number, nota: String,
  }],
  moneda: String, decimales: Number,
  totalProductos: Number, descuento: Number, domicilio: Number, total: Number,
  minutosEstimados: Number,
  medioPago: String,
  tipoPago: String,               // tipo del medio (efectivo, qr, datafono…)
  liquidado: { type: Boolean, default: false }, // efectivo del domiciliario ya entregado en caja
  pagado:  { type: Boolean, default: false },
  cobro:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cobro' },
  pagaCon: Number,
  pin:     String,             // 4 dígitos que el cliente le da al domiciliario
  intentosPin: { type: Number, default: 0 },
  estado:  { type: String, enum: ['recibido', 'preparando', 'listo', 'en_camino', 'entregado', 'cancelado'], default: 'recibido' },
  historial: [{ _id: false, estado: String, en: { type: Date, default: Date.now }, por: String }],
  domiciliario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  venta:   { type: mongoose.Schema.Types.ObjectId, ref: 'Venta' },
  motivoCancelacion: String,
  calificacion: { estrellas: Number, comentario: String },
  reservaActiva: { type: Boolean, default: false },
  reserva: [{ _id: false, producto: mongoose.Schema.Types.ObjectId, nombre: String, cantidad: Number }],
}, { timestamps: true });
pedidoSchema.index({ empresa: 1, uuid: 1 }, { unique: true });
pedidoSchema.index({ empresa: 1, estado: 1, createdAt: -1 });
pedidoSchema.index({ domiciliario: 1, estado: 1 });
pedidoSchema.index({ cuenta: 1, createdAt: -1 });

module.exports = mongoose.model('Pedido', pedidoSchema);
