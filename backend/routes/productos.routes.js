const r = require('express').Router();
const multer = require('multer');
const c = require('../controllers/productos.controller');
const { proteger, autorizar, requiereEmpresa } = require('../middleware/auth');

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
r.use(proteger, requiereEmpresa);
r.get('/', c.listar);
r.get('/exportar', autorizar('admin', 'bodega'), c.exportar);
r.post('/importar', autorizar('admin', 'bodega'), subir.single('archivo'), c.importar);
r.post('/', autorizar('admin', 'bodega'), c.crear);
r.put('/:id', autorizar('admin', 'bodega'), c.actualizar);
r.delete('/:id', autorizar('admin'), c.eliminar);
// Fotos: el panel las prepara (JPG cuadrado + miniatura) antes de subirlas
const foto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 2 } });
r.post('/codigos', autorizar('admin', 'bodega'), c.porCodigos);
r.post('/:id/imagen', autorizar('admin', 'bodega'), foto.fields([{ name: 'imagen', maxCount: 1 }, { name: 'mini', maxCount: 1 }]), c.subirImagen);
r.delete('/:id/imagen', autorizar('admin', 'bodega'), c.quitarImagen);

module.exports = r;
