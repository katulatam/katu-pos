const mongoose = require('mongoose');

// Informe con IA generado para una empresa. Los números (datos) los calcula el
// sistema; la IA solo los interpreta (analisis). Se guarda para no repetir el
// costo si alguien lo vuelve a abrir en las siguientes horas.
const informeSchema = new mongoose.Schema({
  empresa:  { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  tipo:     { type: String, required: true },       // resumen | inventario | rentabilidad | vencimientos | clientes | equipo | pregunta
  periodo:  { type: String, default: '7d' },        // hoy | 7d | 30d | mes
  desde: String, hasta: String,                     // fechas locales
  pregunta: String,
  datos:    { type: mongoose.Schema.Types.Mixed },  // lo que se le envió a la IA (sin datos personales de clientes)
  tablas:   { type: mongoose.Schema.Types.Mixed },  // listas para mostrar en el panel (pueden tener nombres)
  analisis: {                                       // respuesta de la IA
    titular: String, resumen: String,
    hallazgos: [{ _id: false, titulo: String, detalle: String, tipo: { type: String } }],
    acciones:  [{ _id: false, titulo: String, detalle: String, prioridad: String }],
  },
  modelo: String,
  uso:    { type: mongoose.Schema.Types.Mixed },
  origen: { type: String, enum: ['panel', 'semanal'], default: 'panel' },
  creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
}, { timestamps: true });
informeSchema.index({ empresa: 1, createdAt: -1 });
informeSchema.index({ empresa: 1, tipo: 1, periodo: 1, createdAt: -1 });

module.exports = mongoose.model('InformeIA', informeSchema, 'informes_ia');
