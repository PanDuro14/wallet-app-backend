/**
 * 🧪 VERIFICADOR DE PAYLOAD - Ejecutar en Console del Servidor
 * 
 * Este script simula el envío de una notificación y muestra
 * exactamente qué payload se está enviando
 */

const webpush = require('web-push');

// Simular la función getNotificationMessage
function getNotificationMessage(type, data = {}, lang = 'es') {
  const templates = {
    es: {
      update_strips: {
        title: '¡Progreso actualizado! 🎫',
        body: 'Llevas {collected} de {required}. ¡Ya casi completas!'
      }
    }
  };

  function interpolate(template, data) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return data[key] !== undefined ? String(data[key]) : `{${key}}`;
    });
  }

  const template = templates[lang].update_strips;
  return {
    title: interpolate(template.title, data),
    body: interpolate(template.body, data)
  };
}

// Test del payload
console.log('🧪 VERIFICANDO FORMATO DE PAYLOAD\n');

const type = 'update';
const data = {
  collected: 5,
  required: 10,
  card_type: 'strips'
};
const lang = 'es';
const userId = 123;

const message = getNotificationMessage(type, data, lang);
console.log('1️⃣ Mensaje generado:');
console.log(JSON.stringify(message, null, 2));
console.log('\n');

// Payload CORRECTO
const payloadCorrecto = {
  notification: {
    title: message.title,
    body: message.body,
    icon: '/public/WindoeLogo192.png',
    badge: '/public/WindoeLogo192.png',
    vibrate: [200, 100, 200],
    tag: 'windoe-notification',
    requireInteraction: false,
    data: {
      type,
      userId,
      timestamp: Date.now(),
      ...data
    }
  }
};

console.log('2️⃣ Payload CORRECTO (con wrapper notification):');
console.log(JSON.stringify(payloadCorrecto, null, 2));
console.log('\n');

// Payload INCORRECTO (como posiblemente lo tenías)
const payloadIncorrecto = {
  title: message.title,
  body: message.body,
  icon: '/public/WindoeLogo192.png',
  data: {
    type,
    userId,
    ...data
  }
};

console.log('3️⃣ Payload INCORRECTO (sin wrapper notification):');
console.log(JSON.stringify(payloadIncorrecto, null, 2));
console.log('\n');

console.log('📊 COMPARACIÓN:');
console.log('');
console.log('✅ CORRECTO:');
console.log('   { notification: { title, body, ... } }');
console.log('   └─ El Service Worker encuentra los datos en "notification"');
console.log('');
console.log('❌ INCORRECTO:');
console.log('   { title, body, ... }');
console.log('   └─ El Service Worker NO encuentra los datos (vacío)');
console.log('');

// Simular lo que recibirá el Service Worker
console.log('4️⃣ Lo que recibe el Service Worker:');
console.log('');
console.log('Con payload CORRECTO:');
console.log('  event.data.json() =', JSON.stringify(payloadCorrecto));
console.log('  event.data.json().notification.title =', payloadCorrecto.notification.title);
console.log('  event.data.json().notification.body =', payloadCorrecto.notification.body);
console.log('');
console.log('Con payload INCORRECTO:');
console.log('  event.data.json() =', JSON.stringify(payloadIncorrecto));
console.log('  event.data.json().notification =', payloadIncorrecto.notification); // undefined!
console.log('  event.data.json().notification?.title =', payloadIncorrecto.notification?.title); // undefined!
console.log('');

console.log('🎯 CONCLUSIÓN:');
console.log('');
console.log('El Service Worker espera:');
console.log('  payload.notification.title');
console.log('  payload.notification.body');
console.log('');
console.log('Por eso debes enviar:');
console.log('  { notification: { title: "...", body: "..." } }');
console.log('');
console.log('Y NO:');
console.log('  { title: "...", body: "..." }');
console.log('');