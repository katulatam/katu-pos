# Katú POS

Punto de venta en la nube para tiendas y minimarkets: caja, inventario,
clientes con gamificación, domicilios con geocerca, facturación electrónica y
app móvil. **Multiempresa y multi-país.**

```
backend/       API REST (Node + Express + Mongoose); sirve también el frontend
frontend/
  pos/           Caja (PWA, trabaja sin internet) + visor del cliente
  admin/         Panel, una página HTML por opción (pos-admin.js / pos-admin.css)
  tienda/        Tienda en línea, pago, seguimiento y cuenta del cliente
  domiciliario/  Web móvil del domiciliario
  assets/js/     motor.js (precios) y bascula.js (lectura de peso)
mobile/        App Expo "Katú Market": cliente y domiciliario
agente/        Programa local opcional: báscula, impresora térmica, cajón
```

## Arranque

```bash
cd backend
npm install
cp .env.example .env     # BD_USER, BD_PASS, DB_HOST, JWT_SECRET, KATU_ADMIN_PASSWORD…
npm run dev              # http://localhost:3008
npm test
```

**Sin `DB_HOST`** arranca con MongoDB en memoria y datos demo. Con
`MODO_DEMO=true` los QR se aprueban solos (nunca en producción).

| Cuenta demo (clave `Demo2026*`) | Rol |
|---|---|
| `admin@orbita.demo` / `caja@` / `super@` (PIN 1234) / `bodega@` / `domi@orbita.demo` | Minimarket en Colombia |
| `admin@nova.demo` / `caja@nova.demo` … | Abarrotes en México |
| `katu@katulatam.com` + `KATU_ADMIN_PASSWORD` | Equipo Katú |

Tienda demo: `/t/orbita`. Con base real arranca vacía: solo crea los países y el superusuario.

## País

`Pais` (Katú → Países) define **moneda, decimales, zona horaria**, formato,
redondeo del efectivo, billetes, impuestos, tipos de documento, consumidor
final, medios de pago y **proveedor de facturación**. Cada empresa pertenece a un
país; puede elegir una de sus zonas horarias. Con empresas activas no se pueden
cambiar moneda ni decimales. Las tarifas semilla (`utils/paises.js`) son puntos
de partida: valídalas con el contador de cada país.

Facturación por país: `utils/facturacion/index.js` despacha según
`Pais.facturacion.proveedor`. Hoy existe `alanube_co` (Colombia). Un país nuevo es
un archivo con `disponible`, `emitir`, `notaCredito`, `consultar`.

## Decisiones de diseño

- **Definidas con el equipo:** todas las empresas en un mismo servidor (multiempresa),
  una sola app "Katú Market" para todas las tiendas, factura electrónica tipo 01
  (no documento equivalente POS), el valor del domicilio va como línea excluida de
  impuesto y la venta/factura del domicilio se crea al entregar, con el peso real.
- **Un solo motor de precios** (`motor.js`) en caja, tienda, app y servidor. Calcula en
  unidades menores enteras: base + impuesto = total, siempre. El servidor manda el precio.
- **Sin transacciones** (la BD no es replica set): cada paso de la venta es atómico y
  tiene su reverso. `uuid` por venta/pedido → los reintentos nunca duplican.
- **Sin internet** la caja vende en efectivo y datáfono; sincroniza sola. Si el precio
  cambió mientras tanto, se respeta lo cobrado y la venta queda marcada.
- **Pagos** (`utils/cobros.js`): cada proveedor implementa crear/consultar/cancelar. La
  venta solo acepta un cobro aprobado, por el valor exacto y una vez.
- **Kiosco de efectivo y datáfono integrado** (`/dispositivo/v1`): misma firma HMAC de
  los kioscos de recarga Katú. Un billete (`txId`) nunca se suma dos veces.
- **Productos por peso**: báscula en vivo, etiqueta EAN-13 con peso o precio, o manual. En
  domicilios el total se ajusta con el peso real y el QR se paga después de pesar.
- **Privacidad**: del domiciliario se guarda solo la última ubicación y solo con un
  pedido en camino. Un cliente existente se enlaza con la app solo leyendo su QR en caja.
- El comercio nunca ve el nombre del proveedor de facturación.

## Báscula

1. **Directa (recomendada):** Chrome/Edge en el PC, RS-232 con adaptador USB-serial.
   Requiere HTTPS (o localhost). Se conecta una vez y queda autorizada.
2. **Agente local** (`agente/`): si el equipo no usa Chrome o para impresión directa.
3. **Etiquetadora**: imprime EAN-13 con PLU; no necesita cable.

Los perfiles son genéricos: con cada modelo se confirma velocidad, comando y trama
usando el monitor de la caja (F9).

## Despliegue

`docker build -t katu-pos .` (puerto 3008). Variables en `.env.example`. `PUBLIC_URL`
debe ser el dominio https. Tras cambiar el `.env` hay que recrear el contenedor.
