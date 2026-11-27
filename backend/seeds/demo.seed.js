// Datos demo (solo base en memoria): un minimarket en Colombia y uno en México.
const crypto = require('crypto');
const M = n => require(`../models/${n}`);
const { paisPorCodigo } = require('../utils/contexto');

const CLAVE = 'Demo2026*';

async function tienda({ nombre, slug, pais, ciudad, direccion, ubicacion, correo, productos, escala }) {
  const p = await paisPorCodigo(pais);
  const empresa = await M('Empresa').create({ nombre, razonSocial: `${nombre} SAS`, idFiscal: '900000000-0', slug, pais, zonaHoraria: p.zonaHoraria, ciudad, direccion, telefono: '3000000000', modulos: { kiosco: true }, gamificacion: { montoPorPunto: 1000 * escala, valorPunto: 10 * escala, metaDiariaCajero: 1500000 * escala, ruleta: { compraMinima: 20000 * escala } } });
  const e = empresa._id;
  const sede = await M('Sede').create({ empresa: e, nombre: 'Principal', direccion, ciudad, ubicacion });
  await M('Caja').create([{ empresa: e, sede: sede._id, nombre: 'Caja 1' }, { empresa: e, sede: sede._id, nombre: 'Caja 2' }, { empresa: e, sede: sede._id, nombre: 'Kiosco autopago', tipo: 'autopago' }]);
  const u = (n, rol, pre, extra) => M('Usuario').create({ nombre: n, correo: `${pre}@${correo}`, password: CLAVE, rol, empresa: e, ...extra });
  await u('Laura Admin', 'admin', 'admin', { pin: '2580' });
  const cajero = await u('Camilo Cajero', 'cajero', 'caja');
  await u('Sara Supervisora', 'supervisor', 'super', { pin: '1234' });
  await u('Beto Bodega', 'bodega', 'bodega');
  await u('Dani Domicilios', 'domiciliario', 'domi', { vehiculo: 'Moto ABC12D', telefono: '3001112233', disponible: true });

  const cats = {};
  for (const [i, [n, icono, color]] of [['Bebidas', 'fa-bottle-water', '#05C3DD'], ['Frutas y verduras', 'fa-carrot', '#22C55E'], ['Lácteos', 'fa-cheese', '#F59E0B'], ['Panadería', 'fa-bread-slice', '#D97706'], ['Snacks', 'fa-cookie-bite', '#EC4899'], ['Despensa', 'fa-jar', '#8B5CF6'], ['Aseo', 'fa-soap', '#3B82F6'], ['Carnes frías', 'fa-drumstick-bite', '#EF4444']].entries()) cats[n] = await M('Categoria').create({ empresa: e, nombre: n, icono, color, orden: i });
  const prov = await M('Proveedor').create({ empresa: e, nombre: 'Distribuidora Central', telefono: '3004445566', diasEntrega: 2 });
  const creados = [];
  for (const [n, cat, tipo, precio, imp, codigo, plu, fav] of productos) {
    creados.push(await M('Producto').create({ empresa: e, nombre: n, categoria: cats[cat]._id, tipo, precio: Math.round(precio * escala * 100) / 100, costo: Math.round(precio * escala * 70) / 100, impuesto: imp, codigo, plu, favorito: !!fav, minimo: 6, proveedor: prov._id, manejaVencimiento: cat === 'Lácteos', ...(codigo === '7700000000017' && { presentaciones: [{ nombre: 'Six pack', codigo: '7700000000994', factor: 6, precio: Math.round(precio * escala * 5.5 * 100) / 100 }] }) }));
  }
  await M('Existencia').insertMany(creados.map((x, i) => ({ empresa: e, sede: sede._id, producto: x._id, cantidad: i % 9 === 4 ? 3 : 40 + (i * 7) % 60 })));
  const hoy = new Date();
  await M('Lote').insertMany(creados.filter(x => x.manejaVencimiento).map((x, i) => ({ empresa: e, sede: sede._id, producto: x._id, codigo: `L${i + 1}`, vence: new Date(hoy.getTime() + (i * 6 - 2) * 86400000).toISOString().slice(0, 10), cantidad: 20, restante: 12 })));
  await M('Promocion').create([
    { empresa: e, nombre: 'Snacks 3x2', tipo: 'nxm', lleva: 3, paga: 2, alcance: 'categoria', objetivos: [cats.Snacks._id] },
    { empresa: e, nombre: 'Frutas −10%', tipo: 'porcentaje', valor: 10, alcance: 'categoria', objetivos: [cats['Frutas y verduras']._id] },
  ]);
  await M('Mision').create([
    { empresa: e, nombre: 'Triple visita', descripcion: 'Compra 3 veces esta semana', tipo: 'compras', meta: 3, ciclo: 'semana', premioPuntos: 60, icono: 'fa-bolt' },
    { empresa: e, nombre: 'Fruta power', descripcion: 'Lleva 3 kg de frutas y verduras', tipo: 'categoria', objetivo: cats['Frutas y verduras']._id, meta: 3, ciclo: 'semana', premioPuntos: 40, icono: 'fa-carrot' },
    { empresa: e, nombre: 'Desde tu sofá', descripcion: 'Pide 2 domicilios este mes', tipo: 'domicilios', meta: 2, ciclo: 'mes', premioPuntos: 80, icono: 'fa-motorcycle' },
  ]);
  await M('Recompensa').create([
    { empresa: e, nombre: 'Descuento ligero', puntos: 100, descuento: 1500 * escala, icono: 'fa-tag' },
    { empresa: e, nombre: 'Descuento turbo', puntos: 400, descuento: 8000 * escala, icono: 'fa-rocket', nivelMinimo: 'Voltio' },
  ]);
  const doc = p.tiposDocumento[0].codigo;
  const clientes = await M('Cliente').create([
    { empresa: e, nombre: 'Valentina Rojas', tipoDocumento: doc, documento: '1010101010', telefono: '3010001122', puntos: 320, xp: 780, compras: 14, cupo: 100000 * escala, aceptaDatos: true },
    { empresa: e, nombre: 'Andrés Peña', tipoDocumento: doc, documento: '2020202020', telefono: '3020003344', puntos: 90, xp: 140, compras: 3, aceptaDatos: true },
  ]);
  await M('Zona').create([
    { empresa: e, sede: sede._id, nombre: 'Barrio', tipo: 'radio', centro: ubicacion, radioM: 1500, tarifaBase: 3000 * escala, minutos: 25, gratisDesde: 80000 * escala, prioridad: 0, color: '#22C55E' },
    { empresa: e, sede: sede._id, nombre: 'Extendida', tipo: 'radio', centro: ubicacion, radioM: 4000, tarifaBase: 4000 * escala, kmIncluidos: 1.5, tarifaKm: 1200 * escala, minutos: 45, pedidoMinimo: 25000 * escala, prioridad: 1, color: '#05C3DD' },
  ]);

  // Historia: 14 días de ventas por el mismo camino que la caja
  const ventas = require('../utils/ventas');
  const caja = await M('Caja').findOne({ empresa: e }).lean();
  const emp = await M('Empresa').findById(e).lean();
  const Motor = require('../../frontend/assets/js/motor');
  let semilla = 7; const azar = n => { semilla = (semilla * 16807) % 2147483647; return semilla % n; };
  const turnoViejo = await M('Turno').create({ empresa: e, sede: sede._id, caja: caja._id, cajero: cajero._id, base: 100000 * escala, estado: 'cerrado', abiertoEn: new Date(Date.now() - 14 * 86400000), cerradoEn: new Date(Date.now() - 86400000) });
  for (let d = 13; d >= 0; d--) {
    const n = 4 + azar(5);
    for (let k = 0; k < n; k++) {
      const fecha = new Date(Date.now() - d * 86400000 - azar(8 * 3600) * 1000);
      const items = Array.from({ length: 1 + azar(4) }, () => creados[azar(creados.length)]).filter((x, i, a) => a.indexOf(x) === i).map(x => ({ producto: String(x._id), cantidad: x.tipo === 'peso' ? (300 + azar(1500)) / 1000 : 1 + azar(3), precioUnitario: x.precio, descuento: 0 }));
      const { lineas } = await ventas.armarLineas({ empresa: emp, pais: p, items, congelado: true });
      const c = Motor.calcular(lineas, { decimales: p.decimales, ahora: Motor.ahoraEnZona(emp.zonaHoraria, fecha) });
      const total = emp.pos.redondearEfectivo ? Motor.redondearEfectivo(c.total, p.redondeoEfectivo, p.decimales) : c.total;
      const medio = k % 3 === 1 ? 'datafono' : 'efectivo';
      await ventas.crear({ empresa: emp, pais: p, sede: sede.toObject(), caja, turno: turnoViejo, cajero: cajero.toObject(), body: { uuid: crypto.randomUUID(), offline: true, fecha, items, cliente: k % 3 === 0 ? String(clientes[k % 2]._id) : undefined, pagos: [{ medio, monto: medio === 'efectivo' ? total : c.total }] } });
    }
  }
  await M('Venta').updateMany({ empresa: e }, { offline: false, diferenciaPrecio: false });
  return empresa;
}

