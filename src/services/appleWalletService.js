// services/appleWalletService.js
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
let sharp = null;
try { sharp = require('sharp'); } catch (_) {}


// Procesar la imagen 
function isPNG(buf) {
  return Buffer.isBuffer(buf)
    && buf.length > 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

async function toPNG(buffer) {
  if (!buffer) return null;
  if (isPNG(buffer)) return buffer;
  if (!sharp) {
    console.warn('[Apple] Logo no es PNG y "sharp" no está instalado: se intentará igual (puede que Apple lo ignore).');
    return buffer;
  }
  return await sharp(buffer).png().toBuffer();
}

// acondiciona los tamaños para las
async function writeLogoSet(modelDir, buffer) {
  if (!buffer) return;
  const png = await toPNG(buffer);
  if (!sharp) {
    await fsp.writeFile(path.join(modelDir, 'logo.png'), png);
    return;
  }
  const logo1x = await sharp(png).resize({ width: 160, height: 50, fit: 'inside' }).png().toBuffer();
  const logo2x = await sharp(png).resize({ width: 320, height: 100, fit: 'inside' }).png().toBuffer();
  await fsp.writeFile(path.join(modelDir, 'logo.png'), logo1x);
  await fsp.writeFile(path.join(modelDir, 'logo@2x.png'), logo2x);
  await fsp.writeFile(path.join(modelDir, 'thumbnail.png'), logo1x);
}

async function writeStrip(modelDir, buffer) {
  if (!buffer) return;
  const png = await toPNG(buffer);
  if (!sharp) {
    await fsp.writeFile(path.join(modelDir, 'strip.png'), png);
    return;
  }
  const s1 = await sharp(png).resize({ width: 320, height: 123, fit: 'inside' }).png().toBuffer();
  const s2 = await sharp(png).resize({ width: 640, height: 246, fit: 'inside' }).png().toBuffer();
  await fsp.writeFile(path.join(modelDir, 'strip.png'), s1);
  await fsp.writeFile(path.join(modelDir, 'strip@2x.png'), s2);
}

async function buildTempModel(baseDir, assets = {}) {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'pass-'));
  const modelDir = `${tmpBase}.pass`;
  await fsp.mkdir(modelDir, { recursive: true });
  await fsp.cp(baseDir, modelDir, { recursive: true });

  if (assets.logo)  await writeLogoSet(modelDir, assets.logo);
  if (assets.strip) await writeStrip(modelDir, assets.strip);
  if (!assets.strip && assets.logo) await writeStrip(modelDir, assets.logo); // plan B

  console.log('[Apple Model] wrote', {
    modelDir, wroteLogo: !!assets.logo, wroteStrip: !!assets.strip || !!assets.logo
  });
  return modelDir;
}

// Espacio para evitar que se sature la memoria
async function rmrf(p) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch (_) {
    return; 
  }
}


async function loadPasskit() {
  try { const m = await import('passkit-generator'); return m.default ? { ...m, ...m.default } : m; }
  catch(_) {}
  const m = require('passkit-generator');
  return m.default ? { ...m, ...m.default } : m;
}

function cleanPem(raw) {
  let s = raw.toString('utf8').replace(/^\uFEFF/, '').trim();
  s = s.replace(/^"(.*)"$/s, '$1').replace(/\r\n/g, '\n');
  if (!s.endsWith('\n')) s += '\n';
  return s;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `rgb(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)})` : null;
}


