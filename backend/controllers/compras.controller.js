const Compra = require('../models/Compra');
const Producto = require('../models/Producto');
const Proveedor = require('../models/Proveedor');
const Sede = require('../models/Sede');
const Lote = require('../models/Lote');
const Contador = require('../models/Contador');
const inventario = require('../utils/inventario');
const { manejar, ErrorApi, rangoUtc } = require('../utils/contexto');
const Motor = require('../../frontend/assets/js/motor');

exports.listar = manejar(async req => Compra.find({ empresa: req.empresa._id, createdAt: rangoUtc(req.empresa, req.query.desde, req.query.hasta) }).populate('proveedor', 'nombre').populate('sede', 'nombre').populate('usuario', 'nombre').sort({ createdAt: -1 }).limit(500).lean());

exports.crear = manejar(async (req, res) => {
  const b = req.body, dec = req.pais.decimales;
  const sede = await Sede.findOne({ _id: b.sede, empresa: req.empresa._id }).lean();
  if (!sede) throw new ErrorApi('La sede no existe');
  if (b.proveedor && !(await Proveedor.exists({ _id: b.proveedor, empresa: req.empresa._id }))) throw new ErrorApi('El proveedor no existe');
  if (!Array.isArray(b.items) || !b.items.length) throw new ErrorApi('Agrega productos a la compra');
  const prods = new Map((await Producto.find({ empresa: req.empresa._id, _id: { $in: b.items.map(i => i.producto) } }).lean()).map(p => [String(p._id), p]));
  const items = b.items.map(i => {
    const p = prods.get(String(i.producto));
    if (!p) throw new ErrorApi('Hay un producto que no existe');
    if (!p.manejaInventario) throw new ErrorApi(`${p.nombre} no maneja inventario`);
    const cantidad = Motor.r3(i.cantidad), costo = Number(i.costo);
    if (!(cantidad > 0) || !(costo >= 0)) throw new ErrorApi(`Cantidad o costo inválido en ${p.nombre}`);
    if (p.manejaVencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(i.vence || '')) throw new ErrorApi(`Indica el vencimiento de ${p.nombre}`);
    return { producto: p._id, nombre: p.nombre, cantidad, costo, total: Motor.redondear(cantidad * costo, dec), vence: i.vence || undefined, lote: i.lote || undefined };
  });
  const numero = `C-${String(await Contador.siguiente(req.empresa._id, 'compra')).padStart(5, '0')}`;
  const compra = await Compra.create({ empresa: req.empresa._id, sede: sede._id, proveedor: b.proveedor || undefined, numero, factura: b.factura, items, total: Motor.sumar(items.map(i => i.total), dec), usuario: req.usuario._id, notas: b.notas });
  await inventario.mover({ empresa: req.empresa._id, sede: sede._id, lineas: items.map(i => ({ producto: i.producto, nombre: i.nombre, cantidad: i.cantidad, costo: i.costo })), tipo: 'compra', referencia: numero, usuario: req.usuario._id });
  for (const i of items) {
    await inventario.costoPromedio({ empresa: req.empresa._id, producto: i.producto, cantidad: i.cantidad, costo: i.costo });
    if (i.vence) await Lote.create({ empresa: req.empresa._id, sede: sede._id, producto: i.producto, codigo: i.lote, vence: i.vence, cantidad: i.cantidad, restante: i.cantidad, compra: compra._id });
  }
  res.status(201);
  return compra;
});
