import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSesion } from '../context/SesionContext';
import { C } from '../utils/tema';
import InicioScreen from '../screens/cliente/InicioScreen';
import TiendaScreen from '../screens/cliente/TiendaScreen';
import PagoScreen from '../screens/cliente/PagoScreen';
import SeguimientoScreen from '../screens/cliente/SeguimientoScreen';
import PedidosScreen from '../screens/cliente/PedidosScreen';
import CuentaScreen from '../screens/cliente/CuentaScreen';
import PuntosScreen from '../screens/cliente/PuntosScreen';
import IngresoScreen from '../screens/auth/IngresoScreen';
import LugarScreen from '../screens/cliente/LugarScreen';
import EntregasScreen from '../screens/domiciliario/EntregasScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const ICONO = { Tiendas: 'storefront', Pedidos: 'receipt', Cuenta: 'person-circle' };

function Tabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({ headerShown: false, tabBarActiveTintColor: C.cian, tabBarInactiveTintColor: C.texto3, tabBarIcon: ({ color, size }) => <Ionicons name={ICONO[route.name]} color={color} size={size} /> })}>
      <Tab.Screen name="Tiendas" component={InicioScreen} />
      <Tab.Screen name="Pedidos" component={PedidosScreen} />
      <Tab.Screen name="Cuenta" component={CuentaScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { listo, modo } = useSesion();
  if (!listo) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.noche }}><ActivityIndicator size="large" color={C.vivo} /></View>;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerTintColor: C.texto, headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
        {modo === 'domiciliario' ? (
          <Stack.Screen name="Entregas" component={EntregasScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Inicio" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="Tienda" component={TiendaScreen} options={({ route }) => ({ title: route.params?.nombre || 'Tienda' })} />
            <Stack.Screen name="Pago" component={PagoScreen} options={{ title: 'Tu pedido' }} />
            <Stack.Screen name="Seguimiento" component={SeguimientoScreen} options={({ route }) => ({ title: route.params?.numero || 'Tu pedido' })} />
            <Stack.Screen name="Puntos" component={PuntosScreen} options={{ title: 'Mis puntos' }} />
            <Stack.Screen name="Lugar" component={LugarScreen} options={{ title: '¿Dónde estás?' }} />
            <Stack.Screen name="Ingreso" component={IngresoScreen} options={{ title: 'Tu cuenta', presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
