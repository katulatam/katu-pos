# Agente local de Katú POS

Conecta al computador de la caja los equipos que el navegador no maneja solo:

- **Báscula** RS-232 (con adaptador USB-serial) o USB-serial.
- **Impresora térmica** ESC/POS por red (`tcp://192.168.1.50:9100`) o serial (`serial:COM4@9600`), sin diálogo de impresión.
- **Cajón monedero** conectado a la impresora.

## Instalar (Windows)

1. Instala Node.js 20 o superior.
2. Copia esta carpeta al computador y abre `iniciar-agente.bat`.
3. En `.env`, pon en `ORIGENES` la dirección exacta de tu POS.
4. `npm run puertos` muestra los puertos disponibles (COM3…).
5. En Administración → Cajas y equipos, elige "Por el agente local".

`npm run simular` prueba sin equipos: genera pesos e imprime en consola.

## Si el peso no aparece

En la caja abre la báscula (F9): el monitor muestra la trama cruda. Compárala con
el manual y ajusta velocidad, bits, paridad, comando, expresión o divisor.
