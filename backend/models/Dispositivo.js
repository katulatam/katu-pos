const mongoose = require('mongoose');

// Equipo de cobro autónomo que habla con la nube firmando cada petición (HMAC,
// mismo esquema de los kioscos de recarga de Katú).
const dispositivoSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
  sede:     { type: mongoose.Schema.Types.ObjectId, ref: 'Sede' },
  caja:     { type: mongoose.Schema.Types.ObjectId, ref: 'Caja' },
  nombre:   { type: String, required: true, trim: true },
  tipo:     { type: String, enum: ['kiosco_efectivo', 'terminal'], required: true },
  deviceId: { type: String, required: true, unique: true, uppercase: true },
  secret:   { type: String, required: true, select: false },   // 32 bytes hex
  ultimaConexion: Date,
  activo:   { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Dispositivo', dispositivoSchema);
