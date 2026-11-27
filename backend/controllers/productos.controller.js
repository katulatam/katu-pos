const XLSX = require('xlsx');
const Producto = require('../models/Producto');
const Categoria = require('../models/Categoria');
const Existencia = require('../models/Existencia');
const Venta = require('../models/Venta');
const { manejar, ErrorApi } = require('../utils/contexto');
const crud = require('../utils/crud');
const Motor = require('../../frontend/assets/js/motor');

const CAMPOS = ['nombre', 'descripcion', 'categoria', 'marca', 'tipo', 'unidad', 'codigo', 'plu', 'precio', 'costo', 'impuesto', 'presentaciones', 'componentes', 'imagenUrl', 'manejaInventario', 'manejaVencimiento', 'minimo', 'proveedor', 'favorito', 'enLinea', 'activo'];
const rx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function validar(d, req, doc) {
  const dec = req.pais.decimales;
  if (d.precio !== undefined) { d.precio = Motor.redondear(d.precio, dec); if (!(d.precio >= 0)) throw new ErrorApi('Precio inválido'); }
  if (d.impuesto && !req.pais.impuestos.some(i => i.codigo === d.impuesto)) throw new ErrorApi('El impuesto no corresponde al país');
  if (d.plu) { if (!/^\d{1,5}$/.test(d.plu)) throw new ErrorApi('El PLU son máximo 5 dígitos'); d.plu = d.plu.padStart(5, '0'); }
  if (d.imagenUrl && !/^https:\/\//i.test(d.imagenUrl)) throw new ErrorApi('La imagen debe ser una dirección https');
  if (d.presentaciones) {
    d.presentaciones = d.presentaciones.filter(p => p.nombre).map(p => ({ ...p, codigo: String(p.codigo || '').trim(), precio: Motor.redondear(p.precio, dec), factor: Number(p.factor) || 1 }));
    if (d.presentaciones.some(p => !(p.factor > 0) || !(p.precio >= 0))) throw new ErrorApi('Revisa el factor y el precio de las presentaciones');
  }
  const tipo = d.tipo || doc?.tipo;
  if (d.componentes) {
    d.componentes = tipo === 'combo' ? d.componentes.filter(c => c.producto && Number(c.cantidad) > 0) : [];
    if (tipo === 'combo') {
      if (!d.componentes.length) throw new ErrorApi('El combo necesita componentes');
      const n = await Producto.countDocuments({ _id: { $in: d.componentes.map(c => c.producto) }, empresa: req.empresa._id, tipo: { $ne: 'combo' } });
      if (n !== new Set(d.componentes.map(c => String(c.producto))).size) throw new ErrorApi('Los componentes del combo deben ser productos de la empresa (no otros combos)');
    }
  }
}
const base = crud(Producto, { campos: CAMPOS, validar, enUso: async id => (await Venta.exists({ 'items.producto': id }) ? 'El producto tiene ventas: desactívalo en lugar de eliminarlo' : null) });
exports.crear = base.crear;
exports.actualizar = base.actualizar;
exports.eliminar = base.eliminar;

exports.listar = manejar(async req => {
  const { q, categoria, estado, pagina = 1, limite = 50 } = req.query;
  const f = { empresa: req.empresa._id };
  if (estado === 'activos') f.activo = true;
  if (estado === 'inactivos') f.activo = false;
  if (categoria) f.categoria = categoria;
  if (q) f.$or = [{ nombre: new RegExp(rx(q), 'i') }, { codigos: String(q) }, { plu: String(q).padStart(5, '0') }, { marca: new RegExp(rx(q), 'i') }];
  const lim = Math.min(2000, Number(limite) || 50);
  const [items, total] = await Promise.all([
    Producto.find(f).sort({ nombre: 1 }).skip((Math.max(1, Number(pagina)) - 1) * lim).limit(lim).populate('categoria', 'nombre color icono').lean(),
    Producto.countDocuments(f),
  ]);
  const ex = await Existencia.aggregate([{ $match: { empresa: req.empresa._id, producto: { $in: items.map(i => i._id) } } }, { $group: { _id: '$producto', n: { $sum: '$cantidad' } } }]);
  const m = Object.fromEntries(ex.map(e => [String(e._id), e.n]));
  return { items: items.map(i => ({ ...i, existencia: Motor.r3(m[i._id] || 0) })), total, pagina: Number(pagina), limite: lim };
});

const COLUMNAS = { codigo: 'Codigo', plu: 'PLU', nombre: 'Nombre', categoria: 'Categoria', marca: 'Marca', tipo: 'Tipo', precio: 'Precio', costo: 'Costo', impuesto: 'Impuesto', minimo: 'Minimo' };
exports.exportar = manejar(async (req, res) => {
  const items = await Producto.find({ empresa: req.empresa._id }).sort({ nombre: 1 }).populate('categoria', 'nombre').lean();
  const filas = items.map(p => ({ Codigo: p.codigo, PLU: p.plu, Nombre: p.nombre, Categoria: p.categoria?.nombre || '', Marca: p.marca, Tipo: p.tipo, Precio: p.precio, Costo: p.costo, Impuesto: p.impuesto, Minimo: p.minimo }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas, { header: Object.values(COLUMNAS) }), 'Productos');
  res.setHeader('Content-Disposition', 'attachment; filename="productos.xlsx"');
  res.type('xlsx').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});
// Importar de Excel: crea o actualiza por código de barras (o PLU)
exports.importar = manejar(async req => {
  if (!req.file) throw new ErrorApi('Adjunta el archivo de Excel');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!filas.length) throw new ErrorApi('El archivo no tiene filas');
  if (filas.length > 10000) throw new ErrorApi('Máximo 10.000 filas por archivo');
  const cats = new Map((await Categoria.find({ empresa: req.empresa._id }).lean()).map(c => [c.nombre.toLowerCase(), c._id]));
  const r = { creados: 0, actualizados: 0, errores: [] };
  for (const [i, f] of filas.entries()) {
    try {
      const d = {};
      Object.entries(COLUMNAS).forEach(([k, col]) => { if (f[col] !== undefined && f[col] !== '') d[k] = ['precio', 'costo', 'minimo'].includes(k) ? Number(f[col]) : String(f[col]).trim(); });
      if (!d.nombre || !(d.precio >= 0)) throw new Error('Nombre y Precio son obligatorios');
      if (d.categoria) {
        const k = d.categoria.toLowerCase();
        if (!cats.has(k)) cats.set(k, (await Categoria.create({ empresa: req.empresa._id, nombre: d.categoria }))._id);
        d.categoria = cats.get(k);
      }
      if (d.tipo && !['unidad', 'peso', 'servicio'].includes(d.tipo)) delete d.tipo;
      await validar(d, req);
      const previo = d.codigo ? await Producto.findOne({ empresa: req.empresa._id, codigos: d.codigo }) : d.plu ? await Producto.findOne({ empresa: req.empresa._id, plu: d.plu }) : null;
      if (previo) { delete d.costo; previo.set(d); await previo.save(); r.actualizados++; }
      else { await Producto.create({ ...d, empresa: req.empresa._id }); r.creados++; }
    } catch (e) { if (r.errores.length < 100) r.errores.push({ fila: i + 2, error: e.code === 11000 ? 'Código o PLU repetido' : e.message }); }
  }
  return r;
});
