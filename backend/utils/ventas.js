const Venta = require('../models/Venta');
const Devolucion = require('../models/Devolucion');
const Producto = require('../models/Producto');
const Promocion = require('../models/Promocion');
const Cliente = require('../models/Cliente');
const Cobro = require('../models/Cobro');
const Recompensa = require('../models/Recompensa');
const MovimientoCartera = require('../models/MovimientoCartera');
const MovimientoPuntos = require('../models/MovimientoPuntos');
const Contador = require('../models/Contador');
const inventario = require('./inventario');
const gamificacion = require('./gamificacion');
const facturacion = require('./facturacion');
const { leerAutorizacion } = require('../middleware/auth');
const { ErrorApi, ahoraDe, impuestoDe, mediosDe } = require('./contexto');
const Motor = require('../../frontend/assets/js/motor');

const { r3 } = Motor;
const esId = v => /^[a-f\d]{24}$/i.test(String(v || ''));

// Arma las líneas de la venta con los precios del SERVIDOR. `congelado` (venta
// hecha sin internet, o pedido ya cotizado) respeta precio y descuento con que
// se le cobró al cliente; si difieren del vigente se marca diferenciaPrecio.
async function armarLineas({ empresa, pais, items, congelado }) {
  if (!Array.isArray(items) || !items.length) throw new ErrorApi('La venta no tiene productos');
  if (items.length > 300) throw new ErrorApi('La venta tiene demasiadas líneas');
  const ids = items.map(i => i.producto);
  if (!ids.every(esId)) throw new ErrorApi('Hay productos inválidos en la venta');
  const prods = new Map((await Producto.find({ _id: { $in: ids }, empresa: empresa._id }).lean()).map(p => [String(p._id), p]));
  let diferenciaPrecio = false;
  const lineas = items.map(i => {
    const p = prods.get(String(i.producto));
    if (!p || (!p.activo && !congelado)) throw new ErrorApi(`Producto no disponible${p ? ': ' + p.nombre : ''}`, 409);
    const porPeso = p.tipo === 'peso';
    const cantidad = r3(i.cantidad);
    if (!(cantidad > 0) || cantidad > 100000) throw new ErrorApi(`Cantidad inválida en ${p.nombre}`);
    if (!porPeso && p.unidad === 'und' && !Number.isInteger(cantidad)) throw new ErrorApi(`${p.nombre} se vende por unidades enteras`);
    const pres = i.presentacion ? (p.presentaciones || []).find(x => String(x._id) === String(i.presentacion)) : null;
    if (i.presentacion && !pres && !congelado) throw new ErrorApi(`Presentación no disponible de ${p.nombre}`, 409);
    const vigente = pres ? pres.precio : p.precio;
    let precioUnitario = vigente;
    if (congelado && Number.isFinite(Number(i.precioUnitario)) && Number(i.precioUnitario) >= 0) {
      precioUnitario = Motor.redondear(i.precioUnitario, pais.decimales);
      if (!Motor.igual(precioUnitario, vigente, pais.decimales)) diferenciaPrecio = true;
    }
    // Etiqueta de báscula con precio impreso: se cobra exactamente ese valor
    let brutoFijo;
    if (porPeso && i.brutoFijo != null) {
      const f = Motor.redondear(i.brutoFijo, pais.decimales);
      if (Math.abs(f - precioUnitario * cantidad) > precioUnitario * 0.001 + 1) throw new ErrorApi(`La etiqueta de ${p.nombre} no coincide con su precio actual`, 409);
      brutoFijo = f;
    }
    return {
      producto: p._id, categoria: p.categoria, nombre: p.nombre + (pres ? ` · ${pres.nombre}` : ''), codigo: pres?.codigo || p.codigo || p.plu || '',
      unidad: p.unidad, porPeso, cantidad, precioUnitario, brutoFijo,
      factor: pres?.factor || 1, presentacion: pres ? String(pres._id) : undefined,
      costo: Motor.redondear((p.costo || 0) * cantidad * (pres?.factor || 1), 4),
      ...impuestoDe(pais, p.impuesto),
      descuentoManual: Math.max(0, Number(congelado ? i.descuento : i.descuentoManual) || 0),
    };
  });
  return { lineas, diferenciaPrecio };
}

