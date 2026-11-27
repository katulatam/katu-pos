const { DateTime } = require('luxon');
const Venta = require('../models/Venta');
const Pedido = require('../models/Pedido');
const Producto = require('../models/Producto');
const Existencia = require('../models/Existencia');
const Lote = require('../models/Lote');
const Cliente = require('../models/Cliente');
const Turno = require('../models/Turno');
const Devolucion = require('../models/Devolucion');
const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const InformeIA = require('../models/InformeIA');
const ia = require('./ia/openrouter');
const Motor = require('../../frontend/assets/js/motor');
const { ErrorApi, paisDe, rangoUtc } = require('./contexto');

// ── Informes con IA ────────────────────────────────────────────────────────
// 1. El sistema calcula los números exactos de cada informe (aquí, con Mongo).
// 2. La IA (OpenRouter) los interpreta: hallazgos, alertas y acciones concretas.
//    Nunca calcula cifras: solo usa las que recibe, ya formateadas.
// 3. Privacidad: a la IA no se le envían nombres, teléfonos ni documentos de
//    clientes; los cajeros van con alias (C1, C2…) y se reemplazan al volver.
const TIPOS = {
  resumen:      { titulo: 'Resumen del negocio', icono: 'fa-chart-line', enfoque: 'Cómo le fue al negocio: ventas frente al periodo anterior, ticket promedio, días y horas fuertes, medios de pago, productos y categorías que más venden, utilidad y margen, domicilios y clientes nuevos.' },
  inventario:   { titulo: 'Qué pedir y qué está quieto', icono: 'fa-boxes-stacked', enfoque: 'Productos que se van a agotar pronto según su ritmo de venta, productos agotados que sí se venden (ventas perdidas) y productos con existencias que no se venden (plata quieta en la bodega).' },
  rentabilidad: { titulo: 'Márgenes y precios', icono: 'fa-sack-dollar', enfoque: 'Productos que se venden con pérdida o con margen muy bajo, los que más utilidad dejan, el peso de los descuentos y los productos sin costo registrado (margen desconocido).' },
  vencimientos: { titulo: 'Productos por vencer', icono: 'fa-calendar-xmark', enfoque: 'Lotes que vencen pronto, cuánto dinero está en riesgo y cuáles probablemente no alcanzan a venderse a su ritmo actual. Propón promociones del día concretas para moverlos.' },
  clientes:     { titulo: 'Clientes', icono: 'fa-users', enfoque: 'Clientes nuevos y recurrentes, clientes frecuentes que dejaron de venir (en riesgo), cumpleaños del mes, cuántos aceptan promociones y qué campañas conviene enviar.' },
  equipo:       { titulo: 'Caja y equipo', icono: 'fa-cash-register', enfoque: 'Ventas y ticket por cajero, descuentos, anulaciones, devoluciones y diferencias en los arqueos de turno. Señala lo que conviene revisar sin acusar a nadie.' },
  pregunta:     { titulo: 'Pregúntale a tus datos', icono: 'fa-comments', enfoque: 'Responde la pregunta del dueño del negocio usando solo los datos.' },
};
const PERIODOS = { hoy: 'Hoy', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', mes: 'Este mes' };
const NO_ANULADA = { estado: { $ne: 'anulada' } };
const LIMITE_DIARIO = Number(process.env.INFORMES_IA_LIMITE_DIARIO) || 30;
const HORAS_CACHE = 3;

// Rango local del periodo y el periodo anterior de igual duración
function rango(empresa, periodo) {
  const hoy = DateTime.now().setZone(empresa.zonaHoraria).startOf('day');
  const dias = { hoy: 1, '7d': 7, '30d': 30 }[periodo];
  const desde = periodo === 'mes' ? hoy.startOf('month') : hoy.minus({ days: dias - 1 });
  const n = Math.round(hoy.diff(desde, 'days').days) + 1;
  const pDesde = desde.minus({ days: n }), pHasta = desde.minus({ days: 1 });
  return { desde: desde.toISODate(), hasta: hoy.toISODate(), dias: n, prevDesde: pDesde.toISODate(), prevHasta: pHasta.toISODate() };
}
const pct = (a, b) => (b > 0 ? Math.round((a - b) * 1000 / b) / 10 : null);
const r1 = n => Math.round(n * 10) / 10;

async function totales(empresa, desde, hasta) {
  const [x] = await Venta.aggregate([
    { $match: { empresa: empresa._id, ...NO_ANULADA, fecha: rangoUtc(empresa, desde, hasta) } },
    { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' }, base: { $sum: '$base' }, descuento: { $sum: '$descuento' }, costo: { $sum: { $sum: '$items.costo' } }, conCliente: { $sum: { $cond: [{ $ifNull: ['$cliente', false] }, 1, 0] } }, domicilio: { $sum: { $cond: [{ $eq: ['$origen', 'domicilio'] }, 1, 0] } } } },
  ]);
  return x || { n: 0, total: 0, base: 0, descuento: 0, costo: 0, conCliente: 0, domicilio: 0 };
}
const porProducto = (empresa, desde, hasta) => Venta.aggregate([
  { $match: { empresa: empresa._id, ...NO_ANULADA, fecha: rangoUtc(empresa, desde, hasta) } }, { $unwind: '$items' },
  { $group: { _id: '$items.producto', nombre: { $first: '$items.nombre' }, cantidad: { $sum: '$items.cantidad' }, total: { $sum: '$items.total' }, base: { $sum: '$items.base' }, costo: { $sum: '$items.costo' }, descuento: { $sum: '$items.descuento' } } },
  { $sort: { total: -1 } },
]);
async function existencias(empresa) {
  return new Map((await Existencia.aggregate([{ $match: { empresa: empresa._id } }, { $group: { _id: '$producto', n: { $sum: { $subtract: ['$cantidad', { $ifNull: ['$reservado', 0] }] } } } }])).map(e => [String(e._id), e.n]));
}

// ── Recolectores: devuelven { datos (para la IA), tablas (para el panel) } ──
const RECOLECTORES = {
  async resumen(e, r, $) {
    const tz = e.zonaHoraria, f = rangoUtc(e, r.desde, r.hasta);
    const [act, prev, dias, horas, medios, prods, cats, pedidos, nuevos] = await Promise.all([
      totales(e, r.desde, r.hasta), totales(e, r.prevDesde, r.prevHasta),
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f } }, { $group: { _id: { $dayOfWeek: { date: '$fecha', timezone: tz } }, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f } }, { $group: { _id: { $hour: { date: '$fecha', timezone: tz } }, total: { $sum: '$total' }, n: { $sum: 1 } } }, { $sort: { total: -1 } }]),
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f } }, { $unwind: '$pagos' }, { $group: { _id: '$pagos.nombre', total: { $sum: '$pagos.monto' } } }, { $sort: { total: -1 } }]),
      porProducto(e, r.desde, r.hasta),
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f } }, { $unwind: '$items' }, { $group: { _id: '$items.categoria', total: { $sum: '$items.total' } } }, { $sort: { total: -1 } }, { $limit: 8 }]),
      Pedido.aggregate([{ $match: { empresa: e._id, createdAt: f } }, { $group: { _id: '$estado', n: { $sum: 1 } } }]),
      Cliente.countDocuments({ empresa: e._id, createdAt: f }),
    ]);
    const nc = Object.fromEntries((await require('../models/Categoria').find({ _id: { $in: cats.map(c => c._id).filter(Boolean) } }).select('nombre').lean()).map(c => [String(c._id), c.nombre]));
    const DIA = ['', 'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const util = act.base - act.costo;
    const datos = {
      ventas: { numero: act.n, total_txt: $(act.total), periodo_anterior_txt: $(prev.total), variacion_pct: pct(act.total, prev.total), ticket_promedio_txt: act.n ? $(act.total / act.n) : $(0), ticket_anterior_txt: prev.n ? $(prev.total / prev.n) : $(0) },
      utilidad: { utilidad_txt: $(util), margen_pct: act.base > 0 ? r1(util * 100 / act.base) : null, descuentos_txt: $(act.descuento) },
      dias_semana: dias.sort((a, b) => b.total - a.total).map(d => ({ dia: DIA[d._id], total_txt: $(d.total), ventas: d.n })),
      horas_fuertes: horas.slice(0, 4).map(h => ({ hora: `${h._id}:00`, total_txt: $(h.total), ventas: h.n })),
      horas_flojas: horas.slice(-3).map(h => ({ hora: `${h._id}:00`, ventas: h.n })),
      medios_pago: medios.map(m => ({ medio: m._id, total_txt: $(m.total), participacion_pct: act.total ? r1(m.total * 100 / act.total) : 0 })),
      top_productos: prods.slice(0, 10).map(p => ({ producto: p.nombre, cantidad: r1(p.cantidad), total_txt: $(p.total) })),
      top_categorias: cats.map(c => ({ categoria: nc[c._id] || 'Sin categoría', total_txt: $(c.total) })),
      domicilios: { ventas_a_domicilio: act.domicilio, pedidos: Object.fromEntries(pedidos.map(p => [p._id, p.n])) },
      clientes: { nuevos: nuevos, ventas_con_cliente_pct: act.n ? r1(act.conCliente * 100 / act.n) : 0 },
    };
    return { datos, tablas: { productos: prods.slice(0, 15).map(p => ({ nombre: p.nombre, cantidad: r1(p.cantidad), total: p.total })) } };
  },

  async inventario(e, r, $) {
    const desde = DateTime.now().setZone(e.zonaHoraria).minus({ days: 29 }).toISODate(), hasta = DateTime.now().setZone(e.zonaHoraria).toISODate();
    const [vend, ex, prods] = await Promise.all([porProducto(e, desde, hasta), existencias(e), Producto.find({ empresa: e._id, activo: true, manejaInventario: true }).select('nombre costo minimo unidad').lean()]);
    const v = new Map(vend.map(x => [String(x._id), x]));
    const filas = prods.map(p => { const x = v.get(String(p._id)), ritmo = x ? x.cantidad / 30 : 0, disp = ex.get(String(p._id)) || 0; return { nombre: p.nombre, unidad: p.unidad, disponible: r1(disp), ritmo_dia: r1(ritmo), dias_cobertura: ritmo > 0 ? r1(Math.max(0, disp) / ritmo) : null, vendido_30d: r1(x?.cantidad || 0), valor: Math.max(0, disp) * (p.costo || 0), minimo: p.minimo || 0 }; });
    const porAgotar = filas.filter(x => x.ritmo_dia > 0 && x.disponible > 0 && x.dias_cobertura <= 5).sort((a, b) => a.dias_cobertura - b.dias_cobertura).slice(0, 15);
    const agotados = filas.filter(x => x.disponible <= 0 && x.vendido_30d > 0).sort((a, b) => b.ritmo_dia - a.ritmo_dia).slice(0, 15);
    const quietos = filas.filter(x => x.disponible > 0 && x.vendido_30d === 0).sort((a, b) => b.valor - a.valor).slice(0, 15);
    const sinMover = filas.filter(x => x.disponible > 0 && x.vendido_30d === 0).reduce((a, x) => a + x.valor, 0);
    const datos = {
      productos_con_inventario: filas.length,
      por_agotarse: porAgotar.map(x => ({ producto: x.nombre, disponible: `${x.disponible} ${x.unidad}`, vende_por_dia: x.ritmo_dia, alcanza_dias: x.dias_cobertura })),
      agotados_que_se_venden: agotados.map(x => ({ producto: x.nombre, vendia_por_dia: x.ritmo_dia })),
      quietos_sin_ventas_30d: quietos.map(x => ({ producto: x.nombre, disponible: `${x.disponible} ${x.unidad}`, plata_quieta_txt: $(x.valor) })),
      total_plata_quieta_txt: $(sinMover),
    };
    return { datos, tablas: { porAgotar, agotados, quietos: quietos.map(x => ({ ...x, valor: x.valor })) } };
  },

  async rentabilidad(e, r, $) {
    const [prods, act, sinCosto] = await Promise.all([porProducto(e, r.desde, r.hasta), totales(e, r.desde, r.hasta), Producto.countDocuments({ empresa: e._id, activo: true, tipo: { $ne: 'servicio' }, $or: [{ costo: 0 }, { costo: null }] })]);
    const conMargen = prods.filter(p => p.base > 0 && p.costo > 0).map(p => ({ nombre: p.nombre, ventas: p.total, utilidad: p.base - p.costo, margen: r1((p.base - p.costo) * 100 / p.base), cantidad: r1(p.cantidad) }));
    const perdida = conMargen.filter(p => p.margen < 0).sort((a, b) => a.utilidad - b.utilidad).slice(0, 10);
    const bajo = conMargen.filter(p => p.margen >= 0 && p.margen < 10).sort((a, b) => b.ventas - a.ventas).slice(0, 10);
    const mejores = [...conMargen].sort((a, b) => b.utilidad - a.utilidad).slice(0, 10);
    const util = act.base - act.costo;
    const datos = {
      general: { ventas_txt: $(act.total), utilidad_txt: $(util), margen_pct: act.base > 0 ? r1(util * 100 / act.base) : null, descuentos_txt: $(act.descuento), descuentos_sobre_ventas_pct: act.total ? r1(act.descuento * 100 / (act.total + act.descuento)) : 0 },
      con_perdida: perdida.map(p => ({ producto: p.nombre, margen_pct: p.margen, perdida_txt: $(-p.utilidad), unidades: p.cantidad })),
      margen_bajo_menor_10pct: bajo.map(p => ({ producto: p.nombre, margen_pct: p.margen, ventas_txt: $(p.ventas) })),
      mas_utilidad: mejores.map(p => ({ producto: p.nombre, utilidad_txt: $(p.utilidad), margen_pct: p.margen })),
      productos_sin_costo_registrado: sinCosto,
    };
    return { datos, tablas: { perdida, bajo, mejores } };
  },

  async vencimientos(e, r, $) {
    const hoy = DateTime.now().setZone(e.zonaHoraria).startOf('day');
    const lotes = await Lote.find({ empresa: e._id, restante: { $gt: 0 }, vence: { $lte: hoy.plus({ days: 20 }).toISODate() } }).sort({ vence: 1 }).limit(60).populate('producto', 'nombre costo precio unidad').lean();
    const vend = new Map((await porProducto(e, hoy.minus({ days: 29 }).toISODate(), hoy.toISODate())).map(x => [String(x._id), x.cantidad / 30]));
    const filas = lotes.filter(l => l.producto).map(l => {
      const dias = Math.round(DateTime.fromISO(l.vence, { zone: e.zonaHoraria }).diff(hoy, 'days').days), ritmo = vend.get(String(l.producto._id)) || 0;
      const alcanza = ritmo * Math.max(0, dias);
      return { nombre: l.producto.nombre, restante: r1(l.restante), unidad: l.producto.unidad, vence: l.vence, dias, valor: l.restante * (l.producto.costo || 0), precio: l.producto.precio, riesgo: dias < 0 ? 'vencido' : alcanza >= l.restante ? 'bajo' : alcanza >= l.restante / 2 ? 'medio' : 'alto', sobrante: r1(Math.max(0, l.restante - alcanza)) };
    });
    const datos = {
      lotes_por_vencer: filas.map(x => ({ producto: x.nombre, quedan: `${x.restante} ${x.unidad}`, vence_en_dias: x.dias, riesgo_de_no_venderse: x.riesgo, sobrarian_aprox: x.sobrante, precio_txt: $(x.precio), costo_en_riesgo_txt: $(x.valor) })),
      total_en_riesgo_txt: $(filas.filter(x => x.riesgo !== 'bajo').reduce((a, x) => a + x.valor, 0)),
      ya_vencidos: filas.filter(x => x.dias < 0).length,
    };
    return { datos, tablas: { lotes: filas } };
  },

  async clientes(e, r, $) {
    const f = rangoUtc(e, r.desde, r.hasta), hoy = new Date();
    const mes = DateTime.now().setZone(e.zonaHoraria).toFormat('MM');
    const [total, nuevos, compradores, riesgo, cumple, mkW, mkC, conPuntos] = await Promise.all([
      Cliente.countDocuments({ empresa: e._id, activo: true }),
      Cliente.countDocuments({ empresa: e._id, createdAt: f }),
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f, cliente: { $ne: null } } }, { $group: { _id: '$cliente', n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Cliente.find({ empresa: e._id, activo: true, compras: { $gte: 3 }, ultimaCompra: { $lt: new Date(hoy - 30 * 86400000), $gte: new Date(hoy - 120 * 86400000) } }).sort({ totalComprado: -1 }).limit(20).select('nombre telefono compras totalComprado ultimaCompra marketing').lean(),
      Cliente.countDocuments({ empresa: e._id, activo: true, cumple: { $regex: new RegExp(`^${mes}-`) } }),
      Cliente.countDocuments({ empresa: e._id, activo: true, 'marketing.whatsapp': true }),
      Cliente.countDocuments({ empresa: e._id, activo: true, 'marketing.correo': true }),
      Cliente.countDocuments({ empresa: e._id, activo: true, puntos: { $gt: 0 } }),
    ]);
    const recurrentes = compradores.filter(c => c.n > 1).length;
    const datos = {
      clientes_registrados: total, nuevos_en_el_periodo: nuevos, compradores_identificados: compradores.length, recurrentes_mas_de_una_compra: recurrentes,
      gasto_promedio_por_cliente_txt: compradores.length ? $(compradores.reduce((a, c) => a + c.total, 0) / compradores.length) : $(0),
      frecuentes_que_dejaron_de_venir: { cantidad: riesgo.length, aceptan_promociones_whatsapp: riesgo.filter(c => c.marketing?.whatsapp).length, gasto_historico_total_txt: $(riesgo.reduce((a, c) => a + (c.totalComprado || 0), 0)) },
      cumpleanos_este_mes: cumple, aceptan_promociones: { whatsapp: mkW, correo: mkC }, con_puntos_por_redimir: conPuntos,
    };
    // La lista con nombres solo va al panel, no a la IA
    return { datos, tablas: { enRiesgo: riesgo.map(c => ({ nombre: c.nombre, compras: c.compras, totalComprado: c.totalComprado, ultimaCompra: c.ultimaCompra, whatsapp: !!c.marketing?.whatsapp })) } };
  },

  async equipo(e, r, $) {
    const f = rangoUtc(e, r.desde, r.hasta);
    const [ventas, anuladas, devol, turnos] = await Promise.all([
      Venta.aggregate([{ $match: { empresa: e._id, ...NO_ANULADA, fecha: f, cajero: { $ne: null } } }, { $group: { _id: '$cajero', n: { $sum: 1 }, total: { $sum: '$total' }, descuento: { $sum: '$descuento' } } }]),
      Venta.aggregate([{ $match: { empresa: e._id, estado: 'anulada', fecha: f } }, { $group: { _id: '$cajero', n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Devolucion.aggregate([{ $match: { empresa: e._id, createdAt: f } }, { $lookup: { from: 'turnos', localField: 'turno', foreignField: '_id', as: 't' } }, { $group: { _id: { $first: '$t.cajero' }, n: { $sum: 1 }, monto: { $sum: '$monto' } } }]),
      Turno.find({ empresa: e._id, estado: 'cerrado', cerradoEn: f }).select('cajero diferenciaTotal').lean(),
    ]);
    const ids = [...new Set([...ventas, ...anuladas, ...devol].map(x => String(x._id)).concat(turnos.map(t => String(t.cajero))))].filter(x => x && x !== 'null');
    const nombres = Object.fromEntries((await Usuario.find({ _id: { $in: ids } }).select('nombre').lean()).map(u => [String(u._id), u.nombre]));
    const alias = Object.fromEntries(ids.map((id, i) => [id, `C${i + 1}`]));
    const fila = id => {
      const v = ventas.find(x => String(x._id) === id) || {}, a = anuladas.find(x => String(x._id) === id) || {}, d = devol.find(x => String(x._id) === id) || {};
      const ts = turnos.filter(t => String(t.cajero) === id), conDif = ts.filter(t => Math.abs(t.diferenciaTotal || 0) > 0);
      return { id, ventas: v.n || 0, total: v.total || 0, ticket: v.n ? v.total / v.n : 0, descuentos: v.descuento || 0, anuladas: a.n || 0, devoluciones: d.n || 0, turnos: ts.length, turnosConDiferencia: conDif.length, diferenciaNeta: conDif.reduce((s, t) => s + (t.diferenciaTotal || 0), 0) };
    };
    const filas = ids.map(fila).sort((a, b) => b.total - a.total);
    const datos = { cajeros: filas.map(x => ({ cajero: alias[x.id], ventas: x.ventas, total_txt: $(x.total), ticket_promedio_txt: $(x.ticket), descuentos_txt: $(x.descuentos), anulaciones: x.anuladas, devoluciones: x.devoluciones, turnos_cerrados: x.turnos, turnos_con_diferencia: x.turnosConDiferencia, diferencia_neta_txt: $(x.diferenciaNeta) })) };
    return { datos, tablas: { cajeros: filas.map(x => ({ ...x, nombre: nombres[x.id] || 'Usuario', alias: alias[x.id] })) }, alias: Object.fromEntries(Object.entries(alias).map(([id, a]) => [a, nombres[id] || a])) };
  },
};

const SISTEMA = (e, pais) => `Eres el analista de negocio de Katú POS. Ayudas al dueño de "${e.nombre}", una tienda o minimercado en ${pais.nombre}. Recibes DATOS en JSON calculados por el sistema: son exactos.
Responde SOLO un objeto JSON con esta forma:
{"titular":"una frase con lo más importante","resumen":"2 a 4 frases","hallazgos":[{"titulo":"…","detalle":"…","tipo":"positivo|alerta|info"}],"acciones":[{"titulo":"…","detalle":"…","prioridad":"alta|media|baja"}]}
Reglas:
- Usa únicamente los números y productos que aparecen en DATOS. No inventes cifras, porcentajes ni productos. Si falta un dato, no lo supongas.
- Los montos ya vienen formateados en los campos que terminan en _txt: cópialos tal cual.
- Máximo 5 hallazgos y 4 acciones, ordenados por importancia. Frases cortas y claras para un tendero, sin jerga.
- Las acciones deben poder hacerse en Katú POS: crear una promoción del día, ajustar un precio, pedir mercancía al proveedor, enviar una campaña a un segmento de clientes, revisar un turno, registrar costos.
- Si casi no hay datos (negocio nuevo o periodo sin ventas), dilo con amabilidad y sugiere qué registrar para tener mejores informes.
- Escribe en español neutro. No menciones que eres una IA ni hables de JSON.`;

function parsear(texto) {
  const s = String(texto || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  let o = null;
  try { o = JSON.parse(i >= 0 && j > i ? s.slice(i, j + 1) : s); } catch { o = null; }
  const corto = (x, n) => String(x || '').trim().slice(0, n);
  if (!o || typeof o !== 'object') return { titular: 'Informe', resumen: corto(s, 1500), hallazgos: [], acciones: [] };
  return {
    titular: corto(o.titular, 200), resumen: corto(o.resumen, 1500),
    hallazgos: (Array.isArray(o.hallazgos) ? o.hallazgos : []).slice(0, 6).map(h => ({ titulo: corto(h.titulo, 150), detalle: corto(h.detalle, 600), tipo: ['positivo', 'alerta', 'info'].includes(h.tipo) ? h.tipo : 'info' })),
    acciones: (Array.isArray(o.acciones) ? o.acciones : []).slice(0, 5).map(a => ({ titulo: corto(a.titulo, 150), detalle: corto(a.detalle, 600), prioridad: ['alta', 'media', 'baja'].includes(a.prioridad) ? a.prioridad : 'media' })),
  };
}
// Alias de cajeros (C1…) → nombre real, en todo el texto del análisis
function quitarAlias(a, alias) {
  if (!alias) return a;
  const cambiar = t => String(t || '').replace(/\bC(\d{1,3})\b/g, (m) => alias[m] || m);
  return { titular: cambiar(a.titular), resumen: cambiar(a.resumen), hallazgos: a.hallazgos.map(h => ({ ...h, titulo: cambiar(h.titulo), detalle: cambiar(h.detalle) })), acciones: a.acciones.map(x => ({ ...x, titulo: cambiar(x.titulo), detalle: cambiar(x.detalle) })) };
}

async function generar(empresaId, { tipo, periodo = '7d', pregunta, regenerar = false, usuario, origen = 'panel' }) {
  if (!TIPOS[tipo]) throw new ErrorApi('Tipo de informe no válido');
  if (!PERIODOS[periodo]) periodo = '7d';
  if (!ia.disponible()) throw new ErrorApi('Los informes con IA no están disponibles: falta configurar la IA en el servidor', 503);
  const e = await Empresa.findById(empresaId).lean();
  if (tipo === 'pregunta') {
    pregunta = String(pregunta || '').trim().slice(0, 300);
    if (pregunta.length < 8) throw new ErrorApi('Escribe tu pregunta (por ejemplo: ¿qué productos debería poner en promoción esta semana?)');
  }
  // Caché: mismo informe en las últimas horas
  if (!regenerar && tipo !== 'pregunta') {
    const ya = await InformeIA.findOne({ empresa: e._id, tipo, periodo, createdAt: { $gte: new Date(Date.now() - HORAS_CACHE * 3600000) } }).sort({ createdAt: -1 }).lean();
    if (ya) return { ...ya, cache: true };
  }
  if (origen === 'panel' && await InformeIA.countDocuments({ empresa: e._id, origen: 'panel', createdAt: { $gte: new Date(Date.now() - 86400000) } }) >= LIMITE_DIARIO) {
    throw new ErrorApi(`Llegaste al máximo de ${LIMITE_DIARIO} informes con IA por día. Mañana puedes generar más.`, 429);
  }
  const pais = await paisDe(e);
  const $ = n => Motor.dinero(Number(n) || 0, pais);
  const r = rango(e, periodo);
  let datos, tablas = {}, alias = null;
  if (tipo === 'pregunta') {
    const [a, b, c] = await Promise.all([RECOLECTORES.resumen(e, r, $), RECOLECTORES.inventario(e, r, $), RECOLECTORES.rentabilidad(e, r, $)]);
    datos = { resumen: a.datos, inventario: b.datos, rentabilidad: c.datos };
  } else ({ datos, tablas, alias } = await RECOLECTORES[tipo](e, r, $));
  const usuarioMsg = `Informe: ${TIPOS[tipo].titulo}. Enfoque: ${TIPOS[tipo].enfoque}\nPeriodo: ${PERIODOS[periodo]} (${r.desde} a ${r.hasta}).${tipo === 'pregunta' ? `\nPREGUNTA DEL DUEÑO: ${pregunta}` : ''}\nDATOS: ${JSON.stringify(datos)}`;
  const resp = await ia.chat({ messages: [{ role: 'system', content: SISTEMA(e, pais) }, { role: 'user', content: usuarioMsg }], temperatura: 0.3, maxTokens: 1400 }).catch(x => { throw new ErrorApi(`No pudimos generar el informe ahora: ${x.message}`, 502); });
  const analisis = quitarAlias(parsear(resp.content), alias);
  const doc = await InformeIA.create({ empresa: e._id, tipo, periodo, desde: r.desde, hasta: r.hasta, pregunta, datos, tablas, analisis, modelo: ia.config().modelo, uso: resp.uso, origen, creadoPor: usuario });
  return doc.toObject();
}

// ── Informe semanal por correo (lunes 7 a. m. hora del negocio) ────────────
async function semanal(ahora = new Date()) {
  if (!ia.disponible()) return 0;
  const correo = require('./correo/sendgrid');
  const empresas = await Empresa.find({ estado: true, 'informes.semanal': { $ne: false } }).select('nombre slug zonaHoraria informes suscripcion').lean();
  let enviados = 0;
  for (const e of empresas) {
    const local = DateTime.fromJSDate(ahora).setZone(e.zonaHoraria);
    if (local.weekday !== 1 || local.hour !== 7) continue;
    if (require('./prueba').pruebaVencida(e)) continue;
    const inicio = local.startOf('day').toJSDate();
    const marcada = await Empresa.updateOne({ _id: e._id, $or: [{ 'informes.ultimoSemanal': { $exists: false } }, { 'informes.ultimoSemanal': { $lt: inicio } }] }, { 'informes.ultimoSemanal': ahora });
    if (!marcada.modifiedCount) continue; // otro contenedor ya lo tomó
    try {
      const inf = await generar(e._id, { tipo: 'resumen', periodo: '7d', origen: 'semanal', regenerar: true });
      const admins = await Usuario.find({ empresa: e._id, rol: 'admin', estado: true }).select('nombre correo').lean();
      const url = `${require('./empresas').urlEmpresa(e.slug)}/admin/informes-ia.html?id=${inf._id}`;
      const a = inf.analisis, esc = s => String(s || '').replace(/[<>&]/g, x => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[x]));
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#0B1729;line-height:1.55"><div style="background:linear-gradient(120deg,#05C3DD,#7C6CFF);color:#fff;padding:22px;border-radius:14px 14px 0 0"><div style="font-size:13px;opacity:.9">Tu semana en ${esc(e.nombre)}</div><div style="font-size:21px;font-weight:bold;margin-top:4px">${esc(a.titular)}</div></div><div style="background:#fff;border:1px solid #E3E9F2;border-top:0;padding:22px;border-radius:0 0 14px 14px"><p>${esc(a.resumen)}</p>${a.hallazgos.map(h => `<p style="margin:0 0 10px"><b>${h.tipo === 'alerta' ? '⚠️' : h.tipo === 'positivo' ? '✅' : '•'} ${esc(h.titulo)}</b><br>${esc(h.detalle)}</p>`).join('')}<p style="margin:16px 0 6px;font-weight:bold">Qué te recomendamos esta semana</p>${a.acciones.map(x => `<p style="margin:0 0 8px">→ <b>${esc(x.titulo)}</b>: ${esc(x.detalle)}</p>`).join('')}<p style="margin:20px 0 0"><a href="${url}" style="background:#0391A6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">Ver el informe completo</a></p><p style="font-size:12px;color:#7E8FA9;margin-top:18px">Puedes desactivar este correo en Informes con IA.</p></div></div>`;
      for (const u of admins) await correo.enviar({ a: u.correo, asunto: `Tu semana en ${e.nombre}: ${a.titular}`.slice(0, 150), html, texto: `${a.titular}\n\n${a.resumen}\n\nVer el informe: ${url}`, nombreRemitente: 'Katú POS' }).catch(x => console.error('[informes.semanal.correo]', x.message));
      enviados++;
    } catch (x) { console.error('[informes.semanal]', e.slug, x.message); }
  }
  return enviados;
}

module.exports = { TIPOS, PERIODOS, LIMITE_DIARIO, rango, generar, semanal, parsear, quitarAlias, RECOLECTORES };
