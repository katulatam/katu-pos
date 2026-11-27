const Categoria = require('../models/Categoria');
const Producto = require('../models/Producto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Categoria, {
  campos: ['nombre', 'color', 'icono', 'orden', 'enLinea', 'activo'], orden: { orden: 1, nombre: 1 },
  enUso: async (id) => (await Producto.exists({ categoria: id }) ? 'La categoría tiene productos: muévelos o desactívala' : null),
}), { roles: ['admin', 'bodega'] });
