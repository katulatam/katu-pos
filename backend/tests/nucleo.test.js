const test = require('node:test');
const assert = require('node:assert');
const M = require('../../frontend/assets/js/motor');
const B = require('../../frontend/assets/js/bascula');
const G = require('../utils/geo');

test('el motor de la app es idéntico al de la caja', () => {
  const fs = require('fs'), path = require('path');
  const r = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  assert.equal(r('mobile/src/utils/motor.js'), r('frontend/assets/js/motor.js'));
});

const ahora = { fecha: '2026-11-25', hora: '10:00', dia: 3 };
const L = (x) => ({ producto: 'p1', cantidad: 1, precioUnitario: 1000, impuestoTipo: 'iva', impuestoPct: 19, ...x });

test('motor: base + impuesto siempre suma el total, con 0 y 2 decimales', () => {
  for (const decimales of [0, 2]) for (const precio of [1, 99, 19.9, 3333, 12345.67]) for (const cantidad of [1, 3, 0.755, 12.333]) for (const pct of [0, 5, 8, 16, 19]) {
    const r = M.calcular([L({ precioUnitario: precio, cantidad, impuestoPct: pct }), L({ precioUnitario: precio, impuestoPct: pct })], { ahora, decimales, descuentoGlobal: 1.37 });
    assert.ok(M.igual(r.base + r.impuesto, r.total, decimales));
    assert.ok(M.igual(M.sumar(r.lineas.map(l => l.total), decimales), r.total, decimales));
    assert.equal(r.total, M.redondear(r.total, decimales));
  }
});

test('motor: Colombia no genera decimales y México sí', () => {
  assert.equal(M.calcular([L({ precioUnitario: 3990, cantidad: 0.755 })], { ahora, decimales: 0 }).total, 3012);
  assert.equal(M.calcular([L({ precioUnitario: 39.9, cantidad: 0.755, impuestoPct: 16 })], { ahora, decimales: 2 }).total, 30.12);
  assert.equal(M.redondear(1.005, 2), 1.01);
});

test('motor: el descuento global se prorratea sin perder un peso', () => {
  const r = M.calcular([L({ precioUnitario: 3333 }), L({ producto: 'p2', precioUnitario: 3333, impuestoPct: 5 }), L({ producto: 'p3', precioUnitario: 3334, impuestoPct: 0 })], { ahora, descuentoGlobal: 1000 });
  assert.equal(r.total, 9000);
  assert.equal(r.lineas.reduce((a, l) => a + l.descuentoGlobal, 0), 1000);
});

test('motor: el descuento nunca deja la venta negativa', () => {
  const r = M.calcular([L({})], { ahora, descuentoGlobal: 99999 });
  assert.equal(r.total, 0);
  assert.equal(r.lineas[0].impuesto, 0);
  assert.equal(M.calcular([L({ descuentoManual: -500 })], { ahora, descuentoGlobal: -500 }).total, 1000);
});

test('motor: promociones porcentaje, 3x2 y precio; gana la mejor', () => {
  const promos = [
    { _id: 'a', activo: true, nombre: '10%', tipo: 'porcentaje', valor: 10, alcance: 'todo' },
    { _id: 'b', activo: true, nombre: '3x2', tipo: 'nxm', lleva: 3, paga: 2, alcance: 'producto', objetivos: ['p1'] },
  ];
  const r = M.calcular([L({ cantidad: 7 })], { ahora, promociones: promos });
  assert.equal(r.lineas[0].promocion.nombre, '3x2');
  assert.equal(r.total, 5000);
  const r2 = M.calcular([L({ cantidad: 2 })], { ahora, promociones: promos });
  assert.equal(r2.lineas[0].promocion.nombre, '10%');
  assert.equal(r2.total, 1800);
  assert.equal(M.calcular([L({ cantidad: 2 })], { ahora, promociones: [{ activo: true, tipo: 'precio', valor: 700, alcance: 'todo' }] }).total, 1400);
});

test('motor: promoción fuera de horario o de día no aplica', () => {
  const p = { activo: true, tipo: 'porcentaje', valor: 50, alcance: 'todo', dias: [1], nombre: 'x' };
  assert.equal(M.calcular([L({})], { ahora, promociones: [p] }).total, 1000);
  assert.equal(M.calcular([L({})], { ahora, promociones: [{ ...p, dias: [3], horaDesde: '11:00' }] }).total, 1000);
});

