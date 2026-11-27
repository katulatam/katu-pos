// Presets por país. Son la SEMILLA del modelo Pais (se copian a la base al
// arrancar si el país no existe); de ahí en adelante Katú los administra en
// /admin/paises.html. Tarifas y catálogos son puntos de partida editables: la
// norma cambia y la responsabilidad de validarlos es de cada país.
const iva = (pct, nombre) => ({ codigo: `iva${pct}`, nombre: nombre || `IVA ${pct}%`, tipo: 'iva', pct });
const excluido = (nombre = 'Excluido / exento') => ({ codigo: 'excluido', nombre, tipo: 'excluido', pct: 0 });

const EFECTIVO = { codigo: 'efectivo', nombre: 'Efectivo', tipo: 'efectivo', icono: 'fa-money-bill-wave' };
const DATAFONO = { codigo: 'datafono', nombre: 'Datáfono', tipo: 'datafono', icono: 'fa-credit-card' };
const QR_TARJETA = { codigo: 'qr_tarjeta', nombre: 'QR Tarjeta', tipo: 'qr', proveedor: 'katupay_tarjeta', icono: 'fa-qrcode' };
const TRANSFERENCIA = { codigo: 'transferencia', nombre: 'Transferencia', tipo: 'manual', icono: 'fa-building-columns' };
const FIADO = { codigo: 'fiado', nombre: 'Fiado', tipo: 'fiado', icono: 'fa-handshake' };
const COMUNES = [EFECTIVO, QR_TARJETA, DATAFONO, TRANSFERENCIA, FIADO];

