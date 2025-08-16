// controller/walletController.js
const { issueGoogleWalletLink, issueAppleWalletPkpass } = require('../processes/walletProcess');
const { buildAddToGoogleWalletURL, ensureLoyaltyClass } = require('../services/googleWalletService');

const WALLET_ENABLED = (process.env.WALLET_ENABLED === 'true');

async function createGoogle(req, res) {
  if (!WALLET_ENABLED) return res.status(501).json({ error: 'Wallet deshabilitado (WALLET_ENABLED=false)' });
  try {
    const { cardCode, userName, programName, businessId } = req.body || {};
    if (!cardCode || !businessId) return res.status(400).json({ error: 'cardCode y businessId requeridos' });

    // Usa el process (trae brand del negocio)
    const url = await issueGoogleWalletLink({ cardCode, userName, programName, businessId });
    return res.json({ url });
  } catch (e) {
    console.error('[Google Wallet] create error:', e);
    return res.status(500).json({ error: 'No se pudo generar el enlace' });
  }
}

// controller/walletController.js
async function addToAppleWallet(req, res) {
  const WALLET_ENABLED = (process.env.WALLET_ENABLED === 'true');
  if (!WALLET_ENABLED) return res.status(501).json({ error: 'Wallet deshabilitado (WALLET_ENABLED=false)' });

  try {
    const { cardCode, userName, programName, businessId, colors, fields, barcode, points } = req.body || {};
    if (!cardCode || !businessId)
      return res.status(400).json({ error: 'cardCode y businessId son requeridos.' });

    const pkpassBuffer = await issueAppleWalletPkpass({
      cardCode, userName, programName, businessId, colors, fields, barcode, points
    });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${cardCode}.pkpass"`
    });
    return res.send(pkpassBuffer);
  } catch (e) {
    console.error('[Apple Wallet] create error:', e?.message || e);
    return res.status(500).json({ error: 'No se pudo generar el .pkpass' });
  }
}



// SOLO DEV: inspección del JWT (sin pasar por process)
async function debugGoogle(req, res) {
  try {
    const { cardCode, userName, programName, businessId } = req.body || {};
    if (!cardCode || !businessId) return res.status(400).json({ message: 'cardCode y businessId requeridos' });

    const url = buildAddToGoogleWalletURL({
      cardCode,
      userName,
      businessId,
      brand: { programName }
    });

    const token = decodeURIComponent(url.split('/gp/v/save/')[1]);
    const [h, p] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));

    return res.json({ url, header, payload_claims: payload });
  } catch (e) {
    console.error('[Google Wallet] debug error:', e);
    return res.status(500).json({ message: e.message });
  }
}


const ensureGoogleClass = async (req, res) => {
  try {
    const { businessId, programName, bg, logoUri } = req.body || {};
    if (!businessId) return res.status(400).json({ message: 'businessId requerido' });
    const classId = await ensureLoyaltyClass({
      businessId,
      programName: programName || 'Mi Programa',
      hexBackgroundColor: bg || '#FFFFFF',
      logoUri
    });
    res.json({ ok: true, classId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports = { 
    createGoogle, 
    addToAppleWallet, 
    debugGoogle, 
    ensureGoogleClass 
};
