// ── Revisión de plantillas de marketing de WhatsApp antes de enviarlas a Meta ──
// errores: lo que Meta rechaza siempre (no se deja enviar)
// avisos:  recomendaciones para que se apruebe y funcione mejor
// El texto usa {nombre} (nombre del cliente) y {negocio} (se reemplaza por el
// nombre del comercio); el resultado final usa {{1}} y lleva la forma de darse de baja.
const PIE = 'Responde BAJA para no recibir más promociones.';
const ACORTADORES = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rebrand\.ly|is\.gd|ow\.ly|shorturl\.at|t\.ly|rb\.gy)\b/i;
const SENSIBLES = /(contrase[ñn]a|clave de|n[uú]mero de (tu )?tarjeta|\bcvv\b|c[oó]digo de seguridad|datos bancarios|n[uú]mero de cuenta)/i;
const RESTRINGIDOS = /\b(alcohol|cerveza|licor|aguardiente|ron|whisky|vino|tabaco|cigarrillo|vape|vapeador|apuesta|casino|lotería|pr[eé]stamo|cr[eé]dito r[aá]pido|criptomoneda)\b/i;
const ENGANOSO = /(ganaste|has sido seleccionad|felicidades,? (eres|has)|100 ?% garantizado|gratis para siempre|[uú]ltima oportunidad de tu vida)/i;
const OFERTA = /(gratis|regalo|descuento|\d+ ?%|2x1|3x2|promo)/i;
const CONDICIONES = /(hasta|v[aá]lid|vigente|aplica|agotar|condiciones|solo (hoy|este|esta)|del \w+ al)/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

