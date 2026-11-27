import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../api/client';
import { Aviso, Campo, Cargando, Vacio } from '../../components/ui';
import { useCarrito } from '../../context/CarritoContext';
import { useSesion } from '../../context/SesionContext';
import { Motor, ahora, cantidad, dinero } from '../../utils/formato';
import { C } from '../../utils/tema';

const sin = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function TiendaScreen({ navigation, route }) {
  const { slug } = route.params;
  const { lugar, cuenta } = useSesion();
  const { todos, mover, calcular } = useCarrito();
  const abajo = useSafeAreaInsets().bottom;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [cot, setCot] = useState(null);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => { api(`/tienda/t/${slug}/catalogo`).then(r => (r.success ? setD(r.data) : setError(r.error))); }, [slug]);
  useEffect(() => { if (lugar) api(`/tienda/t/${slug}/cotizar`, 'POST', { lat: lugar.lat, lng: lugar.lng, total: 0 }).then(r => r.success && setCot(r.data)); }, [slug, lugar]);
  useLayoutEffect(() => { if (d?.empresa.gamificacion && cuenta) navigation.setOptions({ headerRight: () => <Pressable accessibilityLabel="Mis puntos" hitSlop={12} onPress={() => navigation.navigate('Puntos', { slug })}><Ionicons name="trophy" size={23} color={C.cian} /></Pressable> }); }, [d, cuenta, navigation, slug]);

  const lista = useMemo(() => { if (!d) return []; const t = sin(q.trim()); return d.productos.filter(p => (t ? sin(`${p.nombre} ${p.marca}`).includes(t) : !cat || p.categoria === cat)); }, [d, q, cat]);
  const cats = useMemo(() => new Map((d?.categorias || []).map(c => [c._id, c])), [d]);
  const promos = useMemo(() => (d ? d.promociones.filter(p => Motor.promoVigente(p, ahora(d.empresa.zonaHoraria))) : []), [d]);
  const tarjeta = useCallback(({ item: p }) => {
    const n = todos[slug]?.[p._id];
    const color = cats.get(p.categoria)?.color || C.cian;
    const pr = promos.find(x => x.alcance === 'todo' || (x.objetivos || []).includes(x.alcance === 'categoria' ? p.categoria : p._id));
    return (
      <View style={{ flex: 1, maxWidth: '50%', padding: 6 }}>
        <View style={{ backgroundColor: C.blanco, borderRadius: 20, borderWidth: 1, borderColor: C.linea, padding: 11, opacity: p.agotado ? 0.5 : 1, flex: 1 }}>
          <View style={{ height: 96, borderRadius: 14, backgroundColor: `${color}1C`, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{p.imagenUrl ? <Image source={{ uri: p.imagenUrl }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontSize: 34, fontWeight: '800', color }}>{p.nombre[0]}</Text>}</View>
          {pr ? <View style={{ position: 'absolute', top: 18, left: 18, backgroundColor: C.rojo, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: '#fff', fontSize: 11.5, fontWeight: '700' }}>{pr.tipo === 'porcentaje' ? `−${pr.valor}%` : pr.tipo === 'nxm' ? `${pr.lleva}×${pr.paga}` : 'Oferta'}</Text></View> : null}
          <Text numberOfLines={2} style={{ fontWeight: '600', color: C.texto, marginTop: 9, minHeight: 36 }}>{p.nombre}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ fontWeight: '800', color: C.texto, flexShrink: 1 }}>{dinero(p.precio, d.pais)}{p.tipo === 'peso' ? <Text style={{ fontWeight: '500', color: C.texto3, fontSize: 12 }}> /{p.unidad}</Text> : null}</Text>
            {p.agotado ? <Text style={{ color: C.texto3, fontSize: 12 }}>Agotado</Text> : !n ? <Pressable accessibilityLabel={`Agregar ${p.nombre}`} onPress={() => mover(slug, p, 1)} style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: C.cian, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={22} color="#fff" /></Pressable> : null}
          </View>
          {n ? <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.texto, borderRadius: 14, marginTop: 8 }}>{[[-1, 'remove'], [0], [1, 'add']].map(([s, i]) => (i ? <Pressable key={i} accessibilityLabel={s > 0 ? 'Agregar' : 'Quitar'} onPress={() => mover(slug, p, s)} style={{ padding: 11 }}><Ionicons name={i} size={18} color="#fff" /></Pressable> : <Text key="n" style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700' }}>{cantidad(n, p)}</Text>))}</View> : null}
        </View>
      </View>
    );
  }, [todos, slug, cats, promos, d, mover]);

  if (error) return <Vacio icono="cloud-offline-outline" texto={error} />;
  if (!d) return <Cargando />;
  const c = calcular(slug, d);
  return (
    <View style={{ flex: 1, backgroundColor: C.fondo }}>
      <FlatList
        data={lista} numColumns={2} keyExtractor={p => p._id} renderItem={tarjeta} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 8, paddingBottom: 110 + abajo }}
        ListHeaderComponent={<View style={{ padding: 8, gap: 12 }}>
          {cot ? (!cot.cubre ? <Aviso tipo="m">Tu dirección está fuera de la zona de domicilios.{d.empresa.recoger ? ' Puedes recoger en la tienda.' : ''}</Aviso> : !cot.abierta ? <Aviso>Cerrado en este momento{cot.horario ? `. Atiende de ${cot.horario}` : ''}.</Aviso> : <Aviso tipo="b">Llega en unos {cot.minutos} min · {cot.tarifa ? dinero(cot.tarifa, d.pais) : 'domicilio gratis'}{cot.gratisDesde ? ` · gratis desde ${dinero(cot.gratisDesde, d.pais)}` : ''}</Aviso>) : null}
          <Campo placeholder="¿Qué necesitas hoy?" value={q} onChangeText={setQ} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{[{ _id: '', nombre: 'Todo' }, ...d.categorias].map(x => <Pressable key={x._id} onPress={() => { setCat(x._id); setQ(''); }} style={{ paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, backgroundColor: cat === x._id ? C.texto : C.blanco, borderWidth: 1, borderColor: C.linea }}><Text style={{ fontWeight: '600', color: cat === x._id ? '#fff' : C.texto }}>{x.nombre}</Text></Pressable>)}</ScrollView>
        </View>}
        ListEmptyComponent={<Vacio icono="search" texto="No encontramos productos." />}
      />
      {c.lineas.length ? (
        <Pressable onPress={() => navigation.navigate('Pago', { slug, catalogo: d })} style={{ position: 'absolute', left: 16, right: 16, bottom: 16 + abajo, height: 64, borderRadius: 22, backgroundColor: C.texto, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 13 }}>
          <View style={{ backgroundColor: C.cian, borderRadius: 12, minWidth: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>{c.lineas.length}</Text></View>
          <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }}>Ver mi pedido</Text><Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>{dinero(c.totalProductos, d.pais)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
