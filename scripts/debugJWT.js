// scripts/debugJWT.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { getSA } = require('../src/services/googleWalletService');

const objectId = '3388000000022866199.cc5bae98-a4a3-4208-b6c5-e16e10949d35';

async function debugJWT() {
  try {
    // Obtener credenciales usando tu función
    const credentials = getSA();
    
    console.log(' Cliente:', credentials.client_email);
    console.log(' Project ID:', credentials.project_id);
    
    //  IMPORTANTE: ¿Desde dónde abres el link?
    // Cambia esto según tu caso:
    const origins = ['https://wallet-app-backend.fly.dev']; 
    // Si lo abres desde localhost: ['http://localhost:4200']
    // Si lo abres desde otro dominio: ['https://tu-dominio.com']
    
    console.log(' Origins configurado:', origins);
    
    // Payload que Google espera
    const payload = {
      iss: credentials.client_email,
      aud: 'google',
      origins: origins,
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        loyaltyObjects: [{
          id: objectId
        }]
      }
    };
    
    console.log('\n PAYLOAD DEL JWT:');
    console.log(JSON.stringify(payload, null, 2));
    
    // Genera el JWT
    const token = jwt.sign(payload, credentials.private_key, {
      algorithm: 'RS256',
      keyid: credentials.private_key_id
    });
    
    console.log('\n JWT (primeros 150 chars):');
    console.log(token.substring(0, 150) + '...');
    
    console.log('\n URL COMPLETA:');
    const url = `https://pay.google.com/gp/v/save/${token}`;
    console.log(url);
    
    console.log('\n\n PREGUNTA CRÍTICA:');
    console.log('===============================================');
    console.log('¿Desde DÓNDE estás abriendo este link?');
    console.log('  1. Navegador directo (pegas la URL)');
    console.log('  2. Desde localhost:4200');
    console.log('  3. Desde wallet-app-backend.fly.dev');
    console.log('  4. Desde otro dominio/app');
    console.log('===============================================');
    console.log('\n  El origin DEBE COINCIDIR con donde lo abres');
    console.log('Si es directo en navegador, usa: ["https://pay.google.com"]');
    console.log('Si es desde tu app Angular: usa el dominio de Angular');
    
  } catch (err) {
    console.error(' Error:', err.message);
    console.error(err.stack);
  }
}

debugJWT();