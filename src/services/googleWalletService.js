// services/googleWalletService.js
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const fetch = globalThis.fetch || ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

const issuerId = process.env.GOOGLE_ISSUER_ID;
const DEFAULT_ISSUER_NAME = process.env.GOOGLE_ISSUER_NAME || 'Mi Negocio';
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',').map(s => s.trim()).filter(Boolean);

const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

const BASE_URL = 'https://walletobjects.googleapis.com/walletobjects/v1';

// Constantes para variantes (paridad con Apple)
const DesignVariants = { POINTS: 'points', STRIPS: 'strips' };

/* ====================== Helpers base ====================== */
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

function classIdForBusiness(businessId) {
  const suffix = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  return `${issuerId}.loyalty_biz_${suffix}`;
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

/* ====================== NUEVA: Build Modules by Variant (paridad con Apple) ====================== */
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
  // Normalizar variante
  const normalizedVariant = String(variant || 'points').toLowerCase().trim();
  
  console.log('[buildModulesByVariant] Generando módulos para:', {
    variant: normalizedVariant,
    strips_collected,
    strips_required,
    isComplete
  });

  const textModules = [];
  let loyaltyPoints = undefined;

  // Variante STRIPS
  if (normalizedVariant === DesignVariants.STRIPS) {
    if (strips_collected !== undefined && strips_required !== undefined) {
      // Módulo de progreso
      textModules.push({
        header: 'Progreso',
        body: `${strips_collected} de ${strips_required} completados`
      });

      // Balance de puntos muestra el progreso
      loyaltyPoints = {
        label: 'Progreso',
        balance: { string: isComplete ? 'COMPLETADA' : `${strips_collected}/${strips_required}` }
      };

      // Módulo de premio (si existe)
      if (reward_title) {
        textModules.push({
          header: 'Premio',
          body: reward_title
        });
      }

      // Estado de completado
      if (isComplete) {
        textModules.push({
          header: 'Estado',
          body: '¡Colección completa! 🎉'
        });
      }

      // Info del miembro
      if (userName) {
        textModules.push({
          header: 'Miembro',
          body: userName
        });
      }
    } else {
      // Sin datos de colección - diseño por defecto
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
  } 
  // Variante POINTS (default)
  else {
    // Balance de puntos
    loyaltyPoints = {
      label: 'PUNTOS',
      balance: { string: String(points) }
    };

    // Módulo principal con info del programa
    if (programName) {
      textModules.push({
        header: programName,
        body: `Cliente: ${userName || 'Sin nombre'}`
      });
    }

    // Módulo de nivel
    if (tier) {
      textModules.push({
        header: 'NIVEL',
        body: tier
      });
    }

    // Módulo de antigüedad
    if (since) {
      textModules.push({
        header: 'MIEMBRO DESDE',
        body: since
      });
    }
  }

  // Módulo de términos (común a ambas variantes)
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

/* ====================== Clase (branding) ====================== */
async function ensureLoyaltyClass({
  businessId,
  programName,
  issuerName = DEFAULT_ISSUER_NAME,
  hexBackgroundColor = '#FFFFFF',
  logoUri
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  const classId = classIdForBusiness(businessId);
  const accessToken = await getAccessToken();

  // GET
  const getResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (getResp.ok) return classId;
  if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyClass falló (${getResp.status}): ${txt}`);
  }

  // POST
  const safeLogo = (logoUri && isHttps(logoUri)) ? { programLogo: { sourceUri: { uri: logoUri } } } : {};
  const body = {
    id: classId,
    issuerName,
    programName,
    hexBackgroundColor: toHexColor(hexBackgroundColor),
    reviewStatus: 'UNDER_REVIEW',
    ...safeLogo
  };

  const postResp = await fetch(`${BASE_URL}/loyaltyClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!postResp.ok) {
    if (postResp.status === 409) return classId;
    const txt = await postResp.text().catch(() => '');
    throw new Error(`POST loyaltyClass falló (${postResp.status}): ${txt}`);
  }
  return classId;
}

/* ====================== CREAR/ACTUALIZAR OBJETO (REST API) - MEJORADO ====================== */
async function createOrUpdateLoyaltyObject({
  cardCode,
  businessId,
  userName,
  programName,
  points,
  barcode = {},
  modules = {},
  // Nuevos parámetros para paridad completa
  variant,
  tier,
  since,
  // STRIPS
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');

  const classId = classIdForBusiness(businessId);
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  // Normalizar variante
  const normalizedVariant = (variant || '').toLowerCase().trim();
  
  console.log('[createOrUpdateLoyaltyObject] Variant validation:', {
    original: variant,
    normalized: normalizedVariant,
    isStrips: normalizedVariant === 'strips',
    isPoints: normalizedVariant === 'points'
  });

  // Validación de variante
  if (normalizedVariant && normalizedVariant !== 'strips' && normalizedVariant !== 'points') {
    throw new Error(`variant debe ser "strips" o "points", recibido: "${variant}"`);
  }

  const finalVariant = normalizedVariant || 'points';

  console.log('[createOrUpdateLoyaltyObject] Creando/Actualizando:', {
    objectId,
    classId,
    variant: finalVariant,
    strips_collected,
    strips_required
  });

  // Construir módulos usando la nueva función (paridad con Apple)
  const builtModules = buildModulesByVariant({
    variant: finalVariant,
    userName,
    programName,
    points: points ?? 0,
    tier,
    since,
    strips_collected,
    strips_required,
    reward_title,
    isComplete
  });

  // Merge con módulos custom del usuario
  const textModules = [
    ...builtModules.textModulesData,
    ...(Array.isArray(modules.textModulesData) ? modules.textModulesData : [])
  ];

  // Barcode
  const normType = normalizeGWBarcodeType(barcode.type || barcode.format || barcode.pref);
  const barcodeObj = {
    type: normType,
    value: barcode.value || barcode.message || cardCode,
    alternateText: barcode.alternateText || barcode.altText || cardCode
  };

  // Objeto completo
  const loyaltyObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    accountId: cardCode,
    accountName: userName || cardCode,
    barcode: barcodeObj,
    ...(builtModules.loyaltyPoints ? { loyaltyPoints: builtModules.loyaltyPoints } : {}),
    textModulesData: textModules,
    ...(modules.imageModulesData ? { imageModulesData: modules.imageModulesData } : {})
  };

  // Intentar GET (ver si existe)
  const getResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (getResp.ok) {
    // Ya existe, hacer PUT
    console.log(`[Google Wallet API] Actualizando objeto existente: ${objectId}`);
    
    const putResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${accessToken}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(loyaltyObject)
    });

    if (!putResp.ok) {
      const txt = await putResp.text().catch(() => '');
      throw new Error(`PUT loyaltyObject falló (${putResp.status}): ${txt}`);
    }

    console.log(`[Google Wallet API] ✓ Objeto actualizado`);
    return { objectId, existed: true };
  }

  // No existe, hacer POST
  console.log(`[Google Wallet API] Creando nuevo objeto: ${objectId}`);
  
  const postResp = await fetch(`${BASE_URL}/loyaltyObject`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${accessToken}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(loyaltyObject)
  });

  if (!postResp.ok) {
    if (postResp.status === 409) {
      console.log(`[Google Wallet API] Objeto ya existe (409): ${objectId}`);
      return { objectId, existed: true };
    }
    const txt = await postResp.text().catch(() => '');
    throw new Error(`POST loyaltyObject falló (${postResp.status}): ${txt}`);
  }

  console.log(`[Google Wallet API] ✓ Objeto creado`);
  return { objectId, existed: false };
}

