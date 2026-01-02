// processes/walletProcess.js
const carddetailsProcess = require('./carddetailsProcess');
const businessesProcess = require('./businessProcess');

// Apple Wallet
const { createPkPassBuffer } = require('../services/appleWalletService');

// Google Wallet - imports completos
const { 
  buildAddToGoogleWalletURL, 
  createOrUpdateLoyaltyObject,
  ensureLoyaltyClass, 
  getSA, 
  normalizeGWBarcodeType, 
  isHttps, 
  classIdForBusiness,
  generateCardDetailId, // Auto-generación de IDs
  DesignVariants 
} = require('../services/googleWalletService');

const { saveBufferAsPublicPNG } = require('../services/imageStorageService');

const issuerId = process.env.GOOGLE_ISSUER_ID;
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/* ====================== HELPERS PARA BUFFERS ====================== */
function toBufferMaybe(x) {
  if (!x) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (typeof x === 'object' && x.type === 'Buffer' && Array.isArray(x.data)) {
    return Buffer.from(x.data);
  }
  return null;
}

function firstOrNull(x) {
  return Array.isArray(x) ? (x[0] || null) : x || null;
}

function pickAnyBuffer(obj, keys = []) {
  const o = firstOrNull(obj);
  if (!o || typeof o !== 'object') return null;

  for (const k of keys) {
    const b = toBufferMaybe(o[k]);
    if (b) return b;
  }
  for (const [, v] of Object.entries(o)) {
    const b = toBufferMaybe(v);
    if (b) return b;
  }
  return null;
}

/* ====================== LOAD BRAND ASSETS ====================== */
async function loadBrandAssets(businessId) {
  const cdRes  = await carddetailsProcess.getActiveCardByBusiness(businessId);
  const bizRes = await businessesProcess.getOneBusiness(businessId);

  const cd  = firstOrNull(cdRes);
  const biz = firstOrNull(bizRes);

  // Logo
  const logoBuffer =
    pickAnyBuffer(cd,  ['logoBuffer','logo','logo_image','image','logo_png']) ||
    pickAnyBuffer(biz, ['logo','logoBuffer','image','logo_png']) || null;

  // Strips ON/OFF
  const stripOnBuffer =
    pickAnyBuffer(cd,  ['strip_on','stripOn','strip_on_image','stripOnImage','strip_on_buffer','stripOnBuffer','stamp_on','stampOn']) ||
    pickAnyBuffer(biz, ['strip_image_on']) ||
    pickAnyBuffer(biz, ['strip_on','stripOn','strip_on_image','stripOnImage','strip_on_buffer','stripOnBuffer','stamp_on','stampOn']) ||
    null;

  const stripOffBuffer =
    pickAnyBuffer(cd,  ['strip_off','stripOff','strip_off_image','stripOffImage','strip_off_buffer','stripOffBuffer','stamp_off','stampOff']) ||
    pickAnyBuffer(biz, ['strip_image_off']) ||
    pickAnyBuffer(biz, ['strip_off','stripOff','strip_off_image','stripOffImage','strip_off_buffer','stripOffBuffer','stamp_off','stampOff']) ||
    null;

  // Strip genérico (retrocompatibilidad)
  const stripBuffer =
    pickAnyBuffer(cd,  ['strip_imageBuffer','stripBuffer','strip','strip_image','strip_png']) ||
    pickAnyBuffer(biz, ['strip_imageBuffer','stripBuffer','strip','strip_image','strip_png']) ||
    null;

  // Parsear design_json
  let designJson = {};
  if (cd?.design_json) {
    if (typeof cd.design_json === 'string') {
      try {
        designJson = JSON.parse(cd.design_json);
      } catch (e) {
        console.warn('[Load Brand Assets] Error parseando design_json:', e.message);
      }
    } else if (typeof cd.design_json === 'object') {
      designJson = cd.design_json;
    }
  }
  
  // Colores/nombre - prioridad: design_json > campos directos
  const programName =
    designJson.programName ||
    (cd && (cd.program_name || cd.programName)) ||
    (biz && biz.name) || 'Loyalty';

  const bg = 
    designJson.colors?.background ||
    (cd && (cd.background_color || cd.bg || cd.backgroundColor)) ||
    (biz && (biz.background_color || biz.bg || biz.backgroundColor)) ||
    '#2d3436';

  const fg = 
    designJson.colors?.foreground ||
    (cd && (cd.foreground_color || cd.fg || cd.foregroundColor)) ||
    (biz && (biz.foreground_color || biz.fg || biz.foregroundColor)) ||
    '#E6E6E6';

  return { 
    logoBuffer, 
    stripOnBuffer, 
    stripOffBuffer, 
    stripBuffer, 
    programName, 
    bg, 
    fg,
    designJson,
    stripImageOn: stripOnBuffer,
    stripImageOff: stripOffBuffer
  };
}

