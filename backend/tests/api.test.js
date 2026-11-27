process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'prueba';
process.env.MODO_DEMO = 'true';
process.env.KATU_ADMIN_PASSWORD = 'SuperPrueba1';
process.env.ALANUBE_TOKEN = 'token-prueba';
process.env.PUBLIC_URL = 'https://app.katupos.test'; // las pruebas no dependen del .env local
['MONGO_URI', 'DB_HOST', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'OPENROUTER_API_KEY', 'SENDGRID_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'DOMINIO_BASE'].forEach(k => { process.env[k] = ''; }); // nunca servicios reales en pruebas

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { firmar } = require('../middleware/firmaDispositivo');
const M = n => require(`../models/${n}`);

let mongo, servidor, base, proveedor, recibidos = [], falla = null;
const tk = {};
async function api(quien, metodo, ruta, body, extra = {}) {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(tk[quien] && { Authorization: 'Bearer ' + tk[quien] }), ...extra }, ...(body && { body: JSON.stringify(body) }) });
  return { s: r.status, ...(await r.json()) };
}
const ok = r => { assert.ok(r.success, `esperaba éxito: ${r.s} ${r.error}`); return r.data; };
const no = (r, s) => { assert.equal(r.success, false); if (s) assert.equal(r.s, s, r.error); return r; };
const uuid = () => crypto.randomUUID();
const ctx = {};

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('katu_pos_test'));
  // Proveedor de facturación simulado
  proveedor = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }).on('end', () => {
      const body = b ? JSON.parse(b) : null;
      recibidos.push({ m: req.method, u: req.url, body, llave: req.headers['idempotency-key'] });
      res.setHeader('Content-Type', 'application/json');
      if (falla) { const f = falla; falla = null; res.statusCode = f.s; return res.end(JSON.stringify(f.b)); }
      if (req.method === 'GET' && req.url.startsWith('/invoices/')) return res.end(JSON.stringify({ invoice: { id: req.url.split('/')[2], number: 100, prefix: 'KP', cufe: 'cufe-x', date: '2026-11-25', legalStatus: 'ACCEPTED' } }));
      if (req.url === '/invoices') return res.end(JSON.stringify({ invoice: { id: 'inv-' + body.number, fullNumber: 'KP' + body.number, cufe: 'cufe-' + body.number, status: 'SENT', legalStatus: 'ACCEPTED' } }));
      if (req.url === '/credit-notes') return res.end(JSON.stringify({ creditNote: { id: 'nc-' + body.number, fullNumber: 'NC' + body.number, cude: 'x', legalStatus: 'ACCEPTED' } }));
      res.end('{}');
    });
  });
  await new Promise(r => proveedor.listen(0, r));
  process.env.ALANUBE_API_URL = `http://127.0.0.1:${proveedor.address().port}`;

  const { app } = require('../server');
  await require('../config/inicializar')();
  await require('../seeds/demo.seed').sembrarDemo();
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  servidor = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${servidor.address().port}/api/v1`;
  for (const [k, c] of [['admin', 'admin@orbita.demo'], ['caja', 'caja@orbita.demo'], ['sup', 'super@orbita.demo'], ['domi', 'domi@orbita.demo'], ['mx', 'admin@nova.demo'], ['mxcaja', 'caja@nova.demo']]) {
    tk[k] = ok(await api('', 'POST', '/auth/login', { correo: c, password: 'Demo2026*' })).token;
  }
  tk.super = ok(await api('', 'POST', '/auth/login', { correo: 'katu@katulatam.com', password: 'SuperPrueba1' })).token;
  for (const [k, u] of [['co', 'caja'], ['mx', 'mxcaja']]) {
    const cajas = ok(await api(u, 'GET', '/pos/cajas'));
    const turno = ok(await api(u, 'POST', '/turnos', { caja: cajas[0]._id, base: k === 'co' ? 100000 : 500 }));
    ctx[k] = ok(await api(u, 'GET', '/pos/arranque/' + cajas[0]._id));
    ctx[k].t = turno._id;
    ctx[k].p = n => ctx[k].productos.find(p => p.nombre.startsWith(n));
  }
});
test.after(async () => {
  await new Promise(r => setTimeout(r, 300));
  servidor.close(); servidor.closeAllConnections(); proveedor.close();
  await mongoose.disconnect(); await mongo.stop();
});

const vender = (k, u, items, pagos, extra = {}) => api(u, 'POST', '/pos/ventas', { uuid: uuid(), turno: ctx[k].t, items, pagos, ...extra });

test('país: Colombia sin decimales, México con 2, cada uno con sus impuestos y medios', async () => {
  assert.equal(ctx.co.pais.decimales, 0); assert.equal(ctx.mx.pais.decimales, 2);
  assert.ok(ctx.co.medios.some(m => m.codigo === 'qr_nequi')); assert.ok(!ctx.mx.medios.some(m => m.codigo === 'qr_nequi'));
  assert.equal(ctx.co.p('Gaseosa').impuestoPct, 19); assert.equal(ctx.mx.p('Gaseosa').impuestoPct, 16);
  assert.equal(ctx.mx.empresa.zonaHoraria, 'America/Mexico_City');
  assert.equal(ctx.co.pais.facturacion.disponible, true); assert.equal(ctx.mx.pais.facturacion.disponible, false);
});

test('venta por peso en México conserva centavos y moneda', async () => {
  const b = ctx.mx.p('Aguacate'); // 49.00/kg
  const v = ok(await vender('mx', 'mxcaja', [{ producto: b._id, cantidad: 0.333 }, { producto: ctx.mx.p('Gaseosa')._id, cantidad: 1 }], [{ medio: 'datafono', monto: 30.69 }])).venta; // 49*.333=16.32 −10% = 14.69; +16
  assert.equal(v.total, 30.69); assert.equal(v.moneda, 'MXN'); assert.equal(v.documento.estado, 'no_aplica');
});

test('venta: el servidor manda el precio, exige cuadre y calcula el cambio', async () => {
  const g = ctx.co.p('Gaseosa');
  no(await vender('co', 'caja', [{ producto: g._id, cantidad: 2, precioUnitario: 1 }], [{ medio: 'efectivo', monto: 2 }]), 409);
  const r = ok(await vender('co', 'caja', [{ producto: g._id, cantidad: 2 }], [{ medio: 'efectivo', monto: 6400, recibido: 10000 }]));
  assert.equal(r.venta.pagos[0].cambio, 3600);
  no(await vender('co', 'caja', [{ producto: g._id, cantidad: 1.5 }], [{ medio: 'efectivo', monto: 4800 }]), 400);
  no(await vender('co', 'caja', [{ producto: g._id, cantidad: -1 }], [{ medio: 'efectivo', monto: 0 }]), 400);
});

test('venta: idempotente aun con envíos simultáneos', async () => {
  const id = uuid(), g = ctx.co.p('Pasta');
  const antes = await M('Existencia').findOne({ producto: g._id }).lean();
  const body = { uuid: id, turno: ctx.co.t, items: [{ producto: g._id, cantidad: 1 }], pagos: [{ medio: 'efectivo', monto: 3900 }] };
  const rs = await Promise.all(Array.from({ length: 6 }, () => api('caja', 'POST', '/pos/ventas', body)));
  rs.forEach(ok);
  assert.equal(new Set(rs.map(r => r.data.venta._id)).size, 1);
  assert.equal(await M('Venta').countDocuments({ uuid: id }), 1);
  assert.equal((await M('Existencia').findOne({ producto: g._id }).lean()).cantidad, antes.cantidad - 1);
});

test('inventario: sin stock negativo, 10 cajas no venden más de lo que hay', async () => {
  const p = ctx.co.p('Detergente');
  await M('Existencia').updateOne({ producto: p._id }, { cantidad: 3, reservado: 0 });
  ok(await api('admin', 'PUT', '/configuracion', { pos: { permitirStockNegativo: false } }));
  const rs = await Promise.all(Array.from({ length: 10 }, () => vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'efectivo', monto: 12900 }])));
  assert.equal(rs.filter(r => r.success).length, 3);
  assert.equal((await M('Existencia').findOne({ producto: p._id }).lean()).cantidad, 0);
  ok(await api('admin', 'PUT', '/configuracion', { pos: { permitirStockNegativo: true } }));
});

test('descuento: por encima del tope el cajero necesita PIN', async () => {
  const p = ctx.co.p('Arroz');
  const body = { descuentoGlobal: 1000 };
  assert.equal(no(await vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'datafono', monto: 3900 }], body), 403).codigo, 'REQUIERE_AUTORIZACION');
  const aut = ok(await api('caja', 'POST', '/auth/autorizar-pin', { pin: '1234' }));
  ok(await vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'datafono', monto: 3900 }], { ...body, autorizacion: aut.token }));
  no(await api('caja', 'POST', '/auth/autorizar-pin', { pin: '0000' }), 403);
});

test('QR: la venta exige un cobro aprobado, por el valor exacto y de un solo uso', async () => {
  const p = ctx.co.p('Café');
  const c = ok(await api('caja', 'POST', '/cobros', { caja: ctx.co.caja._id, medio: 'qr_nequi', monto: 13500 }));
  assert.ok(c.qrBase64.startsWith('data:image/png'));
  const v = () => vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'qr_nequi', monto: 13500, cobro: c._id }]);
  no(await v(), 409);
  await M('Cobro').collection.updateOne({ _id: new mongoose.Types.ObjectId(String(c._id)) }, { $set: { createdAt: new Date(Date.now() - 10000) } });
  assert.equal(ok(await api('caja', 'GET', '/cobros/' + c._id)).estado, 'aprobado');
  ok(await v());
  no(await v(), 409);
  no(await api('mxcaja', 'GET', '/cobros/' + c._id), 404);
});

test('autopago: canal kiosco, solo pagos confirmados y origen kiosco', async () => {
  const k = ok(await api('sup', 'GET', '/pos/cajas')).find(c => c.tipo === 'autopago');
  assert.ok(k, 'el demo trae un kiosco de autopago');
  const turno = ok(await api('sup', 'POST', '/turnos', { caja: k._id, base: 0 }));
  const d = ok(await api('sup', 'GET', '/pos/arranque/' + k._id));
  assert.equal(d.caja.tipo, 'autopago');
  assert.ok(d.medios.some(m => m.tipo === 'qr') && !d.medios.some(m => m.tipo === 'fiado'));
  const p = ctx.co.p('Café'), items = [{ producto: p._id, cantidad: 1 }];
  const vk = (pagos, extra = {}) => api('sup', 'POST', '/pos/ventas', { uuid: uuid(), turno: turno._id, items, pagos, ...extra });
  // Efectivo "a mano" no vale: nadie lo recibió
  assert.equal(no(await vk([{ medio: 'efectivo', monto: 13500 }]), 400).codigo, 'PAGO_NO_CONFIRMADO');
  no(await vk([{ medio: 'efectivo', monto: 13500 }], { offline: true }), 400);
  no(await api('sup', 'POST', '/pos/ventas', { uuid: uuid(), turno: turno._id, items: [{ ...items[0], descuentoManual: 1000 }], pagos: [{ medio: 'qr_nequi', monto: 12500, cobro: String(new mongoose.Types.ObjectId()) }] }), 400);
  // QR aprobado → venta con origen kiosco
  const c = ok(await api('sup', 'POST', '/cobros', { caja: k._id, medio: 'qr_nequi', monto: 13500 }));
  await M('Cobro').collection.updateOne({ _id: new mongoose.Types.ObjectId(String(c._id)) }, { $set: { createdAt: new Date(Date.now() - 10000) } });
  assert.equal(ok(await api('sup', 'GET', '/cobros/' + c._id)).estado, 'aprobado');
  const v = ok(await vk([{ medio: 'qr_nequi', monto: 13500, cobro: c._id }])).venta;
  assert.equal(v.origen, 'kiosco');
});

test('fiado: respeta el cupo aun en paralelo, y el abono baja la deuda', async () => {
  const cli = (ok(await api('caja', 'GET', '/clientes/buscar?q=1010101010')))[0];
  assert.equal(cli.nombre, 'Valentina Rojas');
  const p = ctx.co.p('Vino'); // 42.000, cupo 100.000
  const rs = await Promise.all(Array.from({ length: 4 }, () => vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'fiado', monto: 42000 }], { cliente: cli._id })));
  assert.equal(rs.filter(r => r.success).length, 2);
  no(await api('caja', 'POST', `/cartera/${cli._id}/abonos`, { monto: 999999, turno: ctx.co.t }), 409);
  assert.equal(ok(await api('caja', 'POST', `/cartera/${cli._id}/abonos`, { monto: 34000, turno: ctx.co.t })).deuda, 50000);
});

test('gamificación: puntos, misión, ruleta de un solo giro y redención', async () => {
  const cli = (ok(await api('caja', 'GET', '/clientes/buscar?q=2020202020')))[0];
  await M('Cliente').updateOne({ _id: cli._id }, { puntos: 500, xp: 0 });
  const p = ctx.co.p('Vino');
  const r = ok(await vender('co', 'caja', [{ producto: p._id, cantidad: 1 }], [{ medio: 'datafono', monto: 42000 }], { cliente: cli._id }));
  assert.equal(r.premio.ganados, 42); assert.equal(r.premio.giro, true);
  ok(await api('caja', 'POST', `/pos/ventas/${r.venta._id}/girar`));
  no(await api('caja', 'POST', `/pos/ventas/${r.venta._id}/girar`), 409);
  // 100 puntos × $10 = $1.000
  const r2 = ok(await vender('co', 'caja', [{ producto: ctx.co.p('Arroz')._id, cantidad: 1 }], [{ medio: 'datafono', monto: 3900 }], { cliente: cli._id, puntosRedimir: 100 }));
  assert.equal(r2.venta.puntosRedimidos, 100);
  no(await vender('co', 'caja', [{ producto: ctx.co.p('Arroz')._id, cantidad: 1 }], [{ medio: 'datafono', monto: 900 }], { cliente: cli._id, puntosRedimir: 400 }), 400);
});

test('sin conexión: respeta lo cobrado, lo marca y no acepta QR', async () => {
  const p = ctx.co.p('Arroz');
  const r = ok(await vender('co', 'caja', [{ producto: p._id, cantidad: 2, precioUnitario: 4800, descuento: 100 }], [{ medio: 'efectivo', monto: 9500 }], { offline: true, fecha: new Date(Date.now() - 3600000) }));
  assert.equal(r.venta.total, 9500); assert.equal(r.venta.diferenciaPrecio, true); assert.equal(r.venta.offline, true);
  no(await vender('co', 'caja', [{ producto: p._id, cantidad: 1, precioUnitario: 4900 }], [{ medio: 'qr_nequi', monto: 4900, cobro: String(new mongoose.Types.ObjectId()) }], { offline: true }), 400);
});

test('facturación: emite con resolución propia, reintenta con la misma llave y hace nota crédito', async () => {
  const e = await M('Empresa').findOne({ slug: 'orbita' });
  const H = { 'x-empresa': String(e._id) };
  await M('Empresa').updateOne({ _id: e._id }, { 'facturacion.empresaProveedorId': 'emp-1', 'facturacion.idFiscal': '900' });
  no(await api('admin', 'PUT', '/facturacion/activar', { activa: true }), 403);
  ok(await api('super', 'PUT', '/facturacion/activar', { activa: true }, H));
  ok(await api('admin', 'PUT', '/facturacion/resolucion', { resolucion: { numero: '18760', prefijo: 'KP', desde: 100, hasta: 200, fechaInicio: '2026-01-01', fechaFin: '2027-12-31', claveTecnica: 'abc' }, siguienteNumero: 120 }));
  no(await api('admin', 'PUT', '/facturacion/resolucion', { resolucion: { numero: '18760', prefijo: 'KP', desde: 100, hasta: 200, fechaInicio: '2026-01-01', fechaFin: '2027-12-31' }, siguienteNumero: 110 }), 409);
  const espera = async (id, f) => { for (let i = 0; i < 40; i++) { const v = await M('Venta').findById(id).lean(); if (f(v)) return v; await new Promise(r => setTimeout(r, 50)); } assert.fail('tiempo'); };

  recibidos = [];
  const v = ok(await vender('co', 'caja', [{ producto: ctx.co.p('Banano')._id, cantidad: 1.255 }, { producto: ctx.co.p('Gaseosa')._id, cantidad: 3 }], [{ medio: 'efectivo', monto: 13200, recibido: 20000 }], { adquiriente: { tipoDocumento: '31', documento: '900559088', nombre: 'Empresa Cliente SAS', correo: 'a@b.co' } })).venta;
  const f = await espera(v._id, x => x.documento.estado === 'aceptada');
  assert.equal(f.documento.numero, 'KP120');
  const inv = recibidos.find(r => r.u === '/invoices').body;
  assert.equal(inv.customer.dv, '2'); assert.equal(inv.items[0].unitCode, 'KGM'); assert.equal(inv.items[0].quantity, 1.255); assert.equal(inv.items[0].taxes, undefined);
  assert.equal(inv.items[1].taxes[0].taxCode, '01'); assert.equal(inv.totalAmounts.payableTotal, f.total);
  assert.equal(inv.resolution.technicalKey, 'abc');

  // Falla temporal: conserva número y llave
  falla = { s: 500, b: { message: 'caído' } };
  const v2 = ok(await vender('co', 'caja', [{ producto: ctx.co.p('Arroz')._id, cantidad: 1 }], [{ medio: 'datafono', monto: 4900 }])).venta;
  const e2 = await espera(v2._id, x => x.documento.estado === 'error');
  assert.equal(e2.documento.numeroReservado, 121);
  assert.ok(!/alanube|alegra/i.test(e2.documento.error));
  await M('Venta').updateOne({ _id: v2._id }, { 'documento.ultimoIntento': null });
  recibidos = [];
  ok(await api('admin', 'POST', `/ventas/${v2._id}/reintentar-documento`));
  assert.equal((await M('Venta').findById(v2._id).lean()).documento.numero, 'KP121');
  assert.equal(recibidos[0].llave, e2.documento.llave);

  // Devolución parcial por peso → nota crédito
  recibidos = [];
  const d = ok(await api('admin', 'POST', `/ventas/${v._id}/devolver`, { motivo: 'Maduro', items: [{ item: f.items[0]._id, cantidad: 0.255 }] }));
  for (let i = 0; i < 40 && !(await M('Devolucion').findById(d._id).lean()).documento.numero; i++) await new Promise(r => setTimeout(r, 50));
  const dn = (await M('Devolucion').findById(d._id).lean()).documento;
  assert.deepEqual([dn.numero, dn.estado, dn.codigoUnico], ['NC1', 'aceptada', 'x']);
  const nc = recibidos.find(r => r.u === '/credit-notes').body;
  assert.equal(nc.associatedDocuments[0].uuid, 'cufe-x'); assert.equal(nc.totalAmounts.payableTotal, d.monto);

  // Secretos nunca salen
  const cfg = JSON.stringify([await api('caja', 'GET', '/configuracion'), await api('admin', 'GET', '/facturacion')]);
  assert.ok(!cfg.includes('abc"') && !cfg.includes('token-prueba') && !cfg.includes('webhookSecreto'));
  no(await api('', 'POST', `/facturacion/webhook/${e._id}`, { invoice: { id: 'x' } }), 401);
});

test('kiosco de efectivo: firma HMAC, anti-repetición e idempotencia por billete', async () => {
  const d = ok(await api('admin', 'POST', '/dispositivos', { nombre: 'Kiosco', tipo: 'kiosco_efectivo', caja: ctx.co.caja._id }));
  const raiz = base.replace('/api/v1', '');
  const firmada = async (metodo, ruta, body, { nonce = crypto.randomBytes(16).toString('hex'), secret = d.secret } = {}) => {
    const cuerpo = body ? JSON.stringify(body) : '', timestamp = String(Math.floor(Date.now() / 1000));
    const r = await fetch(raiz + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Device-Id': d.deviceId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Signature': firmar(secret, { timestamp, nonce, metodo, ruta, cuerpo }) }, ...(body && { body: cuerpo }) });
    return { s: r.status, ...(await r.json()) };
  };
  const c = ok(await api('caja', 'POST', '/cobros', { caja: ctx.co.caja._id, medio: 'efectivo', monto: 13500 }));
  no(await api('caja', 'POST', '/cobros', { caja: ctx.co.caja._id, medio: 'efectivo', monto: 500 }), 409);
  no(await firmada('GET', '/dispositivo/v1/kiosco/pendiente', null, { secret: 'ff'.repeat(32) }), 401);
  const n = crypto.randomBytes(16).toString('hex');
  assert.equal(ok(await firmada('GET', '/dispositivo/v1/kiosco/pendiente', null, { nonce: n })).monto, 13500);
  no(await firmada('GET', '/dispositivo/v1/kiosco/pendiente', null, { nonce: n }), 401);
  no(await firmada('GET', '/dispositivo/v1/terminal/pendiente'), 401);
  const ruta = `/dispositivo/v1/kiosco/cobros/${c._id}/dinero`;
  ok(await firmada('POST', ruta, { txId: 'T1', tipo: 'billete', denominacion: 10000 }));
  assert.equal(ok(await firmada('POST', ruta, { txId: 'T1', tipo: 'billete', denominacion: 10000 })).recibido, 10000);
  no(await api('caja', 'POST', `/cobros/${c._id}/cancelar`), 409);
  const f = ok(await firmada('POST', ruta, { txId: 'T2', tipo: 'billete', denominacion: 5000 }));
  assert.deepEqual([f.estado, f.cambio], ['aprobado', 1500]);
  const v = ok(await vender('co', 'caja', [{ producto: ctx.co.p('Café')._id, cantidad: 1 }], [{ medio: 'efectivo', monto: 13500, cobro: c._id }])).venta;
  assert.equal(v.pagos[0].cambio, 1500);
});

test('domicilio: geocerca, peso real, pago, PIN, reserva, venta y liquidación', async () => {
  const cerca = { lat: 4.6520, lng: -74.0628 }, lejos = { lat: 4.80, lng: -74.0628 };
  assert.equal(ok(await api('', 'POST', '/tienda/t/orbita/cotizar', { ...lejos, total: 1 })).cubre, false);
  assert.equal(ok(await api('', 'POST', '/tienda/t/orbita/cotizar', { ...cerca, total: 10000 })).tarifa, 3000);
  assert.equal(ok(await api('', 'POST', '/tienda/t/orbita/cotizar', { ...cerca, total: 80000 })).tarifa, 0);
  const reg = ok(await api('', 'POST', '/tienda/cuenta/registro', { pais: 'CO', nombre: 'pepe pérez', telefono: '301 555 7788', password: 'clave1234', aceptaDatos: true }));
  tk.cli = reg.token;
  no(await api('cli', 'GET', '/ventas'), 401);
  no(await api('caja', 'GET', '/tienda/cuenta/yo'), 401);
  const tomate = ctx.co.p('Tomate'), leche = ctx.co.p('Leche');
  const pedido = (entrega, medioPago) => api('cli', 'POST', '/tienda/t/orbita/pedidos', { uuid: uuid(), contacto: {}, entrega: { direccion: 'Calle 1', ...entrega }, medioPago, items: [{ producto: tomate._id, cantidad: 1 }, { producto: leche._id, cantidad: 2 }] });
  assert.equal(no(await pedido(lejos, 'efectivo'), 409).codigo, 'FUERA_COBERTURA');
  const exAntes = await M('Existencia').findOne({ producto: leche._id }).lean();
  const p = ok(await pedido(cerca, 'efectivo'));
  assert.equal(p.total, 4320 + 9200 + 3000); // tomate con −10%
  assert.equal((await M('Existencia').findOne({ producto: leche._id }).lean()).reservado, exAntes.reservado + 2);
  const id = p._id, est = (estado, x = {}) => api('admin', 'PUT', `/pedidos/${id}/estado`, { estado, ...x });
  no(await est('listo'), 409);
  ok(await est('preparando'));
  assert.equal(no(await est('listo'), 409).codigo, 'POR_PESAR');
  const det = ok(await api('admin', 'GET', '/pedidos/' + id));
  assert.equal(det.pin, undefined);
  const al = ok(await api('admin', 'PUT', `/pedidos/${id}/alistar`, { items: [{ item: det.items[0]._id, cantidad: 1.15 }] }));
  assert.equal(al.total, 4968 + 9200 + 3000);
  ok(await est('listo'));
  const ini = ok(await api('domi', 'GET', '/domiciliario/inicio'));
  assert.equal(ini.libres[0].contacto, undefined);
  ok(await api('domi', 'POST', `/domiciliario/pedidos/${id}/tomar`));
  no(await api('domi', 'POST', `/domiciliario/pedidos/${id}/tomar`), 409);
  ok(await api('domi', 'POST', `/domiciliario/pedidos/${id}/salir`));
  ok(await api('domi', 'POST', '/domiciliario/ubicacion', cerca));
  const seg = ok(await api('', 'GET', '/publico/seguimiento/' + p.seguimiento));
  assert.ok(seg.pin && seg.domiciliario.ubicacion);
  no(await api('domi', 'POST', `/domiciliario/pedidos/${id}/entregar`, { pin: seg.pin === '1111' ? '2222' : '1111' }), 403);
  ok(await api('domi', 'POST', `/domiciliario/pedidos/${id}/entregar`, { pin: seg.pin }));
  const ex = await M('Existencia').findOne({ producto: leche._id }).lean();
  assert.deepEqual([ex.cantidad, ex.reservado], [exAntes.cantidad - 2, exAntes.reservado]);
  const v = await M('Venta').findOne({ pedido: id }).lean();
  assert.deepEqual([v.total, v.domicilio, v.origen], [17168, 3000, 'domicilio']);
  assert.equal((await M('Usuario').findOne({ correo: 'domi@orbita.demo' }).lean()).ubicacion?.lat, undefined);
  assert.equal(ok(await api('caja', 'GET', '/pedidos/por-liquidar'))[0].total, 17168);
  const dom = await M('Usuario').findOne({ correo: 'domi@orbita.demo' }).lean();
  assert.equal(ok(await api('caja', 'POST', '/pedidos/liquidar', { domiciliario: dom._id, turno: ctx.co.t })).total, 17168);
  no(await api('caja', 'POST', '/pedidos/liquidar', { domiciliario: dom._id, turno: ctx.co.t }), 409);
  ok(await api('', 'POST', `/publico/seguimiento/${p.seguimiento}/calificar`, { estrellas: 5 }));

  // QR con producto por peso: solo se paga después de pesar
  const q = ok(await pedido(cerca, 'qr_nequi'));
  no(await api('', 'POST', `/publico/seguimiento/${q.seguimiento}/pagar`), 409);
  const dq = ok(await api('admin', 'GET', '/pedidos/' + q._id));
  ok(await api('admin', 'PUT', `/pedidos/${q._id}/estado`, { estado: 'preparando' }));
  ok(await api('admin', 'PUT', `/pedidos/${q._id}/alistar`, { items: [{ item: dq.items[0]._id, cantidad: 0.9 }] }));
  const cobro = ok(await api('', 'POST', `/publico/seguimiento/${q.seguimiento}/pagar`));
  assert.equal(ok(await api('', 'POST', `/publico/seguimiento/${q.seguimiento}/pagar`))._id, cobro._id);
  ok(await api('admin', 'PUT', `/pedidos/${q._id}/estado`, { estado: 'cancelado', motivo: 'Prueba' }));
  assert.equal((await M('Existencia').findOne({ producto: leche._id }).lean()).reservado, exAntes.reservado);
});

test('turno: arqueo ciego para el cajero y cuadre exacto', async () => {
  const r = ok(await api('caja', 'GET', `/turnos/${ctx.co.t}/resumen`));
  assert.equal(r.ciego, true); assert.equal(r.esperado, undefined);
  const s = ok(await api('sup', 'GET', `/turnos/${ctx.co.t}/resumen`));
  const ventas = await M('Venta').find({ turno: ctx.co.t }).lean();
  const ef = ventas.flatMap(v => v.pagos).filter(p => p.medio === 'efectivo').reduce((a, p) => a + p.monto, 0);
  const dev = (await M('Devolucion').find({ turno: ctx.co.t, medio: 'efectivo' }).lean()).reduce((a, d) => a + d.monto, 0);
  assert.equal(s.esperado.efectivo, 100000 + ef - dev + 34000 + 17168);
  const cajas = ok(await api('caja', 'GET', '/pos/cajas'));
  no(await api('caja', 'POST', '/turnos', { caja: cajas[0]._id, base: 0 }), 409);
  const c = ok(await api('caja', 'POST', `/turnos/${ctx.co.t}/cerrar`, { contado: s.esperado }));
  assert.equal(c.arqueo.diferenciaTotal, 0);
  assert.equal(no(await vender('co', 'caja', [{ producto: ctx.co.p('Arroz')._id, cantidad: 1 }], [{ medio: 'efectivo', monto: 4900 }]), 409).codigo, 'TURNO_CERRADO');
});

test('aislamiento entre empresas, países y roles', async () => {
  no(await api('mx', 'PUT', `/productos/${ctx.co.p('Arroz')._id}`, { precio: 1 }), 404);
  no(await vender('mx', 'mxcaja', [{ producto: ctx.co.p('Arroz')._id, cantidad: 1 }], [{ medio: 'efectivo', monto: 4900 }]), 409);
  no(await api('mx', 'PUT', `/productos/${ctx.mx.p('Arroz')._id}`, { impuesto: 'iva19' }), 400);
  no(await api('mx', 'PUT', '/configuracion', { zonaHoraria: 'America/Bogota' }), 400);
  no(await api('mx', 'PUT', '/facturacion/resolucion', { resolucion: {} }), 409);
  no(await api('caja', 'PUT', `/productos/${ctx.co.p('Arroz')._id}`, { precio: 1 }), 403);
  no(await api('admin', 'GET', '/paises'), 403);
  const paises = ok(await api('super', 'GET', '/paises')).paises;
  const co = paises.find(p => p.codigo === 'CO');
  no(await api('super', 'PUT', '/paises/' + co._id, { decimales: 2 }), 409);
  no(await api('super', 'PUT', '/paises/' + paises.find(p => p.codigo === 'MX')._id, { facturacion: { proveedor: '', ofrecida: true } }), 400);
  ok(await api('super', 'PUT', '/paises/' + paises.find(p => p.codigo === 'CL')._id, { redondeoEfectivo: 10 }));
  const e = ok(await api('super', 'POST', '/empresas', { nombre: 'tienda lima', slug: 'tienda-lima', pais: 'PE', admin: { nombre: 'ana', correo: 'ana@lima.demo', password: 'Segura123' } }));
  assert.deepEqual([e.zonaHoraria, e.nombre], ['America/Lima', 'Tienda Lima']);
  assert.ok(!ok(await api('admin', 'GET', '/usuarios')).some(u => u.rol === 'super'));
});

test('informes, reabastecimiento, compras y exportes', async () => {
  const d = ok(await api('admin', 'GET', '/reportes/dashboard'));
  assert.equal(d.serie.length, 14); assert.ok(d.hoy.total > 0);
  const r = ok(await api('admin', 'GET', '/reportes/ventas'));
  assert.ok(r.productos.length && r.impuestos.length && r.medios.length);
  assert.ok(Array.isArray(ok(await api('admin', 'GET', '/inventario/reabastecer'))));
  assert.ok(ok(await api('admin', 'GET', '/inventario/vencimientos')).length > 0);
  const l = ok(await api('admin', 'GET', '/ventas')); assert.ok(l.total > 5 && l.suma > 0);
  const q = await M('Producto').findOne({ empresa: ctx.co.empresa._id, nombre: /^Arroz/ }).lean();
  const ex = (await M('Existencia').findOne({ producto: q._id }).lean()).cantidad;
  ok(await api('admin', 'POST', '/compras', { sede: ctx.co.sede._id, items: [{ producto: q._id, cantidad: 10, costo: 4000 }] }));
  assert.equal((await M('Existencia').findOne({ producto: q._id }).lean()).cantidad, ex + 10);
  const costo = (await M('Producto').findById(q._id).lean()).costo;
  assert.ok(Math.abs(costo - (ex * q.costo + 40000) / (ex + 10)) < 0.01);
  for (const u of ['/ventas/exportar', '/productos/exportar']) { const x = await fetch(base + u, { headers: { Authorization: 'Bearer ' + tk.admin } }); assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheet/); }
});

test('WhatsApp: módulo por empresa, bandeja, ventana de 24 h, pedido desde el chat, avisos y bolsa', async () => {
  const e = await M('Empresa').findOne({ slug: 'orbita' });
  const H = { 'x-empresa': String(e._id) };
  // Apagado: nada funciona
  assert.equal(no(await api('admin', 'GET', '/whatsapp/resumen'), 403).codigo, 'MODULO_INACTIVO');
  no(await api('admin', 'POST', '/whatsapp/subcuenta'), 403);
  ok(await api('super', 'PUT', `/empresas/${e._id}`, { modulos: { whatsapp: true } }, H));
  const cfg = ok(await api('super', 'POST', '/whatsapp/subcuenta', {}, H));
  assert.deepEqual([cfg.estado, cfg.simulador, cfg.subcuenta], ['subcuenta', true, true]);
  assert.ok(!JSON.stringify(cfg).includes('ACsim'), 'el SID de la subcuenta no sale al comercio');
  ok(await api('admin', 'PUT', '/whatsapp/config', { bienvenida: 'Hola, ya te atendemos' }));

  // Un cliente conocido escribe → conversación en espera, vinculada y con bienvenida
  const { conversacion: id } = ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3010001122', nombre: 'Vale', texto: 'Hola, quiero un domicilio' }));
  let d = ok(await api('admin', 'GET', '/whatsapp/conversaciones/' + id));
  assert.equal(d.estado, 'espera'); assert.equal(d.cliente.nombre, 'Valentina Rojas'); assert.equal(d.telefono, '+573010001122');
  assert.deepEqual(d.mensajes.map(m => m.autor), ['cliente', 'sistema']);
  assert.equal(ok(await api('admin', 'GET', '/whatsapp/resumen')).enEspera, 1);
  // Mismo SID repetido por Twilio: no se duplica
  const gancho = () => fetch(base + `/whatsapp/webhook/${e._id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=whatsapp%3A%2B573010001122&Body=repetido&MessageSid=SMfijo1' });
  for (const r of [await gancho(), await gancho()]) { assert.equal(r.status, 200); assert.match(await r.text(), /<Response>/); }
  assert.equal(await M('Mensaje').countDocuments({ sid: 'SMfijo1' }), 1);

  // Tomar, responder y que otro no pueda tomarla
  ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/tomar`));
  no(await api('sup', 'POST', `/whatsapp/conversaciones/${id}/tomar`), 409);
  const m = ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/mensajes`, { texto: '¡Claro! ¿Qué necesitas?' }));
  assert.equal(m.estado, 'entregado');

  // El cliente comparte ubicación → el asesor crea el pedido desde el chat
  ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3010001122', texto: '', lat: 4.6520, lng: -74.0628, direccion: 'Calle 1' }));
  d = ok(await api('admin', 'GET', '/whatsapp/conversaciones/' + id));
  assert.equal(d.ubicacion.lat, 4.652);
  const leche = ctx.co.p('Leche');
  const ped = ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/pedido`, { items: [{ producto: leche._id, cantidad: 2 }], entrega: { direccion: 'Calle 1', lat: d.ubicacion.lat, lng: d.ubicacion.lng }, medioPago: 'efectivo' }));
  const p = await M('Pedido').findById(ped._id).lean();
  assert.deepEqual([p.canal, p.contacto.telefono, String(p.cliente)], ['whatsapp', '3010001122', d.cliente._id]);
  // Aviso automático dentro de la ventana: texto libre, gratis
  for (let i = 0; i < 40 && !(await M('Mensaje').exists({ conversacion: id, texto: /recibimos tu pedido/i })); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(await M('Mensaje').exists({ conversacion: id, texto: new RegExp(p.numero) }));
  assert.equal((await M('Empresa').findById(e._id).lean()).mensajeria.saldoWhatsapp, 0);

  // Pasadas 24 h: el asesor ya no puede escribir texto libre
  await M('Conversacion').updateOne({ _id: id }, { ultimaEntrante: new Date(Date.now() - 25 * 3600000) });
  assert.equal(no(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/mensajes`, { texto: 'hola?' }), 409).codigo, 'VENTANA_CERRADA');

  // Bolsa: campaña sin saldo se bloquea; aviso de pedido con plantilla consume aunque quede en negativo
  const wa = require('../utils/whatsapp');
  const emp = await M('Empresa').findById(e._id).lean();
  await assert.rejects(wa.enviarPlantilla({ empresa: emp, telefono: '+573010001122', plantilla: 'HX' + '0'.repeat(32), tipo: 'marketing' }), /agotada/);
  no(await api('admin', 'POST', '/whatsapp/bolsa', { whatsapp: 10 }), 403);
  assert.equal(ok(await api('super', 'POST', '/whatsapp/bolsa', { whatsapp: 10, motivo: 'Recarga inicial' }, H)).saldoWhatsapp, 10);
  ok(await api('super', 'PUT', '/whatsapp/numero', { plantillas: { preparando: 'x', en_camino: 'HX' + 'a'.repeat(32) } }, H));
  no(await api('super', 'PUT', '/whatsapp/numero', { plantillas: { entregado: 'no-es-sid' } }, H), 400);
  ok(await api('admin', 'PUT', `/pedidos/${p._id}/estado`, { estado: 'preparando' }));
  ok(await api('admin', 'PUT', `/pedidos/${p._id}/estado`, { estado: 'listo' }));
  const dom = await M('Usuario').findOne({ correo: 'domi@orbita.demo' }).lean();
  ok(await api('admin', 'PUT', `/pedidos/${p._id}/estado`, { estado: 'en_camino', domiciliario: dom._id }));
  for (let i = 0; i < 40 && (await M('Empresa').findById(e._id).lean()).mensajeria.saldoWhatsapp === 10; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await M('Empresa').findById(e._id).lean()).mensajeria.saldoWhatsapp, 9);
  assert.ok(await M('Mensaje').exists({ conversacion: id, plantilla: 'HX' + 'a'.repeat(32) }));
  assert.equal(ok(await api('admin', 'GET', '/whatsapp/movimientos')).length, 2);

  // Otra empresa no ve nada
  no(await api('mx', 'GET', '/whatsapp/conversaciones/' + id), 403);
  ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/cerrar`));
});

test('WhatsApp bot: usa herramientas reales, arma el carrito, crea el pedido y pasa al asesor', async () => {
  // OpenRouter simulado: responde según el último mensaje (guion de herramientas)
  const llamadas = [];
  const ia = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }).on('end', () => {
      const body = JSON.parse(b); llamadas.push(body);
      const ult = body.messages.at(-1), ultUser = [...body.messages].reverse().find(m => m.role === 'user')?.content || '';
      const llamar = (name, args) => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c' + llamadas.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
      const texto = t => ({ choices: [{ message: { content: t } }] });
      let r;
      if (/reclamo/i.test(ultUser)) r = ult.role === 'tool' ? texto('Te comunico con un asesor.') : llamar('pasar_a_asesor', { motivo: 'Reclamo' });
      else if (/confirmo/i.test(ultUser)) r = ult.role === 'tool' ? texto('¡Listo, gracias!') : llamar('confirmar_pedido', { nombre: 'Vale', tipo: 'domicilio', direccion: 'Calle 1', medio_pago: 'efectivo' });
      else if (ult.role === 'user') r = llamar('buscar_productos', { consulta: 'leche' });
      else if (ult.role === 'tool' && JSON.parse(ult.content).resultados) r = llamar('actualizar_carrito', { producto_id: JSON.parse(ult.content).resultados[0].producto_id, cantidad: 2 });
      else r = texto('Agregué 2 leches. ¿Me compartes tu ubicación?');
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
    });
  });
  await new Promise(r => ia.listen(0, r));
  Object.assign(process.env, { OPENROUTER_URL: `http://127.0.0.1:${ia.address().port}`, OPENROUTER_API_KEY: 'prueba' });
  try {
    const e = await M('Empresa').findOne({ slug: 'orbita' });
    ok(await api('admin', 'PUT', '/whatsapp/config', { bot: { activo: true, instrucciones: 'Trata de usted' } }));
    const espera = async f => { for (let i = 0; i < 80; i++) { const x = await f(); if (x) return x; await new Promise(r => setTimeout(r, 50)); } assert.fail('tiempo'); };
    const { conversacion: id } = ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550001', nombre: 'Nuevo', texto: 'Hola, quiero leche' }));
    assert.equal((await M('Conversacion').findById(id).lean()).estado, 'bot');
    await espera(() => M('Mensaje').exists({ conversacion: id, autor: 'bot' }));
    const c1 = await M('Conversacion').findById(id).lean();
    assert.equal(c1.ia.carrito[0].cantidad, 2); assert.match(c1.ia.carrito[0].nombre, /Leche/);
    assert.match(llamadas[0].messages[0].content, /Trata de usted/);
    assert.ok(llamadas[0].tools.some(t => t.function.name === 'confirmar_pedido'));
    // El precio que vio el modelo salió de la base de datos
    assert.match(llamadas[1].messages.at(-1).content, /4\.600/);

    // Comparte ubicación y confirma → pedido real, canal whatsapp, carrito vacío
    ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550001', texto: '', lat: 4.6520, lng: -74.0628 }));
    await espera(async () => (await M('Mensaje').countDocuments({ conversacion: id, autor: 'bot' })) >= 2);
    ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550001', texto: 'Sí, confirmo' }));
    const p = await espera(() => M('Pedido').findOne({ 'contacto.telefono': '3015550001' }).lean());
    assert.deepEqual([p.canal, p.items[0].cantidad, p.historial[0].por], ['whatsapp', 2, 'Asistente de WhatsApp']);
    await espera(async () => (await M('Conversacion').findById(id).lean()).ia.carrito?.length === 0);

    // Reclamo → pasa a la cola del asesor
    ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550001', texto: 'Tengo un reclamo' }));
    await espera(async () => (await M('Conversacion').findById(id).lean()).estado === 'espera');
    assert.ok(await M('Mensaje').exists({ conversacion: id, autor: 'bot', texto: /asesor/ }));
    // Mientras la atiende un asesor, el bot no responde
    ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/tomar`));
    const n = llamadas.length;
    ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550001', texto: 'hola?' }));
    await new Promise(r => setTimeout(r, 200));
    assert.equal(llamadas.length, n);
    // Devolver al bot
    ok(await api('admin', 'POST', `/whatsapp/conversaciones/${id}/bot`));
    assert.equal((await M('Conversacion').findById(id).lean()).estado, 'bot');

    // IA caída → pasa al asesor sin dejar al cliente sin respuesta
    process.env.OPENROUTER_URL = 'http://127.0.0.1:1';
    ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3015550002', texto: 'Hola' }));
    const c2 = await M('Conversacion').findOne({ telefono: '+573015550002' }).lean();
    await espera(async () => (await M('Conversacion').findById(c2._id).lean()).estado === 'espera');
    assert.ok(await M('Mensaje').exists({ conversacion: c2._id, autor: 'bot', texto: /asesor/ }));
    ok(await api('admin', 'PUT', '/whatsapp/config', { bot: { activo: false } }));
  } finally {
    ia.close(); delete process.env.OPENROUTER_URL; delete process.env.OPENROUTER_API_KEY;
  }
});

test('marketing: autorización por canal, plantillas, campañas por lotes, bolsa, bajas y atribución', async () => {
  const e = await M('Empresa').findOne({ slug: 'orbita' });
  const H = { 'x-empresa': String(e._id) };
  const mk = require('../utils/marketing');
  assert.equal(no(await api('admin', 'GET', '/marketing/resumen'), 403).codigo, 'MODULO_INACTIVO');
  ok(await api('super', 'PUT', `/empresas/${e._id}`, { modulos: { marketing: true } }, H));

  // Solo cuenta quien autorizó ese canal
  const [vale, andres] = await Promise.all(['1010101010', '2020202020'].map(async d => (await M('Cliente').findOne({ empresa: e._id, documento: d }).lean())));
  ok(await api('caja', 'PUT', `/clientes/${vale._id}`, { correo: 'vale@ejemplo.co', aceptaDatos: true, marketing: { whatsapp: true, correo: true } }));
  ok(await api('admin', 'PUT', `/clientes/${andres._id}`, { correo: 'andres@ejemplo.co', aceptaDatos: true, marketing: { whatsapp: false, correo: true } }));
  assert.equal((await M('Cliente').findById(vale._id).lean()).marketing.origen, 'caja');
  const seg = (canal, segmento = { tipo: 'todos' }) => api('admin', 'POST', '/marketing/segmento', { canal, segmento }).then(r => ok(r).total);
  assert.equal(await seg('whatsapp'), 1); assert.equal(await seg('correo'), 2);
  assert.equal(await seg('correo', { tipo: 'frecuentes', compras: 100000 }), 0);

  // Plantilla: se le agrega la forma de darse de baja (simulador: queda aprobada)
  const pl = ok(await api('admin', 'POST', '/marketing/plantillas', { nombre: 'Promo Fin de Semana', cuerpo: 'Hola {nombre}, este fin de semana 20% en frutas.' }));
  assert.equal(pl.nombre, 'promo_fin_de_semana'); assert.match(pl.cuerpo, /\{\{1\}\}/); assert.match(pl.cuerpo, /BAJA/);
  no(await api('sup', 'POST', '/marketing/plantillas', { nombre: 'x', cuerpo: 'yyyyyyyyyyyy' }), 403);

  // Campaña de WhatsApp: consume 1 por mensaje
  const saldoW = (await M('Empresa').findById(e._id).lean()).mensajeria.saldoWhatsapp;
  const cw = ok(await api('admin', 'POST', '/marketing/campanas', { nombre: 'Frutas', canal: 'whatsapp', plantilla: pl.contentSid, segmento: { tipo: 'todos' } }));
  assert.equal(ok(await api('admin', 'POST', `/marketing/campanas/${cw._id}/programar`)).destinatarios, 1);
  await mk.procesar(); await mk.procesar();
  let d = ok(await api('admin', 'GET', '/marketing/campanas/' + cw._id));
  assert.deepEqual([d.estado, d.totales.enviados], ['enviada', 1]);
  assert.equal((await M('Empresa').findById(e._id).lean()).mensajeria.saldoWhatsapp, saldoW - 1);
  assert.equal(d.porEstado.entregado, 1);
  assert.ok(await M('Mensaje').exists({ plantilla: pl.contentSid, texto: /Hola Valentina/ }));

  // Correo: sin bolsa no arranca; con poca, se pausa y se reanuda al recargar
  const cc = ok(await api('admin', 'POST', '/marketing/campanas', { nombre: 'Boletín', canal: 'correo', asunto: '{nombre}, ofertas', cuerpo: 'Hola {nombre}:\n\nTenemos *descuentos* esta semana.', segmento: { tipo: 'todos' } }));
  assert.match(no(await api('admin', 'POST', `/marketing/campanas/${cc._id}/programar`), 409).error, /agotada/);
  ok(await api('super', 'POST', '/whatsapp/bolsa', { correo: 1 }, H));
  assert.equal(ok(await api('admin', 'POST', `/marketing/campanas/${cc._id}/programar`)).alcanza, false);
  await mk.procesar(); await mk.procesar();
  d = ok(await api('admin', 'GET', '/marketing/campanas/' + cc._id));
  assert.deepEqual([d.estado, d.totales.enviados], ['pausada', 1]); assert.match(d.motivoPausa, /agotada/);
  ok(await api('super', 'POST', '/whatsapp/bolsa', { correo: 5 }, H));
  ok(await api('admin', 'POST', `/marketing/campanas/${cc._id}/reanudar`));
  await mk.procesar(); await mk.procesar();
  d = ok(await api('admin', 'GET', '/marketing/campanas/' + cc._id));
  assert.deepEqual([d.estado, d.totales.enviados, d.porEstado.enviado], ['enviada', 2, 2]); // correo: sin aviso de entrega
  const correo = mk.armarCorreo(await M('Empresa').findById(e._id).lean(), cc, vale);
  assert.equal(correo.asunto, 'Valentina, ofertas'); assert.match(correo.html, /<b>descuentos<\/b>/); assert.match(correo.html, /Darme de baja/);

  // Baja por WhatsApp
  ok(await api('admin', 'POST', '/whatsapp/simular', { telefono: '3010001122', texto: 'BAJA' }));
  assert.equal((await M('Cliente').findById(vale._id).lean()).marketing.whatsapp, false);
  assert.equal(await seg('whatsapp'), 0);
  assert.ok(await M('Mensaje').exists({ texto: /no te enviaremos más promociones/ }));
  // Baja por el enlace del correo (firma obligatoria)
  const u = new URL(mk.enlaceBaja(andres._id));
  const mala = await fetch(`${base}/marketing/baja?c=${andres._id}&f=${'0'.repeat(32)}`); assert.match(await mala.text(), /no válido/);
  assert.equal((await M('Cliente').findById(andres._id).lean()).marketing.correo, true);
  const buena = await fetch(`${base}/marketing/baja${u.search}`); assert.match(await buena.text(), /Ya no recibirás/);
  assert.equal((await M('Cliente').findById(andres._id).lean()).marketing.correo, false);

  // Atribución: compra de un destinatario después del envío
  const v = { total: 4900 };
  await M('Venta').collection.insertOne({ empresa: e._id, cliente: vale._id, fecha: new Date(Date.now() + 1000), total: v.total, estado: 'completada', uuid: uuid(), numero: 'V-ATRIB' });
  d = ok(await api('admin', 'GET', '/marketing/campanas/' + cw._id));
  assert.equal(d.atribucion.compradores, 1); assert.ok(d.atribucion.total >= v.total);
  no(await api('mx', 'GET', '/marketing/campanas/' + cw._id), 403);
});

test('suscripción: landing → Stripe → alta automática, subdominio, mora, suspensión y bloqueos', async () => {
  const recibidosStripe = [];
  const st = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }).on('end', () => {
      recibidosStripe.push({ u: req.url, body: new URLSearchParams(b), llave: req.headers['idempotency-key'] });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }));
      if (req.url === '/billing_portal/sessions') return res.end(JSON.stringify({ url: 'https://billing.stripe.test/p1' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => st.listen(0, r));
  Object.assign(process.env, { STRIPE_URL: `http://127.0.0.1:${st.address().port}`, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_prueba', DOMINIO_BASE: 'katupos.test' });
  const firmar = cuerpo => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', 'whsec_prueba').update(`${t}.${cuerpo}`).digest('hex')}`; };
  const evento = async (type, object, firma) => { const cuerpo = JSON.stringify({ id: 'evt_' + uuid(), type, data: { object } }); return fetch(base + '/registro/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': firma || firmar(cuerpo) }, body: cuerpo }); };
  try {
    const { planes, modoPrueba } = ok(await api('', 'GET', '/registro/planes'));
    assert.deepEqual(planes.map(p => p.codigo), ['basico', 'pro', 'premium']); assert.equal(modoPrueba, true);
    // Países del registro: la facturación electrónica solo donde Katú la ofrece
    const ps = ok(await api('', 'GET', '/registro/paises'));
    assert.equal(ps.find(p => p.codigo === 'CO').facturacion.ofrecida, true);
    assert.equal(ps.find(p => p.codigo === 'MX').facturacion.ofrecida, false);
    assert.equal(ok(await api('', 'GET', '/registro/subdominio/orbita')).disponible, false);
    assert.equal(ok(await api('', 'GET', '/registro/subdominio/www')).disponible, false);
    assert.deepEqual(ok(await api('', 'GET', '/registro/subdominio/' + encodeURIComponent('Mi Tiénda'))), { subdominio: 'mi-tienda', disponible: true });

    // Checkout: el precio sale del plan de Katú, no del panel de Stripe
    const datos = { plan: 'pro', periodo: 'anual', negocio: 'Mi Tienda', nombre: 'Ana Gómez', correo: 'ana@mitienda.co', pais: 'CO', subdominio: 'mi-tienda' };
    no(await api('', 'POST', '/registro/checkout', { ...datos, correo: 'admin@orbita.demo' }), 409);
    const ck = ok(await api('', 'POST', '/registro/checkout', datos));
    assert.equal(ck.url, 'https://checkout.stripe.test/cs_test_1');
    const p = recibidosStripe.find(r => r.u === '/checkout/sessions').body;
    assert.deepEqual([p.get('mode'), p.get('line_items[0][price_data][unit_amount]'), p.get('line_items[0][price_data][recurring][interval]'), p.get('metadata[registro]')], ['subscription', String(590 * 100), 'year', String(ck.registro)]);
    assert.equal(ok(await api('', 'GET', '/registro/subdominio/mi-tienda')).disponible, false, 'reservado mientras paga');
    assert.equal(ok(await api('', 'GET', '/registro/estado/' + ck.registro)).estado, 'pendiente');

    // Webhook: firma obligatoria; el alta es idempotente
    assert.equal((await evento('checkout.session.completed', {}, 't=1,v1=malo')).status, 400);
    const sesion = { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: String(ck.registro), metadata: { registro: String(ck.registro) } };
    for (let i = 0; i < 2; i++) assert.equal((await evento('checkout.session.completed', sesion)).status, 200);
    assert.equal(await M('Empresa').countDocuments({ slug: 'mi-tienda' }), 1);
    const emp = await M('Empresa').findOne({ slug: 'mi-tienda' }).lean();
    assert.deepEqual([emp.modulos.whatsapp, emp.modulos.domicilios, emp.modulos.marketing, emp.modulos.kiosco], [true, true, false, false]);
    assert.deepEqual([emp.suscripcion.plan, emp.suscripcion.estado, emp.suscripcion.stripeSuscripcion], ['pro', 'activa', 'sub_1']);
    const est = ok(await api('', 'GET', '/registro/estado/' + ck.registro));
    assert.deepEqual([est.estado, est.url], ['listo', 'https://mi-tienda.katupos.test/admin/']);

    // El administrador crea su contraseña con el enlace y entra solo por su subdominio
    const ana = await M('Usuario').findOne({ correo: 'ana@mitienda.co' }).lean();
    const token = await require('../utils/empresas').enlaceClave(ana._id);
    no(await api('', 'POST', '/auth/crear-clave', { token: 'falso', password: 'ClaveNueva123' }), 400);
    ok(await api('', 'POST', '/auth/crear-clave', { token, password: 'ClaveNueva123' }));
    no(await api('', 'POST', '/auth/crear-clave', { token, password: 'OtraClave123' }), 400); // un solo uso
    const login = host => api('', 'POST', '/auth/login', { correo: 'ana@mitienda.co', password: 'ClaveNueva123' }, { 'X-Forwarded-Host': host });
    assert.equal(no(await login('orbita.katupos.test'), 403).codigo, 'OTRO_NEGOCIO');
    tk.ana = ok(await login('mi-tienda.katupos.test')).token;
    ok(await api('', 'POST', '/auth/olvide', { correo: 'noexiste@x.co' }));
    const raiz = await (await fetch(base.replace('/api/v1', '/'), { headers: { 'X-Forwarded-Host': 'mi-tienda.katupos.test' } })).text();
    assert.match(raiz, /tienda\.js/);
    const susc = ok(await api('ana', 'GET', '/cuenta/suscripcion'));
    assert.deepEqual([susc.plan.codigo, susc.administradaPorKatu], ['pro', false]);
    assert.equal(ok(await api('ana', 'POST', '/cuenta/suscripcion/portal')).url, 'https://billing.stripe.test/p1');
    no(await api('ana', 'GET', '/cuenta/planes'), 403);
    assert.equal(ok(await api('super', 'GET', '/cuenta/planes')).length, 3);

    // Cobro fallido → mora → suspensión al vencer la gracia → pago → reactivación
    await evento('invoice.payment_failed', { subscription: 'sub_1' });
    assert.equal((await M('Empresa').findById(emp._id).lean()).suscripcion.estado, 'mora');
    const sus = require('../utils/suscripciones');
    assert.equal(await sus.suspenderVencidas(), 0);
    await M('Empresa').updateOne({ _id: emp._id }, { 'suscripcion.moraDesde': new Date(Date.now() - 30 * 86400000) });
    assert.equal(await sus.suspenderVencidas(), 1);
    assert.match(no(await login('mi-tienda.katupos.test'), 403).error, /falta de pago/);
    no(await api('ana', 'GET', '/cuenta/suscripcion'), 403);
    await evento('invoice.paid', { subscription: 'sub_1', lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } });
    const re = await M('Empresa').findById(emp._id).lean();
    assert.deepEqual([re.estado, re.suscripcion.estado, re.suscripcion.moraDesde], [true, 'activa', undefined]);
    ok(await login('mi-tienda.katupos.test'));
    await evento('customer.subscription.deleted', { id: 'sub_1' });
    assert.deepEqual(await M('Empresa').findById(emp._id).lean().then(x => [x.estado, x.suscripcion.estado]), [false, 'cancelada']);

    // Prueba gratis sin tarjeta: Premium 15 días → avisos → bloqueo → pago → activa
    const info = ok(await api('', 'GET', '/registro/planes')).prueba;
    assert.deepEqual([info.dias, info.plan], [15, 'premium']);
    const dp = { negocio: 'Tienda Prueba', nombre: 'Luis Prieto', correo: 'luis@prueba.co', telefono: '300 111 2233', pais: 'CO', subdominio: 'tienda-prueba' };
    no(await api('', 'POST', '/registro/prueba', { ...dp, telefono: '' }), 400);
    const pr = ok(await api('', 'POST', '/registro/prueba', dp));
    const ep = ok(await api('', 'GET', '/registro/estado/' + pr.registro));
    assert.deepEqual([ep.estado, ep.prueba, ep.diasPrueba], ['listo', true, 15]);
    assert.equal(no(await api('', 'POST', '/registro/prueba', { ...dp, correo: 'otro@prueba.co', subdominio: 'otra-prueba', telefono: '(300) 111-2233' }), 409).codigo, 'PRUEBA_USADA');
    let tp = await M('Empresa').findOne({ slug: 'tienda-prueba' }).lean();
    assert.deepEqual([tp.suscripcion.estado, tp.suscripcion.plan, tp.modulos.kiosco, tp.modulos.marketing, tp.modulos.facturacion], ['prueba', 'premium', true, true, true]);
    assert.ok(Math.abs(new Date(tp.suscripcion.pruebaHasta) - Date.now() - 15 * 86400000) < 60000);
    const fact = require('../utils/facturacion'), paisCo = await require('../utils/contexto').paisPorCodigo('CO');
    assert.equal(fact.activa({ ...tp, facturacion: { activa: true, empresaProveedorId: 'x' } }, paisCo), false, 'sin facturas reales en la prueba');
    const luis = await M('Usuario').findOne({ correo: 'luis@prueba.co' }).lean();
    ok(await api('', 'POST', '/auth/crear-clave', { token: await require('../utils/empresas').enlaceClave(luis._id), password: 'ClaveLuis123' }));
    tk.luis = ok(await api('', 'POST', '/auth/login', { correo: 'luis@prueba.co', password: 'ClaveLuis123' }, { 'X-Forwarded-Host': 'tienda-prueba.katupos.test' })).token;
    const sp = ok(await api('luis', 'GET', '/cuenta/suscripcion'));
    assert.deepEqual([sp.enPrueba, sp.diasRestantes, sp.vencida, sp.planes.length], [true, 15, false, 3]);
    assert.equal(await sus.revisarPruebas(), 0);
    // Faltan 4 días → aviso de 5 días (una sola vez)
    await M('Empresa').updateOne({ _id: tp._id }, { 'suscripcion.pruebaHasta': new Date(Date.now() + 4 * 86400000) });
    assert.equal(await sus.revisarPruebas(), 1); assert.equal(await sus.revisarPruebas(), 0);
    // Vence: aviso final y la cuenta queda en pausa (menos el panel para suscribirse); la tienda se oculta
    await M('Empresa').updateOne({ _id: tp._id }, { 'suscripcion.pruebaHasta': new Date(Date.now() - 1000) });
    assert.equal(await sus.revisarPruebas(), 1);
    tp = await M('Empresa').findById(tp._id).lean();
    assert.deepEqual([tp.suscripcion.estado, tp.suscripcion.avisosPrueba], ['vencida', ['d5', 'fin']]);
    assert.equal(no(await api('luis', 'GET', '/productos'), 402).codigo, 'PRUEBA_VENCIDA');
    ok(await api('luis', 'GET', '/configuracion'));
    assert.equal(ok(await api('luis', 'GET', '/cuenta/suscripcion')).vencida, true);
    no(await api('', 'GET', '/tienda/t/tienda-prueba/catalogo'), 404);
    // Elige plan → Stripe (sin prueba de Stripe) → webhook → activa con los módulos del plan elegido
    assert.equal(ok(await api('luis', 'POST', '/cuenta/suscripcion/checkout', { plan: 'basico', periodo: 'mensual' })).url, 'https://checkout.stripe.test/cs_test_1');
    const pc = recibidosStripe.filter(r => r.u === '/checkout/sessions').pop().body;
    assert.deepEqual([pc.get('metadata[empresa]'), pc.get('metadata[plan]'), pc.get('subscription_data[trial_period_days]')], [String(tp._id), 'basico', null]);
    assert.equal((await evento('checkout.session.completed', { mode: 'subscription', customer: 'cus_2', subscription: 'sub_2', metadata: { empresa: String(tp._id), plan: 'basico', periodo: 'mensual' } })).status, 200);
    tp = await M('Empresa').findById(tp._id).lean();
    assert.deepEqual([tp.suscripcion.estado, tp.suscripcion.plan, tp.suscripcion.stripeSuscripcion, tp.suscripcion.pruebaHasta, tp.modulos.kiosco, tp.modulos.facturacion], ['activa', 'basico', 'sub_2', undefined, false, true]);
    ok(await api('luis', 'GET', '/productos'));
    no(await api('luis', 'POST', '/cuenta/suscripcion/checkout', { plan: 'pro' }), 409);

    // Bloqueos: con dos contenedores, una tarea corre una sola vez
    const { conBloqueo } = require('../utils/bloqueo');
    let corridas = 0;
    const tarea = () => conBloqueo('prueba', 5000, async () => { corridas++; await new Promise(r => setTimeout(r, 50)); });
    const rs = await Promise.all([tarea(), tarea(), tarea()]);
    assert.equal(corridas, 1); assert.equal(rs.filter(Boolean).length, 1);
    assert.equal(await tarea(), true, 'se libera al terminar');
  } finally {
    st.close(); ['STRIPE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'DOMINIO_BASE'].forEach(k => { process.env[k] = ''; });
  }
});