test('motor: etiqueta EAN-13 de báscula por peso y por precio según decimales', () => {
  const doce = '200012301250';
  const c = doce + M.digitoEan13(doce);
  assert.deepEqual(M.leerEtiquetaPeso(c, { prefijos: ['20'] }), { plu: '00123', peso: 1.25 });
  assert.deepEqual(M.leerEtiquetaPeso(c, { prefijos: ['20'], contenido: 'precio', decimales: 0 }), { plu: '00123', precio: 1250 });
  assert.deepEqual(M.leerEtiquetaPeso(c, { prefijos: ['20'], contenido: 'precio', decimales: 2 }), { plu: '00123', precio: 12.5 });
  assert.equal(M.leerEtiquetaPeso('7702004003508', { prefijos: ['20'] }), null);
});

test('motor: redondeo del efectivo', () => {
  assert.equal(M.redondearEfectivo(12345, 50, 0), 12350);
  assert.equal(M.redondearEfectivo(12.34, 0.5, 2), 12.5);
  assert.equal(M.redondearEfectivo(12.34, 0, 2), 12.34);
});

test('báscula: interpreta formatos comunes', () => {
  const c = B.PERFILES.continua;
  assert.equal(B.interpretar('ST,GS,+  1.250kg', c).kg, 1.25);
  assert.equal(B.interpretar('US,GS,+  1.250kg', c).inestable, true);
  assert.equal(B.interpretar('\x02 0,755 kg', c).kg, 0.755);
  assert.equal(B.interpretar('  850 g', c).kg, 0.85);
  assert.equal(B.interpretar('01250', { ...c, divisor: 1000 }).kg, 1.25);
  assert.equal(B.interpretar('ERROR', c), null);
});

test('báscula: solo es estable tras varias lecturas iguales, con tramas partidas', () => {
  const out = [];
  const l = new B.Lector({ ...B.PERFILES.continua, lecturas: 3 }, x => out.push(x));
  const enviar = s => l.recibir(Uint8Array.from(s, c => c.charCodeAt(0)));
  enviar('1.200 k'); enviar('g\r\n1.24'); enviar('8 kg\r\n1.250 kg\r\n1.250 kg\r\n');
  assert.deepEqual(out.map(o => o.estable), [false, false, false, false]); // 1.248 está dentro de la tolerancia, 1.200 no
  enviar('1.250 kg\r\n');
  assert.equal(out.at(-1).estable, true);
  enviar('0.000 kg\r\n');
  assert.equal(out.at(-1).estable, false);
});

test('báscula: convierte comandos escritos', () => {
  assert.deepEqual([...B.aBytes('W\\r')], [87, 13]);
  assert.deepEqual([...B.aBytes('\\x05')], [5]);
});

test('geocerca: radio, polígono, tarifa y envío gratis', () => {
  const tienda = { lat: 4.6486, lng: -74.0628 };
  const radio = { _id: 'r', activo: true, tipo: 'radio', centro: tienda, radioM: 2000, tarifaBase: 3000, kmIncluidos: 1, tarifaKm: 1000, gratisDesde: 80000 };
  const cerca = { lat: 4.6576, lng: -74.0628 }; // ~1 km al norte
  const lejos = { lat: 4.70, lng: -74.0628 };
  const c = G.cotizar([radio], cerca);
  assert.ok(Math.abs(c.distancia - 1001) < 5);
  assert.ok(c.tarifa >= 3000 && c.tarifa < 3010);
  assert.equal(G.cotizar([radio], lejos), null);
  assert.equal(G.cotizar([radio], cerca, { totalProductos: 80000 }).tarifa, 0);
  const pol = { _id: 'p', activo: true, tipo: 'poligono', origen: tienda, tarifaBase: 2000, poligono: [{ lat: 4.69, lng: -74.07 }, { lat: 4.71, lng: -74.07 }, { lat: 4.71, lng: -74.05 }, { lat: 4.69, lng: -74.05 }] };
  assert.equal(G.cotizar([radio, pol], lejos).zona._id, 'p');
  assert.equal(G.cotizar([radio], { lat: null, lng: null }), null);
});
