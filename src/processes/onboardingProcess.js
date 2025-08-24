// processes/onboardingProcess.js
const crypto = require('crypto');

const usersService      = require('../services/usersService');
const businessService   = require('../services/businessService');
const carddetailService = require('../services/carddetailService');
const walletProcess     = require('../processes/walletProcess'); // ya lo tienes: issueGoogleWalletLink / issueAppleWalletPkpass

const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

const ensureBusiness = async (business_id) => {
  const biz = await businessService.getOneBusiness(business_id);
  if (!biz) {
    const err = new Error('Negocio no existente');
    err.statusCode = 404;
    throw err;
  }
  return biz;
};

const pickDesign = async (business_id, card_detail_id) => {
    if (card_detail_id) {

        const design = await carddetailService.getOneCardDetails(card_detail_id);
        if (!design || Number(design.business_id) !== Number(business_id)) {
            const err = new Error('card_detail_id inválido para este negocio');
            err.statusCode = 400;
            throw err;
        }
        return design;
    }
    const list = await carddetailService.getAllCardsByBusiness(business_id);
    const design = pickFirst(list);
    if (!design) {
        const err = new Error('El negocio no tiene diseños de tarjeta');
        err.statusCode = 400;
        throw err;
    }
    return design;
};

const createUserAndIssueProcess = async ({ business_id, name, email, phone, card_detail_id, points }) => {
  const initial_points = 0; 
  // 1) Validaciones de negocio y diseño
  const biz = await ensureBusiness(business_id);
  const design = await pickDesign(business_id, card_detail_id);

  // saneo básico
  name  = (name  ?? '').toString().trim();
  email = (email ?? '').toString().trim();
  phone = (phone ?? '').toString().trim() || null;

  // 2) Identificadores del pase (defínelos ANTES de validar longitudes)
  const serial_number      = crypto.randomUUID();
  const apple_auth_token   = crypto.randomBytes(16).toString('hex');
  const apple_pass_type_id = design.pass_type_id; 
  const loyalty_account_id = `CARD-${business_id}-${serial_number.slice(0, 8).toUpperCase()}`;

  // 3) Validaciones de longitud (evita 22001 con mensaje claro)
  const assertLen = (v, n, field) => {
    if (v != null && String(v).length > n) throw new Error(`${field} demasiado largo (${String(v).length} > ${n})`);
  };
  assertLen(name,               255, 'name');
  assertLen(email,              255, 'email');
  assertLen(phone,               32, 'phone');
  assertLen(apple_pass_type_id, 255, 'apple_pass_type_id');
  assertLen(loyalty_account_id,  64, 'loyalty_account_id');

  // 4) Crear usuario completo en DB (con payload OBJETO)
  const user = await usersService.createUser({
    name,
    email,
    phone,
    business_id,
    points: points || initial_points,
    serial_number,
    apple_auth_token,
    apple_pass_type_id,
    card_detail_id: design.id,
    loyalty_account_id,
  });
  console.log("[PROCESS] Usuario creado:", { id: user.id, email: user.email });

  // 5) Emitir artefactos Wallet
  const google_save_url = await walletProcess.issueGoogleWalletLink({
    cardCode: serial_number,
    userName: user.name,
    programName: biz.name,
    businessId: business_id,
  });

  const base = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const typeId = process.env.PASS_TYPE_IDENTIFIER; 
  const apple_pkpass_url = `${base}/api/v1/wallets/v1/passes/${encodeURIComponent(typeId)}/${serial_number}`;

  // 6) Guardar URL de Google (usa helper ya existente)
  await usersService.saveUserWallet({
    userId: user.id,
    loyalty_account_id,
    wallet_url: google_save_url
  });

  // 7) Respuesta
  return {
    user: {
      id: user.id,
      business_id: user.business_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      points: user.points,
      serial_number,
      apple_auth_token,
      apple_pass_type_id,
      card_detail_id: design.id,
      loyalty_account_id,
    },
    wallet: {
      google_save_url,
      apple_pkpass_url,
      apple_auth_header: `ApplePass ${apple_auth_token}`,
    },
  };
};


const changeUserDesignProcess = async ({ user_id, card_detail_id }) => {
    // Carga user
    const user = await usersService.getOneUser(user_id);
    if (!user) {
        const err = new Error('Usuario no existe');
        err.statusCode = 404;
        throw err;
    }

    // Valida nuevo diseño contra su negocio
    const design = await carddetailService.getOneCardDetails(card_detail_id);
    if (!design || Number(design.business_id) !== Number(user.business_id)) {
        const err = new Error('card_detail_id inválido para el negocio del usuario');
        err.statusCode = 400;
        throw err;
    }

    // Actualiza y marca updated_at para que iOS refresque (o para 304 logic)
    await usersService.updateUser(user.id, {
        card_detail_id: design.id,
        updated_at: new Date(),
    });

    // (Opcional) Notificar APNs para refrescar
    // Si tienes un helper en process o service para esto, llámalo aquí.
    // p.ej.: await walletProcess.pushRefresh(user.serial_number);

    return true;
};

module.exports = {
  createUserAndIssueProcess,
  changeUserDesignProcess,
};
