// Geocercas de domicilios: distancia y cobertura. Todo en JS puro (sin índices
// geoespaciales): una empresa tiene pocas zonas y así la regla se prueba sola.
const { redondear } = require('../../frontend/assets/js/motor');

const R = 6371000;
const rad = g => g * Math.PI / 180;

function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Punto en polígono (ray casting). poligono: [{ lat, lng }, …] sin repetir el primero.
function dentroPoligono(p, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i], b = poligono[j];
    const cruza = (a.lng > p.lng) !== (b.lng > p.lng)
      && p.lat < (b.lat - a.lat) * (p.lng - a.lng) / (b.lng - a.lng) + a.lat;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

const coord = (v, max) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= max;
const puntoValido = p => !!p && coord(p.lat, 90) && coord(p.lng, 180);

function zonaCubre(zona, punto) {
  if (!zona.activo) return false;
  if (zona.tipo === 'poligono') return (zona.poligono || []).length >= 3 && dentroPoligono(punto, zona.poligono);
  return puntoValido(zona.centro) && distanciaM(zona.centro, punto) <= (zona.radioM || 0);
}

// Atiende a esta hora: ahora = { hora:'HH:mm', dia:0..6 } en la zona de la empresa
function zonaAbierta(zona, ahora) {
  if (zona.dias && zona.dias.length && !zona.dias.includes(ahora.dia)) return false;
  if (zona.horaDesde && ahora.hora < zona.horaDesde) return false;
  if (zona.horaHasta && ahora.hora > zona.horaHasta) return false;
  return true;
}

function tarifaZona(zona, distancia, totalProductos, decimales) {
  if (zona.gratisDesde > 0 && totalProductos >= zona.gratisDesde) return 0;
  const extra = Math.max(0, distancia / 1000 - (zona.kmIncluidos || 0)) * (zona.tarifaKm || 0);
  return redondear((zona.tarifaBase || 0) + extra, decimales);
}

// Elige la mejor zona para un punto: abierta primero, luego la de menor
// prioridad numérica y, a igualdad, la más barata. null si nadie cubre.
function cotizar(zonas, punto, { ahora, totalProductos = 0, decimales = 0 } = {}) {
  if (!puntoValido(punto)) return null;
  const p = { lat: Number(punto.lat), lng: Number(punto.lng) };
  const op = zonas.filter(z => zonaCubre(z, p)).map(z => {
    const origen = puntoValido(z.origen) ? z.origen : z.centro;
    const distancia = puntoValido(origen) ? Math.round(distanciaM(origen, p)) : 0;
    return { zona: z, distancia, tarifa: tarifaZona(z, distancia, totalProductos, decimales), abierta: ahora ? zonaAbierta(z, ahora) : true };
  });
  if (!op.length) return null;
  op.sort((a, b) => Number(b.abierta) - Number(a.abierta)
    || (a.zona.prioridad || 0) - (b.zona.prioridad || 0) || a.tarifa - b.tarifa);
  return op[0];
}

module.exports = { distanciaM, dentroPoligono, puntoValido, zonaCubre, zonaAbierta, tarifaZona, cotizar };
