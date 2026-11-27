const mongoose = require('mongoose');

// Turno de caja: apertura con base, movimientos y cierre con arqueo.
const turnoSchema = new mongoose.Schema({
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  sede:    { type: mongoose.Schema.Types.ObjectId, ref: 'Sede', required: true },
  caja:    { type: mongoose.Schema.Types.ObjectId, ref: 'Caja', required: true },
  cajero:  { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  estado:  { type: String, enum: ['abierto', 'cerrado'], default: 'abierto' },
  base:    { type: Number, default: 0 },
  abiertoEn: { type: Date, default: Date.now },
  cerradoEn: Date,
  movimientos: [{
    tipo: { type: String, enum: ['ingreso', 'egreso'] }, monto: Number, concepto: String,
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }, en: { type: Date, default: Date.now },
  }],
  arqueo: {
    contado:  { type: mongoose.Schema.Types.Mixed },   // { efectivo, datafono, … }
    esperado: { type: mongoose.Schema.Types.Mixed },
    diferencia: { type: mongoose.Schema.Types.Mixed },
    diferenciaTotal: Number, ventas: Number, total: Number, notas: String,
    cerradoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  },
}, { timestamps: true });
// Una caja solo puede tener un turno abierto (índice parcial: evita la carrera)
turnoSchema.index({ caja: 1 }, { unique: true, partialFilterExpression: { estado: 'abierto' } });
turnoSchema.index({ empresa: 1, abiertoEn: -1 });

module.exports = mongoose.model('Turno', turnoSchema);
