const crypto = require('crypto');
const { DateTime } = require('luxon');
const Cliente = require('../models/Cliente');
const Venta = require('../models/Venta');
const Mision = require('../models/Mision');
const ProgresoMision = require('../models/ProgresoMision');
const MovimientoPuntos = require('../models/MovimientoPuntos');
const { ErrorApi } = require('./contexto');

const nivelDe = (empresa, xp) => {
  const niveles = [...(empresa.gamificacion?.niveles || [])].sort((a, b) => a.desde - b.desde);
  let i = 0;
  niveles.forEach((n, k) => { if (xp >= n.desde) i = k; });
  const actual = niveles[i] || { nombre: '', desde: 0, multiplicador: 1, color: '#94A3B8' };
  const siguiente = niveles[i + 1] || null;
  const avance = siguiente ? Math.min(100, Math.round((xp - actual.desde) * 100 / (siguiente.desde - actual.desde))) : 100;
  return { actual, siguiente, avance, faltan: siguiente ? siguiente.desde - xp : 0 };
};

const cicloDe = (ciclo, zona, fecha) => {
  const d = DateTime.fromJSDate(fecha || new Date()).setZone(zona);
  if (ciclo === 'semana') return `${d.weekYear}-S${String(d.weekNumber).padStart(2, '0')}`;
  if (ciclo === 'mes') return d.toFormat('yyyy-MM');
  return 'unica';
};

const INSIGNIAS = [
  { codigo: 'primera', nombre: 'Primer Despegue', icono: 'fa-rocket', cumple: c => c.compras >= 1 },
  { codigo: 'compras10', nombre: 'Cliente en Órbita', icono: 'fa-satellite', cumple: c => c.compras >= 10 },
  { codigo: 'compras50', nombre: 'Leyenda del Barrio', icono: 'fa-crown', cumple: c => c.compras >= 50 },
  { codigo: 'racha4', nombre: 'Racha de 4 Semanas', icono: 'fa-fire', cumple: c => c.racha?.mejor >= 4 },
  { codigo: 'racha12', nombre: 'Imparable', icono: 'fa-fire-flame-curved', cumple: c => c.racha?.mejor >= 12 },
];

async function sumarPuntos({ empresa, cliente, puntos, tipo, detalle, venta, xp = 0 }) {
  if (!puntos && !xp) return;
  await Cliente.updateOne({ _id: cliente, empresa }, { $inc: { puntos, xp } });
  if (puntos) await MovimientoPuntos.create({ empresa, cliente, tipo, puntos, detalle, venta });
}

// Puntos, racha, misiones, insignias y giro de ruleta. Idempotente: reclama la
// venta (puntosAplicados) antes de aplicar.
async function aplicarVenta(empresa, ventaId) {
  if (!empresa.modulos?.gamificacion) return null;
  const venta = await Venta.findOneAndUpdate({ _id: ventaId, cliente: { $ne: null }, puntosAplicados: false }, { puntosAplicados: true }, { new: true }).lean();
  if (!venta) return null;
  const g = empresa.gamificacion || {};
  const cliente = await Cliente.findOne({ _id: venta.cliente, empresa: empresa._id }).lean();
  if (!cliente) return null;

  const valor = venta.total - (venta.domicilio || 0);
  const base = g.montoPorPunto > 0 ? Math.floor(valor / g.montoPorPunto) : 0;
  const antes = nivelDe(empresa, cliente.xp);
  const ganados = Math.floor(base * (antes.actual.multiplicador || 1));

  // Racha semanal
  const sem = cicloDe('semana', empresa.zonaHoraria, venta.fecha);
  const anterior = cicloDe('semana', empresa.zonaHoraria, new Date(new Date(venta.fecha).getTime() - 7 * 86400000));
  const racha = { ...(cliente.racha || { semanas: 0, mejor: 0, ultimaSemana: '' }) };
  if (racha.ultimaSemana !== sem) {
    racha.semanas = racha.ultimaSemana === anterior ? racha.semanas + 1 : 1;
    racha.ultimaSemana = sem;
    racha.mejor = Math.max(racha.mejor || 0, racha.semanas);
  }

  const giro = !!(g.ruleta?.activa && valor >= (g.ruleta.compraMinima || 0) && (g.ruleta.premios || []).length);
  await Venta.updateOne({ _id: venta._id }, { puntosGanados: ganados, 'giro.disponible': giro });
  const nuevo = await Cliente.findOneAndUpdate({ _id: cliente._id }, {
    $inc: { puntos: ganados, xp: base, compras: 1, totalComprado: venta.total },
    $set: { racha, ultimaCompra: venta.fecha },
  }, { new: true }).lean();
  if (ganados) await MovimientoPuntos.create({ empresa: empresa._id, cliente: cliente._id, tipo: 'compra', puntos: ganados, detalle: `Compra ${venta.numero}`, venta: venta._id });

  // Insignias
  const tiene = new Set((cliente.insignias || []).map(i => i.codigo));
  const insignias = INSIGNIAS.filter(i => !tiene.has(i.codigo) && i.cumple(nuevo)).map(({ codigo, nombre, icono }) => ({ codigo, nombre, icono, en: new Date() }));
  if (insignias.length) await Cliente.updateOne({ _id: cliente._id }, { $push: { insignias: { $each: insignias } } });

  // Misiones
  const hoy = DateTime.fromJSDate(venta.fecha).setZone(empresa.zonaHoraria).toISODate();
  const misiones = await Mision.find({ empresa: empresa._id, activo: true }).lean();
  const completadas = [];
  for (const m of misiones) {
    if ((m.desde && hoy < m.desde) || (m.hasta && hoy > m.hasta)) continue;
    let suma = 0;
    if (m.tipo === 'compras') suma = 1;
    else if (m.tipo === 'monto') suma = valor;
    else if (m.tipo === 'domicilios') suma = venta.origen === 'domicilio' ? 1 : 0;
    else if (m.tipo === 'producto') suma = venta.items.filter(i => String(i.producto) === String(m.objetivo)).reduce((a, i) => a + i.cantidad * (i.factor || 1), 0);
    else if (m.tipo === 'categoria') suma = venta.items.filter(i => String(i.categoria) === String(m.objetivo)).reduce((a, i) => a + i.cantidad * (i.factor || 1), 0);
    if (!suma) continue;
    const clave = { cliente: cliente._id, mision: m._id, ciclo: cicloDe(m.ciclo, empresa.zonaHoraria, venta.fecha) };
    const p = await ProgresoMision.findOneAndUpdate(clave, { $inc: { avance: suma }, $setOnInsert: { empresa: empresa._id } }, { upsert: true, new: true }).lean();
    if (p.avance >= m.meta && !p.completada) {
      const r = await ProgresoMision.updateOne({ _id: p._id, completada: false }, { completada: true, completadaEn: new Date() });
      if (r.modifiedCount) {
        await sumarPuntos({ empresa: empresa._id, cliente: cliente._id, puntos: m.premioPuntos, tipo: 'mision', detalle: `Misión: ${m.nombre}`, venta: venta._id });
        completadas.push({ nombre: m.nombre, puntos: m.premioPuntos, icono: m.icono });
      }
    }
  }
  const despues = nivelDe(empresa, nuevo.xp);
  return { ganados, giro, insignias, misiones: completadas, racha: racha.semanas, nivel: despues, subioNivel: despues.actual.nombre !== antes.actual.nombre };
}

