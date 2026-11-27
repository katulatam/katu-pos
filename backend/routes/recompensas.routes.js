const Recompensa = require('../models/Recompensa');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Recompensa, {
  campos: ['nombre', 'descripcion', 'icono', 'puntos', 'descuento', 'nivelMinimo', 'activo'], orden: { puntos: 1 },
}), { modulo: 'gamificacion' });
