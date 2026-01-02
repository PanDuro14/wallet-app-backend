// controllers/walletController.js
const { 
  issueGoogleWalletLink, 
  createGoogleWalletObject,
  issueGoogleWallet,
  issueAppleWalletPkpass,
  loadBrandAssets
} = require('../processes/walletProcess');

const { 
  buildAddToGoogleWalletURL, 
  ensureLoyaltyClass,
  updateLoyaltyPoints,
  updateLoyaltyStrips,
  resetLoyaltyStrips, // NUEVO
  getAddToWalletUrl
} = require('../services/googleWalletService');

const WALLET_ENABLED = (process.env.WALLET_ENABLED === 'true');

/* ====================== GOOGLE WALLET ====================== */

/**
 * Crear tarjeta Google Wallet - Método Legacy (JWT)
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
    console.error('[Google Wallet] create error:', e);
    return res.status(500).json({ 
      error: 'No se pudo generar el enlace',
      details: e.message 
    });
  }
}

/**
 * Crear tarjeta Google Wallet - Método REST API (Recomendado)
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
      points,
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
        error: 'cardCode y businessId requeridos' 
      });
    }

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

    const url = getAddToWalletUrl(result.objectId);

    return res.json({
      success: true,
      url,
      objectId: result.objectId,
      card_detail_id: result.card_detail_id, // INCLUIR
      existed: result.existed,
      method: 'rest_api',
      cardCode,
      variant: variant || 'points',
      message: result.existed 
        ? 'Objeto actualizado exitosamente' 
        : 'Objeto creado exitosamente'
    });
  } catch (e) {
    console.error('[Google Wallet REST] create error:', e);
    return res.status(500).json({
      error: 'No se pudo crear/actualizar el objeto',
      details: e.message
    });
  }
}

/**
 * Crear tarjeta Google Wallet - Método Unificado (Auto-selección)
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
      useRestApi,
      points,
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
        error: 'cardCode y businessId requeridos' 
      });
    }

    const result = await issueGoogleWallet({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      barcode,
      modules: modules || fields,
      useRestApi: useRestApi !== false,
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
    console.error('[Google Wallet Unified] create error:', e);
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

    const result = await updateLoyaltyPoints(cardCode, newPoints);

    return res.json({
      success: true,
      ...result,
      message: 'Puntos actualizados exitosamente'
    });
  } catch (e) {
    console.error('[Google Wallet] update points error:', e);
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
      businessId, // AGREGADO para cargar assets
      strips_collected, 
      strips_required, 
      reward_title 
    } = req.body || {};

    if (!cardCode || strips_collected == null || strips_required == null) {
      return res.status(400).json({ 
        error: 'cardCode, strips_collected y strips_required requeridos' 
      });
    }

    if (!businessId) {
      return res.status(400).json({ 
        error: 'businessId requerido para actualizar strips con imagen' 
      });
    }

    const collected = parseInt(strips_collected, 10);
    const required = parseInt(strips_required, 10);

    if (isNaN(collected) || isNaN(required)) {
      return res.status(400).json({ 
        error: 'strips_collected y strips_required deben ser números' 
      });
    }

    // Cargar assets de strips
    const { stripImageOn, stripImageOff } = await loadBrandAssets(businessId);

    const result = await updateLoyaltyStrips({
      cardCode, 
      businessId,
      strips_collected: collected, 
      strips_required: required, 
      reward_title,
      stripImageOn,
      stripImageOff
    });

    return res.json({
      success: true,
      ...result,
      message: result.isComplete 
        ? '¡Colección completada!' 
        : 'Strips actualizados exitosamente'
    });
  } catch (e) {
    console.error('[Google Wallet] update strips error:', e);
    return res.status(500).json({
      error: 'No se pudieron actualizar los strips',
      details: e.message
    });
  }
}

/**
 * NUEVO: Resetear colección de strips (multi-rewards)
 */
