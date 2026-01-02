// scripts/debugGoogleObject.js
require('dotenv').config();

const { getAccessToken } = require('../src/services/googleWalletService');

const objectId = '3388000000022866199.cc5bae98-a4a3-4208-b6c5-e16e10949d35';

async function debug() {
  try {
    const token = await getAccessToken();
    const BASE_URL = 'https://walletobjects.googleapis.com/walletobjects/v1';
    
    console.log(' Inspeccionando:', objectId);
    
    const resp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!resp.ok) {
      console.error(' Error:', resp.status, await resp.text());
      return;
    }
    
    const obj = await resp.json();
    
    console.log('\n OBJETO:');
    console.log(JSON.stringify(obj, null, 2));
    
    console.log('\n LOYALTY POINTS:');
    console.log(obj.loyaltyPoints);
    
    console.log('\n TEXT MODULES:');
    obj.textModulesData?.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.header}: ${m.body}`);
    });
    
    console.log('\n  IMAGE MODULES:');
    console.log(obj.imageModulesData?.[0]?.mainImage?.sourceUri?.uri || 'None');
    
    // GET clase
    const classResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(obj.classId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (classResp.ok) {
      const cls = await classResp.json();
      console.log('\n CLASE:');
      console.log('Review Status:', cls.reviewStatus);
      console.log('Program Name:', cls.programName);
      console.log('Background:', cls.hexBackgroundColor);
      console.log('Font Color:', cls.hexFontColor);
    }
    
  } catch (err) {
    console.error('', err.message);
  }
}

debug().then(() => process.exit(0));