// controller/walletController.js
const { 
  issueGoogleWalletLink, 
  createGoogleWalletObject,
  issueGoogleWallet,
  issueAppleWalletPkpass 
} = require('../processes/walletProcess');

const { 
  buildAddToGoogleWalletURL, 
  ensureLoyaltyClass,
  updateLoyaltyPoints,
  updateLoyaltyStrips,
  getAddToWalletUrl
} = require('../services/googleWalletService');

const WALLET_ENABLED = (process.env.WALLET_ENABLED === 'true');

/* ====================== GOOGLE WALLET ====================== */

/**
 * Crear tarjeta Google Wallet - Método Legacy (JWT)
 * Mantiene compatibilidad con código existente
 */
async function createGoogle(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const { 
      cardCode, 
      userName, 
      programName, 
      businessId,
      colors,
      barcode,
      fields,
      // Nuevos parámetros opcionales
      variant,
      tier,
      since,
      points,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    } = req.body || {};

    if (!cardCode || !businessId) {
      return res.status(400).json({ 
        error: 'cardCode y businessId requeridos' 
      });
    }

    ////console.log('[createGoogle] Request:', {
    //  cardCode,
    //  businessId,
    //  variant,
    //  points,
    //  strips_collected,
    //  strips_required
    //});

    // Usa el process (trae brand del negocio) - ahora con soporte de variantes
    const url = await issueGoogleWalletLink({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      fields,
      variant,
      tier,
      since,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    });

    return res.json({ 
      url,
      method: 'jwt_legacy',
      cardCode,
      variant: variant || 'points'
    });
  } catch (e) {
    ////console.error('[Google Wallet] create error:', e);
    return res.status(500).json({ 
      error: 'No se pudo generar el enlace',
      details: e.message 
    });
  }
}

/**
 * Crear tarjeta Google Wallet - Método REST API (Recomendado)
 * Crea/actualiza objetos directamente en Google Wallet
 */
async function createGoogleRestApi(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const {
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      modules,
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
    } = req.body || {};

    if (!cardCode || !businessId) {
      return res.status(400).json({ 
        error: 'cardCode y businessId requeridos' 
      });
    }

    ////console.log('[createGoogleRestApi] Request:', {
    //  cardCode,
    //  businessId,
    //  variant,
    //  points,
    //  strips_collected,
    //  strips_required
    //});

    // Crear/actualizar objeto usando REST API
    const result = await createGoogleWalletObject({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      modules,
      points,
      variant,
      tier,
      since,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    });

    // Construir URL directa al objeto
    const url = getAddToWalletUrl(result.objectId);

    return res.json({
      success: true,
      url,
      objectId: result.objectId,
      existed: result.existed,
      method: 'rest_api',
      cardCode,
      variant: variant || 'points',
      message: result.existed 
        ? 'Objeto actualizado exitosamente' 
        : 'Objeto creado exitosamente'
    });
  } catch (e) {
    //console.error('[Google Wallet REST] create error:', e);
    return res.status(500).json({
      error: 'No se pudo crear/actualizar el objeto',
      details: e.message
    });
  }
}

/**
 * Crear tarjeta Google Wallet - Método Unificado (Auto-selección)
 * Detecta automáticamente el mejor método según los parámetros
 */
async function createGoogleUnified(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const {
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      modules,
      fields,
      useRestApi, // Flag para forzar método (default: true)
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
    } = req.body || {};

    if (!cardCode || !businessId) {
      return res.status(400).json({ 
        error: 'cardCode y businessId requeridos' 
      });
    }

    //console.log('[createGoogleUnified] Request:', {
    //  cardCode,
    //  businessId,
    //  variant,
    //  useRestApi: useRestApi !== false
    //});

    // Usar wrapper unificado
    const result = await issueGoogleWallet({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      modules: modules || fields, // Acepta ambos formatos
      useRestApi: useRestApi !== false, // Default: REST API
      points,
      variant,
      tier,
      since,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    });

    return res.json({
      success: true,
      ...result,
      cardCode,
      variant: variant || 'points'
    });
  } catch (e) {
    //console.error('[Google Wallet Unified] create error:', e);
    return res.status(500).json({
      error: 'No se pudo crear la tarjeta',
      details: e.message
    });
  }
}

/**
 * Actualizar puntos de una tarjeta existente
 */
