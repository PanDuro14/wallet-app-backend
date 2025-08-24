require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();
const path = require('path');   

// Configuración CORS
const corsOptions = {
  origin: ['http://localhost:4200', 'http://localhost:8100', 'https://2hlw0cdc-4200.usw3.devtunnels.ms', '*'],
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, 
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Puerto
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en: ${PORT}`);
});


// Routing
const v1Business = require('./src/v1/routes/businessRoutes');
const v1CardDetails = require('./src/v1/routes/cardDetailsRoutes'); 
const v1Users = require('./src/v1/routes/usersRoutes'); 
const v1Wallets = require('./src/v1/routes/walletRoutes'); 
const onboardingRoutes = require('./src/v1/routes/onboardingRoutes');
app.use('/api/v1/business', v1Business);
app.use('/api/v1/cards', v1CardDetails); 
app.use('/api/v1/users', v1Users); 
app.use('/api/v1/wallets', v1Wallets); 
app.use('/api/v1/onboarding', onboardingRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send(`Servidor escuchando en: ${PORT}`);
});


app.use('/public', express.static(path.join(process.cwd(), 'public'), {
  maxAge: '7d', etag: true, immutable: false
}));

