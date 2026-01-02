// routes/walletRoutes.js
const router = require('express').Router();
const auth = require('../../Middleware/authenticationMiddleware'); 
const walletController = require('../../controller/walletController'); 
const passkitCtrl = require('../../controller/passkitController');

// router.use(auth); // opcional: exigir JWT propio antes de emitir pases

/* ====================== GOOGLE WALLET ====================== */

// Método Legacy (mantiene compatibilidad con código existente)
router.post('/google', walletController.createGoogle);

// Método REST API (recomendado para nuevas implementaciones)
router.post('/google/rest-api', walletController.createGoogleRestApi);

// Método Unificado (auto-selección entre JWT y REST API)
router.post('/google/unified', walletController.createGoogleUnified);

// Actualizaciones específicas
router.patch('/google/points', walletController.updateGooglePoints);
router.patch('/google/strips', walletController.updateGoogleStrips);

// Utilidades
router.post('/google/ensure', walletController.ensureGoogleClass);
router.post('/google/debug', walletController.debugGoogle); 
router.post('/google/strips/reset', walletController.resetGoogleStrips); 
router.post('/google/debug-object', walletController.debugGoogleObject); 

/* ====================== APPLE WALLET ====================== */

// Crear .pkpass (mantiene compatibilidad total)
router.post('/apple', walletController.addToAppleWallet);

/* ====================== PASSKIT WEB SERVICE (Apple) ====================== */
// Endpoints requeridos por Apple para actualizaciones push

// Obtener versión actualizada del pase
router.get('/v1/passes/:passTypeId/:serial', passkitCtrl.getPass);

// Registrar dispositivo para recibir notificaciones push
router.post('/v1/devices/:deviceId/registrations/:passTypeId/:serial', passkitCtrl.registerDevice);

// Ruta temporal alternativa
router.post('/v1/devices/:deviceId/registrations_attido/:passTypeId/:serial', passkitCtrl.registerDevice);

// Listar todos los pases registrados en un dispositivo
router.get('/v1/devices/:deviceId/registrations/:passTypeId', passkitCtrl.listRegistrations);

// Desregistrar dispositivo
router.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serial', passkitCtrl.deregisterDevice);

// Logs (Apple envía logs de errores aquí)
router.post('/v1/log', passkitCtrl.acceptLogs);

/* ====================== INTERNAL ENDPOINTS (Gestión interna) ====================== */
// Endpoints para actualizar pases desde tu backend

// Actualizar puntos (Apple Wallet)
router.post('/internal/passes/:serial/points', passkitCtrl.bumpPoints);

// Otorgar strip (Apple Wallet - colección)
router.post('/internal/passes/:serial/strips', passkitCtrl.grantStrip);

// Reiniciar strips (Apple Wallet)
router.post('/internal/passes/:serial/reset-strips', passkitCtrl.resetStrips);

module.exports = router;

