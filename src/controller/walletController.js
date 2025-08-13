const { issueGoogleWalletLink, issueAppleWalletPkpass } = require('../processes/walletProcess');

const WALLET_ENABLED = (process.env.WALLET_ENABLED === 'true');

async function addToGoogleWallet(req, res) {
    if (!WALLET_ENABLED) return res.status(501).json({ error: 'Wallet deshabilitado (configura servicios y activa WALLET_ENABLED=true)' });
    try {
        const { cardCode, userName, programName, businessId } = req.body || {};
        if (!cardCode || !businessId) return res.status(400).json({ error: 'cardCode y businessId requeridos' });
        const url = await issueGoogleWalletLink({ cardCode, userName, programName, businessId });
        res.json({ url });
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'No se pudo generar el enlace' });
    }
}

async function addToAppleWallet(req, res) {
    if (!WALLET_ENABLED) return res.status(501).json({ error: 'Wallet deshabilitado (configura servicios y activa WALLET_ENABLED=true)' });
    try {
        const { cardCode, userName, programName, businessId } = req.body || {};
        if (!cardCode || !businessId) return res.status(400).json({ error: 'cardCode y businessId son requeridos.' });

        const pkpassBuffer = await issueAppleWalletPkpass({ cardCode, userName, programName, businessId });
        res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${cardCode}.pkpass"`
        });
        return res.send(pkpassBuffer);
    } catch (err) {
        console.error('[Apple] ', err?.message);
        return res.status(500).json({ error: 'No se pudo generar el .pkpass' });
    }
}


module.exports = { addToGoogleWallet, addToAppleWallet };