const PAISES = {
  CO: {
    nombre: 'Colombia', moneda: 'COP', simbolo: '$', decimales: 0, locale: 'es-CO',
    zonaHoraria: 'America/Bogota', zonasHorarias: ['America/Bogota'],
    prefijoTelefono: '57', nombreIdFiscal: 'NIT', redondeoEfectivo: 50,
    billetes: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
    impuestos: [iva(19), iva(5), iva(0, 'IVA 0% (exento)'), { codigo: 'inc8', nombre: 'Impoconsumo 8%', tipo: 'inc', pct: 8 }, excluido('Excluido')],
    impuestoDefecto: 'iva19',
    tiposDocumento: [
      { codigo: '13', nombre: 'Cédula de ciudadanía' }, { codigo: '31', nombre: 'NIT', empresa: true },
      { codigo: '22', nombre: 'Cédula de extranjería' }, { codigo: '41', nombre: 'Pasaporte' },
    ],
    consumidorFinal: { tipoDocumento: '13', documento: '222222222222', nombre: 'Consumidor Final' },
    mediosPago: [EFECTIVO, { codigo: 'qr_nequi', nombre: 'QR Nequi', tipo: 'qr', proveedor: 'katupay_nequi', icono: 'fa-qrcode' }, QR_TARJETA, DATAFONO, TRANSFERENCIA, FIADO],
    facturacion: { proveedor: 'alanube_co', nombreDocumento: 'Factura electrónica de venta', entidad: 'DIAN', codigoUnico: 'CUFE' },
  },
  MX: {
    nombre: 'México', moneda: 'MXN', simbolo: '$', decimales: 2, locale: 'es-MX',
    zonaHoraria: 'America/Mexico_City', zonasHorarias: ['America/Mexico_City', 'America/Cancun', 'America/Monterrey', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana'],
    prefijoTelefono: '52', nombreIdFiscal: 'RFC', redondeoEfectivo: 0.5,
    billetes: [20, 50, 100, 200, 500, 1000],
    impuestos: [iva(16), iva(8, 'IVA 8% (frontera)'), iva(0, 'IVA 0%'), { codigo: 'ieps8', nombre: 'IEPS 8%', tipo: 'ieps', pct: 8 }, excluido('Exento')],
    impuestoDefecto: 'iva16',
    tiposDocumento: [{ codigo: 'RFC', nombre: 'RFC', empresa: true }, { codigo: 'CURP', nombre: 'CURP' }, { codigo: 'INE', nombre: 'INE' }, { codigo: 'PAS', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: 'RFC', documento: 'XAXX010101000', nombre: 'Público en General' },
    mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'CFDI', entidad: 'SAT', codigoUnico: 'UUID' },
  },
  PE: {
    nombre: 'Perú', moneda: 'PEN', simbolo: 'S/', decimales: 2, locale: 'es-PE',
    zonaHoraria: 'America/Lima', zonasHorarias: ['America/Lima'], prefijoTelefono: '51', nombreIdFiscal: 'RUC', redondeoEfectivo: 0.1,
    billetes: [10, 20, 50, 100, 200],
    impuestos: [{ codigo: 'igv18', nombre: 'IGV 18%', tipo: 'igv', pct: 18 }, excluido('Exonerado / inafecto')], impuestoDefecto: 'igv18',
    tiposDocumento: [{ codigo: '1', nombre: 'DNI' }, { codigo: '6', nombre: 'RUC', empresa: true }, { codigo: '4', nombre: 'Carné de extranjería' }, { codigo: '7', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: '1', documento: '00000000', nombre: 'Clientes Varios' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'Comprobante electrónico', entidad: 'SUNAT', codigoUnico: 'Hash' },
  },
  CL: {
    nombre: 'Chile', moneda: 'CLP', simbolo: '$', decimales: 0, locale: 'es-CL',
    zonaHoraria: 'America/Santiago', zonasHorarias: ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'], prefijoTelefono: '56', nombreIdFiscal: 'RUT', redondeoEfectivo: 10,
    billetes: [1000, 2000, 5000, 10000, 20000],
    impuestos: [iva(19), excluido('Exento')], impuestoDefecto: 'iva19',
    tiposDocumento: [{ codigo: 'RUT', nombre: 'RUT', empresa: true }, { codigo: 'PAS', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: 'RUT', documento: '66666666-6', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'Boleta electrónica', entidad: 'SII', codigoUnico: 'Timbre' },
  },
  EC: {
    nombre: 'Ecuador', moneda: 'USD', simbolo: '$', decimales: 2, locale: 'es-EC',
    zonaHoraria: 'America/Guayaquil', zonasHorarias: ['America/Guayaquil', 'Pacific/Galapagos'], prefijoTelefono: '593', nombreIdFiscal: 'RUC', redondeoEfectivo: 0,
    billetes: [1, 5, 10, 20, 50, 100],
    impuestos: [iva(15), iva(0), excluido('No objeto / exento')], impuestoDefecto: 'iva15',
    tiposDocumento: [{ codigo: '05', nombre: 'Cédula' }, { codigo: '04', nombre: 'RUC', empresa: true }, { codigo: '06', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: '07', documento: '9999999999999', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'Factura electrónica', entidad: 'SRI', codigoUnico: 'Clave de acceso' },
  },
  PA: {
    nombre: 'Panamá', moneda: 'USD', simbolo: 'B/.', decimales: 2, locale: 'es-PA',
    zonaHoraria: 'America/Panama', zonasHorarias: ['America/Panama'], prefijoTelefono: '507', nombreIdFiscal: 'RUC', redondeoEfectivo: 0,
    billetes: [1, 5, 10, 20, 50, 100],
    impuestos: [{ codigo: 'itbms7', nombre: 'ITBMS 7%', tipo: 'itbms', pct: 7 }, { codigo: 'itbms10', nombre: 'ITBMS 10%', tipo: 'itbms', pct: 10 }, excluido('Exento')], impuestoDefecto: 'itbms7',
    tiposDocumento: [{ codigo: 'CED', nombre: 'Cédula' }, { codigo: 'RUC', nombre: 'RUC', empresa: true }, { codigo: 'PAS', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: 'CF', documento: 'CF', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'Factura electrónica', entidad: 'DGI', codigoUnico: 'CUFE' },
  },
  CR: {
    nombre: 'Costa Rica', moneda: 'CRC', simbolo: '₡', decimales: 2, locale: 'es-CR',
    zonaHoraria: 'America/Costa_Rica', zonasHorarias: ['America/Costa_Rica'], prefijoTelefono: '506', nombreIdFiscal: 'Cédula jurídica', redondeoEfectivo: 5,
    billetes: [1000, 2000, 5000, 10000, 20000],
    impuestos: [iva(13), iva(1), excluido('Exento')], impuestoDefecto: 'iva13',
    tiposDocumento: [{ codigo: '01', nombre: 'Cédula física' }, { codigo: '02', nombre: 'Cédula jurídica', empresa: true }, { codigo: '03', nombre: 'DIMEX' }],
    consumidorFinal: { tipoDocumento: '', documento: '', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'Tiquete electrónico', entidad: 'Hacienda', codigoUnico: 'Clave' },
  },
  GT: {
    nombre: 'Guatemala', moneda: 'GTQ', simbolo: 'Q', decimales: 2, locale: 'es-GT',
    zonaHoraria: 'America/Guatemala', zonasHorarias: ['America/Guatemala'], prefijoTelefono: '502', nombreIdFiscal: 'NIT', redondeoEfectivo: 0.05,
    billetes: [5, 10, 20, 50, 100, 200],
    impuestos: [iva(12), excluido('Exento')], impuestoDefecto: 'iva12',
    tiposDocumento: [{ codigo: 'NIT', nombre: 'NIT', empresa: true }, { codigo: 'CUI', nombre: 'CUI' }],
    consumidorFinal: { tipoDocumento: 'NIT', documento: 'CF', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'FEL', entidad: 'SAT', codigoUnico: 'Autorización' },
  },
  DO: {
    nombre: 'República Dominicana', moneda: 'DOP', simbolo: 'RD$', decimales: 2, locale: 'es-DO',
    zonaHoraria: 'America/Santo_Domingo', zonasHorarias: ['America/Santo_Domingo'], prefijoTelefono: '1', nombreIdFiscal: 'RNC', redondeoEfectivo: 1,
    billetes: [50, 100, 200, 500, 1000, 2000],
    impuestos: [{ codigo: 'itbis18', nombre: 'ITBIS 18%', tipo: 'itbis', pct: 18 }, { codigo: 'itbis16', nombre: 'ITBIS 16%', tipo: 'itbis', pct: 16 }, excluido('Exento')], impuestoDefecto: 'itbis18',
    tiposDocumento: [{ codigo: 'CED', nombre: 'Cédula' }, { codigo: 'RNC', nombre: 'RNC', empresa: true }, { codigo: 'PAS', nombre: 'Pasaporte' }],
    consumidorFinal: { tipoDocumento: '', documento: '', nombre: 'Consumidor Final' }, mediosPago: COMUNES,
    facturacion: { proveedor: '', nombreDocumento: 'e-CF', entidad: 'DGII', codigoUnico: 'e-NCF' },
  },
};

module.exports = { PAISES };
