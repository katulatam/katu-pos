const crypto = require('crypto');
const Pedido = require('../models/Pedido');
const Zona = require('../models/Zona');
const Sede = require('../models/Sede');
const Cliente = require('../models/Cliente');
const Producto = require('../models/Producto');
const Contador = require('../models/Contador');
const inventario = require('./inventario');
const ventas = require('./ventas');
const geo = require('./geo');
const { ErrorApi, ahoraDe, mediosDe } = require('./contexto');
const Motor = require('../../frontend/assets/js/motor');

const ACTIVOS = ['recibido', 'preparando', 'listo', 'en_camino'];
// recibido → preparando → listo → en_camino → entregado (recoger salta en_camino)
// Aviso al cliente por WhatsApp cuando la empresa tiene el módulo (carga diferida: evita ciclos)
const avisar = (empresa, pedido) => { if (empresa.modulos?.whatsapp) setImmediate(() => require('./whatsapp').notificarPedido(empresa._id, pedido)); };
const SIGUIENTES = { recibido: ['preparando', 'cancelado'], preparando: ['listo', 'cancelado'], listo: ['en_camino', 'entregado', 'cancelado'], en_camino: ['entregado', 'cancelado'], entregado: [], cancelado: [] };

async function zonasDe(empresa, sedeId) {
  const sedes = await Sede.find({ empresa: empresa._id, activo: true, atiendeDomicilios: true, ...(sedeId && { _id: sedeId }) }).lean();
  const mapa = new Map(sedes.map(s => [String(s._id), s]));
  const zonas = await Zona.find({ empresa: empresa._id, activo: true, sede: { $in: sedes.map(s => s._id) } }).lean();
  return zonas.map(z => ({ ...z, origen: mapa.get(String(z.sede)).ubicacion, _sede: mapa.get(String(z.sede)) }));
}

async function cotizar(empresa, pais, punto, totalProductos = 0) {
  const c = geo.cotizar(await zonasDe(empresa), punto, { ahora: ahoraDe(empresa), totalProductos, decimales: pais.decimales });
  if (!c) return { cubre: false };
  const z = c.zona;
  return {
    cubre: true, abierta: c.abierta, zona: z._id, nombreZona: z.nombre, sede: z.sede, nombreSede: z._sede.nombre, distancia: c.distancia, tarifa: c.tarifa,
    pedidoMinimo: z.pedidoMinimo || 0, gratisDesde: z.gratisDesde || 0, minutos: z.minutos || 0, horario: z.horaDesde && z.horaHasta ? `${z.horaDesde} – ${z.horaHasta}` : '',
  };
}

async function _calcular(empresa, pais, items, cantidadDe) {
  const { lineas } = await ventas.armarLineas({ empresa, pais, items: items.map(i => ({ producto: i.producto, cantidad: cantidadDe(i) })), congelado: false });
  return Motor.calcular(lineas, { decimales: pais.decimales, ahora: ahoraDe(empresa), promociones: await ventas.promosVigentes(empresa) });
}

// Cliente de la empresa para una cuenta de la app. Nunca se enlaza por
// coincidencia de teléfono/documento con un cliente existente (ver CuentaCliente).
async function clienteDeCuenta(empresa, cuenta) {
  const filtro = { empresa: empresa._id, cuenta: cuenta._id };
  const c = await Cliente.findOne(filtro).lean();
  if (c) return c;
  try { return (await Cliente.create({ ...filtro, nombre: cuenta.nombre, telefono: cuenta.telefono, correo: cuenta.correo, aceptaDatos: cuenta.aceptaDatos })).toObject(); }
  catch (e) { if (e.code === 11000) return Cliente.findOne(filtro).lean(); throw e; }
}

