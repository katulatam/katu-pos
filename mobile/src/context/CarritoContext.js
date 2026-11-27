import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Motor, ahora, paso } from '../utils/formato';

const Ctx = createContext(null);
export const useCarrito = () => useContext(Ctx);

// Un carrito por tienda (slug)
export function CarritoProvider({ children }) {
  const [todos, setTodos] = useState({});
  const mover = useCallback((slug, p, signo) => setTodos(t => {
    const c = { ...(t[slug] || {}) };
    const q = c[p._id] || 0;
    const n = Motor.r3(q + signo * (p.tipo === 'peso' && !q && signo > 0 ? 0.5 : paso(p)));
    if (n > 0) c[p._id] = n; else delete c[p._id];
    return { ...t, [slug]: c };
  }), []);
  const vaciar = useCallback(slug => setTodos(t => ({ ...t, [slug]: {} })), []);
  const calcular = useCallback((slug, catalogo, domicilio = 0) => {
    const idx = new Map(catalogo.productos.map(p => [p._id, p]));
    const lineas = Object.entries(todos[slug] || {}).filter(([id]) => idx.has(id) && !idx.get(id).agotado).map(([id, q]) => { const p = idx.get(id); return { producto: id, categoria: p.categoria, nombre: p.nombre, cantidad: q, precioUnitario: p.precio, porPeso: p.tipo === 'peso', unidad: p.unidad, impuestoTipo: p.impuestoTipo, impuestoPct: p.impuestoPct }; });
    return Motor.calcular(lineas, { decimales: catalogo.pais.decimales, promociones: catalogo.promociones, ahora: ahora(catalogo.empresa.zonaHoraria), domicilio });
  }, [todos]);
  const valor = useMemo(() => ({ todos, mover, vaciar, calcular }), [todos, mover, vaciar, calcular]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
