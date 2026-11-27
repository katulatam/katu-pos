const mongoose = require('mongoose');

// Caja registradora: un puesto de cobro con sus equipos. La configuración de
// equipos la lee la pantalla /pos al abrir (báscula, impresora, agente local).
const cajaSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  sede:    { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  nombre:  { type: String, required: true, trim: true },
  // caja = la atiende un cajero · autopago = el cliente escanea y paga solo
  // (usa los medios del canal 'kiosco' y solo acepta pagos confirmados por un equipo)
  tipo:    { type: String, enum: ['caja', 'autopago'], default: 'caja' },
  bascula: {
    modo:   { type: String, enum: ['ninguna', 'webserial', 'agente'], default: 'ninguna' },
    perfil: { type: String, default: 'continua' },
    puerto: { type: String, default: '' },             // solo agente: COM3, /dev/ttyUSB0
    baudRate: { type: Number, default: 9600 }, dataBits: { type: Number, default: 8 },
    parity: { type: String, enum: ['none', 'even', 'odd'], default: 'none' }, stopBits: { type: Number, default: 1 },
    comando: { type: String, default: '' }, intervaloMs: { type: Number, default: 0 },
    expresion: { type: String, default: '' }, divisor: { type: Number, default: 1 },
    unidad: { type: String, enum: ['kg', 'g', 'lb'], default: 'kg' },
    lecturas: { type: Number, default: 3 }, tolerancia: { type: Number, default: 0.002 },
  },
  impresora: {
    modo:  { type: String, enum: ['ninguna', 'navegador', 'agente'], default: 'navegador' },
    ancho: { type: Number, enum: [58, 80], default: 80 },
    destino: { type: String, default: '' },            // agente: tcp://192.168.1.50:9100 o puerto serial
    abrirCajon: { type: Boolean, default: false },
    automatica: { type: Boolean, default: true },
  },
  agenteUrl: { type: String, default: 'ws://127.0.0.1:9108' },
  activo: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Caja', cajaSchema);
