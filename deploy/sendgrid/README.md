# Plantillas de correo (SendGrid)

Katú POS envía sus correos de sistema con **plantillas dinámicas de SendGrid**, como katu_school:
el diseño y los textos se editan en el panel de SendGrid y el código solo envía los datos.
Si la variable de una plantilla está vacía, se usa el diseño de respaldo que trae el código.

| Correo | Archivo | Variable de entorno | Variables de la plantilla |
|---|---|---|---|
| Bienvenida (al pagar o al empezar la prueba gratis) | `bienvenida.html` | `SENDGRID_TEMPLATE_BIENVENIDA` | `asunto`, `nombre`, `negocio`, `dominio`, `usuario`, `horas`, `url_activar`, `url_panel`, `url_caja`, `url_tienda`, `anio`, `prueba` (sí/no), `nota_prueba`, `dias_prueba`, `prueba_hasta` |
| Recuperar contraseña | `recuperar.html` | `SENDGRID_TEMPLATE_RECUPERAR` | `asunto`, `nombre`, `negocio`, `url_activar`, `horas`, `anio` |

Las campañas de marketing no usan plantilla: cada una lleva el logo, el color y el texto de su comercio.

## Crear cada plantilla

1. SendGrid → **Email API → Dynamic Templates → Create a Dynamic Template**. Nombre: `Katú POS · Bienvenida` (o `· Recuperar contraseña`).
2. Ábrela → **Add Version → Blank Template → Code Editor**.
3. Borra el contenido de ejemplo y pega todo el archivo `.html` correspondiente.
4. En **Settings** (panel izquierdo):
   - **Version Name:** `v1`
   - **Subject:** `{{asunto}}` (el asunto lo pone Katú POS)
5. **Save**. Revisa la vista previa (con **Test Data** puedes pegar datos de ejemplo, abajo).
6. Copia el **Template ID** (empieza por `d-`) y ponlo en Portainer → cada stack `katupos` (app1 y app2) → variables:
   - `SENDGRID_TEMPLATE_BIENVENIDA=d-…`
   - `SENDGRID_TEMPLATE_RECUPERAR=d-…`
   → **Update the stack**.

Datos de ejemplo para **Test Data** (bienvenida):
```json
{ "asunto": "¡Minimarket La Esquina ya está en Katú POS!", "nombre": "Pedro", "negocio": "Minimarket La Esquina",
  "dominio": "la-esquina.katupos.com", "usuario": "pedro@ejemplo.com", "horas": 72,
  "url_activar": "https://la-esquina.katupos.com/admin/activar.html?t=EJEMPLO",
  "url_panel": "https://la-esquina.katupos.com/admin/", "url_caja": "https://la-esquina.katupos.com/pos/",
  "url_tienda": "https://la-esquina.katupos.com/", "anio": 2026 }
```

## Si los correos no llegan

Cada envío deja una línea en los logs del contenedor (en app1 y app2):
```bash
docker logs katupos 2>&1 | grep "\[correo\]" | tail
```
- `bienvenida enviada a … id=…` → SendGrid lo aceptó: búscalo en **SendGrid → Activity Feed** (si dice *Delivered*, está en spam del destinatario).
- `NO enviada … Correo (401/403)` → `SENDGRID_API_KEY` mal copiada o sin permiso *Mail Send*.
- `NO enviada … from address` → `SENDGRID_FROM` no es un remitente verificado en SendGrid (**Settings → Sender Authentication**).
- `NO enviada … no está configurado` → falta `SENDGRID_API_KEY` o `SENDGRID_FROM` en el stack.

Para reenviar la bienvenida a un cliente: **Admin → Katú → Planes y registros → Reenviar bienvenida** (muestra también el enlace por si hay que enviarlo por WhatsApp).

**Para que no caigan en spam:** autentica el dominio `katupos.com` en SendGrid (Settings → Sender Authentication → Authenticate Your Domain; agrega en Linode → Domains los registros CNAME que te da) y cambia `SENDGRID_FROM` a `no-responder@katupos.com`.
