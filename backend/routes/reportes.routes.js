const r = require('express').Router();
const c = require('../controllers/reportes.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

r.use(proteger, requiereEmpresa, autorizar('admin', 'supervisor'));
r.get('/dashboard', c.dashboard);
r.get('/ventas', c.ventas);

// Informes con IA: el sistema calcula los números y la IA los interpreta
const inf = require('../utils/informesIA');
const InformeIA = require('../models/InformeIA');
const { manejar, ErrorApi } = require('../utils/contexto');
r.get('/ia', manejar(async req => ({
  disponible: require('../utils/ia/openrouter').disponible(), limiteDiario: inf.LIMITE_DIARIO,
  tipos: Object.entries(inf.TIPOS).map(([k, t]) => ({ tipo: k, titulo: t.titulo, icono: t.icono })), periodos: inf.PERIODOS,
  semanal: req.empresa.informes?.semanal !== false,
  recientes: await InformeIA.find({ empresa: req.empresa._id }).sort({ createdAt: -1 }).limit(20).select('tipo periodo pregunta analisis.titular origen createdAt').lean(),
})));
r.post('/ia', manejar(req => inf.generar(req.empresa._id, { tipo: req.body.tipo, periodo: req.body.periodo, pregunta: req.body.pregunta, regenerar: !!req.body.regenerar, usuario: req.usuario._id })));
r.put('/ia/config', autorizar('admin'), manejar(async req => {
  await require('../models/Empresa').updateOne({ _id: req.empresa._id }, { 'informes.semanal': !!req.body.semanal });
  return { semanal: !!req.body.semanal };
}));
r.get('/ia/:id', manejar(async req => {
  const x = /^[a-f\d]{24}$/i.test(req.params.id) ? await InformeIA.findOne({ _id: req.params.id, empresa: req.empresa._id }).lean() : null;
  if (!x) throw new ErrorApi('Informe no encontrado', 404);
  return x;
}));

module.exports = r;
