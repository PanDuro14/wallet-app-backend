const carddetailsProcess = require('./carddetailsProcess');
const businessesProcess = require('./businessProcess');
const { buildAddToGoogleWalletURL, ensureLoyaltyClass } = require('../services/googleWalletService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const { saveBufferAsPublicPNG } = require('../services/imageStorageService');

// helpers para procesar los iconos 
function toBufferMaybe(x) {
  if (!x) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (typeof x === 'object' && x.type === 'Buffer' && Array.isArray(x.data)) {
    return Buffer.from(x.data);
  }
  return null;
}

function firstOrNull(x) {
  return Array.isArray(x) ? (x[0] || null) : x || null;
}

function pickAnyBuffer(obj, keys = []) {
  const o = firstOrNull(obj);
  if (!o || typeof o !== 'object') return null;

  // 1) claves conocidas
  for (const k of keys) {
    const b = toBufferMaybe(o[k]);
    if (b) return b;
  }
  // 2) barrido rápido
  for (const [, v] of Object.entries(o)) {
    const b = toBufferMaybe(v);
    if (b) return b;
  }
  return null;
}
// ya de aqui en delante no hay helpers xd
async function loadBrandAssets(businessId) {
  const cdRes  = await carddetailsProcess.getOneCardByBusiness(businessId); // puede ser obj o array
  const bizRes = await businessesProcess.getOneBusiness(businessId);        

  const cd  = firstOrNull(cdRes);
  const biz = firstOrNull(bizRes);

  // En businesses la columna se llama "logo"
  const logoBuffer =
    pickAnyBuffer(cd,  ['logoBuffer','logo','logo_image','image','logo_png']) ||
    pickAnyBuffer(biz, ['logo','logoBuffer','image','logo_png']) || null;

  const stripBuffer =
    pickAnyBuffer(cd, ['strip_imageBuffer','stripBuffer','strip','strip_image','strip_png']) || null;

  const programName = (cd && cd.program_name) || (biz && biz.name) || 'Loyalty';
  const bg = (cd && cd.background_color) || (biz && biz.background_color) || '#2d3436';
  const fg = (cd && cd.foreground_color) || (biz && biz.foreground_color) || '#E6E6E6';

  console.log('[Apple Assets]', {
    businessId,
    isBizArray: Array.isArray(bizRes),
    isCdArray: Array.isArray(cdRes),
    hasLogo: !!logoBuffer,
    logoLen: logoBuffer?.length || 0,
    hasStrip: !!stripBuffer
  });

  return { logoBuffer, stripBuffer, programName, bg, fg };
}

async function issueAppleWalletPkpass(dto) {
  const { businessId } = dto;
  const { logoBuffer, stripBuffer, programName: pn, bg, fg } = await loadBrandAssets(businessId);

  const assets = { ...dto.assets };
  if (!assets.logo  && logoBuffer)  assets.logo  = logoBuffer;
  if (!assets.strip && stripBuffer) assets.strip = stripBuffer;

  const colors = dto.colors || { background: bg, foreground: fg };

  const effectivePoints =
    dto.points ??
    findPointsInFields(dto.fields) ??
    0;

  return await createPkPassBuffer({
    ...dto,
    programName: dto.programName || pn,
    points: effectivePoints,
    colors,
    assets
  });
}



// Proceos para google (hasta acá abajo para no batallar al manipular uno u otro )
async function issueGoogleWalletLink({ cardCode, userName, programName, businessId }) {
  const { logoBuffer, programName: pn, bg } = await loadBrandAssets(businessId);

  // Google necesita URL pública (a partir del Buffer)
  let logoUri = null;
  if (logoBuffer) {
    logoUri = await saveBufferAsPublicPNG({ businessId, kind: 'logo', buffer: logoBuffer });
  }

  await ensureLoyaltyClass({
    businessId,
    programName: programName || pn,
    hexBackgroundColor: bg,    // si tu ensureLoyaltyClass acepta HEX
    logoUri: logoUri || null
  });

  return buildAddToGoogleWalletURL({
    cardCode, userName,
    brand: { programName: programName || pn, bg, logoUri: logoUri || null },
    businessId
  });
}

module.exports = { issueGoogleWalletLink, issueAppleWalletPkpass };
