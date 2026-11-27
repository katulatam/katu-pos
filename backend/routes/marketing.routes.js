const r = require('express').Router();
const c = require('../controllers/marketing.controller');
const { proteger, autorizar, requiereEmpresa, requiereModulo } = require('../middleware/auth');

// Público: enlace de baja de los correos
r.get('/baja', c.baja);
r.post('/baja', c.bajaPost);

r.use(proteger, requiereEmpresa, requiereModulo('marketing'), autorizar('admin', 'supervisor'));
r.get('/resumen', c.resumen);
r.post('/segmento', c.segmento);
r.get('/plantillas', c.plantillas);
r.post('/plantillas', autorizar('admin'), c.crearPlantilla);
r.get('/campanas', c.listar);
r.get('/campanas/:id', c.detalle);
r.post('/campanas', autorizar('admin'), c.crear);
r.put('/campanas/:id', autorizar('admin'), c.actualizar);
r.post('/campanas/:id/programar', autorizar('admin'), c.programar);
r.post('/campanas/:id/pausar', autorizar('admin'), c.pausar);
r.post('/campanas/:id/reanudar', autorizar('admin'), c.reanudar);
r.post('/campanas/:id/cancelar', autorizar('admin'), c.cancelar);
r.post('/campanas/:id/prueba', autorizar('admin'), c.prueba);
// Correo con diseño
r.post('/vista-correo', c.vistaCorreo);
r.get('/productos', c.productos);
// Promoción del día
r.get('/promo-dia', c.promoDia);
r.post('/promo-dia/plantilla', autorizar('admin'), c.promoPlantilla);
r.post('/promo-dia/vista', c.promoVista);
r.post('/promo-dia', autorizar('admin'), c.promoCrear);
r.put('/config', autorizar('admin'), c.config);

module.exports = r;
