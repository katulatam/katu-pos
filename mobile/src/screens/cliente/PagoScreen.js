import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { api } from '../../api/client';
import { Aviso, Boton, Caja, Campo, Fila, Opcion, Titulo } from '../../components/ui';
import { useCarrito } from '../../context/CarritoContext';
import { useSesion } from '../../context/SesionContext';
import { cantidad, dinero, leerValor } from '../../utils/formato';
import { C } from '../../utils/tema';

const SUB = { efectivo: 'Pagas al recibir', datafono: 'El domiciliario lleva el datáfono', qr: 'Pagas en línea con QR', manual: 'Coordinas con la tienda' };
const ICO = { efectivo: 'cash-outline', datafono: 'card-outline', qr: 'qr-code-outline', manual: 'swap-horizontal-outline' };

export default function PagoScreen({ navigation, route }) {
  const { slug, catalogo: d } = route.params;
  const { cuenta, lugar } = useSesion();
  const { mover, vaciar, calcular } = useCarrito();
  const uuid = useRef(Crypto.randomUUID());   // el mismo en reintentos: nunca duplica el pedido
  const [tipo, setTipo] = useState('domicilio');
  const [cot, setCot] = useState(null);
  const [medio, setMedio] = useState(d.medios[0]?.codigo);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [pagaCon, setPagaCon] = useState('');
  const [cargando, setCargando] = useState(false);
  const base = calcular(slug, d).totalProductos;

  useEffect(() => {
    let vivo = true;
    if (lugar && tipo === 'domicilio') api(`/tienda/t/${slug}/cotizar`, 'POST', { lat: lugar.lat, lng: lugar.lng, total: base }).then(r => vivo && r.success && setCot(r.data));
    return () => { vivo = false; };
  }, [slug, lugar, tipo, base]);

  const dom = tipo === 'domicilio' && cot?.cubre ? cot.tarifa : 0;
  const c = calcular(slug, d, dom);
  const pesa = c.lineas.some(l => l.porPeso);
  const m = d.medios.find(x => x.codigo === medio);
  const listo = c.lineas.length && (tipo === 'recoger' || (cot?.cubre && cot.abierta && c.totalProductos >= cot.pedidoMinimo));

  const pedir = async () => {
    if (!cuenta && (!nombre.trim() || !telefono.trim())) return Alert.alert('Faltan tus datos', 'Escribe tu nombre y celular, o ingresa a tu cuenta.');
    setCargando(true);
    const valor = leerValor(pagaCon, d.pais.decimales);
    const r = await api(`/tienda/t/${slug}/pedidos`, 'POST', { uuid: uuid.current, canal: 'app', tipo, medioPago: medio, items: c.lineas.map(l => ({ producto: l.producto, cantidad: l.cantidad })), contacto: cuenta ? {} : { nombre, telefono }, ...(tipo === 'domicilio' && { entrega: { ...lugar, notas } }), pagaCon: m?.tipo === 'efectivo' && valor > 0 ? valor : undefined });
    setCargando(false);
    if (!r.success) return Alert.alert('No se pudo hacer el pedido', r.error);
    vaciar(slug);
    navigation.reset({ index: 1, routes: [{ name: 'Inicio' }, { name: 'Seguimiento', params: { token: r.data.seguimiento, numero: r.data.numero } }] });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView style={{ backgroundColor: C.fondo }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Caja><Titulo>Productos</Titulo>{c.lineas.map(l => { const p = d.productos.find(x => x._id === l.producto); return (
          <View key={l.producto} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
            <View style={{ flex: 1 }}><Text style={{ color: C.texto, fontWeight: '600' }}>{l.nombre}</Text><Text style={{ color: l.promocion ? C.verde : C.texto3, fontSize: 13 }}>{l.promocion ? `${l.promocion.nombre} · ` : ''}{dinero(l.total, d.pais)}{l.porPeso ? ' aprox.' : ''}</Text></View>
            <Pressable accessibilityLabel="Quitar" hitSlop={8} onPress={() => mover(slug, p, -1)}><Ionicons name="remove-circle-outline" size={28} color={C.texto2} /></Pressable><Text style={{ minWidth: 54, textAlign: 'center', fontWeight: '700', color: C.texto }}>{cantidad(l.cantidad, l)}</Text><Pressable accessibilityLabel="Agregar" hitSlop={8} onPress={() => mover(slug, p, 1)}><Ionicons name="add-circle" size={28} color={C.cian} /></Pressable>
          </View>); })}</Caja>
        <Caja><Titulo>Entrega</Titulo>
          {d.empresa.recoger ? <><Opcion icono="bicycle" titulo="A domicilio" on={tipo === 'domicilio'} onPress={() => setTipo('domicilio')} /><Opcion icono="storefront-outline" titulo="Recoger en la tienda" on={tipo === 'recoger'} onPress={() => setTipo('recoger')} /></> : null}
          {tipo === 'domicilio' ? <>
            <Opcion icono="location" titulo={lugar?.direccion || 'Marcar dirección en el mapa'} sub={lugar ? lugar.detalle || 'Toca para cambiar' : undefined} onPress={() => navigation.navigate('Lugar')} />
            {lugar && cot ? (cot.cubre ? (cot.abierta ? <Aviso tipo="b">{cot.nombreSede} · {(cot.distancia / 1000).toFixed(1)} km · {cot.tarifa ? dinero(cot.tarifa, d.pais) : 'gratis'}</Aviso> : <Aviso>Cerrado ahora{cot.horario ? `. Atiende de ${cot.horario}` : ''}.</Aviso>) : <Aviso tipo="m">Esa dirección está fuera de la zona de cobertura.</Aviso>) : null}
            {cot?.cubre && c.totalProductos < cot.pedidoMinimo ? <Aviso>Te faltan {dinero(cot.pedidoMinimo - c.totalProductos, d.pais)} para el pedido mínimo.</Aviso> : null}
            <Campo placeholder="Indicaciones para el domiciliario" value={notas} onChangeText={setNotas} />
          </> : null}</Caja>
        <Caja><Titulo>Contacto</Titulo>{cuenta ? <Aviso tipo="b">Pides como {cuenta.nombre}{d.empresa.gamificacion ? ' y ganas puntos' : ''}.</Aviso> : <><Opcion icono="star-outline" titulo="Ingresar o crear cuenta" sub={d.empresa.gamificacion ? 'Gana puntos y sube de nivel' : 'Guarda tus pedidos'} onPress={() => navigation.navigate('Ingreso')} /><Campo etiqueta="Nombre" value={nombre} onChangeText={setNombre} /><Campo etiqueta="Celular" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" /></>}</Caja>
        <Caja><Titulo>Pago</Titulo>{d.medios.map(x => <Opcion key={x.codigo} icono={ICO[x.tipo] || 'wallet-outline'} titulo={x.nombre} sub={SUB[x.tipo]} on={medio === x.codigo} onPress={() => setMedio(x.codigo)} />)}{m?.tipo === 'efectivo' ? <Campo etiqueta="¿Con cuánto pagas? (opcional)" value={pagaCon} onChangeText={setPagaCon} keyboardType="decimal-pad" /> : null}{m?.tipo === 'qr' && pesa ? <Aviso>Llevas productos por peso: el QR aparece cuando pesemos tu pedido, con el valor exacto.</Aviso> : null}</Caja>
        <Caja><Fila a="Productos" b={dinero(c.subtotal, d.pais)} />{c.descuento > 0 ? <Fila a="Ahorro" b={`−${dinero(c.descuento, d.pais)}`} color={C.verde} /> : null}{tipo === 'domicilio' ? <Fila a="Domicilio" b={cot?.cubre ? (dom ? dinero(dom, d.pais) : 'Gratis') : '—'} /> : null}<Fila fuerte a={`Total${pesa ? ' aprox.' : ''}`} b={dinero(c.total, d.pais)} /></Caja>
        <Boton titulo="Hacer pedido" onPress={pedir} cargando={cargando} disabled={!listo} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
