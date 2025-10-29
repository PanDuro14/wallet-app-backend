// routes/publicAssets.js
// Este archivo expone las imágenes de businesses para que Google Wallet pueda descargarlas
const express = require('express');
const router = express.Router();
// db/appleWalletdb.js
const dbConnection = require('./dbConection');
const dbLocal = require('./dbConectionLocal');

let db;
(async () => {
  try {
    await dbConnection.connect();
    console.log('Conexión con la db remota exitosa: apple Wallet DB');
    db = dbConnection;
  } catch (errRemota) {
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message);
    try {
      await dbLocal.connect();
      console.log('Conexión con la db local exitosa: apple Wallet DB');
      db = dbLocal;
    } catch (errLocal) {
      console.error('Error al conectar con la db local: ', errLocal.message);
    }
  }
})();
/**
 * GET /api/public/assets/logo/:businessId
 * Google Wallet descarga el logo desde aquí cuando renderiza la tarjeta
 */
router.get('/logo/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const result = await db.query(
      'SELECT logo FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (!result.rows[0]?.logo) {
      console.warn(`[Public Assets] Logo not found for business ${businessId}`);
      return res.status(404).send('Logo not found');
    }
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache 24h
    res.send(result.rows[0].logo);
    
  } catch (error) {
    console.error('[Public Assets] Error serving logo:', error);
    res.status(500).send('Error loading logo');
  }
});

/**
 * GET /api/public/assets/strip-on/:businessId
 * Imagen de strip completado (encendido)
 */
router.get('/strip-on/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const result = await db.query(
      'SELECT strip_image_on FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (!result.rows[0]?.strip_image_on) {
      console.warn(`[Public Assets] strip_image_on not found for business ${businessId}`);
      return res.status(404).send('Strip ON image not found');
    }
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.rows[0].strip_image_on);
    
  } catch (error) {
    console.error('[Public Assets] Error serving strip-on:', error);
    res.status(500).send('Error loading strip image');
  }
});

/**
 * GET /api/public/assets/strip-off/:businessId
 * Imagen de strip pendiente (apagado)
 */
router.get('/strip-off/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const result = await db.query(
      'SELECT strip_image_off FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (!result.rows[0]?.strip_image_off) {
      console.warn(`[Public Assets] strip_image_off not found for business ${businessId}`);
      return res.status(404).send('Strip OFF image not found');
    }
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.rows[0].strip_image_off);
    
  } catch (error) {
    console.error('[Public Assets] Error serving strip-off:', error);
    res.status(500).send('Error loading strip image');
  }
});

/**
 * GET /api/public/assets/test/:businessId
 * Endpoint de prueba para verificar qué imágenes tiene un negocio
 */
router.get('/test/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const result = await db.query(`
      SELECT 
        id,
        name,
        CASE WHEN logo IS NOT NULL THEN length(logo) ELSE NULL END as logo_size,
        CASE WHEN strip_image_on IS NOT NULL THEN length(strip_image_on) ELSE NULL END as strip_on_size,
        CASE WHEN strip_image_off IS NOT NULL THEN length(strip_image_off) ELSE NULL END as strip_off_size
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const data = result.rows[0];
    const baseUrl = process.env.PUBLIC_BASE_URL || 
                    process.env.WALLET_BASE_URL || 
                    `${req.protocol}://${req.get('host')}`;
    
    res.json({
      business_id: data.id,
      name: data.name,
      base_url: baseUrl,
      assets: {
        logo: {
          exists: !!data.logo_size,
          size_bytes: data.logo_size,
          url: data.logo_size ? `${baseUrl}/api/public/assets/logo/${businessId}` : null
        },
        strip_on: {
          exists: !!data.strip_on_size,
          size_bytes: data.strip_on_size,
          url: data.strip_on_size ? `${baseUrl}/api/public/assets/strip-on/${businessId}` : null
        },
        strip_off: {
          exists: !!data.strip_off_size,
          size_bytes: data.strip_off_size,
          url: data.strip_off_size ? `${baseUrl}/api/public/assets/strip-off/${businessId}` : null
        }
      },
      note: 'Estas URLs son las que Google Wallet usa para descargar las imágenes'
    });
    
  } catch (error) {
    console.error('[Public Assets] Error in test endpoint:', error);
    res.status(500).json({ error: 'Error checking assets' });
  }
});

module.exports = router;