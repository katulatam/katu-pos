const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const Sede = require('../models/Sede');
const Caja = require('../models/Caja');
const Venta = require('../models/Venta');
const { manejar, ErrorApi, paisPorCodigo } = require('../utils/contexto');

const empresas = require('../utils/empresas');
const slugValido = empresas.slugValido;

exports.listar = manejar(async () => {
  const desde = new Date(Date.now() - 30 * 86400000);
  const [empresas, v] = await Promise.all([
    Empresa.find().sort({ pais: 1, nombre: 1 }).lean(),
    Venta.aggregate([{ $match: { fecha: { $gte: desde }, estado: { $ne: 'anulada' } } }, { $group: { _id: '$empresa', n: { $sum: 1 }, total: { $sum: '$total' } } }]),
  ]);
  const m = Object.fromEntries(v.map(x => [String(x._id), x]));
  return empresas.map(e => ({ ...e, ventas30: m[e._id]?.n || 0, total30: m[e._id]?.total || 0 }));
});

// Alta completa: empresa + sede + caja + administrador inicial
exports.crear = manejar(async (req, res) => {
  const b = req.body;
  if (String(b.admin?.password || '').length < 8) throw new ErrorApi('El administrador necesita nombre, correo y contraseña de al menos 8 caracteres');
  const { empresa } = await empresas.crearEmpresa(b, { admin: b.admin });
  res.status(201);
  return empresa;
});

// Cuenta de Katú sin cobro: quita la prueba gratis (o la deja permanente) y no vence nunca.
// Sirve para demos, aliados o clientes que Katú factura por fuera de Stripe.
exports.cortesia = manejar(async req => {
  const e = await Empresa.findById(req.params.id).lean();
  if (!e) throw new ErrorApi('Empresa no encontrada', 404);
  const s = e.suscripcion || {};
  if (s.stripeSuscripcion && s.estado !== 'cancelada') throw new ErrorApi('Esta empresa paga con Stripe: cancela primero su suscripción en Stripe', 409);
  const activar = req.body.activa !== false;
  await Empresa.updateOne({ _id: e._id }, activar
    ? { $set: { estado: true, 'suscripcion.estado': 'activa', 'suscripcion.cortesia': true, 'suscripcion.plan': s.plan || 'premium' }, $unset: { 'suscripcion.pruebaHasta': 1, 'suscripcion.avisosPrueba': 1, 'suscripcion.moraDesde': 1 } }
    : { $unset: { 'suscripcion.cortesia': 1 } });
  return Empresa.findById(e._id).lean();
});

exports.actualizar = manejar(async req => {
  const doc = await Empresa.findById(req.params.id);
  if (!doc) throw new ErrorApi('Empresa no encontrada', 404);
  const b = req.body;
  ['nombre', 'razonSocial', 'idFiscal', 'correo', 'telefono', 'direccion', 'ciudad', 'estado'].forEach(k => { if (b[k] !== undefined) doc[k] = b[k]; });
  if (b.modulos) Object.keys(doc.toObject().modulos).forEach(k => { if (b.modulos[k] !== undefined) doc.modulos[k] = !!b.modulos[k]; });
  if (b.pais && b.pais !== doc.pais) {
    if (await Venta.exists({ empresa: doc._id })) throw new ErrorApi('No se puede cambiar el país: la empresa ya tiene ventas', 409);
    const pais = await paisPorCodigo(b.pais);
    doc.pais = pais.codigo; doc.zonaHoraria = pais.zonaHoraria; doc.mediosPago = [];
  }
  if (b.zonaHoraria) {
    const pais = await paisPorCodigo(doc.pais);
    if (!pais.zonasHorarias.includes(b.zonaHoraria)) throw new ErrorApi('La zona horaria no corresponde al país');
    doc.zonaHoraria = b.zonaHoraria;
  }
  if (b.slug && b.slug !== doc.slug) { if (!slugValido(b.slug)) throw new ErrorApi('Identificador web inválido'); doc.slug = b.slug; }
  await doc.save();
  return doc;
});
