import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Easing, ScrollView, Text, View, useAnimatedValue } from 'react-native';
import { api } from '../../api/client';
import { Boton, Caja, Cargando, Progreso, Titulo, Vacio } from '../../components/ui';
import { C } from '../../utils/tema';

export default function PuntosScreen({ route }) {
  const { slug } = route.params;
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [premio, setPremio] = useState('');
  const [girando, setGirando] = useState(false);
  const giro = useAnimatedValue(0);
  const cargar = useCallback(async () => { const r = await api(`/tienda/t/${slug}/juego`); if (r.success) setG(r.data); else setError(r.error); }, [slug]);
  useEffect(() => { cargar(); }, [cargar]);
  const girar = async () => {
    setGirando(true); setPremio('');
    const r = await api(`/tienda/t/${slug}/girar/${g.giros[0]._id}`, 'POST', {});
    if (!r.success) { setGirando(false); return Alert.alert('Ruleta', r.error); }
    giro.setValue(0);
    Animated.timing(giro, { toValue: 1, duration: 2600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => { setGirando(false); setPremio(r.data.puntos ? `¡Ganaste ${r.data.premio}!` : r.data.premio); cargar(); });
  };
  if (!g) return error ? <Vacio icono="cloud-offline-outline" texto={error} /> : <Cargando />;
  const n = g.nivel;
  return (
    <ScrollView style={{ backgroundColor: C.fondo }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <View style={{ backgroundColor: C.noche, borderRadius: 24, padding: 22, gap: 6, borderWidth: 2, borderColor: n.actual.color }}>
        <Text style={{ color: n.actual.color, fontWeight: '700' }}>Nivel {n.actual.nombre}</Text>
        <Text style={{ color: '#fff', fontSize: 50, fontWeight: '800', letterSpacing: -2 }}>{g.puntos}</Text><Text style={{ color: '#9DB0CC' }}>puntos</Text>
        <Progreso pct={n.avance} color={n.actual.color} /><Text style={{ color: '#9DB0CC', marginTop: 4 }}>{n.siguiente ? `Te faltan ${n.faltan} para ${n.siguiente.nombre}` : 'Estás en el nivel máximo'}{g.racha?.semanas > 1 ? ` · racha de ${g.racha.semanas} semanas` : ''}</Text>
      </View>
      {g.giros.length || premio ? <Caja style={{ alignItems: 'center' }}><Titulo>Ruleta</Titulo><Animated.Text style={{ fontSize: 76, transform: [{ rotate: giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1800deg'] }) }] }}>🎡</Animated.Text><Text style={{ fontWeight: '800', fontSize: 18, color: C.texto, minHeight: 24 }}>{premio}</Text>{g.giros.length ? <View style={{ alignSelf: 'stretch' }}><Boton titulo={`Girar (${g.giros.length})`} onPress={girar} cargando={girando} /></View> : null}</Caja> : null}
      {g.misiones.length ? <Caja><Titulo>Misiones</Titulo>{g.misiones.map(m => <View key={m._id} style={{ gap: 5, paddingVertical: 6 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontWeight: '700', color: C.texto }}>{m.nombre}</Text><Text style={{ fontWeight: '700', color: m.completada ? C.verde : C.cian }}>{m.completada ? 'Lista' : `+${m.premioPuntos}`}</Text></View><Text style={{ color: C.texto2 }}>{m.descripcion}</Text><Progreso pct={m.avance * 100 / m.meta} color={m.completada ? C.verde : C.cian} /></View>)}</Caja> : null}
      {g.recompensas.length ? <Caja><Titulo>Recompensas en caja</Titulo>{g.recompensas.map(r => <View key={r._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}><Text style={{ color: C.texto, flex: 1 }}>{r.nombre}{r.nivelMinimo ? ` (nivel ${r.nivelMinimo})` : ''}</Text><Text style={{ fontWeight: '700', color: g.puntos >= r.puntos ? C.verde : C.texto3 }}>{r.puntos} pts</Text></View>)}</Caja> : null}
      {g.insignias.length ? <Caja><Titulo>Insignias</Titulo><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{g.insignias.map(i => <View key={i.codigo} style={{ backgroundColor: C.fondo, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8 }}><Text style={{ fontWeight: '600', color: C.texto }}>{i.nombre}</Text></View>)}</View></Caja> : null}
    </ScrollView>
  );
}
