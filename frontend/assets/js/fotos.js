/* fotos.js — Prepara la foto de un producto en el navegador antes de subirla.
 * Reglas de Katú POS (para que todo se vea parejo en el POS, la tienda y WhatsApp):
 *  - Cuadrada 800×800 px sobre fondo blanco, sin recortar el producto (margen del 6 %).
 *  - JPG de ~100 KB (WhatsApp solo acepta JPG o PNG) y miniatura de 320 px para la caja.
 *  - Se quitan los datos del celular (ubicación, fecha) al redibujarla.
 *  - Mínimo 400×400 px; se avisa si es pequeña, oscura, alargada o con fondo recargado.
 */
(function () {
  'use strict';
  const LADO = 800, MINI = 320, MIN = 400, MAX_BYTES = 15 * 1024 * 1024;
  const REGLAS = [
    'Fondo blanco o claro y liso: el producto resalta en el POS y la tienda.',
    'El producto centrado, ocupando casi toda la foto y completo (sin cortes).',
    'Buena luz, sin sombras fuertes ni reflejos. Que se vea nítida.',
    'Sin textos, precios, marcas de agua ni logos encima.',
    'La presentación real que vendes (tamaño, sabor, empaque).',
    'Mejor cuadrada y de al menos 800×800 px. Sirven las fotos del celular (JPG, PNG o WebP).',
    'Usa fotos propias o con permiso del fabricante.',
  ];

  const cargar = async archivo => {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch (_) { /* respaldo abajo */ }
    }
    return new Promise((ok, mal) => {
      const img = new Image(), u = URL.createObjectURL(archivo);
      img.onload = () => { URL.revokeObjectURL(u); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(u); mal(new Error('No pudimos abrir esa imagen. Usa una foto JPG, PNG o WebP.')); };
      img.src = u;
    });
  };
  const aBlob = (canvas, calidad) => new Promise(ok => canvas.toBlob(ok, 'image/jpeg', calidad));
  const luz = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // Revisa la foto original: brillo general y qué tan claro y parejo es el borde (el fondo)
  function analizar(img, w, h) {
    const c = document.createElement('canvas'), n = 64;
    c.width = n; c.height = n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); x.drawImage(img, 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data;
    let total = 0, borde = [], i = 0;
    for (let y = 0; y < n; y++) for (let xx = 0; xx < n; xx++, i += 4) {
      const l = luz(d[i], d[i + 1], d[i + 2]); total += l;
      if (y < 3 || y >= n - 3 || xx < 3 || xx >= n - 3) borde.push(l);
    }
    const media = borde.reduce((a, b) => a + b, 0) / borde.length;
    const dispersion = Math.sqrt(borde.reduce((a, b) => a + (b - media) ** 2, 0) / borde.length);
    const avisos = [];
    if (Math.min(w, h) < LADO) avisos.push(`La foto es pequeña (${w}×${h} px): puede verse borrosa en la tienda. Ideal: 800×800 o más.`);
    if (total / (n * n) < 70) avisos.push('La foto se ve oscura: tómala con más luz.');
    if (media < 190 || dispersion > 35) avisos.push('El fondo no es claro y liso: con fondo blanco el producto se ve mejor en el POS y la tienda.');
    if (Math.max(w, h) / Math.min(w, h) > 1.8) avisos.push('La foto es muy alargada: quedará con bordes blancos. Mejor una foto cuadrada.');
    return avisos;
  }

  // archivo (File) → { grande, mini: Blob JPG, vista: URL para mostrar, avisos: [] }
  async function preparar(archivo) {
    if (!archivo || !/^image\//.test(archivo.type || '') && !/\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(archivo.name || '')) throw new Error('Elige una imagen (JPG, PNG o WebP).');
    if (archivo.size > MAX_BYTES) throw new Error('La imagen pesa más de 15 MB. Usa una más liviana.');
    const img = await cargar(archivo);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) throw new Error('No pudimos leer esa imagen.');
    if (Math.min(w, h) < MIN) throw new Error(`La foto es muy pequeña (${w}×${h} px). Mínimo 400×400 px.`);
    const avisos = analizar(img, w, h);
    // Cuadrado 800×800, fondo blanco, producto completo y centrado
    const c = document.createElement('canvas'); c.width = LADO; c.height = LADO;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, LADO, LADO);
    x.imageSmoothingQuality = 'high';
    const util = LADO * 0.88, k = Math.min(util / w, util / h), dw = Math.round(w * k), dh = Math.round(h * k);
    x.drawImage(img, Math.round((LADO - dw) / 2), Math.round((LADO - dh) / 2), dw, dh);
    let grande = await aBlob(c, 0.85);
    if (grande.size > 700 * 1024) grande = await aBlob(c, 0.72);
    const cm = document.createElement('canvas'); cm.width = MINI; cm.height = MINI;
    const xm = cm.getContext('2d'); xm.imageSmoothingQuality = 'high'; xm.drawImage(c, 0, 0, MINI, MINI);
    const mini = await aBlob(cm, 0.8);
    img.close?.();
    return { grande, mini, vista: URL.createObjectURL(grande), avisos, original: { ancho: w, alto: h } };
  }
  // Sube la foto preparada al producto
  async function subir(productoId, f) {
    const fd = new FormData();
    fd.append('imagen', f.grande, 'foto.jpg');
    fd.append('mini', f.mini, 'mini.jpg');
    return window.datos(`/productos/${productoId}/imagen`, 'POST', fd);
  }
  window.Fotos = { REGLAS, preparar, subir, LADO };
})();