async function promosVigentes(empresa) {
  return Promocion.find({ empresa: empresa._id, activo: true }).lean();
}

// Crea la venta. Sin transacciones (la BD no es replica set): cada paso es
// atómico y deja su reverso en `deshacer`, que se ejecuta si algo falla.
async function crear({ empresa, pais, sede, caja, turno, cajero, body, origen = 'caja', pedido = null }) {
  const uuid = String(body.uuid || '').trim();
  if (!/^[\w-]{16,64}$/.test(uuid)) throw new ErrorApi('Falta el identificador de la venta');
  const previa = await Venta.findOne({ empresa: empresa._id, uuid }).lean();
  if (previa) return { venta: previa, repetida: true };

  const dec = pais.decimales;
  // Autopago: nadie revisa la venta, así que solo pagos confirmados por un equipo,
  // sin descuentos manuales, sin puntos y nunca sin conexión
  if (origen === 'kiosco') {
    if (body.offline) throw new ErrorApi('El autopago necesita conexión');
    if (Number(body.descuentoGlobal) > 0 || (body.items || []).some(i => Number(i.descuentoManual) > 0)) throw new ErrorApi('El autopago no admite descuentos manuales');
    if (Number(body.puntosRedimir) > 0 || body.recompensa) throw new ErrorApi('Los puntos se redimen en una caja atendida');
    if (!(body.pagos || []).length || (body.pagos || []).some(p => !esId(p.cobro))) throw new ErrorApi('En autopago cada pago debe estar confirmado por el equipo de cobro', 400, 'PAGO_NO_CONFIRMADO');
  }
  const offline = !!body.offline && !pedido;
  const congelado = offline || !!pedido;
  const { lineas, diferenciaPrecio } = await armarLineas({ empresa, pais, items: body.items, congelado });

  const cliente = body.cliente ? await Cliente.findOne({ _id: body.cliente, empresa: empresa._id }).lean() : null;
  if (body.cliente && !cliente) throw new ErrorApi('El cliente no existe', 404);

  // Puntos y recompensas
  const g = empresa.gamificacion || {};
  let puntosRedimidos = 0, descuentoPuntos = 0;
  const usaPuntos = Number(body.puntosRedimir) > 0 || body.recompensa;
  if (usaPuntos) {
    if (!empresa.modulos?.gamificacion || !cliente || congelado) throw new ErrorApi('No es posible redimir puntos en esta venta');
    if (body.recompensa) {
      const r = await Recompensa.findOne({ _id: body.recompensa, empresa: empresa._id, activo: true }).lean();
      if (!r) throw new ErrorApi('La recompensa no está disponible', 404);
      if (r.nivelMinimo) {
        const orden = [...(g.niveles || [])].sort((a, b) => a.desde - b.desde).map(n => n.nombre);
        if (orden.indexOf(gamificacion.nivelDe(empresa, cliente.xp).actual.nombre) < orden.indexOf(r.nivelMinimo)) throw new ErrorApi(`La recompensa exige nivel ${r.nivelMinimo}`);
      }
      puntosRedimidos += r.puntos; descuentoPuntos += r.descuento;
    }
    const n = Math.floor(Number(body.puntosRedimir) || 0);
    if (n > 0) {
      if (n < (g.minimoRedimir || 0)) throw new ErrorApi(`El mínimo a redimir es ${g.minimoRedimir} puntos`);
      puntosRedimidos += n; descuentoPuntos += n * (g.valorPunto || 0);
    }
  }

  const ahora = ahoraDe(empresa, sede, offline && body.fecha ? new Date(body.fecha) : undefined);
  const calculo = Motor.calcular(lineas, {
    decimales: dec, ahora,
    promociones: congelado ? [] : await promosVigentes(empresa),
    descuentoGlobal: congelado ? 0 : body.descuentoGlobal,
    descuentoPuntos, domicilio: pedido ? pedido.domicilio : 0,
  });
  if (Number(body.puntosRedimir) > 0) {
    const bruto = calculo.subtotal;
    if (Math.floor(Number(body.puntosRedimir)) * (g.valorPunto || 0) > bruto * (g.maxPctRedimir ?? 100) / 100 + 0.001) throw new ErrorApi(`Con puntos se puede pagar hasta el ${g.maxPctRedimir}% de la compra`);
  }

  // Descuento manual por encima del tope del cajero → PIN de supervisor
  let autorizadoPor;
  if (!congelado) {
    const manual = calculo.lineas.reduce((a, l) => a + l.descuentoManual, 0) + Math.max(0, Number(body.descuentoGlobal) || 0);
    const pct = calculo.subtotal > 0 ? manual * 100 / calculo.subtotal : 0;
    if (cajero && cajero.rol === 'cajero' && pct > (empresa.pos?.descuentoMaxCajero ?? 0) + 0.001) {
      autorizadoPor = leerAutorizacion(body.autorizacion, empresa._id);
      if (!autorizadoPor) throw new ErrorApi(`El descuento supera el ${empresa.pos?.descuentoMaxCajero ?? 0}%: requiere autorización de un supervisor`, 403, 'REQUIERE_AUTORIZACION');
    }
  }

  // Pagos
  const medios = new Map(mediosDe(empresa, pais).map(m => [m.codigo, m]));
  const canal = origen === 'domicilio' ? 'domicilio' : origen;
  let pagos = (Array.isArray(body.pagos) ? body.pagos : []).map(p => {
    const m = medios.get(p.medio);
    if (!m || (!congelado && (!m.activo || !m.canales.includes(canal)))) throw new ErrorApi(`El medio de pago ${p.medio || ''} no está activo`);
    return { medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: Motor.redondear(p.monto, dec), recibido: p.recibido != null ? Motor.redondear(p.recibido, dec) : undefined, referencia: String(p.referencia || '').slice(0, 60), cobro: p.cobro };
  }).filter(p => p.monto > 0);
  const soloEfectivo = pagos.length > 0 && pagos.every(p => p.tipo === 'efectivo');
  const aPagar = soloEfectivo && empresa.pos?.redondearEfectivo && !pedido ? Motor.redondearEfectivo(calculo.total, pais.redondeoEfectivo, dec) : calculo.total;
  const redondeo = Motor.redondear(aPagar - calculo.total, dec);
  if (!Motor.igual(Motor.sumar(pagos.map(p => p.monto), dec), aPagar, dec)) {
    throw new ErrorApi(`Los pagos no cuadran: el total es ${Motor.dinero(aPagar, pais)}`, 409, 'TOTAL_CAMBIO');
  }
  for (const p of pagos) {
    if (p.tipo === 'efectivo' && !p.cobro) {
      p.recibido = p.recibido ?? p.monto;
      if (p.recibido < p.monto) throw new ErrorApi('El efectivo recibido es menor al valor a pagar');
      p.cambio = Motor.redondear(p.recibido - p.monto, dec);
    }
    if (p.tipo === 'qr' && !esId(p.cobro)) throw new ErrorApi('El pago con QR no está confirmado');
    if (offline && (p.tipo === 'qr' || p.tipo === 'fiado')) throw new ErrorApi('Ese medio de pago no está disponible sin conexión');
    if (p.tipo === 'fiado' && (!cliente || !empresa.modulos?.fiado)) throw new ErrorApi('Para fiar hay que elegir un cliente');
  }

  const deshacer = [];
  try {
    // Cobros confirmados (QR, terminal, kiosco): se amarran a esta venta
    for (const p of pagos.filter(x => x.cobro)) {
      const c = await Cobro.findOneAndUpdate(
        { _id: p.cobro, empresa: empresa._id, estado: 'aprobado', monto: p.monto, medio: p.medio, ventaUuid: null },
        { ventaUuid: uuid }, { new: true }).lean();
      if (!c) throw new ErrorApi('El cobro no está aprobado, no coincide con el valor o ya se usó en otra venta', 409);
      deshacer.push(() => Cobro.updateOne({ _id: c._id, ventaUuid: uuid }, { ventaUuid: null }));
      p.referencia = p.referencia || c.autorizacion || c.referencia;
      if (p.tipo === 'efectivo') { p.recibido = c.recibido; p.cambio = c.cambio; }
    }
    if (puntosRedimidos > 0) {
      const r = await Cliente.updateOne({ _id: cliente._id, puntos: { $gte: puntosRedimidos } }, { $inc: { puntos: -puntosRedimidos } });
      if (!r.modifiedCount) throw new ErrorApi('El cliente no tiene puntos suficientes', 409);
      deshacer.push(() => Cliente.updateOne({ _id: cliente._id }, { $inc: { puntos: puntosRedimidos } }));
    }
    const fiado = Motor.sumar(pagos.filter(p => p.tipo === 'fiado').map(p => p.monto), dec);
    let deudaNueva;
    if (fiado > 0) {
      const c = await Cliente.findOneAndUpdate({ _id: cliente._id, $expr: { $lte: [{ $add: ['$deuda', fiado] }, '$cupo'] } }, { $inc: { deuda: fiado } }, { new: true }).lean();
      if (!c) throw new ErrorApi(`Cupo de fiado insuficiente (disponible ${Motor.dinero(Math.max(0, cliente.cupo - cliente.deuda), pais)})`, 409);
      deudaNueva = c.deuda;
      deshacer.push(() => Cliente.updateOne({ _id: cliente._id }, { $inc: { deuda: -fiado } }));
    }

    // Inventario
    const numero = `V-${String(await Contador.siguiente(empresa._id, 'venta')).padStart(6, '0')}`;
    if (pedido?.reservaActiva) await inventario.liberar({ empresa: empresa._id, sede: sede._id, lineas: pedido.reserva });
    if (pedido?.reservaActiva) deshacer.push(() => inventario.reservar({ empresa: empresa._id, sede: sede._id, lineas: pedido.reserva }));
    const salidas = (await inventario.desglosar(lineas)).map(l => ({ ...l, cantidad: -l.cantidad }));
    await inventario.mover({ empresa: empresa._id, sede: sede._id, lineas: salidas, tipo: 'venta', referencia: numero, usuario: cajero?._id, permitirNegativo: congelado || empresa.pos?.permitirStockNegativo !== false });
    deshacer.push(() => inventario.mover({ empresa: empresa._id, sede: sede._id, lineas: salidas.map(l => ({ ...l, cantidad: -l.cantidad })), tipo: 'ajuste', referencia: numero, motivo: 'Reverso de venta no completada' }));

    const ad = body.adquiriente && String(body.adquiriente.documento || '').trim() ? {
      tipoDocumento: String(body.adquiriente.tipoDocumento || ''), documento: String(body.adquiriente.documento).trim(),
      nombre: String(body.adquiriente.nombre || '').trim(), correo: String(body.adquiriente.correo || '').trim().toLowerCase(),
    } : undefined;
    if (ad && !ad.nombre) throw new ErrorApi('Falta el nombre para la factura');

    const fecha = offline && body.fecha && new Date(body.fecha) <= new Date() && Date.now() - new Date(body.fecha) < 15 * 86400000 ? new Date(body.fecha) : new Date();
    const venta = await Venta.create({
      empresa: empresa._id, sede: sede._id, caja: caja?._id, turno: turno?._id, cajero: cajero?._id, uuid, numero, origen, pedido: pedido?._id,
      cliente: cliente?._id, clienteNombre: cliente?.nombre, adquiriente: ad, moneda: pais.moneda, decimales: dec,
      items: calculo.lineas.map(l => ({ ...l, promocion: l.promocion?.nombre })),
      subtotal: calculo.subtotal, descuento: calculo.descuento, base: calculo.base, impuesto: calculo.impuesto, domicilio: calculo.domicilio, total: calculo.total, redondeo,
      pagos, puntosRedimidos, offline, diferenciaPrecio, autorizadoPor, fecha,
      documento: { estado: facturacion.estadoInicial(empresa, pais, ad) },
    });

    if (puntosRedimidos) await MovimientoPuntos.create({ empresa: empresa._id, cliente: cliente._id, tipo: 'redencion', puntos: -puntosRedimidos, detalle: `Redención en ${numero}`, venta: venta._id });
    if (fiado > 0) await MovimientoCartera.create({ empresa: empresa._id, cliente: cliente._id, tipo: 'cargo', monto: fiado, saldo: deudaNueva, venta: venta._id, turno: turno?._id, usuario: cajero?._id });

    let premio = null;
    try { premio = await gamificacion.aplicarVenta(empresa, venta._id); }
    catch (e) { console.error('[gamificacion]', e.message); } // nunca tumba una venta ya cobrada
    setImmediate(() => facturacion.procesarVenta(venta._id).catch(e => console.error('[facturacion]', e.message)));
    return { venta: (await Venta.findById(venta._id).lean()), premio };
  } catch (error) {
    for (const f of deshacer.reverse()) await f().catch(e => console.error('[venta.deshacer]', e.message));
    // Doble envío simultáneo de la misma venta: la otra petición ganó
    if (error.code === 11000) {
      const v = await Venta.findOne({ empresa: empresa._id, uuid }).lean();
      if (v) return { venta: v, repetida: true };
    }
    throw error;
  }
}

