const sharp = require('sharp');

class StripsImageService {
  async generateStripsImage({
    collected = 0,
    total = 8,
    stripImageOn,
    stripImageOff,
    cardWidth = 300,
  }) {
    try {
      // ===== Manejo de imágenes ON / OFF =====
      let imageOnBuffer = null;
      let imageOffBuffer = null;

      if (stripImageOn) {
        imageOnBuffer = Buffer.isBuffer(stripImageOn)
          ? stripImageOn
          : Buffer.from(stripImageOn.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      }
      if (stripImageOff) {
        imageOffBuffer = Buffer.isBuffer(stripImageOff)
          ? stripImageOff
          : Buffer.from(stripImageOff.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      }

      if (!imageOnBuffer) {
        imageOnBuffer = await this.createDefaultImage('✅', '#4CAF50');
      }
      if (!imageOffBuffer) {
        imageOffBuffer = await this.createDefaultImage('⭕', '#CCCCCC');
      }

      // ===== Tamaño externo fijo (Wallet) =====
      const outerWidth = cardWidth; // 300px
      const outerHeight = 120;      // Apple Wallet slot

      // ===== Tamaño interno (grilla) =====
      const innerWidth = 260; // más pequeño
      const innerHeight = 120; // más pequeño
      const stripsPerRow = 4;
      const numRows = Math.ceil(total / stripsPerRow);

      const stripWidth = Math.floor(innerWidth / stripsPerRow);
      const stripHeight = Math.floor(innerHeight / numRows);

      // ===== Canvas interno =====
      const innerCanvas = sharp({
        create: {
          width: innerWidth,
          height: innerHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      });

      // ===== Redimensionar imágenes =====
      const resizedOn = await sharp(imageOnBuffer)
        .resize(stripWidth, stripHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      const resizedOff = await sharp(imageOffBuffer)
        .resize(stripWidth, stripHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      // ===== Pegar strips en el canvas interno =====
      const compositeInner = [];
      for (let i = 0; i < total; i++) {
        const isCollected = i < collected;
        const row = Math.floor(i / stripsPerRow);
        const col = i % stripsPerRow;

        compositeInner.push({
          input: isCollected ? resizedOn : resizedOff,
          left: col * stripWidth,
          top: row * stripHeight
        });
      }

      const innerImage = await innerCanvas.composite(compositeInner).png().toBuffer();

      // ===== Canvas externo =====
      const offsetX = Math.floor((outerWidth - innerWidth) / 2);
      const offsetY = Math.floor((outerHeight - innerHeight) / 2);

      const outerCanvas = sharp({
        create: {
          width: outerWidth,
          height: outerHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      });

      // Pegar la imagen interna centrada
      return await outerCanvas
        .composite([{ input: innerImage, left: offsetX, top: offsetY }])
        .png()
        .toBuffer();

    } catch (error) {
      console.error('[StripsImage] ❌ Error:', error.message);
      throw error;
    }
  }

  async createDefaultImage(text, color) {
    const svg = `
      <svg width="80" height="80" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="35" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
        <text x="40" y="50" font-size="20" text-anchor="middle" fill="white">${text}</text>
      </svg>
    `;
    return await sharp(Buffer.from(svg)).png().toBuffer();
  }
}

module.exports = new StripsImageService();
