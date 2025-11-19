const usersDb = require('../db/usersDB');
const notificationService = require('../services/notificationService');

const getAllUsers = async () => usersDb.getAllUsers();
const getOneUser  = async (id) => usersDb.getOneUser(id);
const getOneUserByBusiness = async(id) => usersDb.getOneUserByBusiness(id); 

// ===== CREATE USER CON NOTIFICACIÓN DE BIENVENIDA =====
const createUser = async (...args) => {
  let newUser;
  
  // Crear usuario (compatible con ambas firmas)
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    newUser = await usersDb.createUserFull(args[0]); 
  } else {
    const [name, email, phone, business_id, points = 0, serial_number = null] = args;
    newUser = await usersDb.createUser(name, email, phone, business_id, points, serial_number);
  }

  // Enviar bienvenida automáticamente (sin bloquear la creación)
  if (newUser?.id && newUser?.serial_number) {
    setImmediate(async () => {
      try {
        const lang = newUser.lang || 'es';
        await notificationService.sendWelcomeNotification(
          newUser.serial_number,
          newUser.id,
          lang
        );
        console.log(`✅ Bienvenida enviada a usuario ${newUser.id}`);
      } catch (error) {
        console.error(`❌ Error enviando bienvenida a usuario ${newUser.id}:`, error.message);
        // No lanzar error para no afectar la creación
      }
    });
  }

  return newUser;
};

// ===== UPDATE USER CON DETECCIÓN AUTOMÁTICA DE NOTIFICACIONES =====
const updateUser = async (id, arg2, email, phone) => {
  let updatedUser;
  let patchObj = {};

  // Determinar qué estamos actualizando
  if (arg2 && typeof arg2 === 'object') {
    patchObj = arg2;
    updatedUser = await usersDb.updateUserFields(id, patchObj);
  } else {
    updatedUser = await usersDb.updateUser(id, arg2, email, phone);
  }

  // Detectar qué tipo de actualización fue y notificar (asíncrono, sin bloquear)
  if (updatedUser) {
    setImmediate(async () => {
      try {
        await _handleUpdateNotifications(id, updatedUser, patchObj);
      } catch (error) {
        console.error(`❌ Error enviando notificaciones para usuario ${id}:`, error.message);
      }
    });
  }

  return updatedUser;
};

// ===== HELPER PRIVADO: DETECTA Y ENVÍA NOTIFICACIONES SEGÚN EL CAMPO ACTUALIZADO =====
async function _handleUpdateNotifications(userId, updatedUser, patchObj) {
  const lang = updatedUser.lang || 'es';
  const { serial_number, card_type, points, strips_collected, strips_required } = updatedUser;

  if (!serial_number) {
    console.log(`⚠️ Usuario ${userId} no tiene serial_number, omitiendo notificaciones`);
    return;
  }

  // ===== CASO 1: ACTUALIZACIÓN DE PUNTOS =====
  if (patchObj.points !== undefined || patchObj.hasOwnProperty('points')) {
    console.log(`📊 Detectada actualización de puntos para usuario ${userId}: ${points} puntos`);
    
    await notificationService.sendPointsUpdateNotification(
      serial_number,
      userId,
      points || 0,
      lang
    );
    
    console.log(`✅ Notificación de puntos enviada a usuario ${userId}`);
    return; // Solo una notificación por actualización
  }

  // ===== CASO 2: ACTUALIZACIÓN DE STRIPS =====
  if (patchObj.strips_collected !== undefined || patchObj.hasOwnProperty('strips_collected')) {
    const collected = strips_collected || 0;
    const required = strips_required || 10;
    
    console.log(`🎫 Detectada actualización de strips para usuario ${userId}: ${collected}/${required}`);

    // Verificar si completó la colección
    if (collected >= required) {
      console.log(`🎉 Usuario ${userId} completó su colección!`);
      
      await notificationService.sendCompletionNotification(
        serial_number,
        userId,
        'strips',
        lang
      );
      
      console.log(`✅ Notificación de completación enviada a usuario ${userId}`);
    } else {
      // Progreso normal
      await notificationService.sendStripsUpdateNotification(
        serial_number,
        userId,
        collected,
        required,
        lang
      );
      
      console.log(`✅ Notificación de progreso enviada a usuario ${userId}`);
    }
    
    return;
  }

  // ===== CASO 3: CAMBIO DE REWARD_UNLOCKED (premio desbloqueado) =====
  if (patchObj.reward_unlocked === true) {
    const rewardTitle = patchObj.reward_title || updatedUser.reward_title || 'Tu premio';
    
    console.log(`🎁 Premio desbloqueado para usuario ${userId}: ${rewardTitle}`);
    
    await notificationService.sendRewardReadyNotification(
      serial_number,
      userId,
      rewardTitle,
      lang
    );
    
    console.log(`✅ Notificación de premio enviada a usuario ${userId}`);
    return;
  }

  // Si no es ninguno de los casos anteriores, no enviar notificación
  console.log(`ℹ️ Actualización de usuario ${userId} sin notificaciones automáticas`);
}

// ===== MÉTODOS ESPECÍFICOS PARA ACTUALIZAR CON NOTIFICACIONES EXPLÍCITAS =====

/**
 * Actualiza puntos y envía notificación
 * @param {number} userId - ID del usuario
 * @param {number} deltaPoints - Puntos a agregar (puede ser negativo)
 * @param {string} lang - Idioma (es/en)
 */
