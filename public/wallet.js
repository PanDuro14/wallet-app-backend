/* wallet.js - PWA con Firebase Cloud Messaging */

// ===== TRADUCCIÓN =====
const translations = {
  es: {
    loading: 'Cargando tarjeta...',
    installApp: 'Instalar App',
    howToInstall: 'Cómo Instalar',
    addToHome: 'Agregar a Inicio',
    loadingDots: 'Cargando...',
    member: 'MIEMBRO',
    error: 'Error',
    retry: 'Reintentar',
    cardNotFound: 'Tarjeta no encontrada',
    noCardCode: 'No se encontró el código de la tarjeta',
    appAlreadyInstalled: ' La app ya está instalada. Ábrela desde tu pantalla de inicio.',
    installError: 'Error al instalar: ',
    installInstructions: {
      title: ' Instalar en tu iPhone',
      step1: { title: 'Toca el botón de compartir', desc: 'En la barra inferior de Safari', icon: '' },
      step2: { title: 'Selecciona "Añadir a inicio"', desc: 'Desplázate hacia abajo en el menú', icon: ' ' },
      step3: { title: 'Confirma', desc: 'Toca "Añadir" en la esquina superior derecha', icon: '' },
      note: ' La app aparecerá en tu pantalla de inicio como cualquier otra aplicación'
    },
    manualInstructions: {
      intro: ' Para instalar esta app:\n\n',
      chrome: '1. Toca el menú (⋮) en la esquina superior derecha\n2. Selecciona "Agregar a pantalla de inicio" o "Instalar app"\n3. Confirma en el diálogo que aparece',
      other: '1. Abre esta página en Chrome o Edge\n2. Usa el menú del navegador\n3. Selecciona "Agregar a pantalla de inicio"'
    }
  },
  en: {
    loading: 'Loading card...',
    installApp: 'Install App',
    howToInstall: 'How to Install',
    addToHome: 'Add to Home',
    loadingDots: 'Loading...',
    member: 'MEMBER',
    error: 'Error',
    retry: 'Retry',
    cardNotFound: 'Card not found',
    noCardCode: 'Card code not found',
    appAlreadyInstalled: ' The app is already installed. Open it from your home screen.',
    installError: 'Installation error: ',
    installInstructions: {
      title: ' Install on your iPhone',
      step1: { title: 'Tap the share button', desc: 'At the bottom bar of Safari', icon: '' },
      step2: { title: 'Select "Add to Home Screen"', desc: 'Scroll down in the menu', icon: ' ' },
      step3: { title: 'Confirm', desc: 'Tap "Add" in the top right corner', icon: '' },
      note: ' The app will appear on your home screen like any other application'
    },
    manualInstructions: {
      intro: ' To install this app:\n\n',
      chrome: '1. Tap the menu (⋮) in the top right corner\n2. Select "Add to Home Screen" or "Install app"\n3. Confirm in the dialog that appears',
      other: '1. Open this page in Chrome or Edge\n2. Use the browser menu\n3. Select "Add to Home Screen"'
    }
  }
};

// Verificar entorno seguro
(function checkEnvironment() {
  const isSecure = location.protocol === 'https:' || 
                   location.hostname === 'localhost' || 
                   location.hostname === '127.0.0.1';
  
  if (!isSecure) {
    console.error(' Push notifications requieren HTTPS o localhost');
  } else {
    console.log(' Entorno seguro para push notifications');
  }
})();

function detectLanguage() {
  const browserLang = navigator.language || navigator.userLanguage;
  return browserLang.startsWith('es') ? 'es' : 'en';
}

let currentLang = detectLanguage();

function t(key) {
  const keys = key.split('.');
  let value = translations[currentLang];
  for (const k of keys) { value = value?.[k]; }
  return value || key;
}

// ===== VARIABLES GLOBALES =====
const urlParams = new URLSearchParams(window.location.search);
const isFromRegistration = urlParams.get('install') === '1';
const serial = window.location.pathname.split('/wallet/')[1]?.split('?')[0];

let deferredPrompt = null;
let promptCaptured = false;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                    window.navigator.standalone === true;



// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyBaDXj8GMbdy3OwwshyNBBClvNjUephmpQ",
  authDomain: "windoe-loyalty-wallet.firebaseapp.com",
  projectId: "windoe-loyalty-wallet",
  storageBucket: "windoe-loyalty-wallet.firebasestorage.app",
  messagingSenderId: "556983962648",
  appId: "1:556983962648:web:95da994b6d6b931558876d"
};

// Configurar listener de SW
console.log(' [INIT] Configurando listener ANTES de SW...');

if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('message', handleSWMessage);
  console.log(' [INIT] Listener configurado (SW ya activo)');
}

function handleSWMessage(event) {
  console.log('[PWA] Mensaje del SW:', event.data);
  if (event.data?.type === 'UPDATE_AVAILABLE') {
    console.log(' [PWA] Actualización disponible, recargando tarjeta...');
    if (serial) loadCard(serial);
  }
}

// ===== SERVICE WORKER =====
let swRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      console.log('[SW] Registrando Service Worker...');
      
      swRegistration = await navigator.serviceWorker.register('/service-worker.js');
      console.log(' [SW] Registrado:', swRegistration.scope);

      await navigator.serviceWorker.ready;
      console.log(' [SW] Ready y activo');

      if (!navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('message', handleSWMessage);
      }

      // Configurar push con Firebase
      await setupPushNotifications(swRegistration);

      setTimeout(updateInstallButton, 500);

    } catch (error) {
      console.error(' [SW] Error:', error);
    }
  });
}

// ===== MANIFEST DINÁMICO =====
if (serial) {
  const manifestLink = document.getElementById('manifest-link');
  manifestLink.href = `/wallet/${serial}/manifest.json`;
}

// ===== EVENTOS PWA =====
window.addEventListener('beforeinstallprompt', (e) => {
  console.log(' beforeinstallprompt captured');
  e.preventDefault();
  deferredPrompt = e;
  promptCaptured = true;
  updateInstallButton();
});

window.addEventListener('appinstalled', async () => {
  console.log(' App installed');
  deferredPrompt = null;
  updateInstallButton();
  
  setTimeout(() => {
    alert(' App instalada!\n\n' +
          ' Para activar las notificaciones:\n' +
          '1. Cierra esta ventana\n' +
          '2. Abre la app desde el ícono instalado\n\n' +
          'Las notificaciones se activarán automáticamente.');
  }, 500);
});

// ===== INSTALACIÓN =====
async function installPWA() {
  console.log(' installPWA called', { isIOS, isStandalone, hasDeferredPrompt: !!deferredPrompt });
  
  if (isIOS) {
    if (isStandalone) {
      alert(t('appAlreadyInstalled'));
    } else {
      document.getElementById('install-modal').classList.add('active');
    }
    return;
  }

  if (isStandalone) {
    alert(t('appAlreadyInstalled'));
    return;
  }

  if (deferredPrompt) {
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(` User response: ${outcome}`);
      deferredPrompt = null;
      updateInstallButton();
    } catch (error) {
      console.error(' Error during installation:', error);
      alert(t('installError') + error.message);
    }
  } else {
    showManualInstallInstructions();
  }
}

function showManualInstallInstructions() {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdge = /Edg/.test(navigator.userAgent);
  
  let instructions = t('manualInstructions.intro');
  instructions += (isChrome || isEdge) ? t('manualInstructions.chrome') : t('manualInstructions.other');
  alert(instructions);
}

function closeInstallModal() {
  document.getElementById('install-modal').classList.remove('active');
}

