// scripts/test-file.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

(async () => {
  const raw = fs.readFileSync('C:\Users\Jesus\OneDrive\Documentos\Github\wallet-app-backend\certs/walletprueba-fa8184d931a8.json', 'utf8'); // <- la ruta que creaste
  const sa = JSON.parse(raw); // aquí NO uses .replace(/\\n/g, '\n') porque viene de archivo real
  console.log('[SA-file]', { client_email: sa.client_email, private_key_id: sa.private_key_id, project_id: sa.project_id });

  const auth = new GoogleAuth({
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log('Access token OK?', !!token);
})().catch(e => console.error('SelfTest FILE FAILED:', e.response?.data || e));