async function updateGooglePoints(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const { cardCode, points } = req.body || {};

    if (!cardCode || points == null) {
      return res.status(400).json({ 
        error: 'cardCode y points requeridos' 
      });
    }

    const newPoints = parseInt(points, 10);
    if (isNaN(newPoints)) {
      return res.status(400).json({ 
        error: 'points debe ser un número' 
      });
    }

    //console.log('[updateGooglePoints] Actualizando:', { cardCode, newPoints });

    const result = await updateLoyaltyPoints(cardCode, newPoints);

    return res.json({
      success: true,
      ...result,
      message: 'Puntos actualizados exitosamente'
    });
  } catch (e) {
    //console.error('[Google Wallet] update points error:', e);
    return res.status(500).json({
      error: 'No se pudieron actualizar los puntos',
      details: e.message
    });
  }
}

/**
 * Actualizar strips de una tarjeta existente
 */
async function updateGoogleStrips(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const { 
      cardCode, 
      strips_collected, 
      strips_required, 
      reward_title 
    } = req.body || {};

    if (!cardCode || strips_collected == null || strips_required == null) {
      return res.status(400).json({ 
        error: 'cardCode, strips_collected y strips_required requeridos' 
      });
    }

    const collected = parseInt(strips_collected, 10);
    const required = parseInt(strips_required, 10);

    if (isNaN(collected) || isNaN(required)) {
      return res.status(400).json({ 
        error: 'strips_collected y strips_required deben ser números' 
      });
    }

    //console.log('[updateGoogleStrips] Actualizando:', { 
    //  cardCode, 
    //  collected, 
    //  required 
    //});

    const result = await updateLoyaltyStrips(
      cardCode, 
      collected, 
      required, 
      reward_title
    );

    return res.json({
      success: true,
      ...result,
      message: result.isComplete 
        ? '¡Colección completada!' 
        : 'Strips actualizados exitosamente'
    });
  } catch (e) {
    //console.error('[Google Wallet] update strips error:', e);
    return res.status(500).json({
      error: 'No se pudieron actualizar los strips',
      details: e.message
    });
  }
}

/**
 * Asegurar que existe la clase de Google Wallet para un negocio
 */
async function ensureGoogleClass(req, res) {
  try {
    const { 
      businessId, 
      programName, 
      bg, 
      logoUri 
    } = req.body || {};

    if (!businessId) {
      return res.status(400).json({ 
        error: 'businessId requerido' 
      });
    }

    const classId = await ensureLoyaltyClass({
      businessId,
      programName: programName || 'Mi Programa',
      hexBackgroundColor: bg || '#FFFFFF',
      logoUri
    });

    res.json({ 
      success: true, 
      classId,
      message: 'Clase asegurada exitosamente'
    });
  } catch (e) {
    //console.error('[Google Wallet] ensure class error:', e);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
}

/**
 * Debug: inspección del JWT (sin pasar por process)
 * SOLO DESARROLLO
 */
async function debugGoogle(req, res) {
  try {
    const { 
      cardCode, 
      userName, 
      programName, 
      businessId,
      variant,
      points,
      strips_collected,
      strips_required
    } = req.body || {};

    if (!cardCode || !businessId) {
      return res.status(400).json({ 
        error: 'cardCode y businessId requeridos' 
      });
    }

    const url = buildAddToGoogleWalletURL({
      cardCode,
      userName,
      businessId,
      brand: { programName },
      variant,
      points,
      strips_collected,
      strips_required
    });

    const token = decodeURIComponent(url.split('/gp/v/save/')[1]);
    const [h, p] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));

    return res.json({ 
      url, 
      header, 
      payload_claims: payload,
      loyaltyObject: payload.payload?.loyaltyObjects?.[0]
    });
  } catch (e) {
    //console.error('[Google Wallet] debug error:', e);
    return res.status(500).json({ 
      error: e.message 
    });
  }
}

/* ====================== APPLE WALLET ====================== */

/**
 * Crear .pkpass para Apple Wallet
 * Sin cambios en funcionalidad, mantiene compatibilidad total
 */
async function addToAppleWallet(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const { 
      cardCode, 
      userName, 
      programName, 
      businessId, 
      colors, 
      fields, 
      barcode, 
      points,
      // Nuevos parámetros opcionales (Apple también los soporta)
      variant,
      tier,
      since,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    } = req.body || {};

    if (!cardCode || !businessId) {
      return res.status(400).json({ 
        error: 'cardCode y businessId son requeridos.' 
      });
    }

    //console.log('[addToAppleWallet] Request:', {
    //  cardCode,
    //  businessId,
    //  variant,
    //  points,
    //  strips_collected
    //});

    const pkpassBuffer = await issueAppleWalletPkpass({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      fields,
      barcode,
      points,
      // Pasar parámetros nuevos
      variant,
      tier,
      since,
      strips_collected,
      strips_required,
      reward_title,
      isComplete
    });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${cardCode}.pkpass"`
    });

    return res.send(pkpassBuffer);
  } catch (e) {
    //console.error('[Apple Wallet] create error:', e?.message || e);
    return res.status(500).json({ 
      error: 'No se pudo generar el .pkpass',
      details: e.message 
    });
  }
}


