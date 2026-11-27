// ── Correos de marketing con diseño ────────────────────────────────────────
// Tres formatos (Campana.formato):
//  - texto:  párrafos simples con el logo y el color de la empresa (el de siempre)
//  - diseno: bloques armados en el panel (título, texto, imagen, botón,
//            productos, separador, espacio) → HTML de correo con tablas y estilos
//            en línea, que se ve bien en Gmail, Outlook y el celular
//  - html:   HTML propio (pegado de otra herramienta). Se limpia: sin scripts,
//            formularios, iframes ni eventos.
// En todos se agrega SIEMPRE el pie con los datos del comercio y el enlace de baja.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorValido = (c, def) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : def);
const urlValida = u => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
// *negrita*, _cursiva_, saltos de línea y {nombre}
const enLinea = (t, nombre) => esc(String(t || '').replace(/\{nombre\}/gi, nombre || 'cliente')).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/\n/g, '<br>');
// Texto claro u oscuro según el fondo
const sobre = hex => { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#0B1729' : '#FFFFFF'; };

const TIPOS = ['titulo', 'texto', 'imagen', 'boton', 'productos', 'separador', 'espacio'];
const MAX_BLOQUES = 40;

// Deja solo lo permitido de cada bloque (lo que llega del panel no se confía)
function limpiarBloques(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, MAX_BLOQUES).filter(b => TIPOS.includes(b?.tipo)).map(b => {
    const al = ['left', 'center', 'right'].includes(b.alinear) ? b.alinear : 'left';
    switch (b.tipo) {
      case 'titulo': return { tipo: 'titulo', texto: String(b.texto || '').slice(0, 200), tamano: [22, 28, 34].includes(Number(b.tamano)) ? Number(b.tamano) : 28, alinear: al };
      case 'texto': return { tipo: 'texto', texto: String(b.texto || '').slice(0, 3000), alinear: al };
      case 'imagen': return { tipo: 'imagen', url: urlValida(b.url), enlace: urlValida(b.enlace), alt: String(b.alt || '').slice(0, 120), ancho: Number(b.ancho) >= 20 && Number(b.ancho) <= 100 ? Number(b.ancho) : 100 };
      case 'boton': return { tipo: 'boton', texto: String(b.texto || 'Comprar ahora').slice(0, 60), enlace: urlValida(b.enlace), color: colorValido(b.color, ''), alinear: ['left', 'center', 'right'].includes(b.alinear) ? b.alinear : 'center' };
      case 'productos': return { tipo: 'productos', productos: (Array.isArray(b.productos) ? b.productos : []).filter(x => /^[a-f\d]{24}$/i.test(String(x))).slice(0, 6).map(String), columnas: [1, 2, 3].includes(Number(b.columnas)) ? Number(b.columnas) : 2 };
      case 'separador': return { tipo: 'separador' };
      case 'espacio': return { tipo: 'espacio', alto: Math.max(8, Math.min(80, Number(b.alto) || 24)) };
      default: return null;
    }
  }).filter(Boolean);
}