/* ====================== APPLE WALLET ====================== */
async function issueAppleWalletPkpass(dto) {
  const { businessId } = dto;
  const { 
    logoBuffer, 
    stripBuffer, 
    stripOnBuffer, 
    stripOffBuffer, 
    programName: pn, 
    bg, 
    fg 
  } = await loadBrandAssets(businessId);

  const assets = { ...dto.assets };
  if (!assets.logo  && logoBuffer)  assets.logo  = logoBuffer;
  if (!assets.strip && stripBuffer) assets.strip = stripBuffer;

  if (stripOnBuffer && stripOffBuffer) {
    assets.stripOn = stripOnBuffer;
    assets.stripOff = stripOffBuffer;
  }

  const colors = dto.colors || { background: bg, foreground: fg };

  const effectivePoints =
    dto.points ?? 
    findPointsInFields(dto.fields) ?? 
    0;

  return await createPkPassBuffer({
    ...dto,
    programName: dto.programName || pn,
    points: effectivePoints,
    colors,
    assets
  });
}

function findPointsInFields(fields) {
  if (!fields || typeof fields !== 'object') return null;
  
  const searchIn = (arr) => {
    if (!Array.isArray(arr)) return null;
    const pf = arr.find(f => f && (f.key === 'points' || f.key === 'POINTS'));
    return pf ? parseInt(pf.value, 10) : null;
  };

  return searchIn(fields.primary) ?? 
         searchIn(fields.secondary) ?? 
         searchIn(fields.auxiliary) ?? 
         null;
}

/* ====================== SANITY LOG ====================== */
function sanityLog() {
  try {
    const s = getSA();
  } catch (e) {
    console.log('[Wallet sanity] No se pudo cargar SA:', e?.message || e);
  }
}

/* ====================== GOOGLE WALLET - COMPLETO ====================== */

/**
 * Crear/actualizar objeto de Google Wallet usando REST API
 * Método principal con auto-generación de card_detail_id
 */