/* ====================== ACTUALIZAR PUNTOS ====================== */
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

  console.log(`[Google Wallet API] Actualizando puntos: ${cardCode} -> ${newPoints}`);

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

  console.log(`[Google Wallet API] ✓ Puntos actualizados`);
  return { ok: true, objectId, points: newPoints };
}

/* ====================== ACTUALIZAR STRIPS ====================== */
async function updateLoyaltyStrips(cardCode, strips_collected, strips_required, reward_title) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  const isComplete = strips_collected >= strips_required;

  // Usar la función helper para consistencia
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

  console.log(`[Google Wallet API] Actualizando strips: ${cardCode} -> ${strips_collected}/${strips_required}`);

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

  console.log(`[Google Wallet API] ✓ Strips actualizados`);
  return { ok: true, objectId, strips_collected, strips_required, isComplete };
}

/* ====================== URL "Add to Google Wallet" (JWT - LEGACY) ====================== */
function buildAddToGoogleWalletURL({
  cardCode,
  userName,
  brand = {},
  businessId,
  barcode = {},
  modules = {},
  points = null,
  // Nuevos parámetros para paridad
  variant,
  strips_collected,
  strips_required,
  reward_title,
  isComplete
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  if (!cardCode || !businessId) throw new Error('cardCode y businessId requeridos');

  const s = getSA();
  const classId = classIdForBusiness(businessId);
  const normType = normalizeGWBarcodeType(barcode.type || barcode.format || barcode.pref);

  const finalVariant = (variant || '').toLowerCase().trim() || 'points';

  // Usar buildModulesByVariant para consistencia
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

  // Merge con módulos custom
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

/* ====================== URL DIRECTA (sin JWT - requiere objeto creado) ====================== */
function getAddToWalletUrl(objectId) {
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(objectId)}`;
}

module.exports = {
  // Clases
  ensureLoyaltyClass,
  
  // Objeto principal
  createOrUpdateLoyaltyObject,
  
  // Actualizaciones específicas
  updateLoyaltyPoints,
  updateLoyaltyStrips,
  
  // URLs
  buildAddToGoogleWalletURL,
  getAddToWalletUrl,
  
  // Helpers (para testing/uso externo)
  buildModulesByVariant, // NUEVA - paridad con Apple
  getAccessToken,
  getSA,
  normalizeGWBarcodeType,
  isHttps,
  classIdForBusiness,
  objectIdForCard,
  toHexColor,
  
  // Constantes
  DesignVariants // NUEVA - paridad con Apple
};

/* ====================== PLANTILLAS DE USO ====================== 

// 1. TARJETA POINTS BÁSICA (QR por defecto)
{
  "businessId": 1,
  "cardCode": "ABC124",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "variant": "points",
  "points": 100,
  "tier": "Oro",
  "since": "2024-01-15"
}

// 2. TARJETA STRIPS CON COLECCIÓN
{
  "businessId": 2,
  "cardCode": "STR001",
  "userName": "María López",
  "programName": "Café Rewards",
  "variant": "strips",
  "strips_collected": 8,
  "strips_required": 10,
  "reward_title": "Café gratis",
  "isComplete": false
}

// 3. TARJETA STRIPS COMPLETADA
{
  "businessId": 2,
  "cardCode": "STR002",
  "userName": "Pedro Gómez",
  "programName": "Café Rewards",
  "variant": "strips",
  "strips_collected": 10,
  "strips_required": 10,
  "reward_title": "Café + postre gratis",
  "isComplete": true
}

// 4. TARJETA POINTS CON CODE128
{
  "businessId": 3,
  "cardCode": "BAR456",
  "userName": "Ana Torres",
  "programName": "SuperMercado Plus",
  "variant": "points",
  "points": 2500,
  "barcode": { "type": "code128" }
}

// 5. TARJETA CON MÓDULOS PERSONALIZADOS
{
  "businessId": 4,
  "cardCode": "CUST789",
  "userName": "Luis Ramírez",
  "programName": "Premium Club",
  "variant": "points",
  "points": 5000,
  "modules": {
    "textModulesData": [
      { "header": "Descuento", "body": "15% en toda la tienda" }
    ]
  }
}

*/