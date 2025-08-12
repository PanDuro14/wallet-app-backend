const fs = require('fs'); 
const path = require('path');
const jwt = require('jsonwebtoken'); 

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), 'service-account.json');
const issuerId = process.env.GOOGLE_ISSUER_ID;
const loyaltyClassId = process.env.GOOGLE_LOYALTY_CLASS_ID;
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'https://tu-frontend.com').split(',');

let serviceAccount = null; 
const getServiceAccount = async() => {
    if(!serviceAccount){
        serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH), 'utf8'); 
    }
    return serviceAccount; 
}


const buildAddToGoogleWalletURL = async ({ cardCode, userName, programName }) => {
    if(!issuerId || !loyaltyClassId ) throw new Error('Google wallet no configurada'); 
    if(!cardCode) throw new Error('cardCode requerido'); 

    const sa = getServiceAccount(); 

    const claims = {
        iss: sa.client_email,
        aud: 'google',
        typ: 'savetowallet',
        origins,
        payload: {
        loyaltyObjects: [{
            id: `${issuerId}.${cardCode}`,
            classId: loyaltyClassId,
            state: 'active',
            accountId: cardCode,
            accountName: userName || cardCode,
            programName: programName || 'Loyalty',
            barcode: { type: 'qrCode', value: cardCode }
            }]
        }
    }; 

    const token = jwt.sign(claims, sa.private_key, {algorithm: 'RS256', keyid: sa.private_key_id}); 
    return `https://pay.google.com/gp/v/save/${encodeURIComponent(token)}`;
}


module.exports = { buildAddToGoogleWalletURL };