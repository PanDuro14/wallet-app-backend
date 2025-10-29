// services/googleWalletService.js
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const fetch = globalThis.fetch || ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

// ✅ IMPORTS AGREGADOS
const { saveBufferAsPublicPNG } = require('./imageStorageService');
const stripsImageService = require('./stripsImageService');

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

function classIdForBusiness(businessId, cardDetailId = null) {
  const biz = String(businessId).replace(/[^a-zA-Z0-9_]/g, '_');
  
  // SI cardDetailId existe, usamos clase nueva
  if (cardDetailId) {
    const cd = String(cardDetailId).replace(/[^a-zA-Z0-9_]/g, '_');
    return `${issuerId}.loyalty_biz_${biz}_${cd}`;
  }

  // fallback legacy (para usuarios viejos)
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
  card_detail_id,
  issuerName = DEFAULT_ISSUER_NAME,
  hexBackgroundColor = '#FFFFFF',
  hexForegroundColor,
  logoBuffer // ⚠️ Mantener para compatibilidad
}) {
  if (!issuerId) throw new Error('Falta GOOGLE_ISSUER_ID');
  
  const classId = classIdForBusiness(businessId, card_detail_id);
  const accessToken = await getAccessToken();

  // ⭐ CONSTRUIR URL DEL LOGO DESDE EL ENDPOINT PÚBLICO
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const logoUri = `${baseUrl}/api/public/assets/logo/${businessId}`;
  
  console.log('[ensureLoyaltyClass] Logo URI:', logoUri);

  // Verificar si la clase ya existe
  const getResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (getResp.ok) {
    // ⚠️ La clase ya existe
    console.log('[ensureLoyaltyClass] ⚠️ Clase YA EXISTE - Los colores NO se pueden cambiar en clases APPROVED');
    console.log('[ensureLoyaltyClass] Para cambiar colores necesitas:', {
      opcion1: 'Ejecutar: node scripts/deleteGoogleWalletClass.js ' + businessId,
      opcion2: 'Crear un nuevo businessId',
      classId,
      note: 'Google no permite modificar clases con reviewStatus=APPROVED'
    });
    
    return classId;
  }

  if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyClass falló (${getResp.status}): ${txt}`);
  }

  // Crear la clase con el logo desde la URL pública
  const body = {
    id: classId,
    issuerName,
    programName,
    hexBackgroundColor: toHexColor(hexBackgroundColor),
    reviewStatus: 'UNDER_REVIEW',
    programLogo: { sourceUri: { uri: logoUri } }
  };

  // ✅ Agregar color de texto si está presente
  if (hexForegroundColor) {
    body.hexFontColor = toHexColor(hexForegroundColor);
  }

  console.log('[ensureLoyaltyClass] Creando clase:', {
    classId,
    programName,
    logoUri,
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
      console.log('[ensureLoyaltyClass] Clase ya existe (409):', classId);
      return classId;
    }
    const txt = await postResp.text().catch(() => '');
    console.error('[ensureLoyaltyClass] Error al crear clase:', {
      status: postResp.status,
      error: txt
    });
    throw new Error(`POST loyaltyClass falló (${postResp.status}): ${txt}`);
  }

  console.log('[ensureLoyaltyClass] ✓ Clase creada exitosamente:', classId);
  return classId;
}

/* ====================== CREAR/ACTUALIZAR OBJETO (REST API) - CON COLORES ====================== */
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
  
  console.log('[createOrUpdateLoyaltyObject] Parámetros recibidos:', {
    cardCode,
    businessId,
    variant,
    points,
    strips_collected,
    strips_required,
    hexBackgroundColor,
    hexForegroundColor,
    hasStripOn: !!stripImageOn,
    hasStripOff: !!stripImageOff
  });

  const classId = classIdForBusiness(businessId, card_detail_id);
  const objectId = objectIdForCard(cardCode);
  const accessToken = await getAccessToken();

  // Normalizar variante
  const normalizedVariant = (variant || 'points').toLowerCase().trim();

  console.log('[createOrUpdateLoyaltyObject] Variante normalizada:', normalizedVariant);

  // Crear módulos según la variante
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

  // ✅ LOG DE COLORES (una sola vez)
  if (hexBackgroundColor || hexForegroundColor) {
    console.log('[createOrUpdateLoyaltyObject] Colores configurados en clase:', {
      background: hexBackgroundColor,
      foreground: hexForegroundColor,
      note: 'Los colores se definen en loyaltyClass, no en el objeto'
    });
  }

  // Preparar el objeto base
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

  if (normalizedVariant === 'strips' && strips_required && stripImageOn && stripImageOff) {
    try {
      console.log('[createOrUpdateLoyaltyObject] Generando strip image:', {
        collected: strips_collected,
        required: strips_required,
        hasStripOn: !!stripImageOn,
        hasStripOff: !!stripImageOff
      });

      // 1. Convertir base64 -> Buffer
      const onBuf = Buffer.from(stripImageOn, 'base64');
      const offBuf = Buffer.from(stripImageOff, 'base64');

      // 2. Generar imagen compuesta (circulitos llenos/vacíos)
      const stripsImageBuffer = await stripsImageService.generateStripsImage({
        collected: strips_collected || 0,
        total: strips_required,
        stripImageOn: onBuf,
        stripImageOff: offBuf,
        cardWidth: 640
      });

      console.log('[createOrUpdateLoyaltyObject] Imagen generada, tamaño:', stripsImageBuffer.length, 'bytes');

      // 3. Guardar PNG en /public/strips/:businessId/:cardCode.png
      const { publicUrl } = await saveBufferAsPublicPNG({
        businessId,
        kind: "strip",
        buffer: stripsImageBuffer
      });

      console.log('[createOrUpdateLoyaltyObject] URL generada:', publicUrl);
      // limpiar de forma preventiva
      loyaltyObject.imageModulesData = []; 
      
      // 4. Insertar en Google Wallet solo si es HTTPS
      if (publicUrl && isHttps(publicUrl)) {

        // Forzamos que este módulo quede como PRIMERO
        loyaltyObject.imageModulesData = [
          {
            id: "strips_progress", // 🔥 requerido para actualización
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
          },
          ...(loyaltyObject.imageModulesData || []) //  preserva otros módulos
        ];
      }


    } catch (err) {
      console.error('[createOrUpdateLoyaltyObject] Error con strip image:', err.message);
      console.log('[createOrUpdateLoyaltyObject] Continuando sin imagen de strips...');
    }
  } else if (normalizedVariant === 'strips') {
    console.log('[createOrUpdateLoyaltyObject] Strips deshabilitados o sin imágenes disponibles');
  }
  // Verificar si el objeto ya existe
  const getResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  let existed = false;
  if (getResp.ok) {
    existed = true;
    console.log('[createOrUpdateLoyaltyObject] Objeto existe, actualizando...');
  } else if (getResp.status !== 404) {
    const txt = await getResp.text().catch(() => '');
    throw new Error(`GET loyaltyObject falló (${getResp.status}): ${txt}`);
  } else {
    console.log('[createOrUpdateLoyaltyObject] Objeto no existe, creando...');
  }

  // Crear o actualizar el objeto
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
    console.error('[createOrUpdateLoyaltyObject] Error:', {
      method,
      status: resp.status,
      error: txt
    });
    throw new Error(`${method} loyaltyObject falló (${resp.status}): ${txt}`);
  }

  const result = await resp.json();

  console.log('[createOrUpdateLoyaltyObject] ✓ Objeto guardado:', {
    objectId,
    existed,
    variant: normalizedVariant,
    hasColors: !!hexBackgroundColor
  });

  return { 
    objectId, 
    existed,
    data: result
  };
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

/* ====================== URL DIRECTA (sin JWT) ====================== */
function getAddToWalletUrl(objectId) {
  return `https://pay.google.com/gp/v/save/${encodeURIComponent(objectId)}`;
}

/* ====================== DELETE CLASS (para scripts) ====================== */
async function deleteClass(businessId, card_detail_id = null) {
  const classId = classIdForBusiness(businessId, card_detail_id);
  const accessToken = await getAccessToken();

  console.log('🗑️  Intentando borrar clase:', classId);

  const resp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(classId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (resp.ok) {
    console.log('✅ Clase borrada exitosamente:', classId);
    return true;
  } else if (resp.status === 404) {
    console.log('⚠️  La clase no existe:', classId);
    return false;
  } else {
    const text = await resp.text().catch(() => '');
    console.error('❌ Error al borrar clase:', { status: resp.status, error: text });
    return false;
  }
}

module.exports = {
  // Clases
  ensureLoyaltyClass,
  deleteClass,
  
  // Objeto principal
  createOrUpdateLoyaltyObject,
  
  // Actualizaciones específicas
  updateLoyaltyPoints,
  updateLoyaltyStrips,
  
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
  
  // Constantes
  DesignVariants
};