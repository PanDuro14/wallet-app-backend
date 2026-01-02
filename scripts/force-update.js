// force-update.js

const { forceUpdateAllStripsPasses } = require('../src/db/appleWalletdb');

async function run() {
  try {
    // Esperar a que la conexión esté lista
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = await forceUpdateAllStripsPasses();
    
    if (result.success) {
      console.log(' Actualización completada exitosamente');
      process.exit(0);
    } else {
      console.log(' Actualización falló:', result.error || result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error(' Error fatal:', error);
    process.exit(1);
  }
}

run();