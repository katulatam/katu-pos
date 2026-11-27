import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Mapa (Leaflet + OpenStreetMap) dentro de un WebView: funciona en Expo Go y no
// necesita llaves. `elegir`: avisa el punto tocado. `puntos`: [{lat,lng,color}]
const num = n => Number(n) || 0;
export default function Mapa({ centro, puntos = [], elegir, alto = 260 }) {
  const html = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"><style>html,body,#m{height:100%;margin:0}</style></head><body><div id="m"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script><script>
var P=${JSON.stringify(puntos.map(p => ({ lat: num(p.lat), lng: num(p.lng), c: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#05A5BC' })))};
var m=L.map('m',{attributionControl:true}).setView([${num(centro?.lat)},${num(centro?.lng)}],16);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
P.forEach(function(p){L.circleMarker([p.lat,p.lng],{radius:11,color:'#fff',weight:3,fillColor:p.c,fillOpacity:1}).addTo(m)});if(P.length>1)m.fitBounds(P.map(function(p){return[p.lat,p.lng]}),{padding:[40,40],maxZoom:16});
${elegir ? `var k=null;m.on('click',function(e){if(k)k.remove();k=L.circleMarker(e.latlng,{radius:11,color:'#fff',weight:3,fillColor:'#CC2F45',fillOpacity:1}).addTo(m);window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}))});` : ''}
</script></body></html>`, [centro?.lat, centro?.lng, JSON.stringify(puntos), !!elegir]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[s.m, { height: alto }]}>
      <WebView originWhitelist={['*']} source={{ html, baseUrl: 'https://pos.katu.me' }} onMessage={e => { try { elegir?.(JSON.parse(e.nativeEvent.data)); } catch { /* mensaje ajeno */ } }} />
    </View>
  );
}
const s = StyleSheet.create({ m: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#E5E9F0' } });