// método para pasarse por los huevos el modelo >:c
async function overridePassJson(modelDir, payload) {
  const passJsonPath = path.join(modelDir, 'pass.json');
  const original = JSON.parse(await fsp.readFile(passJsonPath, 'utf8'));

  // merge con prioridad al payload (y reemplazo total de arrays)
  const merged = { ...original };

  // escalares
  if (payload.serialNumber)        merged.serialNumber        = payload.serialNumber;
  if (payload.description)         merged.description         = payload.description;
  if (payload.organizationName)    merged.organizationName    = payload.organizationName;
  if (payload.teamIdentifier)      merged.teamIdentifier      = payload.teamIdentifier;
  if (payload.passTypeIdentifier)  merged.passTypeIdentifier  = payload.passTypeIdentifier;
  if (payload.logoText !== undefined) merged.logoText         = payload.logoText;

  if (payload.backgroundColor) merged.backgroundColor = payload.backgroundColor;
  if (payload.foregroundColor) merged.foregroundColor = payload.foregroundColor;

  // barcode 
  if (payload.barcodes) merged.barcodes = payload.barcodes;
  if (payload.barcode)  merged.barcode  = payload.barcode;


  // storeCard (reemplazar arrays completos si vienen)
  if (payload.storeCard) {
    merged.storeCard = merged.storeCard || {};
    const sc = payload.storeCard;
    if (sc.headerFields)     merged.storeCard.headerFields     = sc.headerFields;
    if (sc.primaryFields)    merged.storeCard.primaryFields    = sc.primaryFields;
    if (sc.secondaryFields)  merged.storeCard.secondaryFields  = sc.secondaryFields;
    if (sc.auxiliaryFields)  merged.storeCard.auxiliaryFields  = sc.auxiliaryFields;
    if (sc.backFields)       merged.storeCard.backFields       = sc.backFields;
  }

  await fsp.writeFile(passJsonPath, JSON.stringify(merged, null, 2), 'utf8');
}


// Selección de qr, codigo de barras, codigo aztec, pd
function normalizeBarcodePref(pref) {
  if (!pref) return null;
  const p = String(pref).toLowerCase();
  if (p === 'qr' || p === 'qrcode') return 'PKBarcodeFormatQR';
  if (p === 'code128' || p === 'code-128' || p === 'c128' || p === 'barcode')
    return 'PKBarcodeFormatCode128';
  if (p === 'pdf417' || p === 'pdf') return 'PKBarcodeFormatPDF417';
  if (p === 'aztec') return 'PKBarcodeFormatAztec';
  return null;
}