// Devolución total (anular) o parcial. `items`: [{ item, cantidad }]; vacío = todo.
async function devolver({ empresa, pais, ventaId, items, motivo, medio, usuario, turno }) {
  const venta = await Venta.findOne({ _id: ventaId, empresa: empresa._id }).lean();
  if (!venta) throw new ErrorApi('Venta no encontrada', 404);
  if (venta.estado === 'anulada') throw new ErrorApi('La venta ya está anulada', 409);
  if (!String(motivo || '').trim()) throw new ErrorApi('El motivo es obligatorio');
  const dec = venta.decimales ?? pais.decimales;
  const pedidos = (items && items.length ? items : venta.items.map(i => ({ item: i._id, cantidad: r3(i.cantidad - (i.cantidadDevuelta || 0)) }))).filter(x => Number(x.cantidad) > 0);
  if (!pedidos.length) throw new ErrorApi('No hay nada por devolver');

  const hechos = [], lineas = [];
  try {
    for (const x of pedidos) {
      const it = venta.items.find(i => String(i._id) === String(x.item));
      const q = r3(x.cantidad);
      if (!it) throw new ErrorApi('El producto no pertenece a la venta');
      const r = await Venta.updateOne({ _id: venta._id, items: { $elemMatch: { _id: it._id, cantidadDevuelta: { $lte: r3(it.cantidad - q) + 0.0005 } } } }, { $inc: { 'items.$.cantidadDevuelta': q } });
      if (!r.modifiedCount) throw new ErrorApi(`${it.nombre}: la cantidad supera lo que queda por devolver`, 409);
      hechos.push({ it, q });
      const dev = it.cantidadDevuelta || 0;
      const parte = n => Motor.redondear(it.total * Math.min(1, n / it.cantidad), dec);
      lineas.push({ it, q, total: Motor.redondear(parte(dev + q) - parte(dev), dec) });
    }
  } catch (e) {
    for (const h of hechos) await Venta.updateOne({ _id: venta._id, 'items._id': h.it._id }, { $inc: { 'items.$.cantidadDevuelta': -h.q } });
    throw e;
  }

  const actual = await Venta.findById(venta._id).lean();
  const total = actual.items.every(i => r3(i.cantidad - i.cantidadDevuelta) <= 0);
  const primera = venta.estado === 'completada' && total;
  const monto = Motor.redondear(Motor.sumar(lineas.map(l => l.total), dec) + (primera ? venta.domicilio + (venta.redondeo || 0) : 0), dec);
  await Venta.updateOne({ _id: venta._id }, { estado: total ? 'anulada' : 'devuelta_parcial' });

  const fiadoVenta = Motor.sumar(venta.pagos.filter(p => p.tipo === 'fiado').map(p => p.monto), dec);
  const medioFinal = fiadoVenta > 0 && (medio === 'fiado' || fiadoVenta >= venta.total) ? 'fiado' : (medio || venta.pagos[0]?.medio || 'efectivo');

  // Nota crédito: solo si ya hay (o puede haber) factura emitida
  const emitida = !!venta.documento?.idProveedor || !!venta.documento?.numeroReservado;
  if (!emitida && total && ['pendiente', 'error'].includes(venta.documento?.estado)) {
    await Venta.updateOne({ _id: venta._id, 'documento.numeroReservado': null }, { 'documento.estado': 'no_aplica' });
  }
  const requiereNota = emitida || (!total && ['pendiente', 'error', 'validacion'].includes(venta.documento?.estado));
  const devolucion = await Devolucion.create({
    empresa: empresa._id, sede: venta.sede, venta: venta._id, turno: turno?._id, tipo: primera ? 'total' : 'parcial',
    items: lineas.map(l => ({ item: l.it._id, producto: l.it.producto, nombre: l.it.nombre, cantidad: l.q, total: l.total })),
    monto, medio: medioFinal, motivo: String(motivo).trim(), usuario: usuario?._id,
    documento: { estado: requiereNota ? 'pendiente' : 'no_aplica' },
  });

  const entradas = await inventario.desglosar(lineas.map(l => ({ producto: l.it.producto, cantidad: l.q, factor: l.it.factor })));
  await inventario.mover({ empresa: empresa._id, sede: venta.sede, lineas: entradas, tipo: 'devolucion', referencia: venta.numero, motivo, usuario: usuario?._id });
  if (medioFinal === 'fiado' && venta.cliente) {
    const c = await Cliente.findOneAndUpdate({ _id: venta.cliente }, [{ $set: { deuda: { $max: [0, { $subtract: ['$deuda', monto] }] } } }], { new: true }).lean();
    await MovimientoCartera.create({ empresa: empresa._id, cliente: venta.cliente, tipo: 'devolucion', monto, saldo: c?.deuda, venta: venta._id, turno: turno?._id, usuario: usuario?._id });
  }
  if (venta.cliente && venta.puntosAplicados) {
    const base = venta.total - venta.domicilio;
    const quita = base > 0 ? Math.round(venta.puntosGanados * Motor.sumar(lineas.map(l => l.total), dec) / base) : 0;
    if (quita > 0) await gamificacion.sumarPuntos({ empresa: empresa._id, cliente: venta.cliente, puntos: -quita, tipo: 'devolucion', detalle: `Devolución de ${venta.numero}`, venta: venta._id });
    if (primera && venta.puntosRedimidos) await gamificacion.sumarPuntos({ empresa: empresa._id, cliente: venta.cliente, puntos: venta.puntosRedimidos, tipo: 'devolucion', detalle: `Puntos devueltos de ${venta.numero}`, venta: venta._id });
    if (total) await Venta.updateOne({ _id: venta._id }, { 'giro.disponible': false });
  }
  if (requiereNota) setImmediate(() => facturacion.procesarDevolucion(devolucion._id).catch(e => console.error('[notaCredito]', e.message)));
  return devolucion;
}

module.exports = { crear, devolver, armarLineas, promosVigentes };
