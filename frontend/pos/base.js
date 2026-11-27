/* base.js — sesión, API, almacenamiento local y ventanas de la caja */
(function () {
  'use strict';
  const API = window.location.origin + '/api/v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iniciales = s => (s || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const $ = id => document.getElementById(id);
  // Claro por defecto (locales con mucha luz); el oscuro queda a un toque
  const aplicarTema = t => {
    document.documentElement.dataset.tema = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'claro' ? '#EEF2F7' : '#060B16');
    const b = document.getElementById('bTema');
    if (b) { b.innerHTML = `<i class="fa-solid ${t === 'claro' ? 'fa-moon' : 'fa-sun'}"></i>`; b.title = t === 'claro' ? 'Tema oscuro' : 'Tema claro'; }
  };
  aplicarTema(localStorage.getItem('katu_pos_tema') || 'claro');

  const sesion = {
    get token() { return localStorage.getItem('katu_pos_token') || ''; },
    get user() { try { return JSON.parse(localStorage.getItem('katu_pos_user') || '{}'); } catch { return {}; } },
    guardar(d) { localStorage.setItem('katu_pos_token', d.token); localStorage.setItem('katu_pos_user', JSON.stringify(d.user)); },
    salir() { ['katu_pos_token', 'katu_pos_user', 'katu_pos_caja'].forEach(k => localStorage.removeItem(k)); location.replace('index.html'); },
  };
  // Sin respuesta del servidor → { success:false, red:true }
  async function api(ruta, { metodo = 'GET', body, espera = 20000 } = {}) {
    let r;
    try {
      r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(sesion.token && { Authorization: 'Bearer ' + sesion.token }) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(espera) });
    } catch { return { success: false, red: true, error: 'Sin conexión con el servidor' }; }
    const d = await r.json().catch(() => null);
    if (!d) return { success: false, red: r.status >= 500, error: 'El servidor no respondió correctamente' };
    d.http = r.status;
    if (d.codigo === 'PRUEBA_VENCIDA') bloqueoPrueba(d.error);
    return d;
  }

  // Prueba gratis: aviso con los días que quedan y bloqueo cuando termina
  function bloqueoPrueba(msj) {
    if ($('bloqueoPrueba')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="bloqueoPrueba" class="bloqueo-prueba"><div><i class="fa-solid fa-lock"></i><h2>Tu prueba gratis terminó</h2><p>${esc(msj || 'El administrador puede elegir un plan en el panel → Mi suscripción, y todo vuelve a funcionar al instante.')}</p><p class="nota">Tus productos, clientes y ventas siguen guardados.</p><a class="b1" href="../admin/suscripcion.html">Ir a Mi suscripción</a></div></div>`);
  }
  function avisoPrueba(dias) {
    if (dias === null || dias === undefined || $('avisoPrueba')) return;
    if (dias <= 0) return bloqueoPrueba();
    document.body.insertAdjacentHTML('beforeend', `<a id="avisoPrueba" class="aviso-prueba ${dias <= 3 ? 'urge' : ''}" href="../admin/suscripcion.html" target="_blank" rel="noopener"><i class="fa-solid fa-hourglass-half"></i>Prueba gratis: ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}</a>`);
  }

  // ── IndexedDB: datos de arranque y cola de ventas sin conexión ──
  const abrirBD = new Promise((ok, mal) => {
    const q = indexedDB.open('katu_pos', 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('datos'); q.result.createObjectStore('cola', { keyPath: 'uuid' }); };
    q.onsuccess = () => ok(q.result); q.onerror = () => mal(q.error);
  });
  const tx = async (almacen, modo, fn) => { const bd = await abrirBD; return new Promise((ok, mal) => { const t = bd.transaction(almacen, modo); const r = fn(t.objectStore(almacen)); t.oncomplete = () => ok(r && r.result); t.onerror = t.onabort = () => mal(t.error); }); };
  const bd = {
    leer: k => tx('datos', 'readonly', s => s.get(k)), guardar: (k, v) => tx('datos', 'readwrite', s => s.put(v, k)),
    cola: () => tx('cola', 'readonly', s => s.getAll()), encolar: v => tx('cola', 'readwrite', s => s.put(v)), sacar: k => tx('cola', 'readwrite', s => s.delete(k)),
  };

  let tt;
  function toast(m, tipo = 'bien') {
    let e = $('toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.append(e); }
    e.className = 'toast ver ' + tipo; e.innerHTML = `<i class="fa-solid ${tipo === 'mal' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>${esc(m)}`;
    clearTimeout(tt); tt = setTimeout(() => e.classList.remove('ver'), 3200);
  }
  // Ventana: cierra con X o Esc (nunca tocando afuera)
  function ventana({ titulo, html, pie = '', clase = '', alCerrar, fija }) {
    const v = document.createElement('div');
    v.className = 'velo';
    v.innerHTML = `<div class="vent ${clase}" role="dialog" aria-modal="true">${titulo ? `<header>${titulo}${fija ? '' : '<button class="ico" data-x aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>'}</header>` : ''}${html}${pie ? `<footer>${pie}</footer>` : ''}</div>`;
    document.body.append(v);
    const w = { el: v, q: s => v.querySelector(s), qq: s => [...v.querySelectorAll(s)], fija, cerrar() { if (!v.isConnected) return; v.remove(); alCerrar && alCerrar(); } };
    v._w = w;
    v.querySelector('[data-x]')?.addEventListener('click', w.cerrar);
    setTimeout(() => (v.querySelector('[autofocus]') || v.querySelector('input:not([type=hidden])'))?.focus(), 30);
    return w;
  }
  const hayVentana = () => !!document.querySelector('.velo');
  const ultimaVentana = () => [...document.querySelectorAll('.velo')].pop()?._w;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const w = ultimaVentana(); if (w && !w.fija) { e.preventDefault(); w.cerrar(); } } });
  function confirmar(titulo, texto, boton = 'Confirmar') {
    return new Promise(ok => {
      let si = false;
      const w = ventana({ titulo: esc(titulo), html: `<div class="c"><p class="nota">${esc(texto)}</p></div>`, pie: `<button class="b2" data-n>Cancelar</button><button class="b1 sm" data-s>${esc(boton)}</button>`, alCerrar: () => ok(si) });
      w.q('[data-n]').onclick = w.cerrar; w.q('[data-s]').onclick = () => { si = true; w.cerrar(); };
    });
  }
  const cambiarTema = () => { const n = document.documentElement.dataset.tema === 'claro' ? 'oscuro' : 'claro'; aplicarTema(n); localStorage.setItem('katu_pos_tema', n); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

  Object.assign(window, { API, esc, iniciales, $, sesion, api, bd, toast, avisoPrueba, ventana, hayVentana, ultimaVentana, confirmar, cambiarTema, uuid });
  if ($('bTema')) { aplicarTema(document.documentElement.dataset.tema); $('bTema').onclick = cambiarTema; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
