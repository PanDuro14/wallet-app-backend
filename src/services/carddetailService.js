const cardDetailDb = require('../db/cardDetailsdb'); 

const getAllCardDetails = async() => {
    const cardDetal = await cardDetailDb.getAllCardDetails(); 
    return cardDetal; 
}

const getOneCardDetails = async(id) => {
    const cardDetail = await cardDetailDb.getOneCardDetails(id); 
    return cardDetail; 
}

const createOneCardDetails = async(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at) => {
    const cardDetail = await cardDetailDb.createOneCardDetails(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at);
    return cardDetail; 
}

const updateCardDetails = async(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id) => {
    const cardDetail = await cardDetailDb.updateCardDetails(business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id); 
    return cardDetail; 
}

const deleteCardDetails = async (id) => {
    const cardDetail = await cardDetailDb.deleteCardDetails(id); 
    return cardDetail; 
}

module.exports = {
    getAllCardDetails,
    getOneCardDetails,
    createOneCardDetails,
    updateCardDetails, 
    deleteCardDetails
}
