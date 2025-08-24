const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const crypto = require('crypto');

const { APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_SANDBOX } = process.env;
const { APNS_ENABLED } = process.env; 

const apnsReady = () => {
    return APNS_ENABLED === 'true'  && APNS_KEY_ID && APNS_TEAM_ID && APNS_TOPIC; 
}

const apnsHost = (APNS_SANDBOX === 'true') ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
let apnsKey = ''; 
try { apnsKey = fs.readFileSync(path.join(process.cwd(), 'certs', 'apns_key.p8'), 'utf8'); } catch (_) {}


function makeJwt() {
    if(!apnsReady() || !apnsKey) return null; 
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID, typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now()/1000) })).toString('base64url');
    const signer = crypto.createSign('sha256');
    signer.update(`${header}.${claims}`);
    const key = crypto.createPrivateKey({ key: apnsKey, format: 'pem' });
    const sig = signer.sign(key).toString('base64url');
    return `${header}.${claims}.${sig}`;
}

const notifyWallet = async (pushToken) => {
    if (!apnsReady() || !apnsKey) return; // modo “solo APIs”
    const client = http2.connect(`https://${apnsHost}`);
    const jwt = makeJwt();
    if (!jwt) { client.close(); return; }
    await new Promise((resolve, reject) => {
        const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${pushToken}`,
        'apns-topic': APNS_TOPIC,               // = PASS_TYPE_IDENTIFIER
        'authorization': `bearer ${jwt}`,
        'apns-push-type': 'background',
        'content-length': 0
        });
        req.on('response', () => resolve());
        req.on('error', reject);
        req.end();
    });
    client.close();
}

module.exports = { notifyWallet }; 