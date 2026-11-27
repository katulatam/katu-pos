const mongoose = require('mongoose');

// Anti-repetición de las peticiones firmadas: cada nonce sirve una vez.
const nonceSchema = new mongoose.Schema({ _id: String, en: { type: Date, default: Date.now, expires: 600 } });

module.exports = mongoose.model('Nonce', nonceSchema);
