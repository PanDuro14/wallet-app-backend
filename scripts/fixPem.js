const fs = require('fs'), path = require('path');
const dir = path.join(process.cwd(), 'certs');
const norm = s => {
  let t = s.toString('utf8').replace(/^\uFEFF/, '').trim();
  t = t.replace(/^"(.*)"$/s,'$1').replace(/\r\n/g,'\n');
  if (!t.endsWith('\n')) t += '\n';
  return t;
};
['WWDR.pem','pass-cert.pem','pass-key.pem'].forEach(f=>{
  const p = path.join(dir, f);
  fs.writeFileSync(p, norm(fs.readFileSync(p)), 'utf8');
  console.log('', f, 'normalizado');
});