async function crear({ empresa, pais, body, cuenta, canal, usuario }) {
  const uuid = String(body.uuid || '');
  if (!/^[\w-]{16,64}$/.test(uuid)) throw new ErrorApi('Falta el identificador del pedido');
  const previo = await Pedido.findOne({ empresa: empresa._id, uuid }).lean();
  if (previo) return previo;

  const tipo = body.tipo === 'recoger' ? 'recoger' : 'domicilio';
  if (tipo === 'recoger' && empresa.domicilios?.recogerEnTienda === false) throw new ErrorApi('La tienda no tiene recogida en el local');
  const contacto = { nombre: String(body.contacto?.nombre || cuenta?.nombre || '').trim(), telefono: String(body.contacto?.telefono || cuenta?.telefono || '').trim() };
  if (!contacto.nombre || !contacto.telefono) throw new ErrorApi('Nombre y teléfono son obligatorios');

  const ids = (body.items || []).map(i => i.producto);
  const prods = new Map((await Producto.find({ _id: { $in: ids }, empresa: empresa._id, activo: true, enLinea: true }).select('nombre imagenUrl').lean()).map(p => [String(p._id), p]));
  if (!usuario && (body.items || []).some(i => !prods.has(String(i.producto)))) throw new ErrorApi('Hay productos que ya no están disponibles', 409);
  const calc = await _calcular(empresa, pais, body.items || [], i => i.cantidad);

  let sede, zona, domicilio = 0, entrega, minutos = empresa.domicilios?.minutosPreparacion || 20;
  if (tipo === 'domicilio') {
    const e = body.entrega || {};
    if (!String(e.direccion || '').trim()) throw new ErrorApi('La dirección de entrega es obligatoria');
    if (!geo.puntoValido(e)) throw new ErrorApi('Marca en el mapa el punto de entrega');
    const c = await cotizar(empresa, pais, e, calc.totalProductos);
    if (!c.cubre) throw new ErrorApi('La dirección está fuera de la zona de cobertura', 409, 'FUERA_COBERTURA');
    if (!c.abierta) throw new ErrorApi(`En este momento no hay domicilios en tu zona${c.horario ? ` (atención ${c.horario})` : ''}`, 409, 'CERRADO');
    if (calc.totalProductos < c.pedidoMinimo) throw new ErrorApi(`El pedido mínimo para tu zona es ${Motor.dinero(c.pedidoMinimo, pais)}`, 409, 'PEDIDO_MINIMO');
    sede = c.sede; zona = c.zona; domicilio = c.tarifa; minutos += c.minutos;
    entrega = { direccion: String(e.direccion).trim().slice(0, 200), detalle: String(e.detalle || '').slice(0, 200), notas: String(e.notas || '').slice(0, 300), lat: Number(e.lat), lng: Number(e.lng), distanciaM: c.distancia };
  } else {
    const s = await Sede.findOne({ empresa: empresa._id, activo: true, ...(body.sede && { _id: body.sede }) }).lean();
    if (!s) throw new ErrorApi('La sede no está disponible');
    sede = s._id;
  }

  const medio = mediosDe(empresa, pais, 'domicilio').find(m => m.codigo === body.medioPago);
  if (!medio) throw new ErrorApi('Elige un medio de pago');
  const total = Motor.redondear(calc.totalProductos + domicilio, pais.decimales);
  const pagaCon = medio.tipo === 'efectivo' && Number(body.pagaCon) > 0 ? Motor.redondear(body.pagaCon, pais.decimales) : undefined;
  if (pagaCon && pagaCon < total) throw new ErrorApi('El valor con el que pagas es menor al total');

  let cliente = null;
  if (cuenta) cliente = await clienteDeCuenta(empresa, cuenta);
  else if (usuario && body.cliente) cliente = await Cliente.findOne({ _id: body.cliente, empresa: empresa._id }).lean();

  const reserva = await inventario.desglosar(calc.lineas);
  await inventario.reservar({ empresa: empresa._id, sede, lineas: reserva, permitirNegativo: empresa.pos?.permitirStockNegativo !== false });
  try {
    const nuevo = (await Pedido.create({
      empresa: empresa._id, sede, zona, uuid, numero: `D-${String(await Contador.siguiente(empresa._id, 'pedido')).padStart(5, '0')}`,
      seguimiento: crypto.randomBytes(16).toString('hex'), canal, tipo, cuenta: cuenta?._id, cliente: cliente?._id, contacto, entrega,
      adquiriente: body.adquiriente?.documento ? body.adquiriente : undefined,
      items: calc.lineas.map((l, i) => ({ producto: l.producto, nombre: l.nombre, porPeso: l.porPeso, unidad: l.unidad, imagenUrl: prods.get(String(l.producto))?.imagenUrl, cantidad: l.cantidad, cantidadReal: null, precioUnitario: l.precioUnitario, descuento: l.descuento, total: l.total, nota: String(body.items[i].nota || '').slice(0, 120) })),
      moneda: pais.moneda, decimales: pais.decimales, totalProductos: calc.totalProductos, descuento: calc.descuento, domicilio, total, minutosEstimados: minutos,
      medioPago: medio.codigo, tipoPago: medio.tipo, pagaCon, pin: String(crypto.randomInt(1000, 10000)), reservaActiva: true, reserva,
      historial: [{ estado: 'recibido', por: usuario?.nombre || contacto.nombre }],
    })).toObject();
    avisar(empresa, nuevo);
    return nuevo;
  } catch (e) {
    await inventario.liberar({ empresa: empresa._id, sede, lineas: reserva });
    if (e.code === 11000) { const p = await Pedido.findOne({ empresa: empresa._id, uuid }).lean(); if (p) return p; }
    throw e;
  }
}

const porPesar = p => p.items.some(i => i.porPeso && i.cantidadReal == null);
const requierePagoPrevio = p => p.tipoPago === 'qr';

