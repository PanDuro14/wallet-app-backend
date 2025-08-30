// src/db/index.js
const remote = require('./dbConection');
const local  = require('./dbConectionLocal');

let driver = null;
let resolveReady, rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

(async () => {
  try {
    await remote.connect();            // debe preparar un Pool interno
    driver = remote;                   // { query, getClient }
    console.log('DB: remota OK');
    resolveReady(true);
  } catch (e1) {
    console.warn('DB remota falló:', e1.message);
    try {
      await local.connect();
      driver = local;
      console.log('DB: local OK');
      resolveReady(true);
    } catch (e2) {
      console.error('DB sin conexión:', e2.message);
      rejectReady(e2);
    }
  }
})();

function ensure() {
  if (!driver) throw new Error('DB no inicializada aún (espera db.ready)');
  return driver;
}

async function query(text, params = []) {
  await ready;
  const d = ensure();
  return d.query(text, params);
}

async function getClient() {
  await ready;
  const d = ensure();
  return d.getClient(); // client con .query() y .release()
}

module.exports = { ready, query, getClient };
