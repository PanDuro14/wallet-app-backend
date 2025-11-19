// routes/pwaWalletRoutes.js
// Definición de rutas HTTP - Solo mapeo de endpoints
const express = require('express');
const router = express.Router();
const pwaWalletController = require('../../controller/pwaWalletController');

// ========================================
// RUTAS EXISTENTES (PWA Client)
// ========================================

router.get('/:serial', pwaWalletController.validateUuidParam('serial'), pwaWalletController.getCard);
router.patch('/:serial/stamp', pwaWalletController.validateUuidParam('serial'), pwaWalletController.addStamp);
router.post('/:serial/redeem', pwaWalletController.validateUuidParam('serial'), pwaWalletController.redeemReward);
router.get('/:serial/stats', pwaWalletController.validateUuidParam('serial'), pwaWalletController.getCardStats);
router.get('/business/:businessId/assets', pwaWalletController.checkBusinessAssets);
router.post('/update-points', pwaWalletController.updatePoints);
router.post('/add-stamp', pwaWalletController.addStampAdmin);
router.post('/reset-strips', pwaWalletController.resetStrips);
router.use(pwaWalletController.errorHandler);

module.exports = router;

/**
 * DOCUMENTACIÓN DE RUTAS EXISTENTES
 * 
 * GET /api/wallet/:serial
 * Obtiene datos completos de la tarjeta
 * 
 * Response 200:
 * {
 *   card: { serial_number, loyalty_account_id, card_type, ... },
 *   user: { name, email, phone },
 *   business: { id, name, logo_url, ... },
 *   design: { background_color, foreground_color, ... },
 *   strips: { collected, required, is_complete, ... },
 *   urls: { pwa, install, share }
 * }
 * 
 * Response 404: { error: "Tarjeta no encontrada" }
 */

/**
 * PATCH /api/wallet/:serial/stamp
 * Agrega un sello/strip a la tarjeta (desde PWA)
 * 
 * Body:
 * {
 *   admin_key: "optional-admin-key"
 * }
 * 
 * Response 200:
 * {
 *   success: true,
 *   strips_collected: 3,
 *   strips_required: 8,
 *   is_complete: false,
 *   message: "Sello agregado (3/8)"
 * }
 * 
 * Response 400: { error: "Recompensa ya canjeada" }
 * Response 404: { error: "Tarjeta no encontrada" }
 */

/**
 * POST /api/wallet/:serial/redeem
 * Canjea una recompensa completada (desde PWA)
 * 
 * Body:
 * {
 *   admin_key: "optional-admin-key"
 * }
 * 
 * Response 200:
 * {
 *   success: true,
 *   message: "Recompensa canjeada exitosamente",
 *   reward: "Café Gratis",
 *   new_collection_started: true
 * }
 * 
 * Response 400: { error: "No hay recompensa disponible" }
 * Response 404: { error: "Tarjeta no encontrada" }
 */

/**
 * GET /api/wallet/:serial/stats
 * Obtiene estadísticas de uso de la tarjeta
 * 
 * Response 200:
 * {
 *   card_type: "strips",
 *   member_since: "2025-01-15",
 *   days_as_member: 45,
 *   strips: { collected, required, percentage, is_complete },
 *   activity: { total_transactions, total_spent }
 * }
 */

/**
 * GET /api/wallet/business/:businessId/assets
 * Verifica disponibilidad de assets de un negocio
 * 
 * Response 200:
 * {
 *   business_id: 9,
 *   assets_available: { logo: true, strip_on: true, strip_off: true },
 *   urls: { logo: "https://...", strip_on: "https://...", strip_off: "https://..." },
 *   all_assets_ready: true
 * }
 */

/**
 * POST /api/wallet/update-points
 * Actualiza puntos de una tarjeta PWA desde el admin panel
 * 
 * Body:
 * {
 *   serial: "uuid",
 *   delta: 10  // positivo suma, negativo resta
 * }
 * 
 * Response 200:
 * {
 *   ok: true,
 *   points: 110,
 *   previous_points: 100
 * }
 */

/**
 * POST /api/wallet/add-stamp
 * Agrega un strip/stamp desde el admin panel
 * 
 * Body:
 * {
 *   serial: "uuid",
 *   stripNumber: 3  // opcional, se calcula automáticamente
 * }
 * 
 * Response 200:
 * {
 *   ok: true,
 *   strips_collected: 3,
 *   strips_required: 10,
 *   reward_title: "Café Gratis",
 *   isComplete: false
 * }
 */


/**
 * POST /api/wallet/reset-strips
 * Reinicia la colección de strips desde el admin panel
 * 
 * Body:
 * {
 *   serial: "uuid",
 *   redeemed: true  // true = canje, false = solo reset
 * }
 * 
 * Response 200:
 * {
 *   ok: true,
 *   message: "Premio canjeado y colección reiniciada"
 * }
 */