// routes/admin.routes.js
const express = require('express');
const router = express.Router();
const { authenticateBusiness } = require('../../Middleware/authenticationMiddleware');
const usersService = require('../../services/usersService');
const { bumpPoints } = require('../../controller/passkitController'); // ya existe

// Helper: bump por serial con guardas de negocio
router.post('/passes/:serial/points', authenticateBusiness, async (req, res) => {
  try {
    const serial = req.params.serial.trim();
    const delta  = Number(req.body?.delta);
    if (!Number.isFinite(delta)) return res.status(400).json({ error: 'delta inválido' });

    // 1) Trae usuario por serial
    const row = await usersService.getOneUserBySerial(serial); // implementa si no la tienes
    if (!row) return res.sendStatus(404);

    // 2) Que sea del mismo negocio que el token
    const bizIdFromJwt = req.user?.businessId; // como pones el JWT
    if (Number(row.business_id) !== Number(bizIdFromJwt)) {
      return res.status(403).json({ error: 'No autorizado para este usuario' });
    }

    // 3) Reusa tu lógica existente
    req.params.serial = serial;
    req.body.delta = delta;
    return bumpPoints(req, res); // ya hace update + APNs + limpia 410
  } catch (e) {
    console.error('admin.bump error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
