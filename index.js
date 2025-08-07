require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Configuración CORS
const corsOptions = {
  origin: '*', //['http://localhost:8100'] para futuro front
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, 
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routing
const v1Business = require('./src/v1/routes/businessRoutes');
const v1CardDetails = require('./src/v1/routes/cardDetailsRoutes'); 
const v1Users = require('./src/v1/routes/usersRoutes'); 
app.use('/api/v1/business', v1Business);
app.use('/api/v1/cards', v1CardDetails); 
app.use('/api/v1/users', v1Users); 

// Ruta de prueba
app.get('/', (req, res) => {
  res.send(`Servidor escuchando en: ${PORT}`);
});

// Puerto
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en: ${PORT}`);
});
