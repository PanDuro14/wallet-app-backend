require('dotenv').config();
const sharp = require('sharp');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();
const path = require('path');   
const webpush = require('web-push');
const router = express.Router();

app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin'); 
  next(); 
}); 

const allowed = [
  /^https?:\/\/localhost(?::\d+)?$/,            // dev local
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,         // dev local
  /^https?:\/\/.*\.web\.app$/,                  // Firebase Hosting
  /^https?:\/\/.*\.firebaseapp\.com$/,          // Alias Firebase
  /^https?:\/\/(www\.)?loyalty\.windoe\.mx$/,   // tu dominio
  /^https?:\/\/wallet-app-backend\.fly\.dev$/,   // NO es necesario, pero no estorba
  /^capacitor:\/\/localhost$/,      // iOS (Capacitor/WKWebView)
  /^ionic:\/\/localhost$/           // (opcional) Ionic
];

// Configuración CORS
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl, apps nativas, extensiones
    const ok = allowed.some(rx => rx.test(origin));
    return ok ? cb(null, true) : cb(new Error('CORS bloqueado: ' + origin));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  //allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, 
  optionsSuccessStatus: 200
};
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || [
    'http://localhost:4200',
    'http://localhost:8100',
    'https://loyalty.windoe.mx',
    'http://loyalty.windoe.mx',
    'https://loyalty-6a5be.web.app'
  ].includes(origin)),
  credentials: true
}));
app.use(express.json({ limit: '1mb', type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en: ${PORT}`);
  
  // ===== INICIAR CRON JOBS DE NOTIFICACIONES =====
  try {
    const { startAllCronJobs } = require('./src/controller/notificationCronJobs');
    startAllCronJobs();
    console.log('Cron jobs de notificaciones iniciados');
  } catch (error) {
    console.warn('Cron jobs no disponibles:', error.message);
  }
});

// GET /api/v1/notifications/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

// ===== ARCHIVOS ESTÁTICOS =====
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '7d', 
  etag: true, 
  immutable: false,
  setHeaders: (res, filepath) => {
    // Cache más largo para CSS y JS
    if (filepath.endsWith('.css') || filepath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 día
    }
  }
}));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));           // Uploads (alias de public/uploads)
app.use('/service-worker.js', express.static(path.join(__dirname, 'service-worker.js'))); // Service Worker (debe estar en la raíz del dominio)

// Routing
const v1Business = require('./src/v1/routes/businessRoutes');
const v1CardDetails = require('./src/v1/routes/cardDetailsRoutes'); 
const v1Users = require('./src/v1/routes/usersRoutes'); 
const v1Wallets = require('./src/v1/routes/walletRoutes'); 
const onboardingRoutes = require('./src/v1/routes/onboardingRoutes');
const v1Admin = require('./src/v1/routes/adminRoutes');
const v1Assets = require('./src/v1/routes/assetsRoutes'); 
const v1pwaWallet = require('./src/v1/routes/pwaWalletRoutes');
const notificationRoutes = require('./src/v1/routes/notificationRoutes');

app.use('/api/v1/business', v1Business);
app.use('/api/v1/cards', v1CardDetails); 
app.use('/api/v1/users', v1Users); 
app.use('/api/v1/wallets', v1Wallets); 
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/admin', v1Admin);
app.use('/api/v1/assets', v1Assets); 
app.use('/api/wallet', v1pwaWallet);
app.use('/api/v1/notifications', notificationRoutes); 

// ===== MANIFEST DINÁMICO =====
app.get('/wallet/:serial/manifest.json', async (req, res) => {
  const serial = req.params.serial;
  
  try {
    const cardData = await fetchCardDataBySerial(serial);
    
    console.log('📋 Card Data para manifest:', cardData);
    
    const businessId = cardData?.business_id;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    let logo192, logo512;
    
    if (businessId) {
      console.log(`Usando logo del negocio ID: ${businessId}`);
      logo192 = `${baseUrl}/api/public/assets/logo/${businessId}?size=192`;
      logo512 = `${baseUrl}/api/public/assets/logo/${businessId}?size=512`;
    } else {
      console.log('No se encontró businessId, usando logo de Windoe');
      logo192 = `${baseUrl}/public/WindoeLogo512.png`;
      logo512 = `${baseUrl}/public/WindoeLogo512.png`;
    }
    
    const manifest = {
      "name": cardData?.business_name || "Windoe Loyalty",
      "short_name": cardData?.business_name?.slice(0, 12) || "Lealtad",
      "description": "Tu tarjeta digital de lealtad",
      "start_url": `/wallet/${serial}?source=pwa`,
      "display": "standalone",
      "background_color": "#ffffff",
      "theme_color": "#000000",
      "orientation": "portrait",
      "scope": "/wallet/",
      "icons": [
        {
          "src": logo192,
          "sizes": "192x192",
          "type": "image/png",
          "purpose": "any"
        },
        {
          "src": logo512,
          "sizes": "512x512", 
          "type": "image/png",
          "purpose": "any"
        },
        {
          "src": logo192,
          "sizes": "192x192",
          "type": "image/png",
          "purpose": "maskable"
        }
      ],
      "categories": ["shopping", "lifestyle"],
      "lang": "es-MX"
    };

    console.log(' Manifest generado con iconos:', manifest.icons);

    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(manifest);
    
  } catch (error) {
    console.error(' Error generando manifest:', error);
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const manifest = {
      "name": "Windoe Loyalty",
      "short_name": "Lealtad",
      "start_url": `/wallet/${serial}?source=pwa`,
      "display": "standalone",
      "background_color": "#ffffff",
      "theme_color": "#000000",
      "scope": "/wallet/",
      "icons": [
        {
          "src": `${baseUrl}/public/WindoeLogo512.png`,
          "sizes": "512x512",
          "type": "image/png",
          "purpose": "any"
        }
      ],
      "lang": "es-MX"
    };
    
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json(manifest);
  }
});

// Helper para obtener datos de la tarjeta por serial
async function fetchCardDataBySerial(serial) {
  try {
    const pwaWalletProcess = require('./src/processes/pwaWalletProcess');
    
    const data = await pwaWalletProcess.getCardDetails(serial);
    
    console.log(' Data de pwaWalletProcess:', {
      business_id: data?.business?.id,
      business_name: data?.business?.name
    });
    
    return {
      business_id: data?.business?.id,
      business_name: data?.business?.name
    };
  } catch (error) {
    console.error(' Error obteniendo datos de tarjeta:', error);
    return null;
  }
}

// ===== WALLET PWA =====
app.get('/wallet/:serial', (req, res) => {
  try {
    return res.sendFile(path.join(__dirname, 'public', 'wallet.html'));
  } catch (error) {
    return res.status(502).json({ error: 'No se pudo obtener la tarjeta'}); 
  }
});

// ===== ASSETS PÚBLICOS =====
const businessesProcess = require('./src/processes/businessProcess');

app.get('/api/public/assets/logo/:businessId', async (req, res) => {
  const businessId = req.params.businessId;
  const size = parseInt(req.query.size) || null;
  
  try {
    const bizRes = await businessesProcess.getOneBusiness(businessId);
    const biz = Array.isArray(bizRes) ? bizRes[0] : bizRes;

    const buffer = biz?.logoBuffer || biz?.logo || biz?.image || biz?.logo_png || null;

    if (!buffer) return res.status(404).send('No logo found');

    // Si se pide un tamaño específico, reescalar
    if (size) {
      const resizedBuffer = await sharp(buffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toBuffer();

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(resizedBuffer);
    }

    // Sin tamaño específico, devolver original
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
    
  } catch (error) {
    console.error('Error al obtener/procesar logo:', error);
    return res.status(500).send('Error processing logo');
  }
});

// Strip ON
app.get('/api/public/assets/strip-on/:businessId', async (req, res) => {
  const businessId = req.params.businessId;
  const bizRes = await businessesProcess.getOneBusiness(businessId);
  const biz = Array.isArray(bizRes) ? bizRes[0] : bizRes;

  const buffer = biz?.strip_image_on || null;

  if (!buffer) return res.status(404).send('No strip-on image found');

  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
});

// Strip OFF
app.get('/api/public/assets/strip-off/:businessId', async (req, res) => {
  const businessId = req.params.businessId;
  const bizRes = await businessesProcess.getOneBusiness(businessId);
  const biz = Array.isArray(bizRes) ? bizRes[0] : bizRes;

  const buffer = biz?.strip_image_off || null;

  if (!buffer) return res.status(404).send('No strip-off image found');

  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
});

// ===== NOTIFICACIONES APPLE WALLET =====
const { listPushTokensBySerial, deleteRegistration } = require('./src/db/appleWalletdb');
const { notifyWallet } = require('./src/services/apnsService');

const cleanUuid = (v = '') => decodeURIComponent(String(v)).trim();
const isUuid = (v = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

app.get('/wallet/internal/passes/:serial/notify', async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    if (!isUuid(serial)) return res.status(400).json({ error: 'invalid serial' });

    const tokens = await listPushTokensBySerial(serial);
    if (!tokens?.length) return res.status(404).json({ error: 'no registrations for serial', serial });

    const results = await Promise.allSettled(tokens.map(t => notifyWallet(t.push_token, t.env)));

    const summary = results.map((r, i) => {
      const t = tokens[i];
      const short = (t.push_token || '').slice(0, 8);
      if (r.status === 'fulfilled') {
        const v = r.value;
        const status = typeof v === 'number' ? v : (v?.status ?? 0);
        const reason = typeof v === 'number' ? null : (v?.reason ?? null);
        const host = typeof v === 'number' ? null : (v?.host ?? null);

        return { token: short, env: t.env, status, reason, host };
      } else {
        return { token: short, env: t.env, error: String(r.reason || 'unknown') };
      }
    });

    // Limpia registros con 410 (Unregistered)
    for (const r of summary) {
      if (r.status === 410) {
        try {
          await deleteRegistration({
            passTypeId: process.env.PASS_TYPE_IDENTIFIER,
            serial,
            pushToken: tokens.find(t => (t.push_token || '').startsWith(r.token))?.push_token
          });
        } catch {}
      }
    }

    return res.json({ serial, count: tokens.length, results: summary });
  } catch (e) {
    console.error('[internal notify][err]', e);
    return res.status(500).json({ error: 'server', detail: e?.message || String(e) });
  }
});

// ===== RUTAS GENERALES =====
app.get('/', (req, res) => {
  res.send(`Servidor escuchando en: ${PORT}`);
});

// Manejo de errores CORS
app.use((err, req, res, next) => {
  if (err && /CORS bloqueado/i.test(err.message)) {
    return res.status(403).json({ error: 'CORS bloqueado', origin: req.header('Origin') || null });
  }
  next(err);
});