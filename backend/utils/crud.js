const { manejar, ErrorApi } = require('./contexto');

// Controlador CRUD de catálogos simples de una empresa. `campos` es la lista
// blanca: nada fuera de ella se escribe (nunca `empresa`).
module.exports = (Modelo, { campos, orden = { nombre: 1 }, poblar = '', validar, enUso }) => {
  const tomar = body => Object.fromEntries(campos.filter(c => body[c] !== undefined).map(c => [c, body[c] === '' && Modelo.schema.path(c)?.instance === 'ObjectId' ? null : body[c]]));
  return {
    listar: manejar(async req => Modelo.find({ empresa: req.empresa._id }).sort(orden).populate(poblar).lean()),
    crear: manejar(async (req, res) => {
      const data = tomar(req.body);
      if (validar) await validar(data, req);
      res.status(201);
      return (await Modelo.create({ ...data, empresa: req.empresa._id })).toObject();
    }),
    actualizar: manejar(async req => {
      const doc = await Modelo.findOne({ _id: req.params.id, empresa: req.empresa._id });
      if (!doc) throw new ErrorApi('Registro no encontrado', 404);
      const data = tomar(req.body);
      if (validar) await validar(data, req, doc);
      doc.set(data);
      await doc.save();
      return doc.toObject();
    }),
    eliminar: manejar(async req => {
      if (enUso) { const m = await enUso(req.params.id, req); if (m) throw new ErrorApi(m, 409); }
      const r = await Modelo.deleteOne({ _id: req.params.id, empresa: req.empresa._id });
      if (!r.deletedCount) throw new ErrorApi('Registro no encontrado', 404);
      return { eliminado: true };
    }),
  };
};
