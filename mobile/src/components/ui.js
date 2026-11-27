import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../utils/tema';

export const Boton = ({ titulo, onPress, cargando, disabled, tipo = 'p', icono, color }) => (
  <Pressable onPress={onPress} disabled={disabled || cargando} accessibilityRole="button" style={({ pressed }) => [s.btn, tipo === 's' && s.btnS, color && tipo === 'p' && { backgroundColor: color }, (disabled || cargando) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
    {cargando ? <ActivityIndicator color={tipo === 's' ? C.cian : '#fff'} /> : <>{icono ? <Ionicons name={icono} size={19} color={tipo === 's' ? C.texto : '#fff'} /> : null}<Text style={[s.btnT, tipo === 's' && { color: C.texto }]}>{titulo}</Text></>}
  </Pressable>
);
export const Campo = ({ etiqueta, ...p }) => (<View style={{ gap: 6 }}>{etiqueta ? <Text style={s.et}>{etiqueta}</Text> : null}<TextInput placeholderTextColor={C.texto3} {...p} style={[s.in, p.style]} /></View>);
export const Caja = ({ children, style }) => <View style={[s.caja, style]}>{children}</View>;
export const Titulo = ({ children, style }) => <Text style={[s.h, style]}>{children}</Text>;
export const Aviso = ({ tipo = 'i', children }) => (<View style={[s.av, { backgroundColor: { b: '#E4F8F0', m: '#FDECEE', i: '#FFF4DF' }[tipo] }]}><Text style={{ color: { b: C.verde, m: C.rojo, i: '#8A5200' }[tipo], lineHeight: 20 }}>{children}</Text></View>);
export const Opcion = ({ titulo, sub, icono, on, onPress, derecha }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} style={[s.op, on && { borderColor: C.cian, backgroundColor: '#EAF8FA' }]}>
    {icono ? <Ionicons name={icono} size={22} color={C.cian} /> : null}
    <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.texto, fontSize: 15 }}>{titulo}</Text>{sub ? <Text style={{ color: C.texto2, marginTop: 2, fontSize: 13 }}>{sub}</Text> : null}</View>{derecha}
  </Pressable>
);
export const Fila = ({ a, b, fuerte, color }) => (<View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}><Text style={{ color: fuerte ? C.texto : color || C.texto2, fontWeight: fuerte ? '800' : '400', fontSize: fuerte ? 19 : 15 }}>{a}</Text><Text style={{ color: fuerte ? C.texto : color || C.texto2, fontWeight: fuerte ? '800' : '500', fontSize: fuerte ? 19 : 15 }}>{b}</Text></View>);
export const Progreso = ({ pct, color = C.cian }) => <View style={s.pb}><View style={{ height: 8, borderRadius: 5, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} /></View>;
export const Vacio = ({ icono, texto }) => <View style={{ alignItems: 'center', padding: 50, gap: 12 }}><Ionicons name={icono} size={42} color={C.texto3} /><Text style={{ color: C.texto2, textAlign: 'center', lineHeight: 21 }}>{texto}</Text></View>;
export const Cargando = () => <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}><ActivityIndicator size="large" color={C.cian} /></View>;

const s = StyleSheet.create({
  btn: { minHeight: 54, borderRadius: 17, backgroundColor: C.cian, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 18 }, btnS: { backgroundColor: C.fondo }, btnT: { color: '#fff', fontWeight: '700', fontSize: 16 },
  et: { fontSize: 13, fontWeight: '600', color: C.texto2 }, in: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: C.linea, paddingHorizontal: 15, fontSize: 16, backgroundColor: C.blanco, color: C.texto },
  caja: { backgroundColor: C.blanco, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: C.linea, gap: 10 }, h: { fontSize: 17, fontWeight: '800', color: C.texto, letterSpacing: -0.3 }, av: { borderRadius: 14, padding: 13 },
  op: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: 15, borderWidth: 1.5, borderColor: C.linea, backgroundColor: C.blanco, minHeight: 56 }, pb: { height: 8, borderRadius: 5, backgroundColor: 'rgba(140,160,190,0.25)', overflow: 'hidden' },
});
