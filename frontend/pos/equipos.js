/* equipos.js — báscula, lector de códigos, impresora y agente local.
 * Emite eventos: 'peso' {kg, estable, crudo}, 'codigo' texto, 'estado'.
 */
(function () {
  'use strict';
  class Equipos extends EventTarget {
    constructor() { super(); this.caja = null; this.peso = { kg: 0, estable: false, en: 0 }; this.estado = { bascula: 'off', agente: 'off' }; this.trazas = []; }
    _emitir(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
    _traza(s) { this.trazas.push(new Date().toLocaleTimeString() + '  ' + s); if (this.trazas.length > 80) this.trazas.shift(); this._emitir('traza'); }
    _estado(k, v) { if (this.estado[k] === v) return; this.estado[k] = v; this._emitir('estado', this.estado); }
    async configurar(caja) {
      this.caja = caja;
      this.cfg = { ...Bascula.PERFILES[caja.bascula?.perfil || 'continua'], ...Object.fromEntries(Object.entries(caja.bascula || {}).filter(([, v]) => v !== '' && v != null)) };
      const usaAgente = caja.bascula?.modo === 'agente' || caja.impresora?.modo === 'agente';
      if (usaAgente) this._agente();
      if (caja.bascula?.modo === 'webserial') this._reconectarSerial();
      this._lectorTeclado();
    }
    _peso(p) { this.peso = { ...p, en: Date.now() }; this._emitir('peso', this.peso); }

    // ── Báscula por Web Serial (Chrome/Edge): RS-232 con adaptador USB ──
    async _reconectarSerial() {
      if (!('serial' in navigator)) return this._estado('bascula', 'no-soportada');
      const [p] = await navigator.serial.getPorts();
      if (p) this._abrir(p).catch(e => { this._traza('Error: ' + e.message); this._estado('bascula', 'off'); });
    }
    async conectarSerial() {
      if (!('serial' in navigator)) throw new Error('Este navegador no permite conectar la báscula. Usa Chrome o Edge en el computador, o el agente local.');
      const p = await navigator.serial.requestPort();
      await this.cerrarSerial();
      await this._abrir(p);
    }
    async cerrarSerial() { this._seguir = false; try { await this._rd?.cancel(); } catch {} try { await this.puerto?.close(); } catch {} this.puerto = null; clearInterval(this._preg); this._estado('bascula', 'off'); }
    async _abrir(p) {
      const c = this.cfg;
      await p.open({ baudRate: Number(c.baudRate), dataBits: Number(c.dataBits), parity: c.parity, stopBits: Number(c.stopBits), bufferSize: 1024 });
      this.puerto = p; this._seguir = true; this._estado('bascula', 'on'); this._traza(`Puerto abierto a ${c.baudRate} ${c.dataBits}${c.parity[0].toUpperCase()}${c.stopBits}`);
      const lector = new Bascula.Lector(c, x => this._peso(x));
      const comando = Bascula.aBytes(c.comando);
      if (comando.length) {
        this._preg = setInterval(async () => { if (!p.writable || p.writable.locked) return; const w = p.writable.getWriter(); try { await w.write(comando); } catch {} finally { w.releaseLock(); } }, Math.max(150, Number(c.intervaloMs) || 300));
      }
      let silencio;
      (async () => {
        while (p.readable && this._seguir) {
          this._rd = p.readable.getReader();
          try {
            for (;;) {
              const { value, done } = await this._rd.read();
              if (done) break;
              this._traza([...value].map(b => (b > 31 && b < 127 ? String.fromCharCode(b) : `<${b.toString(16).padStart(2, '0')}>`)).join(''));
              lector.recibir(value);
              clearTimeout(silencio); silencio = setTimeout(() => lector.vaciar(), 120);
            }
          } catch (e) { this._traza('Error: ' + e.message); } finally { try { this._rd.releaseLock(); } catch {} }
        }
        clearInterval(this._preg); this._estado('bascula', 'off');
        if (this._seguir) setTimeout(() => this._reconectarSerial(), 3000); // se desconectó el cable
      })();
    }

    // ── Agente local (Node en el PC de la caja) ──
    _agente() {
      let ws;
      try { ws = new WebSocket(this.caja.agenteUrl || 'ws://127.0.0.1:9108'); } catch { return; }
      this.ws = ws;
      ws.onopen = () => { this._estado('agente', 'on'); ws.send(JSON.stringify({ t: 'config', bascula: this.caja.bascula?.modo === 'agente' ? this.cfg : null })); };
      ws.onmessage = m => {
        let d; try { d = JSON.parse(m.data); } catch { return; }
        if (d.t === 'peso') this._peso(d);
        else if (d.t === 'crudo') this._traza(d.texto);
        else if (d.t === 'estado') { if (d.bascula) this._estado('bascula', d.bascula); if (d.error) this._traza(d.error); }
        else if (d.t === 'impreso') this._emitir('impreso', d);
      };
      ws.onclose = () => { this._estado('agente', 'off'); if (this.caja.bascula?.modo === 'agente') this._estado('bascula', 'off'); setTimeout(() => this._agente(), 4000); };
    }
    enviarAgente(d) { if (this.ws?.readyState !== 1) return false; this.ws.send(JSON.stringify(d)); return true; }

    // ── Lector de código de barras tipo teclado: ráfaga + Enter ──
    _lectorTeclado() {
      if (this._conTeclado) return; this._conTeclado = true;
      let buf = '', ult = 0, rafaga = true;
      document.addEventListener('keydown', e => {
        const t = performance.now();
        if (e.key === 'Enter') {
          const c = buf; buf = '';
          // Ráfaga rápida de 4+ caracteres = lector, no una persona escribiendo
          if (c.length >= 4 && rafaga && t - ult < 80) {
            e.preventDefault(); e.stopPropagation();
            const a = document.activeElement;
            if (a && 'value' in a && typeof a.value === 'string' && a.value.endsWith(c) && a.type !== 'number') { a.value = a.value.slice(0, -c.length); a.dispatchEvent(new Event('input', { bubbles: true })); }
            this._emitir('codigo', c.trim());
          }
          return;
        }
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
        if (t - ult > 60) { buf = ''; rafaga = true; }
        buf += e.key; ult = t;
      }, true);
    }

    // ── Impresión: lineas = [{ tx, al:'c'|'l'|'r', b, g } | { d, v, b } | { hr } | { qr, tx } ] ──
    imprimir(lineas, { cajon } = {}) {
      const im = this.caja?.impresora || {};
      const cols = im.ancho === 58 ? 32 : 48;
      if (im.modo === 'agente') { if (this.enviarAgente({ t: 'imprimir', destino: im.destino, columnas: cols, lineas, cajon: !!(cajon && im.abrirCajon) })) return true; toast('El agente de impresión no está conectado', 'mal'); return false; }
      if (im.modo === 'ninguna') return false;
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
      document.body.append(f);
      const html = lineas.map(l => l.hr ? '<hr>' : l.qr ? `<div class="c"><img src="${esc(l.qr)}"></div>` : l.d !== undefined ? `<div class="f${l.b ? ' b' : ''}${l.g ? ' g' : ''}"><span>${esc(l.d)}</span><span>${esc(l.v)}</span></div>` : `<div class="${l.al || 'l'}${l.b ? ' b' : ''}${l.g ? ' g' : ''}">${esc(l.tx)}</div>`).join('');
      const d = f.contentDocument; d.open();
      d.write(`<style>@page{margin:2mm;size:${im.ancho === 58 ? 58 : 80}mm auto}body{font:12px/1.35 'Courier New',monospace;margin:0;color:#000;width:${im.ancho === 58 ? 50 : 72}mm}.c{text-align:center}.r{text-align:right}.b{font-weight:700}.g{font-size:16px}.f{display:flex;justify-content:space-between;gap:8px}hr{border:0;border-top:1px dashed #000;margin:4px 0}img{width:34mm}div{word-break:break-word}</style>${html}`);
      d.close();
      setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 150);
      return true;
    }
    abrirCajon() { return this.enviarAgente({ t: 'cajon', destino: this.caja?.impresora?.destino }); }
  }
  window.equipos = new Equipos();
})();
