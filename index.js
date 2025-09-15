require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();
const path = require('path');   

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
});


// Routing
const v1Business = require('./src/v1/routes/businessRoutes');
const v1CardDetails = require('./src/v1/routes/cardDetailsRoutes'); 
const v1Users = require('./src/v1/routes/usersRoutes'); 
const v1Wallets = require('./src/v1/routes/walletRoutes'); 
const onboardingRoutes = require('./src/v1/routes/onboardingRoutes');
const v1Admin = require('./src/v1/routes/adminRoutes');
app.use('/api/v1/business', v1Business);
app.use('/api/v1/cards', v1CardDetails); 
app.use('/api/v1/users', v1Users); 
app.use('/api/v1/wallets', v1Wallets); 
app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/admin', v1Admin);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send(`Servidor escuchando en: ${PORT}`);
});

app.use((err, req, res, next) => {
  if (err && /CORS bloqueado/i.test(err.message)) {
    return res.status(403).json({ error: 'CORS bloqueado', origin: req.header('Origin') || null });
  }
  next(err);
});
// TEMPORAL: PRUEBAS

// IMPORTA tus servicios/DB
const { listPushTokensBySerial, deleteRegistration } = require('./src/db/appleWalletdb');
const { notifyWallet } = require('./src/services/apnsService');

// Helpers locales (los mismos que usas en el controller)
const cleanUuid = (v = '') => decodeURIComponent(String(v)).trim();
const isUuid = (v = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// GET /wallet/internal/passes/:serial/notify
app.get('/wallet/internal/passes/:serial/notify', async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    if (!isUuid(serial)) return res.status(400).json({ error: 'invalid serial' });

    const tokens = await listPushTokensBySerial(serial); // [{ push_token, env }]
    if (!tokens?.length) return res.status(404).json({ error: 'no registrations for serial', serial });

    // Lanza APNs; tu notifyWallet puede devolver number (200/410/...) o {status,reason,host}
    const results = await Promise.allSettled(tokens.map(t => notifyWallet(t.push_token, t.env)));

    const summary = results.map((r, i) => {
      const t = tokens[i];
      const short = (t.push_token || '').slice(0, 8);
      if (r.status === 'fulfilled') {
        const v = r.value;
        // Compat: number o objeto
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

app.use('/public', express.static(path.join(process.cwd(), 'public'), {
  maxAge: '7d', etag: true, immutable: false
}));

