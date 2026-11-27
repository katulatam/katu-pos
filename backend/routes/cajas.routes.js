const Caja = require('../models/Caja');
const Sede = require('../models/Sede');
const Turno = require('../models/Turno');
const { ErrorApi } = require('../utils/contexto');

module.exports = require('../utils/rutasCrud')(require('../utils/crud')(Caja, {
  campos: ['nombre', 'tipo', 'sede', 'bascula', 'impresora', 'agenteUrl', 'activo'], poblar: { path: 'sede', select: 'nombre' },
  validar: async (d, req) => {
    if (d.sede && !(await Sede.exists({ _id: d.sede, empresa: req.empresa._id }))) throw new ErrorApi('La sede no existe');
    if (d.agenteUrl && !/^wss?:\/\//i.test(d.agenteUrl)) throw new ErrorApi('La dirección del agente empieza por ws:// o wss://');
    if (d.bascula?.expresion) { try { new RegExp(d.bascula.expresion); } catch { throw new ErrorApi('La expresión de la báscula no es válida'); } }
  },
  enUso: async (id) => (await Turno.exists({ caja: id }) ? 'La caja tiene turnos registrados: desactívala en lugar de eliminarla' : null),
}));
