// src/processes/walletProcess.js
const carddetailsProcess = require('./carddetailsProcess'); 
const { buildAddToGoogleWalletURL } = require('../services/googleWalletService');
const { createPkPassBuffer } = require('../services/appleWalletService');

async function issueGoogleWalletLink({ cardCode, userName, programName, businessId }) {
  const cd = await carddetailsProcess.getOneCardByBusiness(businessId);
  const brand = {
    programName: programName || cd?.program_name || 'Loyalty',
    bg: cd?.background_color || '#FFFFFF',
    fg: cd?.foreground_color || '#000000',
    logoUri: cd?.logo_url || null
  };
  return buildAddToGoogleWalletURL({ cardCode, userName, brand, businessId });
}

async function issueAppleWalletPkpass({ cardCode, userName, programName, businessId }) {
  const cd = await carddetailsProcess.getOneCardByBusiness(businessId);
  const backgroundColor = cd?.background_color || 'rgb(255,255,255)';
  const foregroundColor = cd?.foreground_color || 'rgb(0,0,0)';
  const program = programName || cd?.program_name || 'Loyalty';

  return await createPkPassBuffer({
    cardCode,
    userName,
    programName: program,
    backgroundColor,
    foregroundColor
  });
}

module.exports = { issueGoogleWalletLink, issueAppleWalletPkpass };
