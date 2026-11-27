import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api } from '../../api/client';
import { Boton, Campo, Cargando, Vacio } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { dinero } from '../../utils/formato';
import { C } from '../../utils/tema';

const navegar = p => Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${p.lat},${p.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`);

export default function EntregasScreen() {
  const { salir } = useSesion();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [entrega, setEntrega] = useState(null);
  const [pin, setPin] = useState('');
  const [ref, setRef] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const rastreo = useRef(null);

  const cargar = useCallback(async () => {
    const r = await api('/domiciliario/inicio');
    if (r.success) { setD(r.data); setError(''); } else { setError(r.error); if (r.http === 401) salir(); }
  }, [salir]);
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (AppState.currentState === 'active') cargar(); }, 10000);
    return () => clearInterval(t);
  }, [cargar]);

  // La ubicación se comparte SOLO con un pedido en camino y la app abierta
  const enRuta = !!d?.asignados.some(p => p.estado === 'en_camino');
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (enRuta && !rastreo.current) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Ubicación', 'Activa el permiso para que el cliente vea por dónde vas.');
        const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 0 }, g => { api('/domiciliario/ubicacion', 'POST', { lat: g.coords.latitude, lng: g.coords.longitude }); });
        if (!vivo) return s.remove();
        rastreo.current = s;
        activateKeepAwakeAsync('ruta').catch(() => {});
      } else if (!enRuta && rastreo.current) { rastreo.current.remove(); rastreo.current = null; deactivateKeepAwake('ruta').catch(() => {}); }
    })();
    return () => { vivo = false; };
  }, [enRuta]);
  useEffect(() => () => { rastreo.current?.remove(); rastreo.current = null; }, []);

  const accion = async (id, que) => { setOcupado(true); const r = await api(`/domiciliario/pedidos/${id}/${que}`, 'POST', {}); setOcupado(false); if (!r.success) Alert.alert('Pedido', r.error); cargar(); };
  const entregar = async () => { setOcupado(true); const r = await api(`/domiciliario/pedidos/${entrega._id}/entregar`, 'POST', { pin, referencia: ref }); setOcupado(false); if (!r.success) return Alert.alert('No se pudo entregar', r.error); setEntrega(null); setPin(''); setRef(''); cargar(); };
  if (!d) return <SafeAreaView style={{ flex: 1, backgroundColor: C.noche }}>{error ? <><Vacio icono="cloud-offline-outline" texto={error} /><View style={{ padding: 20 }}><Boton tipo="s" titulo="Salir" onPress={salir} /></View></> : <Cargando />}</SafeAreaView>;
  const din = n => dinero(n, d.pais);

  const tarjeta = p => (
    <View key={p._id} style={{ backgroundColor: C.noche2, borderRadius: 22, padding: 18, gap: 11 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{p.numero}</Text><Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{din(p.total)}</Text></View>
      {p.contacto ? <><Text style={{ color: C.claro, fontWeight: '600' }}>{p.contacto.nombre}</Text><Text style={{ color: '#9DB0CC', lineHeight: 20 }}>{[p.entrega.direccion, p.entrega.detalle].filter(Boolean).join(', ')}{p.entrega.notas ? `\n${p.entrega.notas}` : ''}</Text><Text style={{ color: p.pagado ? '#2EE6A6' : '#FFB547', fontWeight: '700' }}>{p.pagado ? 'Ya está pagado' : p.tipoPago === 'efectivo' ? `Cobra ${din(p.total)} en efectivo${p.pagaCon ? ` · lleva cambio de ${din(p.pagaCon - p.total)}` : ''}` : `Cobra ${din(p.total)} con datáfono`}</Text></> : <Text style={{ color: '#9DB0CC' }}>{p.sede?.nombre} · a {((p.entrega?.distanciaM || 0) / 1000).toFixed(1)} km</Text>}
      {!p.contacto ? <Boton titulo="Tomar pedido" onPress={() => accion(p._id, 'tomar')} disabled={ocupado} /> : p.estado === 'listo' ? <Boton titulo="Salir a entregar" icono="bicycle" onPress={() => accion(p._id, 'salir')} disabled={ocupado} /> : <>
        <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Boton tipo="s" icono="navigate" titulo="Navegar" onPress={() => navegar(p.entrega)} /></View><View style={{ flex: 1 }}><Boton tipo="s" icono="call" titulo="Llamar" onPress={() => Linking.openURL(`tel:${p.contacto.telefono}`)} /></View></View>
        <Boton titulo="Entregar con PIN" onPress={() => setEntrega(p)} /></>}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.noche }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} refreshControl={<RefreshControl tintColor={C.vivo} refreshing={cargando} onRefresh={async () => { setCargando(true); await cargar(); setCargando(false); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>{d.usuario.nombre}</Text><Text style={{ color: '#9DB0CC' }}>{d.empresa}</Text></View><Pressable onPress={async () => { await api('/domiciliario/disponible', 'PUT', { disponible: !d.usuario.disponible }); cargar(); }} style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 15, backgroundColor: d.usuario.disponible ? '#2EE6A6' : C.noche2 }}><Text style={{ fontWeight: '700', color: d.usuario.disponible ? '#04131A' : '#FFB547' }}>{d.usuario.disponible ? 'Disponible' : 'En pausa'}</Text></Pressable><Pressable accessibilityLabel="Salir" hitSlop={10} onPress={salir}><Ionicons name="log-out-outline" size={25} color="#9DB0CC" /></Pressable></View>
        <View style={{ flexDirection: 'row', gap: 10 }}>{[[d.hoy.n, 'entregas hoy'], [d.hoy.estrellas ? `${d.hoy.estrellas.toFixed(1)} ★` : '—', 'calificación'], [din(d.porEntregar), 'por entregar']].map(x => <View key={x[1]} style={{ flex: 1, backgroundColor: C.noche2, borderRadius: 18, padding: 13, alignItems: 'center' }}><Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{x[0]}</Text><Text style={{ color: '#9DB0CC', fontSize: 12 }}>{x[1]}</Text></View>)}</View>
        {d.asignados.length ? <Text style={{ color: C.claro, fontWeight: '700' }}>Mis pedidos</Text> : null}{d.asignados.map(tarjeta)}
        {d.libres.length ? <Text style={{ color: C.claro, fontWeight: '700' }}>Disponibles</Text> : null}{d.libres.map(tarjeta)}
        {!d.asignados.length && !d.libres.length ? <Vacio icono="cafe-outline" texto="No hay pedidos por ahora." /> : null}
      </ScrollView>
      <Modal visible={!!entrega} animationType="slide" transparent onRequestClose={() => setEntrega(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}><View style={{ backgroundColor: C.blanco, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 14, paddingBottom: 40 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.texto }}>Entregar {entrega?.numero}</Text>
          {entrega && !entrega.pagado ? <Text style={{ color: C.texto2 }}>Recibe {din(entrega.total)} {entrega.tipoPago === 'efectivo' ? 'en efectivo' : 'con datáfono'}.</Text> : null}
          <Campo value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={4} placeholder="PIN del cliente" style={{ fontSize: 28, textAlign: 'center', fontWeight: '800', letterSpacing: 8 }} autoFocus />
          {entrega?.tipoPago === 'datafono' ? <Campo value={ref} onChangeText={setRef} placeholder="Código de autorización" /> : null}
          <Boton titulo="Confirmar entrega" onPress={entregar} cargando={ocupado} disabled={pin.length !== 4} /><Boton tipo="s" titulo="Volver" onPress={() => setEntrega(null)} />
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}
