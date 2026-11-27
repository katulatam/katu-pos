/* caja.js — la venta */
(function () {
  'use strict';
  const idCaja = localStorage.getItem('katu_pos_caja');
  if (!sesion.token || !idCaja) { location.replace('index.html'); return; }

  let D = null;                       // datos de arranque
  let idx = {};                       // índices para resolver códigos
  let V = nueva();                    // venta en curso
  let cat = 'fav', sel = null, enLinea = true, pendientes = 0;
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('katu_pos_visor:' + idCaja) : null;
  function nueva() { return { lineas: [], cliente: null, juego: null, descuentoGlobal: 0, puntosRedimir: 0, recompensa: null, autorizacion: null, adquiriente: null }; }
  const $$ = n => Motor.dinero(n, D.pais);
  const red = n => Motor.redondear(n, D.pais.decimales);
  const fq = (n, peso) => (peso ? Number(n).toLocaleString(D.pais.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : Number(n).toLocaleString(D.pais.locale));
  // Lee un valor escrito con el formato del país (12.500 en Colombia, 12.50 en México)
  function num(s) {
    s = String(s || '').replace(/[^\d.,-]/g, '');
    if (!s) return 0;
    if (D.pais.decimales === 0) return Number(s.replace(/[.,]/g, '')) || 0;
    const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const dec = i >= 0 && s.length - i - 1 <= D.pais.decimales ? s.slice(i + 1) : '';
    const ent = (dec || (i >= 0 && s.length - i - 1 === 0) ? s.slice(0, i) : s).replace(/[.,]/g, '');
    return Number(ent + (dec ? '.' + dec : '')) || 0;
  }
  const numPeso = s => Number(String(s || '').replace(',', '.')) || 0;

  // ── Arranque ─────────────────────────────────────────────────────────────
  async function iniciar() {
    const r = await api('/pos/arranque/' + idCaja);
    if (r.http === 401) return sesion.salir();
    if (r.success) { D = r.data; await bd.guardar('arranque:' + idCaja, D); conexion(true); }
    else if (r.red && (D = await bd.leer('arranque:' + idCaja))) conexion(false);
    else { toast(r.error, 'mal'); return setTimeout(() => location.replace('index.html'), 1800); }
    if (D.caja.tipo === 'autopago') return location.replace('autopago.html');
    avisoPrueba(D.diasPrueba);
    indexar();
    if (D.turno && sesion.user.rol === 'cajero' && String(D.turno.cajero?._id || D.turno.cajero) !== String(D.usuario._id)) { toast('Esa caja tiene el turno de otro cajero', 'mal'); return setTimeout(() => location.replace('index.html'), 1800); }
    $('cabina').hidden = false;
    $('dEmpresa').textContent = D.empresa.nombre; $('dCaja').textContent = `${D.sede.nombre} · ${D.caja.nombre}`;
    $('bPedidos').hidden = !D.empresa.modulos.domicilios;
    $('balanza').hidden = D.caja.bascula?.modo === 'ninguna';
    pintarRiel(); pintarProductos(); pintar();
    await equipos.configurar(D.caja);
    try { const g = await bd.leer('venta:' + idCaja); if (g?.lineas?.length) { V = { ...nueva(), ...g }; pintar(); } } catch {}
    contarCola(); sincronizar();
    setInterval(sincronizar, 15000);
    if (!D.turno) abrirTurno();
    if (D.empresa.modulos.domicilios) { verPedidos(true); setInterval(() => verPedidos(true), 20000); }
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
  function conexion(si) {
    enLinea = si;
    const e = $('red');
    e.classList.toggle('off', !si || pendientes > 0);
    e.innerHTML = `<span class="pt"></span><span class="tx">${si ? 'En línea' : 'Sin conexión'}</span>${pendientes ? `<span class="cta">${pendientes}</span>` : ''}`;
  }

  // ── Catálogo ─────────────────────────────────────────────────────────────
  function pintarRiel() {
    const b = [{ _id: 'fav', nombre: 'Rápidos', icono: 'fa-star', color: '#FFB547' }, { _id: '', nombre: 'Todo', icono: 'fa-grip', color: '#05C3DD' }, ...D.categorias];
    $('riel').innerHTML = b.map(c => `<button data-c="${c._id}" class="${c._id === cat ? 'on' : ''}" style="--c:${esc(c.color)}"><i class="fa-solid ${esc(c.icono)}"></i>${esc(c.nombre)}</button>`).join('');
  }
  $('riel').onclick = e => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; $('buscar').value = ''; pintarRiel(); pintarProductos(); };
  const sinTildes = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function pintarProductos() {
    const q = sinTildes($('buscar').value.trim());
    let l = D.productos;
    if (q) { const pal = q.split(/\s+/); l = l.filter(p => { const t = sinTildes(`${p.nombre} ${p.marca} ${p.codigo} ${p.plu}`); return pal.every(x => t.includes(x)); }); }
    else if (cat === 'fav') { l = l.filter(p => p.favorito); if (!l.length) l = D.productos; }
    else if (cat) l = l.filter(p => p.categoria === cat);
    const ahora = Motor.ahoraEnZona(D.empresa.zonaHoraria);
    const promos = D.promociones.filter(p => Motor.promoVigente(p, ahora));
    $('rejilla').innerHTML = l.slice(0, 120).map(p => {
      const c = D.cats.get(p.categoria) || {};
      const pr = promos.find(x => x.alcance === 'todo' || (x.objetivos || []).includes(x.alcance === 'categoria' ? p.categoria : p._id));
      return `<button class="prod" data-p="${p._id}" style="--c:${esc(c.color || '#05C3DD')}"><span class="pic">${p.imagenUrl ? `<img src="${esc(p.imagenMini || p.imagenUrl)}" alt="" loading="lazy">` : `<i class="fa-solid ${esc(c.icono || 'fa-box')}"></i>`}</span>${p.stock != null ? `<span class="st ${p.stock <= 0 ? 'cero' : p.stock <= p.minimo ? 'bajo' : ''}">${fq(Motor.r3(p.stock))}</span>` : ''}${pr ? `<span class="pr">${esc(pr.tipo === 'porcentaje' ? `−${pr.valor}%` : pr.tipo === 'nxm' ? `${pr.lleva}×${pr.paga}` : 'Oferta')}</span>` : ''}<span class="nm">${esc(p.nombre)}</span><span class="pv">${$$(p.precio)}${p.tipo === 'peso' ? ` <small>/${esc(p.unidad)}</small>` : ''}</span></button>`;
    }).join('') || `<div class="vacio"><i class="fa-solid fa-magnifying-glass"></i>No hay productos con esa búsqueda.</div>`;
  }
  $('rejilla').onclick = e => { const b = e.target.closest('.prod'); if (b) agregar(idx.id.get(b.dataset.p)); };
  $('buscar').oninput = pintarProductos;
  $('buscar').onkeydown = e => {
    if (e.key !== 'Enter') return;
    const t = $('buscar').value.trim(); if (!t) return;
    if (!codigo(t, true)) { const u = document.querySelectorAll('.prod'); if (u.length === 1) u[0].click(); else return; }
    $('buscar').value = ''; pintarProductos();
  };

  // ── Resolver lo que se lee: código, etiqueta de báscula o PLU ──
  function codigo(c, callado) {
    c = String(c).trim();
    const h = idx.codigo.get(c);
    if (h) { agregar(h.p, { pres: h.pres }); return true; }
    const et = Motor.leerEtiquetaPeso(c, { prefijos: D.empresa.pos?.prefijosBascula, contenido: D.empresa.pos?.contenidoEtiqueta, decimales: D.pais.decimales });
    if (et) {
      const p = idx.plu.get(et.plu);
      if (p) {
        const kg = et.peso != null ? et.peso : Motor.r3(et.precio / p.precio);
        if (kg > 0) { agregar(p, { cantidad: kg, brutoFijo: et.precio }); return true; }
      }
    }
    if (/^\d{1,5}$/.test(c)) { const p = idx.plu.get(c.padStart(5, '0')); if (p) { agregar(p); return true; } }
    if (/^KC-/i.test(c)) { buscarCliente(c); return true; }
    if (!callado) { sonido(false); toast(`Código ${c} no registrado`, 'mal'); }
    return false;
  }
  equipos.addEventListener('codigo', e => {
    const w = ultimaVentana();
    if (w) { w.alLeer && w.alLeer(e.detail); return; }
    codigo(e.detail);
  });

  let audio;
  function sonido(ok) { try { audio = audio || new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = ok ? 1180 : 220; g.gain.setValueAtTime(.05, audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + (ok ? .09 : .3)); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .3); } catch {} }

  // ── Líneas ───────────────────────────────────────────────────────────────
  function agregar(p, { pres, cantidad, brutoFijo } = {}) {
    if (!p) return;
    if (p.tipo === 'peso' && !(cantidad > 0)) return pesar(p);
    const q = cantidad || 1;
    let l = p.tipo === 'peso' ? null : V.lineas.find(x => x.producto === p._id && (x.presentacion || '') === (pres?._id || '') && !x.descuentoManual);
    if (l) { l.cantidad = Motor.r3(l.cantidad + q); V.lineas = [l, ...V.lineas.filter(x => x !== l)]; }
    else {
      l = { k: uuid(), producto: p._id, categoria: p.categoria, nombre: p.nombre + (pres ? ` · ${pres.nombre}` : ''), unidad: p.unidad, porPeso: p.tipo === 'peso', cantidad: q, precioUnitario: pres ? pres.precio : p.precio, presentacion: pres?._id, impuestoTipo: p.impuestoTipo, impuestoPct: p.impuestoPct, descuentoManual: 0, brutoFijo };
      V.lineas.unshift(l);
    }
    sel = l.k; sonido(true); pintar();
    document.querySelector(`.prod[data-p="${p._id}"]`)?.classList.add('parpadea');
    setTimeout(() => document.querySelector(`.prod[data-p="${p._id}"]`)?.classList.remove('parpadea'), 360);
  }
  function calcular() {
    const rec = V.recompensa ? V.recompensa.descuento : 0;
    return Motor.calcular(V.lineas, { decimales: D.pais.decimales, ahora: Motor.ahoraEnZona(D.sede.zonaHoraria || D.empresa.zonaHoraria), promociones: D.promociones, descuentoGlobal: V.descuentoGlobal, descuentoPuntos: rec + (V.puntosRedimir || 0) * (D.empresa.gamificacion?.valorPunto || 0) });
  }
  function pintar() {
    const c = calcular();
    $('lineas').innerHTML = c.lineas.map(l => `<div class="lin ${l.k === sel ? 'sel' : ''}" data-k="${l.k}"><button class="q" data-a="cant">${fq(l.cantidad, l.porPeso)}</button><div class="n">${esc(l.nombre)}<small>${$$(l.precioUnitario)}${l.porPeso ? ` /${esc(l.unidad)}` : ''}</small>${l.promocion ? `<small class="pm">${esc(l.promocion.nombre)}</small>` : ''}</div><div class="v">${l.descuento > 0 ? `<s>${$$(l.bruto)}</s>` : ''}${$$(l.total)}</div><div class="ac">${l.porPeso ? '<button data-a="pesar"><i class="fa-solid fa-weight-scale"></i> Pesar</button>' : '<button data-a="menos"><i class="fa-solid fa-minus"></i></button><button data-a="mas"><i class="fa-solid fa-plus"></i></button>'}<button data-a="desc"><i class="fa-solid fa-percent"></i></button><button class="x" data-a="quitar"><i class="fa-solid fa-trash"></i></button></div></div>`).join('')
      || `<div class="vacio"><i class="fa-solid fa-barcode"></i>Escanea un producto<br>o toca una tarjeta del catálogo.</div>`;
    const n = V.lineas.reduce((a, l) => a + (l.porPeso ? 1 : l.cantidad), 0);
    $('nArt').textContent = n ? `${fq(n)} artículo${n === 1 ? '' : 's'}` : 'Total';
    $('total').textContent = $$(c.total);
    $('filas').innerHTML = V.lineas.length ? `<div class="f"><span>Subtotal</span><b>${$$(c.subtotal)}</b></div>${c.descuento > 0 ? `<div class="f ah"><span>Ahorro</span><b>−${$$(c.descuento)}</b></div>` : ''}${Object.entries(c.porTarifa).filter(([, t]) => t.impuesto > 0).map(([k, t]) => `<div class="f"><span>${esc(k)} incluido</span><b>${$$(t.impuesto)}</b></div>`).join('')}` : '';
    $('bCobrar').disabled = !V.lineas.length; $('bDesc').disabled = !V.lineas.length; $('bVaciar').disabled = !V.lineas.length;
    const es = espera().length; $('bEspera').innerHTML = `<i class="fa-solid ${V.lineas.length ? 'fa-pause' : 'fa-play'}"></i> ${V.lineas.length ? 'Espera' : 'Retomar'}${es ? ` (${es})` : ''}`; $('bEspera').disabled = !V.lineas.length && !es;
    const cl = V.cliente, j = V.juego;
    $('cli').innerHTML = cl ? `<span class="aro" style="--p:${j?.nivel?.avance || 0};--c:${esc(j?.nivel?.actual?.color || '#05C3DD')}"><span>${esc(iniciales(cl.nombre))}</span></span><span class="d"><b>${esc(cl.nombre)}</b><small>${j ? `${esc(j.nivel.actual.nombre)} · ${fq(cl.puntos)} puntos${cl.racha?.semanas > 1 ? ` · racha ${cl.racha.semanas}` : ''}` : esc(cl.telefono || cl.documento || '')}${V.adquiriente ? ' · factura a su nombre' : ''}</small></span><i class="fa-solid fa-chevron-right" style="color:var(--t3)"></i>` : `<span class="aro"><span><i class="fa-solid fa-user-plus"></i></span></span><span class="d"><b>${V.adquiriente ? esc(V.adquiriente.nombre) : 'Agregar cliente'}</b><small>${V.adquiriente ? 'Factura a su nombre' : 'Puntos, fiado y factura a su nombre'}</small></span><kbd class="oc">F4</kbd>`;
    bd.guardar('venta:' + idCaja, JSON.parse(JSON.stringify(V))).catch(() => {});
    visor({ tipo: V.lineas.length ? 'venta' : 'espera', lineas: c.lineas.map(l => ({ n: l.nombre, q: fq(l.cantidad, l.porPeso), v: $$(l.total) })), total: $$(c.total), ahorro: c.descuento > 0 ? $$(c.descuento) : '', cliente: cl?.nombre, puntos: cl?.puntos });
  }
  const visor = d => canal && canal.postMessage({ ...d, empresa: D.empresa.nombre, logo: D.empresa.logoUrl });
  $('lineas').onclick = e => {
    const f = e.target.closest('.lin'); if (!f) return;
    const l = V.lineas.find(x => x.k === f.dataset.k), a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) { sel = sel === l.k ? null : l.k; return pintar(); }
    sel = l.k;
    if (a === 'mas') { l.cantidad++; pintar(); }
    else if (a === 'menos') { if (l.cantidad > 1) { l.cantidad--; } else V.lineas = V.lineas.filter(x => x !== l); pintar(); }
    else if (a === 'quitar') { V.lineas = V.lineas.filter(x => x !== l); pintar(); }
    else if (a === 'pesar' || (a === 'cant' && l.porPeso)) pesar(idx.id.get(l.producto), l);
    else if (a === 'cant') pedirNumero({ titulo: esc(l.nombre), etiqueta: 'Cantidad', valor: l.cantidad, entero: true }, n => { if (n <= 0) V.lineas = V.lineas.filter(x => x !== l); else l.cantidad = n; pintar(); });
    else if (a === 'desc') pedirNumero({ titulo: `Descuento — ${esc(l.nombre)}`, etiqueta: 'Porcentaje (%)', valor: '', max: 100 }, n => { l.descuentoManual = red(red(l.precioUnitario * l.cantidad) * n / 100); pintar(); });
  };
  function pedirNumero({ titulo, etiqueta, valor, entero, max }, fn) {
    const w = ventana({ titulo, html: `<div class="c"><div><label class="k">${esc(etiqueta)}</label><input class="in gr" inputmode="decimal" value="${valor}" autofocus></div><div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9, entero ? '' : ',', 0, '⌫'].map(x => `<button data-t="${x}">${x}</button>`).join('')}</div></div>`, pie: '<button class="b1 sm" data-s>Aceptar</button>' });
    const i = w.q('input'); setTimeout(() => i.select(), 40);
    let nuevo = true;
    w.q('.teclado').onclick = e => { const t = e.target.dataset.t; if (t === undefined || t === '') return; if (t === '⌫') i.value = i.value.slice(0, -1); else { if (nuevo) i.value = ''; i.value += t; } nuevo = false; };
    const ok = () => { let n = numPeso(i.value); if (entero) n = Math.floor(n); if (max && n > max) n = max; w.cerrar(); fn(n); };
    w.q('[data-s]').onclick = ok; i.onkeydown = e => { if (e.key === 'Enter') ok(); };
  }

  // ── Báscula ──────────────────────────────────────────────────────────────
  equipos.addEventListener('peso', e => { const b = $('balanza'), p = e.detail; b.classList.add('viva'); b.classList.toggle('estable', p.estable && p.kg > 0); $('bKg').textContent = fq(p.kg, true); });
  equipos.addEventListener('estado', e => { if (e.detail.bascula !== 'on') { $('balanza').classList.remove('viva', 'estable'); $('bKg').textContent = '— — —'; } });
  function pesar(p, linea) {
    const viva = () => equipos.estado.bascula === 'on' && Date.now() - equipos.peso.en < 2500;
    const w = ventana({ titulo: `<span><i class="fa-solid fa-weight-scale"></i> ${esc(p.nombre)}</span>`, html: `<div class="c"><div class="pesa" id="pz"><div class="kg">0,000</div><div class="im"></div></div><p class="nota" id="pzN" style="text-align:center"></p><div><label class="k">Peso manual (${esc(p.unidad)})</label><input class="in gr" id="pzM" inputmode="decimal" placeholder="0,000" value="${linea ? String(linea.cantidad).replace('.', ',') : ''}"></div></div>`, pie: '<button class="b2" data-n>Cancelar</button><button class="b1 sm" data-s>Agregar</button>', alCerrar: () => { equipos.removeEventListener('peso', ver); clearInterval(t); } });
    const m = w.q('#pzM');
    const valor = () => (m.value.trim() ? Motor.r3(numPeso(m.value)) : viva() ? equipos.peso.kg : 0);
    const ver = () => {
      const v = valor(), est = !m.value.trim() && viva() && equipos.peso.estable && v > 0;
      w.q('#pz').classList.toggle('estable', est); w.q('.kg').textContent = fq(v, true); w.q('.im').textContent = $$(red(v * p.precio));
      w.q('#pzN').textContent = m.value.trim() ? 'Peso digitado a mano' : viva() ? (equipos.peso.estable ? 'Peso estable' : 'Estabilizando…') : D.caja.bascula?.modo === 'ninguna' ? 'Digita el peso' : 'La báscula no está enviando peso';
      w.q('[data-s]').disabled = !(v > 0) || (!m.value.trim() && !est);
    };
    const t = setInterval(ver, 400);
    equipos.addEventListener('peso', ver); m.oninput = ver; ver();
    const ok = () => { const v = valor(); if (!(v > 0) || w.q('[data-s]').disabled) return; w.cerrar(); if (linea) { linea.cantidad = v; linea.brutoFijo = undefined; pintar(); } else agregar(p, { cantidad: v }); };
    w.q('[data-s]').onclick = ok; w.q('[data-n]').onclick = w.cerrar; m.onkeydown = e => { if (e.key === 'Enter') ok(); };
  }
  function panelBascula() {
    const modo = D.caja.bascula?.modo;
    const w = ventana({ titulo: 'Báscula', html: `<div class="c"><div class="pesa"><div class="kg" id="mbK">—</div><div class="im" id="mbE"></div></div>${modo === 'webserial' ? '<button class="b1 sm" id="mbC"><i class="fa-solid fa-plug"></i> Conectar puerto</button>' : `<p class="nota">Esta caja usa el agente local. Estado: <b>${equipos.estado.agente === 'on' ? 'conectado' : 'desconectado'}</b></p>`}<div><label class="k">Monitor de trama (lo que envía la báscula)</label><div class="mono" id="mbT"></div></div><p class="nota">Si el peso no aparece o es incorrecto, ajusta perfil, velocidad o expresión en Administración → Cajas.</p></div>`, alCerrar: () => clearInterval(t) });
    const ver = () => { w.q('#mbK').textContent = equipos.estado.bascula === 'on' ? fq(equipos.peso.kg, true) + ' kg' : '—'; w.q('#mbE').textContent = equipos.estado.bascula === 'on' ? (equipos.peso.estable ? 'Estable' : 'Leyendo') : 'Sin conexión'; const m = w.q('#mbT'); m.textContent = equipos.trazas.slice(-40).join('\n') || 'Sin datos todavía'; m.scrollTop = 1e9; };
    const t = setInterval(ver, 500); ver();
    w.q('#mbC')?.addEventListener('click', () => equipos.conectarSerial().then(() => toast('Báscula conectada')).catch(e => e.name !== 'NotFoundError' && toast(e.message, 'mal')));
  }
  $('balanza').onclick = panelBascula;

  // ── Cliente ──────────────────────────────────────────────────────────────
  async function ponerCliente(c) {
    V.cliente = c; V.juego = null; V.puntosRedimir = 0; V.recompensa = null; pintar();
    if (enLinea) { const r = await api('/pos/clientes/' + c._id); if (r.success && V.cliente?._id === c._id) { V.cliente = r.data.cliente; V.juego = D.empresa.modulos.gamificacion ? r.data.juego : null; pintar(); } }
  }
  async function buscarCliente(q) { const r = await api('/clientes/buscar?q=' + encodeURIComponent(q)); if (!r.success) return toast(r.error, 'mal'); if (r.data.length === 1) { ponerCliente(r.data[0]); toast('Cliente: ' + r.data[0].nombre); } else toast('Cliente no encontrado', 'mal'); }
  function panelCliente() {
    if (V.cliente) return fichaCliente();
    if (!enLinea) return toast('Para buscar clientes necesitas conexión', 'mal');
    const w = ventana({ titulo: 'Cliente', html: `<div class="c"><input class="in" id="cq" placeholder="Nombre, documento, celular o QR de la app" autocomplete="off" autofocus><div class="lista" id="cl"></div></div>`, pie: '<button class="b2" data-f><i class="fa-solid fa-file-invoice"></i> Solo factura a nombre</button><button class="b1 sm" data-n><i class="fa-solid fa-user-plus"></i> Nuevo</button>' });
    let t, ult = [];
    const buscar = async () => { const q = w.q('#cq').value.trim(); if (q.length < 2) { w.q('#cl').innerHTML = ''; return; } const r = await api('/clientes/buscar?q=' + encodeURIComponent(q)); if (!r.success) return toast(r.error, 'mal'); ult = r.data; w.q('#cl').innerHTML = ult.map((c, i) => `<button class="fila" data-i="${i}"><span class="d"><b>${esc(c.nombre)}</b><small>${esc([c.documento, c.telefono].filter(Boolean).join(' · '))}</small></span><span class="num">${fq(c.puntos)} pts</span></button>`).join('') || '<p class="nota">Sin resultados. Puedes crearlo con el botón Nuevo.</p>'; };
    w.q('#cq').oninput = () => { clearTimeout(t); t = setTimeout(buscar, 220); };
    w.alLeer = c => { w.q('#cq').value = c; buscar().then(() => { if (ult.length === 1) { w.cerrar(); ponerCliente(ult[0]); } }); };
    w.q('#cl').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { w.cerrar(); ponerCliente(ult[b.dataset.i]); } };
    w.q('[data-n]').onclick = () => { const q = w.q('#cq').value; w.cerrar(); formCliente({ [/^\d+$/.test(q) ? 'documento' : 'nombre']: /^KC-/i.test(q) ? '' : q }); };
    w.q('[data-f]').onclick = () => { w.cerrar(); formFactura(); };
  }
  const opTipos = v => D.pais.tiposDocumento.map(t => `<option value="${esc(t.codigo)}" ${t.codigo === v ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('');
  function formCliente(c = {}) {
    const w = ventana({ titulo: c._id ? 'Editar cliente' : 'Nuevo cliente', html: `<div class="c"><div><label class="k">Nombre completo</label><input class="in" id="fN" value="${esc(c.nombre || '')}"></div><div class="dos"><div><label class="k">Tipo de documento</label><select class="in" id="fT">${opTipos(c.tipoDocumento)}</select></div><div><label class="k">Documento</label><input class="in" id="fD" value="${esc(c.documento || '')}"></div><div><label class="k">Celular</label><input class="in" id="fC" inputmode="tel" value="${esc(c.telefono || '')}"></div><div><label class="k">Correo</label><input class="in" id="fE" type="email" value="${esc(c.correo || '')}"></div></div><label class="nota" style="display:flex;gap:10px"><input type="checkbox" id="fA" ${c.aceptaDatos ? 'checked' : ''}> El cliente autoriza el tratamiento de sus datos personales</label>${D.empresa.modulos.marketing ? `<label class="nota" style="display:flex;gap:10px"><input type="checkbox" id="fM" ${c.marketing?.whatsapp || c.marketing?.correo ? 'checked' : ''}> Acepta recibir promociones por WhatsApp y correo (puede darse de baja cuando quiera)</label>` : ''}</div>`, pie: '<button class="b1 sm" data-s>Guardar</button>' });
    w.q('[data-s]').onclick = async () => {
      if (!w.q('#fA').checked) return toast('Falta la autorización de datos del cliente', 'mal');
      const body = { nombre: w.q('#fN').value, tipoDocumento: w.q('#fT').value, documento: w.q('#fD').value, telefono: w.q('#fC').value, correo: w.q('#fE').value, aceptaDatos: true, ...(w.q('#fM') && { marketing: { whatsapp: w.q('#fM').checked, correo: w.q('#fM').checked } }) };
      const r = await api('/clientes' + (c._id ? '/' + c._id : ''), { metodo: c._id ? 'PUT' : 'POST', body });
      if (!r.success) return toast(r.error, 'mal');
      w.cerrar(); ponerCliente(r.data);
    };
  }
  function formFactura() {
    const a = V.adquiriente || (V.cliente?.documento ? { tipoDocumento: V.cliente.tipoDocumento, documento: V.cliente.documento, nombre: V.cliente.nombre, correo: V.cliente.correo } : {});
    const w = ventana({ titulo: 'Factura a nombre de', html: `<div class="c"><div class="dos"><div><label class="k">Tipo de documento</label><select class="in" id="aT">${opTipos(a.tipoDocumento)}</select></div><div><label class="k">Número</label><input class="in" id="aD" value="${esc(a.documento || '')}"></div></div><div><label class="k">Nombre o razón social</label><input class="in" id="aN" value="${esc(a.nombre || '')}"></div><div><label class="k">Correo para enviar la factura</label><input class="in" id="aE" type="email" value="${esc(a.correo || '')}"></div></div>`, pie: `${V.adquiriente ? '<button class="b2 peligro" data-q>Quitar</button>' : ''}<button class="b1 sm" data-s>Usar estos datos</button>` });
    w.q('[data-q]')?.addEventListener('click', () => { V.adquiriente = null; w.cerrar(); pintar(); });
    w.q('[data-s]').onclick = () => { const x = { tipoDocumento: w.q('#aT').value, documento: w.q('#aD').value.trim(), nombre: w.q('#aN').value.trim(), correo: w.q('#aE').value.trim() }; if (!x.documento || !x.nombre) return toast('Documento y nombre son obligatorios', 'mal'); V.adquiriente = x; w.cerrar(); pintar(); };
  }
  function fichaCliente() {
    const c = V.cliente, j = V.juego, g = D.empresa.gamificacion || {};
    const tot = calcular().subtotal;
    const maxP = g.valorPunto > 0 ? Math.min(c.puntos, Math.floor(tot * (g.maxPctRedimir ?? 100) / 100 / g.valorPunto)) : 0;
    const w = ventana({ clase: 'l', titulo: `<span class="aro" style="--p:${j?.nivel.avance || 0};--c:${esc(j?.nivel.actual.color || '#05C3DD')}"><span>${esc(iniciales(c.nombre))}</span></span><span>${esc(c.nombre)}</span>`, html: `<div class="c">
      ${j ? `<div class="tres"><div class="fila"><span class="d"><small>Nivel</small><b>${esc(j.nivel.actual.nombre)}</b></span></div><div class="fila"><span class="d"><small>Puntos</small><b class="num">${fq(c.puntos)} <small>(${$$(j.valorPuntos)})</small></b></span></div><div class="fila"><span class="d"><small>Racha semanal</small><b><i class="fa-solid fa-fire" style="color:var(--ambar)"></i> ${c.racha?.semanas || 0}</b></span></div></div>${j.nivel.siguiente ? `<div><div class="barra-p"><i style="width:${j.nivel.avance}%"></i></div><p class="nota" style="margin-top:6px">Le faltan ${fq(j.nivel.faltan)} para ${esc(j.nivel.siguiente.nombre)}</p></div>` : ''}
      ${j.misiones.length ? `<div class="lista">${j.misiones.map(m => `<div class="fila"><i class="fa-solid ${esc(m.icono)}" style="color:${m.completada ? 'var(--verde)' : 'var(--cian)'}"></i><span class="d"><b>${esc(m.nombre)}</b><small>${esc(m.descripcion)}</small><span class="barra-p" style="display:block;margin-top:6px"><i style="width:${Math.round(m.avance * 100 / m.meta)}%"></i></span></span><span class="num">${m.completada ? 'Cumplida' : `+${m.premioPuntos}`}</span></div>`).join('')}</div>` : ''}
      ${V.lineas.length ? `<div class="dos"><div><label class="k">Redimir puntos (máximo ${fq(Math.max(0, maxP))}, mínimo ${fq(g.minimoRedimir || 0)})</label><input class="in" id="rp" inputmode="numeric" value="${V.puntosRedimir || ''}"></div><div><label class="k">Recompensa</label><select class="in" id="rr"><option value="">Ninguna</option>${D.recompensas.filter(r => r.puntos <= c.puntos).map(r => `<option value="${r._id}" ${V.recompensa?._id === r._id ? 'selected' : ''}>${esc(r.nombre)} — ${fq(r.puntos)} pts (−${$$(r.descuento)})</option>`).join('')}</select></div></div>` : ''}` : ''}
      ${D.empresa.modulos.fiado && c.cupo > 0 ? `<div class="fila"><i class="fa-solid fa-handshake" style="color:var(--cian)"></i><span class="d"><b>Fiado</b><small>Debe ${$$(c.deuda)} de ${$$(c.cupo)}</small></span>${c.deuda > 0 ? '<button class="b2" id="ab">Recibir abono</button>' : ''}</div>` : ''}
      </div>`, pie: `<button class="b2 peligro" data-q>Quitar</button><button class="b2" data-e>Editar</button><button class="b2" data-f>${V.adquiriente ? 'Datos de factura' : 'Factura a su nombre'}</button>${j && V.lineas.length ? '<button class="b1 sm" data-s>Aplicar</button>' : ''}` });
    w.q('[data-q]').onclick = () => { V.cliente = V.juego = V.recompensa = null; V.puntosRedimir = 0; w.cerrar(); pintar(); };
    w.q('[data-e]').onclick = () => { w.cerrar(); formCliente(c); };
    w.q('[data-f]').onclick = () => { w.cerrar(); formFactura(); };
    w.q('#ab')?.addEventListener('click', () => { w.cerrar(); abono(c); });
    w.q('[data-s]')?.addEventListener('click', () => {
      const n = Math.floor(num(w.q('#rp').value));
      if (n > maxP) return toast(`Puede redimir hasta ${fq(maxP)} puntos en esta compra`, 'mal');
      if (n > 0 && n < (g.minimoRedimir || 0)) return toast(`El mínimo es ${fq(g.minimoRedimir)} puntos`, 'mal');
      const r = D.recompensas.find(x => x._id === w.q('#rr').value) || null;
      if (n + (r?.puntos || 0) > c.puntos) return toast('No le alcanzan los puntos', 'mal');
      V.puntosRedimir = n; V.recompensa = r; w.cerrar(); pintar();
    });
  }
  function abono(c) {
    pedirNumero({ titulo: `Abono de ${esc(c.nombre)}`, etiqueta: `Debe ${$$(c.deuda)}`, valor: '' }, async () => {});
    const w = ultimaVentana(); const i = w.q('input');
    w.q('[data-s]').onclick = async () => { const r = await api(`/cartera/${c._id}/abonos`, { metodo: 'POST', body: { monto: num(i.value), medio: 'efectivo', turno: D.turno?._id } }); if (!r.success) return toast(r.error, 'mal'); w.cerrar(); toast('Abono recibido. Saldo: ' + $$(r.data.deuda)); equipos.abrirCajon(); if (V.cliente?._id === c._id) ponerCliente(c); };
    i.onkeydown = e => { if (e.key === 'Enter') w.q('[data-s]').click(); };
  }
  $('cli').onclick = panelCliente;

  // ── Autorización de supervisor ───────────────────────────────────────────
  function pedirPin(motivo) {
    return new Promise(ok => {
      let tk = null;
      const w = ventana({ titulo: 'Autorización de supervisor', html: `<div class="c"><p class="nota">${esc(motivo)}</p><input class="in gr" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus></div>`, pie: '<button class="b1 sm" data-s>Autorizar</button>', alCerrar: () => ok(tk) });
      const ir = async () => { const r = await api('/auth/autorizar-pin', { metodo: 'POST', body: { pin: w.q('input').value } }); if (!r.success) { w.q('input').value = ''; return toast(r.error, 'mal'); } tk = r.data.token; toast('Autorizado por ' + r.data.nombre); w.cerrar(); };
      w.q('[data-s]').onclick = ir; w.q('input').onkeydown = e => { if (e.key === 'Enter') ir(); };
    });
  }
  $('bDesc').onclick = () => {
    const tope = D.empresa.pos?.descuentoMaxCajero ?? 0;
    const w = ventana({ titulo: 'Descuento a la venta', html: `<div class="c"><div class="dos"><div><label class="k">Porcentaje</label><input class="in gr" id="dp" inputmode="decimal" autofocus></div><div><label class="k">Valor</label><input class="in gr" id="dv" inputmode="decimal" value="${V.descuentoGlobal || ''}"></div></div><p class="nota">${sesion.user.rol === 'cajero' ? `Hasta ${tope}% sin autorización.` : ''}</p></div>`, pie: '<button class="b2" data-q>Quitar</button><button class="b1 sm" data-s>Aplicar</button>' });
    const base = () => { const g = V.descuentoGlobal; V.descuentoGlobal = 0; const t = calcular().totalProductos; V.descuentoGlobal = g; return t; };
    w.q('#dp').oninput = () => { w.q('#dv').value = red(base() * Math.min(100, numPeso(w.q('#dp').value)) / 100) || ''; };
    w.q('[data-q]').onclick = () => { V.descuentoGlobal = 0; w.cerrar(); pintar(); };
    w.q('[data-s]').onclick = () => { V.descuentoGlobal = Math.min(base(), Math.max(0, num(w.q('#dv').value))); w.cerrar(); pintar(); };
  };
  const descuentoManualPct = c => (c.subtotal > 0 ? (c.lineas.reduce((a, l) => a + l.descuentoManual, 0) + V.descuentoGlobal) * 100 / c.subtotal : 0);

  // ── Ventas en espera (en este equipo) ────────────────────────────────────
  function espera() { try { return JSON.parse(localStorage.getItem('katu_pos_espera:' + idCaja) || '[]'); } catch { return []; } }
  const guardarEspera = l => localStorage.setItem('katu_pos_espera:' + idCaja, JSON.stringify(l));
  $('bEspera').onclick = () => {
    if (V.lineas.length) { guardarEspera([...espera(), { ...V, en: Date.now() }]); V = nueva(); sel = null; pintar(); return toast('Venta en espera'); }
    const l = espera();
    const w = ventana({ titulo: 'Ventas en espera', html: `<div class="c"><div class="lista">${l.map((v, i) => `<button class="fila" data-i="${i}"><span class="d"><b>${esc(v.cliente?.nombre || 'Sin cliente')}</b><small>${new Date(v.en).toLocaleTimeString(D.pais.locale)} · ${v.lineas.length} líneas</small></span><i class="fa-solid fa-play"></i></button>`).join('')}</div></div>` });
    w.q('.lista').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; V = { ...nueva(), ...l[b.dataset.i] }; guardarEspera(l.filter((x, i) => i !== Number(b.dataset.i))); w.cerrar(); pintar(); };
  };
  $('bVaciar').onclick = async () => { if (await confirmar('Vaciar la venta', 'Se quitarán todos los productos de esta venta.', 'Vaciar')) { V = nueva(); sel = null; pintar(); } };

  // ── Cobro ────────────────────────────────────────────────────────────────
  async function cobrar() {
    if (!V.lineas.length || hayVentana()) return;
    if (!D.turno) return abrirTurno();
    const c = calcular();
    if (sesion.user.rol === 'cajero' && descuentoManualPct(c) > (D.empresa.pos?.descuentoMaxCajero ?? 0) + 0.001) {
      if (!enLinea) return toast('Sin conexión no se puede autorizar ese descuento', 'mal');
      V.autorizacion = await pedirPin(`El descuento es del ${Math.round(descuentoManualPct(c))}%.`);
      if (!V.autorizacion) return;
    }
    const idVenta = V.uuid || (V.uuid = uuid());
    const pagos = V.pagos || (V.pagos = []);
    let medio = null, cobro = null, polling = null, consultando = false, ocupado = false;
    const soloEf = extra => [...pagos, ...(extra ? [extra] : [])].every(p => p.tipo === 'efectivo');
    const total = tipo => (D.empresa.pos?.redondearEfectivo && soloEf(tipo ? { tipo } : null) && (tipo === 'efectivo' || (!tipo && pagos.length)) ? Motor.redondearEfectivo(c.total, D.pais.redondeoEfectivo, D.pais.decimales) : c.total);
    const pagado = () => Motor.sumar(pagos.map(p => p.monto), D.pais.decimales);
    const falta = tipo => red(Math.max(0, total(tipo) - pagado()));
    const w = ventana({ clase: 'l', titulo: 'Cobrar', html: `<div class="cobro" style="min-height:0;overflow:hidden"><div class="iz" id="ms"></div><div class="de" id="mp"></div></div>`, alCerrar: () => { clearInterval(polling); if (cobro?.estado === 'pendiente') { const venta = V, x = cobro, m = medio; api(`/cobros/${x._id}/cancelar`, { metodo: 'POST' }).then(r => { if (r.data?.estado === 'aprobado' && V === venta) { pagos.push({ medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: x.monto, cobro: x._id }); toast('El pago sí fue aprobado: vuelve a Cobrar para terminar'); pintar(); } }); } pintar(); } });

    const disponible = m => {
      if (!enLinea && (m.tipo === 'qr' || m.tipo === 'fiado')) return false;
      if (m.tipo === 'fiado') return !!V.cliente && V.cliente.cupo - V.cliente.deuda >= falta() && falta() > 0;
      return true;
    };
    function pintarMedios() { w.q('#ms').innerHTML = D.medios.map(m => `<button class="medio ${medio?.codigo === m.codigo ? 'on' : ''}" data-m="${esc(m.codigo)}" ${disponible(m) ? '' : 'disabled'}><i class="fa-solid ${esc(m.icono || 'fa-coins')}"></i>${esc(m.nombre)}</button>`).join('') + pagos.map((p, i) => `<div class="pagado"><i class="fa-solid fa-check" style="color:var(--verde)"></i>${esc(p.nombre)}<b class="num">${$$(p.monto)}</b>${p.cobro ? '' : `<button data-q="${i}" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>`}</div>`).join(''); }
    w.q('#ms').onclick = async e => {
      const q = e.target.closest('[data-q]'); if (q) { pagos.splice(Number(q.dataset.q), 1); return elegir(medio); }
      const b = e.target.closest('[data-m]'); if (b && !ocupado) { await soltarCobro(); elegir(D.medios.find(m => m.codigo === b.dataset.m)); }
    };
    async function soltarCobro() { clearInterval(polling); if (cobro?.estado === 'pendiente') { const r = await api(`/cobros/${cobro._id}/cancelar`, { metodo: 'POST' }); if (r.success && r.data.estado === 'aprobado') return aprobado(r.data); } cobro = null; }
    function elegir(m) {
      medio = m; pintarMedios();
      const f = falta(m.tipo), P = w.q('#mp');
      const cab = `<div class="falta"><span>${pagos.length ? 'Falta por pagar' : 'Total a pagar'}</span><b>${$$(f)}</b></div>`;
      visor({ tipo: 'cobro', total: $$(f), medio: m.nombre });
      if (m.tipo === 'efectivo') {
        const kiosco = D.equipos.find(x => x.tipo === 'kiosco_efectivo');
        P.innerHTML = `${cab}<div><label class="k">Recibido</label><input class="in gr" id="rc" inputmode="decimal" placeholder="${$$(f)}" autofocus></div><div class="billetes">${[f, ...D.pais.billetes.filter(b => b > f), ...(D.pais.billetes.some(b => b > f) ? [] : [Math.ceil(f / D.pais.billetes.at(-1)) * D.pais.billetes.at(-1)])].slice(0, 6).map((b, i) => `<button data-b="${b}">${i ? $$(b) : 'Exacto'}</button>`).join('')}</div><p class="nota" id="cb" style="text-align:center"></p><button class="b1" id="ok">Cobrar</button>${kiosco && enLinea ? '<button class="b2" id="kk"><i class="fa-solid fa-cash-register"></i> Cobrar en el kiosco de efectivo</button>' : ''}`;
        const i = P.querySelector('#rc');
        const ver = () => { const r = i.value.trim() ? num(i.value) : f; const d = red(r - f); P.querySelector('#cb').innerHTML = d >= 0 ? `Cambio <b class="num" style="font-size:22px;color:var(--verde)">${$$(d)}</b>` : `Abona ${$$(r)} y completa con otro medio`; };
        i.oninput = ver; ver(); setTimeout(() => i.focus(), 30);
        const ok = () => { const r = i.value.trim() ? num(i.value) : f; if (!(r > 0)) return; sumar({ medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: Math.min(r, f), recibido: r }); };
        P.querySelector('.billetes').onclick = e => { const b = e.target.closest('[data-b]'); if (b) { i.value = b.dataset.b; ver(); ok(); } };
        P.querySelector('#ok').onclick = ok; i.onkeydown = e => { if (e.key === 'Enter') ok(); };
        P.querySelector('#kk')?.addEventListener('click', () => generar(m, f, 'Introduce los billetes en el kiosco'));
      } else if (m.tipo === 'qr') {
        P.innerHTML = `${cab}<div><label class="k">Valor a cobrar con ${esc(m.nombre)}</label><input class="in gr" id="vl" inputmode="decimal" value="${f}"></div><button class="b1" id="ok"><i class="fa-solid fa-qrcode"></i> Generar QR</button>`;
        P.querySelector('#ok').onclick = () => { const v = Math.min(f, num(P.querySelector('#vl').value)); if (v > 0) generar(m, v, 'El cliente escanea este código con su celular'); };
      } else if (m.tipo === 'datafono' && enLinea && D.equipos.some(x => x.tipo === 'terminal')) {
        P.innerHTML = `${cab}<button class="b1" id="ok"><i class="fa-solid fa-credit-card"></i> Enviar al datáfono</button><button class="b2" id="man">Registrar a mano</button>`;
        P.querySelector('#ok').onclick = () => generar(m, f, 'Acerca o inserta la tarjeta en el datáfono'); P.querySelector('#man').onclick = () => manual(m, f, cab);
      } else manual(m, f, cab);
    }
    function manual(m, f, cab) {
      const P = w.q('#mp');
      P.innerHTML = `${cab}<div class="dos"><div><label class="k">Valor</label><input class="in" id="vl" inputmode="decimal" value="${f}"></div>${m.tipo === 'fiado' ? `<div><label class="k">Cupo disponible</label><input class="in" disabled value="${$$(V.cliente ? V.cliente.cupo - V.cliente.deuda : 0)}"></div>` : `<div><label class="k">${m.tipo === 'datafono' ? 'Código de autorización' : 'Referencia'}</label><input class="in" id="rf" autofocus></div>`}</div><button class="b1" id="ok">Registrar pago</button>`;
      P.querySelector('#ok').onclick = () => { const v = Math.min(f, num(P.querySelector('#vl').value)); if (v > 0) sumar({ medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: v, referencia: P.querySelector('#rf')?.value || '' }); };
    }
    async function generar(m, monto, texto) {
      if (ocupado) return; ocupado = true;
      const P = w.q('#mp'); P.innerHTML = `<div class="qr" style="padding:50px 0"><div class="girando"></div><p class="nota">Conectando…</p></div>`;
      const r = await api('/cobros', { metodo: 'POST', body: { caja: idCaja, medio: m.codigo, monto }, espera: 45000 });
      ocupado = false;
      if (!r.success) { toast(r.error, 'mal'); return elegir(m); }
      cobro = r.data;
      P.innerHTML = `<div class="falta"><span>${esc(m.nombre)}</span><b>${$$(monto)}</b></div><div class="qr">${cobro.qrBase64 ? `<img src="${esc(cobro.qrBase64)}" alt="Código QR de pago">` : '<div class="girando"></div>'}<p class="nota">${esc(texto)}</p><p class="nota num" id="rs"></p></div><button class="b2" id="cn">Cancelar este cobro</button>`;
      visor({ tipo: 'qr', total: $$(monto), medio: m.nombre, qr: cobro.qrBase64, texto });
      P.querySelector('#cn').onclick = async () => { await soltarCobro(); if (medio) elegir(medio); };
      const fin = new Date(cobro.expiraEn).getTime();
      polling = setInterval(async () => {
        const rs = P.querySelector('#rs'); if (rs) { const s = Math.max(0, Math.round((fin - Date.now()) / 1000)); rs.textContent = cobro.recibido ? `Recibido ${$$(cobro.recibido)} de ${$$(monto)}` : `Vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
        if (consultando) return; consultando = true;
        const x = await api('/cobros/' + cobro._id); consultando = false;
        if (!x.success || !cobro) return;
        cobro = x.data;
        if (cobro.estado === 'aprobado') aprobado(cobro, m);
        else if (cobro.estado !== 'pendiente') { clearInterval(polling); toast({ rechazado: 'Pago rechazado', cancelado: 'Pago cancelado', expirado: 'El cobro venció' }[cobro.estado], 'mal'); cobro = null; elegir(m); }
      }, 2000);
    }
    function aprobado(x, m) { clearInterval(polling); m = m || medio; cobro = null; sumar({ medio: m.codigo, nombre: m.nombre, tipo: m.tipo, monto: x.monto, cobro: x._id, referencia: x.autorizacion, recibido: x.recibido || undefined }); }
    function sumar(p) {
      pagos.push(p); sonido(true);
      bd.guardar('venta:' + idCaja, JSON.parse(JSON.stringify(V))).catch(() => {}); // un QR ya pagado no se pierde si se cierra la ventana
      // Al mezclar efectivo con otro medio se pierde el redondeo: el total vuelve al exacto
      if (pagado() >= total()) return finalizar();
      elegir(D.medios.find(m => m.codigo !== p.medio && disponible(m)) || medio);
    }
    async function finalizar() {
      if (ocupado) return; ocupado = true;
      const dif = red(pagado() - total());
      if (dif > 0) { const ef = [...pagos].reverse().find(p => p.tipo === 'efectivo' && p.monto > dif); if (ef) ef.monto = red(ef.monto - dif); }
      w.fija = true;
      w.q('#mp').innerHTML = `<div class="qr" style="padding:70px 0"><div class="girando"></div><p class="nota">Registrando la venta…</p></div>`;
      const body = {
        uuid: idVenta, turno: D.turno._id, cliente: V.cliente?._id, adquiriente: V.adquiriente, descuentoGlobal: V.descuentoGlobal, puntosRedimir: V.puntosRedimir || undefined, recompensa: V.recompensa?._id, autorizacion: V.autorizacion,
        items: V.lineas.map(l => ({ producto: l.producto, cantidad: l.cantidad, presentacion: l.presentacion, descuentoManual: l.descuentoManual, brutoFijo: l.brutoFijo })),
        pagos: pagos.map(p => ({ medio: p.medio, monto: p.monto, recibido: p.recibido, referencia: p.referencia, cobro: p.cobro })), fecha: new Date().toISOString(),
      };
      const copia = { calculo: c, pagos: pagos.map(p => ({ ...p })), cliente: V.cliente, adquiriente: V.adquiriente };
      let r = enLinea ? await api('/pos/ventas', { metodo: 'POST', body, espera: 25000 }) : { red: true };
      if (!r.success && r.red) {
        conexion(false);
        const puedeOff = pagos.every(p => ['efectivo', 'datafono', 'manual'].includes(p.tipo) && !p.cobro) && !V.puntosRedimir && !V.recompensa;
        if (!puedeOff && !pagos.some(p => p.cobro)) { ocupado = false; w.fija = false; V.pagos = []; w.cerrar(); return toast('Sin conexión: cobra en efectivo o datáfono, sin puntos', 'mal'); }
        // Con QR ya pagado se guarda tal cual y se envía al volver internet (mismo uuid)
        const off = puedeOff ? { ...body, offline: true, descuentoGlobal: undefined, items: c.lineas.map(l => ({ producto: l.producto, cantidad: l.cantidad, presentacion: l.presentacion, precioUnitario: l.precioUnitario, descuento: l.descuento, brutoFijo: l.brutoFijo })) } : body;
        await bd.encolar({ uuid: idVenta, caja: idCaja, total: c.total, en: Date.now(), body: off });
        contarCola();
        r = { success: true, data: { venta: { numero: 'SIN CONEXIÓN', fecha: body.fecha, total: c.total, items: c.lineas, pagos: copia.pagos.map(p => ({ ...p, cambio: p.recibido != null ? red(p.recibido - p.monto) : undefined })), subtotal: c.subtotal, descuento: c.descuento, impuesto: c.impuesto, base: c.base, documento: { estado: 'no_aplica' }, uuid: idVenta, offline: true }, premio: null } };
      }
      ocupado = false; w.fija = false;
      if (!r.success) {
        toast(r.error, 'mal');
        // Los pagos manuales se rehacen; los QR aprobados se conservan
        V.pagos = pagos.filter(p => p.cobro); if (['TOTAL_CAMBIO', 'SIN_STOCK'].includes(r.codigo)) refrescar();
        return w.cerrar();
      }
      V.lineas.forEach(l => { const p = idx.id.get(l.producto); if (p && p.stock != null) p.stock = Motor.r3(p.stock - l.cantidad * ((p.presentaciones || []).find(x => x._id === l.presentacion)?.factor || 1)); });
      V = nueva(); sel = null; pintar(); pintarProductos(); w.cerrar();
      terminada(r.data.venta, r.data.premio, copia);
    }
    pintarMedios(); elegir(D.medios.find(m => m.tipo === 'efectivo') || D.medios[0]);
  }
  $('bCobrar').onclick = cobrar;

  function terminada(v, premio, copia) {
    const cambio = Motor.sumar(v.pagos.map(p => p.cambio || 0), D.pais.decimales);
    const w = ventana({ titulo: '', html: `<div class="c listo"><div class="ok"><i class="fa-solid fa-check"></i></div><p class="nota">${esc(v.numero)} · ${$$(v.total)}</p>${cambio > 0 ? `<div><p class="nota">Cambio</p><div class="cam num">${$$(cambio)}</div></div>` : '<div class="cam num" style="font-size:30px">Pago completo</div>'}
      ${premio ? `<div class="logros">${premio.ganados ? `<span class="logro"><i class="fa-solid fa-star"></i>+${fq(premio.ganados)} puntos</span>` : ''}${premio.subioNivel ? `<span class="logro"><i class="fa-solid fa-arrow-up"></i>Subió a ${esc(premio.nivel.actual.nombre)}</span>` : ''}${premio.misiones.map(m => `<span class="logro"><i class="fa-solid ${esc(m.icono)}"></i>${esc(m.nombre)} +${m.puntos}</span>`).join('')}${premio.insignias.map(m => `<span class="logro"><i class="fa-solid ${esc(m.icono)}"></i>${esc(m.nombre)}</span>`).join('')}${premio.racha > 1 ? `<span class="logro"><i class="fa-solid fa-fire"></i>Racha de ${premio.racha} semanas</span>` : ''}</div>` : ''}
      <p class="nota" id="fe"></p></div>`, pie: `${premio?.giro ? '<button class="b2" data-g><i class="fa-solid fa-dharmachakra"></i> Ruleta</button>' : ''}<button class="b2" data-i><i class="fa-solid fa-print"></i> Imprimir</button><button class="b1 sm" data-s autofocus>Nueva venta</button>`, alCerrar: () => { clearInterval(t); pintar(); $('buscar').blur(); } });
    visor({ tipo: 'listo', total: $$(v.total), cambio: cambio > 0 ? $$(cambio) : '', puntos: premio?.ganados, cliente: copia.cliente?.nombre, nivel: premio?.subioNivel ? premio.nivel.actual.nombre : '' });
    let doc = null, n = 0, impreso = false;
    const imprimir = () => { impreso = true; equipos.imprimir(tiquete(v, copia, doc), { cajon: v.pagos.some(p => p.tipo === 'efectivo' || p.medio === 'efectivo') }); };
    const espDoc = !v.offline && ['pendiente', 'validacion', 'error'].includes(v.documento?.estado);
    const auto = D.caja.impresora?.automatica && D.caja.impresora?.modo !== 'ninguna';
    if (auto && !espDoc) imprimir();
    // La factura se emite en segundo plano: se espera unos segundos para imprimir su código
    const t = setInterval(async () => {
      if (!espDoc || doc || ++n > 6) { clearInterval(t); if (auto && espDoc && !impreso) imprimir(); return; }
      const r = await api(`/pos/ventas/${v._id}/documento`);
      const fe = w.q('#fe');
      if (r.success && r.data.documento) { doc = r.data; if (fe) fe.textContent = `${D.pais.facturacion.nombreDocumento} ${doc.documento}`; if (auto && !impreso) imprimir(); }
      else if (fe) fe.textContent = r.data?.estado === 'error' ? 'La factura se emitirá automáticamente en unos minutos' : 'Emitiendo factura…';
    }, 1500);
    if (D.caja.impresora?.abrirCajon && !auto && v.pagos.some(p => p.medio === 'efectivo')) equipos.abrirCajon();
    w.q('[data-s]').onclick = w.cerrar; w.q('[data-i]').onclick = imprimir;
    w.q('[data-g]')?.addEventListener('click', e => { e.target.closest('button').remove(); ruleta(v._id); });
    setTimeout(() => w.q('[data-s]').focus(), 60);
  }
  function tiquete(v, copia, doc) {
    const e = D.empresa, L = [];
    L.push({ tx: e.nombre, al: 'c', b: 1, g: 1 }); if (e.razonSocial && e.razonSocial !== e.nombre) L.push({ tx: e.razonSocial, al: 'c' });
    if (e.idFiscal) L.push({ tx: `${D.pais.nombreIdFiscal} ${e.idFiscal}`, al: 'c' });
    L.push({ tx: [D.sede.direccion || e.direccion, D.sede.ciudad || e.ciudad].filter(Boolean).join(', '), al: 'c' }); if (e.telefono) L.push({ tx: `Tel. ${e.telefono}`, al: 'c' });
    L.push({ hr: 1 }, { d: doc ? `${D.pais.facturacion.nombreDocumento}` : 'Comprobante de venta', v: doc?.documento || v.numero, b: 1 }, { d: 'Fecha', v: new Date(v.fecha || Date.now()).toLocaleString(D.pais.locale, { timeZone: e.zonaHoraria, dateStyle: 'short', timeStyle: 'short' }) }, { d: 'Caja', v: `${D.caja.nombre} · ${D.usuario.nombre}` });
    const cf = copia.adquiriente || (copia.cliente ? { nombre: copia.cliente.nombre, documento: copia.cliente.documento } : D.pais.consumidorFinal);
    L.push({ d: 'Cliente', v: cf.nombre }); if (cf.documento) L.push({ d: 'Documento', v: cf.documento });
    L.push({ hr: 1 });
    v.items.forEach(i => { L.push({ tx: i.nombre }); L.push({ d: `  ${fq(i.cantidad, i.porPeso)}${i.porPeso ? ' ' + i.unidad : ''} x ${$$(i.precioUnitario)}`, v: $$(i.total) }); if (i.descuento > 0) L.push({ tx: `  Ahorro ${$$(i.descuento)}` }); });
    L.push({ hr: 1 }); if (v.descuento > 0) L.push({ d: 'Subtotal', v: $$(v.subtotal) }, { d: 'Ahorro', v: '-' + $$(v.descuento) });
    L.push({ d: 'TOTAL', v: $$(v.total), b: 1, g: 1 });
    Object.entries(copia.calculo.porTarifa).forEach(([k, t]) => L.push({ d: `${k} base ${$$(t.base)}`, v: $$(t.impuesto) }));
    L.push({ hr: 1 }); v.pagos.forEach(p => { L.push({ d: p.nombre || p.medio, v: $$(p.recibido ?? p.monto) }); if (p.cambio > 0) L.push({ d: 'Cambio', v: $$(p.cambio) }); });
    if (v.puntosGanados) L.push({ tx: `Ganaste ${fq(v.puntosGanados)} puntos`, al: 'c', b: 1 });
    if (doc?.codigoUnico) L.push({ hr: 1 }, { tx: `${D.pais.facturacion.codigoUnico}: ${doc.codigoUnico}`, al: 'c' }, ...(doc.urlConsulta ? [{ tx: doc.urlConsulta, al: 'c' }] : []));
    if (v.offline) L.push({ tx: 'Venta registrada sin conexión', al: 'c' });
    L.push({ hr: 1 }, { tx: e.pos?.pieTicket || '', al: 'c' });
    return L;
  }
  async function ruleta(venta) {
    const ps = D.empresa.gamificacion.ruleta.premios, n = ps.length, a = 2 * Math.PI / n;
    const w = ventana({ titulo: 'Ruleta de premios', html: `<div class="c listo"><div class="ruleta"><canvas width="600" height="600"></canvas></div><div class="cam num" id="rz" style="font-size:28px;min-height:34px"></div></div>`, pie: '<button class="b1 sm" data-s>Girar</button>' });
    const cv = w.q('canvas'), x = cv.getContext('2d');
    ps.forEach((p, i) => { x.beginPath(); x.moveTo(300, 300); x.arc(300, 300, 290, i * a - Math.PI / 2, (i + 1) * a - Math.PI / 2); x.fillStyle = p.color || '#05C3DD'; x.fill(); x.save(); x.translate(300, 300); x.rotate((i + .5) * a - Math.PI / 2); x.fillStyle = '#fff'; x.font = '700 30px Sora, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(p.nombre, 272, 0); x.restore(); });
    visor({ tipo: 'ruleta', premios: ps });
    w.q('[data-s]').onclick = async e => {
      e.target.disabled = true;
      const r = await api(`/pos/ventas/${venta}/girar`, { metodo: 'POST' });
      if (!r.success) { toast(r.error, 'mal'); return w.cerrar(); }
      const giro = 360 * 6 + 360 - (r.data.indice + .5) * 360 / n;
      cv.style.transform = `rotate(${giro}deg)`; visor({ tipo: 'giro', giro, premio: r.data.premio, puntos: r.data.puntos, premios: ps });
      setTimeout(() => { if (w.q('#rz')) { w.q('#rz').textContent = r.data.puntos ? `¡Ganó ${r.data.premio}!` : r.data.premio; e.target.disabled = false; e.target.textContent = 'Cerrar'; e.target.onclick = w.cerrar; sonido(true); } }, 4300);
    };
  }

  // ── Sincronización ───────────────────────────────────────────────────────
  async function contarCola() { const l = (await bd.cola()).filter(x => x.caja === idCaja); pendientes = l.length; conexion(enLinea); return l; }
  let sinc = false;
  async function sincronizar() {
    if (sinc) return; sinc = true;
    try {
      const h = await api('/health', { espera: 5000 });
      const antes = enLinea; conexion(!!h.success);
      if (!enLinea) return;
      const l = await contarCola();
      for (const x of l.filter(y => !y.error)) {
        const r = await api('/pos/ventas', { metodo: 'POST', body: x.body, espera: 25000 });
        if (r.success) { await bd.sacar(x.uuid); toast('Venta sincronizada: ' + r.data.venta.numero); }
        else if (r.red) { conexion(false); break; }
        else if (r.http === 401) { toast('Vuelve a iniciar sesión para sincronizar las ventas', 'mal'); break; }
        else await bd.encolar({ ...x, error: r.error });
      }
      await contarCola();
      if (!antes && enLinea) refrescar();
    } finally { sinc = false; }
  }
  async function refrescar() { const r = await api('/pos/arranque/' + idCaja); if (!r.success) return; D = r.data; await bd.guardar('arranque:' + idCaja, D); indexar(); V.lineas.forEach(l => { const p = idx.id.get(l.producto); if (p && !l.brutoFijo) { const pr = (p.presentaciones || []).find(x => x._id === l.presentacion); l.precioUnitario = pr ? pr.precio : p.precio; } }); pintarRiel(); pintarProductos(); pintar(); }
  window.addEventListener('online', sincronizar); window.addEventListener('offline', () => conexion(false));
  $('red').onclick = async () => {
    const l = await contarCola();
    const w = ventana({ titulo: 'Conexión y sincronización', html: `<div class="c"><p class="nota">${enLinea ? 'La caja está en línea.' : 'La caja trabaja sin conexión: puedes vender en efectivo y datáfono. Todo se sincroniza solo al volver internet.'}</p><div class="lista">${l.map(x => `<div class="fila"><span class="d"><b>${$$(x.total)}</b><small>${new Date(x.en).toLocaleString(D.pais.locale)}${x.error ? ` · ${esc(x.error)}` : ''}</small></span>${x.error ? `<button class="b2" data-r="${x.uuid}">Reintentar</button>` : ''}</div>`).join('') || '<p class="nota bien">No hay ventas por sincronizar.</p>'}</div></div>`, pie: '<button class="b1 sm" data-s>Actualizar catálogo</button>' });
    w.el.addEventListener('click', async e => { const b = e.target.closest('[data-r]'); if (b) { const x = l.find(y => y.uuid === b.dataset.r); delete x.error; await bd.encolar(x); w.cerrar(); sincronizar(); } });
    w.q('[data-s]').onclick = async () => { w.cerrar(); await sincronizar(); await refrescar(); toast('Catálogo actualizado'); };
  };

  // ── Turno ────────────────────────────────────────────────────────────────
  function abrirTurno() {
    if (!enLinea) return toast('Para abrir turno necesitas conexión', 'mal');
    const w = ventana({ titulo: 'Abrir turno', html: `<div class="c"><p class="nota">Cuenta el efectivo con el que empieza la caja.</p><div><label class="k">Base en efectivo</label><input class="in gr" inputmode="decimal" placeholder="0" autofocus></div></div>`, pie: '<button class="b1 sm" data-s>Abrir turno</button>' });
    const ir = async () => { const r = await api('/turnos', { metodo: 'POST', body: { caja: idCaja, base: num(w.q('input').value) } }); if (!r.success) return toast(r.error, 'mal'); D.turno = { ...r.data, cajero: { _id: D.usuario._id, nombre: D.usuario.nombre } }; bd.guardar('arranque:' + idCaja, D); w.cerrar(); toast('Turno abierto'); };
    w.q('[data-s]').onclick = ir; w.q('input').onkeydown = e => { if (e.key === 'Enter') ir(); };
  }
  async function cerrarTurno() {
    if ((await contarCola()).length) return toast('Primero sincroniza las ventas pendientes', 'mal');
    const r = await api(`/turnos/${D.turno._id}/resumen`); if (!r.success) return toast(r.error, 'mal');
    const s = r.data, medios = s.ciego ? s.medios : Object.keys(s.esperado);
    const nom = k => D.medios.find(m => m.codigo === k)?.nombre || k;
    const w = ventana({ titulo: 'Cerrar turno', html: `<div class="c"><p class="nota">${s.ventas} ventas en este turno. Cuenta lo que tienes por cada medio de pago.</p>${medios.map(k => `<div class="dos" style="align-items:end"><div><label class="k">${esc(nom(k))}${s.ciego ? '' : ` — esperado ${$$(s.esperado[k])}`}</label><input class="in" data-k="${esc(k)}" inputmode="decimal" placeholder="0"></div></div>`).join('')}<div><label class="k">Observaciones</label><textarea class="in" id="nt"></textarea></div></div>`, pie: '<button class="b2" data-n>Cancelar</button><button class="b1 sm" data-s>Cerrar turno</button>' });
    w.q('[data-n]').onclick = w.cerrar;
    w.q('[data-s]').onclick = async () => {
      if (!await confirmar('¿Cerrar el turno?', 'Después de cerrar no se pueden registrar más ventas en él.', 'Cerrar turno')) return;
      const contado = Object.fromEntries(w.qq('[data-k]').map(i => [i.dataset.k, num(i.value)]));
      const x = await api(`/turnos/${D.turno._id}/cerrar`, { metodo: 'POST', body: { contado, notas: w.q('#nt').value } });
      if (!x.success) return toast(x.error, 'mal');
      w.cerrar(); const a = x.data.arqueo;
      const L = [{ tx: D.empresa.nombre, al: 'c', b: 1 }, { tx: 'CIERRE DE TURNO', al: 'c', b: 1 }, { d: 'Caja', v: D.caja.nombre }, { d: 'Cajero', v: D.usuario.nombre }, { d: 'Cierre', v: new Date(x.data.cerradoEn).toLocaleString(D.pais.locale, { timeZone: D.empresa.zonaHoraria }) }, { hr: 1 }, { d: 'Ventas', v: String(a.ventas) }, { d: 'Total vendido', v: $$(a.total) }, { hr: 1 }, ...Object.keys(a.contado).flatMap(k => [{ tx: nom(k), b: 1 }, { d: '  Contado', v: $$(a.contado[k]) }, { d: '  Esperado', v: $$(a.esperado[k] || 0) }, { d: '  Diferencia', v: $$(a.diferencia[k]) }]), { hr: 1 }, { d: 'Diferencia total', v: $$(a.diferenciaTotal), b: 1 }];
      const v = ventana({ titulo: 'Turno cerrado', fija: true, html: `<div class="c listo"><p class="nota">Diferencia</p><div class="cam num" style="color:${a.diferenciaTotal ? 'var(--ambar)' : 'var(--verde)'}">${$$(a.diferenciaTotal)}</div></div>`, pie: '<button class="b2" data-i>Imprimir</button><button class="b1 sm" data-s>Salir de la caja</button>' });
      v.q('[data-i]').onclick = () => equipos.imprimir(L); v.q('[data-s]').onclick = () => { localStorage.removeItem('katu_pos_caja'); location.replace('index.html'); };
    };
  }
  function movimiento() {
    const w = ventana({ titulo: 'Movimiento de efectivo', html: `<div class="c"><div class="dos"><div><label class="k">Tipo</label><select class="in" id="mt"><option value="egreso">Salida de dinero</option><option value="ingreso">Entrada de dinero</option></select></div><div><label class="k">Valor</label><input class="in" id="mv" inputmode="decimal" autofocus></div></div><div><label class="k">Concepto</label><input class="in" id="mc"></div></div>`, pie: '<button class="b1 sm" data-s>Registrar</button>' });
    w.q('[data-s]').onclick = async () => { const r = await api(`/turnos/${D.turno._id}/movimientos`, { metodo: 'POST', body: { tipo: w.q('#mt').value, monto: num(w.q('#mv').value), concepto: w.q('#mc').value } }); if (!r.success) return toast(r.error, 'mal'); w.cerrar(); equipos.abrirCajon(); toast('Movimiento registrado'); };
  }

  // ── Devolución desde la caja ─────────────────────────────────────────────
  function devolucion() {
    const w = ventana({ titulo: 'Devolución', clase: 'l', html: `<div class="c"><input class="in" id="dq" placeholder="Número de venta (V-000123), factura o cliente" autofocus><div id="dr" class="lista"></div></div>` });
    let t;
    w.q('#dq').oninput = () => { clearTimeout(t); t = setTimeout(async () => { const q = w.q('#dq').value.trim(); if (q.length < 3) return; const r = await api('/ventas?q=' + encodeURIComponent(q)); if (!r.success) return toast(r.error, 'mal'); w.q('#dr').innerHTML = r.data.items.map(v => `<button class="fila" data-v="${v._id}" ${v.estado === 'anulada' ? 'disabled' : ''}><span class="d"><b>${esc(v.numero)}</b><small>${new Date(v.fecha).toLocaleString(D.pais.locale, { timeZone: D.empresa.zonaHoraria })} · ${esc(v.clienteNombre || '')} ${v.estado === 'anulada' ? '· anulada' : ''}</small></span><span class="num">${$$(v.total)}</span></button>`).join('') || '<p class="nota">Sin resultados</p>'; }, 300); };
    w.q('#dr').onclick = async e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      const r = await api('/ventas/' + b.dataset.v); if (!r.success) return toast(r.error, 'mal');
      const v = r.data.venta; w.cerrar();
      const x = ventana({ titulo: `Devolver — ${esc(v.numero)}`, clase: 'l', html: `<div class="c"><div class="lista">${v.items.map(i => { const q = Motor.r3(i.cantidad - i.cantidadDevuelta); return `<div class="fila"><span class="d"><b>${esc(i.nombre)}</b><small>Disponible ${fq(q, i.porPeso)} · ${$$(i.total)}</small></span><input class="in" style="width:110px" data-i="${i._id}" data-m="${q}" inputmode="decimal" value="0"></div>`; }).join('')}</div><div class="dos"><div><label class="k">Devolver el dinero por</label><select class="in" id="xm">${D.medios.filter(m => m.tipo !== 'qr').map(m => `<option value="${m.codigo}" ${v.pagos[0]?.medio === m.codigo ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></div><div><label class="k">Motivo</label><input class="in" id="xn"></div></div></div>`, pie: '<button class="b2" data-t>Todo</button><button class="b1 sm" data-s>Devolver</button>' });
      x.q('[data-t]').onclick = () => x.qq('[data-i]').forEach(i => { i.value = String(i.dataset.m).replace('.', ','); });
      x.q('[data-s]').onclick = async () => {
        const items = x.qq('[data-i]').map(i => ({ item: i.dataset.i, cantidad: numPeso(i.value) })).filter(i => i.cantidad > 0);
        if (!items.length || !x.q('#xn').value.trim()) return toast('Indica cantidades y motivo', 'mal');
        let autorizacion; if (sesion.user.rol === 'cajero') { autorizacion = await pedirPin('Las devoluciones requieren autorización.'); if (!autorizacion) return; }
        const d = await api(`/ventas/${v._id}/devolver`, { metodo: 'POST', body: { items, motivo: x.q('#xn').value, medio: x.q('#xm').value, turno: D.turno?._id, autorizacion } });
        if (!d.success) return toast(d.error, 'mal');
        x.cerrar(); toast('Devuelto ' + $$(d.data.monto)); equipos.abrirCajon(); refrescar();
      };
    };
  }

  // ── Domicilios en la caja ────────────────────────────────────────────────
  let vistos = null;
  const EST = { recibido: 'Nuevo', preparando: 'Preparando', listo: 'Listo', en_camino: 'En camino' };
  async function verPedidos(callado) {
    if (!enLinea) return;
    const r = await api('/pedidos/tablero?sede=' + D.sede._id); if (!r.success) return callado || toast(r.error, 'mal');
    const l = r.data.pedidos, nuevos = l.filter(p => p.estado === 'recibido').length;
    $('bPedidos').innerHTML = `<i class="fa-solid fa-motorcycle"></i>${nuevos ? `<span class="n">${nuevos}</span>` : ''}`;
    const ids = new Set(l.map(p => p._id)); if (vistos && l.some(p => !vistos.has(p._id))) { sonido(true); toast('Llegó un domicilio nuevo'); } vistos = ids;
    if (callado) return;
    const w = ventana({ titulo: 'Domicilios', clase: 'l', html: `<div class="c"><div class="lista">${l.map((p, i) => `<button class="fila" data-i="${i}"><span class="d"><b>${esc(p.numero)} · ${esc(p.contacto.nombre)}</b><small>${esc(p.tipo === 'recoger' ? 'Recoge en tienda' : p.entrega.direccion)} · ${p.items.length} productos${p.tipoPago === 'qr' ? (p.pagado ? ' · pagado' : ' · sin pagar') : ''}</small></span><span class="pastilla">${EST[p.estado]}</span><span class="num">${$$(p.total)}</span></button>`).join('') || '<p class="nota">No hay domicilios activos.</p>'}</div></div>`, pie: '<button class="b2" data-l><i class="fa-solid fa-coins"></i> Liquidar domiciliarios</button>' });
    w.q('.lista').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { w.cerrar(); pedido(l[b.dataset.i], r.data.domiciliarios); } };
    w.q('[data-l]').onclick = () => { w.cerrar(); liquidar(); };
  }
  function pedido(p, domis) {
    const sig = { recibido: ['preparando', 'Empezar a preparar'], preparando: ['listo', 'Marcar listo'], listo: p.tipo === 'recoger' ? ['entregado', 'Entregar y facturar'] : ['en_camino', 'Despachar'] }[p.estado];
    const edit = ['recibido', 'preparando'].includes(p.estado) && !p.pagado;
    const w = ventana({ titulo: `${esc(p.numero)} — ${esc(p.contacto.nombre)}`, clase: 'l', html: `<div class="c"><p class="nota">${esc(p.contacto.telefono)}${p.entrega ? ` · ${esc([p.entrega.direccion, p.entrega.detalle].filter(Boolean).join(', '))}` : ''}${p.entrega?.notas ? ` · ${esc(p.entrega.notas)}` : ''}</p><div class="lista">${p.items.map(i => `<div class="fila"><span class="d"><b>${esc(i.nombre)}</b><small>Pidió ${fq(i.cantidad, i.porPeso)} ${i.porPeso ? esc(i.unidad) : ''}${i.nota ? ` · ${esc(i.nota)}` : ''}</small></span>${edit ? `<input class="in" style="width:120px" data-it="${i._id}" inputmode="decimal" placeholder="${i.porPeso ? 'peso real' : ''}" value="${i.cantidadReal ?? (i.porPeso ? '' : i.cantidad)}">${i.porPeso ? `<button class="ico" data-pz="${i._id}" title="Tomar de la báscula"><i class="fa-solid fa-weight-scale"></i></button>` : ''}` : `<span class="num">${$$(i.total)}</span>`}</div>`).join('')}</div>${p.estado === 'listo' && p.tipo !== 'recoger' ? `<div><label class="k">Domiciliario</label><select class="in" id="dm">${domis.map(d => `<option value="${d._id}" ${d._id === p.domiciliario?._id ? 'selected' : ''}>${esc(d.nombre)}${d.enRuta ? ` (${d.enRuta} en ruta)` : d.disponible ? '' : ' (no disponible)'}</option>`).join('')}</select></div>` : ''}<div class="fila"><span class="d"><small>Domicilio ${$$(p.domicilio)} · ${esc(D.medios.find(m => m.codigo === p.medioPago)?.nombre || p.medioPago)}${p.pagaCon ? ` · paga con ${$$(p.pagaCon)}` : ''}</small><b class="num">${$$(p.total)}</b></span></div></div>`, pie: `<button class="b2 peligro" data-c>Cancelar pedido</button>${edit ? '<button class="b2" data-a>Guardar pesos</button>' : ''}${sig ? `<button class="b1 sm" data-s>${sig[1]}</button>` : ''}` });
    const items = () => w.qq('[data-it]').filter(i => i.value.trim() !== '').map(i => ({ item: i.dataset.it, cantidad: numPeso(i.value) }));
    const guardar = async () => { const r = await api(`/pedidos/${p._id}/alistar`, { metodo: 'PUT', body: { items: items() } }); if (!r.success) toast(r.error, 'mal'); return r.success; };
    w.el.addEventListener('click', e => { const b = e.target.closest('[data-pz]'); if (b) { if (equipos.estado.bascula === 'on' && equipos.peso.estable && equipos.peso.kg > 0) w.q(`[data-it="${b.dataset.pz}"]`).value = equipos.peso.kg; else toast('La báscula no tiene un peso estable', 'mal'); } });
    w.q('[data-a]')?.addEventListener('click', async () => { if (await guardar()) { w.cerrar(); toast('Pesos guardados'); verPedidos(); } });
    w.q('[data-s]')?.addEventListener('click', async () => {
      if (edit && items().length && !(await guardar())) return;
      const r = await api(`/pedidos/${p._id}/estado`, { metodo: 'PUT', body: { estado: sig[0], domiciliario: w.q('#dm')?.value, turno: sig[0] === 'entregado' ? D.turno?._id : undefined } });
      if (!r.success) return toast(r.error, 'mal'); w.cerrar(); toast('Pedido actualizado'); verPedidos();
    });
    w.q('[data-c]').onclick = () => { const x = ventana({ titulo: 'Cancelar pedido', html: `<div class="c">${p.pagado ? '<p class="nota mal">El cliente ya pagó: debes devolverle el dinero por la pasarela.</p>' : ''}<input class="in" placeholder="Motivo" autofocus></div>`, pie: '<button class="b1 sm" data-s>Cancelar pedido</button>' }); x.q('[data-s]').onclick = async () => { const r = await api(`/pedidos/${p._id}/estado`, { metodo: 'PUT', body: { estado: 'cancelado', motivo: x.q('input').value } }); if (!r.success) return toast(r.error, 'mal'); x.cerrar(); w.cerrar(); verPedidos(); }; };
  }
  async function liquidar() {
    const r = await api('/pedidos/por-liquidar'); if (!r.success) return toast(r.error, 'mal');
    const w = ventana({ titulo: 'Liquidar domiciliarios', html: `<div class="c"><div class="lista">${r.data.map((x, i) => `<button class="fila" data-i="${i}"><span class="d"><b>${esc(x.domiciliario?.nombre || 'Sin domiciliario')}</b><small>${x.pedidos.length} pedidos en efectivo</small></span><span class="num">${$$(x.total)}</span></button>`).join('') || '<p class="nota bien">Nadie tiene dinero por entregar.</p>'}</div></div>` });
    w.q('.lista').onclick = async e => { const b = e.target.closest('[data-i]'); if (!b) return; const x = r.data[b.dataset.i]; if (!await confirmar('Recibir efectivo', `Vas a recibir ${$$(x.total)} de ${x.domiciliario.nombre}. Entra a la caja de este turno.`, 'Recibido')) return; const d = await api('/pedidos/liquidar', { metodo: 'POST', body: { domiciliario: x.domiciliario._id, turno: D.turno?._id } }); if (!d.success) return toast(d.error, 'mal'); w.cerrar(); toast('Liquidado ' + $$(d.data.total)); };
  }
  $('bPedidos').onclick = () => verPedidos();

  // ── Liga y menú ──────────────────────────────────────────────────────────
  $('bLiga').onclick = async () => {
    const r = await api('/pos/liga'); if (!r.success) return toast(r.error, 'mal');
    ventana({ titulo: 'Liga de cajeros de hoy', html: `<div class="c"><div class="lista">${r.data.filas.map((f, i) => `<div class="fila" style="${f.yo ? 'border-color:var(--cian)' : ''}"><span class="num" style="font-size:20px;color:${['var(--ambar)', 'var(--t2)', '#C98B5B'][i] || 'var(--t3)'}">${i + 1}</span><span class="d"><b>${esc(f.nombre || '')}</b><small>${f.ventas} ventas · ${Math.round(f.articulos / f.ventas * 10) / 10} productos por venta · ${Math.round(f.conCliente * 100 / f.ventas)}% con cliente</small>${f.avance != null ? `<span class="barra-p" style="display:block;margin-top:6px"><i style="width:${f.avance}%"></i></span>` : ''}</span><span class="num">${f.yo || sesion.user.rol !== 'cajero' ? $$(f.total) : ''}</span></div>`).join('') || '<p class="nota">Todavía no hay ventas hoy.</p>'}</div></div>` });
  };
  $('bMenu').onclick = () => {
    const op = [['fa-window-restore', 'Abrir visor del cliente', () => window.open('visor.html?caja=' + idCaja, 'katu_visor', 'width=1024,height=700')], ['fa-rotate-left', 'Devolución', devolucion], ['fa-money-bill-transfer', 'Entrada o salida de efectivo', movimiento], ['fa-inbox', 'Abrir cajón', () => equipos.abrirCajon() || toast('El cajón se abre con el agente local', 'mal')], ['fa-weight-scale', 'Báscula', panelBascula], ['fa-circle-half-stroke', 'Cambiar tema', cambiarTema], ['fa-expand', 'Pantalla completa', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())], ...(D.turno ? [['fa-lock', 'Cerrar turno', cerrarTurno]] : [['fa-lock-open', 'Abrir turno', abrirTurno]]), ['fa-right-from-bracket', 'Salir', async () => { if (await confirmar('Salir de la caja', 'El turno queda abierto y puedes volver a entrar.', 'Salir')) sesion.salir(); }]];
    const w = ventana({ titulo: esc(D.usuario.nombre), html: `<div class="c"><div class="lista">${op.map((o, i) => `<button class="fila" data-i="${i}"><i class="fa-solid ${o[0]}" style="width:22px;color:var(--cian)"></i><span class="d"><b>${o[1]}</b></span></button>`).join('')}</div></div>` });
    w.q('.lista').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { w.cerrar(); op[b.dataset.i][2](); } };
  };
  $('gran').onclick = () => { if (innerWidth <= 820) $('tiquete').classList.toggle('abierto'); };

  document.addEventListener('keydown', e => {
    if (hayVentana()) return;
    const f = { F2: () => { $('buscar').focus(); $('buscar').select(); }, F4: panelCliente, F8: () => $('bEspera').click(), F9: panelBascula, F12: cobrar }[e.key];
    if (f) { e.preventDefault(); f(); }
  });
  iniciar();
})();