// funcion de debug 
// En walletController.js
const debugGoogleObject = async (req, res) => {
  try {
    const { getAccessToken } = require('../services/googleWalletService');
    const objectId = '3388000000022968363.b86e60a1-995e-41c5-af17-25eec10b0d28';
    
    const accessToken = await getAccessToken();
    const BASE_URL = 'https://walletobjects.googleapis.com/walletobjects/v1';
    
    // GET objeto
    const objResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const object = await objResp.json();
    
    // GET clase
    const classResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(object.classId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const classObj = await classResp.json();
    
    return res.json({ object, classObj });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* ====================== EXPORTS ====================== */
module.exports = {
  // Google Wallet - Múltiples métodos
  createGoogle,              // Legacy JWT (retrocompatibilidad)
  createGoogleRestApi,       // REST API directo
  createGoogleUnified,       // Auto-selección (recomendado)
  updateGooglePoints,        // Actualizar puntos
  updateGoogleStrips,        // Actualizar strips
  ensureGoogleClass,         // Asegurar clase
  debugGoogle,               // Debug JWT
  
  // Apple Wallet
  addToAppleWallet,         // Sin cambios

  // debug 
  debugGoogleObject
};

/* ====================== EJEMPLOS DE USO EN RUTAS ====================== 

// routes/walletRoutes.js
const router = require('express').Router();
const walletController = require('../controllers/walletController');

// ===== GOOGLE WALLET =====

// Legacy JWT (mantiene compatibilidad)
router.post('/google/create', walletController.createGoogle);

// REST API directo (recomendado para nuevas implementaciones)
router.post('/google/create-rest', walletController.createGoogleRestApi);

// Unificado (auto-selección, más flexible)
router.post('/google/create-unified', walletController.createGoogleUnified);

// Actualizaciones
router.patch('/google/points', walletController.updateGooglePoints);
router.patch('/google/strips', walletController.updateGoogleStrips);

// Utilidades
router.post('/google/ensure-class', walletController.ensureGoogleClass);
router.post('/google/debug', walletController.debugGoogle); // Solo dev

// ===== APPLE WALLET =====
router.post('/apple/create', walletController.addToAppleWallet);

module.exports = router;

// ===== EJEMPLOS DE REQUESTS =====

// 1. GOOGLE WALLET - TARJETA POINTS (Legacy JWT)
POST /api/wallets/google/create
{
  "cardCode": "GGL001",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "businessId": 1,
  "variant": "points",
  "points": 250,
  "tier": "Oro",
  "since": "2024-01-15"
}

// 2. GOOGLE WALLET - TARJETA STRIPS (REST API)
POST /api/wallets/google/create-rest
{
  "cardCode": "GGL002",
  "userName": "María López",
  "programName": "Café Rewards",
  "businessId": 2,
  "variant": "strips",
  "strips_collected": 7,
  "strips_required": 10,
  "reward_title": "Café gratis",
  "isComplete": false
}

// 3. GOOGLE WALLET - MÉTODO UNIFICADO (Auto)
POST /api/wallets/google/create-unified
{
  "cardCode": "GGL003",
  "userName": "Pedro Gómez",
  "businessId": 3,
  "variant": "strips",
  "strips_collected": 10,
  "strips_required": 10,
  "reward_title": "Descuento 20%",
  "isComplete": true,
  "useRestApi": true  // Default: true
}

// 4. ACTUALIZAR PUNTOS
PATCH /api/wallets/google/points
{
  "cardCode": "GGL001",
  "points": 500
}

// 5. ACTUALIZAR STRIPS
PATCH /api/wallets/google/strips
{
  "cardCode": "GGL002",
  "strips_collected": 9,
  "strips_required": 10,
  "reward_title": "Café + postre gratis"
}

// 6. APPLE WALLET - TARJETA POINTS
POST /api/wallets/apple/create
{
  "cardCode": "APL001",
  "userName": "Ana Torres",
  "programName": "SuperMercado",
  "businessId": 1,
  "variant": "points",
  "points": 1500,
  "tier": "Platino"
}

// 7. APPLE WALLET - TARJETA STRIPS
POST /api/wallets/apple/create
{
  "cardCode": "APL002",
  "userName": "Luis Ramírez",
  "programName": "Pizza Club",
  "businessId": 4,
  "variant": "strips",
  "strips_collected": 8,
  "strips_required": 10,
  "reward_title": "Pizza familiar gratis"
}

*/