// Estado completo para la caja, la app y la tienda
async function estadoCliente(empresa, cliente) {
  const misiones = await Mision.find({ empresa: empresa._id, activo: true }).lean();
  const ciclos = [...new Set(misiones.map(m => cicloDe(m.ciclo, empresa.zonaHoraria)))];
  const prog = await ProgresoMision.find({ cliente: cliente._id, ciclo: { $in: ciclos } }).lean();
  const de = m => prog.find(p => String(p.mision) === String(m._id) && p.ciclo === cicloDe(m.ciclo, empresa.zonaHoraria));
  return {
    puntos: cliente.puntos, xp: cliente.xp, racha: cliente.racha, insignias: cliente.insignias || [], compras: cliente.compras,
    nivel: nivelDe(empresa, cliente.xp),
    valorPuntos: cliente.puntos * (empresa.gamificacion?.valorPunto || 0),
    misiones: misiones.map(m => { const p = de(m); return { _id: m._id, nombre: m.nombre, descripcion: m.descripcion, icono: m.icono, tipo: m.tipo, meta: m.meta, ciclo: m.ciclo, premioPuntos: m.premioPuntos, avance: Math.min(m.meta, p?.avance || 0), completada: !!p?.completada }; }),
  };
}

// Giro de la ruleta: uno por venta, sorteado en el servidor
async function girar(empresa, filtroVenta) {
  const venta = await Venta.findOneAndUpdate({ ...filtroVenta, empresa: empresa._id, 'giro.disponible': true }, { 'giro.disponible': false }, { new: true }).lean();
  if (!venta) throw new ErrorApi('Esta compra no tiene giros disponibles', 409);
  const premios = empresa.gamificacion.ruleta.premios;
  const suma = premios.reduce((a, p) => a + Math.max(0, p.peso), 0);
  let n = suma > 0 ? crypto.randomInt(0, Math.round(suma * 1000)) / 1000 : 0;
  let i = 0;
  for (; i < premios.length - 1; i++) { n -= Math.max(0, premios[i].peso); if (n < 0) break; }
  const premio = premios[i];
  const puntos = premio.tipo === 'puntos' ? premio.valor : 0;
  await Venta.updateOne({ _id: venta._id }, { 'giro.premio': premio.nombre, 'giro.puntos': puntos, 'giro.en': new Date() });
  if (puntos) await sumarPuntos({ empresa: empresa._id, cliente: venta.cliente, puntos, tipo: 'ruleta', detalle: `Ruleta: ${premio.nombre}`, venta: venta._id });
  return { indice: i, premio: premio.nombre, puntos };
}

module.exports = { nivelDe, cicloDe, aplicarVenta, estadoCliente, girar, sumarPuntos };
