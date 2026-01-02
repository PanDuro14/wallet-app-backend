// processes/tierProcess.js
const usersService = require('../services/usersService');  
const carddetailService = require('../services/carddetailService');

const getTierInfo = async (userId) => {
  try {
    console.log('[tierProcess.getTierInfo] Procesando userId:', userId);

    // 1. Obtener usuario desde servicio
    const user = await usersService.getUserById(userId);  

    if (!user) {
      console.log('[tierProcess.getTierInfo] Usuario no encontrado');
      return null;
    }

    console.log('[tierProcess.getTierInfo] Usuario obtenido:', {
      id: user.id,
      name: user.name,
      card_type: user.card_type,
      card_detail_id: user.card_detail_id,
      reward_title: user.reward_title
    });

    // 2. Si no es strips, retornar tipo simple
    if (user.card_type !== 'strips') {
      return { type: 'points' };
    }

    // 3. Validar que tenga card_detail_id
    if (!user.card_detail_id) {
      console.log('[tierProcess.getTierInfo] Usuario sin card_detail_id');
      return { type: 'single-tier' };
    }

    // 4. Obtener configuración de recompensas
    const rewardConfig = await carddetailService.getRewardSystemConfig(user.card_detail_id);

    if (!rewardConfig) {
      console.log('[tierProcess.getTierInfo] No se encontró reward config');
      return { type: 'single-tier' };
    }

    console.log('[tierProcess.getTierInfo] Reward system type:', rewardConfig.type);

    // 5. Si no es multi-tier, retornar single-tier
    if (rewardConfig.type !== 'multi-tier') {
      return { type: 'single-tier' };
    }

    // 6. Calcular tier actual usando reward_title del usuario
    const tierInfo = usersService.calculateCurrentTier(
      {
        strips_collected: user.strips_collected || 0,
        strips_required: user.strips_required || 10,
        reward_title: user.reward_title
      },
      rewardConfig.multiTier
    );

    console.log('[tierProcess.getTierInfo] Tier calculado:', {
      currentLevel: tierInfo.currentLevel,
      totalLevels: tierInfo.totalLevels,
      currentReward: tierInfo.currentReward.title,
      nextReward: tierInfo.nextReward?.title
    });

    // 7. Calcular strips en el tier actual
    const previousTierLimit = tierInfo.currentLevel === 1
      ? 0
      : rewardConfig.multiTier.rewards[tierInfo.currentLevel - 2].strips_required;

    const stripsInCurrentTier = user.strips_collected - previousTierLimit;

    // 8. Construir respuesta procesada
    return {
      type: 'multi-tier',
      current_level: tierInfo.currentLevel,
      total_levels: tierInfo.totalLevels,
      current_reward: tierInfo.currentReward.title,
      next_reward: tierInfo.nextReward?.title || null,
      strips_in_current_tier: stripsInCurrentTier
    };

  } catch (error) {
    console.error('[tierProcess.getTierInfo] Error:', error);
    throw error;
  }
};

module.exports = {
  getTierInfo
};