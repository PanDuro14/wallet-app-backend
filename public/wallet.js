/* wallet.js - PWA con auto-actualización y Push Notifications */

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
    appAlreadyInstalled: '✓ La app ya está instalada. Ábrela desde tu pantalla de inicio.',
    installError: 'Error al instalar: ',
    installInstructions: {
      title: '📱 Instalar en tu iPhone',
      step1: {
        title: 'Toca el botón de compartir',
        desc: 'En la barra inferior de Safari',
        icon: '⬆️'
      },
      step2: {
        title: 'Selecciona "Añadir a inicio"',
        desc: 'Desplázate hacia abajo en el menú',
        icon: '➕ 🏠'
      },
      step3: {
        title: 'Confirma',
        desc: 'Toca "Añadir" en la esquina superior derecha',
        icon: '✅'
      },
      note: '💡 La app aparecerá en tu pantalla de inicio como cualquier otra aplicación'
    },
    manualInstructions: {
      intro: '💡 Para instalar esta app:\n\n',
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
    appAlreadyInstalled: '✓ The app is already installed. Open it from your home screen.',
    installError: 'Installation error: ',
    installInstructions: {
      title: '📱 Install on your iPhone',
      step1: {
        title: 'Tap the share button',
        desc: 'At the bottom bar of Safari',
        icon: '⬆️'
      },
      step2: {
        title: 'Select "Add to Home Screen"',
        desc: 'Scroll down in the menu',
        icon: '➕ 🏠'
      },
      step3: {
        title: 'Confirm',
        desc: 'Tap "Add" in the top right corner',
        icon: '✅'
      },
      note: '💡 The app will appear on your home screen like any other application'
    },
    manualInstructions: {
      intro: '💡 To install this app:\n\n',
      chrome: '1. Tap the menu (⋮) in the top right corner\n2. Select "Add to Home Screen" or "Install app"\n3. Confirm in the dialog that appears',
      other: '1. Open this page in Chrome or Edge\n2. Use the browser menu\n3. Select "Add to Home Screen"'
    }
  }
};

function detectLanguage() {
  const browserLang = navigator.language || navigator.userLanguage;
  return browserLang.startsWith('es') ? 'es' : 'en';
}

let currentLang = detectLanguage();

function t(key) {
  const keys = key.split('.');
  let value = translations[currentLang];
  
  for (const k of keys) {
    value = value?.[k];
  }
  
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

// ===== SERVICE WORKER CON AUTO-ACTUALIZACIÓN =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('✅ Service Worker registered:', registration);
        
        return navigator.serviceWorker.ready.then((reg) => {
          console.log('✅ Service Worker ready');
          setupPushNotifications(reg);
          setupMessageListener();
          return reg;
        });
      })
      .then(() => {
        setTimeout(updateInstallButton, 500);
      })
      .catch((error) => {
        console.error('❌ Error registering Service Worker:', error);
      });
  });
}

// ===== FIX CRÍTICO: ESCUCHAR MENSAJES INMEDIATAMENTE =====
setupMessageListener();
navigator.serviceWorker.onmessage = (event) => {
  console.log("[PWA] (onmessage) Mensaje del SW:", event.data);

  if (event.data?.type === 'UPDATE_AVAILABLE' && serial) {
    console.log("🔄 Recargando tarjeta por mensaje SW");
    loadCard(serial);
  }
};

// ===== ESCUCHAR MENSAJES DEL SERVICE WORKER =====
function setupMessageListener() {
  console.log("📡 Configurando listener de mensajes...");

  if (!navigator.serviceWorker) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('[PWA] Mensaje recibido del SW:', event.data);

    if (event.data?.type === 'UPDATE_AVAILABLE') {
      console.log('🔄 [PWA] Actualización disponible, recargando...');
      if (serial) loadCard(serial);
    }
  });

  console.log('✅ Listener de mensajes listo');
}

// ===== MANIFEST DINÁMICO =====
if (serial) {
  const manifestLink = document.getElementById('manifest-link');
  manifestLink.href = `/wallet/${serial}/manifest.json`;
}

// ===== EVENTOS PWA =====
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('🎯 beforeinstallprompt captured');
  e.preventDefault();
  deferredPrompt = e;
  promptCaptured = true;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  console.log('✅ App installed');
  deferredPrompt = null;
  updateInstallButton();
});