/* ====================== DOCUMENTACIÓN DE USO ====================== 

IMPORTANTE: Todas las rutas mantienen compatibilidad con código existente.
Los nuevos endpoints son ADICIONALES y opcionales.

═══════════════════════════════════════════════════════════════════════
GOOGLE WALLET - CREAR TARJETAS
═══════════════════════════════════════════════════════════════════════

1. MÉTODO LEGACY (JWT) - Mantiene compatibilidad 100%
───────────────────────────────────────────────────────────────────────
POST /api/wallets/google

// Ejemplo básico (código existente sigue funcionando)
{
  "cardCode": "GGL001",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "businessId": 1
}

// Ejemplo con variante POINTS
{
  "cardCode": "GGL001",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "businessId": 1,
  "variant": "points",
  "points": 250,
  "tier": "Oro",
  "since": "2024-01-15",
  "colors": {
    "background": "#2d3436",
    "foreground": "#E6E6E6"
  },
  "barcode": {
    "type": "qr",
    "message": "GGL001"
  }
}

// Ejemplo con variante STRIPS
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

Respuesta:
{
  "url": "https://pay.google.com/gp/v/save/...",
  "method": "jwt_legacy",
  "cardCode": "GGL001",
  "variant": "points"
}

2. MÉTODO REST API - Recomendado para nuevas implementaciones
───────────────────────────────────────────────────────────────────────
POST /api/wallets/google/rest-api

// Ventajas:
// - Actualización automática si el objeto ya existe
// - Mejor trazabilidad
// - No genera JWT en cada request

// Ejemplo POINTS
{
  "cardCode": "GGL003",
  "userName": "Pedro Gómez",
  "programName": "SuperMercado Plus",
  "businessId": 1,
  "variant": "points",
  "points": 1500,
  "tier": "Platino",
  "since": "2023-06-20"
}

// Ejemplo STRIPS
{
  "cardCode": "GGL004",
  "userName": "Ana Torres",
  "programName": "Pizza Club",
  "businessId": 3,
  "variant": "strips",
  "strips_collected": 9,
  "strips_required": 10,
  "reward_title": "Pizza familiar gratis",
  "isComplete": false
}

Respuesta:
{
  "success": true,
  "url": "https://pay.google.com/gp/v/save/...",
  "objectId": "1234567890.GGL003",
  "existed": false,
  "method": "rest_api",
  "cardCode": "GGL003",
  "variant": "points",
  "message": "Objeto creado exitosamente"
}

3. MÉTODO UNIFICADO - Auto-selección inteligente
───────────────────────────────────────────────────────────────────────
POST /api/wallets/google/unified

// Por defecto usa REST API, pero puedes forzar JWT
{
  "cardCode": "GGL005",
  "userName": "Luis Ramírez",
  "businessId": 4,
  "variant": "points",
  "points": 500,
  "useRestApi": true  // true (default) = REST API, false = JWT
}

═══════════════════════════════════════════════════════════════════════
GOOGLE WALLET - ACTUALIZAR TARJETAS
═══════════════════════════════════════════════════════════════════════

4. ACTUALIZAR PUNTOS
───────────────────────────────────────────────────────────────────────
PATCH /api/wallets/google/points

{
  "cardCode": "GGL001",
  "points": 500
}

Respuesta:
{
  "success": true,
  "ok": true,
  "objectId": "1234567890.GGL001",
  "points": 500,
  "message": "Puntos actualizados exitosamente"
}

5. ACTUALIZAR STRIPS
───────────────────────────────────────────────────────────────────────
PATCH /api/wallets/google/strips

{
  "cardCode": "GGL002",
  "strips_collected": 9,
  "strips_required": 10,
  "reward_title": "Café + postre gratis"
}

Respuesta:
{
  "success": true,
  "ok": true,
  "objectId": "1234567890.GGL002",
  "strips_collected": 9,
  "strips_required": 10,
  "isComplete": false,
  "message": "Strips actualizados exitosamente"
}

// Cuando se completa la colección:
{
  "cardCode": "GGL002",
  "strips_collected": 10,
  "strips_required": 10,
  "reward_title": "Café + postre gratis"
}

Respuesta:
{
  "success": true,
  "ok": true,
  "objectId": "1234567890.GGL002",
  "strips_collected": 10,
  "strips_required": 10,
  "isComplete": true,
  "message": "¡Colección completada!"
}

═══════════════════════════════════════════════════════════════════════
APPLE WALLET
═══════════════════════════════════════════════════════════════════════

6. CREAR .PKPASS
───────────────────────────────────────────────────────────────────────
POST /api/wallets/apple

// Ejemplo básico (código existente sigue funcionando)
{
  "cardCode": "APL001",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "businessId": 1
}

// Ejemplo con variante POINTS
{
  "cardCode": "APL001",
  "userName": "Juan Pérez",
  "programName": "Mi Programa",
  "businessId": 1,
  "variant": "points",
  "points": 250,
  "tier": "Oro",
  "since": "2024-01-15",
  "colors": {
    "background": "#2d3436",
    "foreground": "#E6E6E6"
  },
  "barcode": {
    "format": "qr"
  }
}

// Ejemplo con variante STRIPS
{
  "cardCode": "APL002",
  "userName": "María López",
  "programName": "Café Rewards",
  "businessId": 2,
  "variant": "strips",
  "strips_collected": 7,
  "strips_required": 10,
  "reward_title": "Café gratis",
  "isComplete": false
}

Respuesta: Archivo binario .pkpass (descarga automática)
Content-Type: application/vnd.apple.pkpass

═══════════════════════════════════════════════════════════════════════
PASSKIT WEB SERVICE (Apple) - No tocar, requerido por Apple
═══════════════════════════════════════════════════════════════════════

Estos endpoints son llamados automáticamente por iOS/watchOS/macOS:

GET  /api/wallets/v1/passes/:passTypeId/:serial
POST /api/wallets/v1/devices/:deviceId/registrations/:passTypeId/:serial
GET  /api/wallets/v1/devices/:deviceId/registrations/:passTypeId
DELETE /api/wallets/v1/devices/:deviceId/registrations/:passTypeId/:serial
POST /api/wallets/v1/log

═══════════════════════════════════════════════════════════════════════
INTERNAL ENDPOINTS - Gestión desde tu backend
═══════════════════════════════════════════════════════════════════════

7. ACTUALIZAR PUNTOS (Apple Wallet)
───────────────────────────────────────────────────────────────────────
POST /api/wallets/internal/passes/:serial/points

{
  "delta": 50  // Incrementar puntos
}

8. OTORGAR STRIP (Apple Wallet)
───────────────────────────────────────────────────────────────────────
POST /api/wallets/internal/passes/:serial/strips

{
  "count": 1  // Cantidad de strips a otorgar
}

9. REINICIAR STRIPS (Apple Wallet)
───────────────────────────────────────────────────────────────────────
POST /api/wallets/internal/passes/:serial/reset-strips

Sin body (resetea a 0 la colección)

═══════════════════════════════════════════════════════════════════════
UTILIDADES
═══════════════════════════════════════════════════════════════════════

10. ASEGURAR CLASE (Google Wallet)
────────────────────────────────────────────────────────────────────────
POST /api/wallets/google/ensure

{
  "businessId": 1,
  "programName": "Mi Programa",
  "bg": "#2d3436",
  "logoUri": "https://example.com/logo.png"
}

11. DEBUG JWT (Google Wallet) - SOLO DESARROLLO
────────────────────────────────────────────────────────────────────────
POST /api/wallets/google/debug

{
  "cardCode": "TEST001",
  "userName": "Test User",
  "businessId": 1,
  "variant": "strips",
  "strips_collected": 5,
  "strips_required": 10
}

Respuesta: Decodifica y muestra el JWT completo

═══════════════════════════════════════════════════════════════════════
FLUJOS RECOMENDADOS
═══════════════════════════════════════════════════════════════════════

FLUJO 1: Crear tarjeta de puntos (Google)
──────────────────────────────────────────────────────────────────────
1. POST /api/wallets/google/rest-api (crear tarjeta)
2. PATCH /api/wallets/google/points (actualizar puntos cuando cambian)

FLUJO 2: Crear tarjeta de colección (Google)
──────────────────────────────────────────────────────────────────────
1. POST /api/wallets/google/rest-api (crear tarjeta strips)
2. PATCH /api/wallets/google/strips (actualizar progreso)
3. Cuando isComplete = true, mostrar mensaje de felicitación

FLUJO 3: Crear tarjeta de puntos (Apple)
──────────────────────────────────────────────────────────────────────
1. POST /api/wallets/apple (crear .pkpass)
2. POST /api/wallets/internal/passes/:serial/points (actualizar puntos)
3. Apple notifica automáticamente al dispositivo vía push

FLUJO 4: Crear tarjeta de colección (Apple)
──────────────────────────────────────────────────────────────────────
1. POST /api/wallets/apple (crear .pkpass strips)
2. POST /api/wallets/internal/passes/:serial/strips (otorgar strips)
3. POST /api/wallets/internal/passes/:serial/reset-strips (cuando canjea premio)
4. Apple notifica automáticamente al dispositivo vía push

═══════════════════════════════════════════════════════════════════════
MIGRACIÓN DESDE CÓDIGO LEGACY
═══════════════════════════════════════════════════════════════════════

Si tienes código existente usando POST /api/wallets/google:
✅ NO NECESITAS CAMBIAR NADA - sigue funcionando igual

Para aprovechar las nuevas funcionalidades:
1. Cambia POST /api/wallets/google por /api/wallets/google/rest-api
2. Agrega el campo "variant": "points" o "strips"
3. Agrega campos específicos (points, strips_collected, etc.)
4. Usa PATCH endpoints para actualizaciones incrementales

═══════════════════════════════════════════════════════════════════════

*/


