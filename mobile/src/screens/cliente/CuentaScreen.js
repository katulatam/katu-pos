import { useEffect, useState } from 'react';
import { Image, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../api/client';
import { Boton, Caja, Opcion, Titulo } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { C } from '../../utils/tema';

export default function CuentaScreen({ navigation }) {
  const { cuenta, lugar, salir } = useSesion();
  const [qr, setQr] = useState(null);
  useEffect(() => { if (cuenta) api('/tienda/cuenta/qr').then(r => r.success && setQr(r.data.qr)); else setQr(null); }, [cuenta]);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.fondo }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.texto, letterSpacing: -0.8 }}>{cuenta ? cuenta.nombre : 'Mi cuenta'}</Text>
        {cuenta ? <Caja style={{ alignItems: 'center' }}><Titulo>Muéstralo en la caja</Titulo>{qr ? <Image source={{ uri: qr }} style={{ width: 200, height: 200 }} /> : null}<Text style={{ fontWeight: '700', letterSpacing: 1, color: C.texto }}>{cuenta.codigo}</Text><Text style={{ color: C.texto2, textAlign: 'center' }}>El cajero lo escanea y sumas puntos en esa tienda.</Text></Caja> : <Boton titulo="Ingresar o crear cuenta" onPress={() => navigation.navigate('Ingreso')} />}
        <Opcion icono="location-outline" titulo="Mi dirección" sub={lugar?.direccion || 'Sin definir'} onPress={() => navigation.navigate('Lugar')} />
        {!cuenta ? <Opcion icono="bicycle" titulo="Soy domiciliario" sub="Ingresa con la cuenta que te dio la tienda" onPress={() => navigation.navigate('Ingreso', { domiciliario: true })} /> : null}
        {cuenta ? <Boton tipo="s" icono="log-out-outline" titulo="Cerrar sesión" onPress={salir} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
