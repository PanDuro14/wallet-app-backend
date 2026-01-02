const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* sigue sin sharp */ }

// Detecta PNG por firma
function isPNG(buf) {
  return Buffer.isBuffer(buf)
    && buf.length > 8
    && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47
    && buf[4]===0x0D && buf[5]===0x0A && buf[6]===0x1A && buf[7]===0x0A;
}

async function toPNG(buffer) {
  if (!buffer) return null;
  if (isPNG(buffer) || !sharp) return buffer;
  return await sharp(buffer).png().toBuffer();
}

// NUEVO: genera tamaños “amigables” para Wallet
async function writeLogoSet(modelDir, buffer) {
  if (!buffer) return;
  const png = await toPNG(buffer);
  if (!sharp) {
    await fsp.writeFile(path.join(modelDir, 'logo.png'), png);
    return;
  }
  // 1x ≈ 160×50 (máximo recomendado). 2x ≈ 320×100.
  const logo1x = await sharp(png).resize({ width: 160, height: 50, fit: 'inside' }).png().toBuffer();
  const logo2x = await sharp(png).resize({ width: 320, height: 100, fit: 'inside' }).png().toBuffer();
  await fsp.writeFile(path.join(modelDir, 'logo.png'), logo1x);
  await fsp.writeFile(path.join(modelDir, 'logo@2x.png'), logo2x);
  // thumbnail como respaldo visual
  await fsp.writeFile(path.join(modelDir, 'thumbnail.png'), logo1x);
}

async function writeStrip(modelDir, buffer) {
  if (!buffer) return;
  const png = await toPNG(buffer);
  if (!sharp) {
    await fsp.writeFile(path.join(modelDir, 'strip.png'), png);
    return;
  }
  // strip 1x ≈ 320×123, 2x ≈ 640×246 (contener)
  const s1 = await sharp(png).resize({ width: 320, height: 123, fit: 'inside' }).png().toBuffer();
  const s2 = await sharp(png).resize({ width: 640, height: 246, fit: 'inside' }).png().toBuffer();
  await fsp.writeFile(path.join(modelDir, 'strip.png'), s1);
  await fsp.writeFile(path.join(modelDir, 'strip@2x.png'), s2);
}

// Crea modelo temporal que TERMINE en .pass y pisa assets
async function buildTempModel(baseDir, assets = {}) {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'pass-'));
  const tmpModelDir = `${tmpBase}.pass`;
  await fsp.mkdir(tmpModelDir, { recursive: true });
  await fsp.cp(baseDir, tmpModelDir, { recursive: true });

  if (assets.logo)  await writeLogoSet(tmpModelDir, assets.logo);
  if (assets.strip) await writeStrip(tmpModelDir, assets.strip);
  // Plan B: si no hay strip, usa el logo como strip para asegurar presencia
  if (!assets.strip && assets.logo) await writeStrip(tmpModelDir, assets.logo);

  return tmpModelDir;
}