// ---------------------- Marcador grandote para localizarlo desde lejos ---------------------------------------------------------------->
// ---------------------- Marcador grandote para localizarlo desde lejos ---------------------------------------------------------------->
// ---------------------- Marcador grandote para localizarlo desde lejos ---------------------------------------------------------------->
// ---------------------- Marcador grandote para localizarlo desde lejos ---------------------------------------------------------------->
// Crear la tarjeta 
async function createPkPassBuffer({
    cardCode, userName, programName, organizationName,
    backgroundColor, foregroundColor,
    colors = {}, fields = {}, barcode = {}, assets = {}, points, 
    appleAuthToken, webServiceBase
  }) {
  if (!cardCode) throw new Error('cardCode requerido.');
  if (!process.env.PASS_TYPE_IDENTIFIER || !process.env.APPLE_TEAM_ID) {
    throw new Error('PassKit no configurado (env).');
  }

  // 1) Cargar y validar certs
  const CERTS_DIR = process.env.PASS_CERTS_DIR || path.join(process.cwd(), 'certs');
  const wwdrPem = cleanPem(fs.readFileSync(path.join(CERTS_DIR, 'WWDR.pem')));
  const certPem = cleanPem(fs.readFileSync(path.join(CERTS_DIR, 'pass-cert.pem')));
  const keyPem  = cleanPem(fs.readFileSync(path.join(CERTS_DIR, 'pass-key.pem')));
  const passphrase = process.env.PASS_CERT_PASSPHRASE || '';
  const baseOrg = (typeof organizationName === 'string' && organizationName.length)
    ? organizationName
    : (process.env.ORG_NAME || 'Tu Empresa');

  try { crypto.createPublicKey(wwdrPem); }       catch (e) { throw new Error(`WWDR.pem inválido: ${e.message}`); }
  try { crypto.createPublicKey(certPem); }       catch (e) { throw new Error(`pass-cert.pem inválido: ${e.message}`); }
  try { crypto.createPrivateKey({ key: keyPem, passphrase }); }
  catch (e) { throw new Error(`pass-key.pem inválido: ${e.message}`); }

  // 2) Clonar modelo y override de imágenes
  const PASS_MODEL_DIR = process.env.PASS_MODEL_DIR || path.join(process.cwd(), 'passModels', 'loyalty.pass');
  const modelDir = await buildTempModel(PASS_MODEL_DIR, assets);
  function rmIfExists(p) { try { fs.unlinkSync(p); } catch {} }

  if (assets.strip === null) {
    const STRIP_FILES = [
      'strip.png','strip@2x.png','strip@3x.png',
      'strip.jpg','strip@2x.jpg','strip@3x.jpg'
    ];
    for (const f of STRIP_FILES) rmIfExists(path.join(modelDir, f));
  }


  // 3) Construir payload
  const bg = colors.background ? (hexToRgb(colors.background) || colors.background)
                               : (hexToRgb(backgroundColor) || backgroundColor || 'rgb(45,52,54)');
  const fg = colors.foreground ? (hexToRgb(colors.foreground) || colors.foreground)
                               : (hexToRgb(foregroundColor) || foregroundColor || 'rgb(230,230,230)');
  const lc = colors.label ? (hexToRgb(colors.label) || colors.label) : undefined;

  // Si llega "points" directo, forzamos/inyectamos en fields.primary
  if (points != null) {
    const v = String(points);
    fields = { ...fields, primary: Array.isArray(fields.primary) ? [...fields.primary] : [] };
    const i = fields.primary.findIndex(f => f?.key === 'points');
    if (i === -1) fields.primary.unshift({ key: 'points', label: 'POINTS', value: v, textAlignment: 'PKTextAlignmentCenter' });
    else fields.primary[i] = { ...fields.primary[i], value: v };
  }

  const primaryFields   = fields.primary   ?? [{ key: 'points', label: 'POINTS', value: '0', textAlignment: 'PKTextAlignmentCenter' }];
  const secondaryFields = fields.secondary ?? [{ key: 'member', label: 'MEMBER', value: userName || 'Member' }];
  const backFields      = fields.back ?? [];

  // formato de codigo qr 
  const msg = String(barcode?.message ?? cardCode);
  const messageEncoding = barcode?.encoding || 'iso-8859-1';
  const altText = barcode?.altText ?? msg;

  const baseRaw = webServiceBase || process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  if (!baseRaw) {
    throw new Error('Base pública no configurada (PUBLIC_BASE_URL o WALLET_BASE_URL).');
  }
  const base = baseRaw.replace(/\/+$/, ''); // quita / repetidos del final
  if (!appleAuthToken) {
    throw new Error('appleAuthToken requerido para authenticationToken.');
  }

  // Acepta 1 formato (format/type/pref) o varios (formats[])
  let formatsRaw = [];
  if (Array.isArray(barcode?.formats) && barcode.formats.length) {
    formatsRaw = barcode.formats;
  } else if (barcode?.pref || barcode?.type || barcode?.format) {
    formatsRaw = [barcode.pref || barcode.type || barcode.format];
  } else {
    formatsRaw = ['qr']; // default
  }

  const barcodesArr = formatsRaw.map(f => ({
    message: msg,
    format: normalizeBarcodePref(f) || 'PKBarcodeFormatQR',
    messageEncoding,
    altText
  }));

  // Evitar que se quede vació, predeterminadamente queda un qr
  if (!barcodesArr.length) {
    barcodesArr.push({
      message: msg,
      format: 'PKBarcodeFormatQR',
      messageEncoding,
      altText
    });
  }

  const hideName = !programName || String(programName).trim() === '';
  const payload = {
    formatVersion: 1,
    passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
    serialNumber: cardCode,
    teamIdentifier: process.env.APPLE_TEAM_ID,

    webServiceURL:  `${base}/api/v1/wallets`,
    authenticationToken:  appleAuthToken,

    organizationName: hideName ? '\u00A0' : (organizationName || process.env.ORG_NAME || 'Tu Empresa'),
    description: hideName ? ' ' : `${programName || 'Loyalty'} Card`,
    ...(hideName ? {} : { logoText: programName }),   // <-- deja solo esto

    foregroundColor: fg,
    backgroundColor: bg,
    labelColor: lc,

    storeCard: {
      headerFields: [],
      primaryFields,
      secondaryFields,
      auxiliaryFields: [],
      backFields,
      additionalInfoFields: []
    },

    barcodes: barcodesArr,
    barcode: barcodesArr[0]
  };


  // 4) Forzar pass.json
  await overridePassJson(modelDir, payload);

  // 5) Generar el pase
  const passkit = await loadPasskit();
  const opts = {
    model: modelDir,
    certificates: {
      wwdr: wwdrPem,
      signerCert: certPem,
      signerKey: keyPem,
      signerKeyPassphrase: passphrase || undefined,
    },
  };

  try {
    let pass;
    if (typeof passkit.createPass === 'function')         pass = await passkit.createPass(opts, payload);
    else if (passkit.PKPass?.from)                        pass = await passkit.PKPass.from(opts, payload);
    else if (passkit.Pass?.from)                          pass = await passkit.Pass.from(opts, payload);
    else if (passkit.Pass)                                pass = new passkit.Pass(opts, payload);
    else throw new Error('[PassKit] API no reconocida.');

    if (typeof pass.asBuffer === 'function') return pass.asBuffer();
    if (typeof pass.getAsBuffer === 'function') return pass.getAsBuffer();
    if (typeof pass.getAsStream === 'function') {
      const stream = pass.getAsStream();
      const chunks = [];
      await new Promise((resolve, reject) => {
        stream.on('data', c => chunks.push(c)).on('error', reject).on('end', resolve);
      });
      return Buffer.concat(chunks);
    }
    throw new Error('[PassKit] No se pudo obtener buffer del pase.');
  } finally {
    rmrf(modelDir);
  }
}

