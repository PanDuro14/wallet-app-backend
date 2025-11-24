// processes/walletProcess.js
const carddetailsProcess = require('./carddetailsProcess');
const businessesProcess = require('./businessProcess');

// Apple Wallet
const { createPkPassBuffer } = require('../services/appleWalletService');

// Google Wallet - imports actualizados
const { 
  buildAddToGoogleWalletURL, 
  createOrUpdateLoyaltyObject,
  ensureLoyaltyClass, 
  getSA, 
  normalizeGWBarcodeType, 
  isHttps, 
  classIdForBusiness,
  DesignVariants 
} = require('../services/googleWalletService');

const { saveBufferAsPublicPNG } = require('../services/imageStorageService');

// Configuración
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

  // 1) claves conocidas
  for (const k of keys) {
    const b = toBufferMaybe(o[k]);
    if (b) return b;
  }
  // 2) barrido rápido
  for (const [, v] of Object.entries(o)) {
    const b = toBufferMaybe(v);
    if (b) return b;
  }
  return null;
}

/* ====================== LOAD BRAND ASSETS (sin cambios) ====================== */
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

  // ✅ LEER design_json
  let designJson = {};
  if (cd?.design_json) {
    // Si es string, parsearlo; si es objeto, usarlo directo
    if (typeof cd.design_json === 'string') {
      try {
        designJson = JSON.parse(cd.design_json);
      } catch (e) {
        //console.warn('[Load Brand Assets] No se pudo parsear design_json:', e.message);
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

  //console.log('[Load Brand Assets] {', {
  //  businessId,
  //  isBizArray: Array.isArray(bizRes),
  //  isCdArray: Array.isArray(cdRes),
  //  hasLogo: !!logoBuffer,
  //  logoLen: logoBuffer?.length || 0,
  //  hasStripGeneric: !!stripBuffer,
  //  hasStripOn: !!stripOnBuffer,
  //  hasStripOff: !!stripOffBuffer,
  //  stripOnLen: stripOnBuffer?.length || 0,
  //  stripOffLen: stripOffBuffer?.length || 0,
  //  stripGenericLen: stripBuffer?.length || 0,
  //  colors: { bg, fg },
  //  rawDesignJson: cd?.design_json, // ← Ver qué viene de BD
  //  designJson: {
  //    hasDesign: !!cd?.design_json,
  //    programName: designJson.programName,
  //    colors: designJson.colors,
  //    disableStrip: designJson.assets?.disableStrip
  //  }
  //});

  return { 
    logoBuffer, 
    stripOnBuffer, 
    stripOffBuffer, 
    stripBuffer, 
    programName, 
    bg, 
    fg,
    designJson, // ✅ RETORNAR design_json completo
    // Alias para compatibilidad
    stripImageOn: stripOnBuffer,
    stripImageOff: stripOffBuffer
  };
}

/* ====================== APPLE WALLET (sin cambios) ====================== */
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

  // Asignamos stripOnBuffer y stripOffBuffer a los assets
  if (stripOnBuffer && stripOffBuffer) {
    assets.stripOn = stripOnBuffer;
    assets.stripOff = stripOffBuffer;
  } else {
    //console.log('[Apple Wallet] Falta alguna de las imágenes de strip.');
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

// Helper para Apple (mantener compatibilidad)
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

/* ====================== SANITY LOG (sin cambios) ====================== */
function sanityLog() {
  try {
    const s = getSA();
    //console.log('[Wallet sanity]', {
    //  issuerId,
    //  sa_email: s?.client_email,
    //  project_id: s?.project_id,
    //  origins
    //});
  } catch (e) {
    console.log('[Wallet sanity] No se pudo cargar SA:', e?.message || e);
  }
}

/* ====================== GOOGLE WALLET - VERSIÓN MEJORADA ====================== */

/**
 * Crear link JWT de Google Wallet (método legacy)
 * Mantiene compatibilidad con código anterior
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
  // Nuevos parámetros opcionales
  variant,
  tier,
  since,
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  sanityLog();

  // 1) Cargar branding base de BD
  const { logoBuffer, programName: pn, bg } = await loadBrandAssets(businessId);

  // 2) Elegir assets/colores efectivos (request > BD)
  const logoBuf = assets.logo || logoBuffer || null;
  const hexBg   = (colors.background || bg || '#2d3436').toString().trim();
  const effProg = programName || pn || 'Loyalty';

  // 3) Subir logo a URL pública HTTPS (si hay)
  let logoUri = null;
  if (logoBuf) {
    const url = await saveBufferAsPublicPNG({ 
      businessId, 
      kind: 'logo', 
      buffer: logoBuf 
    });
    if (isHttps(url)) logoUri = url;
    else console.warn('[Google Wallet] Ignorando imagen no-HTTPS:', url);
  }

  // Fallback obligatorio
  if (!logoUri) {
    const fb = process.env.GOOGLE_WALLET_FALLBACK_LOGO_HTTPS;
    if (fb && isHttps(fb)) {
      //console.warn('[Google Wallet] Usando fallback HTTPS para programLogo:', fb);
      logoUri = fb;
    } else {
      console.warn('[Google Wallet] No hay logo HTTPS; se intentará sin logo.');
    }
  }

  // 4) Asegurar CLASE
  await ensureLoyaltyClass({
    businessId,
    card_detail_id,
    programName: effProg,
    hexBackgroundColor: hexBg,
    logoUri
  });

  // 5) Código de barras
  const type = normalizeGWBarcodeType(
    barcode.pref || barcode.type || barcode.format
  );
  const value = (barcode.message ?? cardCode) + '';
  const alternateText = barcode.altText ?? undefined;

  // 6) Construir URL JWT (ahora con soporte de variantes)
  return buildAddToGoogleWalletURL({
    cardCode,
    userName,
    businessId,
    card_detail_id,
    brand: { programName: effProg, bg: hexBg, logoUri },
    barcode: { type, value, alternateText },
    // Nuevos parámetros para variantes
    variant,
    tier,
    since,
    strips_collected,
    strips_required,
    reward_title,
    isComplete,
    // Mantener compatibilidad con módulos custom
    modules: fields.textModulesData ? { textModulesData: fields.textModulesData } : {}
  });
}

/**
 * Crear/actualizar objeto de Google Wallet usando REST API
 * Este es el método recomendado (no JWT)
 */
async function createGoogleWalletObject({
  cardCode,
  userName,
  programName,
  businessId,
  card_detail_id,
  colors = {},
  assets = {},
  barcode = {},
  modules = {},
  // Parámetros de negocio
  points,
  variant,
  tier,
  since,
  // Parámetros de strips
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  sanityLog();

  //console.log('[createGoogleWalletObject] Parámetros recibidos:', {
  //  cardCode,
  //  businessId,
  //  variant,
  //  points,
  //  strips_collected,
  //  strips_required,
  //  colors
  //});

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

  //console.log('[createGoogleWalletObject] Colores a usar:', {
  //  background: hexBg,
  //  foreground: hexFg,
  //  source: colors?.background ? 'request' : (bg ? 'database' : 'default'),
  //  disableStrip: designJson?.assets?.disableStrip
  //});

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

  // 4) Asegurar clase con colores
  await ensureLoyaltyClass({
    businessId,
    card_detail_id,
    programName: effProg,
    hexBackgroundColor: hexBg,
    hexForegroundColor: hexFg, // ✅ Pasar color de texto
    logoUri
  });

  //console.log('[createGoogleWalletObject] Clase asegurada con colores:', {
  //  hexBg,
  //  hexFg
  //});

  // 5) Normalizar variante
  const normalizedVariant = (variant || '').toLowerCase().trim() || 'points';

  console.log('[createGoogleWalletObject] Variante normalizada:', normalizedVariant);

  // 6) Barcode
  const barcodeType = normalizeGWBarcodeType(
    barcode.pref || barcode.type || barcode.format || 'qr'
  );
  const barcodeValue = barcode.message || barcode.value || cardCode;

  // 7) Crear/actualizar objeto con REST API - AHORA CON COLORES Y STRIPS
  const result = await createOrUpdateLoyaltyObject({
    cardCode,
    businessId,
    card_detail_id,
    userName,
    programName: effProg,
    points,
    barcode: {
      type: barcodeType,
      value: barcodeValue,
      alternateText: barcode.altText || barcode.alternateText || cardCode
    },
    modules,
    // Parámetros de variante
    variant: normalizedVariant,
    tier,
    since,
    // Parámetros de strips
    strips_collected,
    strips_required,
    reward_title,
    isComplete,
    // ✅ COLORES AGREGADOS
    hexBackgroundColor: hexBg,
    hexForegroundColor: hexFg,
    // ✅ STRIPS IMAGES AGREGADOS (solo si no está deshabilitado)
    stripImageOn: designJson?.assets?.disableStrip ? null : stripOnBuffer,
    stripImageOff: designJson?.assets?.disableStrip ? null : stripOffBuffer
  });

  console.log('[createGoogleWalletObject] Objeto creado/actualizado:', result);

  return result;
}

/**
 * Wrapper unificado para crear tarjeta Google Wallet
 * Decide automáticamente entre JWT (legacy) o REST API
 */
async function issueGoogleWallet(dto) {
  const useRestApi = dto.useRestApi !== false; // Default: usar REST API
  
  if (useRestApi) {
    // Método moderno: crear objeto con REST API
    const result = await createGoogleWalletObject(dto);
    
    // Construir URL directa al objeto
    const { getAddToWalletUrl } = require('../services/googleWalletService');
    const url = getAddToWalletUrl(result.objectId);
    
    return {
      url,
      objectId: result.objectId,
      existed: result.existed,
      method: 'rest_api'
    };
  } else {
    // Método legacy: JWT
    const url = await issueGoogleWalletLink(dto);
    return {
      url,
      method: 'jwt_legacy'
    };
  }
}

/* ====================== EXPORTS ====================== */
module.exports = { 
  // Apple Wallet (sin cambios)
  issueAppleWalletPkpass,
  
  // Google Wallet - múltiples opciones
  issueGoogleWalletLink,      // JWT legacy (retrocompatibilidad)
  createGoogleWalletObject,   // REST API directo
  issueGoogleWallet,          // Wrapper unificado (recomendado)
  
  // Helpers
  loadBrandAssets,
  sanityLog
};