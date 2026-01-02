// jobs/notificationCronJobs.js
// Tareas automáticas programadas para enviar notificaciones

const notificationService = require('../services/notificationService');

/**
 * NOTA: Este archivo es OPCIONAL
 * 
 * Si lo activas, ejecutará tareas automáticas como:
 * - Enviar recordatorios a usuarios inactivos cada semana
 * - Verificar completaciones diarias
 * - Limpiar tokens expirados
 * 
 * Si NO lo usas, simplemente no llames startAllCronJobs() en index.js
 */

let cron;
try {
  cron = require('node-cron');
} catch (e) {
  console.warn(' node-cron no instalado. Cron jobs deshabilitados.');
  console.warn('Para habilitar: npm install node-cron');
}

/**
 * Cron job para enviar recordatorios a usuarios inactivos
 * Se ejecuta todos los lunes a las 10:00 AM
 */
function scheduleInactivityReminders() {
  if (!cron) return;
  
  // Ejecutar cada lunes a las 10:00 AM
  cron.schedule('0 10 * * 1', async () => {
    console.log(' [Cron] Iniciando envío de recordatorios de inactividad...');
    
    try {
      // Obtener usuarios inactivos por más de 7 días
      const usersProcess = require('../processes/usersProcess');
      
      let inactiveUsers = [];
      try {
        inactiveUsers = await usersProcess.getInactiveUsers(7);
      } catch (error) {
        console.log(' [Cron] getInactiveUsers no implementado aún');
        return;
      }
      
      console.log(` [Cron] ${inactiveUsers.length} usuarios inactivos encontrados`);
      
      let sent = 0;
      let failed = 0;
      
      for (const user of inactiveUsers) {
        try {
          await notificationService.sendReminderNotification(
            user.serial_number,
            user.id,
            user.lang || 'es'
          );
          sent++;
          
          // Pequeño delay para no saturar
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(` [Cron] Error enviando recordatorio a usuario ${user.id}:`, error.message);
          failed++;
        }
      }
      
      console.log(` [Cron] Recordatorios completados: ${sent} enviados, ${failed} fallidos`);
      
    } catch (error) {
      console.error(' [Cron] Error en proceso de recordatorios:', error);
    }
  }, {
    timezone: "America/Mexico_City" // Ajusta a tu zona horaria
  });
  
  console.log(' Cron job de recordatorios programado (Lunes 10:00 AM)');
}

/**
 * Cron job para verificar colecciones completadas
 * Se ejecuta todos los días a las 8:00 PM
 */
function scheduleCompletionChecks() {
  if (!cron) return;
  
  // Ejecutar diariamente a las 8:00 PM
  cron.schedule('0 20 * * *', async () => {
    console.log(' [Cron] Verificando colecciones completadas...');
    
    try {
      // Query para encontrar usuarios que completaron hoy
      // TODO: Implementar query en usersDb
      
      console.log(' [Cron] Verificación de completaciones finalizada');
      
    } catch (error) {
      console.error(' [Cron] Error en verificación de completaciones:', error);
    }
  }, {
    timezone: "America/Mexico_City"
  });
  
  console.log(' Cron job de completaciones programado (Diario 8:00 PM)');
}

/**
 * Cron job para limpiar tokens expirados de Apple Wallet
 * Se ejecuta cada domingo a las 3:00 AM
 */
function scheduleTokenCleanup() {
  if (!cron) return;
  
  cron.schedule('0 3 * * 0', async () => {
    console.log(' [Cron] Limpiando tokens expirados...');
    
    try {
      // TODO: Implementar limpieza de tokens
      console.log(' [Cron] Limpieza de tokens completada');
    } catch (error) {
      console.error(' [Cron] Error limpiando tokens:', error);
    }
  }, {
    timezone: "America/Mexico_City"
  });
  
  console.log(' Cron job de limpieza programado (Domingo 3:00 AM)');
}

/**
 * Inicia todos los cron jobs
 */
function startAllCronJobs() {
  if (!cron) {
    console.log(' Cron jobs deshabilitados (node-cron no instalado)');
    return;
  }
  
  console.log(' Iniciando cron jobs de notificaciones...');
  
  scheduleInactivityReminders();
  scheduleCompletionChecks();
  scheduleTokenCleanup();
  
  console.log(' Todos los cron jobs iniciados correctamente');
}

module.exports = {
  startAllCronJobs,
  scheduleInactivityReminders,
  scheduleCompletionChecks,
  scheduleTokenCleanup
};