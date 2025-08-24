// services/googleWalletService.js
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const fetch = globalThis.fetch || ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

const issuerId = process.env.GOOGLE_ISSUER_ID;
const DEFAULT_ISSUER_NAME = process.env.GOOGLE_ISSUER_NAME || 'Mi Negocio';
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',').map(s => s.trim()).filter(Boolean);

//const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || '';
const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';
//const SA_JSON_INLINE = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

/* ====================== Helpers base ====================== */
let sa;
function getSA() {
  if (sa) return sa;
  if (!SA_JSON_BASE64) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');

  const raw = Buffer.from(SA_JSON_BASE64, 'base64').toString('utf8');
  sa = JSON.parse(raw);

  // Reparar saltos de línea por si vinieron escapados
  if (typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('Service Account inválida: faltan client_email o private_key');
  }
  return sa;
}

function toHexColor(input) {
  if (!input) return '#FFFFFF';
  const s = String(input).trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return s.startsWith('#') ? s : `#${s}`;
  const m = s.match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!m) return '#FFFFFF';
  const to2 = n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0').toUpperCase();
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

function classIdForBusiness(businessId) {
  const suffix = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  return `${issuerId}.loyalty_biz_${suffix}`;
}

function classIdForBusinessTheme(businessId, themeKey = 'default') {
  const a = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  const b = String(themeKey).replace(/[^a-zA-Z0-9_]/g, '_');
  return `${issuerId}.loyalty_biz_${a}_${b}`;
}

function isHttps(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

function normalizeGWBarcodeType(pref) {
  const p = String(pref || 'qr').toLowerCase();
  if (p === 'qr' || p === 'qrcode') return 'QR_CODE';
  if (p === 'pdf' || p === 'pdf417') return 'PDF_417';
  if (p === 'aztec') return 'AZTEC';
  if (p === 'code128' || p === 'c128' || p === 'barcode') return 'CODE_128';
  return 'QR_CODE';
}

/* ====================== Auth ====================== */
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

/* ====================== Clase (branding) ====================== */
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

  // GET
  const getResp = await fetch(`${base}/loyaltyClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (getResp.ok) return classId;
  if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyClass falló (${getResp.status}): ${txt}`);
  }

  // POST
  const safeLogo = (logoUri && isHttps(logoUri)) ? { programLogo: { sourceUri: { uri: logoUri } } } : {};
  const body = {
    id: classId,
    issuerName,
    programName,
    hexBackgroundColor: toHexColor(hexBackgroundColor),
    reviewStatus: 'UNDER_REVIEW',
    ...safeLogo
  };

  const postResp = await fetch(`${base}/loyaltyClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!postResp.ok) {
    if (postResp.status === 409) return classId; // ya existe
    const txt = await postResp.text().catch(() => '');
    throw new Error(`POST loyaltyClass falló (${postResp.status}): ${txt}`);
  }
  return classId;
}

/* ====================== URL "Add to Google Wallet" ====================== */
function buildAddToGoogleWalletURL({
  cardCode,
  userName,
  brand = {},               // { programName, bg, logoUri }
  businessId,
  barcode = {},             // { type, value, alternateText }
  modules = {},             // { textModulesData?: [], imageModulesData?: [] }
  points = null             // number|string|{ label?, balance:{ int?|string?|money? } } | { value }
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');

  const s = getSA();
  const classId = classIdForBusiness(businessId);
  // const hexBg = toHexColor(brand.bg); // útil si creas/actualizas la Class

  // 1) Barcode
  const normType = (typeof normalizeGWBarcodeType === 'function')
    ? normalizeGWBarcodeType(barcode.type)
    : (barcode.type || 'QR_CODE');

  // 2) Modules (concatena el de marca + los que vengan)
  const textModules = [];
  if (brand.programName) {
    textModules.push({
      header: brand.programName,
      body: `Cliente: ${userName || cardCode}`
    });
  }
  if (Array.isArray(modules.textModulesData) && modules.textModulesData.length) {
    textModules.push(...modules.textModulesData);
  }
  const imageModules = Array.isArray(modules.imageModulesData) && modules.imageModulesData.length
    ? modules.imageModulesData
    : undefined;

  // 3) Loyalty points (acepta número/string u objeto avanzado)
  let loyaltyPoints = undefined;
  if (points != null) {
    if (typeof points === 'number' || typeof points === 'string') {
      loyaltyPoints = { label: 'POINTS', balance: { string: String(points) } };
    } else if (typeof points === 'object') {
      const label = points.label || 'POINTS';
      let balance = undefined;
      if (points.balance?.int != null) {
        balance = { int: Number(points.balance.int) };
      } else if (points.balance?.string != null) {
        balance = { string: String(points.balance.string) };
      } else if (points.balance?.money) {
        balance = { money: points.balance.money };
      } else if (points.value != null) {
        balance = { string: String(points.value) };
      }
      if (balance) loyaltyPoints = { label, balance };
    }
  }

  // 4) Objeto de lealtad
  const loyaltyObject = {
    id: `${issuerId}.${cardCode}`,
    classId,
    state: 'ACTIVE',
    accountId: cardCode,
    accountName: userName || cardCode,
    barcode: {
      type: normType,
      value: barcode.value || cardCode,
      alternateText: barcode.alternateText || undefined
    },
    ...(loyaltyPoints ? { loyaltyPoints } : {}),
    ...(textModules.length ? { textModulesData: textModules } : {}),
    ...(imageModules ? { imageModulesData: imageModules } : {})
  };

  // 5) JWT "Save to Google Wallet"
  const payload = { loyaltyObjects: [loyaltyObject] };
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

async function selfTestAuth() {
  const s = getSA();
  const auth = new GoogleAuth({
    credentials: { client_email: s.client_email, private_key: s.private_key },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log('Access token OK?', !!token);
}
selfTestAuth().catch(e => console.error('SelfTest FAILED:', e.response?.data || e));

module.exports = {
  buildAddToGoogleWalletURL,
  ensureLoyaltyClass,
  getAccessToken,
  getSA,
  normalizeGWBarcodeType,
  isHttps,
  classIdForBusiness,
  classIdForBusinessTheme
};
