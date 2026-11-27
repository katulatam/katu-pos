const Sede = require('../models/Sede');
const Existencia = require('../models/Existencia');
const Venta = require('../models/Venta');
const { ErrorApi } = require('../utils/contexto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Sede, {
  campos: ['nombre', 'direccion', 'ciudad', 'telefono', 'zonaHoraria', 'ubicacion', 'atiendeDomicilios', 'activo'],
  validar: async (d, req) => { if (d.zonaHoraria && !req.pais.zonasHorarias.includes(d.zonaHoraria)) throw new ErrorApi('La zona horaria no corresponde al país'); },
  enUso: async (id, req) => ((await Venta.exists({ empresa: req.empresa._id, sede: id }) || await Existencia.exists({ empresa: req.empresa._id, sede: id })) ? 'La sede tiene ventas o inventario: desactívala en lugar de eliminarla' : null),
}));
