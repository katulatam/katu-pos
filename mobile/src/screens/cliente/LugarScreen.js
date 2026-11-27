import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import Mapa from '../../components/Mapa';
import { Aviso, Boton, Campo } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { C } from '../../utils/tema';

export default function LugarScreen({ navigation }) {
  const { lugar, ponerLugar } = useSesion();
  const [p, setP] = useState(lugar ? { lat: lugar.lat, lng: lugar.lng } : null);
  const [centro, setCentro] = useState(lugar || { lat: 4.65, lng: -74.06 });
  const [direccion, setDireccion] = useState(lugar?.direccion || '');
  const [detalle, setDetalle] = useState(lugar?.detalle || '');
  const [cargando, setCargando] = useState(false);

  const ubicar = async () => {
    setCargando(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Ubicación', 'Sin permiso de ubicación puedes tocar el mapa para marcar tu casa.');
      const g = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const q = { lat: g.coords.latitude, lng: g.coords.longitude };
      setP(q); setCentro(q);
    } catch { Alert.alert('Ubicación', 'No se pudo obtener. Toca el mapa para marcar el punto.'); } finally { setCargando(false); }
  };
  const guardar = async () => {
    if (!p) return Alert.alert('Falta el punto', 'Toca el mapa o usa tu ubicación.');
    if (!direccion.trim()) return Alert.alert('Falta la dirección', 'Escribe la dirección para el domiciliario.');
    await ponerLugar({ ...p, direccion: direccion.trim(), detalle: detalle.trim() });
    navigation.goBack();
  };
  return (
    <ScrollView style={{ backgroundColor: C.fondo }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Mapa centro={centro} puntos={p ? [{ ...p, color: '#CC2F45' }] : []} elegir={setP} alto={300} />
      <Boton tipo="s" icono="locate" titulo="Usar mi ubicación" onPress={ubicar} cargando={cargando} />
      {!p ? <Aviso>Toca el mapa para marcar el punto exacto de entrega.</Aviso> : null}
      <Campo etiqueta="Dirección" value={direccion} onChangeText={setDireccion} />
      <Campo etiqueta="Apartamento, torre, indicaciones" value={detalle} onChangeText={setDetalle} />
      <Boton titulo="Confirmar punto" onPress={guardar} />
    </ScrollView>
  );
}
