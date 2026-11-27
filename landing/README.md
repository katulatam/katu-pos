# Landing www.katupos.com

Sitio estático (HTML, CSS y JS, sin compilación). Se sube tal cual al balanceador:
`/srv/katupos/landing/` (ver `deploy/README.md`, paso 5).

| Archivo | Qué es |
|---|---|
| `index.html` | Página principal: funciones, WhatsApp con IA, domicilios, autopago, planes, preguntas y registro |
| `bienvenida.html` | A donde vuelve Stripe tras el pago: espera a que la cuenta esté lista y lleva al panel |
| `config.js` | **Lo único que se edita al desplegar**: dirección de la API, dominio, correo y WhatsApp de contacto |
| `estilos.css`, `app.js` | Diseño y lógica |

- **Planes y precios** salen de la API (`/api/v1/registro/planes`), que se editan en Admin → Katú → Planes y registros. Si la API no responde, la página muestra los precios de ejemplo y no deja continuar al pago.
- **Moneda de los precios**: la de cada plan (Admin → Planes; por defecto USD). La nota bajo los planes se ajusta sola.
- **Países y facturación electrónica** salen de `/api/v1/registro/paises`. En Admin → Países, la casilla "Ofrecer facturación electrónica en este país" decide dónde se anuncia (tarjeta de funciones, preguntas frecuentes, aviso en el registro) y si se activa a los negocios nuevos. El país del registro se preselecciona por la zona horaria del visitante.
- **Prueba gratis** (sin tarjeta): los botones "Prueba gratis" abren el registro en modo prueba (`/api/v1/registro/prueba`); el negocio se crea al instante con el plan `PLAN_PRUEBA` (Premium) por `DIAS_PRUEBA_GRATIS` días (15). Una prueba por correo y por celular. Recordatorios por correo a 5 días, 1 día y al terminar; al vencer, el POS y la tienda quedan en pausa (sin borrar datos) hasta que el administrador elija un plan en *Mi suscripción*. Durante la prueba no se emiten facturas electrónicas reales. Con `DIAS_PRUEBA_GRATIS=0` la landing oculta todo lo de la prueba. Enlace directo: `https://www.katupos.com/#prueba`.
- **Kioscos de autopago**: la landing aclara que son equipos que se compran aparte; los botones "Solicitar cotización" abren WhatsApp (`WHATSAPP` en `config.js`) o, si está vacío, un correo a `CONTACTO`.
- **Registro**: valida el subdominio en vivo, crea el registro y redirige al Checkout de Stripe.
- **Enlace directo a un plan**: `https://www.katupos.com/#plan-pro` abre el registro con ese plan.
- **Revisar textos antes de publicar**: las promesas comerciales (por ejemplo "soporte prioritario", "factura incluida en todos los planes", "copias de seguridad diarias") deben coincidir con lo que Katú ofrece.

Para verla en local: sirve la carpeta con cualquier servidor estático y cambia `API` en `config.js` a `http://localhost:3008/api/v1`.
