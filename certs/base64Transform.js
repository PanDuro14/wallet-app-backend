// uso: node encode-p8.js certs/apns_key.p8 [apns_key.p8.b64]
const fs = require('fs');

const inPath = process.argv[2] || 'AuthKey_DJXW9DQF5X.p8';
const outPath = process.argv[3] || 'apns_key.p8.b64';
if (!inPath) {
  console.error('Uso: node encode-p8.js ruta/al/apns_key.p8 [salida.b64]');
  process.exit(1);
}

const b64 = fs.readFileSync(inPath).toString('base64');
fs.writeFileSync(outPath, b64);
console.log('OK ->', outPath);
