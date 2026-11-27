import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../api/client';
import { Boton, Opcion, Vacio } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { dinero } from '../../utils/formato';
import { C, ESTADOS } from '../../utils/tema';

export default function PedidosScreen({ navigation }) {
  const { cuenta } = useSesion();
  const [l, setL] = useState([]);
  const [cargando, setCargando] = useState(false);
  const cargar = useCallback(async () => { if (!cuenta) return setL([]); setCargando(true); const r = await api('/tienda/cuenta/pedidos'); setCargando(false); if (r.success) setL(r.data); }, [cuenta]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.fondo }}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: C.texto, padding: 18, letterSpacing: -0.8 }}>Mis pedidos</Text>
      <FlatList data={l} keyExtractor={p => p.seguimiento} contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar} />}
        ListEmptyComponent={cuenta ? <Vacio icono="receipt-outline" texto="Todavía no has hecho pedidos." /> : <View style={{ gap: 16 }}><Vacio icono="person-circle-outline" texto="Ingresa para ver tus pedidos y repetirlos." /><Boton titulo="Ingresar" onPress={() => navigation.navigate('Ingreso')} /></View>}
        renderItem={({ item: p }) => <Opcion icono="bag-handle-outline" titulo={`${p.empresa?.nombre || ''} · ${p.numero}`} sub={`${new Date(p.createdAt).toLocaleDateString()} · ${ESTADOS[p.estado]} · ${dinero(p.total, { moneda: p.moneda, decimales: p.decimales, locale: 'es' })}`} onPress={() => navigation.navigate('Seguimiento', { token: p.seguimiento, numero: p.numero })} />} />
    </SafeAreaView>
  );
}
