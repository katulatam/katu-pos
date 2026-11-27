# Despliegue de Katú POS en Linode (Portainer + nginx nuevos)

Katú POS es **multiempresa en un solo despliegue**: todas las empresas usan los mismos
contenedores y la misma base de datos. Un cliente nuevo **no** necesita contenedor propio:
al pagar en la landing, el webhook de Stripe crea su empresa y queda disponible al instante
en `https://<subdominio>.katupos.com`.

```
                     *.katupos.com  +  katupos.com   (DNS en Linode)
                                   │
                   ┌───────────────┴───────────────┐
                   │  Balanceador (Linode nuevo)    │  nginx + certificado comodín
                   │  Portainer (servidor)          │  landing estática www.katupos.com
                   └───────┬───────────────┬────────┘
                           │ red privada   │
                ┌──────────┴───┐     ┌─────┴────────┐
                │  app1        │     │  app2        │   contenedor katupos (misma imagen)
                │  Portainer   │     │  Portainer   │   Portainer Agent
                │  Agent       │     │  Agent       │
                └──────┬───────┘     └──────┬───────┘
                       └────── MongoDB rs0 (3 nodos) ──────┘
```

| Dirección | Qué es |
|---|---|
| `www.katupos.com` | Landing con planes y registro (carpeta `landing/`) |
| `app.katupos.com` | API central: registro, webhooks de Stripe, Twilio y Alanube (`PUBLIC_URL`) |
| `<subdominio>.katupos.com` | Tienda en línea de la empresa |
| `<subdominio>.katupos.com/admin` | Panel de la empresa |
| `<subdominio>.katupos.com/pos` | Caja y autopago |

Subdominios reservados (nunca se asignan a una empresa): `www, app, api, admin, panel, pos, mail, soporte, status, blog, portainer, dev, staging, test, demo…` (lista completa en `backend/utils/empresas.js`).

---

## 1. Servidores en Linode

**Configuración inicial (la más económica posible, con balanceo): 3 Nanodes de 1 GB, ~US$15/mes más Backups (~US$6).** Precios de referencia: verifícalos al crear los servidores.

| Servidor | Plan inicial | Software |
|---|---|---|
| `katupos-lb` | Nanode 1 GB | Docker, Portainer (servidor), nginx, certbot, **árbitro** de Mongo (vota, no guarda datos) |
| `katupos-app1` | Nanode 1 GB | Docker, Portainer Agent, app, nodo 1 de Mongo (caché 0,25 GB) |
| `katupos-app2` | Nanode 1 GB | Docker, Portainer Agent, app, nodo 2 de Mongo (caché 0,25 GB) |

- Crea los tres en **Miami**, imagen **Ubuntu 24.04 LTS**, etiqueta `katupos`, con Backups.
- **Red privada con VPC** (`katupos-vpc`, subred `katupos` 10.0.0.0/24): con el servidor apagado, Network → Add Network Interface → VPC, sin NAT público y conservando la interfaz Public. IP de este despliegue:

| Servidor | IP en la VPC |
|---|---|
| katupos-lb | 10.0.0.2 |
| katupos-app1 | 10.0.0.3 |
| katupos-app2 | 10.0.0.4 |
- **Ojo con 1 GB:** alcanza para los primeros negocios, pero la app y Mongo comparten poca memoria; el swap evita caídas a costa de algo de lentitud en picos.
- **Cuándo crecer:** si la memoria pasa del 80 % sostenido, la caja se siente lenta o hay ~5-10 empresas activas, usa "Resize" en Linode (unos minutos de reinicio, sin reinstalar) para pasar app1 y app2 a 2 GB y luego a 4 GB y quita `MONGO_CACHE_GB` (o súbelo a 1). Con muchos más clientes, convierte el árbitro en un nodo con datos en su propio Linode, o pasa a MongoDB Atlas cambiando solo `MONGO_URI`.

**Cloud Firewall de Linode** (solo en la interfaz **Public**; entre servidores el tráfico va por la VPC, que solo admite servidores de tu cuenta). Regla por defecto de entrada: **Drop**; de salida: **Accept**.

| Firewall | Asignado a | Entrante permitido |
|---|---|---|
| `katupos-lb-fw` | katupos-lb | 22 y 9443 (Portainer) solo desde tu IP · 80 y 443 desde todos |
| `katupos-app-fw` | katupos-app1, katupos-app2 | 22 solo desde tu IP |