async function createGoogleWalletObject({
  cardCode,
  userName,
  programName,
  businessId,
  card_detail_id, // Opcional - se auto-genera si no existe
  colors = {},
  assets = {},
  barcode = {},
  modules = {},
  points,
  variant,
  tier,
  since,
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  sanityLog();

  console.log('[createGoogleWalletObject] Iniciando:', {
    cardCode,
    businessId,
    variant,
    has_card_detail_id: !!card_detail_id
  });

  // 1) Cargar branding desde BD
  const { 
    logoBuffer, 
    stripOnBuffer,      
    stripOffBuffer,     
    programName: pn, 
    bg, 
    fg,
    designJson          
  } = await loadBrandAssets(businessId);

  // 2) Assets/colores efectivos (request > BD > defaults)
  const logoBuf = assets.logo || logoBuffer || null; 
  const hexBg = colors?.background || bg || '#2d3436';
  const hexFg = colors?.foreground || fg || '#E6E6E6';
  const effProg = programName || pn || 'Loyalty';

  console.log('[createGoogleWalletObject] Colores determinados:', {
    background: hexBg,
    foreground: hexFg,
    programName: effProg
  });

  // 3) Subir logo a HTTPS
  let logoUri = null;
  if (logoBuf) {
    const url = await saveBufferAsPublicPNG({ 
      businessId, 
      kind: 'logo', 
      buffer: logoBuf 
    });
    if (isHttps(url)) logoUri = url;
  }

  if (!logoUri) {
    const fb = process.env.GOOGLE_WALLET_FALLBACK_LOGO_HTTPS;
    if (fb && isHttps(fb)) logoUri = fb;
  }

  // 4) Asegurar clase con AUTO-GENERACIÓN de card_detail_id
  const classResult = await ensureLoyaltyClass({
    businessId,
    card_detail_id, // Puede ser null
    programName: effProg,
    hexBackgroundColor: hexBg,
    hexForegroundColor: hexFg,
    logoUri,
    autoGenerateId: true // AUTO-GENERAR si no existe
  });

  const effectiveCardDetailId = classResult.card_detail_id;

  console.log('[createGoogleWalletObject] Clase asegurada:', {
    classId: classResult.classId,
    card_detail_id: effectiveCardDetailId,
    existed: classResult.existed
  });

  // 5) Normalizar variante
  const normalizedVariant = (variant || '').toLowerCase().trim() || 'points';

  // 6) Barcode
  const barcodeType = normalizeGWBarcodeType(
    barcode.pref || barcode.type || barcode.format || 'qr'
  );
  const barcodeValue = barcode.message || barcode.value || cardCode;

  // 7) Crear/actualizar objeto con REST API
  const result = await createOrUpdateLoyaltyObject({
    cardCode,
    businessId,
    card_detail_id: effectiveCardDetailId,
    userName,
    programName: effProg,
    points,
    barcode: {
      type: barcodeType,
      value: barcodeValue,
      alternateText: barcode.altText || barcode.alternateText || cardCode
    },
    modules,
    variant: normalizedVariant,
    tier,
    since,
    strips_collected,
    strips_required,
    reward_title,
    isComplete,
    hexBackgroundColor: hexBg,
    hexForegroundColor: hexFg,
    stripImageOn: designJson?.assets?.disableStrip ? null : stripOnBuffer,
    stripImageOff: designJson?.assets?.disableStrip ? null : stripOffBuffer
  });

  console.log('[createGoogleWalletObject] Completado:', {
    objectId: result.objectId,
    card_detail_id: effectiveCardDetailId
  });

  return {
    ...result,
    card_detail_id: effectiveCardDetailId
  };
}

/**
 * Wrapper unificado para Google Wallet
 */
async function issueGoogleWallet(dto) {
  const useRestApi = dto.useRestApi !== false;
  
  if (useRestApi) {
    const result = await createGoogleWalletObject(dto);
    const { getAddToWalletUrl } = require('../services/googleWalletService');
    const url = getAddToWalletUrl(result.objectId);
    
    return {
      url,
      objectId: result.objectId,
      card_detail_id: result.card_detail_id,
      existed: result.existed,
      method: 'rest_api'
    };
  } else {
    const url = await issueGoogleWalletLink(dto);
    return {
      url,
      method: 'jwt_legacy'
    };
  }
}

/**
 * Método Legacy JWT (retrocompatibilidad)
 */
async function issueGoogleWalletLink({
  cardCode, 
  userName, 
  programName, 
  businessId,
  card_detail_id,
  colors = {}, 
  assets = {}, 
  fields = {}, 
  barcode = {},
  variant,
  tier,
  since,
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  sanityLog();

  const { logoBuffer, programName: pn, bg, fg } = await loadBrandAssets(businessId);

  const logoBuf = assets.logo || logoBuffer || null;
  const hexBg   = (colors.background || bg || '#2d3436').toString().trim();
  const hexFg   = (colors.foreground || fg || '#E6E6E6').toString().trim();
  const effProg = programName || pn || 'Loyalty';

  let logoUri = null;
  if (logoBuf) {
    const url = await saveBufferAsPublicPNG({ 
      businessId, 
      kind: 'logo', 
      buffer: logoBuf 
    });
    if (isHttps(url)) logoUri = url;
  }

  if (!logoUri) {
    const fb = process.env.GOOGLE_WALLET_FALLBACK_LOGO_HTTPS;
    if (fb && isHttps(fb)) logoUri = fb;
  }

  // Auto-generar card_detail_id si no existe
  const classResult = await ensureLoyaltyClass({
    businessId,
    card_detail_id,
    programName: effProg,
    hexBackgroundColor: hexBg,
    hexForegroundColor: hexFg,
    logoUri,
    autoGenerateId: true
  });

  const type = normalizeGWBarcodeType(
    barcode.pref || barcode.type || barcode.format
  );
  const value = (barcode.message ?? cardCode) + '';
  const alternateText = barcode.altText ?? undefined;

  return buildAddToGoogleWalletURL({
    cardCode,
    userName,
    businessId,
    card_detail_id: classResult.card_detail_id,
    brand: { programName: effProg, bg: hexBg, logoUri },
    barcode: { type, value, alternateText },
    variant,
    tier,
    since,
    strips_collected,
    strips_required,
    reward_title,
    isComplete,
    modules: fields.textModulesData ? { textModulesData: fields.textModulesData } : {}
  });
}

/* ====================== EXPORTS ====================== */
module.exports = { 
  // Apple Wallet
  issueAppleWalletPkpass,
  
  // Google Wallet
  issueGoogleWalletLink,      // JWT legacy
  createGoogleWalletObject,   // REST API directo
  issueGoogleWallet,          // Wrapper unificado (recomendado)
  
  // Helpers
  loadBrandAssets,
  sanityLog
};