module.exports = { createPkPassBuffer };


/* PLANTILLAS DE CREACIÓN 

Vacio (qr predeterminado)
{
  "businessId": 1,
  "cardCode": "ABC124",
  "userName": "Otro usuario",
  "programName": "Windoe",
  "points": 100
  "colors": {
    "background": "#2d3436",
    "foreground": "#E6E6E6"
  }
}

Forzar Code128
{
  "businessId": 1,
  "cardCode": "ABC124",
  "userName": "Otro usuario",
  "programName": "Windoe",
  "points": 100,
  "colors": {
    "background": "#074f63ff",
    "foreground": "#E6E6E6"
  },
  "barcode": { "format": "code128" }
}

Forzar PDF417
{
  "businessId": 2,
  "cardCode": "ABC125",
  "userName": "Cliente PDF",
  "programName": "Windoe",
  "points": 250,
  "colors": {
    "background": "#2caccfff",
    "foreground": "#ffffffff"
  },
  "barcode": { "type": "pdf417" }
}

Forzar Aztec
{
  "businessId": 3,
  "cardCode": "ABC126",
  "userName": "Cliente Aztec",
  "programName": "Windoe",
  "points": 500,
  "colors": {
    "background": "#2d3436",
    "foreground": "#E6E6E6"
  },
  "barcode": { "pref": "aztec" }
}


Enviar varios (p. ej. QR + PDF417)
{
  "businessId": 1,
  "cardCode": "ABC127",
  "userName": "Cliente Multi",
  "programName": "Windoe",
  "points": 900,
  "colors": {
    "background": "#393f41ff",
    "foreground": "#E6E6E6"
  },
  "barcode": {
    "message": "ABC127",
    "formats": ["qr", "pdf417"],
    "altText": "ABC127",
    "encoding": "iso-8859-1"
  }
}

*/