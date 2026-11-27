const mongoose = require('mongoose');

const buildURI = () => {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;

  const user = encodeURIComponent(process.env.BD_USER);
  const pass = encodeURIComponent(process.env.BD_PASS);
  const host = process.env.DB_HOST;              // puede ser "h1:27017,h2:27017"
  const name = process.env.DB_NAME;
  const auth = process.env.DB_AUTH_SOURCE || 'admin';
  const rs = process.env.DB_REPLICA_SET;

  const params = [`authSource=${auth}`];
  if (rs) params.push(`replicaSet=${rs}`);
  if (process.env.DB_TLS === 'true') params.push('tls=true');
  params.push('retryWrites=true');

  return `mongodb://${user}:${pass}@${host}/${name}?${params.join('&')}`;
};

// Sin DB_HOST/MONGO_URI y fuera de producción: MongoDB en memoria con datos
// demo (seeds/demo.seed.js), para poder probar la plataforma sin instalar nada.
const usarMemoria = () => !process.env.MONGO_URI && !process.env.DB_HOST && process.env.NODE_ENV !== 'production';

const conectarDB = async () => {
  try {
    let uri;
    if (usarMemoria()) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      uri = mongod.getUri('katu_pos');
    } else {
      uri = buildURI();
    }

    // Falla rápido (5s) si el servidor no responde, en vez de los 30s del driver
    const opciones = { serverSelectionTimeoutMS: 5000, retryReads: true };
    if (process.env.DB_CA_FILE) opciones.tlsCAFile = process.env.DB_CA_FILE;

    const conn = await mongoose.connect(uri, opciones);
    console.log(`MongoDB conectado: ${conn.connection.host}${usarMemoria() ? ' (memoria, modo demo)' : ''}`);
    return { enMemoria: usarMemoria() };
  } catch (error) {
    console.error(`Error al conectar MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = conectarDB;
