// services/googleWalletService.js
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');
const fetch = globalThis.fetch || ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

// Imports para strips
const { saveBufferAsPublicPNG } = require('./imageStorageService');
const stripsImageService = require('./stripsImageService');

const issuerId = process.env.GOOGLE_ISSUER_ID;
const DEFAULT_ISSUER_NAME = process.env.GOOGLE_ISSUER_NAME || 'Mi Negocio';
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',').map(s => s.trim()).filter(Boolean);

const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';
const BASE_URL = 'https://walletobjects.googleapis.com/walletobjects/v1';

const DesignVariants = { POINTS: 'points', STRIPS: 'strips' };

/* ====================== Helpers Base ====================== */
let sa;
function getSA() {
  if (sa) return sa;
  if (!SA_JSON_BASE64) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');

  const raw = Buffer.from(SA_JSON_BASE64, 'base64').toString('utf8');
  sa = JSON.parse(raw);

  if (typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('Service Account inválida: faltan client_email o private_key');
  }
  return sa;
}

function toHexColor(input) {
  if (!input) return '#FFFFFF';
  const s = String(input).trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return s.startsWith('#') ? s : `#${s}`;
  const m = s.match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!m) return '#FFFFFF';
  const to2 = n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0').toUpperCase();
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

// MEJORADO: Genera card_detail_id único basado en diseño
function generateCardDetailId(designParams) {
  const { 
    hexBackgroundColor, 
    hexForegroundColor, 
    programName,
    variant 
  } = designParams;
  
  const hash = crypto
    .createHash('md5')
    .update(JSON.stringify({
      bg: toHexColor(hexBackgroundColor),
      fg: toHexColor(hexForegroundColor),
      name: programName || '',
      var: variant || 'points'
    }))
    .digest('hex')
    .substring(0, 8);
  
  return `design_${hash}`;
}

function classIdForBusiness(businessId, cardDetailId = null) {
  const biz = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  
  if (cardDetailId) {
    const cd = String(cardDetailId).replace(/[^a-zA-Z0-9_]/g, '_');
    return `${issuerId}.loyalty_biz_${biz}_${cd}`;
  }

  return `${issuerId}.loyalty_biz_${biz}`;
}

function objectIdForCard(cardCode) {
  const suffix = String(cardCode).replace(/[^a-zA-Z0-9_\-]/g, '_');
  return `${issuerId}.${suffix}`;
}

