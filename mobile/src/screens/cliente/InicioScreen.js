import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../api/client';
import { Aviso, Vacio } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { C } from '../../utils/tema';

export default function InicioScreen({ navigation }) {
  const { cuenta, lugar, pais, ponerPais } = useSesion();
  const [tiendas, setTiendas] = useState(null);
  const [paises, setPaises] = useState([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await api(`/tienda/cercanas?pais=${pais}${lugar ? `&lat=${lugar.lat}&lng=${lugar.lng}` : ''}`);
    setCargando(false);
    if (r.success) { setTiendas(r.data); setError(''); } else setError(r.error);
  }, [pais, lugar]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { api('/tienda/paises').then(r => r.success && setPaises(r.data)); }, []);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.noche }}>
      <View style={{ padding: 18, gap: 14 }}>
        <Text style={{ color: C.claro, fontSize: 26, fontWeight: '800', letterSpacing: -0.8 }}>{cuenta ? `Hola, ${cuenta.nombre.split(' ')[0]}` : 'Katú Market'}</Text>
        <Pressable onPress={() => navigation.navigate('Lugar')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.noche2, borderRadius: 16, padding: 15 }}>
          <Ionicons name="location" size={20} color={C.vivo} />
          <Text numberOfLines={1} style={{ color: C.claro, flex: 1, fontWeight: '600' }}>{lugar ? lugar.direccion : '¿Dónde estás?'}</Text>
          <Ionicons name="chevron-down" size={18} color={C.texto3} />
        </Pressable>
        {!cuenta && paises.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {paises.map(p => <Pressable key={p.codigo} onPress={() => ponerPais(p.codigo)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: p.codigo === pais ? C.vivo : C.noche2 }}><Text style={{ color: p.codigo === pais ? '#04131A' : C.claro, fontWeight: '600' }}>{p.nombre}</Text></Pressable>)}
          </ScrollView>
        ) : null}
      </View>
      <FlatList
        style={{ backgroundColor: C.fondo, borderTopLeftRadius: 26, borderTopRightRadius: 26 }}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        data={tiendas || []}
        keyExtractor={t => t.slug}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar} />}
        ListHeaderComponent={error ? <Aviso tipo="m">{error}</Aviso> : !lugar ? <Aviso>Marca tu ubicación para ver qué tiendas llegan a tu casa.</Aviso> : null}
        ListEmptyComponent={tiendas ? <Vacio icono="storefront-outline" texto="Todavía no hay tiendas en este país." /> : null}
        renderItem={({ item: t }) => {
          const c = t.cobertura;
          return (
            <Pressable onPress={() => navigation.navigate('Tienda', { slug: t.slug, nombre: t.nombre })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.blanco, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: C.linea }}>
              <View style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: t.color || C.cian, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {t.logoUrl ? <Image source={{ uri: t.logoUrl }} style={{ width: 54, height: 54 }} /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>{t.nombre[0]}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: C.texto }}>{t.nombre}</Text>
                <Text style={{ color: C.texto2, marginTop: 3 }}>{c.cubre ? `${(c.distancia / 1000).toFixed(1)} km · ${c.minutos} min` : t.ciudad}</Text>
              </View>
              <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, backgroundColor: c.cubre && c.abierta ? '#E4F8F0' : C.fondo }}><Text style={{ fontSize: 12.5, fontWeight: '700', color: c.cubre && c.abierta ? C.verde : C.texto2 }}>{c.cubre ? (c.abierta ? 'Llega a tu casa' : 'Cerrado') : t.recoger ? 'Recoger' : 'Sin cobertura'}</Text></View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