function revisar(texto, { negocio = '' } = {}) {
  const errores = [], avisos = [];
  const original = String(texto || '').trim();
  let t = original.replace(/\{negocio\}/gi, String(negocio || '').replace(/[{}]/g, '').trim()).replace(/\{nombre\}/gi, '{{1}}');

  // ── Lo que Meta rechaza ──
  if (t.length < 25) errores.push('El mensaje es muy corto: explica qué ofreces y cómo pedir.');
  if (t.length > 900) errores.push('El mensaje es muy largo (máximo 900 caracteres).');
  if (/^\s*\{\{\d+\}\}/.test(t)) errores.push('No puede empezar con {nombre}. Empieza con un saludo: "Hola {nombre}, …".');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(t)) errores.push('No puede haber dos variables seguidas.');
  if (/[{}]/.test(t.replace(/\{\{1\}\}/g, ''))) errores.push('Hay llaves { } sueltas. Solo se puede usar {nombre} y {negocio}, escritos así.');
  if (ACORTADORES.test(t)) errores.push('No uses acortadores de enlaces (bit.ly, tinyurl…): Meta los rechaza. Usa la dirección completa de tu tienda.');
  if (SENSIBLES.test(t)) errores.push('No pidas contraseñas, datos de tarjetas ni datos bancarios por WhatsApp.');
  // El pie de baja se agrega si no lo trae; si lo trae, el texto no puede terminar en variable
  const cuerpo = /BAJA/i.test(t) ? t : `${t}\n\n${PIE}`;
  if (/\{\{\d+\}\}[\s.!¡?¿,;:]*$/.test(cuerpo)) errores.push('No puede terminar con {nombre}. Ponlo en medio del texto.');

  // ── Recomendaciones ──
  const letras = t.replace(/\{\{\d+\}\}/g, '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (letras.length > 20 && letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length / letras.length > 0.35) avisos.push('Evita escribir en MAYÚSCULAS: parece spam y Meta puede rechazarla.');
  if (/[!¡?¿]{3,}|\${2,}/.test(t)) avisos.push('Evita signos repetidos como "!!!" o "$$$".');
  if ((t.match(EMOJI) || []).length > 4) avisos.push('Usa pocos emojis (máximo 3 o 4).');
  if (/\n\s*\n\s*\n/.test(t)) avisos.push('Evita más de un renglón vacío seguido.');
  if (!/\{\{1\}\}/.test(t)) avisos.push('Incluye {nombre}: los mensajes personalizados se leen más.');
  if (negocio && !t.toLowerCase().includes(String(negocio).toLowerCase())) avisos.push('Menciona el nombre de tu negocio (usa {negocio}) para que el cliente sepa quién le escribe.');
  if (OFERTA.test(t) && !CONDICIONES.test(t)) avisos.push('Si ofreces descuentos o regalos, di hasta cuándo o con qué condiciones ("válido hasta el domingo", "hasta agotar existencias").');
  if (RESTRINGIDOS.test(t)) avisos.push('Meta revisa con más rigor (o rechaza) los mensajes sobre alcohol, tabaco, apuestas, préstamos o criptomonedas.');
  if (ENGANOSO.test(t)) avisos.push('Evita frases que parezcan engaño o premio ("ganaste", "has sido seleccionado").');
  if (/http:\/\//i.test(t)) avisos.push('Usa enlaces seguros (https://).');
  if (!/(pide|pedir|escr[ií]benos|responde|visita|ven|te esperamos|compra|ped[ií]|ac[eé]rcate)/i.test(t)) avisos.push('Dile al cliente qué hacer: "pide por este chat", "visítanos", "compra en nuestra tienda".');

  return { cuerpo, errores, avisos, vista: cuerpo.replace(/\{\{1\}\}/g, 'Valentina') };
}

// Ejemplos listos para usar en el panel ({negocio} se reemplaza por el nombre del comercio)
const EJEMPLOS = [
  { titulo: 'Oferta del fin de semana', nombre: 'oferta_fin_de_semana', texto: 'Hola {nombre}, este fin de semana en {negocio} tienes 20% de descuento en frutas y verduras. Válido sábado y domingo o hasta agotar existencias. Pide por este chat y te lo llevamos.' },
  { titulo: 'Producto nuevo', nombre: 'producto_nuevo', texto: 'Hola {nombre}, ya llegó el pan artesanal a {negocio}. Pídelo por este chat o en nuestra tienda en línea y te lo llevamos a domicilio.' },
  { titulo: 'Te extrañamos', nombre: 'te_extranamos', texto: 'Hola {nombre}, hace tiempo no te vemos por {negocio}. Esta semana tu próximo pedido a domicilio no paga envío. Válido hasta el domingo: escríbenos por aquí para pedir.' },
  { titulo: 'Cumpleaños', nombre: 'feliz_cumpleanos', texto: 'Hola {nombre}, en {negocio} queremos celebrar tu cumpleaños: este mes tienes 10% de descuento en tu compra. Válido hasta fin de mes; muéstranos este mensaje en caja o pide por aquí.' },
  { titulo: 'Puntos acumulados', nombre: 'puntos_acumulados', texto: 'Hola {nombre}, tienes puntos acumulados en {negocio} que puedes cambiar por descuentos en tu próxima compra. Pregúntanos por este chat cómo usarlos.' },
];

const RECOMENDACIONES = [
  'Saluda y di quién escribe: "Hola {nombre}, en {negocio}…".',
  '{nombre} va en medio del texto: nunca al principio ni al final.',
  'Sé concreto: qué ofreces, hasta cuándo y cómo pedir.',
  'Nada de MAYÚSCULAS sostenidas, "!!!" ni muchos emojis.',
  'No uses acortadores de enlaces (bit.ly…): usa la dirección de tu tienda.',
  'Nunca pidas contraseñas, datos de tarjetas ni documentos.',
  'Evita frases engañosas ("ganaste un premio") y productos restringidos (alcohol, tabaco, apuestas).',
  'Una plantilla por idea: Meta rechaza plantillas casi iguales a otras.',
  'Al final se agrega solo "Responde BAJA para no recibir más promociones".',
];

module.exports = { revisar, EJEMPLOS, RECOMENDACIONES, PIE };