Así los puertos internos (3008 app, 9001 agente, 27017 Mongo) quedan cerrados a internet y solo se alcanzan por la VPC.

## 2. Docker y Portainer

En los tres servidores (Docker y 2 GB de swap como colchón de memoria):
```bash
curl -fsSL https://get.docker.com | sh
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Genera una clave compartida para que **solo tu Portainer** pueda controlar a los agentes (guárdala en tu gestor de contraseñas):
```bash
openssl rand -hex 32
```
En `katupos-lb` (Portainer servidor):
```bash
docker volume create portainer_data
docker run -d -p 9443:9443 --name portainer --restart=always -e AGENT_SECRET='TU_AGENT_SECRET' \
  -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:lts
```
En `katupos-app1` y `katupos-app2` (agente):
```bash
docker run -d -p 9001:9001 --name portainer_agent --restart=always -e AGENT_SECRET='TU_AGENT_SECRET' \
  -v /var/run/docker.sock:/var/run/docker.sock -v /var/lib/docker/volumes:/var/lib/docker/volumes portainer/agent:lts
```
En Portainer (`https://IP_PUBLICA_DE_LB:9443`; crea el administrador en los primeros 5 minutos) → Environments → Add environment → Docker Standalone → Agent → `katupos-app1` = `10.0.0.3:9001` y `katupos-app2` = `10.0.0.4:9001`.

## 3. MongoDB en réplica

En los tres nodos:
```bash
sudo mkdir -p /srv/katupos/mongo/data
```
Genera **una** clave y cópiala idéntica a los tres:
```bash
openssl rand -base64 756 | sudo tee /srv/katupos/mongo/keyfile >/dev/null
sudo chmod 400 /srv/katupos/mongo/keyfile && sudo chown 999:999 /srv/katupos/mongo/keyfile
```
En cada nodo despliega el stack `deploy/mongo/docker-compose.yml` con estas variables: `MONGO_NODO` (1, 2 o 3), `IP_PRIVADA` (la del nodo), `MONGO_ROOT_PASSWORD` (la misma en los tres) y `MONGO_CACHE_GB=0.25` en los tres mientras sean de 1 o 2 GB (en el balanceador, nodo 3, es un árbitro y no guarda datos).

Inicia la réplica desde el nodo 1:
```bash
docker exec -it katupos-mongo-1 mongosh -u root -p --eval '
rs.initiate({ _id: "rs0", members: [
  { _id: 0, host: "10.0.0.3:27017" }, { _id: 1, host: "10.0.0.4:27017" }, { _id: 2, host: "10.0.0.2:27017", arbiterOnly: true } ] })'
```
El árbitro solo vota: si cae app1 o app2, el otro queda como principal y la app sigue funcionando. (Si después conviertes el nodo 3 en uno con datos, quítalo con `rs.remove("10.0.0.2:27017")` y agrégalo con `rs.add("10.0.0.2:27017")`.)
Crea el usuario de la app:
```bash
docker exec -it katupos-mongo-1 mongosh -u root -p --eval '
db.getSiblingDB("admin").createUser({ user: "katupos", pwd: "CLAVE_SEGURA", roles: [{ role: "readWrite", db: "katu_pos" }] })'
```
`MONGO_URI=mongodb://katupos:CLAVE_SEGURA@10.0.0.3:27017,10.0.0.4:27017/katu_pos?replicaSet=rs0&authSource=admin` (solo los nodos con datos)

**Respaldo diario** (en `katupos-app1`, cron 3 a. m.; el árbitro no tiene datos):
```bash
0 3 * * * docker exec katupos-mongo-1 mongodump -u root -p 'CLAVE_ROOT' --authenticationDatabase admin --db katu_pos --archive --gzip > /srv/katupos/backups/katu_pos-$(date +\%F).gz && find /srv/katupos/backups -mtime +14 -delete
```
Activa además **Linode Backups** en los tres servidores.

## 4. DNS y certificado comodín

En Linode → Domains → `katupos.com`:

| Tipo | Nombre | Valor |
|---|---|---|
| A | (vacío) | IP pública de `katupos-lb` |
| A | `www` | IP pública de `katupos-lb` |
| A | `*` | IP pública de `katupos-lb` |

