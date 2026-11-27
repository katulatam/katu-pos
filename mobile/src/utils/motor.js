/* motor.js — Motor de precios de Katú POS.
 * Es EL MISMO archivo en la caja (navegador, también sin internet), en la
 * tienda en línea y en el servidor (require desde backend/utils). Así lo que
 * ve el cajero es exactamente lo que el servidor cobra y factura.
 *
 * Precios con impuesto incluido. Los decimales de la moneda dependen del país
 * (COP 0, MXN 2…): por dentro se calcula en unidades menores enteras
 * (centavos) para que nunca se pierda ni aparezca un centavo por redondeo.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Motor = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
  const decimalesDe = d => (Number.isInteger(d) && d >= 0 && d <= 4 ? d : 0);
  // Redondeo a los decimales de la moneda (toPrecision evita 1.005 → 1.00)
  const redondear = (n, dec) => {
    const f = 10 ** decimalesDe(dec);
    return Math.round(Number(((Number(n) || 0) * f).toPrecision(15))) / f;
  };
  const aMenor = (n, dec) => Math.round(Number(((Number(n) || 0) * 10 ** decimalesDe(dec)).toPrecision(15)));
  const deMenor = (n, dec) => Number((n / 10 ** decimalesDe(dec)).toFixed(decimalesDe(dec)));

  // ── Códigos de barras ────────────────────────────────────────────────────
  function digitoEan13(doce) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(doce[i]) * (i % 2 ? 3 : 1);
    return String((10 - (s % 10)) % 10);
  }
  const ean13Valido = c => /^\d{13}$/.test(c) && digitoEan13(c) === c[12];

  // Etiqueta impresa por una báscula etiquetadora: PP IIIII VVVVV C
  //   PP    prefijo (20–29, configurable por empresa)
  //   IIIII PLU del producto
  //   VVVVV peso en gramos, o precio en la unidad menor de la moneda
  function leerEtiquetaPeso(codigo, cfg) {
    const c = String(codigo || '').trim();
    const op = cfg || {};
    const prefijos = op.prefijos && op.prefijos.length ? op.prefijos : ['20', '21', '22'];
    if (!ean13Valido(c) || !prefijos.includes(c.slice(0, 2))) return null;
    const plu = c.slice(2, 7);
    const valor = Number(c.slice(7, 12));
    return op.contenido === 'precio'
      ? { plu, precio: deMenor(valor, op.decimales) }
      : { plu, peso: r3(valor / 1000) };
  }


  // ── Promociones ──────────────────────────────────────────────────────────
  // `ahora`: { fecha:'YYYY-MM-DD', hora:'HH:mm', dia:0..6 } en la zona de la empresa.
  function promoVigente(p, ahora) {
    if (!p.activo) return false;
    if (p.desde && ahora.fecha < p.desde) return false;
    if (p.hasta && ahora.fecha > p.hasta) return false;
    if (p.dias && p.dias.length && !p.dias.includes(ahora.dia)) return false;
    if (p.horaDesde && ahora.hora < p.horaDesde) return false;
    if (p.horaHasta && ahora.hora > p.horaHasta) return false;
    return true;
  }
  function promoAplica(p, linea) {
    if (p.alcance === 'todo') return true;
    const ids = (p.objetivos || []).map(String);
    if (p.alcance === 'categoria') return ids.includes(String(linea.categoria || ''));
    return ids.includes(String(linea.producto));
  }
  // Descuento (en unidades menores) que una promoción le da a una línea
  function valorPromo(p, linea, bruto, dec) {
    if (p.tipo === 'porcentaje') return Math.round(bruto * Math.min(100, Math.max(0, p.valor)) / 100);
    if (p.tipo === 'precio') return Math.max(0, bruto - aMenor(p.valor * linea.cantidad, dec));
    if (p.tipo === 'nxm') { // lleva N paga M (solo unidades enteras)
      const n = Number(p.lleva) || 0, m = Number(p.paga) || 0;
      if (n <= m || n < 1 || linea.porPeso) return 0;
      return aMenor(Math.floor(linea.cantidad / n) * (n - m) * linea.precioUnitario, dec);
    }
    return 0;
  }

  // ── Cálculo de la venta ──────────────────────────────────────────────────
  // lineas: [{ producto, categoria, nombre, cantidad, precioUnitario, porPeso,
  //            impuestoTipo, impuestoPct, descuentoManual }]
  // opciones: { decimales, promociones, ahora, descuentoGlobal, descuentoPuntos, domicilio }
  // Los descuentos globales se prorratean entre las líneas (bajan la base
  // gravable) y el residuo del redondeo se reparte, de modo que la suma de las
  // líneas SIEMPRE es igual al total cobrado.
  function calcular(lineas, opciones) {
    const op = opciones || {};
    const dec = decimalesDe(op.decimales);
    const promos = (op.promociones || []).filter(p => promoVigente(p, op.ahora || {}));
    const sal = lineas.map(l => {
      const cantidad = r3(l.cantidad);
      // brutoFijo: etiqueta de báscula con el precio ya impreso
      const bruto = aMenor(l.brutoFijo != null ? l.brutoFijo : l.precioUnitario * cantidad, dec);
      let promo = null, dPromo = 0;
      for (const p of promos) {
        if (!promoAplica(p, l)) continue;
        const d = Math.min(bruto, valorPromo(p, { ...l, cantidad }, bruto, dec));
        if (d > dPromo) { dPromo = d; promo = p; } // gana la mejor para el cliente; no se acumulan
      }
      const dManual = Math.min(bruto - dPromo, Math.max(0, aMenor(l.descuentoManual, dec)));
      return { l, cantidad, bruto, promo, dPromo, dManual, dGlobal: 0, neto: bruto - dPromo - dManual };
    });

    const netoLineas = sal.reduce((a, x) => a + x.neto, 0);
    const pedido = Math.max(0, aMenor(op.descuentoGlobal, dec)) + Math.max(0, aMenor(op.descuentoPuntos, dec));
    const global = Math.min(netoLineas, pedido);
    if (global > 0) {
      let resto = global;
      sal.forEach(x => { x.dGlobal = Math.floor(global * x.neto / netoLineas); resto -= x.dGlobal; });
      for (const x of [...sal].sort((a, b) => b.neto - a.neto)) {
        if (resto <= 0) break;
        const cabe = Math.min(resto, x.neto - x.dGlobal);
        x.dGlobal += cabe; resto -= cabe;
      }
    }

    const T = { subtotal: 0, descuento: 0, base: 0, impuesto: 0, total: 0 };
    const tarifas = {};
    const v = n => deMenor(n, dec);
    const salida = sal.map(x => {
      const { l } = x;
      const total = x.neto - x.dGlobal;
      const descuento = x.dPromo + x.dManual + x.dGlobal;
      const pct = l.impuestoTipo === 'excluido' ? 0 : Math.max(0, Number(l.impuestoPct) || 0);
      const base = pct ? Math.round(total * 100 / (100 + pct)) : total;
      const impuesto = total - base;
      T.subtotal += x.bruto; T.descuento += descuento; T.base += base; T.impuesto += impuesto; T.total += total;
      const k = l.impuestoTipo === 'excluido' ? 'Excluido' : `${String(l.impuestoTipo || 'iva').toUpperCase()} ${pct}%`;
      tarifas[k] = tarifas[k] || { base: 0, impuesto: 0 };
      tarifas[k].base += base; tarifas[k].impuesto += impuesto;
      return {
        ...l, cantidad: x.cantidad, bruto: v(x.bruto),
        promocion: x.promo ? { id: x.promo._id, nombre: x.promo.nombre } : null,
        descuentoPromo: v(x.dPromo), descuentoManual: v(x.dManual), descuentoGlobal: v(x.dGlobal),
        descuento: v(descuento), total: v(total), base: v(base), impuesto: v(impuesto), impuestoPct: pct,
      };
    });
    const domicilio = Math.max(0, aMenor(op.domicilio, dec));
    return {
      lineas: salida, decimales: dec,
      subtotal: v(T.subtotal), descuento: v(T.descuento), base: v(T.base), impuesto: v(T.impuesto),
      totalProductos: v(T.total), domicilio: v(domicilio), total: v(T.total + domicilio),
      porTarifa: Object.fromEntries(Object.entries(tarifas).map(([k, t]) => [k, { base: v(t.base), impuesto: v(t.impuesto) }])),
    };
  }

  // Redondeo del efectivo a la moneda más pequeña en uso (50, 100, 0.05…)
  function redondearEfectivo(valor, multiplo, dec) {
    const m = Number(multiplo) || 0;
    return m > 0 ? redondear(Math.round(valor / m) * m, dec) : redondear(valor, dec);
  }

  // Suma/compara dinero sin ruido de coma flotante
  const sumar = (lista, dec) => deMenor(lista.reduce((a, n) => a + aMenor(n, dec), 0), dec);
  const igual = (a, b, dec) => aMenor(a, dec) === aMenor(b, dec);

  // Fecha/hora/día locales de una zona horaria, para evaluar promociones
  function ahoraEnZona(zona, fecha) {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona || 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(fecha || new Date()).forEach(x => { p[x.type] = x.value; });
    return {
      fecha: `${p.year}-${p.month}-${p.day}`,
      hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`,
      dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    };
  }

  // Formato de dinero según el país: { moneda, locale, decimales }
  function dinero(n, pais) {
    const p = pais || {};
    const d = decimalesDe(p.decimales);
    try {
      return new Intl.NumberFormat(p.locale || 'es-CO', { style: 'currency', currency: p.moneda || 'COP', currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);
    } catch (_) { return (p.simbolo || '$') + (Number(n) || 0).toFixed(d); }
  }

  return { r3, redondear, aMenor, deMenor, sumar, igual, ean13Valido, digitoEan13, leerEtiquetaPeso, promoVigente, calcular, redondearEfectivo, ahoraEnZona, dinero };
});
