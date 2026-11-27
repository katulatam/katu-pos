require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const conectarDB = require('./config/db');

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') { console.error('JWT_SECRET es obligatorio'); process.exit(1); }
  process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex'); // solo desarrollo: las sesiones no sobreviven al reinicio
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(cors({ origin: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Equipos de cobro: la firma HMAC se calcula sobre el cuerpo crudo, por eso va
// ANTES del express.json() global.
app.use('/dispositivo/v1', require('./routes/dispositivo.routes'));
// Webhook de Stripe: también necesita el cuerpo crudo para verificar la firma
const registro = require('./routes/registro.routes');
app.post('/api/v1/registro/stripe', express.raw({ type: '*/*', limit: '1mb' }), registro.webhook);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev', { skip: () => process.env.NODE_ENV === 'test' }));

// Empresa por subdominio: <slug>.<DOMINIO_BASE> (ej. orbita.katupos.com)
const { RESERVADOS } = require('./utils/empresas');
app.use((req, res, next) => {
  const d = String(process.env.DOMINIO_BASE || '').toLowerCase().trim(), h = String(req.hostname || '').toLowerCase();
  if (d && h.endsWith('.' + d)) { const sub = h.slice(0, -(d.length + 1)); if (sub && !sub.includes('.') && !RESERVADOS.includes(sub)) req.tenant = sub; }
  next();
});

// Frontends estáticos. El service worker de la caja debe revisarse siempre.
const publico = path.join(__dirname, '../frontend');
const estatico = dir => express.static(path.join(publico, dir), { setHeaders: (res, f) => { if (/\.(html|js|css)$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } });
app.use('/assets', estatico('assets'));
app.use('/admin', estatico('admin'));
app.use('/pos', estatico('pos'));
app.use('/domiciliario', estatico('domiciliario'));
app.use('/tienda', estatico('tienda'));
app.get('/t/:slug', (req, res) => res.sendFile(path.join(publico, 'tienda/index.html')));
app.get('/seguimiento/:token', (req, res) => res.sendFile(path.join(publico, 'tienda/seguimiento.html')));
// En el subdominio de una empresa, la raíz es su tienda en línea (/admin y /pos para el equipo)
app.get('/', (req, res) => res.sendFile(path.join(publico, req.tenant ? 'tienda/index.html' : 'index.html')));

// API
const rutas = {
  auth: 'auth', configuracion: 'configuracion', paises: 'paises', empresas: 'empresas', usuarios: 'usuarios',
  sedes: 'sedes', cajas: 'cajas', turnos: 'turnos', categorias: 'categorias', productos: 'productos',
  inventario: 'inventario', proveedores: 'proveedores', compras: 'compras', promociones: 'promociones',
  clientes: 'clientes', cartera: 'cartera', misiones: 'misiones', recompensas: 'recompensas',
  pos: 'pos', ventas: 'ventas', cobros: 'cobros', zonas: 'zonas', pedidos: 'pedidos', domiciliario: 'domiciliario',
  dispositivos: 'dispositivos', facturacion: 'facturacion', reportes: 'reportes', tienda: 'tienda', publico: 'publico', whatsapp: 'whatsapp', marketing: 'marketing', cuenta: 'planes',
};
Object.entries(rutas).forEach(([ruta, archivo]) => app.use(`/api/v1/${ruta}`, require(`./routes/${archivo}.routes`)));
app.use('/api/v1/registro', registro.rutas);

app.get('/api/v1/health', (req, res) => res.json({ success: true, env: process.env.NODE_ENV, timestamp: new Date() }));
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Ruta no encontrada' }));

// Manejador de errores global
app.use((err, req, res, next) => {
  if (!err.status && !err.statusCode) console.error(err.stack);
  res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message || 'Error interno del servidor' });
});

async function iniciar() {
  const { enMemoria } = await conectarDB();
  await require('./config/inicializar')();
  if (enMemoria) await require('./seeds/demo.seed').sembrarDemo();
  require('./jobs/mantenimiento.job')();
  const PORT = process.env.PORT || 3008;
  return app.listen(PORT, () => console.log(`Servidor Katú POS corriendo en puerto ${PORT} [${process.env.NODE_ENV || 'development'}]`));
}
if (require.main === module) iniciar();

module.exports = { app };
