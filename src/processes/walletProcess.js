const carddetailsProcess = require('./carddetailsProcess');
const businessesProcess = require('./businessProcess');
const { buildAddToGoogleWalletURL, ensureLoyaltyClass, getSA, normalizeGWBarcodeType, isHttps, classIdForBusinessTheme } = require('../services/googleWalletService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const { saveBufferAsPublicPNG } = require('../services/imageStorageService');

// orignes 
const issuerId = process.env.GOOGLE_ISSUER_ID;
const origins = (process.env.GOOGLE_WALLET_ORIGINS || 'http://localhost:4200')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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


function sanityLog() {
  try {
    const s = getSA(); // viene del service
      console.log('[Wallet sanity]', {
      issuerId,
      sa_email: s?.client_email,
      project_id: s?.project_id,
      origins
    });
  } catch (e) {
    console.log('[Wallet sanity] No se pudo cargar SA:', e?.message || e);
  }
}



// Proceos para google (hasta acá abajo para no batallar al manipular uno u otro )
async function issueGoogleWalletLink({
  cardCode, userName, programName, businessId,
  colors = {}, assets = {}, fields = {}, barcode = {}
}) {
  sanityLog();

  // 1) Cargar branding base de BD
  const { logoBuffer, programName: pn, bg } = await loadBrandAssets(businessId);

  // 2) Elegir assets/colores efectivos (request > BD)
  const logoBuf = assets.logo || logoBuffer || null;
  const hexBg   = (colors.background || bg || '#2d3436').toString().trim();
  const effProg = programName || pn || 'Loyalty';

  // 3) Subir logo a URL pública HTTPS (si hay)
  let logoUri = null;
  if (logoBuf) {
    const url = await saveBufferAsPublicPNG({ businessId, kind: 'logo', buffer: logoBuf });
    if (isHttps(url)) logoUri = url;
    else console.warn('[Wallet] Ignorando imagen no-HTTPS:', url);
  }

  // Fallback obligatorio: Google no crea la clase sin logo
  if (!logoUri) {
    const fb = process.env.GOOGLE_WALLET_FALLBACK_LOGO_HTTPS;
    if (fb && isHttps(fb)) {
      console.warn('[Wallet] Usando fallback HTTPS para programLogo:', fb);
      logoUri = fb;
    } else {
      // Si prefieres devolver 400 al cliente:
      // throw new Error('Se requiere un logo en HTTPS público para crear la clase de Google Wallet.');
      console.warn('[Wallet] No hay logo HTTPS; se intentará sin logo (fallará con 400).');
    }
  }
  // 4) Asegurar CLASE (colores y logo viven en la clase)
  await ensureLoyaltyClass({
    businessId,
    programName: effProg,
    hexBackgroundColor: hexBg,
    logoUri // null si no es https
  });

  // 5) Módulos (texto/imagen) y código de barras para el OBJETO
  const textModulesData = [
    { header: effProg, body: `Cliente: ${userName || cardCode}` }
  ];

  const type = normalizeGWBarcodeType(barcode.pref || barcode.type || barcode.format);
  const value = (barcode.message ?? cardCode) + '';
  const alternateText = barcode.altText ?? undefined;

  // 6) Construir URL “Save to Google Wallet”
  return buildAddToGoogleWalletURL({
    cardCode,
    userName,
    businessId,
    brand: { programName: effProg, bg: hexBg, logoUri },
    barcode: { type, value, alternateText },
    modules: { textModulesData } 
  });
}

module.exports = { issueGoogleWalletLink, issueAppleWalletPkpass, loadBrandAssets };
