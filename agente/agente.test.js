const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const escpos = require('./escpos');

test('bascula.js es idéntico al de la caja', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, 'bascula.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../frontend/assets/js/bascula.js'), 'utf8'));
});
test('columnas: nunca se pasan del ancho y conservan el valor', () => {
  for (const ancho of [24, 32, 48]) for (const [a, b] of [['Pan', '$ 1.000'], ['Un nombre de producto larguísimo que no cabe en una sola línea', '$ 12.345.678'], ['', 'x']]) {
    const l = escpos.dosColumnas(a, b, ancho);
    assert.ok(l.every(x => x.length <= ancho)); assert.ok(l.at(-1).endsWith(escpos.codificar(b).toString('latin1')));
  }
});
test('tildes y espacios especiales en CP850', () => {
  assert.deepEqual([...escpos.codificar('ñÁ –')], [0xA4, 0xB5, 0x20, 0x2D]);
});
test('el agente exige origen autorizado, simula báscula e imprime por TCP', async () => {
  const WebSocket = require('ws');
  let recibido = Buffer.alloc(0);
  const imp = net.createServer(s => s.on('data', d => { recibido = Buffer.concat([recibido, d]); })); await new Promise(r => imp.listen(0, '127.0.0.1', r));
  const ENV = { ...process.env, PUERTO_WS: '9177', ORIGENES: 'http://caja.local' };
  const abrir = args => new Promise(ok => { const p = spawn(process.execPath, [path.join(__dirname, 'agente.js'), ...args], { env: ENV }); p.stdout.on('data', d => /Agente Katú/.test(d) && ok(p)); });
  const conectar = origin => new Promise((ok, mal) => { const w = new WebSocket('ws://127.0.0.1:9177', { origin }); w.on('open', () => ok(w)); w.on('error', mal); });
  let p = await abrir(['--simular']);
  try {
    await assert.rejects(conectar('http://malo.com'));
    const w = await conectar('http://caja.local');
    const peso = new Promise(ok => w.on('message', m => { const d = JSON.parse(m); if (d.t === 'peso' && d.estable && d.kg > 0) ok(d); }));
    w.send(JSON.stringify({ t: 'config', bascula: { perfil: 'continua' } }));
    assert.equal((await peso).kg, 0.755); w.close();
  } finally { p.kill(); await new Promise(r => p.on('exit', r)); }
  p = await abrir([]);
  try {
    const w = await conectar('http://caja.local');
    const fin = new Promise(ok => w.on('message', m => { const d = JSON.parse(m); if (d.t === 'impreso') ok(d); }));
    w.send(JSON.stringify({ t: 'imprimir', destino: `tcp://127.0.0.1:${imp.address().port}`, columnas: 48, cajon: true, lineas: [{ tx: 'Minimarket', al: 'c', b: 1, g: 1 }, { hr: 1 }, { d: 'TOTAL', v: '$ 5.000', b: 1 }] }));
    assert.equal((await fin).ok, true); await new Promise(r => setTimeout(r, 100));
    assert.ok(recibido.includes(escpos.CAJON)); assert.ok(recibido.includes(Buffer.from('TOTAL'))); w.close();
  } finally { p.kill(); imp.close(); }
});
