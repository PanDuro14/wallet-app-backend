const fs = require('fs'); const path = require('path');
const dir = path.join(process.cwd(), 'certs'); if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const w = (name, val) => fs.writeFileSync(path.join(dir, name), (val||'').replace(/^"(.*)"$/s,'$1'), 'utf8');
w('WWDR.pem', process.env.WWDR);
w('pass-cert.pem', process.env.SIGNER_CERT);
w('pass-key.pem', process.env.SIGNER_KEY);
console.log('Listo: certs escritos en ./certs');