// ===== INSTALACIÓN =====
async function installPWA() {
  console.log('📱 installPWA called', { isIOS, isStandalone, hasDeferredPrompt: !!deferredPrompt });
  
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
      console.log('🚀 Showing installation prompt...');
      await deferredPrompt.prompt();
      
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`👤 User response: ${outcome}`);
      
      if (outcome === 'accepted') {
        console.log('✅ User accepted installation');
      } else {
        console.log('❌ User declined installation');
      }
      
      deferredPrompt = null;
      updateInstallButton();
      
    } catch (error) {
      console.error('❌ Error during installation:', error);
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
  
  if (isChrome || isEdge) {
    instructions += t('manualInstructions.chrome');
  } else {
    instructions += t('manualInstructions.other');
  }
  
  alert(instructions);
}

function closeInstallModal() {
  document.getElementById('install-modal').classList.remove('active');
}

function updateInstallButton() {
  const installBtn = document.getElementById('install-btn');
  if (!installBtn) {
    console.log('⚠️ Install button does not exist yet');
    return;
  }

  console.log('🔄 Updating button...', {
    isStandalone,
    isIOS,
    hasDeferredPrompt: !!deferredPrompt,
    promptCaptured
  });

  if (isStandalone) {
    installBtn.style.display = 'none';
    return;
  }

  if (isIOS) {
    installBtn.style.display = 'flex';
    installBtn.innerHTML = `📱 ${t('howToInstall')}`;
    installBtn.classList.add('ios');
    installBtn.disabled = false;
    installBtn.onclick = installPWA;
    return;
  }

  if (deferredPrompt) {
    console.log('✅ Button ready with available prompt');
    installBtn.style.display = 'flex';
    installBtn.innerHTML = `⬇️ ${t('installApp')}`;
    installBtn.classList.remove('ios');
    installBtn.disabled = false;
    installBtn.onclick = installPWA;
    return;
  }

  if (!promptCaptured) {
    console.log('⏳ Waiting for beforeinstallprompt...');
    installBtn.style.display = 'flex';
    installBtn.innerHTML = `⏳ ${t('loadingDots')}`;
    installBtn.disabled = true;
    
    setTimeout(() => {
      if (deferredPrompt) {
        updateInstallButton();
      } else {
        console.log('⚠️ Prompt not captured, showing manual option');
        installBtn.style.display = 'flex';
        installBtn.innerHTML = `📱 ${t('addToHome')}`;
        installBtn.disabled = false;
        installBtn.classList.remove('ios');
        installBtn.onclick = showManualInstallInstructions;
      }
    }, 2000);
    return;
  }

  console.log('⚠️ Showing manual option');
  installBtn.style.display = 'flex';
  installBtn.innerHTML = `📱 ${t('addToHome')}`;
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
    console.log(`🔄 [loadCard] Cargando tarjeta: ${serial}`);
    
    const timestamp = new Date().getTime();
    const response = await fetch(`/api/wallet/${serial}?_t=${timestamp}`, {
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error(t('cardNotFound'));
    }
    
    const data = await response.json();
    console.log(`✅ [loadCard] Datos obtenidos:`, data);
    
    renderCard(data);
    
  } catch (error) {
    console.error('❌ [loadCard] Error:', error);
    showError(error.message);
  }
}

function renderCard(data) {
  const { card, user, business, design, strips, urls } = data;

  console.log(`🎨 [renderCard] Strips: ${strips.collected}/${strips.required}`);

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
          ⬇️ ${t('installApp')}
        </button>
      </div>
    </div>
  `;

  setTimeout(() => {
    generateBarcode(barcodeType, card.serial_number);
    updateInstallButton();
    
    if (isFromRegistration) {
      console.log('🎯 User comes from registration, waiting for installation...');
      if (isIOS && !isStandalone) {
        setTimeout(() => {
          document.getElementById('install-modal').classList.add('active');
        }, 1000);
      }
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
  console.log(`🎫 [generateStrips] Generando: ${collected}/${required}`);
  
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
          ${isCollected ? '✓' : ''}
        </div>
      `;
    }
  }
  return html;
}