// productos: Map id → { nombre, imagenUrl, precio, precioAntes, enlace } (ya con el precio del día)
function htmlBloques(bloques, { color, nombre, productos = new Map(), dinero = n => String(n) }) {
  const td = (contenido, extra = '') => `<tr><td style="padding:0 32px${extra}">${contenido}</td></tr>`;
  return bloques.map(b => {
    switch (b.tipo) {
      case 'titulo': return td(`<h1 style="margin:22px 0 8px;font-size:${b.tamano}px;line-height:1.2;font-weight:800;color:#0B1729;text-align:${b.alinear};font-family:Arial,Helvetica,sans-serif">${enLinea(b.texto, nombre)}</h1>`);
      case 'texto': return td(`<p style="margin:10px 0;font-size:15px;line-height:1.65;color:#2B3A52;text-align:${b.alinear}">${enLinea(b.texto, nombre)}</p>`);
      case 'imagen': {
        if (!b.url) return '';
        const img = `<img src="${esc(b.url)}" alt="${esc(b.alt)}" width="${Math.round(536 * b.ancho / 100)}" style="display:block;margin:0 auto;width:${b.ancho}%;max-width:100%;height:auto;border:0;border-radius:12px">`;
        return td(`<div style="margin:14px 0">${b.enlace ? `<a href="${esc(b.enlace)}" target="_blank">${img}</a>` : img}</div>`);
      }
      case 'boton': {
        if (!b.enlace) return '';
        const fondo = b.color || color, letra = sobre(fondo);
        return td(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.alinear}" style="margin:18px ${b.alinear === 'center' ? 'auto' : '0'}"><tr><td style="border-radius:12px;background:${fondo}"><a href="${esc(b.enlace)}" target="_blank" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:${letra};text-decoration:none;border-radius:12px;font-family:Arial,Helvetica,sans-serif">${esc(b.texto)}</a></td></tr></table>`);
      }
      case 'productos': {
        const lista = b.productos.map(id => productos.get(id)).filter(Boolean);
        if (!lista.length) return '';
        const ancho = Math.floor(100 / b.columnas);
        const filas = [];
        for (let i = 0; i < lista.length; i += b.columnas) filas.push(lista.slice(i, i + b.columnas));
        const tarjeta = p => `<td width="${ancho}%" valign="top" style="padding:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E9F2;border-radius:14px;overflow:hidden"><tr><td style="padding:0">${p.imagenUrl ? `<a href="${esc(p.enlace)}" target="_blank"><img src="${esc(p.imagenUrl)}" alt="${esc(p.nombre)}" width="100%" style="display:block;width:100%;height:auto;border:0"></a>` : ''}</td></tr><tr><td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif"><div style="font-size:14px;font-weight:bold;color:#0B1729;line-height:1.3">${esc(p.nombre)}</div><div style="margin-top:6px">${p.precioAntes ? `<span style="font-size:13px;color:#8A97AB;text-decoration:line-through">${esc(dinero(p.precioAntes))}</span> ` : ''}<span style="font-size:18px;font-weight:800;color:${p.precioAntes ? '#D12C46' : '#0B1729'}">${esc(dinero(p.precio))}</span></div><a href="${esc(p.enlace)}" target="_blank" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:bold;color:${color};text-decoration:none">Comprar →</a></td></tr></table></td>`;
        return td(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0">${filas.map(f => `<tr>${f.map(tarjeta).join('')}${'<td></td>'.repeat(b.columnas - f.length)}</tr>`).join('')}</table>`, ';padding-left:24px;padding-right:24px');
      }
      case 'separador': return td('<div style="height:1px;background:#E3E9F2;margin:18px 0;line-height:1px;font-size:1px">&nbsp;</div>');
      case 'espacio': return `<tr><td style="height:${b.alto}px;line-height:${b.alto}px;font-size:1px">&nbsp;</td></tr>`;
      default: return '';
    }
  }).join('');
}

// Plantilla completa: cabecera con logo, cuerpo y pie obligatorio
function envolver(empresa, cuerpo, { baja, preheader = '', color }) {
  const letra = sobre(color);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(empresa.nombre)}</title></head>
<body style="margin:0;padding:0;background:#F1F5FA;font-family:Arial,Helvetica,sans-serif;color:#0B1729">${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5FA;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:18px;overflow:hidden">
<tr><td style="background:${color};padding:20px 32px;color:${letra};font-size:20px;font-weight:bold">${empresa.logoUrl ? `<img src="${esc(empresa.logoUrl)}" alt="${esc(empresa.nombre)}" height="40" style="display:block;max-height:40px;border:0">` : esc(empresa.nombre)}</td></tr>
${cuerpo}
<tr><td style="height:24px;line-height:24px;font-size:1px">&nbsp;</td></tr>
${pie(empresa, baja)}
</table></td></tr></table></body></html>`;
}
const pie = (empresa, baja) => `<tr><td style="padding:18px 32px;background:#F7FAFD;font-size:12px;color:#51637F;line-height:1.5;font-family:Arial,Helvetica,sans-serif">${esc(empresa.nombre)}${empresa.direccion ? ' · ' + esc(empresa.direccion) : ''}${empresa.ciudad ? ', ' + esc(empresa.ciudad) : ''}<br>Recibes este correo porque autorizaste recibir promociones de ${esc(empresa.nombre)}. <a href="${esc(baja)}" style="color:#51637F">Darme de baja</a></td></tr>`;

// HTML propio: se quitan scripts, formularios, iframes, eventos y enlaces javascript:
const MAX_HTML = 300 * 1024;
function limpiarHtml(html) {
  let s = String(html || '');
  if (s.length > MAX_HTML) throw Object.assign(new Error(`El HTML es muy grande (máximo ${MAX_HTML / 1024} KB)`), { status: 400 });
  s = s.replace(/<!--[\s\S]*?-->/g, m => (/\[if|endif\]/i.test(m) ? m : '')) // conserva los condicionales de Outlook
    .replace(/<\s*(script|iframe|object|embed|form|input|button|select|textarea|frame|frameset|applet|base|link|meta)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/<\s*\/\s*(script|iframe|object|embed|form|frame|frameset|applet)\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|background)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '$1="#"')
    .replace(/expression\s*\(/gi, '(');
  return s;
}
// Inserta el pie de baja dentro del HTML propio (antes de </body>, o al final)
function htmlPropio(empresa, html, { baja, nombre }) {
  const conNombre = limpiarHtml(html).replace(/\{nombre\}/gi, esc(nombre || 'cliente'));
  const p = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">${pie(empresa, baja)}</table></td></tr></table>`;
  return /<\/body>/i.test(conNombre) ? conNombre.replace(/<\/body>/i, `${p}</body>`) : `${conNombre}${p}`;
}
// Texto plano para la versión sin HTML (mejora la entrega)
const aTexto = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|tr|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

module.exports = { TIPOS, limpiarBloques, htmlBloques, envolver, limpiarHtml, htmlPropio, aTexto, colorValido, urlValida, esc };