function isHttps(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

function normalizeGWBarcodeType(pref) {
  const p = String(pref || 'qr').toLowerCase();
  if (p === 'qr' || p === 'qrcode') return 'QR_CODE';
  if (p === 'pdf' || p === 'pdf417') return 'PDF_417';
  if (p === 'aztec') return 'AZTEC';
  if (p === 'code128' || p === 'c128' || p === 'barcode') return 'CODE_128';
  return 'QR_CODE';
}

/* ====================== Build Modules by Variant ====================== */
function buildModulesByVariant({
  variant,
  userName,
  programName,
  points = 0,
  tier = 'Bronce',
  since = '',
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  const normalizedVariant = String(variant || 'points').toLowerCase().trim();
  const textModules = [];
  let loyaltyPoints = undefined;

  if (normalizedVariant === DesignVariants.STRIPS) {
    if (strips_collected !== undefined && strips_required !== undefined) {
      textModules.push({
        header: 'Progreso',
        body: `${strips_collected} de ${strips_required} completados`
      });

      loyaltyPoints = {
        label: 'Progreso',
        balance: { string: isComplete ? 'COMPLETADA' : `${strips_collected}/${strips_required}` }
      };

      if (reward_title) {
        textModules.push({
          header: 'Premio',
          body: reward_title
        });
      }

      if (isComplete) {
        textModules.push({
          header: 'Estado',
          body: '¡Colección completa! '
        });
      }

      if (userName) {
        textModules.push({
          header: 'Miembro',
          body: userName
        });
      }
    } else {
      textModules.push({
        header: 'Tarjeta',
        body: 'Sin colección activa'
      });
      
      if (tier) {
        textModules.push({
          header: 'Nivel',
          body: tier
        });
      }
    }
  } else {
    loyaltyPoints = {
      label: 'PUNTOS',
      balance: { string: String(points) }
    };

    if (programName) {
      textModules.push({
        header: programName,
        body: `Cliente: ${userName || 'Sin nombre'}`
      });
    }

    if (tier) {
      textModules.push({
        header: 'NIVEL',
        body: tier
      });
    }

    if (since) {
      textModules.push({
        header: 'MIEMBRO DESDE',
        body: since
      });
    }
  }

  textModules.push({
    header: 'Términos',
    body: 'Válido en sucursales participantes.'
  });

  return {
    textModulesData: textModules,
    loyaltyPoints
  };
}

/* ====================== Auth ====================== */
async function getAccessToken() {
  const s = getSA();
  const auth = new GoogleAuth({
    credentials: { client_email: s.client_email, private_key: s.private_key },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token?.token || token;
}

/* ====================== Clase (Branding) ====================== */
async function ensureLoyaltyClass({
  businessId,
  programName,
  card_detail_id,
  issuerName = DEFAULT_ISSUER_NAME,
  hexBackgroundColor = '#FFFFFF',
  hexForegroundColor,
  logoBuffer,
  autoGenerateId = true // NUEVO: Generar ID automático si no existe
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  
  // Auto-generar card_detail_id si no existe
  if (autoGenerateId && !card_detail_id) {
    card_detail_id = generateCardDetailId({
      hexBackgroundColor,
      hexForegroundColor,
      programName
    });
    console.log('[ensureLoyaltyClass] ID generado automáticamente:', card_detail_id);
  }
  
  const classId = classIdForBusiness(businessId, card_detail_id);
  const accessToken = await getAccessToken();

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const logoUri = `${baseUrl}/api/public/assets/logo/${businessId}`;

  // Verificar si clase existe
  const getResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (getResp.ok) {
    console.log('[ensureLoyaltyClass] Clase existente (reutilizando):', classId);
    return { classId, card_detail_id, existed: true };
  }

  if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyClass falló (${getResp.status}): ${txt}`);
  }

  // Crear nueva clase
  const body = {
    id: classId,
    issuerName,
    programName,
    hexBackgroundColor: toHexColor(hexBackgroundColor),
    reviewStatus: 'UNDER_REVIEW',
    programLogo: { sourceUri: { uri: logoUri } }
  };

  if (hexForegroundColor) {
    body.hexFontColor = toHexColor(hexForegroundColor);
  }

  console.log('[ensureLoyaltyClass] Creando clase nueva:', {
    classId,
    card_detail_id,
    programName,
    hexBackgroundColor: body.hexBackgroundColor,
    hexFontColor: body.hexFontColor || 'default'
  });

  const postResp = await fetch(`${BASE_URL}/loyaltyClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!postResp.ok) {
    if (postResp.status === 409) {
      console.log('[ensureLoyaltyClass] Clase existe (409):', classId);
      return { classId, card_detail_id, existed: true };
    }
    const txt = await postResp.text().catch(() => '');
    throw new Error(`POST loyaltyClass falló (${postResp.status}): ${txt}`);
  }

  console.log('[ensureLoyaltyClass] Clase creada:', classId);
  return { classId, card_detail_id, existed: false };
}

/* ====================== Crear/Actualizar Objeto ====================== */
async function createOrUpdateLoyaltyObject({
  cardCode,
  businessId,
  card_detail_id,
  userName,
  programName,
  points,
  barcode = {},
  modules = {},
  variant,
  tier,
  since,
  strips_collected,
  strips_required,
  reward_title,
  isComplete,
  hexBackgroundColor,
  hexForegroundColor,
  stripImageOn,
  stripImageOff
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');
  
  console.log('[createOrUpdateLoyaltyObject] Iniciando:', {
    cardCode,
    businessId,
    variant,
    card_detail_id
  });

  const classId = classIdForBusiness(businessId, card_detail_id);
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  const normalizedVariant = (variant || 'points').toLowerCase().trim();

  const builtModules = buildModulesByVariant({
    variant: normalizedVariant,
    userName,
    programName,
    points,
    tier,
    since,
    strips_collected,
    strips_required,
    reward_title,
    isComplete
  });

  const loyaltyObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    accountId: cardCode,
    accountName: userName || cardCode,
    barcode: {
      type: normalizeGWBarcodeType(barcode.type || barcode.format || 'qr'),
      value: barcode.value || cardCode,
      alternateText: barcode.alternateText || cardCode
    },
    textModulesData: [
      ...builtModules.textModulesData,
      ...(Array.isArray(modules.textModulesData) ? modules.textModulesData : [])
    ],
    loyaltyPoints: builtModules.loyaltyPoints
  };

  // Generar imagen de strips si aplica
  if (normalizedVariant === 'strips' && strips_required && stripImageOn && stripImageOff) {
    try {
      const onBuf = Buffer.from(stripImageOn, 'base64');
      const offBuf = Buffer.from(stripImageOff, 'base64');

      const stripsImageBuffer = await stripsImageService.generateStripsImage({
        collected: strips_collected || 0,
        total: strips_required,
        stripImageOn: onBuf,
        stripImageOff: offBuf,
        cardWidth: 640
      });

      const { publicUrl } = await saveBufferAsPublicPNG({
        businessId,
        kind: "strip",
        buffer: stripsImageBuffer
      });

      if (publicUrl && isHttps(publicUrl)) {
        loyaltyObject.imageModulesData = [
          {
            id: "strips_progress",
            mainImage: {
              sourceUri: { uri: publicUrl },
              contentDescription: {
                defaultValue: {
                  language: 'es',
                  value: isComplete
                    ? 'Colección completa'
                    : `${strips_collected || 0} de ${strips_required}`
                }
              }
            }
          }
        ];
        console.log('[createOrUpdateLoyaltyObject] Strip image agregada:', publicUrl);
      }
    } catch (err) {
      console.error('[createOrUpdateLoyaltyObject] Error con strip image:', err.message);
    }
  }

  // Verificar si objeto existe
  const getResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  let existed = false;
  if (getResp.ok) {
    existed = true;
  } else if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyObject falló (${getResp.status}): ${txt}`);
  }

  const method = existed ? 'PUT' : 'POST';
  const targetUrl = existed 
    ? `${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`
    : `${BASE_URL}/loyaltyObject`;

  const resp = await fetch(targetUrl, {
    method,
    headers: { 
      Authorization: `Bearer ${accessToken}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(loyaltyObject)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`${method} loyaltyObject falló (${resp.status}): ${txt}`);
  }

  const result = await resp.json();

  console.log('[createOrUpdateLoyaltyObject] Completado:', {
    objectId,
    existed,
    variant: normalizedVariant
  });

  return { 
    objectId, 
    existed,
    data: result
  };
}

/* ====================== Actualizar Puntos ====================== */
async function updateLoyaltyPoints(cardCode, newPoints) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  const patchBody = {
    loyaltyPoints: {
      label: 'PUNTOS',
      balance: { string: String(newPoints) }
    }
  };

  const resp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
    method: 'PATCH',
    headers: { 
      Authorization: `Bearer ${accessToken}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(patchBody)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`PATCH loyaltyObject (points) falló (${resp.status}): ${txt}`);
  }

  console.log('[updateLoyaltyPoints] Actualizado:', { cardCode, newPoints });
  return { ok: true, objectId, points: newPoints };
}

/* ====================== Actualizar Strips + Imagen ====================== */
async function updateLoyaltyStrips({
  cardCode, 
  businessId,
  strips_collected, 
  strips_required, 
  reward_title,
  stripImageOn,
  stripImageOff
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  const isComplete = strips_collected >= strips_required;

  const { textModulesData, loyaltyPoints } = buildModulesByVariant({
    variant: 'strips',
    strips_collected,
    strips_required,
    reward_title,
    isComplete
  });

  const patchBody = {
    loyaltyPoints,
    textModulesData
  };

  // Regenerar imagen de strips si hay buffers
  if (stripImageOn && stripImageOff && strips_required) {
    try {
      const onBuf = Buffer.from(stripImageOn, 'base64');
      const offBuf = Buffer.from(stripImageOff, 'base64');

      const stripsImageBuffer = await stripsImageService.generateStripsImage({
        collected: strips_collected || 0,
        total: strips_required,
        stripImageOn: onBuf,
        stripImageOff: offBuf,
        cardWidth: 640
      });

      const { publicUrl } = await saveBufferAsPublicPNG({
        businessId,
        kind: "strip",
        buffer: stripsImageBuffer
      });

      if (publicUrl && isHttps(publicUrl)) {
        patchBody.imageModulesData = [
          {
            id: "strips_progress",
            mainImage: {
              sourceUri: { uri: publicUrl },
              contentDescription: {
                defaultValue: {
                  language: 'es',
                  value: isComplete
                    ? 'Colección completa'
                    : `${strips_collected} de ${strips_required}`
                }
              }
            }
          }
        ];
      }
    } catch (err) {
      console.error('[updateLoyaltyStrips] Error con strip image:', err.message);
    }
  }

  const resp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
    method: 'PATCH',
    headers: { 
      Authorization: `Bearer ${accessToken}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(patchBody)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`PATCH loyaltyObject (strips) falló (${resp.status}): ${txt}`);
  }

  console.log('[updateLoyaltyStrips] Actualizado:', {
    cardCode,
    collected: strips_collected,
    required: strips_required,
    isComplete
  });

  return { ok: true, objectId, strips_collected, strips_required, isComplete };
}

/* ====================== Reiniciar Colección (Multi-Rewards) ====================== */
async function resetLoyaltyStrips({
  cardCode,
  businessId,
  strips_required,
  reward_title,
  stripImageOn,
  stripImageOff
}) {
  console.log('[resetLoyaltyStrips] Reiniciando colección:', cardCode);
  
  // Resetear a 0/required
  return await updateLoyaltyStrips({
    cardCode,
    businessId,
    strips_collected: 0,
    strips_required,
    reward_title,
    stripImageOn,
    stripImageOff
  });
}

/* ====================== URL "Add to Google Wallet" (JWT) ====================== */
function buildAddToGoogleWalletURL({
  cardCode,
  userName,
  brand = {},
  businessId,
  card_detail_id,
  barcode = {},
  modules = {},
  points = null,
  variant,
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');

  const s = getSA();
  const classId = classIdForBusiness(businessId, card_detail_id);
  const normType = normalizeGWBarcodeType(barcode.type || barcode.format || barcode.pref);

  const finalVariant = (variant || '').toLowerCase().trim() || 'points';

  const builtModules = buildModulesByVariant({
    variant: finalVariant,
    userName,
    programName: brand.programName,
    points,
    strips_collected,
    strips_required,
    reward_title,
    isComplete
  });

  const textModules = [
    ...builtModules.textModulesData,
    ...(Array.isArray(modules.textModulesData) ? modules.textModulesData : [])
  ];

  const loyaltyObject = {
    id: `${issuerId}.${cardCode}`,
    classId,
    state: 'ACTIVE',
    accountId: cardCode,
    accountName: userName || cardCode,
    barcode: {
      type: normType,
      value: barcode.value || barcode.message || cardCode,
      alternateText: barcode.alternateText || barcode.altText || undefined
    },
    ...(builtModules.loyaltyPoints ? { loyaltyPoints: builtModules.loyaltyPoints } : {}),
    textModulesData: textModules
  };

  const payload = { loyaltyObjects: [loyaltyObject] };
  const claims = {
    iss: s.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins,
    payload
  };

  const token = jwt.sign(claims, s.private_key, { algorithm: 'RS256', keyid: s.private_key_id });
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(token)}`;
}

/* ====================== URL Directa ====================== */
function getAddToWalletUrl(objectId) {
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(objectId)}`;
}

/* ====================== Delete Class ====================== */
async function deleteClass(businessId, card_detail_id = null) {
  const classId = classIdForBusiness(businessId, card_detail_id);
  const accessToken = await getAccessToken();

  const resp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(classId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (resp.ok) {
    console.log(' Clase borrada:', classId);
    return true;
  } else if (resp.status === 404) {
    console.log('  Clase no existe:', classId);
    return false;
  } else {
    const text = await resp.text().catch(() => '');
    console.error(' Error al borrar clase:', { status: resp.status, error: text });
    return false;
  }
}

module.exports = {
  // Clases
  ensureLoyaltyClass,
  deleteClass,
  
  // Objeto principal
  createOrUpdateLoyaltyObject,
  
  // Actualizaciones
  updateLoyaltyPoints,
  updateLoyaltyStrips,
  resetLoyaltyStrips, 
  
  // URLs
  buildAddToGoogleWalletURL,
  getAddToWalletUrl,
  
  // Helpers
  buildModulesByVariant,
  getAccessToken,
  getSA,
  normalizeGWBarcodeType,
  isHttps,
  classIdForBusiness,
  objectIdForCard,
  toHexColor,
  generateCardDetailId, 
  
  // Constantes
  DesignVariants
};