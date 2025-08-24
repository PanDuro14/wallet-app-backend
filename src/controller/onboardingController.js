const { createUserAndIssueProcess, changeUserDesignProcess } = require('../processes/onboardingProcess');

const createUserAndIssue = async (req, res) => {
    try {
        const { business_id, name, email, phone, card_detail_id, points } = req.body || {};

        if (!business_id || !name || !email) {
            return res.status(400).json({ error: 'business_id, name y email son obligatorios' });
        }

        console.log("[CONTROLLER] Body recibido:", req.body); 
        console.log('[createUser] lens:', {
            name: (name||'').length,
            email: (email||'').length,
            phone: (phone||'').length,
        });

        const result = await createUserAndIssueProcess({
            business_id: Number(business_id),
            name,
            email,
            phone,
            card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
            points: Number.isFinite(points) ? Number(points) : 0,
        });
        
        

        return res.status(201).json(result);
    } catch (err) {
        console.error('onboarding.createUserAndIssue error:', err);
        return res.status(err.statusCode || 500).json({ error: err.message || 'Server error' });
    }
};

const changeUserDesign = async (req, res) => {
    try {
        const { userId } = req.params;
        const { card_detail_id } = req.body || {};
        if (!card_detail_id) return res.status(400).json({ error: 'card_detail_id es requerido' });

        await changeUserDesignProcess({
            user_id: Number(userId),
            card_detail_id: Number(card_detail_id),
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('onboarding.changeUserDesign error:', err);
        return res.status(err.statusCode || 500).json({ error: err.message || 'Server error' });
    }
};

module.exports = {
    createUserAndIssue,
    changeUserDesign,
};
