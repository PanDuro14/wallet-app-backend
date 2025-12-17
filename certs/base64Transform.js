// uso: node encode-p8.js certs/apns_key.p8 [apns_key.p8.b64]
const fs = require('fs');

const inPath = process.argv[2] || 'loyalty-450206-70a1868922bb.json';
const outPath = process.argv[3] || 'loyalty-450206-70a1868922bb.b64';
if (!inPath) {
  console.error('Uso: node encode-p8.js ruta/al/apns_key.p8 [salida.b64]');
  process.exit(1);
}

const b64 = fs.readFileSync(inPath).toString('base64');
fs.writeFileSync(outPath, b64);
console.log('OK ->', outPath);