async function resetGoogleStrips(req, res) {
  if (!WALLET_ENABLED) {
    return res.status(501).json({ 
      error: 'Wallet deshabilitado (WALLET_ENABLED=false)' 
    });
  }

  try {
    const { 
      cardCode, 
      businessId,
      strips_required, 
      reward_title 
    } = req.body || {};

    if (!cardCode || !businessId || !strips_required) {
      return res.status(400).json({ 
        error: 'cardCode, businessId y strips_required requeridos' 
      });
    }

    // Cargar assets de strips
    const { stripImageOn, stripImageOff } = await loadBrandAssets(businessId);

    const result = await resetLoyaltyStrips({
      cardCode,
      businessId,
      strips_required: parseInt(strips_required, 10),
      reward_title,
      stripImageOn,
      stripImageOff
    });

    return res.json({
      success: true,
      ...result,
      message: 'Colección reseteada exitosamente'
    });
  } catch (e) {
    console.error('[Google Wallet] reset strips error:', e);
    return res.status(500).json({
      error: 'No se pudo resetear la colección',
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
      hexBackgroundColor,
      hexForegroundColor,
      logoUri 
    } = req.body || {};

    if (!businessId) {
      return res.status(400).json({ 
        error: 'businessId requerido' 
      });
    }

    const result = await ensureLoyaltyClass({
      businessId,
      programName: programName || 'Mi Programa',
      hexBackgroundColor: hexBackgroundColor || '#FFFFFF',
      hexForegroundColor,
      logoUri,
      autoGenerateId: true // Auto-generar ID
    });

    res.json({ 
      success: true, 
      classId: result.classId,
      card_detail_id: result.card_detail_id,
      existed: result.existed,
      message: result.existed 
        ? 'Clase existente (reutilizada)' 
        : 'Clase creada exitosamente'
    });
  } catch (e) {
    console.error('[Google Wallet] ensure class error:', e);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
}

/**
 * Debug: inspección del JWT (SOLO DESARROLLO)
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
    console.error('[Google Wallet] debug error:', e);
    return res.status(500).json({ 
      error: e.message 
    });
  }
}

/**
 * Debug: inspección de objeto en Google Wallet (SOLO DESARROLLO)
 */
async function debugGoogleObject(req, res) {
  try {
    const { objectId } = req.body || {};
    
    if (!objectId) {
      return res.status(400).json({ 
        error: 'objectId requerido' 
      });
    }

    const { getAccessToken } = require('../services/googleWalletService');
    const accessToken = await getAccessToken();
    const BASE_URL = 'https://walletobjects.googleapis.com/walletobjects/v1';
    
    // GET objeto
    const objResp = await fetch(`${BASE_URL}/loyaltyObject/${encodeURIComponent(objectId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!objResp.ok) {
      const txt = await objResp.text().catch(() => '');
      return res.status(objResp.status).json({ 
        error: 'Objeto no encontrado',
        details: txt
      });
    }
    
    const object = await objResp.json();
    
    // GET clase
    const classResp = await fetch(`${BASE_URL}/loyaltyClass/${encodeURIComponent(object.classId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const classObj = classResp.ok ? await classResp.json() : null;
    
    return res.json({ 
      object, 
      class: classObj,
      summary: {
        objectId: object.id,
        classId: object.classId,
        state: object.state,
        accountName: object.accountName,
        points: object.loyaltyPoints?.balance?.string,
        hasImage: !!object.imageModulesData?.length
      }
    });
  } catch (error) {
    console.error('[Google Wallet] debug object error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/* ====================== APPLE WALLET ====================== */

/**
 * Crear .pkpass para Apple Wallet
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

    const pkpassBuffer = await issueAppleWalletPkpass({
      cardCode,
      userName,
      programName,
      businessId,
      colors,
      fields,
      barcode,
      points,
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
    console.error('[Apple Wallet] create error:', e?.message || e);
    return res.status(500).json({ 
      error: 'No se pudo generar el .pkpass',
      details: e.message 
    });
  }
}

/* ====================== EXPORTS ====================== */
module.exports = {
  // Google Wallet
  createGoogle,              // Legacy JWT
  createGoogleRestApi,       // REST API directo
  createGoogleUnified,       // Auto-selección (recomendado)
  updateGooglePoints,        // Actualizar puntos
  updateGoogleStrips,        // Actualizar strips + imagen
  resetGoogleStrips,         // Resetear colección
  ensureGoogleClass,         // Asegurar clase
  debugGoogle,               // Debug JWT
  debugGoogleObject,         // Debug objeto
  
  // Apple Wallet
  addToAppleWallet
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