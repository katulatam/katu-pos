const Proveedor = require('../models/Proveedor');
const Compra = require('../models/Compra');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Proveedor, {
  campos: ['nombre', 'documento', 'contacto', 'telefono', 'correo', 'diasEntrega', 'activo'],
  enUso: async (id) => (await Compra.exists({ proveedor: id }) ? 'El proveedor tiene compras: desactívalo en lugar de eliminarlo' : null),
}), { roles: ['admin', 'bodega'] });