function updateInstallButton() {
  const installBtn = document.getElementById('install-btn');
  if (!installBtn) return;

  console.log(' Updating button...', { isStandalone, isIOS, hasDeferredPrompt: !!deferredPrompt });

  if (isStandalone) {
    installBtn.style.display = 'none';
    return;
  }

  if (isIOS) {
    installBtn.style.display = 'flex';
    installBtn.innerHTML = ` ${t('howToInstall')}`;
    installBtn.classList.add('ios');
    installBtn.disabled = false;
    installBtn.onclick = installPWA;
    return;
  }

  if (deferredPrompt) {
    installBtn.style.display = 'flex';
    installBtn.innerHTML = ` ${t('installApp')}`;
    installBtn.classList.remove('ios');
    installBtn.disabled = false;
    installBtn.onclick = installPWA;
    return;
  }

  if (!promptCaptured) {
    installBtn.style.display = 'flex';
    installBtn.innerHTML = ` ${t('loadingDots')}`;
    installBtn.disabled = true;
    
    setTimeout(() => {
      if (deferredPrompt) {
        updateInstallButton();
      } else {
        installBtn.style.display = 'flex';
        installBtn.innerHTML = ` ${t('addToHome')}`;
        installBtn.disabled = false;
        installBtn.classList.remove('ios');
        installBtn.onclick = showManualInstallInstructions;
      }
    }, 2000);
    return;
  }

  installBtn.style.display = 'flex';
  installBtn.innerHTML = ` ${t('addToHome')}`;
  installBtn.disabled = false;
  installBtn.classList.remove('ios');
  installBtn.onclick = showManualInstallInstructions;
}

// ===== CARGA DE TARJETA =====
if (!serial) {
  showError(t('noCardCode'));
} else {
  loadCard(serial);
}

async function loadCard(serial) {
  try {
    console.log(` [loadCard] Cargando tarjeta: ${serial}`);
    
    const timestamp = new Date().getTime();
    const response = await fetch(`/api/wallet/${serial}?_t=${timestamp}`, {
      cache: 'no-store'
    });
    
    if (!response.ok) throw new Error(t('cardNotFound'));
    
    const data = await response.json();
    console.log(' [loadCard] Datos obtenidos:', data);
    
    renderCard(data);
  } catch (error) {
    console.error(' [loadCard] Error:', error);
    showError(error.message);
  }
}

function renderCard(data) {
  const { card, user, business, design, strips } = data;

  console.log(` [renderCard] Strips: ${strips.collected}/${strips.required}`);

  document.documentElement.style.setProperty('--card-bg', design.background_color);
  document.documentElement.style.setProperty('--text-color', design.foreground_color);
  document.querySelector('meta[name="theme-color"]').content = '#000000';

  if (business.logo_url) {
    document.getElementById('apple-icon').href = business.logo_url;
  }

  let barcodeType = 'qrcode';
  try {
    const designData = data.design_json || {};
    const parsedDesign = typeof designData === 'string' ? JSON.parse(designData) : designData;
    if (parsedDesign?.barcode?.primary) {
      barcodeType = parsedDesign.barcode.primary.toLowerCase();
    }
  } catch (e) {
    console.warn('Could not parse design_json');
  }

  const layout = getStripsLayout(strips.required);

  document.getElementById('app').innerHTML = `
    <div class="wallet-container">
      <div class="wallet-card">
        <div class="card-header">
          <div class="card-logo">
            <img src="${business.logo_url}" alt="${business.name}" onerror="this.style.display='none'">
          </div>
        </div>

        <div class="strips-grid" data-layout="${layout}">
          ${generateStrips(strips.collected, strips.required, strips.strip_on_url, strips.strip_off_url)}
        </div>

        <div class="member-info">
          <div class="member-label">${t('member')}</div>
          <div class="member-name">${user.name}</div>
        </div>

        <div class="barcode-section">
          <div class="barcode-container">
            <canvas id="barcode-canvas"></canvas>
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button id="install-btn" class="action-btn btn-install" onclick="installPWA()">
          ${t('installApp')}
        </button>
      </div>
    </div>
  `;

  setTimeout(() => {
    generateBarcode(barcodeType, card.serial_number);
    updateInstallButton();
    
    if (isFromRegistration && isIOS && !isStandalone) {
      setTimeout(() => {
        document.getElementById('install-modal').classList.add('active');
      }, 1000);
    }
  }, 100);
}

