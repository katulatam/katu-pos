// Nombres propios (personas, usuarios y empresas) siempre capitalizados:
// "ANA MARÍA DE LA CRUZ" → "Ana María de la Cruz", "industrias andinas s.a.s." →
// "Industrias Andinas S.A.S.". Se usa como `set` en los modelos.

// Conectores que van en minúscula salvo al inicio (es / pt / fr)
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'du', 'des', 'le', 'van', 'von', 'di']);
// Siglas societarias sin puntos que se escriben en mayúscula
const SIGLAS = new Set(['sas', 'sa', 'srl', 'sl', 'spa', 'llc', 'cv', 'sac', 'saa', 'eirl', 'eu', 'me', 'epp', 'sarl', 'sca', 'bic']);

const capPalabra = (p) => p.replace(/(^|[-'’.])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());

const capitalizarNombre = (valor) => {
  if (typeof valor !== 'string') return valor;
  return valor.trim().replace(/\s+/g, ' ').toLowerCase().split(' ').map((p, i) => {
    if (i > 0 && CONECTORES.has(p)) return p;
    if (SIGLAS.has(p.replace(/[.,]/g, ''))) return p.toUpperCase();
    return capPalabra(p);
  }).join(' ');
};

module.exports = { capitalizarNombre };
