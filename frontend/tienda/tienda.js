/* tienda.js — base de la tienda en línea (catálogo, carrito, cuenta) */
(function () {
  'use strict';
  const API = location.origin + '/api/v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const m = location.pathname.match(/^\/t\/([^/]+)/);
  // /t/<slug>, ?t=<slug> o el subdominio (<slug>.katupos.com)
  const sub = (() => { const p = location.hostname.split('.'); return p.length >= 3 && !['www', 'app'].includes(p[0]) && !/^\d+$/.test(p[0]) ? p[0] : ''; })();
  const slug = m ? decodeURIComponent(m[1]) : new URLSearchParams(location.search).get('t') || sub;
  const token = () => localStorage.getItem('katu_cli_token') || '';
  async function api(ruta, metodo = 'GET', body) {
    try {
      const r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token() && { Authorization: 'Bearer ' + token() }) }, body: body ? JSON.stringify(body) : undefined });
      return { http: r.status, ...(await r.json()) };
    } catch { return { success: false, error: 'No hay conexión. Intenta de nuevo.' }; }
  }
  let tt; function toast(t) { let e = $('toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; document.body.append(e); } e.textContent = t; e.classList.add('ver'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('ver'), 3200); }
  function ventana(titulo, html) { const v = document.createElement('div'); v.className = 'velo'; v.innerHTML = `<div class="vent" role="dialog" aria-modal="true"><header><span>${titulo}</span><button class="x" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button></header>${html}</div>`; document.body.append(v); const w = { q: s => v.querySelector(s), qq: s => [...v.querySelectorAll(s)], cerrar: () => v.remove() }; w.q('.x').onclick = w.cerrar; return w; }
  const carro = {
    leer() { try { return JSON.parse(localStorage.getItem('katu_carro:' + slug) || '{}'); } catch { return {}; } },
    poner(id, q) { const c = this.leer(); if (q > 0) c[id] = Motor.r3(q); else delete c[id]; localStorage.setItem('katu_carro:' + slug, JSON.stringify(c)); },
    vaciar() { localStorage.removeItem('katu_carro:' + slug); },
  };
  const lugar = { leer() { try { return JSON.parse(localStorage.getItem('katu_lugar') || 'null'); } catch { return null; } }, poner(v) { localStorage.setItem('katu_lugar', JSON.stringify(v)); } };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  let D = null;
  async function cargar() {
    const r = await api(`/tienda/t/${encodeURIComponent(slug)}/catalogo`);
    if (!r.success) { document.querySelector('main').innerHTML = `<div class="caja" style="text-align:center;padding:60px 20px"><h2>${esc(r.error)}</h2></div>`; return null; }
    D = r.data; D.idx = new Map(D.productos.map(p => [p._id, p])); D.cats = new Map(D.categorias.map(c => [c._id, c]));
    if (/^#[0-9a-f]{6}$/i.test(D.empresa.color || '') && D.empresa.color.toLowerCase() !== '#05c3dd') document.documentElement.style.setProperty('--c', D.empresa.color);
    document.title = D.empresa.nombre; return D;
  }
  const dinero = n => Motor.dinero(n, D.pais);
  const logo = e => (e.logoUrl ? `<img src="${esc(e.logoUrl)}" alt="">` : esc((e.nombre || 'K')[0]));
  function lineas() { const c = carro.leer(); return Object.entries(c).filter(([id]) => D.idx.has(id) && !D.idx.get(id).agotado).map(([id, q]) => { const p = D.idx.get(id); return { producto: id, categoria: p.categoria, nombre: p.nombre, cantidad: q, precioUnitario: p.precio, porPeso: p.tipo === 'peso', unidad: p.unidad, impuestoTipo: p.impuestoTipo, impuestoPct: p.impuestoPct }; }); }
  const calcular = domicilio => Motor.calcular(lineas(), { decimales: D.pais.decimales, promociones: D.promociones, ahora: Motor.ahoraEnZona(D.empresa.zonaHoraria), domicilio });
  const paso = p => (p.tipo === 'peso' ? 0.25 : 1);
  const cant = (q, p) => (p.tipo === 'peso' || p.porPeso ? `${q.toLocaleString(D.pais.locale)} ${p.unidad}` : q);

  // Mapa para elegir el punto de entrega → Promise({lat,lng,direccion,detalle}) o null
  function elegirLugar(previo, pais) {
    return new Promise(ok => {
      const w = ventana('¿Dónde estás?', `<div class="mapa" style="height:260px"></div><button class="bt s" id="gp" style="margin:10px 0"><i class="fa-solid fa-location-crosshairs"></i> Usar mi ubicación</button><div class="fl"><label class="k">Dirección</label><input class="in" id="di" value="${esc(previo?.direccion || '')}"></div><div class="fl"><label class="k">Apartamento, torre, indicaciones</label><input class="in" id="de" value="${esc(previo?.detalle || '')}"></div><button class="bt" id="ok">Confirmar punto</button>`);
      let p = previo?.lat ? { lat: previo.lat, lng: previo.lng } : null, mk;
      const centro = p || D?.sedes?.find(s => s.ubicacion?.lat)?.ubicacion || { lat: 4.65, lng: -74.06 };
      const mp = L.map(w.q('.mapa')).setView([centro.lat, centro.lng], 15); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mp);
      const poner = () => { mk?.remove(); if (p) { mk = L.marker([p.lat, p.lng], { draggable: true }).addTo(mp); mk.on('dragend', () => { const q = mk.getLatLng(); p = { lat: q.lat, lng: q.lng }; }); } };
      mp.on('click', e => { p = { lat: e.latlng.lat, lng: e.latlng.lng }; poner(); }); setTimeout(() => { mp.invalidateSize(); poner(); }, 60);
      w.q('#gp').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(g => { p = { lat: g.coords.latitude, lng: g.coords.longitude }; mp.setView([p.lat, p.lng], 17); poner(); }, () => toast('No pudimos obtener tu ubicación: toca el mapa')) : toast('Tu navegador no comparte ubicación');
      w.q('.x').onclick = () => { w.cerrar(); ok(null); };
      w.q('#ok').onclick = () => { if (!p) return toast('Toca el mapa para marcar el punto'); const d = w.q('#di').value.trim(); if (!d) return toast('Escribe la dirección'); const v = { ...p, direccion: d, detalle: w.q('#de').value.trim() }; lugar.poner(v); w.cerrar(); ok(v); };
    });
  }
  // Ingreso / registro → Promise(cuenta|null)
  function ingresar(codPais) {
    return new Promise(ok => {
      const w = ventana('Tu cuenta Katú', `<form id="f"><div class="fl" data-r hidden><label class="k">Nombre</label><input class="in" id="no" autocomplete="name"></div><div class="fl"><label class="k">Celular</label><input class="in" id="te" inputmode="tel" autocomplete="tel" required></div><div class="fl" data-r hidden><label class="k">Correo (opcional)</label><input class="in" id="co" type="email"></div><div class="fl"><label class="k">Contraseña</label><input class="in" id="pw" type="password" required minlength="8"></div><label data-r hidden style="display:flex;gap:10px;font-size:13.5px;margin-bottom:14px"><input type="checkbox" id="ad"> Autorizo el tratamiento de mis datos personales</label><button class="bt" id="bt">Ingresar</button></form><button class="bt s" id="cb" style="margin-top:10px">Crear una cuenta</button>`);
      let reg = false;
      const ver = () => { w.qq('[data-r]').forEach(e => { e.hidden = !reg; e.style.display = reg ? '' : 'none'; }); w.q('#bt').textContent = reg ? 'Crear cuenta' : 'Ingresar'; w.q('#cb').textContent = reg ? 'Ya tengo cuenta' : 'Crear una cuenta'; }; ver();
      w.q('#cb').onclick = () => { reg = !reg; ver(); };
      w.q('.x').onclick = () => { w.cerrar(); ok(null); };
      w.q('#f').onsubmit = async e => { e.preventDefault(); const b = { pais: codPais, telefono: w.q('#te').value, password: w.q('#pw').value, ...(reg && { nombre: w.q('#no').value, correo: w.q('#co').value, aceptaDatos: w.q('#ad').checked }) }; const r = await api('/tienda/cuenta/' + (reg ? 'registro' : 'login'), 'POST', b); if (!r.success) return toast(r.error); localStorage.setItem('katu_cli_token', r.data.token); w.cerrar(); ok(r.data.cuenta); };
    });
  }
  Object.assign(window, { esc, $, slug, api, toast, ventana, carro, lugar, uuid, cargar, dinero, logo, lineas, calcular, paso, cant, elegirLugar, ingresar, token, DT: () => D });
})();
