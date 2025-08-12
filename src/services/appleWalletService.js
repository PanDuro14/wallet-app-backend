const path = require('path');
const { createPass } = require('passkit-generator');

const CERTS_DIR = process.env.PASS_CERTS_DIR || path.join(process.cwd(), 'certs');
const PASS_MODEL_DIR = process.env.PASS_MODEL_DIR || path.join(process.cwd(), 'passModels', 'loyalty');
const passTypeIdentifier = process.env.PASS_TYPE_IDENTIFIER;
const teamIdentifier = process.env.APPLE_TEAM_ID;
const organizationName = process.env.ORG_NAME || 'Tu Empresa';


async function createPkPassBuffer({ cardCode, userName, programName }) {
  if (!cardCode) throw new Error('cardCode requerido.');
  if (!passTypeIdentifier || !teamIdentifier) throw new Error('PassKit no configurado (env).');

  const pass = await createPass(
    {
      model: PASS_MODEL_DIR,
      certificates: {
        wwdr: path.join(CERTS_DIR, 'WWDR.pem'),
        signerCert: path.join(CERTS_DIR, 'pass-cert.pem'),
        signerKey: {
          keyFile: path.join(CERTS_DIR, 'pass-key.pem'),
          passphrase: process.env.PASS_CERT_PASSPHRASE || ''
        }
      }
    },
    {
      serialNumber: cardCode,
      description: `${programName || 'Loyalty'} Card`,
      organizationName,
      teamIdentifier,
      passTypeIdentifier,
      formatVersion: 1,
      backgroundColor,          
      foregroundColor,          
      storeCard: {
        primaryFields: [{ key: 'name', label: programName || 'Programa', value: userName || 'Cliente' }],
        secondaryFields: [{ key: 'code', label: 'Cuenta', value: cardCode }]
      },
      barcode: { message: cardCode, format: 'PKBarcodeFormatQR' }
    }
  );

  return await pass.asBuffer();
}

module.exports = { createPkPassBuffer };
