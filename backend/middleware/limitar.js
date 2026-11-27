// Límite de intentos en memoria (login, PIN, registro). Suficiente para frenar
// fuerza bruta en una instancia; `clave` decide por qué se cuenta.
const limitar = ({ max = 10, ventanaMs = 60000, clave = req => req.ip } = {}) => {
  const golpes = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of golpes) if (v.hasta < t) golpes.delete(k); }, 60000).unref();
  return (req, res, next) => {
    const k = String(clave(req)), t = Date.now();
    let g = golpes.get(k);
    if (!g || g.hasta < t) { g = { n: 0, hasta: t + ventanaMs }; golpes.set(k, g); }
    if (++g.n > max) return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
    next();
  };
};

module.exports = limitar;
