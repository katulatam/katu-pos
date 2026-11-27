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
- **Registro**: valida el subdominio en vivo, crea el registro y redirige al Checkout de Stripe.
- **Enlace directo a un plan**: `https://www.katupos.com/#plan-pro` abre el registro con ese plan.
- **Revisar textos antes de publicar**: las promesas comerciales (por ejemplo "soporte prioritario", "factura incluida en todos los planes", "copias de seguridad diarias") deben coincidir con lo que Katú ofrece.

Para verla en local: sirve la carpeta con cualquier servidor estático y cambia `API` en `config.js` a `http://localhost:3008/api/v1`.
