const Existencia = require('../models/Existencia');
const MovimientoInventario = require('../models/MovimientoInventario');
const Lote = require('../models/Lote');
const Producto = require('../models/Producto');
const { ErrorApi } = require('./contexto');
const { r3 } = require('../../frontend/assets/js/motor');

// Suma atómica con redondeo a 3 decimales (evita 0.30000000004 kg acumulados).
// Con `minimo` no deja bajar el disponible (cantidad − reservado) de cero.
async function _sumar({ empresa, sede, producto, delta, campo = 'cantidad', estricto = false }) {
  const filtro = { sede, producto };
  if (estricto) {
    filtro.empresa = empresa;
    filtro.$expr = { $gte: [{ $round: [{ $subtract: [{ $ifNull: ['$cantidad', 0] }, { $ifNull: ['$reservado', 0] }] }, 3] }, Math.abs(delta)] };
  }
  const cambio = [{ $set: {
    empresa, cantidad: { $ifNull: ['$cantidad', 0] }, reservado: { $ifNull: ['$reservado', 0] },
    createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW',
  } }, { $set: { [campo]: { $round: [{ $add: [`$${campo}`, delta] }, 3] } } }];
  if (campo === 'reservado') cambio.push({ $set: { reservado: { $max: ['$reservado', 0] } } });
  const op = { new: true, upsert: !estricto, timestamps: false };
  try {
    return await Existencia.findOneAndUpdate(filtro, cambio, op).lean();
  } catch (e) {
    // Dos primeras ventas simultáneas del mismo producto: el segundo upsert choca
    if (e.code === 11000) return Existencia.findOneAndUpdate(filtro, cambio, op).lean();
    throw e;
  }
}

// Convierte las líneas de una venta en movimientos de stock (los combos
// descuentan sus componentes; las presentaciones multiplican por su factor).
async function desglosar(items) {
  const ids = [...new Set(items.map(i => String(i.producto)))];
  const prods = new Map((await Producto.find({ _id: { $in: ids } }).select('nombre tipo manejaInventario manejaVencimiento componentes').lean()).map(p => [String(p._id), p]));
  const total = new Map();
  const sumar = (id, q) => total.set(String(id), r3((total.get(String(id)) || 0) + q));
  for (const i of items) {
    const p = prods.get(String(i.producto));
    if (!p) continue;
    const q = r3(i.cantidad * (i.factor || 1));
    if (p.tipo === 'combo') (p.componentes || []).forEach(c => sumar(c.producto, r3(q * c.cantidad)));
    else if (p.manejaInventario) sumar(p._id, q);
  }
  const faltan = [...total.keys()].filter(k => !prods.has(k));
  if (faltan.length) (await Producto.find({ _id: { $in: faltan } }).select('nombre tipo manejaInventario manejaVencimiento').lean()).forEach(p => prods.set(String(p._id), p));
  return [...total].filter(([k]) => prods.get(k)?.manejaInventario).map(([k, cantidad]) => ({ producto: k, cantidad, nombre: prods.get(k).nombre, vencimiento: prods.get(k).manejaVencimiento }));
}

async function _consumirLotes(sede, producto, cantidad) {
  let falta = cantidad;
  const lotes = await Lote.find({ sede, producto, restante: { $gt: 0 } }).sort({ vence: 1 }).lean();
  for (const l of lotes) {
    if (falta <= 0) break;
    const q = Math.min(falta, l.restante);
    const r = await Lote.updateOne({ _id: l._id, restante: { $gte: q } }, [{ $set: { restante: { $round: [{ $subtract: ['$restante', q] }, 3] } } }]);
    if (r.modifiedCount) falta = r3(falta - q);
  }
}

// Mueve stock y deja kardex. `lineas`: [{ producto, cantidad (+entra/−sale), costo, vencimiento }]
// Si una falla (sin existencias) devuelve las anteriores: todo o nada.
async function mover({ empresa, sede, lineas, tipo, referencia, motivo, usuario, permitirNegativo = true }) {
  const hechas = [];
  try {
    for (const l of lineas) {
      const ex = await _sumar({ empresa, sede, producto: l.producto, delta: l.cantidad, estricto: l.cantidad < 0 && !permitirNegativo });
      if (!ex) throw new ErrorApi(`No hay existencias suficientes de ${l.nombre || 'un producto'}`, 409, 'SIN_STOCK');
      hechas.push({ ...l, saldo: ex.cantidad });
    }
  } catch (e) {
    for (const l of hechas) await _sumar({ empresa, sede, producto: l.producto, delta: -l.cantidad });
    throw e;
  }
  if (hechas.length) {
    await MovimientoInventario.insertMany(hechas.map(l => ({ empresa, sede, producto: l.producto, tipo, cantidad: l.cantidad, saldo: l.saldo, costo: l.costo, referencia, motivo, usuario })));
  }
  for (const l of hechas) if (l.cantidad < 0 && l.vencimiento) await _consumirLotes(sede, l.producto, -l.cantidad);
  return hechas;
}

// Reserva (domicilios): compromete stock sin sacarlo todavía
async function reservar({ empresa, sede, lineas, permitirNegativo = true }) {
  const hechas = [];
  for (const l of lineas) {
    const ex = await _sumar({ empresa, sede, producto: l.producto, delta: l.cantidad, campo: 'reservado', estricto: !permitirNegativo });
    if (!ex) {
      await liberar({ empresa, sede, lineas: hechas });
      throw new ErrorApi(`No hay existencias suficientes de ${l.nombre || 'un producto'}`, 409, 'SIN_STOCK');
    }
    hechas.push(l);
  }
}
async function liberar({ empresa, sede, lineas }) {
  for (const l of lineas) await _sumar({ empresa, sede, producto: l.producto, delta: -l.cantidad, campo: 'reservado' });
}

// Entrada por compra: además actualiza el costo promedio ponderado
async function costoPromedio({ empresa, producto, cantidad, costo }) {
  const ex = await Existencia.aggregate([{ $match: { empresa, producto } }, { $group: { _id: null, n: { $sum: '$cantidad' } } }]);
  const previo = Math.max(0, (ex[0]?.n || 0) - cantidad); // ya incluye la entrada
  await Producto.updateOne({ _id: producto, empresa }, [{ $set: {
    costo: { $round: [{ $divide: [{ $add: [{ $multiply: [previo, { $ifNull: ['$costo', 0] }] }, cantidad * costo] }, previo + cantidad] }, 4] },
  } }]);
}

module.exports = { mover, desglosar, reservar, liberar, costoPromedio };
