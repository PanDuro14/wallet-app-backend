// db/index.js
const remote = require('./dbConection');
const local  = require('./dbConectionLocal');

let driver = null;
let resolveReady, rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

(async () => {
  try {
    // Si dbConection.js solo exporta pool directamente, úsalo así:
    if (typeof remote.connect === 'function') {
      await remote.connect();
    } else {
      // Si remote ya es el pool, solo testea la conexión
      await remote.query('SELECT NOW()');
    }
    driver = remote;
    console.log(' DB: remota OK');
    resolveReady(true);
  } catch (e1) {
    console.warn(' DB remota falló:', e1.message);
    try {
      if (typeof local.connect === 'function') {
        await local.connect();
      } else {
        await local.query('SELECT NOW()');
      }
      driver = local;
      console.log(' DB: local OK');
      resolveReady(true);
    } catch (e2) {
      console.error(' DB sin conexión:', e2.message);
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
  // Si driver tiene getClient, úsalo; si no, usa connect()
  return d.getClient ? d.getClient() : d.connect();
}

module.exports = { ready, query, getClient };