function showError(message) {
  document.getElementById('app').innerHTML = `
    <div class="error">
      <h2>⚠️ ${t('error')}</h2>
      <p>${message}</p>
      <button class="btn" onclick="location.reload()">${t('retry')}</button>
    </div>
  `;
}

window.installPWA = installPWA;
window.closeInstallModal = closeInstallModal;

// ===== PUSH NOTIFICATIONS =====
async function setupPushNotifications(registration) {
  try {
    console.log('[Push] 🔔 Configurando notificaciones...');
    
    if (!('Notification' in window)) {
      console.warn('[Push] ❌ Notificaciones no soportadas');
      return;
    }

    if (!('PushManager' in window)) {
      console.warn('[Push] ❌ Push API no soportado');
      return;
    }

    console.log('[Push] ✅ APIs soportadas');
    console.log('[Push] Estado permiso:', Notification.permission);

    if (Notification.permission === 'granted') {
      console.log('[Push] ✅ Permiso ya otorgado');
      await subscribeToPush(registration);
      return;
    }

    if (Notification.permission === 'denied') {
      console.warn('[Push] ❌ Permiso denegado por usuario');
      return;
    }

    if (!isIOS) {
      console.log('[Push] 📱 Pidiendo permiso...');
      
      setTimeout(async () => {
        try {
          const permission = await Notification.requestPermission();
          console.log('[Push] Respuesta usuario:', permission);
          
          if (permission === 'granted') {
            console.log('[Push] ✅ Permiso otorgado, suscribiendo...');
            await subscribeToPush(registration);
          } else {
            console.log('[Push] ⚠️ Permiso denegado');
          }
        } catch (err) {
          console.error('[Push] Error pidiendo permiso:', err);
        }
      }, 2000);
    } else {
      console.log('[Push] ℹ️ iOS no soporta Web Push');
    }

  } catch (error) {
    console.error('[Push] ❌ Error configurando notificaciones:', error);
  }
}

async function subscribeToPush(registration) {
  try {
    console.log('[Push] 🔑 Obteniendo VAPID key...');
    
    const response = await fetch('/api/v1/notifications/vapid-public-key');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    const vapidPublicKey = data.publicKey;
    
    if (!vapidPublicKey) {
      throw new Error('VAPID key no disponible en respuesta');
    }

    console.log('[Push] ✅ VAPID key obtenida:', vapidPublicKey.substring(0, 20) + '...');
    
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    
    let subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('[Push] ℹ️ Ya existe subscripción');
    } else {
      console.log('[Push] 📝 Creando nueva subscripción...');
    }
    
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });

    console.log('[Push] ✅ Subscription obtenida');
    console.log('[Push] Endpoint:', subscription.endpoint.substring(0, 50) + '...');

    await saveSubscription(subscription);

  } catch (error) {
    console.error('[Push] ❌ Error suscribiéndose:', error);
    console.error('[Push] Detalles:', {
      message: error.message,
      stack: error.stack
    });
  }
}

async function saveSubscription(subscription) {
  try {
    console.log('[Push] 👤 Obteniendo userId...');
    
    const userId = await getUserIdBySerial(serial);
    
    if (!userId) {
      console.error('[Push] ❌ No se pudo obtener userId');
      console.error('[Push] Serial actual:', serial);
      return;
    }

    console.log('[Push] ✅ userId obtenido:', userId);
    console.log('[Push] 💾 Guardando subscription en backend...');

    const payload = {
      userId: userId,
      subscription: subscription
    };

    console.log('[Push] Payload:', {
      userId,
      endpoint: subscription.endpoint.substring(0, 50) + '...'
    });

    const response = await fetch('/api/v1/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[Push] ✅ Subscription guardada exitosamente:', data);
    } else {
      const error = await response.text();
      console.error('[Push] ❌ Error guardando subscription:');
      console.error('[Push] Status:', response.status);
      console.error('[Push] Error:', error);
    }

  } catch (error) {
    console.error('[Push] ❌ Error en saveSubscription:', error);
    console.error('[Push] Stack:', error.stack);
  }
}

async function getUserIdBySerial(serial) {
  try {
    const response = await fetch(`/api/wallet/${serial}`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.user?.id || data.userId || null;
    
  } catch (error) {
    console.error('[Push] Error obteniendo userId:', error);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}

console.log('✅ wallet.js loaded with push notifications and auto-update');
