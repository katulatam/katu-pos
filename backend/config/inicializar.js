const Usuario = require('../models/Usuario');
const Pais = require('../models/Pais');
const { PAISES } = require('../utils/paises');

// En cada arranque: países (solo los que falten, nunca pisa lo editado por
// Katú) y el superusuario de soporte, oculto para las empresas.
module.exports = async () => {
  await require('../utils/suscripciones').sembrarPlanes();
  for (const [codigo, datos] of Object.entries(PAISES)) {
    await Pais.updateOne({ codigo }, { $setOnInsert: { codigo, ...datos } }, { upsert: true });
  }
  // Países creados antes de existir "ofrecida": se ofrece donde ya hay proveedor
  await Pais.updateMany({ 'facturacion.ofrecida': { $exists: false } }, [{ $set: { 'facturacion.ofrecida': { $gt: [{ $strLenCP: { $ifNull: ['$facturacion.proveedor', ''] } }, 0] } } }]);

  const correo = (process.env.KATU_ADMIN_EMAIL || 'katu@katulatam.com').toLowerCase();
  if (await Usuario.exists({ correo })) return;
  if (!process.env.KATU_ADMIN_PASSWORD) {
    console.warn('KATU_ADMIN_PASSWORD no definido: no se creó el superusuario');
    return;
  }
  await Usuario.create({ nombre: 'Katú', correo, password: process.env.KATU_ADMIN_PASSWORD, rol: 'super', oculto: true });
  console.log(`Superusuario creado: ${correo}`);
};
