const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const crypto = require('crypto');

const p8b64 = process.env.APNS_KEY_P8_BASE64;                // <- secret en base64
const p8Path = path.join(process.cwd(), 'certs', 'apns_key.p8');

const HOSTS = {
  sandbox: 'api.sandbox.push.apple.com',
  prod:    'api.push.apple.com'
};

// 1) Si viene el secret, reconstruye el archivo PEM
if (p8b64) {
  try {
    fs.mkdirSync(path.dirname(p8Path), { recursive: true });
    const pem = Buffer.from(p8b64, 'base64').toString('utf8');
    fs.writeFileSync(p8Path, pem, { mode: 0o600 });          // permisos seguros
    console.log('[APNs] apns_key.p8 reconstruido en', p8Path);
  } catch (e) {
    console.error('[APNs] Error al escribir apns_key.p8:', e.message);
  }
}

const { APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_SANDBOX } = process.env;
const { APNS_ENABLED } = process.env; 

const apnsReady = () => {
    return APNS_ENABLED === 'true'  && APNS_KEY_ID && APNS_TEAM_ID && APNS_TOPIC; 
}

//const apnsHost = (APNS_SANDBOX === 'true') ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
let apnsKey = ''; 
try { apnsKey = fs.readFileSync(p8Path, 'utf8'); } catch (_) {}

let cachedJwt = null, cachedAt = 0;
function makeJwt() {
  if (!apnsReady() || !apnsKey) return null;
  const now = Math.floor(Date.now()/1000);
  if (cachedJwt && (now - cachedAt) < 50*60) return cachedJwt; // válido 50 min

  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID, typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: APNS_TEAM_ID, iat: now })).toString('base64url');
  const signer = crypto.createSign('sha256');
  signer.update(`${header}.${claims}`);
  const key = crypto.createPrivateKey({ key: apnsKey, format: 'pem' });
  const sig = signer.sign(key).toString('base64url');

  cachedJwt = `${header}.${claims}.${sig}`;
  cachedAt = now;
  return cachedJwt;
}

function sendPush({ pushToken, host }) {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    const jwt = makeJwt();
    if (!jwt) { client.close(); return resolve({ status: 0, reason: 'NoJWT' }); }

    let status = 0, body = '';
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': APNS_TOPIC,      // = tu passTypeIdentifier
      'apns-push-type': 'pass',      // 👈 obligatorio para Wallet
      'apns-priority': '10',         // 👈 recomendado
      'content-length': 0            // cuerpo vacío está OK para Wallet
    });

    req.on('response', (headers) => { status = headers[':status'] || 0; });
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      let reason = null;
      try { reason = JSON.parse(body).reason; } catch {}
      client.close();
      resolve({ status, reason });
    });
    req.on('error', (e) => { client.close(); resolve({ status: 0, reason: e?.message || 'connError' }); });
    req.end();
  });
}

const notifyWallet = async (pushToken) => {
  // Host por config (si no has seteado APNS_SANDBOX, asume sandbox en dev)
  const preferSandbox = process.env.APNS_SANDBOX === 'true';
  const firstHost = preferSandbox ? HOSTS.sandbox : HOSTS.prod;
  const secondHost = preferSandbox ? HOSTS.prod : HOSTS.sandbox;

  const first = await sendPush({ pushToken, host: firstHost });
  if (first.status === 200) return 200;

  // Si Apple dice que el entorno es incorrecto, intenta el otro host
  if (first.status === 403 && /Environment/i.test(first.reason || '')) {
    const second = await sendPush({ pushToken, host: secondHost });
    if (second.status === 200) return 200;
    console.log('[APNs] fallback failed', second);
    return second.status || 0;
  }

  if (first.status !== 200) {
    console.log('[APNs] status:', first.status, 'reason:', first.reason);
  }
  return first.status || 0;
};

module.exports = { notifyWallet }; 