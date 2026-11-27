import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { Boton, Campo } from '../../components/ui';
import { useSesion } from '../../context/SesionContext';
import { C } from '../../utils/tema';

export default function IngresoScreen({ navigation, route }) {
  const { pais, ingresarCliente, ingresarDomiciliario } = useSesion();
  const domi = !!route.params?.domiciliario;
  const [registro, setRegistro] = useState(false);
  const [f, setF] = useState({ nombre: '', telefono: '', correo: '', password: '', aceptaDatos: false });
  const [cargando, setCargando] = useState(false);
  const set = k => v => setF(x => ({ ...x, [k]: v }));

  const enviar = async () => {
    setCargando(true);
    const r = domi ? await ingresarDomiciliario(f.correo.trim(), f.password) : await ingresarCliente(registro, { pais, ...f });
    setCargando(false);
    if (!r.success) return Alert.alert('No se pudo ingresar', r.error);
    if (!domi) navigation.goBack();
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled" style={{ backgroundColor: C.blanco }}>
        {domi ? <Campo etiqueta="Correo" value={f.correo} onChangeText={set('correo')} autoCapitalize="none" keyboardType="email-address" /> : <>
          {registro ? <Campo etiqueta="Nombre" value={f.nombre} onChangeText={set('nombre')} autoComplete="name" /> : null}
          <Campo etiqueta="Celular" value={f.telefono} onChangeText={set('telefono')} keyboardType="phone-pad" autoComplete="tel" />
          {registro ? <Campo etiqueta="Correo (opcional)" value={f.correo} onChangeText={set('correo')} autoCapitalize="none" keyboardType="email-address" /> : null}
        </>}
        <Campo etiqueta="Contraseña" value={f.password} onChangeText={set('password')} secureTextEntry />
        {registro ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch value={f.aceptaDatos} onValueChange={set('aceptaDatos')} /><Text style={{ flex: 1, color: C.texto2 }}>Autorizo el tratamiento de mis datos personales</Text></View> : null}
        <Boton titulo={registro ? 'Crear cuenta' : 'Ingresar'} onPress={enviar} cargando={cargando} />
        {!domi ? <Boton tipo="s" titulo={registro ? 'Ya tengo cuenta' : 'Crear una cuenta'} onPress={() => setRegistro(!registro)} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
