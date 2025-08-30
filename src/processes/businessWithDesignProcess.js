const businessService = require('../services/businessService');
const carddetailService = require('../services/carddetailService');

// controller: POST /business/with-design (simple y efectivo)
const createBusinessThenDesign = async (req, res) => {
  const { business, design } = req.body || {};
  if (!business?.name) return res.status(400).json({ error: 'business.name requerido' });

  let biz = null;
  try {
    biz = await businessService.createBusiness(business);                  // 1) crea negocio
    const des = await carddetailService.createOneCardDetails({             // 2) crea diseño
      business_id: biz.id,
      design_json: design
    });
    await businessService.updateBusiness(biz.id, {                         // 3) marca default
      default_card_detail_id: des.id
    });
    return res.status(201).json({ business: biz, design: des });
  } catch (e) {
    // rollback manual si falló el diseño o el update
    if (biz?.id) { try { await businessService.deleteBusiness(biz.id); } catch {} }
    return res.status(400).json({ error: e.message || 'No se pudo crear negocio+diseño' });
  }
};


async function setBusinessDefaultDesignProcess({ business_id, card_detail_id }) {
  const bizId = Number(business_id);
  const designId = Number(card_detail_id);

  if (!Number.isFinite(bizId) || !Number.isFinite(designId)) {
    const err = new Error('IDs inválidos'); err.statusCode = 400; throw err;
  }

  // 1) Carga diseño
  let d = await carddetailService.getOneCardDetails(designId);
  if (!d) { const err = new Error('card_detail_id no existe'); err.statusCode = 404; throw err; }

  // 2) Asegura design_json como objeto
  if (d.design_json && typeof d.design_json === 'string') {
    try { d.design_json = JSON.parse(d.design_json); } catch {}
  }

  // 3) Pertenencia (columna > JSON)
  const bizOfDesign = (d.business_id != null)
    ? Number(d.business_id)
    : (d.design_json?.businessId != null ? Number(d.design_json.businessId) : NaN);

  if (!Number.isFinite(bizOfDesign) || bizOfDesign !== bizId) {
    const err = new Error('card_detail_id inválido para este negocio');
    err.statusCode = 400; throw err;
  }

  // 3.5) Idempotencia: si ya es el default, sal de una
  const current = await businessService.getCurrentDesignById(bizId);
  if (Number(current?.default_card_detail_id) === designId) {
    return { ok: true, default_card_detail_id: designId, unchanged: true };
  }

  // 4) Actualiza (firma correcta: (designId, businessId))
  const updated = await businessService.updateCurrentDesignById(designId, bizId);
  if (!updated || Number(updated.id) !== bizId) {
    const err = new Error('Negocio no encontrado'); err.statusCode = 404; throw err;
  }

  return { ok: true, default_card_detail_id: designId };
}



module.exports = { createBusinessThenDesign, setBusinessDefaultDesignProcess };
