import Motor from './motor';

export const dinero = (n, pais) => Motor.dinero(n, pais);
export const cantidad = (q, p) => (p.tipo === 'peso' || p.porPeso ? `${Number(q).toLocaleString('es', { maximumFractionDigits: 3 })} ${p.unidad}` : String(q));
// Colombia escribe 50.000; México 100.50: depende de los decimales del país
export const leerValor = (t, dec) => {
  const s = String(t || '').replace(/[^\d.,]/g, '');
  if (!dec) return Number(s.replace(/[.,]/g, '')) || 0;
  const m = s.match(new RegExp(`[.,](\\d{1,${dec}})$`));
  return Number((m ? s.slice(0, m.index) : s).replace(/[.,]/g, '') + (m ? `.${m[1]}` : '')) || 0;
};
export const paso = p => (p.tipo === 'peso' ? 0.25 : 1);
// El motor puede no tener zona horaria en algunos celulares: hora local como respaldo
export const ahora = zona => {
  try { return Motor.ahoraEnZona(zona); } catch {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return { fecha: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`, hora: `${z(d.getHours())}:${z(d.getMinutes())}`, dia: d.getDay() };
  }
};
export { Motor };
