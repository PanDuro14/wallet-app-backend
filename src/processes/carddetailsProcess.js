const cardDetalService = require('../services/carddetailService'); 
const QRCode = require('qrcode');

const getAllCardDetails = async() => {
    const cardDetal = await cardDetalService.getAllCardDetails(); 
    return cardDetal; 
}

const getOneCardDetails = async(id) => {
    const cardDetail = await cardDetalService.getOneCardDetails(id); 
    return cardDetail; 
}

const createOneCardDetails = async(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at) => {
    const cardDetail = await cardDetalService.createOneCardDetails(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at);
    return cardDetail; 
}

const updateCardDetails = async(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id) => {
    const cardDetail = await cardDetalService.updateCardDetails(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id); 
    return cardDetail; 
}

const deleteCardDetails = async (id) => {
    const cardDetail = await cardDetalService.deleteCardDetails(id); 
    return cardDetail; 
}

const getAllCardsByBusiness = async(business_id) =>{
    const cardDetail = await cardDetalService.getAllCardsByBusiness(business_id); 
    return cardDetail; 
}
const getOneCardByBusiness = async(business_id, id) => {
    const cardDetail = await cardDetalService.getOneCardByBusiness(business_id, id); 
    return cardDetail; 
}

const generateQR = async (userId, businessId) => {
  const url = `https://mywalletapp.com/qr/${userId}/${businessId}`;  // Este URL debe llevar a la ruta de redirección en la app móvil o en la web.
  try {
    const qrCode = await QRCode.toDataURL(url);
    return qrCode;
  } catch (err) {
    throw new Error('Error al generar el QR');
  }
};


module.exports = {
    getAllCardDetails,
    getOneCardDetails,
    createOneCardDetails,
    updateCardDetails, 
    deleteCardDetails, 
    getAllCardsByBusiness, 
    getOneCardByBusiness,
    generateQR
}
