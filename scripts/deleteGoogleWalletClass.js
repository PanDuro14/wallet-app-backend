require('dotenv').config();
const { google } = require('googleapis');

const businessId = process.argv[2] || '9';
const issuerId = process.env.GOOGLE_ISSUER_ID;
const SA_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

if (!SA_JSON_BASE64) {
  console.error(' GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 no está configurado en .env');
  process.exit(1);
}

// Decodificar credenciales desde base64
let credentials;
try {
  const jsonString = Buffer.from(SA_JSON_BASE64, 'base64').toString('utf-8');
  credentials = JSON.parse(jsonString);
  console.log(' Credenciales cargadas desde .env');
  console.log(`  Project: ${credentials.project_id}`);
  console.log(`  Email: ${credentials.client_email}`);
} catch (error) {
  console.error(' Error decodificando credenciales:', error.message);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
});

async function deleteClass() {
  console.log(`\n Borrando clase para businessId: ${businessId}`);
  console.log(`   Issuer: ${issuerId}\n`);
  
  const client = await auth.getClient();
  const walletobjects = google.walletobjects({ version: 'v1', auth: client });
  
  try {
    // 1. Lista todas las clases
    console.log(` Listando clases existentes...`);
    const listResponse = await walletobjects.loyaltyclass.list({ issuerId });
    
    if (!listResponse.data.resources || listResponse.data.resources.length === 0) {
      console.log('  No hay clases registradas para este issuer');
      return;
    }
    
    console.log(`\n Encontradas ${listResponse.data.resources.length} clase(s):\n`);
    listResponse.data.resources.forEach(cls => {
      console.log(`  ${cls.id}`);
      console.log(`     Status: ${cls.reviewStatus}`);
      console.log(`     Program: ${cls.programName || 'N/A'}`);
      console.log(`     Background: ${cls.hexBackgroundColor || 'N/A'}`);
      console.log('');
    });
    
    // 2. Busca la clase específica
    const classId = `${issuerId}.loyalty_biz_${businessId}`;
    const existingClass = listResponse.data.resources.find(c => c.id === classId);
    
    if (!existingClass) {
      console.log(`  La clase ${classId} NO existe`);
      console.log('\nPosibles causas:');
      console.log('  1. Ya fue eliminada previamente');
      console.log('  2. El businessId es incorrecto');
      console.log('  3. Nunca se creó una clase para este business');
      return;
    }
    
    console.log(` Clase encontrada para eliminar:`);
    console.log(`   ID: ${existingClass.id}`);
    console.log(`   Status: ${existingClass.reviewStatus}`);
    console.log(`   Background: ${existingClass.hexBackgroundColor}`);
    
    // 3. Si está APPROVED, no se puede eliminar directamente
    if (existingClass.reviewStatus === 'approved') {
      console.log('\n  CLASE APROBADA - No se puede eliminar via API');
      console.log('\n Opciones disponibles:');
      console.log('  A) Usar un nuevo businessId (recomendado)');
      console.log('     → Crea tarjetas con business_id = 10, 11, etc.');
      console.log('  B) Contactar Google Wallet Support');
      console.log('     → Solicitar eliminación manual');
      console.log('  C) Convivir con los colores actuales');
      console.log(`     → Background: ${existingClass.hexBackgroundColor}`);
      return;
    }
    
    // 4. Intenta eliminar (solo funciona si es DRAFT)
    console.log(`\n  Eliminando clase...`);
    await walletobjects.loyaltyclass.delete({
      resourceId: classId
    });
    
    console.log(' Clase eliminada exitosamente\n');
    console.log(' Ahora puedes crear una nueva tarjeta con colores actualizados');
    
  } catch (error) {
    console.error('\n Error:', error.message);
    
    if (error.code === 404) {
      console.log('La clase no existe (404)');
    } else if (error.code === 400) {
      console.log('Error 400 - Posiblemente la clase está APPROVED');
      console.log('Las clases aprobadas no se pueden eliminar via API');
    } else if (error.errors) {
      console.error('Detalles:', JSON.stringify(error.errors, null, 2));
    }
  }
}

deleteClass().catch(err => {
  console.error(' Error fatal:', err);
  process.exit(1);
});