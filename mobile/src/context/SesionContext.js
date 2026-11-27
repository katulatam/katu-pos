import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, usarToken } from '../api/client';

const Ctx = createContext(null);
export const useSesion = () => useContext(Ctx);
const OP = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

// Una sola app con dos modos: cliente (compra) y domiciliario (entrega)
export function SesionProvider({ children }) {
  const [listo, setListo] = useState(false);
  const [modo, setModo] = useState('cliente');
  const [cuenta, setCuenta] = useState(null);
  const [domiciliario, setDomiciliario] = useState(null);
  const [pais, setPais] = useState('CO');
  const [lugar, setLugar] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [tk, m, p, l] = await Promise.all([SecureStore.getItemAsync('token', OP).catch(() => null), AsyncStorage.getItem('modo'), AsyncStorage.getItem('pais'), AsyncStorage.getItem('lugar')]);
        if (p) setPais(p);
        if (l) setLugar(JSON.parse(l));
        if (tk) {
          usarToken(tk);
          const r = await api(m === 'domiciliario' ? '/auth/yo' : '/tienda/cuenta/yo');
          if (r.success) { if (m === 'domiciliario') { setDomiciliario(r.data.user); setModo('domiciliario'); } else { setCuenta(r.data); setPais(r.data.pais); } }
          else if (!r.red) { usarToken(null); await SecureStore.deleteItemAsync('token', OP); }
          else if (m === 'domiciliario') { setDomiciliario({}); setModo('domiciliario'); }
        }
      } finally { setListo(true); }
    })();
  }, []);

  const guardar = useCallback(async (tk, m) => { usarToken(tk); await SecureStore.setItemAsync('token', tk, OP); await AsyncStorage.setItem('modo', m); }, []);
  const ingresarCliente = useCallback(async (registro, datos) => {
    const r = await api(`/tienda/cuenta/${registro ? 'registro' : 'login'}`, 'POST', datos);
    if (r.success) { await guardar(r.data.token, 'cliente'); setCuenta(r.data.cuenta); setPais(r.data.cuenta.pais); await AsyncStorage.setItem('pais', r.data.cuenta.pais); }
    return r;
  }, [guardar]);
  const ingresarDomiciliario = useCallback(async (correo, password) => {
    const r = await api('/auth/login', 'POST', { correo, password });
    if (r.success && r.data.user.rol !== 'domiciliario') return { success: false, error: 'Esta cuenta no es de domiciliario' };
    if (r.success) { await guardar(r.data.token, 'domiciliario'); setCuenta(null); setDomiciliario(r.data.user); setModo('domiciliario'); }
    return r;
  }, [guardar]);
  const salir = useCallback(async () => { usarToken(null); await SecureStore.deleteItemAsync('token', OP); await AsyncStorage.removeItem('modo'); setCuenta(null); setDomiciliario(null); setModo('cliente'); }, []);
  const ponerLugar = useCallback(async l => { setLugar(l); await AsyncStorage.setItem('lugar', JSON.stringify(l)); }, []);
  const ponerPais = useCallback(async p => { setPais(p); await AsyncStorage.setItem('pais', p); }, []);

  const valor = useMemo(() => ({ listo, modo, cuenta, domiciliario, pais, lugar, ingresarCliente, ingresarDomiciliario, salir, ponerLugar, ponerPais }), [listo, modo, cuenta, domiciliario, pais, lugar, ingresarCliente, ingresarDomiciliario, salir, ponerLugar, ponerPais]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
