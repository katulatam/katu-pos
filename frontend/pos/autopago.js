/* autopago.js — el cliente escanea, (pesa) y paga solo.
 * Pasos: inicio → compra → pago → listo. Un colaborador abre el autopago una vez
 * (abre el turno) y queda en modo cliente; para salir o quitar productos se pide
 * PIN de supervisor. Solo se aceptan pagos que confirma un equipo (QR, datáfono
 * integrado o kiosco de efectivo): el servidor rechaza cualquier otro.
 */
(function () {
  'use strict';
  const idCaja = localStorage.getItem('katu_pos_caja');
  if (!sesion.token || !idCaja) { location.replace('index.html'); return; }

  const INACTIVO_S = 75, AVISO_S = 20, LISTO_S = 14;
  let D = null, idx = {}, V = nueva(), paso = 'inicio', enLinea = true;
  let cobro = null, medio = null, sondeo = null, consultando = false, enviando = false;
  let ultimaAccion = Date.now(), avisoInactivo = null, tListo = null;

  function nueva() { return { lineas: [], cliente: null, adquiriente: null, pagos: [], uuid: null }; }
  const $$ = n => Motor.dinero(n, D.pais);
  const fq = (n, peso) => (peso ? Number(n).toLocaleString(D.pais.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : Number(n).toLocaleString(D.pais.locale));
  const vista = html => { $('apVista').innerHTML = html; };
  const guardar = () => bd.guardar('autopago:' + idCaja, JSON.parse(JSON.stringify(V))).catch(() => {});
  let audio;
  function sonido(ok) { try { audio = audio || new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = ok ? 1180 : 220; g.gain.setValueAtTime(.06, audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + (ok ? .1 : .35)); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .35); } catch {} }

  // ── Arranque ─────────────────────────────────────────────────────────────
  async function iniciar() {
    const r = await api('/pos/arranque/' + idCaja);
    if (r.http === 401) return sesion.salir();
    if (!r.success) { toast(r.error, 'mal'); return setTimeout(() => location.replace('index.html'), 2200); }
    D = r.data;
    if (D.caja.tipo !== 'autopago') return location.replace('caja.html');
    indexar();
    $('ap').hidden = false;
    $('apEmpresa').textContent = D.empresa.nombre;
    $('apLogo').innerHTML = D.empresa.logoUrl ? `<img src="${esc(D.empresa.logoUrl)}" alt="">` : '<span class="ic"><i class="fa-solid fa-bolt"></i></span>';
    await equipos.configurar(D.caja);
    if (!D.turno) return pasoPersonal();
    try { const g = await bd.leer('autopago:' + idCaja); if (g?.lineas?.length) V = { ...nueva(), ...g }; } catch {}
    // Un pago ya aprobado nunca se pierde: se retoma para registrar la venta
    if (V.pagos.length) return pasoPago();
    V.lineas.length ? pasoCompra() : pasoInicio();
  }
  function indexar() {
    idx = { id: new Map(), codigo: new Map(), plu: new Map() };
    D.productos.forEach(p => {
      idx.id.set(p._id, p);
      if (p.codigo) idx.codigo.set(p.codigo, { p });
      (p.presentaciones || []).forEach(x => x.codigo && idx.codigo.set(x.codigo, { p, pres: x }));
      if (p.plu) idx.plu.set(p.plu, p);
    });
    D.cats = new Map(D.categorias.map(c => [c._id, c]));
  }
  const conBascula = () => D.caja.bascula?.modo && D.caja.bascula.modo !== 'ninguna';
  const factura = () => !!(D.empresa.modulos?.facturacion && D.pais.facturacion?.disponible);
  const mediosKiosco = () => D.medios.filter(m => m.tipo === 'qr' || (m.tipo === 'datafono' && D.equipos.some(x => x.tipo === 'terminal')) || (m.tipo === 'efectivo' && D.equipos.some(x => x.tipo === 'kiosco_efectivo')));

  // ── Personal: abrir el autopago ──────────────────────────────────────────
  function pasoPersonal() {
    paso = 'personal';
    vista(`<div class="ap-inicio" style="cursor:default"><div class="tarjeta"><div class="ap-escaner" style="font-size:50px"><i class="fa-solid fa-user-gear"></i></div><h1 style="font-size:34px">Autopago cerrado</h1><p>Un colaborador debe abrirlo para empezar a atender clientes en <b>${esc(D.caja.nombre)}</b>.</p><div class="ap-pasos" style="margin-top:28px"><button class="ap-b1" id="abrir" style="width:auto;padding:0 34px"><i class="fa-solid fa-lock-open"></i> Abrir autopago</button><button class="ap-b2" id="salir"><i class="fa-solid fa-arrow-left"></i> Volver</button></div></div></div>`);
    $('abrir').onclick = async () => {
      const r = await api('/turnos', { metodo: 'POST', body: { caja: idCaja, base: 0 } });
      if (!r.success) return toast(r.error, 'mal');
      D.turno = r.data; toast('Autopago abierto'); pasoInicio();
    };
    $('salir').onclick = () => location.replace('index.html');
  }

  // ── Inicio ───────────────────────────────────────────────────────────────
  function pasoInicio() {
    paso = 'inicio'; detenerListo();
    vista(`<div class="ap-inicio" id="ini"><div class="tarjeta"><div class="ap-escaner"><i class="fa-solid fa-barcode"></i></div><h1>Escanea tu primer producto</h1><p>Pasa el código de barras por el lector${conBascula() ? ' o toca la pantalla para frutas, verduras y productos sin código' : ''}.</p>
      <div class="ap-pasos"><span><b>1</b>Escanea</span><span><b>2</b>Revisa</span><span><b>3</b>Paga con ${esc(mediosKiosco().map(m => m.tipo === 'qr' ? 'QR' : m.tipo === 'datafono' ? 'tarjeta' : 'efectivo').filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'QR')}</span></div></div></div>`);
    $('ini').onclick = () => pasoCompra();
  }

  // ── Compra ───────────────────────────────────────────────────────────────
  function calcular() { return Motor.calcular(V.lineas, { decimales: D.pais.decimales, ahora: Motor.ahoraEnZona(D.sede.zonaHoraria || D.empresa.zonaHoraria), promociones: D.promociones }); }
  function pasoCompra() {
    paso = 'compra'; detenerListo();
    vista(`<div class="ap-compra">
      <section class="panel ap-lista"><header>Tu compra <small id="nArt"></small></header><div class="ap-lineas" id="lineas"></div>
        <div class="ap-pie"><span class="tip"><i class="fa-solid fa-barcode"></i>Escanea cada producto</span>${conBascula() || sinCodigo().length ? '<button class="ap-b2" id="sinCod"><i class="fa-solid fa-apple-whole"></i> Sin código</button>' : ''}<button class="ap-b2 peligro" id="cancelar"><i class="fa-solid fa-xmark"></i> Cancelar</button></div></section>
      <aside class="panel ap-resumen">
        ${D.empresa.modulos?.gamificacion ? '<div class="ap-cliente" id="cli"></div>' : ''}
        <div class="ap-filas" id="filas"></div>
        <div class="ap-total"><span>Total</span><b id="total"></b></div>
        <button class="ap-b1" id="pagar"><i class="fa-solid fa-lock"></i> Pagar</button>
      </aside></div>`);
    $('pagar').onclick = elegirFactura;
    $('cancelar').onclick = cancelarCompra;
    $('sinCod') && ($('sinCod').onclick = panelSinCodigo);
    $('lineas').onclick = e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const l = V.lineas.find(x => x.k === b.closest('[data-k]').dataset.k); if (!l) return;
      if (b.dataset.a === 'mas') { l.cantidad++; sonido(true); pintar(); } else quitar(l);
    };
    pintar();
  }
  function pintar() {
    if (paso !== 'compra') return;
    const c = calcular();
    $('lineas').innerHTML = c.lineas.length ? c.lineas.map(l => `<div class="ap-lin" data-k="${l.k}"><span class="q ${l.porPeso ? 'peso' : ''}">${l.porPeso ? fq(l.cantidad, true) + '<br>' + esc(l.unidad) : fq(l.cantidad)}</span><div class="n">${esc(l.nombre)}<small>${$$(l.precioUnitario)}${l.porPeso ? ` / ${esc(l.unidad)}` : ' c/u'}</small>${l.promocion ? `<small class="pm"><i class="fa-solid fa-tag"></i> ${esc(l.promocion.nombre)}</small>` : ''}</div><div class="v">${l.descuento > 0 ? `<s>${$$(l.bruto)}</s>` : ''}${$$(l.total)}</div><div class="acc">${l.porPeso ? '' : '<button data-a="mas" aria-label="Agregar uno"><i class="fa-solid fa-plus"></i></button>'}<button data-a="quitar" aria-label="Quitar"><i class="fa-solid fa-trash"></i></button></div></div>`).join('')
      : `<div class="ap-vacio"><div><i class="fa-solid fa-barcode"></i>Escanea el código de barras<br>de cada producto.</div></div>`;
    const n = V.lineas.reduce((a, l) => a + (l.porPeso ? 1 : l.cantidad), 0);
    $('nArt').textContent = n ? `· ${fq(n)} producto${n === 1 ? '' : 's'}` : '';
    $('total').textContent = $$(c.total);
    $('filas').innerHTML = V.lineas.length ? `<div class="f"><span>Subtotal</span><b>${$$(c.subtotal)}</b></div>${c.descuento > 0 ? `<div class="f ah"><span>Ahorras</span><b>−${$$(c.descuento)}</b></div>` : ''}${Object.entries(c.porTarifa).filter(([, t]) => t.impuesto > 0).map(([k, t]) => `<div class="f"><span>${esc(k)} incluido</span><b>${$$(t.impuesto)}</b></div>`).join('')}` : '';
    $('pagar').disabled = !V.lineas.length;
    const cl = $('cli');
    if (cl) { cl.className = 'ap-cliente' + (V.cliente ? ' on' : ''); cl.innerHTML = V.cliente ? `<i class="fa-solid fa-star"></i><span><b>Hola, ${esc(V.cliente.nombre.split(' ')[0])}</b>Tienes ${fq(V.cliente.puntos || 0)} puntos: esta compra suma más.</span>` : '<i class="fa-solid fa-qrcode"></i><span><b>¿Tienes la app?</b>Escanea el QR de tu cuenta para sumar puntos.</span>'; }
    guardar();
  }
  function agregar(p, { pres, cantidad, brutoFijo } = {}) {
    if (!p) return;
    if (p.tipo === 'peso' && !(cantidad > 0)) {
      if (conBascula()) return pesar(p);
      sonido(false); return toast(`Pesa ${p.nombre} en la báscula de la sección y escanea la etiqueta`, 'mal');
    }
    if (paso !== 'compra') pasoCompra();
    const q = cantidad || 1;
    let l = p.tipo === 'peso' ? null : V.lineas.find(x => x.producto === p._id && (x.presentacion || '') === (pres?._id || ''));
    if (l) { l.cantidad = Motor.r3(l.cantidad + q); V.lineas = [l, ...V.lineas.filter(x => x !== l)]; }
    else V.lineas.unshift({ k: uuid(), producto: p._id, categoria: p.categoria, nombre: p.nombre + (pres ? ` · ${pres.nombre}` : ''), unidad: p.unidad, porPeso: p.tipo === 'peso', cantidad: q, precioUnitario: pres ? pres.precio : p.precio, presentacion: pres?._id, impuestoTipo: p.impuestoTipo, impuestoPct: p.impuestoPct, descuentoManual: 0, brutoFijo });
    sonido(true); pintar();
  }
  // Quitar o bajar cantidad lo autoriza un colaborador (así se hace en todo autopago)
  async function quitar(l) {
    const tok = await pedirPin(`Quitar ${l.nombre}`); if (!tok) return;
    if (!l.porPeso && l.cantidad > 1) {
      const w = ventana({ titulo: esc(l.nombre), html: `<div class="c"><p class="nota">¿Cuántas unidades quitamos?</p><div class="tres">${[1, ...(l.cantidad > 2 ? [Math.floor(l.cantidad / 2)] : []), l.cantidad].filter((x, i, a) => a.indexOf(x) === i).map(n => `<button class="ap-b2" data-n="${n}">${n === l.cantidad ? 'Todas' : n}</button>`).join('')}</div></div>` });
      w.q('.tres').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; const n = Number(b.dataset.n); if (n >= l.cantidad) V.lineas = V.lineas.filter(x => x !== l); else l.cantidad -= n; w.cerrar(); pintar(); };
      return;
    }
    V.lineas = V.lineas.filter(x => x !== l); pintar();
  }
  async function cancelarCompra() {
    if (V.lineas.length && !(await confirmar('Cancelar la compra', 'Se quitarán todos los productos. Deja en su lugar lo que no vas a llevar.', 'Cancelar compra'))) return;
    reiniciar();
  }
  function reiniciar() {
    soltarCobro(); cerrarVentanas(); V = nueva(); guardar(); pasoInicio();
  }
  const cerrarVentanas = () => document.querySelectorAll('.velo').forEach(v => v._w?.cerrar ? (v._w.fija = false, v._w.cerrar()) : v.remove());

  // ── Lo que se escanea ────────────────────────────────────────────────────
  function codigo(c) {
    c = String(c).trim();
    if (/^KC-/i.test(c)) return identificar(c);
    const h = idx.codigo.get(c);
    if (h) return agregar(h.p, { pres: h.pres });
    const et = Motor.leerEtiquetaPeso(c, { prefijos: D.empresa.pos?.prefijosBascula, contenido: D.empresa.pos?.contenidoEtiqueta, decimales: D.pais.decimales });
    if (et) {
      const p = idx.plu.get(et.plu);
      const kg = p && (et.peso != null ? et.peso : Motor.r3(et.precio / p.precio));
      if (kg > 0) return agregar(p, { cantidad: kg, brutoFijo: et.precio });
    }
    sonido(false); toast('No reconocemos ese código. Toca Ayuda y un colaborador te asiste.', 'mal');
  }
  equipos.addEventListener('codigo', e => {
    actividad();
    const w = [...document.querySelectorAll('.velo')].pop()?._w;
    if (w) { if (w.alLeer) w.alLeer(e.detail); return; }
    if (paso === 'personal') return;
    if (paso === 'pago') return toast('Termina el pago o vuelve a la compra para agregar productos', 'mal');
    if (paso === 'listo') { V = nueva(); pasoCompra(); }
    codigo(e.detail);
  });
  async function identificar(q) {
    if (!D.empresa.modulos?.gamificacion) return;
    const r = await api('/clientes/buscar?q=' + encodeURIComponent(q));
    if (!r.success || r.data.length !== 1) { sonido(false); return toast('No encontramos esa cuenta', 'mal'); }
    V.cliente = r.data[0]; sonido(true); if (paso !== 'compra') pasoCompra(); else pintar();
    toast('¡Hola, ' + V.cliente.nombre.split(' ')[0] + '!');
  }

  // ── Productos sin código y báscula del kiosco ────────────────────────────
  const sinCodigo = () => D.productos.filter(p => (p.tipo === 'peso' && conBascula()) || (!p.codigo && p.tipo !== 'peso' && !(p.presentaciones || []).some(x => x.codigo)));
  function panelSinCodigo() {
    const ps = sinCodigo();
    const tarjeta = p => { const c = D.cats.get(p.categoria) || {}; return `<button data-p="${p._id}" style="--c:${esc(c.color || '#05C3DD')}">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="">` : `<i class="fa-solid ${esc(c.icono || 'fa-box')}"></i>`}${esc(p.nombre)}<small>${$$(p.precio)}${p.tipo === 'peso' ? ' / ' + esc(p.unidad) : ''}</small></button>`; };
    const w = ventana({ clase: 'xl', titulo: '<span>Productos sin código</span>', html: `<div class="c"><input class="in" id="bq" placeholder="Busca por nombre" autocomplete="off"><div class="ap-rejilla" id="rj">${ps.map(tarjeta).join('') || '<p class="nota">No hay productos sin código.</p>'}</div></div>` });
    w.q('#bq').oninput = () => { const q = w.q('#bq').value.trim().toLowerCase(); w.q('#rj').innerHTML = ps.filter(p => p.nombre.toLowerCase().includes(q)).map(tarjeta).join('') || '<p class="nota">Sin resultados.</p>'; };
    w.q('#rj').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; const p = idx.id.get(b.dataset.p); w.cerrar(); p.tipo === 'peso' ? pesar(p) : agregar(p); };
  }
  function pesar(p) {
    const w = ventana({ titulo: esc(p.nombre), html: `<div class="c"><p class="nota" style="text-align:center;font-size:16px">Pon el producto sobre la báscula y espera a que el peso quede en verde.</p><div class="ap-peso" id="ps"><div class="kg">0,000</div><div class="im">${$$(0)}</div></div></div>`, pie: '<button class="ap-b2" data-x2>Cancelar</button><button class="ap-b1" data-ok disabled style="height:60px;font-size:19px">Agregar</button>', alCerrar: () => equipos.removeEventListener('peso', ver) });
    const ok = w.q('[data-ok]');
    function ver() {
      const x = equipos.peso, kg = Motor.r3(x.kg || 0), vivo = Date.now() - (x.en || 0) < 3000;
      w.q('#ps').className = 'ap-peso' + (x.estable && vivo && kg > 0 ? ' estable' : '');
      w.q('.kg').textContent = vivo ? fq(kg, true) : '— — —';
      w.q('.im').textContent = $$(Motor.redondear(kg * p.precio, D.pais.decimales));
      ok.disabled = !(x.estable && vivo && kg > 0);
    }
    equipos.addEventListener('peso', ver); ver();
    w.q('[data-x2]').onclick = w.cerrar;
    ok.onclick = () => { const kg = Motor.r3(equipos.peso.kg); w.cerrar(); agregar(p, { cantidad: kg }); };
  }

  // ── Factura a nombre (opcional) ──────────────────────────────────────────
  function elegirFactura() {
    if (!V.lineas.length) return;
    if (!factura() || V.adquiriente) return pasoPago();
    const w = ventana({ titulo: '<span>¿Necesitas factura a tu nombre?</span>', html: `<div class="c"><p class="nota" style="font-size:16px">Si no la necesitas, la emitimos como consumidor final.</p><div class="dos"><button class="ap-b2" data-n style="height:90px;font-size:18px"><i class="fa-solid fa-receipt"></i> No, continuar</button><button class="ap-b2" data-s style="height:90px;font-size:18px"><i class="fa-solid fa-building"></i> Sí, a mi nombre</button></div></div>` });
    w.q('[data-n]').onclick = () => { w.cerrar(); pasoPago(); };
    w.q('[data-s]').onclick = () => { w.cerrar(); formFactura(); };
  }
  function formFactura() {
    const tipos = D.pais.tiposDocumento.map(t => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join('');
    const w = ventana({ titulo: '<span>Datos para tu factura</span>', html: `<div class="c"><div class="dos"><div><label class="k">Tipo de documento</label><select class="in" id="fT">${tipos}</select></div><div><label class="k">Número</label><input class="in" id="fD" inputmode="numeric" autocomplete="off"></div></div><div><label class="k">Nombre o razón social</label><input class="in" id="fN" autocomplete="off"></div><div><label class="k">Correo para recibir la factura</label><input class="in" id="fE" type="email" autocomplete="off"></div></div>`, pie: '<button class="ap-b2" data-x2>Volver</button><button class="ap-b1" data-ok style="height:60px;font-size:19px">Continuar al pago</button>' });
    w.q('[data-x2]').onclick = w.cerrar;
    w.q('[data-ok]').onclick = () => {
      const a = { tipoDocumento: w.q('#fT').value, documento: w.q('#fD').value.trim(), nombre: w.q('#fN').value.trim(), correo: w.q('#fE').value.trim() };
      if (!a.documento || !a.nombre) return toast('Escribe el número de documento y el nombre', 'mal');
      if (a.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.correo)) return toast('Revisa el correo', 'mal');
      V.adquiriente = a; guardar(); w.cerrar(); pasoPago();
    };
  }

  // ── Pago ─────────────────────────────────────────────────────────────────
  function pasoPago() {
    paso = 'pago'; V.uuid = V.uuid || uuid(); guardar();
    const c = calcular(), ms = mediosKiosco();
    vista(`<div class="ap-pago"><section class="panel ap-medios"><h2>¿Cómo quieres pagar?</h2>${ms.map(m => `<button class="ap-medio" data-m="${esc(m.codigo)}"><i class="fa-solid ${esc(m.icono || 'fa-coins')}"></i><span>${esc(m.nombre)}<small>${m.tipo === 'qr' ? 'Escanea el código con tu celular' : m.tipo === 'datafono' ? 'Tarjeta débito o crédito' : 'Billetes en el kiosco'}</small></span></button>`).join('') || '<p class="nota">Este autopago no tiene medios de pago disponibles. Toca Ayuda.</p>'}<button class="ap-b2" id="volver" style="margin-top:auto"><i class="fa-solid fa-arrow-left"></i> Volver a la compra</button></section>
      <section class="panel ap-estado" id="est"><span class="tt">Total a pagar</span><div class="gr">${$$(c.total)}</div><p>Elige un medio de pago para continuar.</p></section></div>`);
    $('apVista').querySelector('.ap-medios').onclick = e => { const b = e.target.closest('[data-m]'); if (b && !enviando) cobrar(ms.find(m => m.codigo === b.dataset.m)); };
    $('volver').onclick = async () => { if (V.pagos.length) return toast('Tu pago ya fue aprobado: estamos registrando la compra', 'mal'); await soltarCobro(); pasoCompra(); };
    if (V.pagos.length) registrar();
    else if (ms.length === 1) cobrar(ms[0]);
  }
  const estado = html => { const e = $('est'); if (e) e.innerHTML = html; };
  async function cobrar(m) {
    if (enviando) return;
    await soltarCobro();
    medio = m;
    document.querySelectorAll('.ap-medio').forEach(b => b.classList.toggle('on', b.dataset.m === m.codigo));
    const total = calcular().total;
    estado('<div class="girando"></div><p>Preparando el pago…</p>');
    enviando = true;
    const r = await api('/cobros', { metodo: 'POST', body: { caja: idCaja, medio: m.codigo, monto: total }, espera: 45000 });
    enviando = false;
    if (paso !== 'pago' || medio !== m) { if (r.success) api(`/cobros/${r.data._id}/cancelar`, { metodo: 'POST' }); return; }
    if (!r.success) { estado(`<div class="ilu" style="color:var(--rojo)"><i class="fa-solid fa-triangle-exclamation"></i></div><p>${esc(r.error)}</p><button class="ap-b2" id="otra">Intentar de nuevo</button>`); $('otra').onclick = () => cobrar(m); return; }
    cobro = r.data;
    const texto = m.tipo === 'qr' ? 'Abre la app de tu banco o billetera y escanea este código' : m.tipo === 'datafono' ? 'Acerca o inserta tu tarjeta en el datáfono' : 'Introduce los billetes en el kiosco de efectivo';
    estado(`<span class="tt">${esc(m.nombre)}</span><div class="gr">${$$(total)}</div>${m.tipo === 'qr' && cobro.qrBase64 ? `<div class="qr"><img src="${esc(cobro.qrBase64)}" alt="Código QR de pago"></div>` : `<div class="ilu"><i class="fa-solid ${m.tipo === 'datafono' ? 'fa-credit-card' : 'fa-money-bill-wave'}"></i></div>`}<p>${texto}</p><span class="reloj" id="rl"></span><button class="ap-b2" id="cn">Cancelar este pago</button>`);
    $('cn').onclick = async () => { await soltarCobro(); medio = null; document.querySelectorAll('.ap-medio').forEach(b => b.classList.remove('on')); estado(`<span class="tt">Total a pagar</span><div class="gr">${$$(total)}</div><p>Elige un medio de pago para continuar.</p>`); };
    const fin = new Date(cobro.expiraEn).getTime();
    sondeo = setInterval(async () => {
      const rl = $('rl'); if (rl && cobro) { const s = Math.max(0, Math.round((fin - Date.now()) / 1000)); rl.textContent = cobro.recibido ? `Recibido ${$$(cobro.recibido)} de ${$$(total)}` : `El código vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
      if (consultando || !cobro) return; consultando = true;
      const x = await api('/cobros/' + cobro._id); consultando = false;
      if (!x.success || !cobro) return;
      cobro = x.data; actividad();
      if (cobro.estado === 'aprobado') aprobado(cobro, m);
      else if (cobro.estado !== 'pendiente') { clearInterval(sondeo); cobro = null; sonido(false); estado(`<div class="ilu" style="color:var(--rojo)"><i class="fa-solid fa-circle-xmark"></i></div><p>${{ rechazado: 'El pago fue rechazado.', cancelado: 'El pago se canceló.', expirado: 'El código de pago venció.' }[x.data.estado] || 'El pago no se completó.'} Puedes intentarlo de nuevo.</p><button class="ap-b2" id="otra">Intentar de nuevo</button>`); $('otra').onclick = () => cobrar(m); }
    }, 2000);
  }
  async function soltarCobro() {
    clearInterval(sondeo);
    if (cobro?.estado === 'pendiente') {
      const x = cobro; cobro = null;
      const r = await api(`/cobros/${x._id}/cancelar`, { metodo: 'POST' });
      // Llegó a aprobarse justo al cancelar: se conserva y se registra la venta
      if (r.success && r.data.estado === 'aprobado' && medio && V.lineas.length) { aprobado(r.data, medio); return true; }
    }
    cobro = null; return false;
  }
  function aprobado(x, m) {
    clearInterval(sondeo); cobro = null;
    V.pagos = [{ medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: x.monto, cobro: x._id, referencia: x.autorizacion, recibido: x.recibido || undefined }];
    guardar(); sonido(true);
    if (paso !== 'pago') pasoPago(); else registrar();
  }
  async function registrar() {
    if (enviando) return; enviando = true;
    estado('<div class="girando"></div><p>Pago aprobado. Registrando tu compra…</p>');
    const c = calcular();
    const body = {
      uuid: V.uuid, turno: D.turno._id, cliente: V.cliente?._id, adquiriente: V.adquiriente || undefined,
      items: V.lineas.map(l => ({ producto: l.producto, cantidad: l.cantidad, presentacion: l.presentacion, brutoFijo: l.brutoFijo })),
      pagos: V.pagos.map(p => ({ medio: p.medio, monto: p.monto, recibido: p.recibido, referencia: p.referencia, cobro: p.cobro })), fecha: new Date().toISOString(),
    };
    const r = await api('/pos/ventas', { metodo: 'POST', body, espera: 25000 });
    enviando = false;
    if (!r.success) {
      // El dinero ya está pagado: nunca se descarta. Se reintenta con el mismo uuid.
      sonido(false);
      estado(`<div class="ilu" style="color:var(--ambar)"><i class="fa-solid fa-hand"></i></div><p><b>Tu pago fue aprobado</b>, pero no pudimos registrar la compra${r.red ? ' por falta de conexión' : ''}. Un colaborador te ayuda en un momento.</p><p class="nota">${esc(r.error || '')}</p><button class="ap-b1" id="re" style="max-width:360px"><i class="fa-solid fa-rotate"></i> Reintentar</button>`);
      $('re').onclick = registrar; pedirAyuda(true);
      return;
    }
    const copia = { calculo: c, cliente: V.cliente, adquiriente: V.adquiriente, pagos: V.pagos };
    V = nueva(); guardar(); pedirAyuda(false);
    pasoListo(r.data.venta, r.data.premio, copia);
  }

  // ── Listo ────────────────────────────────────────────────────────────────
  function pasoListo(v, premio, copia) {
    paso = 'listo';
    const cambio = Motor.sumar((v.pagos || []).map(p => p.cambio || 0), D.pais.decimales);
    vista(`<div class="ap-listo"><div class="tarjeta"><div class="ok"><i class="fa-solid fa-check"></i></div><h1>¡Gracias por tu compra!</h1><p>${esc(v.numero)} · <b>${$$(v.total)}</b></p>${cambio > 0 ? `<p>Recibe tu cambio en el kiosco: <b>${$$(cambio)}</b></p>` : ''}${premio?.ganados ? `<span class="logro"><i class="fa-solid fa-star"></i> Ganaste ${fq(premio.ganados)} puntos</span>` : ''}<p class="nota" id="fe">${D.caja.impresora?.modo !== 'ninguna' ? 'Toma tu recibo.' : ''}</p><button class="ap-b1" id="fin" style="max-width:340px;margin-top:10px">Terminar</button></div></div>`);
    $('fin').onclick = pasoInicio;
    let doc = null, n = 0, impreso = false;
    const imprime = D.caja.impresora?.modo && D.caja.impresora.modo !== 'ninguna';
    const imprimir = () => { if (impreso || !imprime) return; impreso = true; equipos.imprimir(tiquete(v, copia, doc)); };
    const espDoc = ['pendiente', 'validacion', 'error'].includes(v.documento?.estado);
    if (!espDoc) imprimir();
    // La factura se emite en segundo plano: se esperan unos segundos para imprimir su código
    const t = setInterval(async () => {
      if (paso !== 'listo' || !espDoc || doc || ++n > 6) { clearInterval(t); if (paso === 'listo') imprimir(); return; }
      const r = await api(`/pos/ventas/${v._id}/documento`);
      if (r.success && r.data.documento) { doc = r.data; const fe = $('fe'); if (fe) fe.textContent = `${D.pais.facturacion.nombreDocumento} ${doc.documento}${imprime ? ' · Toma tu recibo.' : ''}`; imprimir(); }
    }, 1500);
    detenerListo(); tListo = setTimeout(() => { if (paso === 'listo') pasoInicio(); }, LISTO_S * 1000);
  }
  function detenerListo() { clearTimeout(tListo); tListo = null; }
  function tiquete(v, copia, doc) {
    const e = D.empresa, L = [];
    L.push({ tx: e.nombre, al: 'c', b: 1, g: 1 }); if (e.razonSocial && e.razonSocial !== e.nombre) L.push({ tx: e.razonSocial, al: 'c' });
    if (e.idFiscal) L.push({ tx: `${D.pais.nombreIdFiscal} ${e.idFiscal}`, al: 'c' });
    L.push({ tx: [D.sede.direccion || e.direccion, D.sede.ciudad || e.ciudad].filter(Boolean).join(', '), al: 'c' });
    L.push({ hr: 1 }, { d: doc ? D.pais.facturacion.nombreDocumento : 'Comprobante de venta', v: doc?.documento || v.numero, b: 1 }, { d: 'Fecha', v: new Date(v.fecha || Date.now()).toLocaleString(D.pais.locale, { timeZone: e.zonaHoraria, dateStyle: 'short', timeStyle: 'short' }) }, { d: 'Caja', v: `${D.caja.nombre} (autopago)` });
    const cf = copia.adquiriente || (copia.cliente ? { nombre: copia.cliente.nombre, documento: copia.cliente.documento } : D.pais.consumidorFinal);
    L.push({ d: 'Cliente', v: cf.nombre }); if (cf.documento) L.push({ d: 'Documento', v: cf.documento });
    L.push({ hr: 1 });
    v.items.forEach(i => { L.push({ tx: i.nombre }); L.push({ d: `  ${fq(i.cantidad, i.porPeso)}${i.porPeso ? ' ' + i.unidad : ''} x ${$$(i.precioUnitario)}`, v: $$(i.total) }); if (i.descuento > 0) L.push({ tx: `  Ahorro ${$$(i.descuento)}` }); });
    L.push({ hr: 1 }); if (v.descuento > 0) L.push({ d: 'Subtotal', v: $$(v.subtotal) }, { d: 'Ahorro', v: '-' + $$(v.descuento) });
    L.push({ d: 'TOTAL', v: $$(v.total), b: 1, g: 1 });
    Object.entries(copia.calculo.porTarifa).forEach(([k, t]) => L.push({ d: `${k} base ${$$(t.base)}`, v: $$(t.impuesto) }));
    L.push({ hr: 1 }); (v.pagos || []).forEach(p => { L.push({ d: p.nombre || p.medio, v: $$(p.recibido ?? p.monto) }); if (p.cambio > 0) L.push({ d: 'Cambio', v: $$(p.cambio) }); });
    if (v.puntosGanados) L.push({ tx: `Ganaste ${fq(v.puntosGanados)} puntos`, al: 'c', b: 1 });
    if (doc?.codigoUnico) L.push({ hr: 1 }, { tx: `${D.pais.facturacion.codigoUnico}: ${doc.codigoUnico}`, al: 'c' }, ...(doc.urlConsulta ? [{ tx: doc.urlConsulta, al: 'c' }] : []));
    L.push({ hr: 1 }, { tx: e.pos?.pieTicket || '¡Gracias por tu compra!', al: 'c' });
    return L;
  }

  // ── Ayuda, PIN y menú del personal ───────────────────────────────────────
  function pedirAyuda(si) { $('apAyuda').classList.toggle('on', si); $('apAyuda').innerHTML = si ? '<i class="fa-solid fa-bell"></i> Un colaborador viene en camino' : '<i class="fa-solid fa-hand"></i> Ayuda'; }
  $('apAyuda').onclick = () => { const on = !$('apAyuda').classList.contains('on'); pedirAyuda(on); if (on) sonido(true); };
  function pedirPin(motivo) {
    return new Promise(listo => {
      let pin = '', fin = null;
      const w = ventana({ titulo: '<span>Autorización del personal</span>', html: `<div class="c"><p class="nota" style="text-align:center">${esc(motivo)}<br>Un colaborador debe digitar su PIN.</p><div class="ap-pin" id="pp">${'<span></span>'.repeat(4)}</div><div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-d="${n}">${n}</button>`).join('')}<button data-d="b" aria-label="Borrar"><i class="fa-solid fa-delete-left"></i></button><button data-d="0">0</button><button data-d="ok" aria-label="Aceptar"><i class="fa-solid fa-check"></i></button></div></div>`, alCerrar: () => listo(fin) });
      const ver = () => w.qq('#pp span').forEach((s, i) => s.classList.toggle('on', i < pin.length));
      w.q('.teclado').onclick = async e => {
        const d = e.target.closest('[data-d]')?.dataset.d; if (!d) return;
        if (d === 'b') pin = pin.slice(0, -1); else if (d !== 'ok' && pin.length < 6) pin += d;
        ver();
        if (d === 'ok' || pin.length === 6) {
          if (pin.length < 4) return;
          const r = await api('/auth/autorizar-pin', { metodo: 'POST', body: { pin } });
          if (!r.success) { pin = ''; ver(); sonido(false); return toast(r.error, 'mal'); }
          fin = r.data.token; w.cerrar();
        }
      };
    });
  }
  // Menú oculto: mantener presionada la marca 2 segundos
  let tMenu;
  $('apMarca').addEventListener('pointerdown', () => { tMenu = setTimeout(menuPersonal, 2000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('apMarca').addEventListener(ev, () => clearTimeout(tMenu)));
  async function menuPersonal() {
    if (paso === 'personal') return;
    const tok = await pedirPin('Menú del personal'); if (!tok) return;
    const w = ventana({ titulo: '<span>Menú del personal</span>', html: `<div class="c"><div class="lista">
      <button class="fila" data-o="ayuda"><i class="fa-solid fa-bell-slash"></i><span class="d"><b>Atender llamado de ayuda</b><small>Apaga el aviso de ayuda</small></span></button>
      <button class="fila" data-o="cancelar"><i class="fa-solid fa-xmark"></i><span class="d"><b>Cancelar la compra en curso</b><small>Solo si no tiene un pago aprobado</small></span></button>
      <button class="fila" data-o="recargar"><i class="fa-solid fa-rotate"></i><span class="d"><b>Actualizar catálogo y precios</b></span></button>
      <button class="fila" data-o="tema"><i class="fa-solid fa-circle-half-stroke"></i><span class="d"><b>Cambiar tema claro / oscuro</b></span></button>
      <button class="fila" data-o="salir"><i class="fa-solid fa-right-from-bracket"></i><span class="d"><b>Salir del modo autopago</b><small>El turno queda abierto; se cierra desde una caja atendida o el administrador</small></span></button>
    </div></div>` });
    w.q('.lista').onclick = e => {
      const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
      w.cerrar();
      if (o === 'ayuda') pedirAyuda(false);
      else if (o === 'cancelar') { if (V.pagos.length) return toast('Esa compra tiene un pago aprobado: hay que registrarla', 'mal'); reiniciar(); }
      else if (o === 'recargar') location.reload();
      else if (o === 'tema') cambiarTema();
      else if (o === 'salir') { if (V.pagos.length) return toast('Hay un pago aprobado sin registrar', 'mal'); soltarCobro().then(() => location.replace('index.html')); }
    };
  }

  // ── Compra abandonada ────────────────────────────────────────────────────
  function actividad() { ultimaAccion = Date.now(); }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, actividad, true));
  setInterval(() => {
    if (avisoInactivo || !['compra', 'pago'].includes(paso) || V.pagos.length || enviando) return;
    if (paso === 'compra' && !V.lineas.length && Date.now() - ultimaAccion > 30000) return pasoInicio();
    if (cobro?.estado === 'pendiente' || Date.now() - ultimaAccion < INACTIVO_S * 1000) return;
    let s = AVISO_S;
    const w = ventana({ titulo: '<span>¿Sigues ahí?</span>', html: `<div class="c" style="text-align:center"><p class="nota" style="font-size:17px">Tu compra se cancelará en <b class="num" id="sg">${s}</b> segundos.</p></div>`, pie: '<button class="ap-b1" data-s style="height:64px;font-size:20px">Sigo comprando</button>', alCerrar: () => { clearInterval(t); avisoInactivo = null; actividad(); } });
    avisoInactivo = w;
    w.q('[data-s]').onclick = w.cerrar;
    const t = setInterval(() => { s--; const e = w.q('#sg'); if (e) e.textContent = s; if (s <= 0) { clearInterval(t); avisoInactivo = null; reiniciar(); } }, 1000);
  }, 1000);

  window.addEventListener('online', () => { enLinea = true; $('apRed').hidden = true; });
  window.addEventListener('offline', () => { enLinea = false; $('apRed').hidden = false; });
  iniciar();
})();