// ===== HELPERS =====
function getStripsLayout(total) {
  if (total === 6) return '2x3';
  if (total === 8) return '2x4';
  if (total === 10) return '2x5';
  if (total === 5) return 'odd-5';
  if (total === 7) return 'odd-7';
  if (total === 9) return 'odd-9';
  return 'generic';
}

function generateBarcode(type, data) {
  const container = document.querySelector('.barcode-container');

  if (type === "qrcode") {
    container.innerHTML = `
      <div id="barcode-box"></div>
      <div class="barcode-number">${data}</div>
    `;

    const qrContainer = document.getElementById("barcode-box");
    qrContainer.innerHTML = "";

    new QRCode(qrContainer, {
      text: data,
      width: 140,
      height: 140,
      colorDark: "#000",
      colorLight: "#fff",
      correctLevel: QRCode.CorrectLevel.M
    });
    return;
  }

  container.innerHTML = `
    <canvas id="barcode-canvas"></canvas>
    <div class="barcode-number">${data}</div>
  `;

  const canvas = document.getElementById("barcode-canvas");
  const ctx = canvas.getContext("2d");

  const codes = PDF417.getBarcodeArray(data);
  const { num_cols, num_rows } = codes;

  const scale = 3;
  canvas.width = num_cols * scale;
  canvas.height = num_rows * scale;

  for (let r = 0; r < num_rows; ++r) {
    for (let c = 0; c < num_cols; ++c) {
      ctx.fillStyle = codes.bcode[r][c] === 1 ? "#000" : "#fff";
      ctx.fillRect(c * scale, r * scale, scale, scale);
    }
  }
}

function generateStrips(collected, required, stripOnUrl, stripOffUrl) {
  let html = '';
  console.log(` [generateStrips] Generando: ${collected}/${required}`);
  
  for (let i = 0; i < required; i++) {
    const isCollected = i < collected;
    
    if (stripOnUrl && stripOffUrl) {
      html += `
        <div class="strip-item ${isCollected ? 'collected' : ''}">
          <img src="${isCollected ? stripOnUrl : stripOffUrl}" alt="Strip ${i + 1}">
        </div>
      `;
    } else {
      html += `
        <div class="strip-item ${isCollected ? 'collected' : ''}">
          ${isCollected ? '' : ''}
        </div>
      `;
    }
  }
  return html;
}

function showError(message) {
  document.getElementById('app').innerHTML = `
    <div class="error">
      <h2> ${t('error')}</h2>
      <p>${message}</p>
      <button class="btn" onclick="location.reload()">${t('retry')}</button>
    </div>
  `;
}

// ===== PUSH NOTIFICATIONS CON FIREBASE =====
async function setupPushNotifications(registration) {
  try {
    console.log('[Push] Iniciando configuración con Firebase...');
    
    if (!('Notification' in window)) {
      console.warn('[Push] Notification API no disponible');
      return;
    }

    if (isIOS) {
      console.log('[Push] iOS Safari no soporta Web Push');
      return;
    }

    const isCurrentlyStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                                  window.navigator.standalone === true;

    console.log('[Push] Modo standalone:', isCurrentlyStandalone);

    if (!isCurrentlyStandalone) {
      console.log('[Push] Esperando modo standalone');
      return;
    }

    // Inicializar Firebase (usa el SW ya registrado)
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    const messaging = firebase.messaging();

    console.log('[Push] Permiso actual:', Notification.permission);

    if (Notification.permission === 'granted') {
      console.log('[Push] Permiso ya otorgado, obteniendo token...');
      await getFirebaseToken(messaging);
      return;
    }

    if (Notification.permission === 'denied') {
      console.warn('[Push] Permiso denegado');
      return;
    }

    console.log('[Push] Pidiendo permiso...');
    setTimeout(async () => {
      const permission = await Notification.requestPermission();
      console.log('[Push] Respuesta:', permission);
      
      if (permission === 'granted') {
        await getFirebaseToken(messaging);
      }
    }, 2000);

  } catch (error) {
    console.error('[Push] Error en setupPushNotifications:', error);
  }
}