// Alistamiento: cantidades y pesos reales → recalcula el total
async function alistar({ empresa, pais, pedido, items }) {
  if (!['recibido', 'preparando'].includes(pedido.estado)) throw new ErrorApi('El pedido ya no se puede modificar', 409);
  if (pedido.pagado) throw new ErrorApi('El pedido ya está pagado: no se pueden cambiar cantidades', 409);
  const reales = new Map((items || []).map(i => [String(i.item), Motor.r3(i.cantidad)]));
  const nuevos = pedido.items.map(i => {
    const q = reales.has(String(i._id)) ? reales.get(String(i._id)) : i.cantidadReal;
    if (q != null && (q < 0 || q > 100000)) throw new ErrorApi('Cantidad inválida');
    return { ...i, cantidadReal: q };
  });
  const vivos = nuevos.filter(i => (i.cantidadReal ?? i.cantidad) > 0);
  if (!vivos.length) throw new ErrorApi('El pedido quedaría vacío: cancélalo');
  const calc = await _calcular(empresa, pais, vivos, i => i.cantidadReal ?? i.cantidad);
  let k = 0;
  const final = nuevos.map(i => {
    if ((i.cantidadReal ?? i.cantidad) <= 0) return { ...i, descuento: 0, total: 0 };
    const l = calc.lineas[k++];
    return { ...i, precioUnitario: l.precioUnitario, descuento: l.descuento, total: l.total };
  });
  return Pedido.findOneAndUpdate({ _id: pedido._id, pagado: false, estado: { $in: ['recibido', 'preparando'] } },
    { items: final, totalProductos: calc.totalProductos, descuento: calc.descuento, total: Motor.redondear(calc.totalProductos + pedido.domicilio, pais.decimales) }, { new: true }).lean();
}

async function cambiarEstado({ empresa, pais, pedido, estado, usuario, datos = {} }) {
  if (!(SIGUIENTES[pedido.estado] || []).includes(estado)) throw new ErrorApi(`El pedido está en "${pedido.estado}" y no puede pasar a "${estado}"`, 409);
  if (estado === 'preparando' && requierePagoPrevio(pedido) && !pedido.pagado && !porPesar(pedido)) throw new ErrorApi('El cliente aún no ha pagado', 409, 'SIN_PAGO');
  if (estado === 'listo' && porPesar(pedido)) throw new ErrorApi('Falta registrar el peso real de los productos por peso', 409, 'POR_PESAR');
  if (['en_camino', 'entregado'].includes(estado) && requierePagoPrevio(pedido) && !pedido.pagado) throw new ErrorApi('El cliente aún no ha pagado', 409, 'SIN_PAGO');
  if (estado === 'en_camino' && pedido.tipo === 'recoger') throw new ErrorApi('Este pedido lo recoge el cliente en la tienda');
  if (estado === 'entregado' && pedido.tipo === 'domicilio' && pedido.estado !== 'en_camino') throw new ErrorApi('Primero despacha el pedido');
  if (estado === 'cancelado' && !String(datos.motivo || '').trim()) throw new ErrorApi('El motivo es obligatorio');

  const cambio = { estado, $push: { historial: { estado, por: usuario?.nombre } } };
  if (estado === 'en_camino') {
    const rep = datos.domiciliario || pedido.domiciliario;
    if (!rep) throw new ErrorApi('Asigna un domiciliario');
    cambio.domiciliario = rep;
  }
  if (estado === 'cancelado') cambio.motivoCancelacion = String(datos.motivo).trim();

  if (estado === 'entregado') {
    if (pedido.tipo === 'domicilio') {
      if (pedido.intentosPin >= 5) throw new ErrorApi('PIN bloqueado por intentos fallidos: llama a la tienda', 403);
      if (String(datos.pin || '') !== pedido.pin) {
        await Pedido.updateOne({ _id: pedido._id }, { $inc: { intentosPin: 1 } });
        throw new ErrorApi('El PIN no coincide', 403, 'PIN');
      }
    }
    const sede = await Sede.findById(pedido.sede).lean();
    const { venta } = await ventas.crear({
      empresa, pais, sede, cajero: usuario, origen: 'domicilio', pedido, turno: datos.turno, caja: datos.caja,
      body: {
        uuid: `pedido-${pedido._id}`, cliente: pedido.cliente, adquiriente: pedido.adquiriente,
        items: pedido.items.filter(i => (i.cantidadReal ?? i.cantidad) > 0).map(i => ({ producto: i.producto, cantidad: i.cantidadReal ?? i.cantidad, precioUnitario: i.precioUnitario, descuento: i.descuento })),
        pagos: [{ medio: pedido.medioPago, monto: pedido.total, cobro: pedido.cobro, referencia: datos.referencia }],
      },
    });
    Object.assign(cambio, { venta: venta._id, reservaActiva: false, liquidado: pedido.tipoPago !== 'efectivo' || !!datos.turno });
  }
  const r = await Pedido.findOneAndUpdate({ _id: pedido._id, estado: pedido.estado }, cambio, { new: true }).lean();
  if (!r) throw new ErrorApi('El pedido cambió mientras lo actualizabas: recarga', 409);
  if (estado === 'cancelado' && pedido.reservaActiva) {
    const q = await Pedido.updateOne({ _id: pedido._id, reservaActiva: true }, { reservaActiva: false });
    if (q.modifiedCount) await inventario.liberar({ empresa: empresa._id, sede: pedido.sede, lineas: pedido.reserva });
  }
  avisar(empresa, r);
  return r;
}

module.exports = { ACTIVOS, cotizar, crear, alistar, cambiarEstado, clienteDeCuenta, porPesar, requierePagoPrevio, zonasDe };