const updatePoints = async (userId, deltaPoints, lang = 'es') => {
  // Obtener puntos actuales
  const currentUser = await usersDb.getOneUser(userId);
  if (!currentUser) {
    throw new Error(`Usuario ${userId} no encontrado`);
  }

  const currentPoints = currentUser.points || 0;
  const newPoints = Math.max(0, currentPoints + deltaPoints); // No permitir negativos

  // Actualizar en BD
  const updatedUser = await usersDb.updateUserFields(userId, { 
    points: newPoints 
  });

  // Enviar notificación (asíncrono)
  if (updatedUser?.serial_number) {
    setImmediate(async () => {
      try {
        await notificationService.sendPointsUpdateNotification(
          updatedUser.serial_number,
          userId,
          newPoints,
          lang
        );
        console.log(`✅ Notificación de puntos enviada a usuario ${userId}`);
      } catch (error) {
        console.error(`❌ Error enviando notificación a usuario ${userId}:`, error.message);
      }
    });
  }

  return updatedUser;
};

/**
 * Actualiza strips y envía notificación (con detección de completación)
 * @param {number} userId - ID del usuario
 * @param {number} deltaStrips - Strips a agregar
 * @param {string} lang - Idioma (es/en)
 */
const updateStrips = async (userId, deltaStrips, lang = 'es') => {
  // Obtener datos actuales
  const currentUser = await usersDb.getOneUser(userId);
  if (!currentUser) {
    throw new Error(`Usuario ${userId} no encontrado`);
  }

  const currentStrips = currentUser.strips_collected || 0;
  const requiredStrips = currentUser.strips_required || 10;
  const newStrips = Math.min(requiredStrips, currentStrips + deltaStrips); // No exceder el máximo

  // Actualizar en BD
  const updatedUser = await usersDb.updateUserFields(userId, { 
    strips_collected: newStrips 
  });

  // Verificar completación y enviar notificación apropiada (asíncrono)
  if (updatedUser?.serial_number) {
    setImmediate(async () => {
      try {
        if (newStrips >= requiredStrips) {
          // Completó la colección
          await notificationService.sendCompletionNotification(
            updatedUser.serial_number,
            userId,
            'strips',
            lang
          );
          console.log(`🎉 Usuario ${userId} completó su colección (${newStrips}/${requiredStrips})`);
        } else {
          // Progreso normal
          await notificationService.sendStripsUpdateNotification(
            updatedUser.serial_number,
            userId,
            newStrips,
            requiredStrips,
            lang
          );
          console.log(`✅ Progreso actualizado para usuario ${userId} (${newStrips}/${requiredStrips})`);
        }
      } catch (error) {
        console.error(`❌ Error enviando notificación a usuario ${userId}:`, error.message);
      }
    });
  }

  return updatedUser;
};

/**
 * Envía recordatorio manualmente a un usuario
 * @param {number} userId - ID del usuario
 * @param {string} lang - Idioma (es/en)
 */
const sendReminderToUser = async (userId, lang = 'es') => {
  const user = await usersDb.getOneUser(userId);
  
  if (!user) {
    throw new Error(`Usuario ${userId} no encontrado`);
  }

  if (!user.serial_number) {
    throw new Error(`Usuario ${userId} no tiene serial_number`);
  }

  return await notificationService.sendReminderNotification(
    user.serial_number,
    userId,
    lang
  );
};

/**
 * Obtiene usuarios inactivos (para recordatorios masivos)
 * @param {number} inactiveDays - Días de inactividad
 * @param {number} businessId - (Opcional) Filtrar por negocio
 */
const getInactiveUsers = async (inactiveDays = 7, businessId = null) => {
  try {
    return await usersDb.getInactiveUsers(inactiveDays, businessId);
  } catch (error) {
    // Si el método no existe en usersDb, retornar array vacío
    console.warn('Método getInactiveUsers no implementado en usersDb');
    return [];
  }
};

// ===== MÉTODOS ORIGINALES SIN CAMBIOS =====
const deleteUser      = async (id) => usersDb.deleteUser(id);
const saveUserWallet  = async ({ userId, loyalty_account_id, wallet_url }) => usersDb.saveUserWallet({ userId, loyalty_account_id, wallet_url });
const markWalletAdded = async ({ userId }) => usersDb.markWalletAdded({ userId });

const getUserDataBySerial = async ({ serial }) => {
  try {
    return await usersDb.getUserDataBySerial(serial);
  } catch (error) {
    throw new Error('Error en el servicio de obtención de usuario: ' + error.message);
  }
};

module.exports = {
  // Métodos originales (ahora con notificaciones automáticas)
  getAllUsers,
  getOneUser,
  getOneUserByBusiness,
  createUser,          // ✅ Con bienvenida automática
  updateUser,          // ✅ Con detección automática de notificaciones
  deleteUser,
  saveUserWallet,
  markWalletAdded, 
  getUserDataBySerial,
  
  // Nuevos métodos específicos para actualizar con notificaciones
  updatePoints,        // ✅ Actualiza puntos + notifica
  updateStrips,        // ✅ Actualiza strips + notifica con detección de completación
  sendReminderToUser,  // ✅ Envía recordatorio manual
  getInactiveUsers     // ✅ Para cron jobs de recordatorios masivos
};