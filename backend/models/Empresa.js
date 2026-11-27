const mongoose = require('mongoose');
const { capitalizarNombre } = require('../utils/texto');

const nivelSchema = new mongoose.Schema({ _id: false, nombre: String, desde: Number, multiplicador: { type: Number, default: 1 }, color: String, beneficio: String });
const premioSchema = new mongoose.Schema({ _id: false, nombre: String, tipo: { type: String, enum: ['puntos', 'nada'], default: 'puntos' }, valor: { type: Number, default: 0 }, peso: { type: Number, default: 1 }, color: String });

// Empresa = cliente de Katú (tienda, minimarket…). Multiempresa en una sola BD.
const empresaSchema = new mongoose.Schema({
  nombre:       { type: String, required: true, trim: true, set: capitalizarNombre },
  razonSocial:  { type: String, trim: true, default: '', set: capitalizarNombre },
  idFiscal:     { type: String, trim: true, default: '' },
  slug:         { type: String, required: true, unique: true, lowercase: true, trim: true }, // /t/<slug>
  pais:         { type: String, required: true, uppercase: true },                            // Pais.codigo
  zonaHoraria:  { type: String, required: true },                                             // una de Pais.zonasHorarias
  correo:       { type: String, trim: true, lowercase: true, default: '' },
  telefono:     { type: String, trim: true, default: '' },
  direccion:    { type: String, trim: true, default: '' },
  ciudad:       { type: String, trim: true, default: '' },
  logoUrl:      { type: String, default: '' },
  color:        { type: String, default: '#05C3DD' },
  estado:       { type: Boolean, default: true },

  // Los prende y apaga solo Katú (rol super)
  modulos: {
    facturacion:  { type: Boolean, default: true },
    domicilios:   { type: Boolean, default: true },
    gamificacion: { type: Boolean, default: true },
    fiado:        { type: Boolean, default: true },
    kiosco:       { type: Boolean, default: false },
    whatsapp:     { type: Boolean, default: false },   // domicilios por WhatsApp (bandeja + avisos)
    marketing:    { type: Boolean, default: false },   // campañas por WhatsApp y correo
  },

  // Suscripción pagada con Stripe (sin suscripción = cuenta administrada por Katú)
  suscripcion: {
    plan:      String,
    periodo:   { type: String, enum: ['mensual', 'anual'] },
    // vencida = terminó la prueba gratis sin pagar: bloqueada hasta suscribirse
    estado:    { type: String, enum: ['activa', 'prueba', 'mora', 'cancelada', 'vencida'] },
    stripeCliente:     String,
    stripeSuscripcion: String,
    actualHasta: Date,                 // fin del periodo pagado
    moraDesde:   Date,                 // primer cobro fallido (periodo de gracia)
    pruebaHasta: Date,                 // fin de la prueba gratis sin tarjeta (utils/prueba.js)
    avisosPrueba: [String],            // correos de la prueba ya enviados: d5, d1, fin
  },

  // WhatsApp propio del comercio: subcuenta de Twilio bajo la cuenta de Katú.
  // Los tokens NUNCA se guardan aquí: se derivan de las credenciales maestras del .env.
  whatsapp: {
    estado:       { type: String, enum: ['sin_configurar', 'subcuenta', 'activo'], default: 'sin_configurar' },
    subcuentaSid: { type: String, default: '' },
    servicioSid:  { type: String, default: '' },       // Messaging Service con el número
    numero:       { type: String, default: '' },       // E.164: +573001112233
    bienvenida:   { type: String, default: '' },       // respuesta automática al abrir conversación
    notificarPedidos: { type: Boolean, default: true },
    // Bot de IA (OpenRouter): atiende primero y pasa al asesor cuando hace falta
    bot: {
      activo:        { type: Boolean, default: false },
      instrucciones: { type: String, default: '' },     // horarios, políticas, tono propio del comercio
    },
    // Plantillas aprobadas por Meta (contentSid) para avisar fuera de la ventana de 24 h.
    // Variables: {{1}} nombre, {{2}} número de pedido, {{3}} enlace de seguimiento
    // Plantillas de marketing creadas desde el sistema y enviadas a aprobación de Meta
    plantillasMarketing: [{ nombre: String, contentSid: String, cuerpo: String, estado: { type: String, default: 'pendiente' }, motivo: String, creada: { type: Date, default: Date.now } }],
    plantillas: {
      recibido: { type: String, default: '' }, en_camino: { type: String, default: '' }, listo: { type: String, default: '' },
      entregado: { type: String, default: '' }, cancelado: { type: String, default: '' },
    },
    // Plantillas de avisos creadas solas al activar el número: pasan a `plantillas` cuando Meta las aprueba
    plantillasAuto: [{ _id: false, evento: String, contentSid: String, estado: { type: String, default: 'pendiente' }, motivo: String }],
  },
  // Bolsa prepagada de mensajes (la recarga Katú): SOLO para campañas de marketing
  mensajeria: {
    saldoWhatsapp: { type: Number, default: 0 },
    saldoCorreo:   { type: Number, default: 0 },
    avisosIncluidos: { type: Number, default: 0 },   // avisos de pedidos con plantilla (los asume Katú)
  },

  pos: {
    permitirStockNegativo: { type: Boolean, default: true },
    descuentoMaxCajero:    { type: Number, default: 10 },     // % sin autorización de supervisor
    redondearEfectivo:     { type: Boolean, default: true },
    prefijosBascula:       { type: [String], default: ['20', '21', '22'] },
    contenidoEtiqueta:     { type: String, enum: ['peso', 'precio'], default: 'peso' },
    pieTicket:             { type: String, default: '¡Gracias por tu compra!' },
    arqueoCiego:           { type: Boolean, default: true },
  },

  // Medios activos (los disponibles salen del país). `canales`: caja, domicilio, kiosco
  mediosPago: [{ _id: false, codigo: String, activo: { type: Boolean, default: true }, canales: { type: [String], default: ['caja'] }, orden: Number }],

  katuPay: {
    url:        { type: String, default: '' },
    clientId:   { type: String, default: '' },
    secret:     { type: String, default: '', select: false },
    subdominio: { type: String, default: '' },
  },

  // Facturación electrónica. Los campos los interpreta el proveedor del país
  // (utils/facturacion/*). Nunca se guardan tokens: van en el .env del servidor.
  facturacion: {
    activa:                  { type: Boolean, default: false },
    facturarConsumidorFinal: { type: Boolean, default: true },
    empresaProveedorId:      { type: String, default: '' },
    idFiscal:                { type: String, default: '' },
    razonSocial:             { type: String, default: '' },
    estadoHabilitacion:      { type: String, default: '' },
    resolucion: {
      numero: String, prefijo: String, desde: Number, hasta: Number,
      fechaInicio: String, fechaFin: String, claveTecnica: { type: String, select: false },
    },
    siguienteNumero: { type: Number, default: 0 },
    prefijoNotaCredito: { type: String, default: 'NC' },
    siguienteNotaCredito: { type: Number, default: 1 },
    webhookSecreto:  { type: String, default: '', select: false },
  },

  domicilios: {
    recogerEnTienda: { type: Boolean, default: true },
    minutosPreparacion: { type: Number, default: 20 },
    mensajeCerrado: { type: String, default: '' },
  },

  gamificacion: {
    montoPorPunto: { type: Number, default: 1000 },   // cada cuánto dinero se gana 1 punto
    valorPunto:    { type: Number, default: 10 },     // cuánto vale 1 punto al redimir
    minimoRedimir: { type: Number, default: 50 },
    maxPctRedimir: { type: Number, default: 50 },     // % máximo de la venta pagable con puntos
    niveles: { type: [nivelSchema], default: () => [
      { nombre: 'Chispa',    desde: 0,     multiplicador: 1,    color: '#94A3B8', beneficio: 'Acumulas puntos en cada compra' },
      { nombre: 'Voltio',    desde: 500,   multiplicador: 1.25, color: '#05C3DD', beneficio: '25% más puntos' },
      { nombre: 'Plasma',    desde: 2000,  multiplicador: 1.5,  color: '#8B5CF6', beneficio: '50% más puntos' },
      { nombre: 'Supernova', desde: 6000,  multiplicador: 2,    color: '#F59E0B', beneficio: 'Puntos dobles' },
    ] },
    ruleta: {
      activa: { type: Boolean, default: true },
      compraMinima: { type: Number, default: 30000 },
      premios: { type: [premioSchema], default: () => [
        { nombre: '10 puntos',  tipo: 'puntos', valor: 10,  peso: 40, color: '#05C3DD' },
        { nombre: 'Casi…',      tipo: 'nada',   valor: 0,   peso: 25, color: '#1A2B47' },
        { nombre: '25 puntos',  tipo: 'puntos', valor: 25,  peso: 20, color: '#6366F1' },
        { nombre: '50 puntos',  tipo: 'puntos', valor: 50,  peso: 10, color: '#8B5CF6' },
        { nombre: '200 puntos', tipo: 'puntos', valor: 200, peso: 2,  color: '#F59E0B' },
      ] },
    },
    metaDiariaCajero: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('Empresa', empresaSchema);
