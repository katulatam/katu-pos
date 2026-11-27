import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SesionProvider } from './src/context/SesionContext';
import { CarritoProvider } from './src/context/CarritoContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <SesionProvider>
        <CarritoProvider>
          <StatusBar style="auto" />
          <AppNavigator />
        </CarritoProvider>
      </SesionProvider>
    </SafeAreaProvider>
  );
}