async function getFirebaseToken(messaging) {
  try {
    console.log('[Push] Obteniendo token de Firebase...');

    const token = await messaging.getToken({
      vapidKey: 'BMaVX5UENLzwkd1zSrkSXiMRD0OKoZTN7M3zX2NmQT2BEdnMh-ivraZXvwNwCqyE9PjGUIJlEJ8-kA4ocl-M2Ig'
    });

    if (token) {
      console.log('[Push] Token obtenido:', token.substring(0, 50) + '...');
      await saveFirebaseToken(token);
    } else {
      console.error('[Push] No se pudo obtener token');
    }

  } catch (error) {
    console.error('[Push] Error obteniendo token:', error);
    
    // Detectar si es Chrome Desktop con el bug conocido
    const isDesktop = !/Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    
    if (error.name === 'AbortError' && isDesktop) {
      console.warn('[Push] Chrome Desktop tiene problemas conocidos con FCM');
      console.warn('[Push] Notificaciones funcionarán mejor en:');
      console.warn('[Push]   - Chrome Android');
      console.warn('[Push]   - Edge');
      console.warn('[Push]   - Brave');
      
      // Mostrar mensaje al usuario
      showPushWarning();
    }
  }
}

function showPushWarning() {
  // Solo mostrar una vez
  if (localStorage.getItem('push-warning-shown')) return;
  
  setTimeout(() => {
    const lang = currentLang || 'es';
    const message = lang === 'es' 
      ? ' Las notificaciones push no están disponibles en Chrome Desktop.\n\n' +
        ' Para recibir notificaciones:\n' +
        '• Usa la app en tu celular Android\n' +
        '• O espera futuras actualizaciones de Chrome'
      : ' Push notifications are not available on Chrome Desktop.\n\n' +
        ' To receive notifications:\n' +
        '• Use the app on your Android phone\n' +
        '• Or wait for future Chrome updates';
    
    alert(message);
    localStorage.setItem('push-warning-shown', 'true');
  }, 3000);
}

async function saveFirebaseToken(token) {
  try {
    console.log('[Push] Guardando token...');
    console.log('[Push] Serial actual: ', serial); 

    if (!serial){
      throw new Error('Serial no disponible'); 
    }
    
    const userId = await getUserIdBySerial(serial);
    
    if (!userId) {
      throw new Error('No se pudo obtener userId');
    }
    
    console.log('[Push] userId:', userId);
    
    // Estructura compatible con backend
    const subscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${token}`,
      keys: {
        p256dh: 'firebase',
        auth: 'firebase'
      }
    };
    
    const payload = {
      userId: userId,
      subscription: subscription
    };
    
    console.log('[Push] Enviando al backend...');
    
    const saveResponse = await fetch('/api/v1/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      throw new Error('Error del servidor: ' + errorText);
    }
    
    const result = await saveResponse.json();
    console.log('[Push] Guardado exitosamente:', result);
    console.log('[Push] Subscripción completada con Firebase!');

  } catch (error) {
    console.error('[Push] Error guardando token:', error);
  }
}

async function getUserIdBySerial(serial) {
  try {
    console.log('[Push] Obteniendo userId para serial:', serial);
    console.log('[Push] Serial length: ', serial?.length); 
    console.log('[Push] Serial type: ', typeof serial); 

    if (!serial){
      console.error('[Push] Serial está vacío o undefined'); 
      return null; 
    }
    
    const response = await fetch(`/api/wallet/${serial}`);
    
    if (!response.ok) {
      console.error('[Push] Error en fetch:', response.status);
      return null;
    }
    
    const data = await response.json();
    console.log('[Push] Data completa:', data);
    console.log('[Push] data.user:', data.user);
    
    const userId = data.user?.id || data.userId || null;
    
    console.log('[Push] userId encontrado:', userId);
    
    if (!userId) {
      console.error('[Push] No se encontró userId en la respuesta');
    }
    
    return userId;
    
  } catch (error) {
    console.error('[Push] Error obteniendo userId:', error);
    return null;
  }
}

// Exponer funciones globales
window.installPWA = installPWA;
window.closeInstallModal = closeInstallModal;

console.log(' wallet.js loaded with Firebase push notifications');