Crea un token en Linode → API Tokens con permiso **Domains: Read/Write** y guárdalo en el balanceador:
```bash
sudo mkdir -p /srv/katupos/secrets /srv/katupos/letsencrypt /srv/katupos/landing /srv/katupos/backups
echo "dns_linode_key = TU_TOKEN" | sudo tee /srv/katupos/secrets/linode.ini && sudo chmod 600 /srv/katupos/secrets/linode.ini
```
Emite el certificado comodín (una sola vez; después se renueva solo):
```bash
docker run --rm -v /srv/katupos/letsencrypt:/etc/letsencrypt -v /srv/katupos/secrets:/secrets:ro certbot/dns-linode certonly \
  --dns-linode --dns-linode-credentials /secrets/linode.ini --dns-linode-propagation-seconds 120 \
  -d katupos.com -d '*.katupos.com' --agree-tos -m TU_CORREO --non-interactive
```

## 5. Balanceador (nginx)

1. Copia la carpeta `landing/` del repositorio a `/srv/katupos/landing/` y ajusta `landing/config.js` (`API` = `https://app.katupos.com`).
2. `deploy/nginx/katupos.conf` ya apunta a app1 (`10.0.0.3`) y app2 (`10.0.0.4`) por la VPC.
3. En Portainer, environment del balanceador → Stacks → Add stack → `deploy/nginx/docker-compose.yml` (desde el repositorio o subiendo la carpeta `deploy/nginx`).

## 6. App en los dos servidores

En Portainer, para **app1 y luego app2**: Stacks → Add stack → Repository → este repositorio, archivo `deploy/app/docker-compose.yml`. En "Environment variables" carga las de `deploy/.env.produccion.example`.

- **Idénticas en los dos**, sobre todo `JWT_SECRET`; si no, una sesión iniciada en app1 falla en app2.
- Las tareas programadas (facturación, campañas, cobros, suspensiones) usan un bloqueo en MongoDB: aunque corran dos contenedores, cada tarea se ejecuta en uno solo a la vez.
- Para actualizar: Stack → "Pull and redeploy", primero en app1, revisa `https://app.katupos.com/api/v1/health`, y después en app2. nginx deja de enviar tráfico al contenedor que se reinicia.

## 7. Stripe

1. **Developers → API keys**: copia la clave secreta a `STRIPE_SECRET_KEY`. Empieza con la de prueba (`sk_test_…`).
2. **Developers → Webhooks → Add endpoint**: `https://app.katupos.com/api/v1/registro/stripe`, con estos eventos:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copia el "Signing secret" (`whsec_…`) a `STRIPE_WEBHOOK_SECRET`.
3. **Settings → Billing → Customer portal**: actívalo. Permite actualizar el medio de pago, ver facturas y cancelar.
4. **Settings → Billing → Subscriptions and emails**: activa los correos de cobro fallido y los reintentos automáticos (Smart Retries).
5. Los **precios se editan en Katú**: Admin → Katú → Planes y registros. Stripe cobra lo que diga ahí al momento de suscribirse; no hace falta crear productos ni precios en Stripe.
6. Prueba completa en modo de prueba con la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC. Al terminar, cambia a las claves `sk_live_…` y crea el webhook también en modo real.

**Ciclo de la suscripción**

| Evento | Qué hace Katú |
|---|---|
| Pago aprobado en el Checkout | Crea la empresa (módulos del plan), su sede, su caja y su administrador, y envía el correo para crear la contraseña |
| Cobro fallido | La suscripción queda en mora; el comercio sigue trabajando durante `DIAS_GRACIA_SUSCRIPCION` días |
| Gracia vencida o suscripción impaga | La empresa se suspende (nadie del comercio puede entrar) |
| Pago al día | Se reactiva sola |
| Cancelación | La empresa se suspende; los datos se conservan |

## 8. Lista de verificación al lanzar

- [ ] `https://www.katupos.com` muestra la landing y los planes cargan.
- [ ] `https://app.katupos.com/api/v1/health` responde en ambos contenedores (detén uno y prueba).
- [ ] Suscripción de prueba completa: Checkout → correo de bienvenida → crear contraseña → `https://<subdominio>.katupos.com/admin/`.
- [ ] `https://<subdominio>.katupos.com` muestra la tienda en línea.
- [ ] Webhooks de Twilio y Alanube apuntando a `PUBLIC_URL`.
- [ ] Respaldo de Mongo del día siguiente existe y se puede restaurar.
