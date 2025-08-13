const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || ''; // ruta a archivo (opcional)
const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''; // base64 (opcional)
const SA_JSON_INLINE = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''; // JSON plano (opcional)

const issuerId = process.env.GOOGLE_ISSUER_ID;
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200').split(',');

let sa;
function getSA() {
  if (sa) return sa;

  // 1) ENV en base64 o JSON plano
  if (SA_JSON_BASE64 || SA_JSON_INLINE) {
    const raw = SA_JSON_INLINE || Buffer.from(SA_JSON_BASE64, 'base64').toString('utf8');
    sa = JSON.parse(raw);
    return sa;
  }

  // 2) Archivo (ruta relativa al CWD)
  if (!SERVICE_ACCOUNT_PATH) {
    throw new Error('Falta credencial: define GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 o GOOGLE_SERVICE_ACCOUNT_PATH');
  }
  const abs = path.isAbsolute(SERVICE_ACCOUNT_PATH)
    ? SERVICE_ACCOUNT_PATH
    : path.resolve(process.cwd(), SERVICE_ACCOUNT_PATH);

  if (!fs.existsSync(abs)) {
    throw new Error(`No existe el archivo de Service Account en: ${abs}`);
  }
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
    }],
    loyaltyClasses: [{
      id: classId,
      programName: brand.programName || 'Loyalty',
      hexBackgroundColor: hexBg,
      reviewStatus: 'UNDER_REVIEW',
      ...(brand.logoUri ? { programLogo: { sourceUri: { uri: brand.logoUri } } } : {})
    }]
  };

  const claims = { iss: s.client_email, aud: 'google', typ: 'savetowallet', origins, payload };
  const token = jwt.sign(claims, s.private_key, { algorithm: 'RS256', keyid: s.private_key_id });
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(token)}`;
}

module.exports = { buildAddToGoogleWalletURL };
