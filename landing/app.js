/* Katú POS — landing: animaciones, planes desde la API y registro hacia Stripe */
(function () {
  'use strict';
  const K = window.KATU || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const plata = (n, m = 'COP') => (m === 'USD' ? 'US$' : '$') + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 });

  // ── Navegación ──
  const nav = $('nav');
  const alScroll = () => nav.classList.toggle('solida', scrollY > 20);
  addEventListener('scroll', alScroll, { passive: true }); alScroll();
  $('hamb').onclick = () => { const a = $('menu').classList.toggle('abierto'); $('hamb').setAttribute('aria-expanded', a); };
  $('menu').onclick = e => { if (e.target.closest('a')) $('menu').classList.remove('abierto'); };
  $('anio').textContent = new Date().getFullYear();
  $('contacto').href = `mailto:${K.CONTACTO || 'hola@katupos.com'}`;
  if (K.WHATSAPP) { $('waFlot').href = `https://wa.me/${K.WHATSAPP}?text=${encodeURIComponent('Hola, quiero saber más de Katú POS')}`; $('waFlot').hidden = false; }

  // ── Aparición al hacer scroll ──
  const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } }), { threshold: .14 });
  document.querySelectorAll('.revelar').forEach(el => obs.observe(el));

  // ── Palabra que rota en el titular ──
  const palabras = ['en tu tienda', 'a domicilio', 'por WhatsApp', 'en autopago', 'sin internet'];
  let ip = 0;
  if (!quieto) setInterval(() => { const r = $('rotador'); r.classList.add('salir'); setTimeout(() => { ip = (ip + 1) % palabras.length; r.textContent = palabras[ip]; r.classList.remove('salir'); }, 350); }, 2600);

  // ── Inclinación de la pantalla con el mouse ──
  const pant = $('pantalla');
  if (pant && !quieto && matchMedia('(pointer: fine)').matches) {
    document.querySelector('.hero').addEventListener('mousemove', e => {
      const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
      pant.style.transform = `rotateY(${-11 + x * 8}deg) rotateX(${6 - y * 6}deg)`;
    });
  }

  // ── Caja que vende sola ──
  (async function caja() {
    const prods = [...document.querySelectorAll('.pt-prod')], lineas = $('ptLineas'), tot = $('ptTotal');
    if (!prods.length) return;
    const datos = [['Leche 1 L', 4600], ['Tomate 1,25 kg', 6000], ['Croissant', 2800], ['Arroz 1 kg', 4900], ['Agua', 2400]];
    const orden = [1, 0, 3, 4, 2];
    const contar = async (de, a) => { for (let i = 1; i <= 12; i++) { tot.textContent = plata(Math.round(de + (a - de) * i / 12)); await dormir(28); } };
    for (;;) {
      lineas.innerHTML = ''; tot.textContent = plata(0); let suma = 0;
      for (let i = 0; i < datos.length; i++) {
        const p = prods[orden[i]]; p.classList.add('pulsado'); await dormir(180); p.classList.remove('pulsado');
        const [n, v] = datos[i]; lineas.insertAdjacentHTML('afterbegin', `<div class="pt-lin"><span>${n}</span><b>${plata(v)}</b></div>`);
        await contar(suma, suma + v); suma += v;
        await dormir(quieto ? 0 : 650);
      }
      if (quieto) return;
      await dormir(2600);
    }
  })();

  // ── Chat de WhatsApp con el asistente ──
  const guion = [
    ['cli', 'Hola! quiero 2 leches enteras y una libra de tomate 🍅'],
    ['bot', 'Agregué a tu carrito:\n• 2 Leche entera 1 L — <b>$9.200</b>\n• 0,5 kg Tomate — <b>$2.160</b> (promo −10%)\n¿Te lo envío a domicilio? Comparte tu ubicación 📍'],
    ['cli', '<span class="ubi"><i class="fa-solid fa-location-dot"></i> Ubicación compartida</span>'],
    ['bot', '¡Llegamos! Domicilio <b>$3.000</b>, unos 45 min.\nTotal: <b>$14.360</b>. ¿Pagas en efectivo o con QR?'],
    ['cli', 'Efectivo. Sí, confirmo ✅'],
    ['sis', '✅ Pedido <b>D-00003</b> recibido. Síguelo aquí: orbita.katupos.com/seguimiento'],
  ];
  let chatCorriendo = false;
  async function chat() {
    const c = $('chat'); if (!c || chatCorriendo) return; chatCorriendo = true;
    for (;;) {
      c.innerHTML = '';
      for (const [quien, texto] of guion) {
        if (quien !== 'cli') { $('telEstado').textContent = 'escribiendo…'; c.insertAdjacentHTML('beforeend', '<div class="escribiendo"><i></i><i></i><i></i></div>'); await dormir(quieto ? 0 : 1200); c.querySelector('.escribiendo')?.remove(); $('telEstado').textContent = 'en línea'; }
        c.insertAdjacentHTML('beforeend', `<div class="burbuja ${quien}">${texto}</div>`);
        await dormir(quieto ? 0 : quien === 'cli' ? 1300 : 1800);
      }
      if (quieto) return;
      await dormir(4000);
    }
  }
  const tel = document.querySelector('.telefono');
  if (tel) new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { chat(); o.disconnect(); } }, { threshold: .3 }).observe(tel);

  // ── Subdominio que se escribe solo ──
  (async function subdominio() {
    const u = $('url'); if (!u || quieto) return;
    const nombres = ['orbita', 'la-esquina', 'donde-pepe', 'frutas-maria', 'tunegocio'];
    for (let k = 0; ; k = (k + 1) % nombres.length) {
      const n = nombres[k];
      for (let i = u.textContent.length; i >= 0; i--) { u.textContent = u.textContent.slice(0, i); await dormir(45); }
      for (let i = 1; i <= n.length; i++) { u.textContent = n.slice(0, i); await dormir(90); }
      await dormir(2200);
    }
  })();

  // ── Planes ──
  const EJEMPLO = [
    { codigo: 'basico', nombre: 'Básico', descripcion: 'Para empezar a vender rápido y en regla.', moneda: 'COP', precioMensual: 89000, precioAnual: 890000, caracteristicas: ['Caja rápida con lector y báscula', 'Inventario, compras y vencimientos', 'Factura electrónica DIAN', 'Fiado y cartera de clientes', 'Informes y arqueos de turno', 'Funciona sin internet'] },
    { codigo: 'pro', nombre: 'Pro', destacado: true, descripcion: 'Vende también a domicilio y por WhatsApp.', moneda: 'COP', precioMensual: 179000, precioAnual: 1790000, caracteristicas: ['Todo lo del plan Básico', 'Tienda en línea con tu subdominio', 'Domicilios con seguimiento y PIN', 'WhatsApp con asistente de IA y asesores', 'Puntos, niveles y misiones para clientes'] },
    { codigo: 'premium', nombre: 'Premium', descripcion: 'La experiencia completa para crecer.', moneda: 'COP', precioMensual: 299000, precioAnual: 2990000, caracteristicas: ['Todo lo del plan Pro', 'Kiosco de autopago', 'Campañas por WhatsApp y correo', 'Ventas atribuidas a cada campaña', 'Soporte prioritario'] },
  ];
  let planes = EJEMPLO, periodo = 'mensual', apiLista = false;
  function pintarPlanes() {
    $('planesLista').innerHTML = planes.map(p => {
      const anual = periodo === 'anual', precio = anual ? Math.round(p.precioAnual / 12) : p.precioMensual;
      const ahorro = Math.max(0, p.precioMensual * 12 - p.precioAnual);
      return `<article class="plan ${p.destacado ? 'destacado' : ''}">${p.destacado ? '<span class="cinta">RECOMENDADO</span>' : ''}
        <h3>${esc(p.nombre)}</h3><p class="desc">${esc(p.descripcion || '')}</p>
        <div class="precio"><b>${plata(precio, p.moneda)}</b><span>/ mes</span></div>
        <div class="ahorro">${anual ? `${plata(p.precioAnual, p.moneda)} al año · ahorras ${plata(ahorro, p.moneda)}` : p.diasPrueba ? `${p.diasPrueba} días de prueba gratis` : ''}</div>
        <ul>${(p.caracteristicas || []).map(c => `<li><i class="fa-solid fa-check"></i>${esc(c)}</li>`).join('')}</ul>
        <button class="btn ${p.destacado ? 'btn-brillo' : 'btn-borde'} btn-xl ancho" data-plan="${esc(p.codigo)}">Elegir ${esc(p.nombre)}</button></article>`;
    }).join('');
  }
  document.querySelector('.selector').onclick = e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    periodo = b.dataset.p;
    document.querySelectorAll('.selector button').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    pintarPlanes();
  };
  fetch(`${K.API}/registro/planes`).then(r => r.json()).then(d => {
    if (d.success && d.data.planes?.length) { planes = d.data.planes; apiLista = true; pintarPlanes(); }
    if (d.data?.modoPrueba) $('modoPrueba').textContent = 'Pagos en modo de prueba: usa la tarjeta 4242 4242 4242 4242.';
  }).catch(() => {});
  pintarPlanes();
  $('planesLista').onclick = e => { const b = e.target.closest('[data-plan]'); if (b) abrirRegistro(b.dataset.plan); };

  // ── Registro → Stripe ──
  let planSel = null, subTocado = false, tSub, subOk = false;
  const reg = $('registro');
  const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function abrirRegistro(codigo) {
    planSel = planes.find(p => p.codigo === codigo) || planes[0];
    $('rPlan').textContent = `Plan ${planSel.nombre}`; $('rPeriodo').value = periodo;
    $('rError').hidden = true; reg.hidden = false; document.body.style.overflow = 'hidden';
    resumen(); setTimeout(() => $('rNegocio').focus(), 60);
  }
  const cerrar = () => { reg.hidden = true; document.body.style.overflow = ''; };
  reg.addEventListener('click', e => { if (e.target === reg || e.target.closest('[data-cerrar]')) cerrar(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !reg.hidden) cerrar(); });
  function resumen() {
    const anual = $('rPeriodo').value === 'anual', p = planSel;
    $('rResumen').innerHTML = `<span>Plan <b style="font-size:15px">${esc(p.nombre)}</b> · ${anual ? 'anual' : 'mensual'}${p.diasPrueba ? `<br><small>${p.diasPrueba} días de prueba gratis</small>` : ''}</span><b>${plata(anual ? p.precioAnual : p.precioMensual, p.moneda)}<small style="font-size:13px;font-weight:600;color:#475A77"> / ${anual ? 'año' : 'mes'}</small></b>`;
  }
  $('rPeriodo').onchange = resumen;
  $('rNegocio').oninput = () => { if (!subTocado) { $('rSub').value = slug($('rNegocio').value); revisarSub(); } };
  $('rSub').oninput = () => { subTocado = true; const v = slug($('rSub').value); if (v !== $('rSub').value) $('rSub').value = v; revisarSub(); };
  function revisarSub() {
    clearTimeout(tSub); subOk = false;
    const s = $('rSub').value, e = $('rSubEstado');
    if (s.length < 3) { e.textContent = s ? 'Mínimo 3 caracteres' : ''; e.className = 'mal'; return; }
    e.textContent = 'Revisando…'; e.className = '';
    tSub = setTimeout(async () => {
      try {
        const r = await fetch(`${K.API}/registro/subdominio/${encodeURIComponent(s)}`).then(x => x.json());
        if ($('rSub').value !== s) return;
        subOk = !!r.data?.disponible;
        e.innerHTML = subOk ? `<i class="fa-solid fa-circle-check"></i> ${esc(r.data.subdominio)}.${esc(K.DOMINIO || 'katupos.com')} está disponible` : `<i class="fa-solid fa-circle-xmark"></i> ${esc(r.data?.motivo || r.error || 'No disponible')}`;
        e.className = subOk ? 'ok' : 'mal';
      } catch { e.textContent = 'No pudimos revisar ahora; lo validaremos al continuar.'; e.className = ''; subOk = true; }
    }, 350);
  }
  $('fRegistro').onsubmit = async e => {
    e.preventDefault();
    const err = t => { $('rError').textContent = t; $('rError').hidden = false; };
    $('rError').hidden = true;
    const d = { plan: planSel.codigo, periodo: $('rPeriodo').value, negocio: $('rNegocio').value.trim(), subdominio: $('rSub').value, nombre: $('rNombre').value.trim(), telefono: $('rTel').value.trim(), correo: $('rCorreo').value.trim(), pais: $('rPais').value };
    if (d.negocio.length < 2) return err('Escribe el nombre de tu negocio');
    if (d.subdominio.length < 3) return err('Elige tu dirección web (mínimo 3 caracteres)');
    if (d.nombre.length < 3) return err('Escribe tu nombre');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo)) return err('Escribe un correo válido');
    if (!apiLista) return err('No pudimos conectar con Katú POS. Intenta de nuevo en un momento.');
    const b = $('rEnviar'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparando el pago…';
    try {
      const r = await fetch(`${K.API}/registro/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(x => x.json());
      if (!r.success) throw new Error(r.error || 'No pudimos iniciar el pago');
      sessionStorage.setItem('katu_registro', r.data.registro);
      location.href = r.data.url;
    } catch (x) { err(x.message); b.disabled = false; b.innerHTML = '<i class="fa-solid fa-lock"></i> Continuar al pago seguro'; }
  };
  // Enlaces directos: www.katupos.com/#plan-pro abre el registro
  const h = location.hash.match(/^#plan-(\w+)/); if (h) setTimeout(() => abrirRegistro(h[1]), 300);
})();
