const mongoose = require('mongoose');

const contadorSchema = new mongoose.Schema({ _id: String, valor: { type: Number, default: 0 } });
// Consecutivo atómico por empresa
contadorSchema.statics.siguiente = async function (empresa, clave) {
  const c = await this.findOneAndUpdate({ _id: `${empresa}:${clave}` }, { $inc: { valor: 1 } }, { new: true, upsert: true });
  return c.valor;
};

module.exports = mongoose.model('Contador', contadorSchema, 'contadores');
