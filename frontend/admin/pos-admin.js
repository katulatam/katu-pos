/* pos-admin.js — base compartida del panel /admin (una página por opción del
 * menú). Cada página trae su <main class="content">, declara
 * <body data-pagina="…"> (y data-roles / data-modulo) y espera POS.listo.
 */
(function () {
  'use strict';
  const TOKEN = localStorage.getItem('katu_admin_token');
  if (!TOKEN) { location.replace('index.html'); return; }
  let USER = {}; try { USER = JSON.parse(localStorage.getItem('katu_admin_user') || '{}'); } catch {}
  const ES_SUPER = USER.rol === 'super';
  document.documentElement.dataset.tema = localStorage.getItem('katu_admin_tema') || 'claro';

  const MENU = [
    ['General', [['dashboard', 'Inicio', 'fa-chart-line', 'admin,supervisor'], ['ventas', 'Ventas', 'fa-receipt', 'admin,supervisor'], ['turnos', 'Turnos y arqueos', 'fa-cash-register', 'admin,supervisor'], ['reportes', 'Informes', 'fa-chart-column', 'admin,supervisor']]],
    ['Domicilios', [['whatsapp', 'WhatsApp', 'fa-comments', 'admin,supervisor,asesor', 'whatsapp'], ['pedidos', 'Tablero de pedidos', 'fa-motorcycle', 'admin,supervisor,bodega', 'domicilios'], ['zonas', 'Zonas de cobertura', 'fa-draw-polygon', 'admin', 'domicilios']]],
    ['Catálogo', [['productos', 'Productos', 'fa-box', 'admin,bodega,supervisor'], ['categorias', 'Categorías', 'fa-layer-group', 'admin,bodega'], ['promociones', 'Promociones', 'fa-tags', 'admin']]],
    ['Inventario', [['inventario', 'Existencias', 'fa-warehouse', 'admin,bodega,supervisor'], ['compras', 'Compras', 'fa-truck-ramp-box', 'admin,bodega'], ['reabastecer', 'Reabastecer', 'fa-wand-magic-sparkles', 'admin,bodega,supervisor'], ['vencimientos', 'Vencimientos', 'fa-hourglass-half', 'admin,bodega,supervisor'], ['proveedores', 'Proveedores', 'fa-handshake-angle', 'admin,bodega']]],
    ['Clientes', [['clientes', 'Clientes', 'fa-users', 'admin,supervisor'], ['marketing', 'Marketing', 'fa-bullhorn', 'admin,supervisor', 'marketing'], ['cartera', 'Fiado', 'fa-handshake', 'admin,supervisor', 'fiado'], ['misiones', 'Misiones', 'fa-bolt', 'admin', 'gamificacion'], ['recompensas', 'Recompensas', 'fa-gift', 'admin', 'gamificacion'], ['gamificacion', 'Reglas del juego', 'fa-gamepad', 'admin', 'gamificacion']]],
    ['Ajustes', [['configuracion', 'Configuración', 'fa-sliders', 'admin'], ['suscripcion', 'Mi suscripción', 'fa-crown', 'admin'], ['medios-pago', 'Medios de pago', 'fa-credit-card', 'admin'], ['facturacion', 'Facturación electrónica', 'fa-file-invoice', 'admin,supervisor', 'facturacion'], ['whatsapp-config', 'WhatsApp y mensajes', 'fa-comment-sms', 'admin,supervisor'], ['sedes', 'Sedes', 'fa-store', 'admin'], ['cajas', 'Cajas y equipos', 'fa-desktop', 'admin'], ['dispositivos', 'Kioscos y datáfonos', 'fa-tablet-screen-button', 'admin'], ['usuarios', 'Usuarios', 'fa-user-gear', 'admin']]],
    ['Katú', [['empresas', 'Empresas', 'fa-city', 'super'], ['planes', 'Planes y registros', 'fa-tags', 'super'], ['paises', 'Países', 'fa-earth-americas', 'super'], ['numeros', 'Números de WhatsApp', 'fa-phone', 'super']]],
  ];
  const SIN_EMPRESA = ['empresas', 'paises', 'planes', 'numeros'];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iniciales = s => (s || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const $ = id => document.getElementById(id);
  const POS = { empresa: null, pais: null, medios: [], user: USER, esSuper: ES_SUPER };
  const empSel = () => localStorage.getItem('katu_admin_empresa') || '';
  function salir(qs = '') { ['katu_admin_token', 'katu_admin_user', 'katu_admin_empresa'].forEach(k => localStorage.removeItem(k)); location.replace('index.html' + qs); }
  const cab = extra => ({ Authorization: 'Bearer ' + TOKEN, ...(ES_SUPER && empSel() && { 'x-empresa': empSel() }), ...extra });
  async function api(ruta, metodo = 'GET', body) {
    try {
      const form = body instanceof FormData;
      const r = await fetch(location.origin + '/api/v1' + ruta, { method: metodo, headers: cab(form ? {} : { 'Content-Type': 'application/json' }), body: body ? (form ? body : JSON.stringify(body)) : undefined });
      if (r.status === 401) { salir(); return { success: false, error: 'Sesión vencida' }; }
      const d = await r.json();
      if (d.codigo === 'EMPRESA_INACTIVA') salir('?off=1');
      // Prueba gratis vencida: solo queda "Mi suscripción" para elegir un plan
      if (d.codigo === 'PRUEBA_VENCIDA' && pag !== 'suscripcion') { if (USER.rol === 'admin') location.replace('suscripcion.html'); else salir('?prueba=1'); }
      return d;
    } catch { return { success: false, error: 'No hay conexión con el servidor' }; }
  }
  // Devuelve los datos o avisa el error y devuelve null
  async function datos(...a) { const r = await api(...a); if (!r.success) { toast(r.error, 'mal'); return null; } return r.data; }
  async function descargar(ruta, nombre) {
    const r = await fetch(location.origin + '/api/v1' + ruta, { headers: cab() }).catch(() => null);
    if (!r || !r.ok) return toast('No se pudo descargar', 'mal');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  let tt; function toast(m, t = '') { let e = $('toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.append(e); } e.className = 'toast ver ' + t; e.textContent = m; clearTimeout(tt); tt = setTimeout(() => e.classList.remove('ver'), 3400); }

  // ── Formatos según el país ──
  const dinero = (n, p) => Motor.dinero(n, p || POS.pais);
  const fnum = (n, d) => Number(n || 0).toLocaleString(POS.pais?.locale || 'es-CO', { maximumFractionDigits: d ?? 3 });
  const fecha = (d, op) => (d ? new Date(d).toLocaleString(POS.pais?.locale || 'es-CO', { timeZone: POS.empresa?.zonaHoraria, ...(op || { dateStyle: 'medium', timeStyle: 'short' }) }) : '—');
  const hoy = () => Motor.ahoraEnZona(POS.empresa?.zonaHoraria).fecha;
  const masDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const simbolo = () => `${POS.pais?.moneda || ''}`;

  // ── Ventanas ──
  function modal({ titulo, html, pie, clase = '' }) {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true"><header><span>${titulo}</span><button class="ib" data-x aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button></header><div class="b">${html}</div>${pie ? `<footer>${pie}</footer>` : ''}</div>`;
    document.body.append(v);
    const m = { el: v, q: s => v.querySelector(s), qq: s => [...v.querySelectorAll(s)], cerrar: () => v.remove() };
    v.querySelectorAll('[data-x]').forEach(b => { b.onclick = m.cerrar; });
    setTimeout(() => v.querySelector('.b input:not([type=checkbox]):not([type=color])')?.focus(), 40);
    return m;
  }
  function confirmar(titulo, texto, boton = 'Eliminar') {
    return new Promise(ok => { const m = modal({ clase: 's', titulo: esc(titulo), html: `<p style="color:var(--muted);line-height:1.6">${esc(texto)}</p>`, pie: `<button class="btn" data-x>Cancelar</button><button class="btn p" data-s>${esc(boton)}</button>` }); m.qq('[data-x]').forEach(b => { b.onclick = () => { m.cerrar(); ok(false); }; }); m.q('[data-s]').onclick = () => { m.cerrar(); ok(true); }; });
  }

  // ── Formularios declarativos ──
  // campo: { k, l, t:'texto|numero|dinero|lista|si|area|color|clave|fecha|hora|dias|titulo|multi', op, w, ayuda, req, si:valores=>bool, def }
  const leer = (o, k) => k.split('.').reduce((a, x) => (a == null ? undefined : a[x]), o);
  const poner = (o, k, v) => { const p = k.split('.'); const u = p.pop(); let a = o; p.forEach(x => { a = a[x] = a[x] || {}; }); a[u] = v; };
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const opciones = (op, v) => (typeof op === 'function' ? op() : op || []).map(o => { const [val, tx] = Array.isArray(o) ? o : [o, o]; const on = Array.isArray(v) ? v.map(String).includes(String(val)) : String(v ?? '') === String(val); return `<option value="${esc(val)}" ${on ? 'selected' : ''}>${esc(tx)}</option>`; }).join('');
  function formulario(cont, campos, valores = {}) {
    cont.classList.add('grid');
    cont.innerHTML = campos.map((c, i) => {
      let v = leer(valores, c.k || ''); if (v === undefined || v === null) v = c.def ?? '';
      if (v && typeof v === 'object' && v._id) v = v._id;
      if (c.t === 'titulo') return `<div class="sec" data-c="${i}">${esc(c.l)}</div>`;
      const id = 'c_' + i, w = c.w ? `w${c.w}` : c.t === 'area' || c.t === 'dias' ? 'w12' : '';
      if (c.t === 'si') return `<div class="f ${w}" data-c="${i}"><label class="sw"><input type="checkbox" id="${id}" ${v === true || (v === '' && c.def) ? 'checked' : ''}> ${esc(c.l)}</label>${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</div>`;
      let x;
      if (c.t === 'lista') x = `<select class="in" id="${id}">${c.vacio !== undefined ? `<option value="">${esc(c.vacio)}</option>` : ''}${opciones(c.op, v)}</select>`;
      else if (c.t === 'multi') x = `<select class="in" id="${id}" multiple>${opciones(c.op, v || [])}</select>`;
      else if (c.t === 'area') x = `<textarea class="in" id="${id}">${esc(v)}</textarea>`;
      else if (c.t === 'dias') x = `<div class="chips" id="${id}">${DIAS.map((d, n) => `<button type="button" class="chip ${(v || []).includes(n) ? 'on' : ''}" data-d="${n}">${d}</button>`).join('')}</div>`;
      else x = `<input class="in" id="${id}" type="${{ numero: 'number', dinero: 'number', color: 'color', clave: 'password', fecha: 'date', hora: 'time' }[c.t] || 'text'}" ${c.t === 'dinero' ? `step="${c.paso || 'any'}" min="0"` : c.t === 'numero' ? `step="${c.paso || 'any'}"` : ''} value="${esc(c.t === 'color' && !v ? '#05C3DD' : v)}" ${c.t === 'clave' ? 'autocomplete="new-password"' : ''} placeholder="${esc(c.ph || '')}">`;
      return `<div class="f ${w}" data-c="${i}"><label for="${id}">${esc(c.l)}${c.t === 'dinero' ? ` (${simbolo()})` : ''}</label>${x}${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</div>`;
    }).join('');
    cont.querySelectorAll('.chip').forEach(b => { b.onclick = () => b.classList.toggle('on'); });
    const valor = i => {
      const c = campos[i], e = cont.querySelector('#c_' + i); if (!e) return undefined;
      if (c.t === 'si') return e.checked;
      if (c.t === 'dias') return [...e.querySelectorAll('.on')].map(b => Number(b.dataset.d));
      if (c.t === 'multi') return [...e.selectedOptions].map(o => o.value);
      if (c.t === 'numero' || c.t === 'dinero') return e.value === '' ? (c.nulo ? '' : 0) : Number(e.value);
      return e.value.trim();
    };
    const tomar = () => { const o = {}; campos.forEach((c, i) => { if (c.k) poner(o, c.k, valor(i)); }); return o; };
    const ver = () => { const o = tomar(); campos.forEach((c, i) => { if (c.si) cont.querySelector(`[data-c="${i}"]`).hidden = !c.si(o); }); };
    cont.addEventListener('input', ver); cont.addEventListener('change', ver); ver();
    const campo = k => cont.querySelector('#c_' + campos.findIndex(c => c.k === k));
    return { tomar, campo, ver, validar() { const o = tomar(); for (const c of campos) if (c.req && (!c.si || c.si(o)) && (leer(o, c.k) === '' || leer(o, c.k) == null)) { toast(`Falta: ${c.l}`, 'mal'); return null; } return o; } };
  }
  function tabla(cont, columnas, filas, { vacio = 'No hay registros', icono = 'fa-inbox', clic } = {}) {
    cont.innerHTML = filas.length ? `<div class="tw"><table><thead><tr>${columnas.map(c => `<th class="${c.n ? 'n' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${filas.map((f, i) => `<tr class="${clic ? 'clic' : ''}" data-i="${i}">${columnas.map(c => `<td class="${c.n ? 'n' : ''}">${c.f(f, i) ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<div class="nada"><i class="fa-solid ${icono}"></i>${esc(vacio)}</div>`;
    if (clic) cont.querySelectorAll('tr.clic').forEach(tr => { tr.onclick = e => { if (!e.target.closest('button,a,input,select')) clic(filas[tr.dataset.i]); }; });
  }
  // Página CRUD completa
  function crud({ ruta, titulo, sub, nuevo = 'Nuevo', columnas, campos, preparar, alAbrir, vacio, icono, borrar = true, clase = '', acciones, buscar }) {
    const main = document.querySelector('main.content');
    main.innerHTML = `<div class="head"><div><h1>${esc(titulo)}</h1><p>${esc(sub || '')}</p></div><div class="acts"><button class="btn p" id="crN"><i class="fa-solid fa-plus"></i> ${esc(nuevo)}</button></div></div>${buscar ? '<div class="filtros"><div class="f g"><input class="in" id="crB" placeholder="Buscar"></div></div>' : ''}<div class="card" id="crT"></div>`;
    let filas = [];
    const st = {
      async cargar() { const d = await datos(ruta); if (!d) return; filas = d; pintar(); },
      abrir(f) {
        const m = modal({ clase, titulo: f ? 'Editar' : esc(nuevo), html: '<div id="crF"></div><div id="crX"></div>', pie: `${f && borrar ? '<button class="btn d" data-b style="margin-right:auto"><i class="fa-solid fa-trash"></i> Eliminar</button>' : ''}<button class="btn" data-x2>Cancelar</button><button class="btn p" data-s>Guardar</button>` });
        const fm = formulario(m.q('#crF'), typeof campos === 'function' ? campos(f) : campos, f || {});
        const extra = alAbrir ? alAbrir(m.q('#crX'), f, fm, m) : null;
        m.q('[data-x2]').onclick = m.cerrar;
        m.q('[data-b]')?.addEventListener('click', async () => { if (!await confirmar('Eliminar', 'Esta acción no se puede deshacer.')) return; if (await datos(`${ruta}/${f._id}`, 'DELETE')) { m.cerrar(); toast('Eliminado'); st.cargar(); } });
        m.q('[data-s]').onclick = async e => {
          let o = fm.validar(); if (!o) return;
          if (extra) { const x = extra(); if (x === null) return; Object.assign(o, x); }
          if (preparar) o = preparar(o, f);
          e.target.disabled = true;
          const r = await datos(ruta + (f ? '/' + f._id : ''), f ? 'PUT' : 'POST', o);
          e.target.disabled = false;
          if (r) { m.cerrar(); toast('Guardado'); st.cargar(r); st.alGuardar && st.alGuardar(r, f); }
        };
      },
    };
    const pintar = () => {
      const q = ($('crB')?.value || '').toLowerCase();
      const l = q ? filas.filter(f => JSON.stringify(f).toLowerCase().includes(q)) : filas;
      tabla($('crT'), [...columnas, { t: '', n: 1, f: f => `<div class="ac">${acciones ? acciones(f) : ''}<button class="ib" data-ed="${f._id}" aria-label="Editar"><i class="fa-solid fa-pen"></i></button></div>` }], l, { vacio, icono, clic: st.abrir });
      $('crT').querySelectorAll('[data-ed]').forEach(b => { b.onclick = () => st.abrir(filas.find(f => f._id === b.dataset.ed)); });
    };
    $('crN').onclick = () => st.abrir(null);
    if ($('crB')) $('crB').oninput = pintar;
    return st;
  }
  // Buscador de productos con sugerencias
  function buscarProducto(inp, alElegir) {
    const w = document.createElement('div'); w.className = 'sug'; inp.replaceWith(w); w.append(inp);
    const l = document.createElement('div'); l.className = 'ls'; l.hidden = true; w.append(l);
    let t, r = [];
    const elegir = p => { l.hidden = true; inp.value = ''; alElegir(p); };
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { const q = inp.value.trim(); if (q.length < 2) { l.hidden = true; return; } const d = await datos(`/productos?estado=activos&limite=12&q=${encodeURIComponent(q)}`); if (!d) return; r = d.items; l.innerHTML = r.map((p, i) => `<button type="button" data-i="${i}"><span>${esc(p.nombre)}</span><span class="bd">${esc(p.codigo || p.plu || '')}</span></button>`).join('') || '<button type="button" disabled>Sin resultados</button>'; l.hidden = false; }, 220); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setTimeout(() => { if (r.length) elegir(r[0]); }, 260); } });
    l.onclick = e => { const b = e.target.closest('[data-i]'); if (b) elegir(r[b.dataset.i]); };
    document.addEventListener('click', e => { if (!w.contains(e.target)) l.hidden = true; });
  }
  // ── Gráficos: una serie, un tono, tooltip en cada marca ──
  let tip;
  document.addEventListener('mousemove', e => { const c = e.target.closest?.('[data-tip]'); if (!c) { tip?.remove(); tip = null; return; } if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.append(tip); } tip.innerHTML = c.dataset.tip; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 10, e.clientX + 14) + 'px'; tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px'; });
  function barras(cont, d, { etiqueta, valor, tip: tx, cada = 1 }) { const mx = Math.max(...d.map(valor), 0); const im = d.findIndex(x => valor(x) === mx); cont.innerHTML = `<div class="graf">${d.map((x, i) => `<div class="c ${valor(x) ? '' : 'mt'} ${mx && i === im ? 'mx' : ''}" data-v="${esc(tx(x)[1])}" data-tip="${esc(`<b>${esc(tx(x)[1])}</b>${esc(tx(x)[0])}${tx(x)[2] ? '<br>' + esc(tx(x)[2]) : ''}`)}" tabindex="0" aria-label="${esc(tx(x).filter(Boolean).join(', '))}"><i style="height:${mx ? Math.max(0, valor(x) * 130 / mx) : 0}px"></i><span>${i % cada ? '&nbsp;' : esc(etiqueta(x))}</span></div>`).join('')}</div>`; }
  function barrasH(cont, d, { nombre, valor, texto }) { const mx = Math.max(...d.map(valor), 1); cont.innerHTML = d.length ? `<div class="hb">${d.map(x => `<div class="r"><span>${esc(nombre(x))}</span><b>${esc(texto(x))}</b><div><i style="width:${Math.max(1, valor(x) * 100 / mx)}%"></i></div></div>`).join('')}</div>` : '<div class="nada">Sin datos en este período</div>'; }
  function rango(cont, alCambiar, dias = 0) {
    cont.innerHTML = `<div class="f"><label>Desde</label><input type="date" class="in" id="rD" value="${masDias(hoy(), -dias)}"></div><div class="f"><label>Hasta</label><input type="date" class="in" id="rH" value="${hoy()}"></div><div class="chips" style="align-self:center">${[['Hoy', 0, 0], ['Ayer', 1, 1], ['7 días', 6, 0], ['30 días', 29, 0]].map(x => `<button class="chip" data-a="${x[1]}" data-b="${x[2]}">${x[0]}</button>`).join('')}</div>`;
    cont.onclick = e => { const c = e.target.closest('.chip'); if (!c) return; $('rD').value = masDias(hoy(), -c.dataset.a); $('rH').value = masDias(hoy(), -c.dataset.b); alCambiar(); };
    $('rD').onchange = $('rH').onchange = alCambiar;
    return () => `desde=${$('rD').value}&hasta=${$('rH').value}`;
  }
  const DOC = { no_aplica: ['—', ''], pendiente: ['Por emitir', 'av'], validacion: ['En validación', 'av'], emitida: ['Emitida', 'az'], aceptada: ['Aceptada', 'ok'], observaciones: ['Con observaciones', 'ok'], rechazada: ['Rechazada', 'mal'], error: ['Con error', 'mal'], omitida: ['No facturada', ''] };
  const badgeDoc = e => (!e || e === 'no_aplica' ? '—' : `<span class="bd ${DOC[e]?.[1] || ''}">${DOC[e]?.[0] || e}</span>`);
  const si = (v, a = 'Activo', b = 'Inactivo') => `<span class="bd ${v ? 'ok' : ''}">${v ? a : b}</span>`;

  Object.assign(window, { POS, api, datos, descargar, toast, esc, $, iniciales, dinero, fnum, fecha, hoy, masDias, modal, confirmar, formulario, tabla, crud, buscarProducto, barras, barrasH, rango, badgeDoc, DOC, si, salir, DIAS });

  // ── Estructura ──
  const pag = document.body.dataset.pagina, main = document.querySelector('main.content');
  main.hidden = true;
  function layout(empresas) {
    const puede = (roles, modulo) => (ES_SUPER ? (roles === 'super' || !!POS.empresa) : roles.split(',').includes(USER.rol)) && (!modulo || POS.empresa?.modulos?.[modulo]);
    const asd = document.createElement('aside'); asd.className = 'sidebar';
    asd.innerHTML = `<div class="sb-logo"><i class="fa-solid fa-bolt"></i><div>Katú <span>POS</span></div></div>${POS.empresa ? `<div class="sb-emp"><b>${esc(POS.empresa.nombre)}</b><small>${esc(POS.pais.nombre)} · ${esc(POS.pais.moneda)}</small></div>` : ''}<nav class="sb-nav">${MENU.map(([s, it]) => { const v = it.filter(x => puede(x[3], x[4])); return v.length ? `<div class="nav-sec">${s}</div>` + v.map(x => `<a class="nav-item ${x[0] === pag ? 'on' : ''}" href="${x[0]}.html"><i class="fa-solid ${x[2]}"></i>${x[1]}</a>`).join('') : ''; }).join('')}</nav><div class="sb-user"><div class="av">${esc(iniciales(USER.nombre))}</div><div class="d"><b>${esc(USER.nombre)}</b><small>${{ super: 'Equipo Katú', admin: 'Administración', supervisor: 'Supervisión', bodega: 'Bodega', cajero: 'Caja' }[USER.rol] || ''}</small></div><button id="uClave" title="Cambiar contraseña"><i class="fa-solid fa-key"></i></button><button id="uSalir" title="Cerrar sesión"><i class="fa-solid fa-right-from-bracket"></i></button></div>`;
    const mn = document.createElement('div'); mn.className = 'main';
    mn.innerHTML = `<header class="topbar"><button class="tb hamb" id="hamb" aria-label="Menú"><i class="fa-solid fa-bars"></i></button><div class="sp"></div>${ES_SUPER ? `<select class="tb" id="selE"><option value="">Elige una empresa</option>${Object.entries(empresas.reduce((a, e) => { (a[e.pais] = a[e.pais] || []).push(e); return a; }, {})).map(([p, l]) => `<optgroup label="${esc(p)}">${l.map(e => `<option value="${e._id}" ${e._id === empSel() ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}${POS.empresa ? `<span class="tb oc"><i class="fa-regular fa-clock"></i><span id="reloj"></span></span>${POS.empresa.modulos?.domicilios ? `<a class="tb oc" href="/t/${esc(POS.empresa.slug)}" target="_blank" rel="noopener"><i class="fa-solid fa-store"></i> Tienda</a>` : ''}<a class="tb vivo" href="/pos/" target="_blank" rel="noopener"><i class="fa-solid fa-cash-register"></i> Abrir caja</a>` : ''}<button class="tb" id="tema" title="Cambiar tema" aria-label="Cambiar tema"><i class="fa-solid fa-circle-half-stroke"></i></button></header>`;
    document.body.prepend(asd); main.before(mn); mn.append(main);
    $('hamb').onclick = () => asd.classList.toggle('ab'); $('uSalir').onclick = () => salir();
    $('tema').onclick = () => { const n = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro'; document.documentElement.dataset.tema = n; localStorage.setItem('katu_admin_tema', n); };
    if ($('selE')) $('selE').onchange = e => { localStorage.setItem('katu_admin_empresa', e.target.value); location.href = e.target.value ? (SIN_EMPRESA.includes(pag) ? 'dashboard.html' : location.pathname.split('/').pop()) : 'empresas.html'; };
    $('uClave').onclick = () => { const m = modal({ clase: 's', titulo: 'Cambiar contraseña', html: '<div id="pw"></div>', pie: '<button class="btn p" data-s>Guardar</button>' }); const f = formulario(m.q('#pw'), [{ k: 'passwordActual', l: 'Contraseña actual', t: 'clave', w: 12, req: 1 }, { k: 'passwordNuevo', l: 'Contraseña nueva (mínimo 8)', t: 'clave', w: 12, req: 1 }]); m.q('[data-s]').onclick = async () => { const o = f.validar(); if (o && await datos('/auth/cambiar-password', 'PUT', o)) { m.cerrar(); toast('Contraseña actualizada'); } }; };
    if (POS.empresa) { const r = () => { $('reloj').textContent = new Date().toLocaleTimeString(POS.pais.locale, { timeZone: POS.empresa.zonaHoraria, hour: '2-digit', minute: '2-digit' }); }; r(); setInterval(r, 15000); }
    const tit = MENU.flatMap(x => x[1]).find(x => x[0] === pag); document.title = `${tit ? tit[1] : 'Panel'} — Katú POS`;
    return tit ? puede(tit[3], tit[4]) : true;
  }
  // Barra de la prueba gratis: días que quedan (ámbar los últimos 3) y botón para elegir plan
  function avisoPrueba() {
    const s = POS.empresa?.suscripcion;
    if (!s?.pruebaHasta || s.stripeSuscripcion || !['prueba', 'vencida'].includes(s.estado)) return;
    const dias = Math.max(0, Math.ceil((new Date(s.pruebaHasta) - Date.now()) / 86400000));
    const b = document.createElement('div');
    b.className = 'barra-prueba' + (dias <= 3 ? ' urge' : '');
    const admin = USER.rol === 'admin' || ES_SUPER;
    b.innerHTML = `<i class="fa-solid ${dias ? 'fa-hourglass-half' : 'fa-lock'}"></i><span>${dias ? `Te ${dias === 1 ? 'queda <b>1 día</b>' : `quedan <b>${dias} días</b>`} de prueba gratis con todo el plan.` : '<b>Tu prueba gratis terminó.</b> Tus datos están guardados: elige un plan para seguir vendiendo.'}</span>${admin && pag !== 'suscripcion' ? '<a class="btn sm p" href="suscripcion.html">Elegir mi plan</a>' : ''}`;
    main.before(b);
  }
  // Compra de bolsas de mensajes para marketing (pago único con Stripe; el saldo no vence)
  POS.comprarBolsa = async function (canal) {
    const d = await datos('/cuenta/bolsas'); if (!d) return;
    const fmt = (n, m) => `${m === 'USD' ? 'US$' : '$'}${Number(n).toLocaleString(m === 'COP' ? 'es-CO' : 'en-US', { maximumFractionDigits: 2 })} ${m}`;
    const lista = d.paquetes.filter(p => !canal || p.canal === canal);
    const grupo = c => { const l = lista.filter(p => p.canal === c); return l.length ? `<div class="sec" style="margin:10px 0 6px"><i class="fa-${c === 'whatsapp' ? 'brands fa-whatsapp' : 'solid fa-envelope'}"></i> ${c === 'whatsapp' ? 'WhatsApp' : 'Correo'} <small style="color:var(--muted);font-weight:500">· saldo actual ${fnum(d.saldo[c])}</small></div>${l.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span><b>${fnum(p.cantidad)} ${c === 'whatsapp' ? 'mensajes' : 'correos'}</b><small style="display:block;color:var(--muted)">${fmt(p.porMensaje, p.moneda)} por mensaje</small></span><button class="btn p sm" data-c="${c}" data-n="${p.cantidad}">Comprar · ${fmt(p.precio, p.moneda)}</button></div>`).join('')}` : ''; };
    const m = modal({ titulo: 'Comprar mensajes para marketing', html: lista.length
      ? `<p style="color:var(--muted);font-size:13px;margin:0 0 4px">Pagas una sola vez con tarjeta en Stripe y el saldo se suma al instante. <b>Los mensajes no vencen:</b> los usas cuando quieras en tus campañas.</p>${grupo('whatsapp')}${grupo('correo')}${d.modoPrueba ? '<p style="color:var(--warning);font-size:12.5px;margin-top:10px">Pagos en modo de prueba: usa la tarjeta 4242 4242 4242 4242.</p>' : ''}`
      : '<div class="nada"><i class="fa-solid fa-box-open"></i>Aún no hay paquetes disponibles para tu país. Escríbele al equipo de Katú.</div>',
      pie: '<button class="btn" data-x>Cerrar</button>' });
    m.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      if (!d.pagosDisponibles) return toast('Los pagos no están disponibles en este momento', 'mal');
      b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparando el pago…';
      const r = await datos('/cuenta/bolsas/comprar', 'POST', { canal: b.dataset.c, cantidad: Number(b.dataset.n) });
      if (r?.url) location.href = r.url; else { b.disabled = false; b.textContent = 'Comprar'; }
    });
  };
  POS.listo = (async () => {
    const [c, e] = await Promise.all([api('/configuracion'), ES_SUPER ? api('/empresas') : { data: [] }]);
    if (c.success) { POS.empresa = c.data.empresa; POS.pais = c.data.pais; POS.medios = c.data.medios || []; POS.modoDemo = c.data.modoDemo; }
    if (!POS.empresa && !SIN_EMPRESA.includes(pag)) { if (ES_SUPER) location.replace('empresas.html'); return false; }
    const ok = layout(e.data || []);
    avisoPrueba();
    main.hidden = false;
    if (!ok) { main.innerHTML = '<div class="card"><div class="nada"><i class="fa-solid fa-lock"></i>No tienes acceso a esta opción.</div></div>'; return false; }
    return true;
  })();
})();
