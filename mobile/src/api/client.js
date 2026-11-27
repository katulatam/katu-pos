const BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://pos.katu.me').replace(/\/+$/, '') + '/api/v1';
let token = null;
export const usarToken = t => { token = t; };

export async function api(ruta, metodo = 'GET', body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(BASE + ruta, { method: metodo, signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
    return { http: r.status, ...(await r.json()) };
  } catch {
    return { success: false, red: true, error: 'No hay conexión. Revisa tu internet e intenta de nuevo.' };
  } finally { clearTimeout(t); }
}
