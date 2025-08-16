const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:8080';

function isPNG(buf) {
  return Buffer.isBuffer(buf)
    && buf.length > 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

async function saveBufferAsPublicPNG({ businessId, kind, buffer }) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  if (!isPNG(buffer)) {
    console.warn(`[imageStorage] ${kind} no es PNG. Convierte antes de guardar en DB (Apple lo exige).`);
  }

  const dir = path.join(process.cwd(), 'public', 'uploads', String(businessId || 'unknown'));
  await fsp.mkdir(dir, { recursive: true });

  const sha1 = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const name = `${kind || 'asset'}-${sha1}.png`;
  const filePath = path.join(dir, name);
  try { await fsp.access(filePath); } catch { await fsp.writeFile(filePath, buffer); }

  return `${PUBLIC_BASE_URL}/public/uploads/${businessId}/${name}`;
}

module.exports = { saveBufferAsPublicPNG };
