const Zona = require('../models/Zona');
const Sede = require('../models/Sede');
const geo = require('../utils/geo');
const { ErrorApi } = require('../utils/contexto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Zona, {
  campos: ['sede', 'nombre', 'tipo', 'centro', 'radioM', 'poligono', 'color', 'tarifaBase', 'kmIncluidos', 'tarifaKm', 'gratisDesde', 'pedidoMinimo', 'minutos', 'dias', 'horaDesde', 'horaHasta', 'prioridad', 'activo'], orden: { prioridad: 1, nombre: 1 },
  validar: async (d, req, doc) => {
    const z = { ...(doc ? doc.toObject() : {}), ...d };
    if (!z.sede || !(await Sede.exists({ _id: z.sede, empresa: req.empresa._id }))) throw new ErrorApi('La sede no existe');
    if (z.tipo === 'poligono') { if (!(z.poligono?.length >= 3) || !z.poligono.every(geo.puntoValido)) throw new ErrorApi('Dibuja al menos 3 puntos del polígono'); }
    else if (!geo.puntoValido(z.centro) || !(z.radioM >= 50 && z.radioM <= 100000)) throw new ErrorApi('Marca el centro y un radio entre 50 m y 100 km');
  },
}), { modulo: 'domicilios' });
