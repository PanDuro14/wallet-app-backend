// scripts/deleteGoogleWalletClass.js
// USO: node scripts/deleteGoogleWalletClass.js 9
//
// Este script BORRA la clase de Google Wallet para un businessId
// permitiendo que se cree nuevamente con colores actualizados

require("dotenv").config();
const path = require("path");

// Cargar el servicio
const googleWalletService = require(path.join(__dirname, "../services/googleWalletService"));

// Main
const businessId = process.argv[2];

if (!businessId) {
  console.error("❌ Uso: node scripts/deleteGoogleWalletClass.js <businessId>");
  console.error("   Ejemplo: node scripts/deleteGoogleWalletClass.js 9");
  process.exit(1);
}

console.log("🔥 Borrando clase de Google Wallet para businessId:", businessId);
console.log("ℹ️  Después de esto, crea una nueva tarjeta para que se recree con colores actualizados");
console.log("");

googleWalletService
  .deleteClass(businessId)
  .then((success) => {
    if (success) {
      console.log("");
      console.log("✅ ÉXITO - Ahora puedes crear tarjetas nuevas");
      console.log("   Los colores del design_json se aplicarán automáticamente");
    } else {
      console.error("❌ No se pudo borrar la clase.");
    }
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("❌ Error:", err.message);
    console.error("   Stack:", err.stack);
    process.exit(1);
  });
