import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../api/client';
import Mapa from '../../components/Mapa';
import { Aviso, Boton, Caja, Cargando, Fila, Titulo, Vacio } from '../../components/ui';
import { dinero } from '../../utils/formato';
import { C } from '../../utils/tema';

const PASOS = ['recibido', 'preparando', 'listo', 'en_camino', 'entregado'];
const TX = { recibido: ['Recibimos tu pedido', 'La tienda lo está revisando.'], preparando: ['Estamos preparando tu pedido', 'Alistando cada producto.'], listo: ['Tu pedido está listo', 'Esperando al domiciliario.'], en_camino: ['Tu pedido va en camino', 'Ten a la mano tu PIN.'], entregado: ['¡Entregado!', 'Gracias por tu compra.'], cancelado: ['Pedido cancelado', ''] };

export default function SeguimientoScreen({ route }) {
  const { token } = route.params;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [cobro, setCobro] = useState(null);
  const [cargando, setCargando] = useState(false);
  const fin = useRef(false);

  const cargar = useCallback(async () => {
    const r = await api(`/publico/seguimiento/${token}`);
    if (r.success) { setD(r.data); setError(''); fin.current = ['entregado', 'cancelado'].includes(r.data.estado); } else setError(r.error);
  }, [token]);
  useEffect(() => { cargar(); const t = setInterval(() => { if (!fin.current) cargar(); }, 7000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => {
    if (cobro?.estado !== 'pendiente') return undefined;
    const t = setInterval(async () => { const r = await api(`/publico/seguimiento/${token}/pago/${cobro._id}`); if (!r.success || r.data.estado === 'pendiente') return; setCobro(null); if (r.data.estado === 'aprobado') cargar(); else Alert.alert('Pago', 'El pago no se completó. Puedes intentarlo de nuevo.'); }, 3000);
    return () => clearInterval(t);
  }, [cobro, token, cargar]);
  const pagar = async () => { setCargando(true); const r = await api(`/publico/seguimiento/${token}/pagar`, 'POST', {}); setCargando(false); if (!r.success) return Alert.alert('Pago', r.error); if (r.data.estado === 'aprobado') return cargar(); setCobro(r.data); };
  const calificar = async n => { const r = await api(`/publico/seguimiento/${token}/calificar`, 'POST', { estrellas: n }); if (!r.success) return Alert.alert('Calificación', r.error); cargar(); };

  if (!d) return error ? <Vacio icono="cloud-offline-outline" texto={error} /> : <Cargando />;
  const i = PASOS.indexOf(d.estado), recoge = d.tipo === 'recoger' && d.estado === 'listo', u = d.domiciliario?.ubicacion;
  return (
    <ScrollView style={{ backgroundColor: C.fondo }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Caja><Text style={{ fontSize: 22, fontWeight: '800', color: C.texto, letterSpacing: -0.5 }}>{recoge ? 'Pasa por tu pedido' : TX[d.estado][0]}</Text><Text style={{ color: C.texto2 }}>{d.estado === 'cancelado' ? d.motivoCancelacion : recoge ? [d.sede.nombre, d.sede.direccion].filter(Boolean).join(', ') : TX[d.estado][1]}</Text>{d.estado !== 'cancelado' ? <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>{PASOS.slice(0, 4).map((p, k) => <View key={p} style={{ flex: 1, height: 8, borderRadius: 5, backgroundColor: k <= i ? C.cian : C.linea, opacity: k === i && d.estado !== 'entregado' ? 0.55 : 1 }} />)}</View> : null}</Caja>
      {d.pin ? <Caja style={{ alignItems: 'center' }}><Titulo>PIN de entrega</Titulo><Text style={{ fontSize: 46, fontWeight: '800', letterSpacing: 12, color: C.texto }}>{d.pin}</Text><Text style={{ color: C.texto2, textAlign: 'center' }}>Dáselo al domiciliario solo cuando recibas el pedido.</Text></Caja> : null}
      {d.puedePagar ? <Caja style={{ alignItems: 'stretch' }}><Titulo>Pago</Titulo>{cobro ? <View style={{ alignItems: 'center', gap: 12 }}>{cobro.qrBase64 ? <Image source={{ uri: cobro.qrBase64 }} style={{ width: 230, height: 230 }} /> : null}{cobro.urlPago ? <Boton titulo="Abrir página de pago" icono="open-outline" onPress={() => Linking.openURL(cobro.urlPago)} /> : null}<Text style={{ color: C.texto2 }}>Esperando la confirmación…</Text></View> : <Boton titulo={`Pagar ${dinero(d.total, d.pais)}`} onPress={pagar} cargando={cargando} />}</Caja> : d.pagado ? <Aviso tipo="b">Pago confirmado.</Aviso> : d.porPesar && d.estado !== 'cancelado' ? <Aviso>Estamos pesando tus productos. El total puede variar un poco.</Aviso> : null}
      {d.estado === 'en_camino' ? <Caja><View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={{ flex: 1 }}><Titulo>{d.domiciliario?.nombre}</Titulo><Text style={{ color: C.texto2 }}>{d.domiciliario?.vehiculo}</Text></View>{d.domiciliario?.telefono ? <Pressable accessibilityLabel="Llamar al domiciliario" onPress={() => Linking.openURL(`tel:${d.domiciliario.telefono}`)} style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: C.cian, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="call" size={21} color="#fff" /></Pressable> : null}</View><Mapa centro={d.entrega} puntos={[{ ...d.entrega, color: '#CC2F45' }, ...(u ? [{ ...u, color: '#5A49E0' }] : [])]} /></Caja> : null}
      {d.estado === 'entregado' && !d.calificado ? <Caja style={{ alignItems: 'center' }}><Titulo>¿Cómo estuvo?</Titulo><View style={{ flexDirection: 'row', gap: 8 }}>{[1, 2, 3, 4, 5].map(n => <Pressable key={n} accessibilityLabel={`${n} estrellas`} onPress={() => calificar(n)}><Ionicons name="star" size={38} color="#F59E0B" /></Pressable>)}</View></Caja> : null}
      <Caja><Titulo>Detalle</Titulo>{d.items.map((p, k) => <Fila key={k} a={`${p.cantidadReal ?? p.cantidad} ${p.porPeso ? p.unidad : '×'} ${p.nombre}`} b={dinero(p.total, d.pais)} />)}{d.tipo === 'domicilio' ? <Fila a="Domicilio" b={d.domicilio ? dinero(d.domicilio, d.pais) : 'Gratis'} /> : null}<Fila fuerte a="Total" b={dinero(d.total, d.pais)} /><Text style={{ color: C.texto2 }}>{d.medioPago}{d.entrega ? ` · ${d.entrega.direccion}` : ''}</Text></Caja>
    </ScrollView>
  );
}
