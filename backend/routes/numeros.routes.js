const r = require('express').Router();
const n = require('../utils/whatsapp/numeros');
const { proteger, soloSuper } = require('../middleware/auth');
const { manejar } = require('../utils/contexto');

// Exclusivo del equipo Katú: inventario de números de WhatsApp y asignación a empresas
r.use(proteger, soloSuper);
r.get('/', manejar(() => n.listar()));
r.get('/disponibles', manejar(req => n.buscar(req.query)));                 // para comprar en Twilio
r.post('/', manejar(req => n.comprar(req.body, req.usuario._id)));
r.post('/registrar', manejar(req => n.registrar(req.body, req.usuario._id))); // ya comprado en la consola
r.post('/asignar', manejar(req => n.asignar(req.body, req.usuario._id)));
r.get('/:id/guia', manejar(async req => {
  const NumeroWhatsapp = require('../models/NumeroWhatsapp'), Empresa = require('../models/Empresa');
  const x = await NumeroWhatsapp.findById(req.params.id).lean();
  return x?.empresa ? n.guia(await Empresa.findById(x.empresa).lean(), x.numero) : null;
}));
r.post('/:id/verificar', manejar(req => n.verificar(req.params.id, req.usuario._id)));
r.post('/:id/liberar', manejar(req => n.liberar(req.params.id, req.usuario._id)));
r.delete('/:id', manejar(req => n.darDeBaja(req.params.id)));

module.exports = r;
