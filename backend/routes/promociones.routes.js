const Promocion = require('../models/Promocion');
const { ErrorApi } = require('../utils/contexto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Promocion, {
  campos: ['nombre', 'tipo', 'valor', 'lleva', 'paga', 'alcance', 'objetivos', 'desde', 'hasta', 'horaDesde', 'horaHasta', 'dias', 'activo'], orden: { createdAt: -1 },
  validar: async d => {
    if (d.tipo === 'nxm' && !(Number(d.lleva) > Number(d.paga) && Number(d.paga) >= 0)) throw new ErrorApi('En "lleva N paga M", N debe ser mayor que M');
    if (d.tipo === 'porcentaje' && !(Number(d.valor) > 0 && Number(d.valor) <= 100)) throw new ErrorApi('El porcentaje va de 1 a 100');
    if (d.alcance && d.alcance !== 'todo' && !(d.objetivos || []).length) throw new ErrorApi('Elige al menos un producto o categoría');
  },
}));
