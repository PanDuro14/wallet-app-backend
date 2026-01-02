// services/carddetailService.js

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

const getAllCardsByBusiness = async(business_id) =>{
    const cardDetail = await cardDetailDb.getAllCardsByBusiness(business_id); 
    return cardDetail; 
}

const getOneCardByBusiness = async(business_id, id) => {
    const cardDetail = await cardDetailDb.getOneCardByBusiness(business_id, id); 
    return cardDetail; 
}

// ACTUALIZADO: Validar rewardSystem antes de crear
const createUnifiedDesign = async (payload) => {
  const { design_json } = payload;
  
  // Parsear si viene como string
  let dj = design_json;
  if (typeof dj === 'string') {
    dj = JSON.parse(dj);
  }
  
  // Validar rewardSystem si existe
  if (dj?.rewardSystem) {
    validateRewardSystem(dj.rewardSystem);
  }
  
  return cardDetailDb.createUnifiedDesign(payload);
};

const updateUnifiedDesign = (payload) => cardDetailDb.updateUnifiedDesign(payload);

const deleteByIdBusiness = async(id) => {
    const cardDetail = await cardDetailDb.deleteByIdBusiness(id); 
    return cardDetail; 
}

const updateMeta = ({ id, pass_type_id, terms }) => {
  return cardDetailDb.updateMeta(id, { pass_type_id, terms });
};

const getActiveCardByBusiness = async(business_id) => {
    const cardDetail = await cardDetailDb.getActiveCardByBusiness(business_id); 
    return cardDetail; 
}

/* ====================== REWARD SYSTEM ====================== */

// Validar estructura de reward system 
const validateRewardSystem = (rewardSystem) => {
    if (!rewardSystem || typeof rewardSystem !== 'object'){
        return false; 
    }

    const type = rewardSystem.type || 'single'; 

    if (!['single', 'multi-tier'].includes(type)) {
        throw new Error('rewardSystem.type debe ser "single" o "multi-tier"'); 
    }

    if (type === 'single'){
        const s = rewardSystem.single; 
        if (!s) return true; // Se usará default
        
        if (s.strips_required && (!Number.isInteger(s.strips_required) || s.strips_required < 1)) {
            throw new Error('single.strips_required debe ser un numero entero positivo'); 
        }
    }

    if (type === 'multi-tier') {
        const mt = rewardSystem.multiTier; 
        if (!mt || !Array.isArray(mt.rewards) || mt.rewards.length === 0) {
            throw new Error('multi-tier requiere al menos 1 reward en multiTier.rewards[]'); 
        }

        mt.rewards.forEach((reward, idx) => {
            if (!reward.title || typeof reward.title !== 'string') {
                throw new Error(`Reward ${idx + 1}: title es obligatorio`); 
            }
            if (!Number.isInteger(reward.strips_required) || reward.strips_required < 1){
                throw new Error(`Reward ${idx + 1}: strips_required debe ser un numero entero positivo`); 
            }
        }); 
    }
    
    return true; 
}

// Normalizar reward system (agregar defaults)
const normalizeRewardSystem = (rewardSystem, cardType) => {
    if (cardType !== 'strips'){
        return null; 
    }

    // Si no hay rewardSystem, usar default
    if (!rewardSystem){
        return {
            type: 'single', 
            single: {
                strips_required: 10, // Default general
                reward_title: 'Recompensa',
                reward_description: null
            }
        };
    }

    const type = rewardSystem.type || 'single'; 

    if (type === 'single') {
        return {
            type: 'single',
            single: {
                strips_required: rewardSystem.single?.strips_required || 8, 
                reward_title: rewardSystem.single?.reward_title || 'Recompensa', 
                reward_description: rewardSystem.single?.reward_description || null
            }
        }; 
    }

    if (type === 'multi-tier'){
        return {
            type: 'multi-tier',
            multiTier: {
                rewards: rewardSystem.multiTier.rewards.map((r, idx) => ({
                    level: idx + 1, 
                    title: r.title, 
                    description: r.description || null, 
                    strips_required: r.strips_required, 
                    icon: r.icon || null
                }))
            }
        }; 
    }

    return rewardSystem; 
}

// Obtener configuración de rewards desde design_json
const getRewardSystemConfig = async (card_detail_id) => {
  const design = await cardDetailDb.getOneCardDetails(card_detail_id);
  
  if (!design || !design.design_json) {
    // Default para diseños sin configuración
    return { 
      type: 'single', 
      single: { 
        strips_required: 10,
        reward_title: 'Recompensa',
        reward_description: null
      } 
    };
  }
  
  const dj = typeof design.design_json === 'string' 
    ? JSON.parse(design.design_json) 
    : design.design_json;
  
  // Si tiene rewardSystem, normalizarlo y retornar
  if (dj.rewardSystem) {
    return normalizeRewardSystem(dj.rewardSystem, dj.cardType);
  }
  
  // Legacy: no tiene rewardSystem, usar default
  return { 
    type: 'single', 
    single: { 
      strips_required: 10,
      reward_title: 'Recompensa',
      reward_description: null
    } 
  };
};

module.exports = {
    getAllCardDetails,
    getOneCardDetails,
    createOneCardDetails,
    updateCardDetails, 
    deleteCardDetails, 
    getAllCardsByBusiness, 
    getOneCardByBusiness, 
    getActiveCardByBusiness,
    createUnifiedDesign, 
    updateUnifiedDesign, 
    deleteByIdBusiness, 
    updateMeta, 
    validateRewardSystem,
    normalizeRewardSystem,
    getRewardSystemConfig
}