const Mision = require('../models/Mision');
const { ErrorApi } = require('../utils/contexto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Mision, {
  campos: ['nombre', 'descripcion', 'icono', 'tipo', 'objetivo', 'meta', 'ciclo', 'premioPuntos', 'desde', 'hasta', 'activo'], orden: { createdAt: -1 },
  validar: async d => { if (['producto', 'categoria'].includes(d.tipo) && !d.objetivo) throw new ErrorApi('Elige el producto o la categoría de la misión'); },
}), { modulo: 'gamificacion' });
