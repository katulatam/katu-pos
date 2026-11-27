// Agente local de Katú POS. Corre en el computador de la caja y habla con el
// navegador por WebSocket (solo 127.0.0.1). Úsalo cuando la báscula o la
// impresora no se puedan conectar directo desde Chrome, o para imprimir sin
// diálogo y abrir el cajón.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const net = require('net');
const { WebSocketServer } = require('ws');
const Bascula = require('./bascula');
const escpos = require('./escpos');

const SIMULAR = process.argv.includes('--simular');
const PUERTO = Number(process.env.PUERTO_WS) || 9108;
const ORIGENES = (process.env.ORIGENES || 'http://localhost:3008').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const serial = () => require('serialport').SerialPort;

if (process.argv.includes('--puertos')) {
  serial().list().then(l => { l.forEach(p => console.log(p.path, '—', p.friendlyName || p.manufacturer || '')); if (!l.length) console.log('No hay puertos seriales'); });
  return;
}

const clientes = new Set();
const difundir = d => { const s = JSON.stringify(d); clientes.forEach(c => c.readyState === 1 && c.send(s)); };

// ── Báscula ──
let bascula = null, cfgActual = '', pregunta = null, reintento = null;
function cerrarBascula() { clearInterval(pregunta); clearTimeout(reintento); if (bascula) { bascula.removeAllListeners(); bascula.on('error', () => {}); if (bascula.isOpen) bascula.close(() => {}); } bascula = null; }
function abrirBascula(cfg) {
  cerrarBascula();
  if (SIMULAR) return simular();
  const path = cfg.puerto || process.env.BASCULA_PUERTO;
  if (!path) return difundir({ t: 'estado', bascula: 'off', error: 'Falta el puerto de la báscula' });
  const lector = new Bascula.Lector(cfg, x => difundir({ t: 'peso', ...x }));
  let silencio;
  bascula = new (serial())({ path, baudRate: Number(cfg.baudRate) || 9600, dataBits: Number(cfg.dataBits) || 8, parity: cfg.parity || 'none', stopBits: Number(cfg.stopBits) || 1, autoOpen: false });
  const volver = () => { difundir({ t: 'estado', bascula: 'off' }); clearInterval(pregunta); clearTimeout(reintento); reintento = setTimeout(() => abrirBascula(cfg), 4000); };
  bascula.on('data', b => {
    difundir({ t: 'crudo', texto: [...b].map(x => (x > 31 && x < 127 ? String.fromCharCode(x) : `<${x.toString(16).padStart(2, '0')}>`)).join('') });
    lector.recibir(b); clearTimeout(silencio); silencio = setTimeout(() => lector.vaciar(), 120);
  });
  bascula.on('close', volver);
  bascula.on('error', e => { log('Báscula:', e.message); difundir({ t: 'estado', bascula: 'off', error: e.message }); });
  bascula.open(e => {
    if (e) { log('Báscula:', e.message); difundir({ t: 'estado', bascula: 'off', error: e.message }); return volver(); }
    log(`Báscula en ${path} a ${cfg.baudRate}`);
    difundir({ t: 'estado', bascula: 'on' });
    const cmd = Buffer.from(Bascula.aBytes(cfg.comando));
    if (cmd.length) pregunta = setInterval(() => bascula?.isOpen && bascula.write(cmd), Math.max(150, Number(cfg.intervaloMs) || 300));
  });
}
function simular() {
  const lector = new Bascula.Lector(Bascula.PERFILES.continua, x => difundir({ t: 'peso', ...x }));
  let k = 0, meta = 0.755; difundir({ t: 'estado', bascula: 'on' });
  pregunta = setInterval(() => { k++; if (k % 40 === 0) meta = Math.round((0.2 + Math.random() * 2) * 1000) / 1000; const f = k % 40; const kg = f < 8 ? meta * f / 8 : f < 34 ? meta : 0; lector.recibir(Buffer.from(`ST,GS,+ ${kg.toFixed(3)} kg\r\n`)); }, 250);
}

// ── Impresora: tcp://ip:9100 o serial:COM4[@9600] ──
function enviar(destino, datos) {
  return new Promise((ok, mal) => {
    if (SIMULAR) { log(`[impresora] ${datos.length} bytes`); return ok(); }
    const d = String(destino || process.env.IMPRESORA || '');
    let m = d.match(/^tcp:\/\/([\w.-]+):?(\d+)?$/i);
    if (m) {
      const s = net.connect({ host: m[1], port: Number(m[2]) || 9100, timeout: 5000 }, () => s.end(datos));
      s.on('close', e => !e && ok()); s.on('error', mal); s.on('timeout', () => s.destroy(new Error('La impresora no respondió')));
      return;
    }
    m = d.match(/^serial:([^@]+)(?:@(\d+))?$/i);
    if (m) {
      const p = new (serial())({ path: m[1], baudRate: Number(m[2]) || 9600, autoOpen: false });
      return p.open(e => { if (e) return mal(e); p.write(datos, er => { if (er) return mal(er); p.drain(() => p.close(() => ok())); }); });
    }
    mal(new Error('Destino de impresora inválido (usa tcp://ip:9100 o serial:COM4)'));
  });
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PUERTO, maxPayload: 256 * 1024, verifyClient: ({ origin }) => { const ok = ORIGENES.includes(String(origin || '').replace(/\/+$/, '')); if (!ok) log('Origen rechazado:', origin); return ok; } });
wss.on('listening', () => log(`Agente Katú POS en ws://127.0.0.1:${PUERTO}${SIMULAR ? ' (simulador)' : ''} — autorizado: ${ORIGENES.join(', ')}`));
wss.on('error', e => { log(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO} ya está en uso: el agente ya está abierto` : e.message); process.exit(1); });
wss.on('connection', ws => {
  clientes.add(ws);
  ws.on('close', () => clientes.delete(ws));
  ws.on('message', async m => {
    let d; try { d = JSON.parse(m); } catch { return; }
    try {
      if (d.t === 'config') { if (d.bascula) { const c = JSON.stringify(d.bascula); if (c !== cfgActual || !bascula) { cfgActual = c; abrirBascula(d.bascula); } else ws.send(JSON.stringify({ t: 'estado', bascula: bascula.isOpen ? 'on' : 'off' })); } }
      else if (d.t === 'imprimir') { await enviar(d.destino, escpos.tiquete(d.lineas, { columnas: d.columnas, cajon: d.cajon })); ws.send(JSON.stringify({ t: 'impreso', ok: true })); }
      else if (d.t === 'cajon') { await enviar(d.destino, escpos.CAJON); }
    } catch (e) { log(e.message); ws.send(JSON.stringify({ t: 'impreso', ok: false, error: e.message })); }
  });
});
process.on('SIGINT', () => { cerrarBascula(); process.exit(0); });