exports.sembrarDemo = async () => {
  if (await M('Empresa').exists({})) return;
  const cat = (a, b, ex) => [
    ['Gaseosa Cola 400 ml', 'Bebidas', 'unidad', 3200, a, '7700000000017', '', 1], ['Agua sin gas 600 ml', 'Bebidas', 'unidad', 2400, a, '7700000000024', '', 1],
    ['Jugo de mango 1 L', 'Bebidas', 'unidad', 5900, a, '7700000000031'], ['Té frío limón', 'Bebidas', 'unidad', 3500, a, '7700000000048'],
    ['Cerveza lata 330 ml', 'Bebidas', 'unidad', 3800, a, '7700000000055'], ['Vino tinto 750 ml', 'Bebidas', 'unidad', 42000, a, '7700000000062'],
    ['Banano', 'Frutas y verduras', 'peso', 3200, ex, '', '00101', 1], ['Tomate chonto', 'Frutas y verduras', 'peso', 4800, ex, '', '00102', 1], ['Papa pastusa', 'Frutas y verduras', 'peso', 3600, ex, '', '00103', 1], ['Aguacate', 'Frutas y verduras', 'peso', 9800, ex, '', '00104'], ['Cebolla roja', 'Frutas y verduras', 'peso', 4200, ex, '', '00105'], ['Limón', 'Frutas y verduras', 'peso', 5200, ex, '', '00106'],
    ['Leche entera 1 L', 'Lácteos', 'unidad', 4600, ex, '7700000000109', '', 1], ['Yogur fresa 200 g', 'Lácteos', 'unidad', 3100, a, '7700000000116'], ['Queso campesino', 'Lácteos', 'peso', 24000, ex, '', '00201'], ['Huevos x12', 'Lácteos', 'unidad', 9800, ex, '7700000000123', '', 1],
    ['Pan tajado', 'Panadería', 'unidad', 6900, b, '7700000000208'], ['Croissant', 'Panadería', 'unidad', 2800, b, '7700000000215', '', 1], ['Arepa x5', 'Panadería', 'unidad', 4500, ex, '7700000000222'],
    ['Papas fritas 105 g', 'Snacks', 'unidad', 5400, a, '7700000000307', '', 1], ['Chocolatina', 'Snacks', 'unidad', 2200, a, '7700000000314'], ['Maní salado', 'Snacks', 'unidad', 3300, a, '7700000000321'], ['Galletas avena', 'Snacks', 'unidad', 4100, a, '7700000000338'],
    ['Arroz 1 kg', 'Despensa', 'unidad', 4900, ex, '7700000000406', '', 1], ['Aceite girasol 900 ml', 'Despensa', 'unidad', 11200, a, '7700000000413'], ['Pasta espagueti 500 g', 'Despensa', 'unidad', 3900, b, '7700000000420'], ['Café molido 250 g', 'Despensa', 'unidad', 13500, b, '7700000000437', '', 1], ['Azúcar 1 kg', 'Despensa', 'unidad', 4700, b, '7700000000444'],
    ['Detergente 1 kg', 'Aseo', 'unidad', 12900, a, '7700000000505'], ['Jabón de loza', 'Aseo', 'unidad', 5600, a, '7700000000512'], ['Papel higiénico x4', 'Aseo', 'unidad', 8900, a, '7700000000529'],
    ['Jamón de cerdo', 'Carnes frías', 'peso', 28000, a, '', '00301'], ['Salchicha x8', 'Carnes frías', 'unidad', 9200, a, '7700000000604'],
  ];
  await tienda({ nombre: 'Minimarket Órbita', slug: 'orbita', pais: 'CO', ciudad: 'Bogotá', direccion: 'Calle 63 # 11-20', ubicacion: { lat: 4.6486, lng: -74.0628 }, correo: 'orbita.demo', productos: cat('iva19', 'iva5', 'excluido'), escala: 1 });
  await tienda({ nombre: 'Abarrotes Nova', slug: 'nova', pais: 'MX', ciudad: 'Ciudad de México', direccion: 'Av. Insurgentes Sur 100', ubicacion: { lat: 19.4270, lng: -99.1677 }, correo: 'nova.demo', productos: cat('iva16', 'iva0', 'iva0'), escala: 0.005 });
  console.log(`Demo lista: admin@orbita.demo / caja@orbita.demo / domi@orbita.demo · admin@nova.demo / caja@nova.demo (clave ${CLAVE})`);
};
