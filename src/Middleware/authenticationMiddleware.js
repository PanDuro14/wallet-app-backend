const jwt = require('jsonwebtoken');

// Middleware para verificar el token de negocio
const authenticateBusiness = (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Token requerido' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Token inválido' });
    req.businessId = decoded.businessId;  // Extraemos el businessId del token
    next();
  });
};

// Middleware para verificar el token de usuario (si es necesario)
const authenticateUser = (req, res, next) => {
  const token = req.cookies.userToken || req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Token requerido' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Token inválido' });
    req.userId = decoded.userId; 
    next();
  });
};

module.exports = {
  authenticateBusiness,
  authenticateUser,
};
