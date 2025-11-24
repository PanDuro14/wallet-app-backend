// controllers/assetsController.js
const businessService = require('../services/businessService');
const carddetailService = require('../services/carddetailService');

/**
 * Servir logo del negocio directamente desde BD para Google Wallet
 * GET /api/public/assets/logo/:businessId
 */
const getBusinessLogo = async (req, res) => {
  try {
    const { businessId } = req.params;
    
    //console.log('[getBusinessLogo] Solicitado logo para businessId:', businessId);
    
    // Obtener datos desde BD
    const cdRes = await carddetailService.getOneCardByBusiness(businessId);
    const bizRes = await businessService.getOneBusiness(businessId);
    
    const cd = Array.isArray(cdRes) ? cdRes[0] : cdRes;
    const biz = Array.isArray(bizRes) ? bizRes[0] : bizRes;
    
    // Buscar logo buffer (orden de prioridad)
    let logoBuffer = null;
    
    // Prioridad 1: CardDetail
    if (cd) {
      logoBuffer = cd.logoBuffer || cd.logo || cd.logo_image || cd.image || cd.logo_png || null;
    }
    
    // Prioridad 2: Business
    if (!logoBuffer && biz) {
      logoBuffer = biz.logo || biz.logoBuffer || biz.image || biz.logo_png || null;
    }
    
    if (!logoBuffer) {
      ////console.warn('[getBusinessLogo] Logo no encontrado para businessId:', businessId);
      return res.status(404).json({ error: 'Logo no encontrado' });
    }
    
    // Convertir a Buffer
    let buffer;
    if (Buffer.isBuffer(logoBuffer)) {
      buffer = logoBuffer;
    } else if (logoBuffer instanceof Uint8Array) {
      buffer = Buffer.from(logoBuffer);
    } else if (typeof logoBuffer === 'object' && logoBuffer.type === 'Buffer' && Array.isArray(logoBuffer.data)) {
      buffer = Buffer.from(logoBuffer.data);
    } else {
      //console.error('[getBusinessLogo] Formato de buffer no reconocido:', typeof logoBuffer);
      return res.status(500).json({ error: 'Formato de imagen inválido' });
    }
    
    // Detectar tipo de imagen
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const isWebP = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    
    let contentType = 'image/png'; // Default
    if (isJPEG) contentType = 'image/jpeg';
    else if (isWebP) contentType = 'image/webp';
    
    //console.log('[getBusinessLogo] ✓ Sirviendo logo:', {
    //  businessId,
    //  size: buffer.length,
    //  type: contentType
    //});
    
    // Headers de cache para mejor performance
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400', // 24 horas
      'ETag': `"${businessId}-logo-${buffer.length}"`,
      'Content-Length': buffer.length
    });
    
    return res.send(buffer);
    
  } catch (error) {
    //console.error('[getBusinessLogo] Error:', error);
    return res.status(500).json({ 
      error: 'Error al obtener logo',
      details: error.message 
    });
  }
};

module.exports = { getBusinessLogo };