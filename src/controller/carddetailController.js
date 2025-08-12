const carddetailProcess = require('../processes/carddetailsProcess'); 
const businessProcess = require('../processes/businessProcess'); 

const getAllCardDetails = async(req, res) => {
    try {
        const cardDetails = await carddetailProcess.getAllCardDetails(); 
        res.status(200).json(cardDetails); 
    } catch (error){
        res.status(502).json({ error: 'Error al obtener todas las tarjetas'}); 
    }
}


const getOneCardDetails = async(req, res) => {
    try {
        const {id} = req.params; 
        const cardDetails = await carddetailProcess.getOneCardDetails(id); 
        res.status(200).json(cardDetails); 
    } catch (error){
        res.status(502).json({ error: `Error al obtener la tarjeta ${id}`}); 
    }
}

const createOneCardDetails = async(req, res) => {
    try {
        const { 
            business_id, background_color, foreground_color, 
            pass_type_id, terms, created_at, updated_at
        } = req.body; 

        const business = await businessProcess.getOneBusiness(business_id); 
        if(!business) {
            return res.status(404).json({ error: 'El negocio con ID proporcionado no existe'}); 
        }

        const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
        const strip_imageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

        if(!business_id || !background_color || !foreground_color || !pass_type_id || !terms /*|| !created_at || !updated_at*/){
            res.status(400).json({ error: 'Datos faltantes'}); 
        }

        if (!logoBuffer || !strip_imageBuffer) {
            return res.status(400).json({ error: 'Se requieren las imágenes del logo y strip' });
        }

        const cardDetails = await carddetailProcess.createOneCardDetails(
            business_id, background_color, foreground_color, pass_type_id, terms, 
            logoBuffer, strip_imageBuffer, created_at, updated_at); 

        if(cardDetails){
            res.status(200).json({ message: `Tarjeta agregada al negocio ${cardDetails.business_id}`}); 
        } else {
            res.status(400).json({ error: 'Datos inválidos'}); 
        }
    } catch (error){
        res.status(502).json({ error: 'Error al '}); 
    }
}

const updateCardDetails = async(req, res) => {
     try {
        const { id } = req.params;
        const {
            business_id, background_color, foreground_color,
            pass_type_id, terms, created_at, updated_at
        } = req.body;

        const business = await businessProcess.getOneBusiness(business_id);
        if (!business) {
            return res.status(404).json({ error: 'El negocio con ID proporcionado no existe' });
        }

        const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
        const strip_imageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

        const updatedCardDetails = await carddetailsProcess.updateCardDetails(
            business_id, background_color, foreground_color, pass_type_id, terms,
            logoBuffer, strip_imageBuffer, created_at, updated_at, id
        );

        if (updatedCardDetails) {
            res.status(200).json({ message: `Tarjeta de negocio ${id} actualizada` });
        } else {
            res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
    } catch (error) {
        console.error(error);
        res.status(502).json({ error: 'Error al actualizar el detalle de la tarjeta' });
    }
}

const deleteCardDetails = async(req, res) => {
    try {
        const { id } = req.params;
        const result = await carddetailProcess.deleteCardDetails(id);
        if (!result) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
        res.status(200).json({ message: 'Tarjeta eliminada con éxito' });
    } catch (error) {
        console.error(error);
        res.status(502).json({ error: 'Error al eliminar el detalle de la tarjeta' });
    }
}

const getAllCardsByBusiness = async(req, res) => {
    try {
        const { business_id } = req.params; 
        if(!business_id){
            return res.status(400).json({ error: 'business_id faltante'}); 
        }

        const result = await carddetailProcess.getAllCardsByBusiness(business_id); 
        if(!result){
            return res.status(404).json({ error: 'Tarjetas no encontradas'}); 
        }
        res.status(200).json(result); 
    } catch (error){
        console.error(error); 
        res.status(502).json({ error: 'Error al obtener las tarjeas'}); 
    }
}

const getOneCardByBusiness = async(req, res) => {
    try {
        const { business_id, id } = req.params; 
        if(!business_id){
            return res.status(400).json({ error: 'business_id faltante'}); 
        }

        if(!id){
            return res.status(400).json({ error: 'id faltante'}); 
        }
        const result = await carddetailProcess.getOneCardByBusiness(business_id, id); 
        
        if(!result){
            return res.status(404).json({ error: 'Tarjeta no encontrada'}); 
        }
        res.status(200).json(result); 
    } catch (error){
        console.error(error); 
        res.status(502).json({ error: 'Error al obtener la tarjea'}); 
    }
}

const generateQR = async (req, res) => {
  const { userId, businessId } = req.params;
  
  if (!userId || !businessId) {
    return res.status(400).json({ error: 'Faltan parámetros necesarios' });
  }
  
  try {
    const qrCode = await carddetailsProcess.generateQR(userId, businessId);
    res.status(200).json({ qrCode });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar el QR' });
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