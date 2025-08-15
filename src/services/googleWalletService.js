const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');

const fetch = globalThis.fetch || ((...a) => import('node-fetch').then(({default: f}) => f(...a)));

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || '';
const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';
const SA_JSON_INLINE = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

const issuerId = process.env.GOOGLE_ISSUER_ID;
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',').map(o => o.trim()).filter(Boolean);

let sa;
function getSA() {
  if (sa) return sa;
  if (SA_JSON_BASE64 || SA_JSON_INLINE) {
    const raw = SA_JSON_INLINE || Buffer.from(SA_JSON_BASE64, 'base64').toString('utf8');
    sa = JSON.parse(raw);
    return sa;
  }
  if (!SERVICE_ACCOUNT_PATH) throw new Error('Falta credencial: GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 o GOOGLE_SERVICE_ACCOUNT_PATH');
  const abs = path.isAbsolute(SERVICE_ACCOUNT_PATH) ? SERVICE_ACCOUNT_PATH : path.resolve(process.cwd(), SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(abs)) throw new Error(`No existe el archivo de Service Account en: ${abs}`);
  sa = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return sa;
}

function classIdForBusiness(businessId) {
  const suffix = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  return `${issuerId}.loyalty_biz_${suffix}`;
}

function toHexColor(input) {
  if (!input) return '#FFFFFF';
  const s = String(input).trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return s.startsWith('#') ? s : `#${s}`;
  const m = s.match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!m) return '#FFFFFF';
  const to2 = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0').toUpperCase();
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

async function getAccessToken() {
  const s = getSA();
  const auth = new GoogleAuth({
    credentials: { client_email: s.client_email, private_key: s.private_key },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token?.token || token;
}

 const DEFAULT_ISSUER_NAME = process.env.GOOGLE_ISSUER_NAME || 'Mi Negocio';
 async function ensureLoyaltyClass({
   businessId,
   programName,
   issuerName = DEFAULT_ISSUER_NAME,
   hexBackgroundColor = '#FFFFFF',
   logoUri
  }) {

  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  const classId = classIdForBusiness(businessId);
  const accessToken = await getAccessToken();
  const base = 'https://walletobjects.googleapis.com/walletobjects/v1';

  // ¿Existe?
  const getResp = await fetch(`${base}/loyaltyClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (getResp.ok) return classId;         
  if (getResp.status !== 404) {           
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyClass falló (${getResp.status}): ${txt}`);
  }

  // Crear
  const body = {
    id: classId,
    issuerName,
    programName,
    hexBackgroundColor,
    reviewStatus: 'UNDER_REVIEW',
    ...(logoUri ? { programLogo: { sourceUri: { uri: logoUri } } } : {})
  };

  const postResp = await fetch(`${base}/loyaltyClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!postResp.ok) {
    if(postResp.status === 409) return classId; 
    const txt = await postResp.text().catch(() => '');
    throw new Error(`POST loyaltyClass falló (${postResp.status}): ${txt}`);
  }
  return classId;
}

function buildAddToGoogleWalletURL({ cardCode, userName, brand = {}, businessId }) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');

  const s = getSA();
  const classId = classIdForBusiness(businessId);
  const hexBg = toHexColor(brand.bg);

  const payload = {
    loyaltyObjects: [{
      id: `${issuerId}.${cardCode}`,
      classId,
      state: 'ACTIVE',
      accountId: cardCode,
      accountName: userName || cardCode,
      barcode: { type: 'QR_CODE', value: cardCode },
      ...(brand.programName ? { textModulesData: [{ header: brand.programName, body: `Cliente: ${userName || cardCode}` }] } : {})
    }]
    /*,
    loyaltyClasses: [{
      id: classId,
      programName: brand.programName || 'Loyalty',
      hexBackgroundColor: hexBg,
      reviewStatus: 'UNDER_REVIEW',
      ...(brand.logoUri ? { programLogo: { sourceUri: { uri: brand.logoUri } } } : {})
    }] */
  };

  const claims = {
    iss: s.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins,
    payload
  };
  const token = jwt.sign(claims, s.private_key, { algorithm: 'RS256', keyid: s.private_key_id });
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(token)}`;
}

module.exports = {
  buildAddToGoogleWalletURL,
  ensureLoyaltyClass,   
  getAccessToken        
};
