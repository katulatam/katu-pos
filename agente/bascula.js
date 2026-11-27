/* bascula.js — Lectura de básculas (RS-232 / USB-serial).
 * Lo usan la caja (Web Serial del navegador, sin instalar nada) y el agente
 * local (Node + serialport). Aquí solo está la parte pura: armar tramas,
 * interpretar el peso y decidir si está estable.
 *
 * Los perfiles son puntos de partida: los fabricantes cambian el formato según
 * el modelo y su configuración, así que todos los parámetros (velocidad, bits,
 * comando, expresión) se ajustan por caja y la caja trae un monitor que
 * muestra la trama cruda de la báscula.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Bascula = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXPRESION = '([+-]?\\s*\\d+(?:[.,]\\d+)?)\\s*(kg|g|lb)?';
  const base = { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, comando: '', intervaloMs: 0, unidad: 'kg', expresion: EXPRESION, divisor: 1, lecturas: 3, tolerancia: 0.002 };
  const PERFILES = {
    continua:    { ...base, nombre: 'Continua (transmite sola)' },
    solicitud_p: { ...base, nombre: 'Por solicitud con "P"', comando: 'P', intervaloMs: 300 },
    solicitud_w: { ...base, nombre: 'Por solicitud con "W" + CR (7 bits, paridad par)', dataBits: 7, parity: 'even', comando: 'W\\r', intervaloMs: 300 },
    enq:         { ...base, nombre: 'Por solicitud con ENQ (0x05)', comando: '\\x05', intervaloMs: 300 },
  };

  // "\\x05", "\\r", "\\n" escritos en la configuración → bytes reales
  function aBytes(comando) {
    const s = String(comando || '')
      .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
  }

  const aKg = (n, u) => (u === 'g' ? n / 1000 : u === 'lb' ? n * 0.45359237 : n);

  // Interpreta UNA trama de texto → { kg, crudo, inestable } o null
  function interpretar(trama, cfg) {
    const limpio = String(trama || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (!limpio) return null;
    let re;
    try { re = new RegExp((cfg && cfg.expresion) || EXPRESION, 'i'); } catch (_) { return null; }
    const m = limpio.match(re);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const unidad = (m[2] || cfg.unidad || 'kg').toLowerCase();
    // Algunas básculas envían el número sin punto (01250 = 1,250 kg)
    const divisor = Number(cfg.divisor) > 0 ? Number(cfg.divisor) : 1;
    const kg = Math.round(aKg(n / divisor, unidad) * 1000) / 1000;
    // Marca explícita de inestabilidad (US = unstable en el formato "ST,GS,...")
    const inestable = /(^|[,\s])US([,\s]|$)/.test(limpio);
    return { kg, crudo: limpio, inestable };
  }

  // Acumula los bytes que llegan por el puerto, corta tramas y avisa el peso.
  // Estable = `lecturas` iguales (± tolerancia) seguidas.
  class Lector {
    constructor(cfg, alLeer) {
      this.cfg = cfg || {};
      this.alLeer = alLeer || (() => {});
      this.buf = '';
      this.hist = [];
    }
    recibir(bytes) {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b & 0x7f); // 7 bits: descarta paridad
      this.buf += s;
      const partes = this.buf.split(/[\r\n\x03\x04]+/);
      this.buf = partes.pop();
      if (this.buf.length > 256) this.buf = this.buf.slice(-256);
      partes.forEach(p => this._trama(p));
    }
    // Básculas que no terminan la trama: se vacía cuando hay silencio en la línea
    vaciar() { const p = this.buf; this.buf = ''; if (p) this._trama(p); }
    _trama(p) {
      const r = interpretar(p, this.cfg);
      if (!r) return;
      const necesarias = Number(this.cfg.lecturas) || 3;
      const tol = Number(this.cfg.tolerancia) || 0.002;
      this.hist.push(r.kg);
      if (this.hist.length > necesarias) this.hist.shift();
      const ult = this.hist[this.hist.length - 1];
      const estable = !r.inestable && this.hist.length >= necesarias && this.hist.every(x => Math.abs(x - ult) <= tol);
      this.alLeer({ ...r, estable });
    }
  }

  return { PERFILES, aBytes, interpretar, Lector };
});
